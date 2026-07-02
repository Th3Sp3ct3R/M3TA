// Unit tests for the pure TUI-elite logic (packages/cli/src/tuiElite.ts):
// per-file diff grouping + coloring, bracketed-paste normalization, line
// continuation, Ctrl+R history search, fleet-state folding, motion helpers.
// Ink-free by design — plain data in, data out.
// Run: pnpm --filter @ares/cli build && node --test tests/tui-elite.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  groupDiffByFile,
  diffHeaderLabel,
  diffLineSpans,
  normalizeInputChunk,
  endsWithContinuation,
  stripContinuation,
  searchHistory,
  reduceFleet,
  foldFleetRows,
  fleetGlyph,
  fleetSummary,
  motionEnabled,
  easeToward,
  shimmerSpans,
  formatDuration,
} from "../packages/cli/dist/tuiElite.js";

const DIFF_THEME = { add: "ADD", del: "DEL", meta: "META", dim: "DIM", text: "TEXT" };

// ─── Diff grouping ────────────────────────────────────────────────────────────

const TWO_FILE_DIFF = [
  "diff --git a/src/alpha.ts b/src/alpha.ts",
  "index 111..222 100644",
  "--- a/src/alpha.ts",
  "+++ b/src/alpha.ts",
  "@@ -1,3 +1,4 @@",
  " context line",
  "-const a = 1;",
  "+const a = 2;",
  "+const b = 3;",
  "diff --git a/src/beta.ts b/src/beta.ts",
  "--- a/src/beta.ts",
  "+++ b/src/beta.ts",
  "@@ -5,2 +5,1 @@",
  "-gone",
  "-also gone",
  "+kept",
].join("\n");

test("groupDiffByFile splits a two-file diff into per-file groups", () => {
  const groups = groupDiffByFile(TWO_FILE_DIFF);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].path, "src/alpha.ts");
  assert.equal(groups[0].adds, 2);
  assert.equal(groups[0].dels, 1);
  assert.equal(groups[1].path, "src/beta.ts");
  assert.equal(groups[1].adds, 1);
  assert.equal(groups[1].dels, 2);
});

test("groupDiffByFile keeps hunk bodies but consumes file headers", () => {
  const groups = groupDiffByFile(TWO_FILE_DIFF);
  const body = groups[0].lines.join("\n");
  assert.match(body, /@@ -1,3 \+1,4 @@/);
  assert.match(body, /\+const a = 2;/);
  assert.ok(!body.includes("+++"), "no +++ header in the body");
  assert.ok(!body.includes("index "), "no index header in the body");
});

test("groupDiffByFile handles a bare hunk without git headers", () => {
  const groups = groupDiffByFile("@@ -1 +1 @@\n-x\n+y");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].path, "(diff)");
  assert.equal(groups[0].adds, 1);
  assert.equal(groups[0].dels, 1);
});

test("groupDiffByFile falls back to +++ path when diff --git is absent", () => {
  const groups = groupDiffByFile("--- a/only.ts\n+++ b/only.ts\n@@ -1 +1 @@\n+z");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].path, "only.ts");
});

test("groupDiffByFile on empty/garbage input never throws", () => {
  assert.deepEqual(groupDiffByFile(""), []);
  assert.doesNotThrow(() => groupDiffByFile(null));
  assert.doesNotThrow(() => groupDiffByFile("random text\nwith lines"));
});

test("diffHeaderLabel formats the collapsed header row", () => {
  const label = diffHeaderLabel({ path: "src/a.ts", adds: 3, dels: 1, lines: [] });
  assert.equal(label, "▸ src/a.ts (+3 −1)");
});

test("diffLineSpans colors add/del/meta/context distinctly", () => {
  assert.equal(diffLineSpans("+new", DIFF_THEME)[0].color, "ADD");
  assert.equal(diffLineSpans("-old", DIFF_THEME)[0].color, "DEL");
  assert.equal(diffLineSpans("@@ -1 +1 @@ fn body", DIFF_THEME)[0].color, "META");
  assert.equal(diffLineSpans(" context", DIFF_THEME)[0].color, "DIM");
  // Concatenated span text always reproduces the input line.
  for (const line of ["+new", "-old", "@@ -1 +1 @@ fn body", " context"]) {
    const joined = diffLineSpans(line, DIFF_THEME).map((s) => s.text).join("");
    assert.equal(joined, line);
  }
});

// ─── Paste normalization ──────────────────────────────────────────────────────

test("bracketed paste markers are stripped and flagged as paste", () => {
  const chunk = normalizeInputChunk("[200~line one\nline two[201~");
  assert.equal(chunk.paste, true);
  assert.equal(chunk.text, "line one\nline two");
});

