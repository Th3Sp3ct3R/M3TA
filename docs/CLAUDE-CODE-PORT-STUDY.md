# Claude Code → Ares: Memory, Compaction & Coding-Quality Port Study

> Source studied: a de-obfuscated Claude Code source tree (`~/Downloads/claude-code-main`).
> This is an **old** CC build but architecturally one of the best agent runtimes shipped.
>
> **Licensing note (read first):** that tree is licensed Claude Code source, not public
> domain. Treat everything below as a **spec to reimplement in Ares-native code**, not a
> parts bin. Re-express the *strategies and prompts* in our own words/structure. Do NOT
> copy files verbatim — Ares is slated to open-source. When in doubt, reimplement clean.

---

## 0. What Ares already has (so we don't rebuild)

Ares independently arrived at much of CC's design. Confirmed present:

- **`packages/core/src/queryEngine.ts`** — `summarizeSpan()` smart compaction,
  `compactionThresholdTokens`, oldest-message trimming with orphan tool_use/tool_result
  pairing, a "context ledger" injected for dropped spans, Read re-read guard.
- **`packages/mind/src/memory/contextCompiler.ts`** — pure token-budgeted packet builder
  (tiered fragments + per-tier budgets, never exceeds total).
- **`packages/mind/src/memory/recall.ts`** — lexical + IDF + embedding-cosine recall.
- **`conversationReflect.ts`, `afterAction.ts`, `synthesis.ts`, `doctor.ts`** — reflection
  and consolidation primitives.

So this is a **delta** exercise, not a greenfield one.

---

## 1. COMPACTION — the biggest wins

CC runs **three** layers of context management. Ares currently has roughly one-and-a-half
(span summarize + whole-message trim). The missing layers are where the value is.

### 1.1 Microcompact (HIGHEST VALUE, lowest risk) — *new to Ares*

**What CC does** (`services/compact/microCompact.ts`): a cheap layer that runs *before*
any summarization. It walks the message list and **clears the body of old tool_result
blocks** — only for bulky, re-derivable tools — while keeping the last N. It replaces the
content with `[Old tool result content cleared]`. No model call. No summarization.

- Compactable tools only: `Read, Bash/shell, Grep, Glob, WebSearch, WebFetch, Edit, Write`.
  (Assistant reasoning and user messages are never touched.)
- Keeps the most recent `keepRecent` tool results (floor of 1 — never clear everything).
- Images counted at ~2000 tokens flat.

**Why it matters for Ares:** in coding sessions, tool *output* (file reads, grep dumps,
test logs) dominates token usage — not the conversation. Ares' current trim drops *whole
old messages*, losing the assistant's reasoning and user intent along with the bulky
output. Microcompact surgically deletes only the re-derivable output and keeps the thread
intact. This alone can defer real compaction by a large margin.

**Ares port:** add `microcompact()` as a pre-pass in `queryEngine.ts` before
`summarizeSpan` fires. Pure function over the message array. Tool-name allowlist from our
tool registry. ~1 day, fully unit-testable, no model call.

### 1.2 Time-based clear (cheap follow-on)

**What CC does** (`maybeTimeBasedMicrocompact`): when the gap since the last assistant
message exceeds a threshold, the provider's prompt cache has already expired — so the full
prefix gets rewritten anyway. CC uses that moment to clear old tool outputs *for free*
(the cache penalty is already being paid).

**Ares port:** trivial once 1.1 exists — gate the same clear on
`Date.now() - lastAssistantTs > threshold`. Pairs with our existing cache handling.

> CC also has a **cache-edits** variant that deletes tool results without breaking the
> cached prefix (Anthropic cache_edits API). Defer — it's provider-specific and Ares is
> multi-provider. The time-based + local clear gets ~80% of the benefit provider-agnostic.

### 1.3 Tiered thresholds + circuit breaker — *Ares should adopt*

`services/compact/autoCompact.ts`:

