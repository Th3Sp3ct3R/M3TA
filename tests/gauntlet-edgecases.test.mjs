// The gauntlet — CC's decade of edge-case mileage, converted into tests.
// Hostile inputs against the REAL tools: exotic encodings, huge files,
// pathological lines, unicode paths, stale edits. Every case here is a bug
// class a mature harness has already survived; failing any of them silently
// is how files get corrupted in the wild.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ReadTool, EditTool, WriteTool, GrepTool, GlobTool } from "../packages/tools/dist/index.js";

async function makeTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ares-gauntlet-"));
}

function ctx(workspace) {
  return {
    workspace,
    signal: new AbortController().signal,
    permissionMode: "workspace-write",
    fileReadStamps: new Map(),
  };
}

async function seedAndRead(c, file, content, encoding = "utf8") {
  await fs.writeFile(file, content, encoding);
  await ReadTool.call({ file_path: file }, c);
}

// ─── encodings ──────────────────────────────────────────────────────────

test("gauntlet: CRLF file edited without converting line endings", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const file = path.join(ws, "crlf.txt");
  await seedAndRead(c, file, "alpha\r\nbeta\r\ngamma\r\n");
  await EditTool.call({ file_path: file, old_string: "beta", new_string: "delta" }, c);
  const bytes = await fs.readFile(file, "utf8");
  assert.equal(bytes, "alpha\r\ndelta\r\ngamma\r\n", "CRLF endings must survive byte-for-byte");
});

test("gauntlet: BOM survives an edit", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const file = path.join(ws, "bom.ini");
  await seedAndRead(c, file, "﻿name=alpha\n");
  await EditTool.call({ file_path: file, old_string: "alpha", new_string: "beta" }, c);
  const bytes = await fs.readFile(file, "utf8");
  assert.equal(bytes, "﻿name=beta\n", "the BOM must not be dropped");
});

test("gauntlet: editing a UTF-16 file either works or fails loudly — never corrupts", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const file = path.join(ws, "wide.txt");
  const original = Buffer.from("﻿hello wide world\n", "utf16le");
  await fs.writeFile(file, original);
  await ReadTool.call({ file_path: file }, c).catch(() => undefined);
  const before = await fs.readFile(file);
  const result = await EditTool.call({ file_path: file, old_string: "hello", new_string: "goodbye" }, c).catch((e) => ({ failed: e.message }));
  if (result && result.failed) {
    const after = await fs.readFile(file);
    assert.ok(before.equals(after), "a failed edit must leave the file byte-identical");
  } else {
    // If the edit claims success the content must actually say goodbye when
    // decoded the same way it was written.
    const after = await fs.readFile(file);
    assert.ok(after.toString("utf16le").includes("goodbye") || after.toString("utf8").includes("goodbye"), "claimed success must be real");
  }
});

// ─── scale ──────────────────────────────────────────────────────────────

test("gauntlet: Read of a 10MB file is bounded, not a context bomb", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const file = path.join(ws, "huge.log");
  const line = "x".repeat(99) + "\n";
  await fs.writeFile(file, line.repeat(100_000)); // ~10MB
  const res = await ReadTool.call({ file_path: file }, c).catch((e) => ({ failed: e.message }));
  if (res && res.failed) {
    assert.match(res.failed, /large|big|limit|size/i, "a refusal must explain the size problem");
  } else {
    const text = typeof res.output === "string" ? res.output : JSON.stringify(res.output);
    assert.ok(text.length < 600_000, `Read returned ${text.length} chars from a 10MB file — unbounded`);
  }
});

test("gauntlet: a single 500KB line cannot flood the output", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const file = path.join(ws, "oneline.min.js");
  await fs.writeFile(file, "var a=1;".repeat(64_000)); // ~512KB, one line
  const res = await ReadTool.call({ file_path: file }, c).catch((e) => ({ failed: e.message }));
  if (!res.failed) {
    const text = typeof res.output === "string" ? res.output : JSON.stringify(res.output);
    assert.ok(text.length < 20_000, `single-line read returned ${text.length} chars — line truncation missing`);
    assert.ok(text.includes("[line truncated"), "the truncation must be announced, not silent");
  }
});

test("gauntlet: Grep across a dir containing a huge file completes and matches", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  await fs.writeFile(path.join(ws, "big.txt"), ("filler\n").repeat(200_000));
  await fs.writeFile(path.join(ws, "needle.txt"), "the NEEDLE_MARKER is here\n");
  // output_mode's zod default is applied by the engine's validation layer;
  // direct .call bypasses it, so pass what the engine would.
  const res = await GrepTool.call({ pattern: "NEEDLE_MARKER", path: ws, output_mode: "files_with_matches", case_insensitive: false, max_results: 200, context_before: 0, context_after: 0 }, c);
  const text = typeof res.output === "string" ? res.output : JSON.stringify(res.output);
  assert.ok(text.includes("needle.txt"), `must find the needle beside the haystack, got: ${text.slice(0, 200)}`);
});

// ─── paths ──────────────────────────────────────────────────────────────

test("gauntlet: write + edit + glob through a unicode-and-spaces path", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const dir = path.join(ws, "méé docs 🗂");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "notes für später.txt");
  await WriteTool.call({ file_path: file, content: "v=1\n" }, c);
  await ReadTool.call({ file_path: file }, c);
  await EditTool.call({ file_path: file, old_string: "v=1", new_string: "v=2" }, c);
  assert.equal(await fs.readFile(file, "utf8"), "v=2\n");
  const found = await GlobTool.call({ pattern: "**/*.txt", path: ws }, c);
  const text = typeof found.output === "string" ? found.output : JSON.stringify(found.output);
  assert.ok(text.includes("später"), "glob must surface the unicode filename");
});

// ─── staleness / binary ─────────────────────────────────────────────────

test("gauntlet: an edit against externally-changed content fails with a helpful error, file intact", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const file = path.join(ws, "shared.txt");
  await seedAndRead(c, file, "state = 'one'\n");
  // Another process rewrites the file after our read.
  await fs.writeFile(file, "state = 'two'\n", "utf8");
  const res = await EditTool.call({ file_path: file, old_string: "state = 'one'", new_string: "state = 'three'" }, c).catch((e) => ({ failed: e.message }));
  assert.ok(res.failed, "stale edit must not silently land");
  assert.match(res.failed, /not found|changed|re-?read/i, `error should steer recovery, got: ${res.failed}`);
  assert.equal(await fs.readFile(file, "utf8"), "state = 'two'\n", "file untouched after the refused edit");
});

test("gauntlet: reading a binary file does not dump raw bytes into context", async () => {
  const ws = await makeTmp();
  const c = ctx(ws);
  const file = path.join(ws, "blob.bin");
  const bytes = Buffer.alloc(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  await fs.writeFile(file, bytes);
  const res = await ReadTool.call({ file_path: file }, c).catch((e) => ({ failed: e.message }));
  if (!res.failed) {
    const text = typeof res.output === "string" ? res.output : JSON.stringify(res.output);
    const controlChars = (text.match(/[\x00-\x08\x0E-\x1F]/g) ?? []).length;
    assert.ok(controlChars < 100, `binary read leaked ${controlChars} control chars — needs binary detection`);
  }
});
