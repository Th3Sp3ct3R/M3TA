// Slate bottom toolbar — the always-visible click bar on the app frame's LAST
// row. Renders TOOLBAR_ITEMS' labels VERBATIM at CHROME_START_COL with the
// shared separator, so tuiChrome.toolbarHitTest()'s column math lands exactly
// on these glyphs — clicks work through the existing mouse pipeline with zero
// slate-specific hit-test code.

import React from "react";
import { Box, Text } from "ink";
import type { SlateTheme } from "../theme.js";
import { TOOLBAR_ITEMS, CHROME_SEPARATOR } from "../../tuiChrome.js";

const h = React.createElement;

export function Toolbar(props: { theme: SlateTheme; width: number }): React.ReactElement {
  const { theme, width } = props;
  const colors: Record<string, string> = {
    models: theme.primary,
    effort: theme.active,
    themes: theme.secondary,
    settings: theme.muted,
    ultra: theme.primary,
  };
  return h(
    Box,
    { width, paddingX: 1, backgroundColor: theme.surface },
    ...TOOLBAR_ITEMS.flatMap((item, i) => [
      i > 0 ? h(Text, { key: `sep-${item.id}`, color: theme.line }, CHROME_SEPARATOR) : null,
      h(Text, { key: item.id, color: colors[item.id] ?? theme.text, bold: item.id === "ultra" }, item.label),
    ]),
  );
}
