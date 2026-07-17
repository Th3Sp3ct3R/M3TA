# Codex Plugin: Claude Code Orchestrator

> **Status:** Draft — grounded in the current repo (verified 2026-07-16).
> **Audience:** Codex (the in-repo coding-agent harness) + the owner.
> **Goal:** Make a Claude Code agent (`agt_VM1ePscMomft`) the **orchestrator**
> for Codex tasks, and check whether the Codex plugin surface already supports
> writing that code. If not, ship the minimum missing piece.

---

## 1. Question this plan answers

> "Be the orchestrator and see if we have the Codex plugin to write the code for
> making the plan."

That is two questions fused:

1. **Can Claude Code orchestrate Codex today?** — i.e. can it drive multi-step
   work in this repo through the harness, or is it stuck reading files?
2. **Does the Codex plugin surface exist** (in-repo) to write the orchestrator
   code?

Both are answered below against the **current** tree, not stale roadmap docs.

---

## 2. Audit — what exists, what doesn't

### 2.1 Codex plugin surface (in-repo)

Codex is the engine exposed by `packages/core` (QueryEngine + subagents + forkedTurn +
provider adapters) and surfaced through `packages/cli` (`pnpm ares …`) and
`packages/garrison` (daemon on `:7421`). The plugin-ability boundary is
**`packages/core/src/subagents.ts`** + **`packages/core/src/forkedTurn.ts`**:

- `SubagentTypeDef` — name, tool whitelist, system prompt, `modelPreference`
  (`"fast" | "inherit"`), `maxTurns`. Built-ins: `general-purpose`,
  `researcher`, `code-reviewer`.
- `SubagentRunner.run(SubagentRunRequest)` returns a `SubagentRunResult`
  (summary + flight-recorder `handoff` + persistent transcript under
  `<workspace>/.ares/agents/<id>/`).
- `runForkedTurn({ config, sessionId, seed, onEvent })` is the **single**
  primitive every autonomous driver must use. It guarantees (a) a fresh
  `fileReadStamps` map per child, and (b) a `work-item` seed by default so
  autonomous forks are distinguishable from chat turns.

That is the canonical Codex "plugin slot" today. Adding a new orchestration role
(Claude Code) means **registering a new `SubagentTypeDef`** (and, if needed, an
orchestrator layer above the registry).

### 2.2 What is **missing** for the Claude Code orchestrator use case

| Gap | Why it matters | Severity |
|---|---|---|
| **No "orchestrator" subagent type** | Codex has only leaf subagents (researcher / reviewer / general-purpose). Nothing today is allowed to *spawn* other subagents — there is no parent-of-parent role. | **blocks** |
| **No `modelPreference: "delegate"` lane** | Claude Code is a *different model family* (Anthropic-native tool-use). The current `"fast" \| "inherit"` enum is provider-relative, not agent-relative. | **blocks** |
| **No routing key for a remote agent id** | The registry keys on `name: string`. To dispatch to `agt_VM1ePscMomft` we need a transport field (`remoteAgentId?` / `transport?`) that the runner resolves to an Anthropic Messages call into that agent's session. | **blocks** |
| **No turn-stream fan-out back to parent UI** | `ForkedTurnResult` carries `events: TurnEvent[]`, but the orchestrator use case wants to forward child progress into the parent UI like any other tool. There is no `subagent_progress` hook in the engine's event union — only `onEvent` callbacks. UI surfacing is not first-class. | nice-to-have |
| **No Codex-side auth for a remote Anthropic agent id** | Ares already supports ChatGPT device-code OAuth and Anthropic provider auth (`packages/core/src/providers/anthropicAuth.ts`). A Claude Code session id as a routing target is new and should ride the existing Anthropic auth, not a new flow. | small |

### 2.3 What already works in our favor

- `runForkedTurn` is the **single fork primitive** — every autonomous driver
  already goes through it. Orchestrator's leaf invocations will too, no
  duplicate lifecycle code.
