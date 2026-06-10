// Semantic seeds for living memory (ARES V4) — a dependency-light sidecar
// vector index.
//
// Vectors never live in memory.jsonl: they're derived data, regenerable from
// content, and an embedding-model swap must never risk the memories themselves.
// The sidecar ("<memory file>.vec.jsonl") holds one line per node:
//   {id, v: [floats rounded to 5 decimals], h: "8-hex sha256 of content"}
// The hash makes staleness exact — edit a memory's content and its vector is
// stale, no timestamps or bookkeeping. Corrupt lines are skipped on load, the
// same tolerance philosophy memory.jsonl follows: a half-written line costs one
// vector (regenerated on the next reindex), never the index.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { writeFileAtomic } from "../io.js";

/** Anything that can turn texts into vectors. Injectable — tests use a fake. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** 8-hex sha256 of memory content — the staleness key for sidecar vectors. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 8);
}

/**
 * Cosine similarity in [-1, 1]; 0 when either vector is empty or all-zero
 * (never NaN). Compares the overlapping prefix if lengths differ — callers
 * that care about model-dimension mismatches should check lengths themselves
 * (recall() does).
 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

interface IndexEntry {
  hash: string;
  vector: Float32Array;
}

function parseRow(line: string): { id: string; entry: IndexEntry } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const row = parsed as { id?: unknown; v?: unknown; h?: unknown };
  if (typeof row.id !== "string" || row.id.length === 0) return undefined;
  if (typeof row.h !== "string" || row.h.length === 0) return undefined;
  if (!Array.isArray(row.v) || row.v.length === 0) return undefined;
  if (!row.v.every((x) => typeof x === "number" && Number.isFinite(x))) return undefined;
  return { id: row.id, entry: { hash: row.h, vector: Float32Array.from(row.v as number[]) } };
}

function round5(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1e5) / 1e5 : 0;
}

export class EmbedIndex {
  private dirty = false;

  private constructor(
    private readonly file: string,
    private readonly rows: Map<string, IndexEntry>,
  ) {}

  /** Open (or create) the sidecar at `file`. Corrupt lines are skipped. */
  static async open(file: string): Promise<EmbedIndex> {
    const rows = new Map<string, IndexEntry>();
    try {
      const raw = await fs.readFile(file, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = parseRow(trimmed);
        if (row) rows.set(row.id, row.entry);
      }
    } catch {
      // no sidecar yet
    }
    return new EmbedIndex(file, rows);
  }

  get size(): number {
    return this.rows.size;
  }

  ids(): string[] {
    return [...this.rows.keys()];
  }

  get(id: string): Float32Array | undefined {
    return this.rows.get(id)?.vector;
  }

  upsert(id: string, hash: string, vector: ArrayLike<number>): void {
    if (!id || vector.length === 0) return;
    this.rows.set(id, { hash, vector: Float32Array.from(vector, round5) });
    this.dirty = true;
  }

  remove(id: string): void {
    if (this.rows.delete(id)) this.dirty = true;
  }

  /** Ids whose vector is missing or whose content hash no longer matches. */
  staleIds(nodes: readonly { id: string; content: string }[]): string[] {
    const stale: string[] = [];
    for (const node of nodes) {
      const entry = this.rows.get(node.id);
      if (!entry || entry.hash !== contentHash(node.content)) stale.push(node.id);
    }
    return stale;
  }

  /** Atomic write of the sidecar; a no-op when nothing changed since the last persist. */
  async persist(): Promise<void> {
    if (!this.dirty || !this.file) return;
    const lines = [...this.rows].map(([id, e]) =>
      JSON.stringify({ id, v: [...e.vector].map(round5), h: e.hash }),
    );
    await writeFileAtomic(this.file, lines.length ? lines.join("\n") + "\n" : "");
    this.dirty = false;
  }
}

export interface OllamaEmbedderOptions {
  /** Ollama HTTP host. Default $OLLAMA_HOST or http://127.0.0.1:11434. */
  baseUrl?: string;
  /** Embedding model. Default "nomic-embed-text". */
  model?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Local embeddings via Ollama's POST /api/embed. Throws a clean, attributable
 * error when the host is unreachable or answers malformed — callers (the
 * store's lazy refresh, the cue timeout) decide whether that's fatal.
 */
export function ollamaEmbedder(opts: OllamaEmbedderOptions = {}): Embedder {
  const baseUrl = (opts.baseUrl ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
  const model = opts.model ?? "nomic-embed-text";
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, input: texts }),
        });
      } catch (err) {
        throw new Error(`ollama embedder unreachable at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`ollama embed failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
      }
      const data = (await res.json()) as { embeddings?: unknown };
      const embeddings = data.embeddings;
      if (
        !Array.isArray(embeddings) ||
        embeddings.length !== texts.length ||
        !embeddings.every((v) => Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x)))
      ) {
        throw new Error(`ollama embed returned a malformed response for ${texts.length} input(s)`);
      }
      return embeddings as number[][];
    },
  };
}
