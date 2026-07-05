// Main-UI status bar — 1 row, space-between. Left: a mode pill (working spinner
// + live turn timer, or ready dot) + contextual hints. Right: latency, message
// count, tools, agents, theme, version.

import React from "react";
import { Box, Text } from "ink";
import type { SlateTheme } from "../theme.js";
import { spinnerFrame } from "../useTick.js";

const h = React.createElement;

export function StatusBar(props: {
  theme: SlateTheme;
  working: boolean;
  tick: number;
  ttft?: number;
  total?: number;
  /** live seconds into the CURRENT turn (ticking while working). */
  turnElapsed?: number;
  msgs: number;
  tools?: number;
  agents?: number;
  themeName: string;
  version: string;
  width: number;
}): React.ReactElement {
  const { theme, working, tick, ttft, total, turnElapsed, msgs, tools, agents, themeName, version, width } = props;
  const sep = h(Text, { color: theme.line }, " │ ");
  return h(
    Box,
    { width, backgroundColor: theme.surface, justifyContent: "space-between" },
    // left — mode pill + hints
    h(
      Box,
      null,
      working
        ? h(
            Text,
            null,
            h(Text, { color: theme.active, bold: true }, ` ${spinnerFrame(tick)} working `),
            turnElapsed !== undefined && turnElapsed >= 1 ? h(Text, { color: theme.active }, `${Math.floor(turnElapsed)}s `) : null,
          )
        : h(Text, { color: theme.success }, " ● ready "),
      sep,
      working
        ? h(Text, null, h(Text, { color: theme.text }, "esc "), h(Text, { color: theme.faint }, "cancel"))
        : h(Text, null, h(Text, { color: theme.text }, "ctrl+p "), h(Text, { color: theme.faint }, "palette · click toolbar")),
    ),
    // right — stats
    h(
      Box,
      null,
      ttft !== undefined ? h(Text, { color: theme.muted }, `${ttft.toFixed(1)}s`) : null,
      total !== undefined ? h(Text, { color: theme.faint }, `→${total.toFixed(1)}s`) : null,
      sep,
      h(Text, { color: theme.muted }, `${msgs} msgs`),
      tools && tools > 0 ? h(Text, null, sep, h(Text, { color: theme.muted }, `⚙ ${tools}`)) : null,
      agents && agents > 0 ? h(Text, null, sep, h(Text, { color: theme.secondary }, `🤖 ${agents}`)) : null,
      sep,
      h(Text, { color: theme.secondary }, themeName),
      version ? h(Text, null, sep, h(Text, { color: theme.faint }, `v${version} `)) : null,
    ),
  );
}
