// Verifies the scraper run harness (@ares/harness) — the AzA orchestrator:
//   1. CSV: authorized-accounts columns map to Account; tags split on ";";
//      unknown platforms are dropped.
//   2. Happy path: every account runs through its platform adapter and returns
//      an outcome.
//   3. Error isolation: one failing account does NOT abort the batch, and its
//      device is still released (acquire/release stay balanced).
//   4. Filtering: excludeTags drops "do-not-assign"; platform filter narrows.
//   5. No adapter: an account on an unregistered platform is skipped without
//      acquiring a device.
//   6. Concurrency: the batch completes fully at concurrency 1 and N.
//   7. Pinned device: an account's device_name is honored by the router.

import test from "node:test";
import assert from "node:assert/strict";

import {
  Harness,
  InMemoryAccountSource,
  MockAdapter,
  MockDeviceRouter,
  MockSecretResolver,
  parseAccountsCsv,
} from "../packages/harness/dist/index.js";

const CSV = `platform,username,email,password_secret_ref,email_password_secret_ref,totp_secret_ref,device_name,tags
tiktok,creator_ok,ok@example.com,keychain:tiktok-creator_ok-password,,,,tiktok;prod
instagram,ig_ok,,keychain:ig-ig_ok-password,,,PinnedDevice7,instagram;prod
tiktok,creator_fail,fail@example.com,keychain:tiktok-creator_fail-password,,,,tiktok;prod
tiktok,skip_me,,,,,,do-not-assign
myspace,legacy,,,,,,ignored`;

function makeHarness(accounts, { adapters } = {}) {
  const devices = new MockDeviceRouter();
  const harness = new Harness({
    accounts: new InMemoryAccountSource(accounts),
    devices,
    secrets: new MockSecretResolver(),
    adapters: adapters ?? [
      new MockAdapter("tiktok"),
      new MockAdapter("instagram"),
      new MockAdapter("youtube"),
    ],
  });
  return { harness, devices };
}

// ── 1. CSV parsing ───────────────────────────────────────────────────────────

test("csv: maps columns to Account, splits tags, drops unknown platforms", () => {
  const accounts = parseAccountsCsv(CSV);
  // "myspace" row dropped (unknown platform); 4 valid rows remain.
  assert.equal(accounts.length, 4);

  const ig = accounts.find((a) => a.username === "ig_ok");
  assert.equal(ig.platform, "instagram");
  assert.equal(ig.deviceName, "PinnedDevice7");
  assert.equal(ig.passwordRef, "keychain:ig-ig_ok-password");
  assert.deepEqual(ig.tags, ["instagram", "prod"]);

  const skip = accounts.find((a) => a.username === "skip_me");
  assert.deepEqual(skip.tags, ["do-not-assign"]);
});

// ── 2. Happy path ────────────────────────────────────────────────────────────

test("run: every eligible account produces an outcome", async () => {
  const accounts = parseAccountsCsv(CSV);
  const { harness } = makeHarness(accounts);
  const outcomes = await harness.run({ kind: "scrape-profile" });
  // All 4 accounts attempted (no filter): 2 ok, 1 sim-fail, 1 do-not-assign
  // still runs here because no filter was applied.
  assert.equal(outcomes.length, 4);
  assert.equal(outcomes.filter((o) => o.result.ok).length, 3);
});

// ── 3. Error isolation + balanced device lifecycle ───────────────────────────

test("run: a failing account does not abort the batch and its device is released", async () => {
  const accounts = parseAccountsCsv(CSV);
  const { harness, devices } = makeHarness(accounts);
  const outcomes = await harness.run({ kind: "scrape-profile" });

  const fail = outcomes.find((o) => o.account.username === "creator_fail");
  assert.equal(fail.result.ok, false);
  assert.equal(fail.result.error.retryable, true);

  const ok = outcomes.find((o) => o.account.username === "creator_ok");
  assert.equal(ok.result.ok, true);

  // Every acquired device was released — no leaks even through the failure.
  assert.equal(devices.acquired, devices.released);
  assert.equal(devices.acquired, 4);
});

// ── 4. Filtering ─────────────────────────────────────────────────────────────

test("run: excludeTags drops do-not-assign; platform filter narrows", async () => {
  const accounts = parseAccountsCsv(CSV);

  const { harness: h1 } = makeHarness(accounts);
  const excluded = await h1.run({ kind: "scrape-profile" }, { filter: { excludeTags: ["do-not-assign"] } });
  assert.equal(excluded.length, 3);
  assert.ok(!excluded.some((o) => o.account.username === "skip_me"));

  const { harness: h2 } = makeHarness(accounts);
  const tiktokOnly = await h2.run({ kind: "scrape-profile" }, { filter: { platform: "tiktok" } });
  assert.ok(tiktokOnly.every((o) => o.account.platform === "tiktok"));
});

// ── 5. No adapter for platform → skip, no device acquired ────────────────────

test("run: account on an unregistered platform is skipped without a device", async () => {
  const accounts = parseAccountsCsv(CSV);
  // Only an instagram adapter registered; tiktok accounts have no adapter.
  const { harness, devices } = makeHarness(accounts, { adapters: [new MockAdapter("instagram")] });
  const outcomes = await harness.run({ kind: "scrape-profile" });

  const tiktok = outcomes.filter((o) => o.account.platform === "tiktok");
  assert.ok(tiktok.length >= 1);
  assert.ok(tiktok.every((o) => o.result.ok === false && /no adapter/.test(o.result.error.message)));
  // Only the single instagram account should have taken a device.
  assert.equal(devices.acquired, 1);
});

// ── 6. Concurrency: full completion at 1 and N ───────────────────────────────

test("run: completes every account at concurrency 1 and at concurrency 5", async () => {
  const accounts = parseAccountsCsv(CSV);

  const { harness: serial } = makeHarness(accounts);
  const a = await serial.run({ kind: "scrape-profile" }, { concurrency: 1 });
  assert.equal(a.length, 4);

  const { harness: parallel } = makeHarness(accounts);
  const b = await parallel.run({ kind: "scrape-profile" }, { concurrency: 5 });
  assert.equal(b.length, 4);
});

// ── 7. Pinned device honored ─────────────────────────────────────────────────

test("run: an account's device_name is used as the device id", async () => {
  const accounts = parseAccountsCsv(CSV).filter((a) => a.username === "ig_ok");
  const devices = new MockDeviceRouter();
  let seenDeviceId = null;
  const probe = {
    platform: "instagram",
    async run(ctx) {
      seenDeviceId = ctx.device.id;
      return { ok: true };
    },
  };
  const harness = new Harness({
    accounts: new InMemoryAccountSource(accounts),
    devices,
    secrets: new MockSecretResolver(),
    adapters: [probe],
  });
  await harness.run({ kind: "scrape-profile" });
  assert.equal(seenDeviceId, "PinnedDevice7");
});
