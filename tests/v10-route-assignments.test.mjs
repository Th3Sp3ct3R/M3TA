// Verifies the user-assignment routing layer (Nexus Phase 2): an owner's
// explicit per-lane pick overrides the heuristic, and unassigned lanes fall
// back to routeModel(). Pure + offline.

import test from "node:test";
import assert from "node:assert/strict";

import { resolveRoute, laneForTask, classifyLane, ROUTE_LANES, DEFAULT_PROVIDER_PROFILES } from "../packages/core/dist/index.js";

const policy = { profiles: DEFAULT_PROVIDER_PROFILES };

test("laneForTask maps fine kinds onto coarse owner lanes", () => {
  assert.equal(laneForTask("code"), "coding");
  assert.equal(laneForTask("planning"), "research");
  assert.equal(laneForTask("review"), "research");
  assert.equal(laneForTask("tool-output-summary"), "tool-use");
  assert.equal(laneForTask("chat"), "chat");
  assert.equal(laneForTask("memory"), "chat");
});

test("ROUTE_LANES is the four owner buckets", () => {
  assert.deepEqual([...ROUTE_LANES], ["chat", "coding", "research", "tool-use"]);
});

test("owner assignment wins over the heuristic", () => {
  const r = resolveRoute({ kind: "code" }, policy, {
    coding: { family: "ollama-local", model: "qwen3-coder:30b" },
  });
  assert.equal(r.source, "assigned");
  assert.equal(r.family, "ollama-local");
  assert.equal(r.model, "qwen3-coder:30b");
  assert.equal(r.locality, "local");
  assert.equal(r.lane, "coding");
});

test("classifyLane routes goals to coding/research/chat by keywords", () => {
  assert.equal(classifyLane("fix the bug in this function"), "coding");
  assert.equal(classifyLane("refactor the API endpoint"), "coding");
  assert.equal(classifyLane("make me a nice 3d world sandbox medieval style in D:\\cryptWORKSPACE"), "coding");
  assert.equal(classifyLane("make me a 3d sandbox\nmake it advanced"), "coding");
  assert.equal(classifyLane("research the best approach and compare options"), "research");
  assert.equal(classifyLane("explain why this design works"), "research");
  assert.equal(classifyLane("hey how are you"), "chat");
  assert.equal(classifyLane("what's the weather like"), "chat");
});

test("unassigned lane falls back to the heuristic", () => {
  const r = resolveRoute({ kind: "code" }, policy, {});
  assert.equal(r.source, "heuristic");
  assert.ok(r.family.length > 0);
});

test("assignment to an unknown provider is surfaced as a warning, still used", () => {
  const r = resolveRoute({ kind: "chat" }, policy, {
    chat: { family: "nope", model: "ghost" },
  });
  assert.equal(r.source, "assigned");
  assert.equal(r.family, "nope");
  assert.ok(r.warnings.some((w) => w.includes("not in the active profile set")));
});

test("assignment to an unavailable provider warns but is honored", () => {
  const profiles = DEFAULT_PROVIDER_PROFILES.map((p) =>
    p.family === "openrouter" ? { ...p, available: false } : p,
  );
  const r = resolveRoute({ kind: "planning" }, { profiles }, {
    research: { family: "openrouter", model: "anthropic/claude-opus-4" },
  });
  assert.equal(r.source, "assigned");
  assert.ok(r.warnings.some((w) => w.includes("unavailable")));
});
