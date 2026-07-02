# Ares working on Ares — project brief

You are working on your own codebase. The bar is elite: staged small diffs, every change verified, nothing claimed that wasn't run.

## Layout (pnpm + TypeScript monorepo, Windows-first)

- `packages/core` — the engine: `queryEngine.ts` (THE loop: budgeting, microcompact, retries, stall guard, todo gate), `session.ts`, `verifier.ts` (continuous verify + fingerprint cache + triage), `conductor.ts` (ultracode fleets), `subagents.ts` + `subagentJournal.ts`, providers under `providers/`.
- `packages/tools` — every tool (Edit, Write, Read, Grep, ComputerUse, WebFetch + `cdpRender.ts`, Conductor…). Tools are built with `buildTool` (zod schema + optional semantic `validateInput`).
- `packages/cli` — the product: `src/entry.ts` is a THIN dispatcher; all real code is in `src/entry/*` modules (daemon, chat, sessionFactory, turnPipeline = system prompt + mind hooks, engineTools, browserBridge, permissions, providers, terminalLines, operatorCmd, agentOps, introspect, garrisonCmd, mindCmd, telegramWiring, runtime). TUI in `src/inkTui.ts` + `src/mdRender.ts`.
- `packages/mind` — living memory: `memory/store.ts`, `memory/router.ts` (the ONLY write spine), `memory/consolidationLock.ts`, context compiler.
- `packages/agent` — agent runtime, `reflection/scheduler.ts` (the ONLY reflection timer owner), unified recall, dreaming, witness.
- `packages/operator` — goals/missions/capabilities, crucible (empirical trials), `leash.ts` (TrustGovernor), reality probes.
- `packages/protocol` — shared types (TurnEvent, ReasoningLevel…). `packages/effects` — rails/budget/killswitch. `packages/garrison` — server. `packages/channels` — Telegram.
- `tauri/` — desktop app (React in `tauri/src`, Rust in `tauri/src-tauri`). `tests/` — node:test files importing from **dist**.

## Build & verify (do this narrow → wide)

- Typecheck one package + its deps: `npx tsc -b packages/<name>` — do this after edits, it's fast.
- Tests import from `dist`, so **build before testing**. Targeted: `node --test tests/<relevant>.test.mjs`.
- Full gate before declaring a task done: `pnpm verify` (build + all tests). The suite must be 100% green — a single new failure is YOUR failure until proven otherwise.
- Desktop frontend: `cd tauri && npx tsc --noEmit -p tsconfig.json`. Eval harness: `node tests/eval/runner.mjs` (mock).

## House rules

- **Memory writes go through `MemoryRouter`** (packages/mind/src/memory/router.ts) — never call `store.add` directly. Consolidate/deep-dream must run under `withConsolidationLock`. No `setInterval` outside `reflection/scheduler.ts` in agent/mind.
- **entry.ts stays thin.** New CLI behavior goes in the right `src/entry/*` module; new commands get a module + a dispatch case.
- Match the house style: dense doc-comments explaining WHY, minimal inline comments, no new dependencies without a strong reason, additive public APIs.
- Every behavior change ships with a test in `tests/` (node:test, dist imports, fakes/temp dirs — copy a neighboring test's pattern).
- Windows first: paths with `path.join`, spawn with `windowsHide: true`, PowerShell quirks are real. CI also runs Linux.
- Env knobs are the tuning surface (`ARES_*`) — add one for any new threshold, document it in the same commit.

## Danger zones (read twice before editing)

- `queryEngine.ts` — everything flows through it. Small, staged, heavily-tested edits only.
- `credentials.ts`, `secretRedact.ts`, permission stores — security-sensitive; never weaken defaults.
- The updater/release path (`tauri` signing, version bumps) has strict rules — see docs and ask the owner before touching release machinery.
- The working tree may hold large uncommitted work — NEVER `git checkout/reset/stash/clean` without explicit owner instruction.
