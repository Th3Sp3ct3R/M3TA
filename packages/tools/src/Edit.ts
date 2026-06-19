// Edit — string replacement in a file, resilient to line-ending drift.
//
// Rules (matching Claude Code's Edit semantics):
//   - File must have been Read in this session.
//   - old_string must appear exactly once unless replace_all is true.
//   - File mtime must match the last Read stamp (no race with disk edits).
//
// Matching is layered because models reliably reproduce file text with LF line
// endings even when the file on disk is CRLF (the classic Windows edit-killer),
// and often drop trailing whitespace:
//   1. exact match in EOL-normalized space (covers both exact and CRLF-vs-LF)
//   2. trailing-whitespace-insensitive line-block match (single occurrence only)
// The file's dominant EOL style is preserved on write.

import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildTool, contentHash, resolveWorkspacePath, toolError, zPath } from "./_shared.js";

const inputSchema = z
  .object({
    file_path: zPath,
    old_string: z.string().describe("Exact text to replace. Must be unique unless replace_all."),
    new_string: z.string().describe("Replacement text. Must differ from old_string."),
    replace_all: z
      .boolean()
      .default(false)
      .describe("If true, replace every occurrence; otherwise old_string must be unique."),
  })
  .strict();

export interface EditOutput {
  path: string;
  replacements: number;
  /** Which matching layer landed the edit: "exact" | "whitespace". */
  matchedBy: string;
}

export const EditTool = buildTool({
  name: "Edit",
  description:
    "Replace exact text in a file. Requires prior Read. Fails if old_string is non-unique (set replace_all to true to replace every occurrence). Tolerates CRLF/LF and trailing-whitespace drift.",
  safety: "workspace-write",
  concurrency: "exclusive",
  inputZod: inputSchema,
  activityDescription: (i) => `Editing ${path.basename(i.file_path)}`,

  // Cheap, pure pre-check (runs before permission/exec): an empty old_string is a
  // common model mistake that would otherwise fail deep in matching as "not found".
  // Catch it early with a clear, correctable message.
  async validateInput(i) {
    if (i.old_string === "") {
      return {
        ok: false,
        message:
          "old_string is empty. Provide the exact existing text to replace, or use Write to create/replace the whole file.",
      };
    }
    return { ok: true };
  },

  async checkPermissions(i, ctx) {
    const filePath = await resolveWorkspacePath(ctx, i.file_path, "file_path", "write");
    if (i.old_string === i.new_string) {
      return { kind: "deny", reason: "old_string and new_string are identical" };
    }
    if (!ctx.fileReadStamps.has(filePath)) {
      return { kind: "deny", reason: `Read ${filePath} before editing it.` };
    }
    return { kind: "allow" };
  },

  async call(i, ctx): Promise<{ output: EditOutput; touchedFiles: string[]; display: string }> {
    const filePath = await resolveWorkspacePath(ctx, i.file_path, "file_path", "write");
    const stamp = ctx.fileReadStamps.get(filePath);
    if (!stamp) throw new Error(`${filePath}: missing read stamp`);

    const content = await fs.readFile(filePath, "utf8");
    // Staleness check (C2): the content hash is exact and immune to mtime
    // granularity races. Fall back to mtime only for stamps written before the
    // hash existed (resumed sessions / older rollouts).
    if (stamp.hash !== undefined) {
      if (contentHash(content) !== stamp.hash) {
        throw toolError(
          `${filePath} was modified on disk since the last Read. Re-Read and retry.`,
        );
      }
    } else {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs > stamp.mtimeMs + 5) {
        throw toolError(
          `${filePath} was modified on disk since the last Read. Re-Read and retry.`,
        );
      }
    }
    const result = replaceResilient(content, i.old_string, i.new_string, i.replace_all);

    if (!result.ok) {
      if (result.reason === "not-found") {
        throw toolError(
          `old_string not found in ${filePath} (tried exact and whitespace-tolerant matching). ` +
            `Re-Read the file and copy the text exactly as it appears, without line-number prefixes.`,
        );
      }
      throw toolError(
        `old_string is not unique in ${filePath} (${result.occurrences} matches). Provide more context or set replace_all to true.`,
      );
    }

    await fs.writeFile(filePath, result.text, "utf8");
    const newStat = await fs.stat(filePath);
    ctx.fileReadStamps.set(filePath, { mtimeMs: newStat.mtimeMs, size: newStat.size, hash: contentHash(result.text) });

    const note = result.matchedBy === "exact" ? "" : ` [matched via ${result.matchedBy}]`;
    return {
      output: { path: filePath, replacements: result.replacements, matchedBy: result.matchedBy },
      touchedFiles: [filePath],
      display: `Edited ${filePath} (${result.replacements} replacement${result.replacements === 1 ? "" : "s"})${note}`,
    };
  },
});