test("bare bracket markers (ESC stripped by the input layer) still count", () => {
  const chunk = normalizeInputChunk("[200~hello[201~");
  assert.equal(chunk.paste, true);
  assert.equal(chunk.text, "hello");
});

test("multi-char chunk containing newlines is a paste (heuristic)", () => {
  const chunk = normalizeInputChunk("a\nb\nc");
  assert.equal(chunk.paste, true);
  assert.equal(chunk.text, "a\nb\nc");
});

test("CRLF paste is normalized to LF but otherwise verbatim", () => {
  const chunk = normalizeInputChunk("x\r\ny\rz");
  assert.equal(chunk.paste, true);
  assert.equal(chunk.text, "x\ny\nz");
});

test("single keystrokes are never pastes", () => {
  assert.equal(normalizeInputChunk("a").paste, false);
  assert.equal(normalizeInputChunk("\r").paste, false);
  assert.equal(normalizeInputChunk("!").paste, false);
});

test("multi-char chunk WITHOUT newlines is not a paste (escape sequences)", () => {
  assert.equal(normalizeInputChunk("ab").paste, false);
});

test("pasted content is preserved verbatim (indentation, unicode, markdown)", () => {
  const src = "[200~  def f():\n    return \"⚔\" # **md**[201~";
  const chunk = normalizeInputChunk(src);
  assert.equal(chunk.text, '  def f():\n    return "⚔" # **md**');
});

// ─── Line continuation ────────────────────────────────────────────────────────

test("trailing backslash continues the line", () => {
  assert.equal(endsWithContinuation("hello \\"), true);
  assert.equal(stripContinuation("hello \\"), "hello ");
});

test("escaped backslash does not continue; empty/plain input does not", () => {
  assert.equal(endsWithContinuation("path\\\\"), false);
  assert.equal(endsWithContinuation(""), false);
  assert.equal(endsWithContinuation("plain"), false);
  assert.equal(stripContinuation("plain"), "plain");
});

test("odd backslash runs continue, even runs do not", () => {
  assert.equal(endsWithContinuation("x\\\\\\"), true); // three
  assert.equal(endsWithContinuation("x\\\\\\\\"), false); // four
});

// ─── History reverse-search ───────────────────────────────────────────────────

const HISTORY = ["/help", "git status", "npm test", "git push", "explain this diff"];

test("searchHistory finds the newest match first", () => {
  const m = searchHistory(HISTORY, "git");
  assert.equal(m.text, "git push");
  assert.equal(m.index, 3);
});

test("searchHistory skip cycles to older matches", () => {
  assert.equal(searchHistory(HISTORY, "git", 1).text, "git status");
  assert.equal(searchHistory(HISTORY, "git", 2), null);
});

test("searchHistory is case-insensitive and null on empty query / no match", () => {
  assert.equal(searchHistory(HISTORY, "GIT").text, "git push");
  assert.equal(searchHistory(HISTORY, ""), null);
  assert.equal(searchHistory(HISTORY, "zzz"), null);
  assert.equal(searchHistory([], "git"), null);
});

// ─── Fleet state ──────────────────────────────────────────────────────────────

function fleetEvent(extra) {
  return { kind: "fleet_activity", ...extra };
}

test("reduceFleet builds agents from start/tool/done lifecycle", () => {
  let state = null;
  state = reduceFleet(state, fleetEvent({ event: "fleet_start", fleetId: "fleet-42" }), 1000);
  assert.equal(state.fleetId, "fleet-42");
  assert.equal(state.active, true);
  state = reduceFleet(state, fleetEvent({ event: "start", agentId: "agent-1", role: "builder", phase: "build" }));
  state = reduceFleet(state, fleetEvent({ event: "tool", agentId: "agent-1", role: "builder", phase: "build", tool: "Edit", activity: "compiling packages/tools" }));
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0].status, "running");
  assert.match(state.agents[0].activity, /Edit compiling packages\/tools/);
  state = reduceFleet(state, fleetEvent({ event: "done", agentId: "agent-1", role: "builder", phase: "build", status: "completed" }));
  assert.equal(state.agents[0].status, "done");
});

test("reduceFleet marks non-completed done as failed and resumed as resumed", () => {
  let state = reduceFleet(null, fleetEvent({ event: "done", agentId: "a", status: "invalid" }));
  assert.equal(state.agents[0].status, "failed");
  state = reduceFleet(state, fleetEvent({ event: "resumed", agentId: "b", role: "tester", phase: "verify", status: "completed" }));
  assert.equal(state.agents[1].status, "resumed");
});

