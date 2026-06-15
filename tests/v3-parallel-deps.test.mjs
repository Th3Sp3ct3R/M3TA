// T1 OP-upgrade: dependency-aware parallel batching.
//
// Proves three things:
//   1. Disjoint writes parallelize (3× Edit different files → 1 batch).
//   2. Same-file write-then-read serializes (Edit(a) + Read(a) → 2 batches).
//   3. Shell/solo tools never share a batch (Bash + Read → 2 batches).

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { __internal } from "../packages/core/dist/queryEngine.js";

const { buildDepAwareBatches, analyzeToolDeps, normalizeToolInput, resolveEngineTool } = __internal;
const WORKSPACE = path.resolve("/tmp/dep-batches");

function mkTool(name, { safety, concurrency }) {
  return {
    schema: {
      name,
      description: name,
      inputJsonSchema: { type: "object" },
      safety,
      concurrency,
    },
    call: async () => ({ output: null }),
  };
}

function use(id, name, input, opts) {
  return { id, name, input, tool: mkTool(name, opts) };
}

const readTool = { safety: "read-only", concurrency: "parallel-safe" };
const editTool = { safety: "workspace-write", concurrency: "exclusive" };
const writeTool = { safety: "workspace-write", concurrency: "exclusive" };
const bashTool = { safety: "external-state", concurrency: "exclusive" };

test("T1-OP: three Edits to disjoint files batch in parallel", () => {
  const uses = [
    use("u1", "Edit", { file_path: "src/a.ts" }, editTool),
    use("u2", "Edit", { file_path: "src/b.ts" }, editTool),
    use("u3", "Edit", { file_path: "src/c.ts" }, editTool),
  ];
  const batches = buildDepAwareBatches(uses, WORKSPACE);
  assert.equal(batches.length, 1, "expected one parallel batch for disjoint writes");
  assert.equal(batches[0].length, 3);
});

test("T1-OP: Edit(a) + Read(a) serializes — write before read on same file", () => {
  const uses = [
    use("u1", "Edit", { file_path: "src/a.ts" }, editTool),
    use("u2", "Read", { file_path: "src/a.ts" }, readTool),
  ];
  const batches = buildDepAwareBatches(uses, WORKSPACE);
  assert.equal(batches.length, 2);
  assert.equal(batches[0][0].id, "u1");
  assert.equal(batches[1][0].id, "u2");
});

test("T1-OP: Read(a) + Read(a) batches — concurrent reads never conflict", () => {
  const uses = [
    use("u1", "Read", { file_path: "src/a.ts" }, readTool),
    use("u2", "Read", { file_path: "src/a.ts" }, readTool),
  ];
  const batches = buildDepAwareBatches(uses, WORKSPACE);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
});

test("T1-OP: Bash + anything → solo batch (unknowable side effects)", () => {
  const uses = [
    use("u1", "Read", { file_path: "src/a.ts" }, readTool),
    use("u2", "Bash", { command: "echo hi" }, bashTool),
    use("u3", "Read", { file_path: "src/b.ts" }, readTool),
  ];
  const batches = buildDepAwareBatches(uses, WORKSPACE);
  assert.equal(batches.length, 3, "bash must be alone, separating the reads");
  assert.equal(batches[1][0].id, "u2");
  assert.equal(batches[1].length, 1);
});

test("T1-OP: Edit(a) + Read(b) parallelize — disjoint targets are race-free", () => {
  const uses = [
    use("u1", "Edit", { file_path: "src/a.ts" }, editTool),
    use("u2", "Read", { file_path: "src/b.ts" }, readTool),
  ];
  const batches = buildDepAwareBatches(uses, WORKSPACE);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
});

test("T1-OP: Edit(a) + Edit(a) serializes — write-write same file conflicts", () => {
  const uses = [
    use("u1", "Edit", { file_path: "src/a.ts" }, editTool),
    use("u2", "Edit", { file_path: "src/a.ts" }, editTool),
  ];
  const batches = buildDepAwareBatches(uses, WORKSPACE);
  assert.equal(batches.length, 2);
});

test("T1-OP: file paths resolve against workspace (relative vs absolute equivalence)", () => {
  const abs = path.resolve(WORKSPACE, "src/a.ts");
  const a = analyzeToolDeps(use("u1", "Edit", { file_path: "src/a.ts" }, editTool), WORKSPACE);
  const b = analyzeToolDeps(use("u2", "Edit", { file_path: abs }, editTool), WORKSPACE);
  assert.equal(a.target, abs);
  assert.equal(b.target, abs);
  assert.equal(a.isWrite, true);
});

test("T1-OP: Write tool participates same as Edit", () => {
  const uses = [
    use("u1", "Write", { file_path: "src/x.ts" }, writeTool),
    use("u2", "Write", { file_path: "src/y.ts" }, writeTool),
  ];
  const batches = buildDepAwareBatches(uses, WORKSPACE);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
});

test("tool compatibility: resolves common provider naming variants", () => {
  const tools = [
    mkTool("Read", readTool),
    mkTool("WebSearch", readTool),
  ];
  assert.equal(resolveEngineTool(tools, "read_file")?.schema.name, "Read");
  assert.equal(resolveEngineTool(tools, "functions.Read:0")?.schema.name, "Read");
  assert.equal(resolveEngineTool(tools, "web_search_tool")?.schema.name, "WebSearch");
});

test("tool compatibility: normalizes high-confidence argument aliases", () => {
  assert.deepEqual(normalizeToolInput("Read", { path: "src/a.ts" }), { path: "src/a.ts", file_path: "src/a.ts" });
  assert.deepEqual(
    normalizeToolInput("Edit", { path: "src/a.ts", old_text: "a", new_text: "b" }),
    { path: "src/a.ts", old_text: "a", new_text: "b", file_path: "src/a.ts", old_string: "a", new_string: "b" },
  );
  assert.deepEqual(normalizeToolInput("PowerShell", { cmd: "pnpm test" }), { cmd: "pnpm test", command: "pnpm test" });
});