type ReplaceResult =
  | { ok: true; text: string; replacements: number; matchedBy: "exact" | "whitespace" }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "not-unique"; occurrences: number };

/**
 * Layered replacement. All matching happens in LF-normalized space so CRLF
 * files and LF-quoting models agree; the file's dominant EOL is re-applied to
 * the final text. Mixed-EOL files come out consistently in their dominant
 * style — an acceptable trade for edits that actually land.
 */
export function replaceResilient(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): ReplaceResult {
  const eol = dominantEol(content);
  const haystack = toLf(content);
  const needle = toLf(oldString);
  const replacement = toLf(newString);

  // Layer 1: exact (in normalized space — equals raw exact for LF files,
  // and transparently fixes the CRLF-vs-LF mismatch).
  const occurrences = countOccurrences(haystack, needle);
  if (occurrences > 0) {
    if (occurrences > 1 && !replaceAll) {
      return { ok: false, reason: "not-unique", occurrences };
    }
    const text = replaceAll
      ? haystack.split(needle).join(replacement)
      : haystack.replace(needle, replacement);
    return {
      ok: true,
      text: fromLf(text, eol),
      replacements: replaceAll ? occurrences : 1,
      matchedBy: "exact",
    };
  }

  // Layer 2: line-block match ignoring trailing whitespace on each line.
  // Only safe for a single unambiguous occurrence.
  const fuzzy = fuzzyLineReplace(haystack, needle, replacement);
  if (fuzzy.kind === "replaced") {
    return { ok: true, text: fromLf(fuzzy.text, eol), replacements: 1, matchedBy: "whitespace" };
  }
  if (fuzzy.kind === "ambiguous") {
    return { ok: false, reason: "not-unique", occurrences: fuzzy.matches };
  }
  return { ok: false, reason: "not-found" };
}

function fuzzyLineReplace(
  content: string,
  oldString: string,
  newString: string,
): { kind: "replaced"; text: string } | { kind: "ambiguous"; matches: number } | { kind: "none" } {
  const contentLines = content.split("\n");
  const oldLines = oldString.split("\n").map(stripTrailingWs);
  if (oldLines.length === 0 || (oldLines.length === 1 && oldLines[0] === "")) return { kind: "none" };

  let matchIndex = -1;
  let matches = 0;
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let hit = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (stripTrailingWs(contentLines[i + j]) !== oldLines[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      matches++;
      matchIndex = i;
      if (matches > 1) return { kind: "ambiguous", matches };
    }
  }
  if (matches !== 1) return { kind: "none" };

  const updated = [
    ...contentLines.slice(0, matchIndex),
    ...newString.split("\n"),
    ...contentLines.slice(matchIndex + oldLines.length),
  ];
  return { kind: "replaced", text: updated.join("\n") };
}

function dominantEol(text: string): "\r\n" | "\n" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? "\r\n" : "\n";
}

function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function fromLf(text: string, eol: "\r\n" | "\n"): string {
  return eol === "\n" ? text : text.replace(/\n/g, "\r\n");
}

function stripTrailingWs(line: string): string {
  return line.replace(/[ \t\r]+$/, "");
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}
