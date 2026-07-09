# M3TA / Ares Codex Rules

## Source of truth

Work from the nearest `AGENTS.md` first, then:

1. `docs/BLUEPRINT.md`
2. `docs/CODEX_BUILD_SPEC.md`
3. `docs/DEVELOPMENT.md`
4. `docs/PACKAGE_BOUNDARIES.md`

If a doc and the current code disagree, inspect the current code before changing behavior. Treat stale roadmap docs as context, not proof.

## What this repo is

This repository is Ares/M3TA: a TypeScript coding-agent harness with a CLI, Garrison daemon, Telegram channel bridge, operator loop, memory layer, and optional Tauri desktop shell.

Core boundaries:

- `packages/protocol`: wire types only; no runtime dependencies.
- `packages/core`: session/query/provider/workspace engine.
- `packages/tools`: one file per tool.
- `packages/garrison`: localhost daemon, gateway, approvals.
- `packages/channels`: Telegram and other channel bridges.
- `packages/agent`, `packages/mind`, `packages/operator`: identity, memory, durable goals.
- `tauri`: desktop companion.

## Discovery

Use codebase-memory MCP before normal code search for code exploration:

- `search_graph` / `search_code` to find symbols or routes.
- `trace_path` for call chains.
- `get_code_snippet` for exact source after locating a symbol.
- `get_architecture` for high-level structure.
- `index_repository` first if this checkout is not indexed.

Use shell search for docs, configs, generated files, and literal error output. Always read a file before editing it.

## Coding rules

- Keep changes narrow and reversible.
- Preserve strict TypeScript and ESM.
- Do not add dependencies unless the existing stack cannot solve the problem.
- Keep runtime state out of the repo. Durable local Ares state belongs under `~/.ares`.
- Do not print, commit, paste, or move secrets, tokens, cookies, API keys, or auth files.
- Preserve provider IDs and auth flows. ChatGPT OAuth stays in the native device-code flow; do not inline tokens into config.
- Follow the build spec's intent: streaming tool loop, real tool schemas, no fake model names, no monolithic tool runtime.

## Validation

Prefer the narrowest useful check first:

```bash
pnpm build
pnpm check
pnpm test
pnpm verify
```

For CLI behavior, run the relevant `pnpm ares ...` command after `pnpm build`. For local bridge/device status, run:

```bash
pnpm codex-life:check
```

## Phone / channel bridge rules

The owner wants phones connected to the Ares/Codex workflow. Current bridge surfaces are:

- Ares Garrison: `pnpm ares garrison serve` on port `7421` by default.
- Telegram bridge: enabled with `ARES_TELEGRAM=1`, `ARES_TELEGRAM_BOT_TOKEN`, `ARES_TELEGRAM_ALLOWED_CHATS`, and optionally `ARES_TELEGRAM_CHAT_ID`.
- DuoPlus cloud phones: existing live capture tooling lives in `/Users/growthgod/VAN/mattclone-duo/mattclone_duo`, not in this repo.
- Local ADB: use the actual installed binary if `adb` is not on PATH: `/opt/homebrew/Caskroom/android-platform-tools/36.0.2/platform-tools/adb`.

Do not power on, start, lease, wipe, post from, like, follow, comment, or spend against cloud phones without explicit approval. Read-only health checks, frame capture for already-running phones, and local daemon/browser repair are acceptable.

If DuoPlus frame capture fails with a 401, the session is expired. Re-login in the persistent Chrome profile and recapture the session; do not copy tokens into docs or chat.