- `SubagentJournal` + `renderSubagentHandoff` already produce a flight-recorder
  handoff so the parent gets *what the child did*, not what its prose claims.
- Cache-safe params (per `CLAUDE-CODE-PORT-STUDY.md` §3.1) are noted but not yet
  wired; the orchestrator design should **not** bake in fresh-context-per-call
  if we want to keep provider-cache hits across the plan.

---

## 3. Verdict on the user's question

> "see if we have the Codex plugin to write the code for making the plan"

- The Codex **plugin slot exists** (`SubagentTypeDef` registry +
  `runForkedTurn`). New subagent types can be registered without a refactor.
- The Codex **orchestrator role does not exist yet** — current types are all
  leaves, none spawn further subagents.
- **Net answer: the plugin slot is here, the orchestrator wiring is not.**
  We can write the plan in-repo by **registering a new `SubagentTypeDef` named
  `claude-code-orchestrator`** and giving the runner the ability to dispatch to
  the Anthropic Messages API keyed on a remote agent id.

---

## 4. Target design — minimum viable orchestrator

### 4.1 New subagent type

```ts
SubagentRegistry.register({
  name: "claude-code-orchestrator",
  description:
    "Remote Claude Code agent (e.g. agt_VM1ePscMomft). Use this when a task needs multi-step planning, cross-package refactors, or design review that benefits from a dedicated planner. Returns a structured plan; does not edit files.",
  toolWhitelist: ["Read", "Grep", "Glob", "CodebaseSearch"], // read-only by default
  systemPrompt: ORCHESTRATOR_PROMPT,                        // see §4.2
  maxTurns: 25,
  modelPreference: "inherit",                               // run on the parent's frontier model lane by default
  transport: { kind: "anthropic-agent", remoteAgentId: "agt_VM1ePscMomft" },
});
```

### 4.2 System prompt skeleton (for `ORCHESTRATOR_PROMPT`)

The orchestrator's job is **plan, do not patch**. It should:

1. Re-read every file path it cites before claiming a fact.
2. Output a plan in the shape the existing roadmap docs use
   (`Goal / Context / Phases / Validation`).
3. Cite every step with `file_path:line`.
4. End with a `## Hand-back` block that names the next concrete code edit
   the parent (Codex) should perform — that is the contract between
   orchestrator and runner.

### 4.3 Transport — `anthropic-agent`

`packages/core/src/providers/anthropic.ts` already wraps Messages. Add a
sibling `packages/core/src/providers/anthropicAgent.ts`:

- Input: `{ remoteAgentId: string; prompt: string; tools: Anthropic.Tool[]; signal: AbortSignal }`.
- Output: `{ finalText: string; usage: Usage; toolEvents: ToolUseBlock[] }`.
- Auth: reuse `anthropicAuth.ts` — **do not** introduce a new device-code
  flow for a remote agent id; the user already authenticates Anthropic in
  Codex. The remote agent id is a routing hint, not a credential.
- Streaming: emit `TurnEvent`s that look like a normal Codex turn
  (`text_delta`, `tool_start`, `tool_end`, `turn_end`) so the parent's
  `onEvent` hook can forward progress without a new event union.

### 4.4 Why this respects `PACKAGE_BOUNDARIES.md`

- `packages/protocol` stays wire-types only — no new types needed
  (`Usage` and `TurnEvent` already cover the surface).
- `packages/core` gets the new transport (`anthropicAgent.ts`) and a small
  registry extension (`transport?: ...`). No boundary crossing.
- `packages/tools` and `packages/agent` are untouched. The orchestrator is a
  subagent type, not a tool or a mind subsystem.
- `packages/cli` may eventually add a slash-command
  (`/plan <goal>`) that dispatches to the orchestrator — but that is a UI
  convenience and out of scope for v1.

---

## 5. Phased delivery

