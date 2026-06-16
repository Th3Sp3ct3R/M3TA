// Verifies the live reflection trigger: a finished run is summarized
// DETERMINISTICALLY (no model — facts in, structured record out) and folded into
// the war map; a re-fire is a no-op, a failure never becomes a win, receipts are
// kept, and the summary stays dagger-sized.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  summarizeRun,
  reflectOnRun,
  loadRecentAfterActions,
  loadProjectState,
  estimateTokensDefault,
} from "../packages/mind/dist/index.js";

const makeHome = () => fs.mkdtemp(path.join(os.tmpdir(), "ares-v30-"));

// ── Deterministic extraction (no poetic dragon-slaying) ───────────────────────

test("summarizeRun extracts a structured record from known facts, no model", () => {
  const rec = summarizeRun({
    projectId: "ares",
    task: "add after-action records",
    result: "success",
    commits: ["55b8ebd2"],
    changedFiles: ["packages/mind/src/memory/afterAction.ts", "tests/v29-after-action.test.mjs"],
    ciStatus: "615/615, CI green",
    sourcePointers: ["55b8ebd2"],
  });
  assert.equal(rec.result, "success");
  assert.match(rec.summary, /add after-action records/);
  assert.match(rec.importantChanges[0], /changed 2 file\(s\)/);
  assert.equal(rec.ciStatus, "615/615, CI green");
  assert.ok(!/dragon|warrior|conquered/i.test(rec.summary), "deterministic, not poetic");
});

test("summarizeRun infers result + projectId and clips long fields", () => {
  const rec = summarizeRun({ repo: "https://github.com/clout2buy/Ares", commits: ["abc"], task: "x".repeat(300) });
  assert.equal(rec.result, "success", "a commit ⇒ success by default");
  assert.equal(rec.projectId, "ares", "projectId inferred from the repo");
  assert.ok(rec.task.length <= 120, "task clipped");
});

// ── A successful run creates a record and updates the packet ──────────────────

test("a successful commit creates a record and updates recentWins / lastGate", async () => {
  const home = await makeHome();
  const out = await reflectOnRun(
    { projectId: "ares", task: "wire reflection trigger", result: "success", commits: ["abc123"], ciStatus: "623/623, CI green", nextActions: ["wire Garrison"] },
    home,
  );
  assert.equal(out.recorded, true);
  assert.ok(out.project, "the project packet was updated on success");
  assert.match(out.project.recentWins[0], /wire reflection trigger/);
  assert.match(out.project.recentWins[0], /abc123/, "win carries the commit receipt");
  assert.equal(out.project.lastGate, "623/623, CI green");

  const recent = await loadRecentAfterActions("ares", 10, home);
  assert.equal(recent.length, 1, "the record persisted");
  const reloaded = await loadProjectState("ares", home);
  assert.match(reloaded.recentWins[0], /wire reflection trigger/, "packet update persisted to disk");
});

// ── A failure records risk/lesson but no win ──────────────────────────────────

test("a failed run is recorded but does NOT update the war map", async () => {
  const home = await makeHome();
  const out = await reflectOnRun(
    { projectId: "ares", task: "tried to wire Garrison", result: "failed", summary: "broke the boot path", lessons: ["loop must be best-effort"] },
    home,
  );
  assert.equal(out.recorded, true);
  assert.equal(out.project, undefined, "no packet update on failure");
  const recent = await loadRecentAfterActions("ares", 10, home);
  assert.equal(recent[0].result, "failed");
  assert.deepEqual(recent[0].lessons, ["loop must be best-effort"], "the lesson is kept");
});

// ── Missing projectId does not crash ──────────────────────────────────────────

test("a run with no project id still summarizes and records without crashing", async () => {
  const home = await makeHome();
  const out = await reflectOnRun({ task: "ad-hoc work", result: "success", commits: ["nope1"] }, home);
  assert.equal(out.recorded, true);
  assert.equal(typeof out.record.projectId, "string");
  assert.ok(out.record.projectId.length > 0, "fell back to a safe id, no throw");
});

// ── Duplicate trigger does not spam ───────────────────────────────────────────

test("re-firing the trigger for the same commit is a no-op, not duplicate sludge", async () => {
  const home = await makeHome();
  const first = await reflectOnRun({ projectId: "ares", task: "a commit", result: "success", commits: ["dup1"] }, home);
  const second = await reflectOnRun({ projectId: "ares", task: "a commit (re-fired)", result: "success", commits: ["dup1"] }, home);
  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(second.skipped, "duplicate");
  const recent = await loadRecentAfterActions("ares", 10, home);
  assert.equal(recent.filter((r) => r.commits?.includes("dup1")).length, 1, "exactly one record for the commit");
});

// ── Compact + receipts ────────────────────────────────────────────────────────

test("the summary stays dagger-sized and source pointers are preserved", async () => {
  const home = await makeHome();
  const out = await reflectOnRun(
    {
      projectId: "ares",
      task: "x".repeat(400),
      summary: "y".repeat(400),
      result: "success",
      commits: ["sha9"],
      sourcePointers: ["sha9", "https://github.com/clout2buy/Ares/actions/runs/123", "rollouts/session-abc.jsonl"],
    },
    home,
  );
  assert.ok(out.record.summary.length <= 200, "summary clipped to dagger size");
  assert.ok(estimateTokensDefault(JSON.stringify(out.record)) < 300, "the whole record is compact");
  assert.ok(out.record.sourcePointers.includes("rollouts/session-abc.jsonl"), "session pointer kept");
  assert.ok(out.record.sourcePointers.includes("https://github.com/clout2buy/Ares/actions/runs/123"), "CI run pointer kept");
});