- **Reserve output room:** `effectiveWindow = contextWindow − ~20k` so the summary itself
  has room to be generated. Verify Ares' `compactionThresholdTokens` reserves this.
- **Tiered buffers:** warning / error / autocompact / hard-blocking, each a fixed buffer
  below the effective window. Drives UI warnings *and* staged behavior.
- **Circuit breaker (do this):** `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`. CC's telemetry
  found 1,279 sessions hammering doomed compaction 50+ times/session (~250k wasted API
  calls/day). If context is irrecoverably over the limit, stop retrying. Ares needs this
  guard — cheap insurance against a runaway loop.

### 1.4 The compaction PROMPT — *direct quality upgrade to `summarizeSpan`*

`services/compact/prompt.ts` is the distilled "how not to lose the thread." Re-express its
**9-section structure** in Ares' summarizer:

1. Primary Request & Intent  2. Key Technical Concepts  3. Files & Code Sections (with
*full snippets* + why each matters)  4. Errors & Fixes (+ user feedback)  5. Problem
Solving  6. **All user messages, verbatim** (non-tool-result)  7. Pending Tasks  8. Current
Work  9. **Optional Next Step — with verbatim quotes** from the last exchange to prevent
task drift.

Key techniques to copy (mechanics, not text):
- **`<analysis>` scratchpad** the model fills first, then a `<summary>` block. Strip the
  analysis before injecting — it raises quality without costing context.
- **NO-TOOLS preamble + trailer.** With `maxTurns:1`, a stray tool call wastes the only
  turn. Lead and close with explicit "text only, tools will be rejected."
- **Continuation message:** "do not acknowledge the summary, resume as if the break never
  happened" + a pointer to the on-disk transcript path for exact details the summary
  dropped. Kills the post-compact "I'll continue where we left off…" drift.

This is the single best lever for *coding continuity* across long sessions.

---

## 2. MEMORY — selection & consolidation deltas

### 2.1 LLM selector on top of mechanical recall — *the memory-OS keystone*

`memdir/findRelevantMemories.ts`: CC scans memory file **headers** (name + description),
hands the manifest to a fast model, and asks it to pick **≤5** that are *clearly* useful —
return empty if unsure. Plus one sharp rule:

> If a tool is in active use, do NOT surface its reference/API memory (the convo already
> has working usage) — but DO still surface its **warnings/gotchas/known-issues**.

**Ares port (hybrid):** our `recall.ts` already scores mechanically (lexical+IDF+cosine).
Add an optional **LLM gate** as the final stage: mechanical recall shortlists ~15 →
fast-model selector picks ≤5 → inject. Best of both: cheap recall does the heavy lifting,
the selector kills false positives that keyword/embedding overlap let through. Thread
**mtime** through so the model sees freshness without a second stat.

### 2.2 Extraction discipline

`services/extractMemories/prompts.ts` — worth mirroring in `afterAction.ts` /
`conversationReflect.ts`:

- **Turn-budget strategy:** turn 1 = all reads in parallel; turn 2 = all writes in
  parallel. Never interleave. (Edit requires a prior Read.)
- **"Only use the last ~N messages. Do NOT go verify"** — no grepping source, no git, no
  re-investigation. Extraction summarizes what happened; it doesn't re-litigate it.
- **Two-step save:** topic file + one-line index pointer in `MEMORY.md`. Index stays an
  index (one line, <150 chars, never content). Ares' memory format already matches this.

### 2.3 Dream / consolidation — *gate + safety for our reflection pass*

`services/autoDream/autoDream.ts` + `consolidationPrompt.ts`:

- **Cheap-first gate order:** time (one stat) → session count → lock. Only then fork.
- **Lock with rollback:** on failure, rewind the "last consolidated" mtime so it retries;
  scan-throttle is the backoff. Single-flight across processes.
- **Read-only fork:** the consolidation subagent runs with Bash restricted to read-only
  commands — enforced, not requested. (See §3.2.)
