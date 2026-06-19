// C4 — MultiEdit: atomic batched edits on the Edit tool (ultra-coding Phase 2).
//
// The Edit tool gains an `edits[]` batch mode applied ATOMICALLY in order to one
// file: all hunks resolve against an in-memory working copy and the file is
// written ONCE, only if every hunk matched. A failing hunk leaves the file
// untouched — killing the classic "edit 2's text is gone after edit 1" half-apply.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReadTool, EditTool } from "../packages/tools/dist/index.js";

function ctx(workspace) {
  return { workspace, signal: new AbortController().signal, permissionMode: "workspace-write", fileReadStamps: new Map() };
}
async function tmpFile(contents) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ares-multiedit-"));
  const file = path.join(dir, "f.txt");
  await fs.writeFile(file, contents, "utf8");
  return file;
}

test("MultiEdit: single-edit mode still works (backward compatible)", async () => {
  const c = ctx(os.tmpdir());
  const file = await tmpFile("alpha\nbeta\ngamma\n");
  await ReadTool.call({ file_path: file }, c);
  const r = await EditTool.call({ file_path: file, old_string: "beta", new_string: "BETA" }, c);
  assert.equal(r.output.replacements, 1);
  assert.equal(await fs.readFile(file, "utf8"), "alpha\nBETA\ngamma\n");
});

test("MultiEdit: a batch applies all hunks atomically and in order", async () => {
  const c = ctx(os.tmpdir());
  const file = await tmpFile("one\ntwo\nthree\n");
  await ReadTool.call({ file_path: file }, c);
  const r = await EditTool.call({
    file_path: file,
    edits: [
      { old_string: "one", new_string: "1" },
      { old_string: "two", new_string: "2" },
      { old_string: "three", new_string: "3" },
    ],
  }, c);
  assert.equal(r.output.replacements, 3);
  assert.equal(await fs.readFile(file, "utf8"), "1\n2\n3\n");
});

test("MultiEdit: dependent hunks apply sequentially (hunk 2 sees hunk 1's result)", async () => {
  const c = ctx(os.tmpdir());
  const file = await tmpFile("const x = 1;\n");
  await ReadTool.call({ file_path: file }, c);
  const r = await EditTool.call({
    file_path: file,
    edits: [
      { old_string: "const x = 1;", new_string: "const y = 2;" },
      { old_string: "const y = 2;", new_string: "const y = 42;" }, // targets hunk 1's output
    ],
  }, c);
  assert.equal(r.output.replacements, 2);
  assert.equal(await fs.readFile(file, "utf8"), "const y = 42;\n");
});

test("MultiEdit: all-or-nothing — a failing hunk leaves the file UNCHANGED", async () => {
  const c = ctx(os.tmpdir());
  const original = "keep\nalso\n";
  const file = await tmpFile(original);
  await ReadTool.call({ file_path: file }, c);
  await assert.rejects(
    () => EditTool.call({
      file_path: file,
      edits: [
        { old_string: "keep", new_string: "KEPT" },         // would succeed
        { old_string: "NOT_PRESENT", new_string: "x" },      // fails -> abort whole batch
      ],
    }, c),
    (err) => {
      assert.match(err.message, /<tool_use_error>/);
      assert.match(err.message, /edit 2 of 2/);
      assert.match(err.message, /all-or-nothing/);
      return true;
    },
  );
  // The first hunk must NOT have been written — the file is byte-identical.
  assert.equal(await fs.readFile(file, "utf8"), original);
});

test("MultiEdit: validateInput rejects an empty/no-op hunk with its index", async () => {
  const empty = await EditTool.validateInput({ file_path: "f.txt", edits: [{ old_string: "a", new_string: "b" }, { old_string: "", new_string: "x" }] });
  assert.equal(empty.ok, false);
  assert.match(empty.message, /empty.*edit 2/s);

  const noop = await EditTool.validateInput({ file_path: "f.txt", edits: [{ old_string: "same", new_string: "same" }] });
  assert.equal(noop.ok, false);
  assert.match(noop.message, /identical/);

  const ok = await EditTool.validateInput({ file_path: "f.txt", edits: [{ old_string: "a", new_string: "b" }] });
  assert.equal(ok.ok, true);
});
