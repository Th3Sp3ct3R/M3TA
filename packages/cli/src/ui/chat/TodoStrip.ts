// Slim one-line todo strip — replaces the classic bordered TODO box (which
// clashed hard on the slate screen). Shows progress + the task in flight:
//
//   ☰ 1/3 › Building the world mesh
//
// Pure presentation; the host passes the engine's live todo list.

import React from "react";
import { Box, Text } from "ink";
import type { SlateTheme } from "../theme.js";

const h = React.createElement;

export interface TodoVm {
  content: string;
  activeForm?: string;
  status: string; // pending | in_progress | completed
}

export function TodoStrip(props: { theme: SlateTheme; todos: TodoVm[]; width: number }): React.ReactElement | null {
  const { theme, todos, width } = props;
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  const current = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "pending");
  const label = current ? (current.status === "in_progress" ? current.activeForm || current.content : current.content) : "all done";
  return h(
    Box,
    { width, backgroundColor: theme.surface },
    h(
      Text,
      { wrap: "truncate-end" },
      h(Text, { color: theme.secondary, bold: true }, " ☰ "),
      h(Text, { color: done === todos.length ? theme.success : theme.text }, `${done}/${todos.length}`),
      h(Text, { color: theme.line }, " › "),
      h(Text, { color: done === todos.length ? theme.success : theme.active }, label),
    ),
  );
}