- **4-phase prompt:** Orient → Gather recent signal → Consolidate (merge, don't duplicate;
  convert relative→absolute dates; delete contradicted facts) → Prune & index.

**Ares port:** wrap our `synthesis.ts`/`doctor.ts` in this gate+lock+read-only-fork shell.
Maps cleanly onto the proactive/autonomy work; this is the safe "Ares reflects in the
background" skeleton.

---

## 3. CODING QUALITY & ENGINE — making external tools "click in"

### 3.1 Forked-agent pattern (cache-safe subagents)

`utils/forkedAgent.ts` (`runForkedAgent` + `createCacheSafeParams`): memory/compaction
subagents fork the main conversation inheriting its **exact tool set + message prefix**, so
the provider cache hits and the fork is nearly free. Ares' reflect/dream/selector calls
should reuse the live cache prefix the same way rather than building fresh contexts.

### 3.2 Read-only Bash enforcement

CC's `tools/BashTool/readOnlyValidation.ts` (~2k lines) backs the "read-only fork." Any
Ares background brain (dream, reflect, Consciousness watcher) that touches Bash must enforce
read-only at the **tool layer**, not via prompt politeness. We don't need CC's full parser —
an allowlist (`ls find grep cat stat wc head tail`) + deny-on-redirect is enough to start.

### 3.3 Tool / hook / skill contracts (the interop payoff)

This is the answer to "tools like that agent repo just click in." CC's tool roster, the
4-type **hooks** schema (`command | prompt | agent | http`, `if:` permission-rule filter,
`async`/`asyncRewake`), and the skill/slash-command conventions are the **public contract**
the Agent SDK and skills are built against. If Ares' tool definitions, hook events, and
skill frontmatter match these shapes, SDK-built agents and community skills drop in with
minimal translation. Diff our `packages/tools` + queryEngine tool schema against CC's
`tools/` and `schemas/hooks.ts`; close the gaps deliberately.

---

## 4. Prioritized roadmap

| # | Item | Where | Value | Risk | Est. |
|---|------|-------|-------|------|------|
| 1 | **Microcompact** (clear old tool outputs, keep last N) | `queryEngine.ts` | ★★★★★ | low | ~1d |
| 2 | **Compaction prompt** rewrite (9-section + analysis scratchpad + no-tools + continuation) | `summarizeSpan` | ★★★★★ | low | ~1d |
| 3 | **Circuit breaker** + reserve-output-tokens + tiered buffers | compaction path | ★★★★ | low | ~0.5d |
| 4 | **LLM selector** gate on recall (≤5, active-tool rule, mtime) | `recall.ts` | ★★★★ | med | ~1–2d |
| 5 | **Time-based clear** | `queryEngine.ts` | ★★★ | low | ~0.5d |
| 6 | **Dream gate+lock+read-only fork** around synthesis | `mind` | ★★★ | med | ~2d |
| 7 | **Hook/tool/skill contract** alignment (interop) | `tools`, engine | ★★★ | med | ongoing |

**Start with #1 and #2** — self-contained, low-risk, and they compound: microcompact defers
compaction, and when compaction does fire the new prompt makes it lossless for coding.

---

## 5. EXECUTION QUALITY — why tool calls fail / runs derail / it's slow

Investigated the actual execution pipelines side by side. Symptoms: tool calls fail,
runs go off the rails, it's slow. Root causes are specific (not "Ares is naive" — our loop
control is genuinely good).

### 5.1 ROOT CAUSE: Ares runs tools on UNVALIDATED model input  ★★★★★

CC's executor (`services/tools/toolExecution.ts:614`) gates every call behind two stages
BEFORE running the tool:

```
// "surprisingly, the model is not great at generating valid input"
const parsed = tool.inputSchema.safeParse(input)          // 1. Zod: types/shape
if (!parsed.success) return <tool_use_error>InputValidationError: ...</tool_use_error>
const ok = await tool.validateInput?.(parsed.data, ctx)   // 2. semantic (file exists, in-cwd…)
if (ok?.result === false) return <tool_use_error>${ok.message}</tool_use_error>
```

