// C0 — the tool-input validation gate (feat/core-consolidation, coding-win track).
//
// adaptToolForEngine now runs two stages BEFORE the tool executes:
//   stage 1 (shape):    zod safeParse (lenient on extra keys) -> <tool_use_error> on type/required errors
//   stage 2 (semantic): optional tool.validateInput()         -> <tool_use_error> on ok:false
// Both surface as a recognizable, correctable envelope instead of an opaque throw, and an
// invalid call never reaches checkPermissions/call. This is the "tool calls fail / bad at
// editing" fix: the model fixes the CALL next turn instead of dead-looping a broken one.
//
// Note: we use a tiny fake `inputZod` (only `.safeParse` is consumed by
// parseToolInputLenient) so the test needs no zod dependency at the repo root. The
// lenient extra-key stripping is already covered against the real ReadTool in m1-tools.

import test from "node:test";
import assert from "node:assert/strict";
import { adaptToolForEngine, EditTool } from "../packages/tools/dist/index.js";

const passSchema = { safeParse: (x) => ({ success: true, data: x }) };
const failSchema = {
  safeParse: () => ({
    success: false,
    error: { issues: [{ code: "invalid_type", path: ["id"], message: "Required" }] },
  }),
};

function makeGateTool(inputZod) {
  const state = { called: 0, permissionChecked: 0 };
  const tool = {
    schema: {
      name: "Gate",
      description: "test gate tool",
      inputJsonSchema: { type: "object", properties: { id: { type: "string" } } },
      safety: "read-only",
      concurrency: "parallel-safe",
    },
    inputZod,
    async validateInput(input) {
      if (input.bad) return { ok: false, message: `id "${input.id}" rejected: bad=true` };
      return { ok: true };
    },
    async checkPermissions() {
      state.permissionChecked += 1;
      return { kind: "allow" };
    },
    async call(input) {
      state.called += 1;
      return { output: `ran:${input.id}` };
    },
    activityDescription() {
      return "gate";
    },
  };
  return { tool, state };
}

const baseCtx = () => ({
  workspace: ".",
  signal: new AbortController().signal,
  permissionMode: "workspace-write",
  fileReadStamps: new Map(),
});

test("gate: valid input passes both stages and the tool runs", async () => {
  const { tool, state } = makeGateTool(passSchema);
  const adapted = adaptToolForEngine(tool, (b) => b);
  const r = await adapted.call({ id: "a" }, baseCtx());
  assert.equal(r.output, "ran:a");
  assert.equal(state.called, 1);
});

test("gate: semantic validateInput ok:false -> <tool_use_error>, and call() never runs", async () => {
  const { tool, state } = makeGateTool(passSchema);
  const adapted = adaptToolForEngine(tool, (b) => b);
  await assert.rejects(
    () => adapted.call({ id: "b", bad: true }, baseCtx()),
    (err) => {
      assert.match(err.message, /<tool_use_error>.*rejected: bad=true.*<\/tool_use_error>/s);
      return true;
    },
  );
  // Invalid call short-circuits before permission + execution.
  assert.equal(state.called, 0);
  assert.equal(state.permissionChecked, 0);
});

test("gate: malformed input (shape parse failure) -> <tool_use_error>, and call() never runs", async () => {
  const { tool, state } = makeGateTool(failSchema);
  const adapted = adaptToolForEngine(tool, (b) => b);
  await assert.rejects(
    () => adapted.call({}, baseCtx()),
    (err) => {
      assert.match(err.message, /<tool_use_error>/);
      assert.match(err.message, /id/); // field-level detail preserved inside the envelope
      return true;
    },
  );
  assert.equal(state.called, 0);
});

test("gate: the REAL Edit tool's validateInput rejects an empty old_string before execution", async () => {
  const adapted = adaptToolForEngine(EditTool, (b) => b);
  await assert.rejects(
    () => adapted.call({ file_path: "x.ts", old_string: "", new_string: "y" }, baseCtx()),
    (err) => {
      assert.match(err.message, /<tool_use_error>/);
      assert.match(err.message, /old_string is empty/);
      return true;
    },
  );
});
