// Shared tool-channel helpers for the Anthropic-shaped providers.
//
// Both live here so every provider that speaks the Anthropic message shape
// (anthropic, deepseek-anthropic, ollama's /v1/messages compat) uses ONE
// implementation — a fix here can't silently miss a sibling path the way three
// copy-pasted versions did.

import type { ContentBlock, Message } from "@ares/protocol";

/**
 * Drop orphaned tool blocks before sending to an Anthropic-shaped endpoint. The
 * API 400s on a tool_result whose tool_use was dropped (compaction, an
 * interrupted turn, or a mid-conversation provider switch) — "unexpected
 * tool_use_id ... Each tool_result block must have a corresponding tool_use
 * block". Convert orphans to plain text so the model keeps the context without an
 * invalid request.
 */
export function sanitizeToolPairs(messages: readonly Message[]): Message[] {
  const useIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "tool_use") useIds.add(b.id);
      else if (b.type === "tool_result") resultIds.add(b.tool_use_id);
    }
  }
  return messages.map((m) => {
    const content = m.content.flatMap((b): ContentBlock[] => {
      if (b.type === "tool_use" && !resultIds.has(b.id)) {
        return [{ type: "text", text: `[earlier ${b.name} tool call — result not retained]` }];
      }
      if (b.type === "tool_result" && !useIds.has(b.tool_use_id)) {
        const text =
          typeof b.content === "string"
            ? b.content
            : b.content.map((x) => (x.type === "text" ? x.text : "[image]")).join("\n");
        return [{ type: "text", text: `[earlier tool result]\n${text}` }];
      }
      return [b];
    });
    return { ...m, content };
  });
}

/**
 * Sentinel key a provider stashes on a tool_use input when the model's arguments
 * JSON could not be parsed. The provider CANNOT throw at the stream-parse site —
 * that would crash the SSE generator and fail the whole turn as a non-correctable
 * `provider_throw` — so it carries the correctable message forward instead. The
 * engine re-throws it per-tool (see normalizeToolInput in queryEngine), turning it
 * into an `is_error` tool_result the model can fix on its next turn.
 */
export const TOOL_ARGS_ERROR_KEY = "__tool_use_error__";

/**
 * Coerce a tool_use arguments JSON string into an object.
 *
 * On success: the parsed object. On failure (malformed or truncated JSON): THROWS
 * a correctable error wrapped in the codebase's `<tool_use_error>` envelope, so
 * the model learns its JSON was unparseable and re-emits valid JSON — instead of
 * the old `{__unparseable_args__: raw}` path, where the unknown key was stripped
 * and zod reported a generic "<field>: Required" the model couldn't act on.
 *
 * The envelope is the same convention `@ares/tools` uses for model-correctable
 * errors (`toolError`); inlined here because `@ares/core` does not depend on
 * `@ares/tools`.
 *
 * Stream-parse callers that cannot throw should catch this and stash
 * `{ [TOOL_ARGS_ERROR_KEY]: err.message }` as the input instead.
 */
export function coerceToolArgs(raw: string, toolName: string): Record<string, unknown> {
  const trimmed = raw.trim();
  // Empty args is a valid no-argument call ({}), not a parse failure.
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      `<tool_use_error>${toolName}: the arguments JSON was malformed or truncated and could not be parsed. ` +
        `Re-emit the ${toolName} call with complete, valid JSON arguments.</tool_use_error>`,
    );
  }
  // A bare scalar / array parses but isn't a usable argument object.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `<tool_use_error>${toolName}: the arguments must be a JSON object, not ${Array.isArray(parsed) ? "an array" : typeof parsed}. ` +
        `Re-emit the ${toolName} call with a valid JSON arguments object.</tool_use_error>`,
    );
  }
  return parsed as Record<string, unknown>;
}
