// One memory (ARES V4): retire the v4 agent vector store by folding its rows
// into living memory.
//
// Source is the JSON fallback file the v4 store writes (vectors.json:
// {version, memories: [{id, category, content, score, createdAt, ...}]} — see
// packages/agent/src/memory/vectorStore.ts). Rows land as SEMANTIC nodes tagged
// "v4-vector-store", idempotent by an 8-hex content hash carried in a
// "v4-hash:" tag — re-running migrates nothing. Legacy embeddings are NOT
// imported: they live in a different vector space (lexical hash or another
// model); the sidecar index re-embeds migrated nodes on the next reindex.
// Nodes arrive with a fresh activation clock — week-half-life decay applied to
// their original timestamps would import everything pre-faded and pointless.

import path from "node:path";
import { promises as fs } from "node:fs";
import { aresHome } from "../paths.js";
import { contentHash } from "./embedIndex.js";
import type { MemoryStore } from "./store.js";

export const V4_PROVENANCE_TAG = "v4-vector-store";

export interface MigrateVectorsReport {
  /** Rows found in the legacy file (0 when the file is absent or unreadable). */
  scanned: number;
  /** Rows inserted as new semantic memories this run. */
  migrated: number;
  /** Rows skipped: already migrated (by content hash) or empty content. */
  skipped: number;
}

interface LegacyRow {
  category?: unknown;
  content?: unknown;
  score?: unknown;
}

function legacyRows(raw: string): LegacyRow[] {
  try {
    const parsed = JSON.parse(raw) as { memories?: unknown };
    return Array.isArray(parsed.memories)
      ? parsed.memories.filter((r): r is LegacyRow => typeof r === "object" && r !== null)
      : [];
  } catch {
    return [];
  }
}

/**
 * Fold v4 vector-store rows into a living-memory store. Idempotent: a row whose
 * content hash is already present (tagged v4-hash:<hex>) is never re-inserted.
 * A missing or corrupt legacy file is a clean no-op.
 */
export async function migrateLegacyVectors(opts: {
  legacyDbJsonPath?: string;
  store: MemoryStore;
}): Promise<MigrateVectorsReport> {
  const file = opts.legacyDbJsonPath ?? path.join(aresHome(), "vectors.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return { scanned: 0, migrated: 0, skipped: 0 };
  }
  const rows = legacyRows(raw);

  const present = new Set<string>();
  for (const node of opts.store.all()) {
    for (const tag of node.tags ?? []) {
      if (tag.startsWith("v4-hash:")) present.add(tag.slice("v4-hash:".length));
    }
  }

  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!content) {
      skipped++;
      continue;
    }
    const hash = contentHash(content);
    if (present.has(hash)) {
      skipped++;
      continue;
    }
    const tags = [V4_PROVENANCE_TAG, `v4-hash:${hash}`];
    if (typeof row.category === "string" && row.category) {
      tags.push(`v4-category:${row.category.toLowerCase()}`);
    }
    const score = typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 1;
    await opts.store.add({
      kind: "semantic",
      content,
      tags,
      source: V4_PROVENANCE_TAG,
      strength: Math.min(3, Math.max(0.5, score)),
    });
    present.add(hash);
    migrated++;
  }
  return { scanned: rows.length, migrated, skipped };
}