| # | Phase | Where | Acceptance |
|---|---|---|---|
| **0** | **Land this plan doc** | `docs/roadmap/NEXT-CODING-ORCHESTRATOR.md` | doc committed |
| 1 | Add `transport` field to `SubagentTypeDef` and to the registry | `packages/core/src/subagents.ts` | TS builds; existing types unchanged |
| 2 | Implement `anthropicAgent` transport (Messages streaming, `tool_use` extraction, usage) | `packages/core/src/providers/anthropicAgent.ts` | unit tests against a recorded response; no live calls in CI |
| 3 | Wire `SubagentRunner.run` to honor `transport`; fall back to local `runForkedTurn` when unset | `packages/core/src/subagents.ts` | integration test: orchestrator runs, returns `SubagentRunResult`, `handoff` populated |
| 4 | Register `claude-code-orchestrator` type with `remoteAgentId: "agt_VM1ePscMomft"` | `packages/core/src/subagents.ts` (built-ins block) | `pnpm ares tools list` shows the new type |
| 5 | Smoke test: parent Codex run issues a `Task(subagent_type="claude-code-orchestrator", …)`; orchestrator returns a plan; parent writes a doc under `docs/roadmap/` and exits | manual end-to-end via `pnpm ares` | transcript in `<workspace>/.ares/agents/<id>/` |
| 6 | (Optional) `/plan <goal>` slash command in the CLI | `packages/cli/src/entry/turnPipeline.ts` | non-blocking UX |

Phases 1–4 are the minimum for the user's literal request
("orchestrator + plugin to write the plan"). Phase 5 is the validation
gate. Phase 6 is nice-to-have and only after 1–5 are stable.

---

## 6. Risks and what we will *not* do

- **Will not** copy code from the Claude Code source tree
  (`~/Downloads/claude-code-main`). Per `CLAUDE-CODE-PORT-STUDY.md`'s
  licensing note: re-implement strategies, never verbatim copy.
- **Will not** introduce a new auth flow. Anthropic auth already lives in
  Codex. The remote agent id is a routing hint.
- **Will not** give the orchestrator write tools in v1. Plans only; the
  parent Codex run does the edits. This keeps blast radius small and
  matches the user's framing ("write **the plan**").
- **Will not** change `runForkedTurn`'s two invariants (fresh
  `fileReadStamps`, `work-item` default seed). Orchestrator's leaf calls
  still go through it.
- **Risk: cache fragmentation.** Each orchestrator call today pays a full
  prompt-cache miss because the transport is fresh-context. Mitigation is
  out of scope for v1; flagged for the cache-safe-params item in
  `CLAUDE-CODE-PORT-STUDY.md` §3.1.

---

## 7. Validation checklist (after implementation)

```bash
pnpm build
pnpm check
pnpm test
pnpm verify
pnpm ares tools list                  # shows claude-code-orchestrator
pnpm ares task --type claude-code-orchestrator --prompt "Plan: …" \
  --workspace /Users/growthgod/M3TA
pnpm codex-life:check
```

The Task tool should return a structured plan with file:line citations and
a `## Hand-back` block naming the next concrete edit.

---

## 8. Pointers (source-of-truth ordering from AGENTS.md)

1. `AGENTS.md` — root rules (read first).
2. `docs/BLUEPRINT.md` — overall architecture.
3. `docs/CODEX_BUILD_SPEC.md` — coding-agent invariants (the orchestrator
   must respect them; chief among them: streaming tool loop, real tool
   schemas, no fake model names, no monolithic tool runtime).
4. `docs/DEVELOPMENT.md` — package commands and validation flow.
5. `docs/PACKAGE_BOUNDARIES.md` — boundary rules this plan obeys.
6. `docs/CLAUDE-CODE-PORT-STUDY.md` — design reference (strategies, not
   code to copy).
7. `packages/core/src/subagents.ts`, `forkedTurn.ts` — the plugin slot we
   extend.