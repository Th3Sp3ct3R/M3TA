// Spreading-activation recall (Ares v6 / M1) — the part no shipped agent does.
//
// A cue doesn't fetch one chunk. It lights up the most relevant, strongest
// memories (the seeds), then ACTIVATION SPREADS along association links to pull
// in connected memories — even ones the cue never matched. You get back a
// constellation of related context, the way one memory reminds you of another.
//
// Relevance is dependency-light token overlap by default. When the caller passes
// a corpus IDF map, recall upgrades to salience-weighted relevance (rare cue
// tokens dominate common ones) AND multi-hop spreading whose association edges
// are weighted by how related the two memories actually are (Jaccard overlap).
// When the caller passes vectors (V4 semantic seeds), seed relevance blends
// lexical with embedding cosine 50/50 — so a paraphrase with ZERO token overlap
// can still seed. A node without a vector falls back to pure lexical; without
// the vectors option (or an IDF map) the behavior is byte-identical to classic.

import { currentStrength } from "./strength.js";
import { idfWeight, jaccard, type IdfMap } from "./idf.js";
import { cosine } from "./embedIndex.js";
import type { MemoryNode } from "./types.js";

export interface RecallResult {
  node: MemoryNode;
  score: number;
  /** True if it surfaced by association, not by matching the cue directly. */
  viaAssociation?: boolean;
}

/** Sidecar vector access for semantic seeding (V4). */
export interface RecallVectors {
  get(id: string): Float32Array | undefined;
  /** Embedded cue. Absent (e.g. embed timed out) → recall stays pure lexical. */
  cueVector?: Float32Array;
}

export interface RecallOptions {
  limit?: number;
  /** Follow association links from the seeds (default true). */
  spread?: boolean;
  /** Hops to spread when corpusIdf is provided (default 2). Classic path is always 1. */
  depth?: number;
  /** When present, recall keys on IDF-weighted relevance + Jaccard multi-hop spread. */
  corpusIdf?: IdfMap;
  /** When present with a cueVector, seed relevance blends lexical + cosine 50/50. */
  vectors?: RecallVectors;
  now?: Date;
}

// Common words carry no associative signal — drop them so recall keys on
// meaningful tokens, not "the"/"about"/"is".
const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "you", "your", "with", "about", "this", "that",
  "tell", "what", "how", "where", "when", "who", "does", "did", "from", "into", "out",
  "its", "his", "her", "they", "them", "has", "have", "had", "will", "would", "can",
  "could", "should", "than", "then", "there", "here", "some", "any", "all", "not",
  "but", "our", "their", "been", "were", "via", "let", "get", "got",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function relevance(cue: string, content: string, idf?: IdfMap): number {
  const cueTokens = tokenize(cue);
  if (cueTokens.length === 0) return 0;
  const have = new Set(tokenize(content));
  if (!idf) {
    // Classic flat overlap.
    let hits = 0;
    for (const t of cueTokens) if (have.has(t)) hits++;
    return hits / cueTokens.length;
  }
  // IDF-weighted: a rare matched cue token contributes far more than a common one.
  let matched = 0;
  let total = 0;
  for (const t of cueTokens) {
    const w = idfWeight(idf, t);
    total += w;
    if (have.has(t)) matched += w;
  }
  return total > 0 ? matched / total : 0;
}

export function recall(cue: string, nodes: readonly MemoryNode[], opts: RecallOptions = {}): RecallResult[] {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 8;
  const idf = opts.corpusIdf;

  // Seeds: directly relevant memories, weighted by how vivid they are right now.
  // With vectors present, relevance blends lexical and embedding cosine 50/50 so
  // a zero-overlap paraphrase can seed; a node missing its vector (or holding one
  // of a different dimension — a model swap) stays pure lexical, the invariant.
  const cueVector = opts.vectors?.cueVector;
  const seeds = nodes
    .map((node) => {
      let rel = relevance(cue, node.content, idf);
      if (cueVector) {
        const nodeVector = opts.vectors?.get(node.id);
        if (nodeVector && nodeVector.length === cueVector.length) {
          rel = 0.5 * rel + 0.5 * Math.max(0, cosine(nodeVector, cueVector));
        }
      }
      return { node, score: rel * (0.2 + currentStrength(node, now)) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (opts.spread === false) return seeds;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chosen = new Map<string, RecallResult>(seeds.map((s) => [s.node.id, s]));

  if (!idf) {
    // Classic one-hop spreading activation — unchanged legacy behavior.
    for (const seed of seeds) {
      for (const linkId of seed.node.links) {
        if (chosen.has(linkId)) continue;
        const linked = byId.get(linkId);
        if (!linked) continue;
        chosen.set(linkId, {
          node: linked,
          score: seed.score * 0.4 * (0.2 + currentStrength(linked, now)),
          viaAssociation: true,
        });
      }
    }
    return [...chosen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Upgraded: multi-hop spread with Jaccard-weighted association edges, so a
  // tightly-related neighbor outranks a loosely-linked one and second-order
  // associations can still surface (with geometric falloff per hop).
  const depth = Math.max(1, opts.depth ?? 2);
  const tokenCache = new Map<string, Set<string>>();
  const salient = (n: MemoryNode): Set<string> => {
    let s = tokenCache.get(n.id);
    if (!s) {
      s = new Set(tokenize(n.content));
      tokenCache.set(n.id, s);
    }
    return s;
  };
  let frontier: RecallResult[] = seeds;
  for (let hop = 1; hop <= depth; hop++) {
    const next: RecallResult[] = [];
    for (const cur of frontier) {
      for (const linkId of cur.node.links) {
        if (chosen.has(linkId)) continue;
        const linked = byId.get(linkId);
        if (!linked) continue;
        const affinity = 0.25 + 0.75 * jaccard(salient(cur.node), salient(linked));
        const r: RecallResult = {
          node: linked,
          score: cur.score * 0.45 * affinity * (0.2 + currentStrength(linked, now)),
          viaAssociation: true,
        };
        chosen.set(linkId, r);
        next.push(r);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return [...chosen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
