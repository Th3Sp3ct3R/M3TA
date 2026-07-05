// The in-TUI permission prompt — a tool wants to act and the human decides,
// INSIDE the frame. (The old raw-stderr prompt was instantly painted over by
// Ink: the turn hung forever on a question nobody could see. This card is that
// bug's grave.)
//
// Geometry contract with tuiChrome.permHitTest(): the card renders directly
// above the status bar, 4 rows tall (border · title · buttons · border), so
// the buttons row is always screenH-6 and clicks land without measurement.

import React from "react";
import { Box, Text } from "ink";
import type { SlateTheme } from "../theme.js";
import { PERM_BUTTONS, PERM_BUTTON_GAP } from "../../tuiChrome.js";
import { pulse } from "../useTick.js";

const h = React.createElement;

export function PermissionCard(props: {
  theme: SlateTheme;
  toolName: string;
  reason: string;
  suggestion?: string;
  tick: number;
  width: number;
}): React.ReactElement {
  const { theme, toolName, reason, suggestion, tick, width } = props;
  const colors: Record<string, string> = {
    allow_once: theme.success,
    allow_always: theme.secondary,
    deny: theme.danger,
  };
  return h(
    Box,
    {
      width,
      flexDirection: "column",
      borderStyle: "round",
      borderColor: pulse(tick) ? theme.warn : theme.active,
      backgroundColor: theme.surfaceAlt,
      paddingX: 1,
    },
    h(
      Text,
      { wrap: "truncate-end" },
      h(Text, { color: theme.warn, bold: true }, "⚠ "),
      h(Text, { color: theme.text, bold: true }, toolName),
      h(Text, { color: theme.line }, " │ "),
      h(Text, { color: theme.muted }, reason),
    ),
    h(
      Text,
      { wrap: "truncate-end" },
      ...PERM_BUTTONS.flatMap((b, i) => [
        i > 0 ? h(Text, { key: `g-${b.id}` }, PERM_BUTTON_GAP) : null,
        h(Text, { key: b.id, color: colors[b.id] ?? theme.text, bold: b.id === suggestion || (!suggestion && b.id === "allow_once") }, b.label),
      ]),
    ),
  );
}
