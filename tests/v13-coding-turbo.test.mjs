// V13 — the coding turbo: resilient Edit matching (CRLF / trailing-whitespace
// drift), CRLF-clean Read output, read-stamp invalidation when context
// budgeting trims history (the amnesia-spiral fix), and the provider
// stream-stall watchdog.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ReadTool, EditTool } from "../packages/tools/dist/index.js";
import { Session, collectTrimmedFilePaths } from "../packages/core/dist/index.js";
import { createStallGuard } from "../packages/core/dist/providers/stallGuard.js";

async function makeTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ares-v13-"));
}

function ctx(workspace) {
  return {
    workspace,
    signal: new AbortController().signal,
    permissionMode: "workspace-write",
    fileReadStamps: new Map(),
  };
}

// ─── Edit: line-ending resilience ──────────────────────────────────────

test("Edit: LF old_string lands on a CRLF file and preserves CRLF", async () => {
  const tmp = await makeTmp();
  const file = path.join(tmp, "crlf.ts");
  await fs.writeFile(file, "const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n", "utf8");
  const c = ctx(tmp);
  await ReadTool.call({ file_path: file }, c);

  // The model quotes the file with plain \n — the classic Windows killer.
  const r = await EditTool.call(
    { file_path: file, old_string: "const b = 2;\nconst c = 3;", new_string: "const b = 20;\nconst c = 3;", replace_all: false },
    c,
  );
  assert.equal(r.output.replacements, 1);

  const updated = await fs.readFile(file, "utf8");
  assert.match(updated, /const b = 20;\r\n/, "edit landed");
  assert.ok(!/[^\r]\n/.test(updated.replace(/^\n/, "")), "CRLF endings preserved");
});

test("Edit: trailing-whitespace drift falls back to fuzzy line match", async () => {
  const tmp = await makeTmp();
  const file = path.join(tmp, "ws.ts");
  // File has trailing spaces the model will not reproduce.
  await fs.writeFile(file, "function f() {  \n  return 1;   \n}\n", "utf8");
  const c = ctx(tmp);
  await ReadTool.call({ file_path: file }, c);

  const r = await EditTool.call(
    { file_path: file, old_string: "function f() {\n  return 1;\n}", new_string: "function f() {\n  return 2;\n}", replace_all: false },
    c,
  );
  assert.equal(r.output.replacements, 1);
  assert.equal(r.output.matchedBy, "whitespace");
  const updated = await fs.readFile(file, "utf8");
  assert.match(updated, /return 2;/);
});

test("Edit: non-unique old_string still refuses without replace_all", async () => {
  const tmp = await makeTmp();
  const file = path.join(tmp, "dup.ts");
  await fs.writeFile(file, "x = 1;\nx = 1;\n", "utf8");
  const c = ctx(tmp);
  await ReadTool.call({ file_path: file }, c);
  await assert.rejects(
    EditTool.call({ file_path: file, old_string: "x = 1;", new_string: "x = 2;", replace_all: false }, c),
    /not unique/,
  );
});

test("Edit: a genuinely missing old_string errors with re-read guidance", async () => {
  const tmp = await makeTmp();
  const file = path.join(tmp, "missing.ts");
  await fs.writeFile(file, "real content\n", "utf8");
  const c = ctx(tmp);
  await ReadTool.call({ file_path: file }, c);
  await assert.rejects(
    EditTool.call({ file_path: file, old_string: "hallucinated content", new_string: "whatever", replace_all: false }, c),
    /not found .*Re-Read/s,
  );
});

// ─── Read: CRLF-clean lines ────────────────────────────────────────────

test("Read: CRLF files present clean lines (no trailing \\r fed to the model)", async () => {
  const tmp = await makeTmp();
  const file = path.join(tmp, "crlf.txt");
  await fs.writeFile(file, "alpha\r\nbeta\r\n", "utf8");
  const c = ctx(tmp);
  const r = await ReadTool.call({ file_path: file }, c);
  assert.ok(!r.output.content.includes("\r"), "no carriage returns in Read output");
  assert.match(r.output.content, /1\talpha\n/);
});

// ─── The amnesia-spiral fix ────────────────────────────────────────────

test("collectTrimmedFilePaths: extracts file paths from dropped tool_use blocks", () => {
  const dropped = [
    {
      id: "m1",
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "src/app.ts" } },
        { type: "tool_use", id: "t2", name: "Grep", input: { pattern: "x", path: "src" } },
      ],
      createdAt: new Date().toISOString(),
    },
  ];
  const paths = collectTrimmedFilePaths(dropped);
  assert.ok(paths.includes("src/app.ts"));
  assert.ok(paths.includes("src"));
});

test("engine: history trim fires onHistoryTrimmed with the dropped span", async () => {
  const provider = {
    name: "capture",
    async *stream() {
      yield {
        type: "message_done",
        message: { id: "a", role: "assistant", content: [{ type: "text", text: "ok" }], createdAt: new Date().toISOString() },
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: "end_turn",
      };
    },
  };
  const workspace = mkdtempSync(path.join(os.tmpdir(), "ares-trim-"));
  const oldMessages = [
    {
      id: "m_read",
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "site/index.html" } }],
      createdAt: new Date().toISOString(),
    },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `m_pad_${i}`,
      role: i % 2 ? "assistant" : "user",
      content: [{ type: "text", text: "x".repeat(20_000) }],
      createdAt: new Date().toISOString(),
    })),
  ];

  const trimmedSpans = [];
  const session = new Session({
    workspace,
    provider,
    model: "m",
    systemPrompt: "s",
    tools: [],
    initialMessages: oldMessages,
    contextBudgetTokens: 10_000, // force a trim
    onHistoryTrimmed: (dropped) => trimmedSpans.push(dropped),
  });
  for await (const _e of session.send("continue")) void _e;

  assert.ok(trimmedSpans.length > 0, "onHistoryTrimmed fired");
  const allPaths = trimmedSpans.flatMap((span) => collectTrimmedFilePaths(span));
  assert.ok(allPaths.includes("site/index.html"), "the dropped Read's file path is recoverable");
});

// ─── Stream-stall watchdog ─────────────────────────────────────────────

test("stallGuard: aborts after the stall window and reports stalled()", async () => {
  const guard = createStallGuard(undefined, 40);
  assert.equal(guard.stalled(), false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(guard.stalled(), true, "watchdog fired");
  assert.equal(guard.signal.aborted, true, "fetch signal aborted");
  guard.dispose();
});

test("stallGuard: reset() pushes the deadline; caller abort is not a stall", async () => {
  const guard = createStallGuard(undefined, 60);
  await new Promise((r) => setTimeout(r, 35));
  guard.reset();
  await new Promise((r) => setTimeout(r, 35));
  guard.reset();
  assert.equal(guard.stalled(), false, "kept alive by traffic");
  guard.dispose();

  const outer = new AbortController();
  const g2 = createStallGuard(outer.signal, 5_000);
  outer.abort();
  assert.equal(g2.signal.aborted, true, "outer abort propagates");
  assert.equal(g2.stalled(), false, "user abort is not a stall");
  g2.dispose();
});
