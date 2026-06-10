// Verifies V4 — One memory, semantic seeds (embeddings inside living memory):
//   1. The acceptance: cue "auth flow" surfaces a "login handler" memory with
//      ZERO token overlap when an embedder is attached (semantic seeding).
//   2. No embedder (or an empty index) → byte-identical classic lexical recall.
//   3. A corrupt .vec.jsonl line is skipped, valid lines still load.
//   4. staleIds() detects content edits via the 8-hex sha256 content hash.
//   5. A hung embedder degrades to lexical within the cue timeout — recall
//      never blocks a turn on embedding latency.
//   6. reindex() embeds every node and persists the sidecar (rounded floats).
//   7. v4 vector-store migration is idempotent by content hash.

import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MemoryStore,
  EmbedIndex,
  cosine,
  contentHash,
  recall,
  migrateLegacyVectors,
} from "../packages/mind/dist/index.js";

async function makeDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "ares-recall-"));
}

// Deterministic fake embedder: known words map to fixed 3-d anchors and a text
// embeds as the mean of its anchored words. "auth flow" and "login handler"
// land in the same region; "banana bread" lands far away.
const ANCHORS = new Map([
  ["auth", [1, 0, 0]],
  ["flow", [0.9, 0.1, 0]],
  ["login", [0.95, 0.05, 0]],
  ["handler", [0.9, 0, 0.1]],
  ["session", [0.85, 0.05, 0.1]],
  ["cookie", [0.8, 0, 0.2]],
  ["banana", [0, 1, 0]],
  ["bread", [0, 0.9, 0.1]],
  ["recipe", [0, 0.85, 0.15]],
  ["grandma", [0, 0.8, 0.2]],
]);

function fakeVec(text) {
  const sum = [0, 0, 0];
  let hits = 0;
  for (const token of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const anchor = ANCHORS.get(token);
    if (!anchor) continue;
    for (let i = 0; i < 3; i++) sum[i] += anchor[i];
    hits++;
  }
  return hits === 0 ? [0, 0, 1] : sum.map((x) => x / hits);
}

const fakeEmbedder = { embed: async (texts) => texts.map(fakeVec) };

// ── 1. the acceptance: zero-token-overlap paraphrase surfaces ────────────────

test("recall: 'auth flow' surfaces a 'login handler' memory with zero token overlap", async () => {
  const dir = await makeDir();
  const memFile = path.join(dir, "memory.jsonl");
  const store = await MemoryStore.open(memFile);
  const login = await store.add({
    kind: "procedural",
    content: "The login handler validates the session cookie before redirecting",
  });
  const banana = await store.add({
    kind: "episodic",
    content: "Baked banana bread from grandma's recipe",
  });

  // Lexically the cue shares zero tokens with either memory — classic recall is blind here.
  const lexical = await store.remember("auth flow");
  assert.equal(lexical.length, 0, "without vectors a zero-overlap memory cannot surface");

  const index = await EmbedIndex.open(memFile + ".vec.jsonl");
  store.attachEmbedder(fakeEmbedder, index);
  await store.reindex();

  const results = await store.remember("auth flow");
  assert.ok(results.some((r) => r.node.id === login.id), "the paraphrase surfaced as a semantic seed");
  assert.equal(results[0].node.id, login.id, "and it ranks first");
  const bananaHit = results.find((r) => r.node.id === banana.id);
  if (bananaHit) {
    assert.ok(results[0].score > bananaHit.score * 5, "the unrelated memory scores far below");
  }

  await fs.rm(dir, { recursive: true, force: true });
});

// ── 2. no embedder → classic behavior ────────────────────────────────────────

