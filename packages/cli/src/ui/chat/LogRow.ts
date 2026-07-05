// Transcript rows — the main screen's body, redesigned around a GUTTER GRAMMAR
// so a session reads as structured work, not a log file:
//
//   ❯ user message                          (primary chevron, banded)
//
//   ● assistant prose                       (dot gutter, markdown body,
//     continuation lines indent under it)    code on a surface band)
//     ⠹ Write │ minecraft.html  2.3s        (tools indent under the turn,
//     ⏺ Glob │ 5 files  747ms                live spinner → colored dot)
//       ⎿ preview line                      (results hang off the tool)
//     ✗ EPERM …  ×5                         (identical error spam COLLAPSES)
//
// Every row is tone-styled and pure; the cutover feeds it from the engine's
// LogLine model. When 2+ tools are in flight, the batch gets a banner so
// parallel fan-out reads as one visible act.

import React from "react";
import { Box, Text } from "ink";
import type { SlateTheme } from "../theme.js";
import { spinnerFrame, cursorOn } from "../useTick.js";
import { renderMarkdown, type MdTheme } from "../../mdRender.js";

const h = React.createElement;

export type LogTone = "user" | "assistant" | "tool" | "notice" | "error" | "muted";
export interface LogLine {
  tone: LogTone;
  text: string;
  /** tool rows: the tool name + outcome. */
  name?: string;
  ok?: boolean;
  elapsed?: string;
  /** tool rows: still in flight (renders the spinner card). */
  running?: boolean;
  /** tool rows: dim output-preview lines under the settled card. */
  preview?: string[];
  /** assistant rows: this is the live streaming draft (renders a cursor). */
  stream?: boolean;
  /** assistant rows: render the text as markdown (headings/code/lists). */
  md?: boolean;
}

/** Slate's markdown palette — prose stays calm, code + headings get the accents. */
export function slateMdTheme(theme: SlateTheme): MdTheme {
  return {
    text: theme.text,
    dim: theme.muted,
    accent: theme.primary,
    accent2: theme.secondary,
    accent3: theme.active,
    success: theme.success,
    warn: theme.warn,
    error: theme.danger,
  };
}

const IND = "  "; // everything under a turn indents beneath the gutter

function AssistantProse(props: { theme: SlateTheme; line: LogLine; tick: number; width: number }): React.ReactElement {
  const { theme, line, tick, width } = props;
  const cursor = line.stream && cursorOn(tick) ? h(Text, { color: theme.primary }, "▊") : null;
  const gutter = (first: boolean) =>
    first ? h(Text, { color: theme.primary }, "● ") : h(Text, null, IND);
  if (!line.md) {
    return h(Text, { wrap: "wrap" }, gutter(true), h(Text, { color: theme.text }, line.text), cursor);
  }
  const rows = renderMarkdown(line.text, slateMdTheme(theme));
  return h(
    Box,
    { flexDirection: "column", width },
    ...rows.map((row, i) => {
      const last = i === rows.length - 1;
      if (row.spans.length === 0) return h(Text, { key: `md-${i}` }, last ? cursor ?? " " : " ");
      const spans = row.spans.map((s, j) =>
        h(Text, { key: `s-${j}`, color: s.color ?? theme.text, bold: s.bold, italic: s.italic, dimColor: s.dim }, s.text),
      );
      if (row.kind === "code" || row.kind === "code-fence") {
        // Code lines sit on a subtle panel band, indented, and never wrap mid-token.
        return h(
          Box,
          { key: `md-${i}`, width, backgroundColor: theme.surface },
          h(Text, { wrap: "truncate-end" }, h(Text, null, IND), ...spans, last ? cursor : null),
        );
      }
      return h(Text, { key: `md-${i}`, wrap: "wrap" }, gutter(i === 0), ...spans, last ? cursor : null);
    }),
  );
}

function ToolCard(props: { theme: SlateTheme; line: LogLine; tick: number; width: number }): React.ReactElement {
  const { theme, line, tick, width } = props;
  if (line.running) {
    // In flight — spinner, name bold, elapsed ticking in active amber.
    return h(
      Text,
      { wrap: "truncate-end" },
      h(Text, null, IND),
      h(Text, { color: theme.active }, `${spinnerFrame(tick)} `),
      h(Text, { color: theme.text, bold: true }, line.name ?? "tool"),
      h(Text, { color: theme.line }, " │ "),
      h(Text, { color: theme.muted }, line.text),
      line.elapsed ? h(Text, { color: theme.active }, `  ${line.elapsed}`) : null,
    );
  }
  const failed = line.ok === false;
  const head = h(
    Text,
    { wrap: "truncate-end" },
    h(Text, null, IND),
    h(Text, { color: failed ? theme.danger : theme.success }, "⏺ "),
    h(Text, { color: theme.text, bold: true }, line.name ?? "tool"),
    h(Text, { color: theme.line }, " │ "),
    h(Text, { color: failed ? theme.danger : theme.muted }, line.text),
    line.elapsed ? h(Text, { color: theme.faint }, `  ${line.elapsed}`) : null,
  );
  if (!line.preview || line.preview.length === 0) return head;
  return h(
    Box,
    { flexDirection: "column", width },
    head,
    ...line.preview.map((p, i) =>
      h(
        Text,
        { key: `p-${i}`, wrap: "truncate-end" },
        h(Text, { color: theme.line }, i === 0 ? `${IND}  ⎿ ` : `${IND}    `),
        h(Text, { color: theme.faint }, p),
      ),
    ),
  );
}

