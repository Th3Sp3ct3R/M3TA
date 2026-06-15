// V14 — smart compaction: when history crosses the threshold, the engine
// summarizes the OLD span via the host summarizer (model-written recap) and
// keeps recent turns whole, instead of bluntly trimming. Falls back to the
// deterministic ledger when no summarizer is wired or it fails.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { Session, chooseCompactionSplit, loadSessionSnapshot } from "../packages/core/dist/index.js";

function bigMsg(role, tag, chars = 20_000) {
  return { id: `m_${tag}`, role, content: [{ type: "text", text: "x".repeat(chars) }], createdAt: new Date().toISOString() };
}

function okProvider(onReq) {
  return {
    name: "mock",
    async *stream(req) {
      onReq?.(req);
      yield {
        type: "message_done",
        message: { id: "a", role: "assistant", content: [{ type: "text", text: "ok" }], createdAt: new Date().toISOString() },
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: "end_turn",
      };
    },
  };
}

function mkSession(extra) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "ares-v14-"));
  // 8 fat messages (~5k tokens each ≈ 40k tokens) — well over the threshold.
  const history = Array.from({ length: 8 }, (_, i) => bigMsg(i % 2 ? "assistant" : "user", `old_${i}`));
  return new Session({
    workspace,
    provider: okProvider(extra.onReq),
    model: "m",
    systemPrompt: "s",
    tools: [],
    initialMessages: history,
    compactionThresholdTokens: 3_000,
    ...extra.opts,
  });
}

// ─── chooseCompactionSplit ─────────────────────────────────────────────

test("chooseCompactionSplit keeps recent messages and summarizes the rest", () => {
  const msgs = Array.from({ length: 10 }, (_, i) => bigMsg("user", `${i}`, 8_000)); // ~2k tokens each
  const split = chooseCompactionSplit(msgs, 4_000); // keep ~4k tokens of recent
  assert.ok(split > 0 && split < msgs.length, `split in range, got ${split}`);
  assert.ok(msgs.length - split >= 4, "keeps at least minKeep recent");
});

test("chooseCompactionSplit refuses to split a tiny history", () => {
  const msgs = Array.from({ length: 3 }, (_, i) => bigMsg("user", `${i}`));
  assert.equal(chooseCompactionSplit(msgs, 4_000), 0);
});

test("chooseCompactionSplit never opens the kept window on an orphan tool_result", () => {
  const msgs = [
    bigMsg("user", "u0", 8_000),
    { id: "tu", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } }], createdAt: "now" },
    { id: "tr", role: "user", content: [{ type: "tool_result", toolUseId: "t1", content: "data" }], createdAt: "now" },
    bigMsg("assistant", "a1", 8_000),
    bigMsg("user", "u1", 8_000),
    bigMsg("assistant", "a2", 8_000),
  ];
  const split = chooseCompactionSplit(msgs, 5_000);
  if (split > 0) {
    assert.notEqual(msgs[split].content[0].type, "tool_result", "kept window must not lead with a tool_result");
  }
});

// ─── engine compaction via a real turn ─────────────────────────────────

test("compaction: summarizes the old span with the host summarizer and keeps recent", async () => {
  let summarizedSpan = null;
  const session = mkSession({
    opts: {
      summarizeSpan: async (messages) => {
        summarizedSpan = messages;
        return "GOAL: test\nDONE: built stuff\nSTATE: green\nOPEN: none\nFACTS: a.ts";
      },
    },
  });

  const events = [];
  for await (const e of session.send("continue")) events.push(e);

  const compaction = events.find((e) => e.type === "compaction");
  assert.ok(compaction, "a compaction event was emitted");
  assert.equal(compaction.method, "summary");
  assert.ok(compaction.summarizedMessages >= 2, "summarized the old span");
  assert.ok(compaction.tokensAfter < compaction.tokensBefore, "compaction shrank the context");
  assert.deepEqual(compaction.messages, session.engine.history().slice(0, compaction.messages.length), "event carries the exact compacted state");
  assert.ok(summarizedSpan && summarizedSpan.length >= 2, "summarizer received the old messages");

  const history = session.engine.history();
  const recap = history[0];
  assert.equal(recap.role, "user");
  assert.equal(recap.content[0].type, "system_reminder");
  assert.match(recap.content[0].text, /Compacted memory/);
  assert.match(recap.content[0].text, /built stuff/);
  // History shrank: the oldest summarized messages are folded into the recap;
  // recent ones (kept at full fidelity) and the new turn remain.
  const ids = history.map((m) => m.id);
  assert.ok(!ids.includes("m_old_0"), "the oldest message was folded into the recap");
  assert.ok(history.length < 8 + 2, "fewer messages than before compaction");
});

test("compaction: persisted replay restores the exact compacted transcript", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "ares-v14-replay-"));
  const sessionId = "sess_compaction_replay";
  const session = new Session({
    workspace,
    sessionId,
    provider: okProvider(),
    model: "m",
    systemPrompt: "s",
    tools: [],
    initialMessages: Array.from({ length: 8 }, (_, i) => bigMsg(i % 2 ? "assistant" : "user", `replay_${i}`)),
    compactionThresholdTokens: 3_000,
    summarizeSpan: async () => "GOAL: replay\nDONE: compacted\nSTATE: exact\nOPEN: none",
  });

  for await (const _event of session.send("continue")) void _event;

  const snapshot = await loadSessionSnapshot(workspace, sessionId, { maxMessages: 1_000 });
  assert.deepEqual(snapshot.messages, session.engine.history());
});

test("compaction: falls back to the deterministic ledger when the summarizer fails", async () => {
  const session = mkSession({
    opts: {
      summarizeSpan: async () => {
        throw new Error("summarizer down");
      },
    },
  });

  const events = [];
  for await (const e of session.send("continue")) events.push(e);

  const compaction = events.find((e) => e.type === "compaction");
  assert.ok(compaction, "compaction still happened");
  assert.equal(compaction.method, "ledger", "fell back to the ledger");
  const recap = session.engine.history()[0];
  assert.match(recap.content[0].text, /Context ledger/);
});

test("compaction: does NOT fire below the threshold", async () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "ares-v14-small-"));
  const session = new Session({
    workspace,
    provider: okProvider(),
    model: "m",
    systemPrompt: "s",
    tools: [],
    initialMessages: [bigMsg("user", "tiny", 100)],
    compactionThresholdTokens: 50_000, // way above this small history
    summarizeSpan: async () => "should not be called",
  });
  const events = [];
  for await (const e of session.send("continue")) events.push(e);
  assert.equal(events.find((e) => e.type === "compaction"), undefined, "no compaction under threshold");
});