test("recall: classic lexical behavior is unchanged without vectors", async () => {
  const dir = await makeDir();
  const store = MemoryStore.memory();
  const ts = await store.add({ kind: "semantic", content: "The user prefers TypeScript for the Ares harness" });
  await store.add({ kind: "episodic", content: "Cooked pasta for dinner" });

  // recall() with the vectors option absent is byte-identical to the old signature.
  const now = new Date();
  const a = recall("typescript preference", store.all(), { now });
  const b = recall("typescript preference", store.all(), { vectors: undefined, now });
  assert.deepEqual(a, b);
  assert.equal(a[0].node.id, ts.id);

  // Attaching an embedder over an EMPTY index changes nothing — and the
  // embedder is never even consulted (no vectors → nothing to blend against).
  const index = await EmbedIndex.open(path.join(dir, "empty.vec.jsonl"));
  const mustNotRun = { embed: async () => { throw new Error("embedder must not be called with an empty index"); } };
  store.attachEmbedder(mustNotRun, index);
  const results = await store.remember("typescript preference");
  assert.equal(results.length, 1);
  assert.equal(results[0].node.id, ts.id);

  await fs.rm(dir, { recursive: true, force: true });
});

// ── 3. corrupt sidecar lines are skipped ─────────────────────────────────────

test("embed index: corrupt .vec.jsonl lines are skipped, valid lines load", async () => {
  const dir = await makeDir();
  const file = path.join(dir, "memory.jsonl.vec.jsonl");
  await fs.writeFile(
    file,
    [
      JSON.stringify({ id: "mem_good", v: [0.1, 0.2, 0.3], h: contentHash("hello") }),
      "{ not json at all",
      JSON.stringify({ id: "mem_badv", v: "nope", h: "deadbeef" }),
      JSON.stringify({ v: [1, 2], h: "deadbeef" }), // missing id
      JSON.stringify({ id: "mem_nan", v: [1, null], h: "deadbeef" }), // non-finite component
      JSON.stringify({ id: "mem_empty", v: [], h: "deadbeef" }), // empty vector
      "",
    ].join("\n") + "\n",
    "utf8",
  );

  const index = await EmbedIndex.open(file);
  assert.equal(index.size, 1, "only the valid line loaded");
  const v = index.get("mem_good");
  assert.ok(v instanceof Float32Array);
  assert.ok(Math.abs(v[1] - 0.2) < 1e-6);
  assert.equal(index.get("mem_badv"), undefined);
  assert.equal(index.get("mem_nan"), undefined);

  // cosine sanity on the exported helper
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosine([0, 0], [1, 1]), 0, "zero vector compares as 0, never NaN");

  await fs.rm(dir, { recursive: true, force: true });
});

// ── 4. staleIds keys on the content hash ─────────────────────────────────────

test("embed index: staleIds flags missing and content-edited nodes via hash", async () => {
  const dir = await makeDir();
  const index = await EmbedIndex.open(path.join(dir, "x.vec.jsonl"));
  index.upsert("a", contentHash("old content"), [1, 0]);

  assert.deepEqual(index.staleIds([{ id: "a", content: "old content" }]), [], "matching hash is fresh");
  assert.deepEqual(
    index.staleIds([
      { id: "a", content: "old content" },
      { id: "b", content: "never embedded" },
    ]),
    ["b"],
    "a missing id is stale",
  );
  assert.deepEqual(
    index.staleIds([{ id: "a", content: "EDITED content" }]),
    ["a"],
    "an edited node's hash no longer matches",
  );

  await fs.rm(dir, { recursive: true, force: true });
});

// ── 5. hung embedder → lexical within the timeout ────────────────────────────

test("recall: a hung embedder degrades to lexical results, never blocks", async () => {
  const dir = await makeDir();
  const memFile = path.join(dir, "memory.jsonl");
  const store = await MemoryStore.open(memFile);
  const lexicalHit = await store.add({ kind: "semantic", content: "auth flow diagram lives in docs" });
  const paraphrase = await store.add({ kind: "procedural", content: "The login handler validates the session cookie" });

  const index = await EmbedIndex.open(memFile + ".vec.jsonl");
  store.attachEmbedder(fakeEmbedder, index);
  await store.reindex();

  // Swap in an embedder that never resolves — the cue embed must time out.
  store.attachEmbedder({ embed: () => new Promise(() => {}) }, index);

  const started = Date.now();
  const results = await store.remember("auth flow");
  assert.ok(Date.now() - started < 5_000, "recall returned promptly despite the hung embedder");
  assert.ok(results.some((r) => r.node.id === lexicalHit.id), "the lexical seed still surfaces");
  assert.ok(
    !results.some((r) => r.node.id === paraphrase.id),
    "the vector-only seed cannot surface without a cue vector",
  );

  await fs.rm(dir, { recursive: true, force: true });
});