export function LogRow(props: { theme: SlateTheme; line: LogLine; tick?: number; width: number }): React.ReactElement {
  const { theme, line, tick = 0, width } = props;
  switch (line.tone) {
    case "user":
      return h(
        Box,
        { width, backgroundColor: theme.surfaceAlt },
        h(Text, { color: theme.primary, bold: true }, "❯ "),
        h(Text, { color: theme.text, wrap: "wrap" }, line.text),
      );
    case "tool":
      return h(ToolCard, { theme, line, tick, width });
    case "notice":
      return h(Text, { wrap: "wrap" }, h(Text, null, IND), h(Text, { color: theme.secondary }, "◆ "), h(Text, { color: theme.secondary }, line.text));
    case "error":
      return h(Text, { wrap: "wrap" }, h(Text, null, IND), h(Text, { color: theme.danger }, "✗ "), h(Text, { color: theme.danger }, line.text));
    case "muted":
      return h(Text, { wrap: "wrap" }, h(Text, null, IND), h(Text, { color: theme.muted }, line.text));
    case "assistant":
    default:
      return h(AssistantProse, { theme, line, tick, width });
  }
}

export function Transcript(props: {
  theme: SlateTheme;
  lines: LogLine[];
  tick?: number;
  /** >0 = the user scrolled up; shows the "newer below" marker. */
  scrolled?: number;
  width: number;
}): React.ReactElement {
  const { theme, lines, tick = 0, scrolled = 0, width } = props;
  if (lines.length === 0) {
    return h(
      Box,
      { width, flexDirection: "column", paddingX: 1 },
      h(Text, { color: theme.faint }, "Ready. What are we building?"),
    );
  }

  // Collapse consecutive IDENTICAL error rows into one with a ×N count — five
  // EPERM lines screaming the same path taught us what that wall looks like.
  const folded: Array<{ line: LogLine; count: number }> = [];
  for (const line of lines) {
    const prev = folded[folded.length - 1];
    if (prev && line.tone === "error" && prev.line.tone === "error" && prev.line.text === line.text) {
      prev.count++;
      continue;
    }
    folded.push({ line, count: 1 });
  }

  const rows: React.ReactNode[] = [];
  const inFlight = lines.filter((l) => l.tone === "tool" && l.running).length;
  let bannerPlaced = false;
  for (const [i, entry] of folded.entries()) {
    const line = entry.line;
    // Turn rhythm: a breath of air before each user message (except the first
    // visible row) — turns read as separate exchanges, not one dense wall.
    if (line.tone === "user" && i > 0) {
      rows.push(h(Text, { key: `sp-${i}` }, " "));
    }
    // Banner above the FIRST running tool when a parallel batch is in flight.
    if (!bannerPlaced && inFlight >= 2 && line.tone === "tool" && line.running) {
      rows.push(
        h(
          Text,
          { key: "batch" },
          h(Text, null, IND),
          h(Text, { color: theme.active, bold: true }, "⚡ "),
          h(Text, { color: theme.active }, `${inFlight} tools in flight`),
        ),
      );
      bannerPlaced = true;
    }
    if (entry.count > 1) {
      rows.push(
        h(
          Text,
          { key: `l-${i}`, wrap: "truncate-end" },
          h(Text, null, IND),
          h(Text, { color: theme.danger }, "✗ "),
          h(Text, { color: theme.danger }, line.text),
          h(Text, { color: theme.faint, bold: true }, `  ×${entry.count}`),
        ),
      );
      continue;
    }
    rows.push(h(LogRow, { key: `l-${i}`, theme, line, tick, width: width - 2 }));
  }
  if (scrolled > 0) {
    rows.push(h(Text, { key: "more", color: theme.secondary }, `  ↓ ${scrolled} newer — end to jump back`));
  }
  return h(Box, { width, flexDirection: "column", paddingX: 1 }, ...rows);
}
