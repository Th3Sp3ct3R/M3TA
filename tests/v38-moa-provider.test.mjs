// Mixture-of-Agents as a pickable model. The synthetic MoaProvider fans the
// prompt out to reference models (tool-free drafts), then streams a tool-capable
// aggregator that synthesizes them into the answer. These lock the contract with
// mock members (no real models needed): references get no tools, the aggregator
// keeps the real tools + gets the drafts, and dead references degrade gracefully.

import test from "node:test";
import assert from "node:assert/strict";

import { MoaProvider } from "../packages/core/dist/index.js";

function textProvider(name, text, capture) {
  return {
    name,
    async *stream(req) {
      if (capture) capture(req);
      yield { type: "text_delta", text };
      yield {
        type: "message_done",
        message: { id: "m", role: "assistant", content: [{ type: "text", text }], createdAt: new Date().toISOString() },
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: "end_turn",
      };
    },
  };
}
const deadProvider = () => ({
  name: "dead",
  async *stream() { yield { type: "error", error: { code: "no_auth", message: "x", retriable: false } }; },
});

const baseReq = {
  model: "moa-council",
  system: "SYS",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "Read", description: "", input_schema: {} }],
};

test("MoA: references draft, aggregator synthesizes and streams the answer", async () => {
  let aggReq = null;
  const moa = new MoaProvider({
    ensembleName: "test",
    references: [
      { provider: textProvider("r1", "draft one"), model: "m1", label: "Alpha" },
      { provider: textProvider("r2", "draft two"), model: "m2", label: "Beta" },
    ],
    aggregator: { provider: textProvider("agg", "final answer", (r) => { aggReq = r; }), model: "agg-model", label: "Agg" },
  });
  const events = [];
  for await (const ev of moa.stream(baseReq)) events.push(ev);

  assert.match(aggReq.system, /draft one/, "aggregator sees draft 1");
  assert.match(aggReq.system, /draft two/, "aggregator sees draft 2");
  assert.match(aggReq.system, /Alpha/, "drafts are labelled by member");
  assert.match(aggReq.system, /AGGREGATOR/, "aggregator is told its role");
  assert.equal(aggReq.model, "agg-model", "aggregator uses its OWN model, not the moa id");
  assert.equal(aggReq.tools.length, 1, "aggregator keeps the real tools (tool-capable)");
  assert.equal(events.some((e) => e.type === "text_delta" && e.text === "final answer"), true, "output is the aggregator's answer");
  assert.equal(events.at(-1).type, "message_done");
});

test("MoA: references run WITHOUT tools — they reason, they don't act", async () => {
  let refReq = null;
  const moa = new MoaProvider({
    ensembleName: "test",
    references: [{ provider: textProvider("r1", "d", (r) => { refReq = r; }), model: "m1", label: "A" }],
    aggregator: { provider: textProvider("agg", "ans"), model: "agg", label: "Agg" },
  });
  for await (const _ of moa.stream(baseReq)) { /* drain */ }
  assert.equal(refReq.tools.length, 0, "references get NO tools");
  assert.equal(refReq.model, "m1", "reference uses its member model, not the ensemble id");
});

test("MoA: a dead reference is skipped; the committee still answers", async () => {
  let aggReq = null;
  const moa = new MoaProvider({
    ensembleName: "test",
    references: [
      { provider: deadProvider(), model: "m1", label: "Dead" },
      { provider: textProvider("r2", "living draft"), model: "m2", label: "Live" },
    ],
    aggregator: { provider: textProvider("agg", "answer", (r) => { aggReq = r; }), model: "agg", label: "Agg" },
  });
  const events = [];
  for await (const ev of moa.stream(baseReq)) events.push(ev);
  assert.doesNotMatch(aggReq.system, /Dead/, "the dead reference contributes no draft");
  assert.match(aggReq.system, /living draft/, "the living reference still drafts");
  assert.equal(events.some((e) => e.type === "text_delta" && e.text === "answer"), true);
});

test("MoA: all references dead → aggregator answers solo, original system intact", async () => {
  let aggReq = null;
  const moa = new MoaProvider({
    ensembleName: "test",
    references: [{ provider: deadProvider(), model: "m1", label: "Dead" }],
    aggregator: { provider: textProvider("agg", "solo", (r) => { aggReq = r; }), model: "agg", label: "Agg" },
  });
  for await (const _ of moa.stream(baseReq)) { /* drain */ }
  assert.equal(aggReq.system, "SYS", "no drafts → aggregator gets the original system unchanged (graceful single-model fallback)");
});
