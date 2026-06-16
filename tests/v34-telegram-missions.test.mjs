// Verifies Level-3 remote mission orchestration: /run_next is dry-run by default,
// /run_next approve QUEUES exactly one operator goal (idempotent), reject discards,
// /missions /mission /cancel manage the queue, dangerous actions are downgraded to
// planning-only, and Telegram never executes tools directly — it only AUTHORIZES.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  handleTelegramCommand,
  classifyMissionAction,
  stableHash,
} from "../packages/channels/dist/index.js";
import { createGoal, saveGoal, loadGoal, listGoals } from "../packages/operator/dist/index.js";

// A deps bundle backed by an in-memory mission store (mirrors the real wiring).
function missionDeps({ action = "wire HELM UI", projectId = "ares" } = {}) {
  const store = new Map();
  const { planningOnly } = classifyMissionAction(action);
  const id = `tg-${stableHash(`${projectId}:${action}`)}`;
  return {
    id,
    store,
    deps: {
      proposeNext: () => ({ id, action, why: "top of the war map", planningOnly }),
      authorizeMission: (p) => {
        if (store.has(p.id)) return { id: p.id, created: false };
        store.set(p.id, { id: p.id, statement: p.planningOnly ? `Plan ONLY: ${p.action}` : p.action, status: "active" });
        return { id: p.id, created: true };
      },
      listMissions: () => [...store.values()],
      getMission: (mid) => store.get(mid) ?? null,
      cancelMission: (mid) => {
        const m = store.get(mid);
        if (!m || m.status === "abandoned") return false;
        m.status = "abandoned";
        return true;
      },
    },
  };
}

// ── Dry-run by default ────────────────────────────────────────────────────────

test("/run_next is dry-run by default — nothing is queued", async () => {
  const { deps, store } = missionDeps();
  const r = await handleTelegramCommand("run_next", deps);
  assert.match(r.text, /dry-run/i);
  assert.match(r.text, /approve to queue/);
  assert.equal(store.size, 0, "no mission created without approve");
});

test("the proposal has a stable id (same state → same id)", async () => {
  const a = missionDeps({ action: "ship the thing" });
  const b = missionDeps({ action: "ship the thing" });
  assert.equal(a.id, b.id, "deterministic id for dedupe");
});

// ── Approve queues exactly one mission; duplicate approve is idempotent ────────

test("/run_next approve queues ONE mission; approving again is idempotent", async () => {
  const { deps, store, id } = missionDeps();
  const first = await handleTelegramCommand("run_next", deps, "approve");
  assert.match(first.text, /Mission queued/);
  assert.match(first.text, new RegExp(id));
  assert.equal(store.size, 1);

  const second = await handleTelegramCommand("run_next", deps, "approve");
  assert.match(second.text, /Already queued/);
  assert.equal(store.size, 1, "no duplicate mission");
});

test("/run_next reject discards the proposal", async () => {
  const { deps, store } = missionDeps();
  const r = await handleTelegramCommand("run_next", deps, "reject");
  assert.match(r.text, /rejected/i);
  assert.equal(store.size, 0);
});

// ── Mission management ────────────────────────────────────────────────────────

test("/missions lists the queue, /mission shows one, /cancel cancels it", async () => {
  const { deps, store, id } = missionDeps();
  await handleTelegramCommand("run_next", deps, "approve");

  const list = await handleTelegramCommand("missions", deps);
  assert.match(list.text, new RegExp(id));
  assert.match(list.text, /active/);

  const one = await handleTelegramCommand("mission", deps, id);
  assert.match(one.text, /Status: active/);

  const cancel = await handleTelegramCommand("cancel", deps, id);
  assert.match(cancel.text, /Cancelled/);
  assert.equal(store.get(id).status, "abandoned");

  const cancelAgain = await handleTelegramCommand("cancel", deps, id);
  assert.match(cancelAgain.text, /No pending mission/);
});

test("/missions is empty-safe and /mission unknown id is handled", async () => {
  const { deps } = missionDeps();
  assert.match((await handleTelegramCommand("missions", deps)).text, /No missions queued/);
  assert.match((await handleTelegramCommand("mission", deps, "ghost")).text, /No mission ghost/);
  assert.match((await handleTelegramCommand("mission", deps)).text, /Usage: \/mission/);
});

// ── Safety: dangerous actions are downgraded to planning-only ──────────────────

test("a dangerous proposed action is downgraded to planning-only, not executed", async () => {
  for (const danger of ["push to production", "delete the repo", "buy a domain", "rm -rf node_modules", "send an email to the team"]) {
    assert.equal(classifyMissionAction(danger).planningOnly, true, `"${danger}" flagged risky`);
  }
  assert.equal(classifyMissionAction("write the parser and add tests").planningOnly, false, "safe coding is not downgraded");

  const { deps, store, id } = missionDeps({ action: "push the release to GitHub" });
  const r = await handleTelegramCommand("run_next", deps, "approve");
  assert.match(r.text, /planning-only/i);
  assert.match(store.get(id).statement, /Plan ONLY/, "queued as a planning task, never a direct push");
});

// ── Telegram authorizes; the operator store actually receives the goal ────────

test("an approved mission lands in the real operator goal store (queued for the loop)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "ares-v34-"));
  const action = "wire HELM UI";
  const id = `tg-${stableHash(`ares:${action}`)}`;
  const deps = {
    proposeNext: () => ({ id, action, why: "war map", planningOnly: false }),
    authorizeMission: async (p) => {
      if (await loadGoal(home, p.id)) return { id: p.id, created: false };
      await saveGoal(home, createGoal({ id: p.id, statement: p.action }));
      return { id: p.id, created: true };
    },
  };
  await handleTelegramCommand("run_next", deps, "approve");
  const goals = await listGoals(home);
  assert.equal(goals.length, 1, "exactly one goal queued");
  assert.equal(goals[0].status, "active", "active → the operator loop will pick it up");
  assert.equal(goals[0].statement, action);
});

// ── Graceful degradation when orchestration deps are absent ───────────────────

test("missing orchestration deps degrade gracefully — no throw, no execution", async () => {
  // approve with no authorizeMission wired
  const approve = await handleTelegramCommand("run_next", { proposeNext: () => ({ id: "x", action: "a", why: "w", planningOnly: false }) }, "approve");
  assert.match(approve.text, /isn't wired/i);
  // mission management with no deps at all
  assert.match((await handleTelegramCommand("missions", {})).text, /No missions queued/);
  assert.match((await handleTelegramCommand("cancel", {}, "x")).text, /No pending mission/);
  assert.match((await handleTelegramCommand("run_next", {})).text, /dry-run/i, "bare /run_next still dry-runs with no deps");
});
