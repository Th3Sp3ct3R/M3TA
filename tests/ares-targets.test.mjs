// Verifies the TargetSource layer (@ares/harness/targets) — the "who to act ON"
// side — fully offline:
//   1. mapRowToTarget: provider row → typed Target; untrusted text preserved
//      as data; raw is frozen.
//   2. queryToArgs: TargetQuery → provider tool arguments (default limit).
//   3. MockTargetSource: concrete filters (country, followers, verified, email,
//      limit) applied deterministically.
//   4. LiveTargetSource: wiring verified against a FAKE McpHttpClient —
//      calls the right tool with mapped args and maps data[] → Target[], with
//      NO network.
//   5. Missing token: constructing the live source without a token throws.

import test from "node:test";
import assert from "node:assert/strict";

import {
  LiveTargetSource,
  TARGET_FIXTURE_ROWS,
  MockTargetSource,
  mapRowToTarget,
  queryToArgs,
} from "../packages/harness/dist/index.js";

// ── 1. Mapping ───────────────────────────────────────────────────────────────

test("mapRowToTarget: maps fields, preserves untrusted text, freezes raw", () => {
  const t = mapRowToTarget(TARGET_FIXTURE_ROWS[0]);
  assert.equal(t.igId, "1642647");
  assert.equal(t.username, "cayla.craft");
  assert.equal(t.followerCount, 119866);
  assert.equal(t.isVerified, true);
  assert.equal(t.email, "hi@caylacraft.com");
  assert.equal(t.source, "live");
  assert.equal(t.bio, "I help women close deals."); // untrusted, kept as data
  assert.throws(() => {
    t.raw.pk = "mutated";
  }, "raw is frozen");
});

// ── 2. Query translation ─────────────────────────────────────────────────────

test("queryToArgs: maps TargetQuery to provider args with default limit", () => {
  const args = queryToArgs({ metaCategory: "music", country: "United States", minFollowers: 10000 });
  assert.equal(args.meta_category, "music");
  assert.equal(args.country, "United States");
  assert.equal(args.min_followers, 10000);
  assert.equal(args.limit, 50); // default applied
  const capped = queryToArgs({ limit: 3 });
  assert.equal(capped.limit, 3);
});

// ── 3. Mock filtering ────────────────────────────────────────────────────────

test("MockTargetSource: applies country/followers/verified/email/limit filters", async () => {
  const src = new MockTargetSource();

  const us = await src.search({ country: "United States" });
  assert.ok(us.length === 3 && us.every((t) => t.country === "United States"));

  const bigVerified = await src.search({ minFollowers: 100000, isVerified: true });
  assert.ok(bigVerified.every((t) => t.followerCount >= 100000 && t.isVerified));

  const withEmail = await src.search({ hasEmail: true });
  assert.ok(withEmail.length === 3 && withEmail.every((t) => Boolean(t.email)));

  const limited = await src.search({ limit: 2 });
  assert.equal(limited.length, 2);
});

// ── 4. LiveTargetSource against a FAKE client (no network) ────────────────────

test("LiveTargetSource: calls the right tool and maps data[] — offline", async () => {
  const calls = [];
  const fakeClient = {
    async callTool(name, args) {
      calls.push({ name, args });
      return { _untrusted: true, data: TARGET_FIXTURE_ROWS.slice(0, 2) };
    },
  };
  const src = new LiveTargetSource({ client: fakeClient });
  const targets = await src.search({ metaCategory: "music", country: "United States", minFollowers: 10000, limit: 2 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "search_users_by_demographics");
  assert.equal(calls[0].args.meta_category, "music");
  assert.equal(calls[0].args.min_followers, 10000);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].source, "live");
  assert.equal(targets[0].igId, "1642647");
});

// ── 5. Missing token guard ───────────────────────────────────────────────────

test("LiveTargetSource: throws without a token when no client injected", () => {
  const saved = process.env.TARGETS_MCP_TOKEN;
  delete process.env.TARGETS_MCP_TOKEN;
  try {
    assert.throws(() => new LiveTargetSource(), /missing token/i);
  } finally {
    if (saved !== undefined) process.env.TARGETS_MCP_TOKEN = saved;
  }
});
