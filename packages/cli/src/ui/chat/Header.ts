// Main-UI header — 3 rows. Consumes fields off InkChatSnapshot + RuntimeStats
// (passed in as props; the cutover maps them).
//
// The wordmark runs a slow gradient shimmer while a turn is busy — the whole
// header is otherwise still. The model chip carries a ▾ so it reads as the
// click target it is (clicking it opens the model picker).

import React from "react";
import { Box, Text } from "ink";
import type { SlateTheme } from "../theme.js";
import { LOGO_GRADIENT } from "../theme.js";

const h = React.createElement;

const MARK = "ARES";

export function Header(props: {
  theme: SlateTheme;
  model: string;
  tokens?: number;
  workspace: string;
  branch?: string;
  dirty?: boolean;
  mode?: "plan" | "bypass" | null;
  busy?: boolean;
  tick?: number;
  width: number;
}): React.ReactElement {
  const { theme, model, tokens, workspace, branch, dirty, mode, busy, tick = 0, width } = props;
  // Busy: a teal wave sweeps letter-by-letter through the wordmark. Idle (or
  // motion off → tick frozen at 0): solid primary.
  const wordmark = busy
    ? MARK.split("").map((ch, i) =>
        h(Text, { key: `w-${i}`, color: LOGO_GRADIENT[(i + Math.floor(tick / 3)) % LOGO_GRADIENT.length], bold: true }, ch),
      )
    : [h(Text, { key: "w", color: theme.primary, bold: true }, MARK)];
  return h(
    Box,
    { flexDirection: "column", backgroundColor: theme.surface, width },
    // Row 1 — wordmark · model chip (click target) · tokens
    h(
      Box,
      { width },
      h(Text, null, " "),
      ...wordmark,
      h(Text, { color: theme.active }, `  ${model} `),
      h(Text, { color: theme.faint }, "▾"),
      h(Box, { flexGrow: 1 }),
      tokens && tokens > 0 ? h(Text, { color: theme.muted }, `${tokens.toLocaleString()} tokens `) : null,
    ),
    // Row 2 — workspace · git branch · mode pill
    h(
      Box,
      { width },
      h(Text, { color: theme.muted, wrap: "truncate-start" }, ` ${workspace} `),
      h(Box, { flexGrow: 1 }),
      mode ? h(Text, { color: mode === "bypass" ? theme.danger : theme.warn, bold: true }, ` [${mode.toUpperCase()}] `) : null,
      branch ? h(Text, { color: dirty ? theme.active : theme.success }, `  ${branch}${dirty ? " ●" : ""} `) : null,
    ),
    // Row 3 — rule
    h(Text, { color: theme.line }, "─".repeat(Math.max(0, width))),
  );
}