// ── 6. reindex embeds everything and persists the sidecar ────────────────────

test("embed index: reindex() embeds every node and persists the sidecar", async () => {
  const dir = await makeDir();
  const memFile = path.join(dir, "memory.jsonl");
  const store = await MemoryStore.open(memFile);
  await store.add({ kind: "semantic", content: "The login handler validates the session cookie" });
  await store.add({ kind: "episodic", content: "Baked banana bread from grandma's recipe" });

  const vecFile = memFile + ".vec.jsonl";
  const index = await EmbedIndex.open(vecFile);
  store.attachEmbedder(fakeEmbedder, index);
  await store.reindex();

  assert.equal(index.staleIds(store.all()).length, 0, "nothing is stale after reindex");

  const reopened = await EmbedIndex.open(vecFile);
  assert.equal(reopened.size, store.count(), "one persisted vector per node");
  for (const node of store.all()) {
    assert.ok(reopened.get(node.id) instanceof Float32Array, `vector persisted for ${node.id}`);
  }

  // Persisted components are rounded to 5 decimals — no float-noise bloat.
  const raw = await fs.readFile(vecFile, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    for (const x of row.v) {
      assert.ok(Number.isFinite(x));
      assert.ok(Math.abs(x - Math.round(x * 1e5) / 1e5) < 1e-12, "component rounded to 5 decimals");
    }
  }

  await fs.rm(dir, { recursive: true, force: true });
});

// ── 7. v4 vector-store migration is idempotent ───────────────────────────────

test("migration: v4 vectors.json rows land once as tagged semantic memories", async () => {
  const dir = await makeDir();
  const legacy = path.join(dir, "vectors.json");
  await fs.writeFile(
    legacy,
    JSON.stringify({
      version: 1,
      memories: [
        {
          id: 1, category: "PROJECT", workspace: null,
          content: "Ares ships a Tauri desktop app", source: "manual",
          score: 2, hits: 3, contradicts: 0,
          embeddingModel: "lexical", embeddingDim: 16, embedding: [0.1, 0.2],
          createdAt: 1700000000000, updatedAt: 1700000000000, promotedToSoul: false,
        },
        {
          id: 2, category: "USER", workspace: null,
          content: "The owner prefers pnpm over npm", source: "manual",
          score: 1, hits: 0, contradicts: 0,
          embeddingModel: "lexical", embeddingDim: 16, embedding: [0.3],
          createdAt: 1700000001000, updatedAt: 1700000001000, promotedToSoul: false,
        },
        { id: 3, category: "PROJECT", content: "" }, // empty content → skipped
      ],
    }, null, 2) + "\n",
    "utf8",
  );

  const store = MemoryStore.memory();
  const first = await migrateLegacyVectors({ legacyDbJsonPath: legacy, store });
  assert.equal(first.scanned, 3);
  assert.equal(first.migrated, 2);
  assert.equal(store.count(), 2);

  const node = store.all().find((n) => /Tauri desktop/.test(n.content));
  assert.ok(node, "the legacy row became a living memory");
  assert.equal(node.kind, "semantic");
  assert.ok(node.tags?.includes("v4-vector-store"), "provenance tag attached");

  const second = await migrateLegacyVectors({ legacyDbJsonPath: legacy, store });
  assert.equal(second.migrated, 0, "re-running migrates nothing");
  assert.equal(store.count(), 2, "no duplicates");

  // A missing legacy file is a clean no-op, not a crash.
  const missing = await migrateLegacyVectors({ legacyDbJsonPath: path.join(dir, "nope.json"), store });
  assert.equal(missing.scanned, 0);
  assert.equal(missing.migrated, 0);

  await fs.rm(dir, { recursive: true, force: true });
});