test("reduceFleet upserts by agentId (no duplicate rows)", () => {
  let state = reduceFleet(null, fleetEvent({ event: "start", agentId: "a", role: "r", phase: "p" }));
  state = reduceFleet(state, fleetEvent({ event: "tool", agentId: "a", role: "r", phase: "p", tool: "Bash" }));
  state = reduceFleet(state, fleetEvent({ event: "done", agentId: "a", role: "r", phase: "p", status: "completed" }));
  assert.equal(state.agents.length, 1);
});

test("reduceFleet ignores non-fleet payloads", () => {
  assert.equal(reduceFleet(null, { kind: "shell_output", text: "x" }), null);
  assert.equal(reduceFleet(null, "text"), null);
  assert.equal(reduceFleet(null, null), null);
  const state = reduceFleet(null, fleetEvent({ event: "start", agentId: "a" }));
  assert.equal(reduceFleet(state, { kind: "grep_match" }), state);
});

test("reduceFleet surfaces the planning architect as a row", () => {
  const state = reduceFleet(null, fleetEvent({ event: "planning", fleetId: "f1", role: "fleet-architect", phase: "plan" }));
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0].role, "fleet-architect");
  assert.equal(state.agents[0].status, "running");
});

test("foldFleetRows bounds to max rows, running agents first", () => {
  const agents = [];
  for (let i = 0; i < 15; i++) {
    agents.push({ agentId: `a${i}`, role: "r", phase: "p", status: i < 10 ? "done" : "running", activity: "" });
  }
  const { shown, hidden } = foldFleetRows(agents, 12);
  assert.equal(shown.length, 12);
  assert.equal(hidden, 3);
  // All 5 running agents survive the fold.
  assert.equal(shown.filter((a) => a.status === "running").length, 5);
  assert.equal(shown[0].status, "running");
});

test("foldFleetRows leaves small fleets alone", () => {
  const agents = [{ agentId: "a", role: "r", phase: "p", status: "running", activity: "" }];
  const { shown, hidden } = foldFleetRows(agents, 12);
  assert.equal(shown.length, 1);
  assert.equal(hidden, 0);
});

test("fleetGlyph and fleetSummary format the collapse line", () => {
  assert.equal(fleetGlyph("done"), "✓");
  assert.equal(fleetGlyph("failed"), "✗");
  assert.equal(fleetGlyph("resumed"), "↻");
  assert.equal(fleetGlyph("running"), "⚔");
  const state = {
    fleetId: "fleet-9",
    active: true,
    startedAt: 0,
    agents: [
      { agentId: "a", role: "r", phase: "p", status: "done", activity: "" },
      { agentId: "b", role: "r", phase: "p", status: "failed", activity: "" },
      { agentId: "c", role: "r", phase: "p", status: "resumed", activity: "" },
    ],
  };
  const summary = fleetSummary(state, 34_000);
  assert.equal(summary, "⚔ fleet fleet-9 · 3 agents · 2✓ 1✗ · 34s");
});

// ─── Motion helpers ───────────────────────────────────────────────────────────

test("motionEnabled respects ARES_NO_MOTION and TTY", () => {
  assert.equal(motionEnabled({ ARES_NO_MOTION: "1" }, true), false);
  assert.equal(motionEnabled({ ARES_NO_MOTION: "true" }, true), false);
  assert.equal(motionEnabled({}, false), false);
  assert.equal(motionEnabled({}, true), true);
  assert.equal(motionEnabled({ ARES_NO_MOTION: "0" }, true), true);
});

test("easeToward lerps toward the target and snaps when close", () => {
  const step = easeToward(0, 100);
  assert.ok(step > 0 && step < 100, "moves part way");
  assert.equal(easeToward(99.7, 100), 100, "snaps when close");
  assert.equal(easeToward(50, 50), 50, "settled stays put");
  // Converges within a bounded number of steps.
  let v = 0;
  for (let i = 0; i < 50 && v !== 100; i++) v = easeToward(v, 100);
  assert.equal(v, 100);
});

test("shimmerSpans always reproduces the text and sweeps a hot band", () => {
  const text = "thinking";
  let sawHot = false;
  for (let tick = 0; tick < 20; tick++) {
    const spans = shimmerSpans(text, tick);
    assert.equal(spans.map((s) => s.text).join(""), text);
    if (spans.some((s) => s.hot)) sawHot = true;
  }
  assert.equal(sawHot, true, "some tick lights part of the text");
  assert.deepEqual(shimmerSpans("", 3), []);
});

test("formatDuration renders compact human durations", () => {
  assert.equal(formatDuration(850), "850ms");
  assert.equal(formatDuration(1200), "1.2s");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(125_000), "2m05s");
  assert.equal(formatDuration(-5), "0ms");
  assert.equal(formatDuration(NaN), "0ms");
});
