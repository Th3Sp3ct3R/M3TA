# Ares Architecture

Ares is a TypeScript-first coding-agent harness. The CLI is the composition root; the packages under `packages/` provide focused runtime layers, and `tauri/` provides the optional desktop companion.

## Runtime Flow

1. `@ares/cli` parses commands, selects providers, loads permissions/settings, registers tools, and starts terminal or headless runs.
2. `@ares/core` owns sessions, streaming turn orchestration, provider adapters, checkpoints, hooks, verification helpers, and subagent execution.
3. `@ares/tools` exposes local tools used by the session engine.
4. `@ares/agent`, `@ares/mind`, `@ares/operator`, `@ares/effects`, and `@ares/connectors` add durable identity, living memory, goal execution, side-effect rails, and browser automation.
5. Durable state is stored outside the source tree by default under `%USERPROFILE%\.ares`.

## Packages

- `@ares/protocol`: shared message, event, tool-call, permission, checkpoint, and reasoning types.
- `@ares/core`: provider-neutral engine layer. Depends on protocol and should not depend on CLI, agent, operator, mind, effects, or connectors.
- `@ares/tools`: tool catalog and shared execution helpers. Depends on core/protocol contracts.
- `@ares/agent`: identity scaffold, persistence, recall, heartbeat, dreaming, missions, self-model, and skill runtime.
- `@ares/mind`: living memory store, cognition helpers, intent classification, and memory diagnostics.
- `@ares/operator`: durable goals, scheduler, capability acquisition, control loop, attention selection, and background execution.
- `@ares/effects`: budgets, ledger, kill switch, owner leash, and guarded effect execution.
- `@ares/connectors`: browser connector and browser effect integration.
- `@ares/cli`: command-line entrypoint, terminal UI, provider routing, command handlers, and tool registration.
- `@ares/garrison`: the always-on daemon — session manager (sessions outlive clients and reboots via rollout rehydration), localhost WebSocket+HTTP gateway (wire protocol v1, token auth), and the scheduler whose dream tick runs the Crucible trial. Boot with `ares garrison serve`; attach with `ares attach`.
- `@ares/channels`: channel bridges as pure gateway clients (Telegram first — sessions per chat, approvals as inline keyboards).

## The Crucible (V5-V8)

Ares is the battle-tested agent: learning is empirical, not archival.

1. **Witness** (V5, `agent/crucible/witness.ts`) — after each substantive turn, a cheap sideQuery fork reviews the conversation and proposes candidate hypotheses (belief / user_fact / feedback / procedure), each optionally carrying a falsifiable check. Deterministic intake validates, dedupes, and caps; candidates land in living memory with `status: "candidate"`.
2. **Consequence wiring** (V6, mind schema v3) — recall threads the injected node ids through the turn; at turn end every artifact in play gets the outcome recorded (`recordOutcome`): wins reinforce, losses weaken multiplicatively, evidence accumulates (capped at 20). Strength tracks usefulness, not recall popularity.
3. **Crucible trials** (V7, `operator/crucible.ts`) — `ares mind crucible`, and every Garrison dream tick: candidates face their checks (run as reality probes) and records; survivors promote to confirmed, losers archive with the failure reason written back as a post-mortem memory, confirmed knowledge with a failing check is demoted. Deterministic; no model opinion in the trial.
4. **Leash dividend** (V8, `operator/leash.ts`) — in guarded mode (`dangerousBypass: false`), the TrustGovernor derives each domain's effects leash from the Crucible: 1 + confirmed procedural nodes with net-positive records (cap 5). Every change lands in `leash.jsonl` with the records that justified it. Learning and safety are one system.

The rule everywhere: **deterministic spine, LLM judgment, deterministic verification.**

## Desktop Companion

`tauri/` is a separate workspace package for the desktop UI. It shells into the built CLI entrypoint, so desktop runs require the TypeScript packages to be built first.

## Current Pressure Points

- `packages/cli/src/entry.ts` is intentionally left unchanged for now, but it is the largest composition file and should be split after this cleanup phase.
- `@ares/effects` and `@ares/operator` currently import path or file helpers from `@ares/agent`. That boundary should be fixed in a later pass by moving shared home/path/write helpers into a neutral layer.
- `packages/core/src/providers/ollamaCloud.ts`, `packages/core/src/queryEngine.ts`, and the Tauri UI files are large but should not be refactored until there are targeted regression checks.
