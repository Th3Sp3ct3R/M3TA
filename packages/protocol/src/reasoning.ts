// Unified reasoning levels — one dial the owner controls, translated per provider.
//
// Different backends express "think harder" differently: OpenAI's Responses API
// takes reasoning.effort (a string); Anthropic-shaped reasoners (Ollama Cloud)
// take thinking.budget_tokens (a number). Ares exposes ONE concept — a level —
// and each provider translates it at the wire edge, so the same setting works on
// OpenAI and Ollama alike.

export type ReasoningLevel = "off" | "low" | "medium" | "high" | "max";

export const REASONING_LEVELS: readonly ReasoningLevel[] = ["off", "low", "medium", "high", "max"];

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

/**
 * Is extended thinking on at all? "off" disables it entirely — callers MUST gate
 * every provider's thinking/reasoning field on this and send NO such field when
 * off (presence of the field, even with a zero budget, turns thinking back on).
 */
export function reasoningEnabled(level: ReasoningLevel | undefined): level is ReasoningLevel {
  return !!level && level !== "off";
}

/** Human-facing label. "max" reads as "Extra High". */
export function reasoningLabel(level: ReasoningLevel): string {
  if (level === "off") return "Off";
  return level === "max" ? "Extra High" : level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * OpenAI Responses `reasoning.effort`. The API accepts low | medium | high
 * (newer models also accept "minimal"). There is NO "xhigh" tier — sending one
 * is rejected — so "max" maps to the deepest valid value, "high".
 *
 * "off" returns "low" only for exhaustiveness — callers MUST check
 * reasoningEnabled() first and omit the reasoning field entirely when off.
 */
export function openAIReasoningEffort(level: ReasoningLevel): "low" | "medium" | "high" {
  switch (level) {
    case "off":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "max":
      return "high";
  }
}

/**
 * Anthropic / Ollama-reasoner `thinking.budget_tokens`. Must stay below the
 * request's max_tokens — the provider bumps max_tokens to fit (see ollamaCloud).
 *
 * "off" returns 0 only for exhaustiveness — callers MUST check reasoningEnabled()
 * first and send NO thinking block when off (an enabled block with a 0 budget
 * still turns thinking on / 400s on adaptive-only models).
 */
export function thinkingBudgetTokens(level: ReasoningLevel): number {
  switch (level) {
    case "off":
      return 0;
    case "low":
      return 2_048;
    case "medium":
      return 8_192;
    case "high":
      return 16_384;
    case "max":
      return 32_768;
  }
}