Key: it passes `parsed.data` (the **coerced** value) to the tool, and turns every bad input
into a clean, structured, model-correctable `<tool_use_error>`.

**Ares** (`queryEngine.ts:1273`) calls `use.tool.call(use.input, …)` with the RAW model
input. Our tools DO define `inputZod` schemas — **the engine just never validates against
them.** Malformed input → either a deep JS throw (`x.split is not a function`) the model
can't map back to "wrong type" → flail/repeat → circuit-breaker kills the turn; OR a silent
wrong action → run derails. THIS is the dominant cause of "tool calls fail."

**Fix (small, high-impact):** in `executeToolUse`, before `tool.call`:
`const parsed = use.tool.schema.inputZod.safeParse(use.input)` → on failure return a
`<tool_use_error>InputValidationError: ${formatZodError(parsed.error)}</tool_use_error>`
is_error result; on success pass `parsed.data`. Add an optional `validateInput` stage to the
tool contract for semantic checks. We already have the schemas — this is wiring, ~0.5–1d.

### 5.2 Schema-not-sent hint for deferred tools  ★★★

`toolExecution.ts:593`: if a deferred tool wasn't loaded via ToolSearch, its schema isn't in
the prompt, so "typed params get emitted as strings and the parser rejects them" → the error
tells the model to `ToolSearch select:<tool>` then retry. Whole failure class, handled.

### 5.3 maxResultSizeChars — giant tool results bloat context  ★★★★

CC `Tool.ts:466`: oversized tool output is persisted to disk; model gets a preview + file
path. Ares trims images only — a huge Read/Grep dump enters history at full size → every
later request is bigger → slow + early compaction. Add per-tool `maxResultSizeChars` +
disk-spill. Pairs with microcompact (§1.1).

### 5.4 Enrich the Tool contract (robustness == interop)  ★★★

CC's power is the `Tool` interface (`Tool.ts:362`): `validateInput`, `isConcurrencySafe(input)`,
`isReadOnly(input)`, `isDestructive(input)`, `maxResultSizeChars`, `strict`, all via one
`buildTool()` with fail-closed defaults. Same enrichment that fixes robustness is what makes
SDK/community tools drop in. Ares' `buildTool` exists but the schema is thinner — close the gap.

### 5.5 What Ares already does WELL (do not rebuild)

Per-tool **watchdog** timeout (`queryEngine.ts:1270`), **bounded parallel** execution (`:1158`),
transient-retry (`:696`), context-limit fallback (`:811`), repeated-failure circuit-breaker
(`:970`), identical-call + A/B oscillation guards (`:1004`). Loop control is strong; the gap is
input integrity (5.1) and result hygiene (5.3).

### Revised priority

| # | Item | Symptom fixed | Risk | Est. |
|---|------|---------------|------|------|
| **0** | **Zod input validation gate + `<tool_use_error>`** (`executeToolUse`) | tool calls fail, derail | low | ~0.5–1d |
| 1 | Microcompact | slow, long-horizon | low | ~1d |
| 2 | Compaction prompt rewrite | long-horizon coherence | low | ~1d |
| 3 | `maxResultSizeChars` + disk-spill | slow | low | ~1d |
| 4 | `validateInput` semantic stage + schema-not-sent hint | tool calls fail | low | ~0.5d |
| 5 | Circuit breaker / reserve-output / LLM recall selector / dream gate | (as §1–§4 above) | — | — |

**Item #0 is the new top priority** — smallest change, biggest reliability win, and it
unblocks long-horizon runs by keeping the model self-correcting instead of stuck.

---

*Study captured 2026-06-19; execution-quality analysis appended same day.
Companion memory: see MEMORY.md index entry.*
