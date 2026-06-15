# ARES — The Pantheon Overhaul (master spec)

Forensic inventory of every surface in the Hermes Agent screenshots, mapped to
Ares. Status: ✅ shipped · 🔶 partial · ❌ to build. Each ❌ names the layer it
lands in (UI-only / daemon protocol / core engine).

---

## 1. Shell & navigation

| Feature (Hermes) | Status | Ares mapping |
| --- | --- | --- |
| Left sidebar: New session (Ctrl+N) | 🔶 | Have button; add Ctrl+N accelerator |
| Sidebar nav: Skills & Tools page | ❌ | New page; daemon needs `skills_list` command (SkillsList tool exists in core — expose over NDJSON) |
| Sidebar nav: Messaging page | ❌ | Phase 3 — channels package exists (packages/channels); needs daemon bridge |
| Sidebar nav: Artifacts page | ✅ | The Vault (images/files/links across sessions, filter tabs, search, session jump) |
| Search sessions… field | ✅ | railSearch filters list live |
| PINNED section (shift-click pin, drag reorder) | 🔶 | Pin via hover ◇/◆ shipped; add drag-reorder + shift-click |
| SESSIONS with count + archive icon | 🔶 | List shipped; add count badge + archive (needs session persistence first) |
| Session title dropdown in top bar | ❌ | UI-only: rename session + quick-switch menu |
| Top-bar icons: voice, account, settings, right-panel toggle | 🔶 | Settings/panel exist in rail; move to titlebar icon cluster; voice = Phase 3 (sidecar exists) |
| Global search overlay (sessions, views, actions) | 🔶 | Ctrl+K palette covers actions+sessions; unify with Usage/System views |

## 2. Status bar

| Feature | Status | Mapping |
| --- | --- | --- |
| Gateway ready indicator | ✅ | Garrison segment → panel (status/log/restart/stop) |
| Agents indicator/panel | ❌ | Subagent activity lives in transcript; add a status-bar Agents popover listing live subagents (subagent_start/end events already folded) |
| Cron indicator/panel | ❌ | Operator auto-tick exists; add popover: active goals, last tick, next tick (daemon `operator_status` command) |
| Model + effort dropdown in status bar | ✅ | Model hot-swap popover + reasoning popover |
| Token badge with live count | 🔶 | Have ↑/↓ per session; add all-time counter + click → Usage view |
| Version chip | ✅ | |

## 3. Usage dashboard (palette view)

All ❌ — new "Usage" page (UI + daemon `usage_stats`):
- Range chips 7d/30d/90d
- Stat cards: Sessions · API calls · Tokens in/out · Est. cost
- Daily tokens bar chart (input/output stacked)
- Top models table (tokens + cost per model)
- Top skills table
- Data source: session events.jsonl already persists usage per turn under
  `<workspace>/.ares/sessions/*/events.jsonl` — daemon aggregates, UI charts.
  Cost table needs a per-model price map (ship a curated one, editable).

## 4. Composer

| Feature | Status | Mapping |
| --- | --- | --- |
| Model dropdown grouped by provider, searchable | ✅ | ModelPopover |
| "Edit Models…" footer entry | ❌ | Opens Settings > Model |
| Per-model OPTIONS flyout: Thinking toggle | ❌ | Maps to reasoning on/off — daemon `reasoning` accepts level only; add `off` |
| EFFORT submenu: Minimal/Low/Medium/High/Max | 🔶 | We have low/med/high/max popover; add minimal; nest into model flyout |
| Mic button (voice input) | ❌ | Phase 3 — voice_service STT exists (ws://127.0.0.1:8765), wire push-to-talk |
| “+” attach button | ❌ | File pick → embeds path in message (daemon already ingests image paths/data-URLs) |
| Waveform send button | 🔶 | Styled send shipped; waveform idle animation optional |

## 5. Settings — left-nav shell (the big one)

Hermes: modal with nav [Model, Chat, Appearance, Workspace, Safety, Memory &
Context, Voice, Advanced | Gateway, API Keys, MCP, Archived Chats | About] +
search-settings field + import/export/reset.

Ares plan — same shell, our tabs (only ship real wired controls):

### 5.1 Model tab
- Main model: provider + model dropdowns + Apply (✅ have as drawer; move in)
- **Auxiliary models** (❌ core+daemon): per-task model override table.
  Ares internal tasks to expose: Apply-edits slot, Summarizer slot (both exist
  in OllamaCloudPool), Title gen, Verifier digest, Recall/memory, Subagent
  default. Needs: core ModelTask routing honors per-task overrides from
  ui.json; daemon `aux_models` command; UI table w/ "Set to main"/Change.
- Context Window override (❌ — contextBudgetTokens is per-provider fn; expose)
- Fallback models, comma-sep (❌ core: provider fallback chain on error)
- Routing lanes (✅ war table — ours, keep; Hermes has no equivalent)

### 5.2 Appearance tab
- Color mode Light/Dark/System (❌ — we are dark-native; ship Dark + Darker/OLED)
- Tool Call Display: Product / Technical (✅ shipped)
- Theme gallery with preview swatches (❌ — accent palettes: Bronze (default),
  Crimson Banner, Steel Legion, Nightfall; CSS var swap, preview cards)
- Backdrop picker (our addition): painted helm / astrolabe only / none (❌ easy)

### 5.3 API Keys tab
- Searchable registry, sections LLM providers / Tools, per-row: name chip
  (Set/Not set), description, Docs link, Set/Replace/reveal/delete.
- Ares rows now: Anthropic, OpenRouter (LLM); Brave Search (tool). 🔶 have
  plain fields; rebuild as registry UI. Add as wired: OLLAMA_HOST override.
  Future tool keys land here (ElevenLabs TTS optional, GitHub token for
  SkillCraft publishing, Exa).

### 5.4 Advanced tab (❌ — daemon `engine_config` command + ui.json)
Real, wireable knobs that exist in our engine today:
- Max agent turns (maxTurns, default 200)
- Gather-stall rounds (ARES_GATHER_STALL_ROUNDS, default 10)
- Tool result char cap (ARES_TOOL_RESULT_CHARS, default 24k)
- Command timeout (Bash/PowerShell tool timeout)
- Checkpoint limit (checkpoints pruning)
- Operator auto-tick on/off + interval (ARES_OPERATOR_AUTOTICK / _TICK_MS)
- Subagent block: parallel subagents cap, subagent turn limit, subagent model
  (subagents.ts has defaults — expose)
- API retries (provider retry count)
Persist all in ui.json; daemon reads at session create; some need engine cfg
plumbing (small, mechanical).

### 5.5 Memory & Context tab (❌ UI; agent layer exists)
- Show MEMORY.md / IDENTITY.md / SOUL.md with edit-in-place (ARES_HOME files)
- Recall on/off, dream schedule display, memory counts (vector store stats —
  `ares memory stats` exists as CLI; expose via daemon)

### 5.6 Safety tab (❌ UI; engine exists)
- Permission mode display + dangerous-bypass toggle (uiSettings.dangerousBypass)
- Allowlist viewer (stored path grants), revoke entries
- The Gate history (recent permission decisions)

### 5.7 Workspace tab (❌)
- Current workspace path + change (daemon restart w/ --workspace)
- Recent workspaces list
- Open in Explorer / terminal buttons

### 5.8 MCP tab (❌ UI; tools exist)
- Parse .ares/mcp.json + ~/.ares/mcp.json, list servers, status ping,
  add/remove server form (writes the json), tool count per server

### 5.9 Voice tab (Phase 3 ❌)
- Sidecar status (port 8765), voice picker (GET /voices), speed, TTS on/off
  for replies, push-to-talk binding

### 5.10 Archived Chats (❌ — needs session persistence, below)
### 5.11 About (🔶 — version/links; add update check + credits)
### Footer: import / export / reset settings (❌ — ui.json + prefs JSON file)

## 6. Skills & Tools page (❌ — Phase 2 flagship)
- Tabs: Skills / Toolsets
- Category chips with counts (derive from skill frontmatter tags)
- Rows: name, description, enable toggle
- Backing: ~/.ares/skills/* (SkillsList/SkillRead/RunSkill + SkillCraft exist).
  Daemon commands: `skills_list`, `skill_toggle`. Enabled-set persists ui.json.
- Toolsets tab: tool groups on/off (web, browser, shell, self-evolve) →
  daemon builds tool list per session from enabled set.
- Hermes ships skills that delegate to claude-code/codex/opencode CLIs — ours:
  skill templates that delegate to `claude`, `codex` CLIs when installed (ship
  3 starter skills via SkillCraft seed).

## 7. Artifacts page (✅ shipped as the Vault)
Remaining polish: ❌ per-image Chat deep-link scrolls to the exact item; ❌
counts pagination footer ("1-N of M"); ❌ persist across app restarts (below).

## 8. Session persistence & resume (❌ — the structural unlock)
Hermes sessions survive restarts. Ares core already persists every session to
`<workspace>/.ares/sessions/<id>/{meta.json,events.jsonl}` and has
listSessions/loadSessionSnapshot. Plan:
- daemon `sessions_list` + `session_resume {id}` (rebuild Session with
  initialMessages from snapshot)
- UI hydrates the rail from sessions_list at boot; vault aggregates from disk
- Unlocks: Archived chats, pinned persistence, Usage dashboard history.

## 9. Messaging page (Phase 3 ❌)
packages/channels exists (telegram/discord-style connectors). Daemon bridge +
inbox UI. Scope after Skills + Usage.

## 10. Chat surface deltas

| Feature | Status |
| --- | --- |
| Wordmark empty state + taglines | ✅ (rotate taglines ❌ trivial) |
| Painted backdrop | ✅ helm artwork shipped |
| Product/Technical tool cards | ✅ |
| Inline images / diff cards / todo panel / subagent lanes | ✅ |
| Stop button / interrupt | ✅ |
| Session title dropdown + rename | ❌ |
| Per-turn copy button / retry turn | ❌ (retry = resend last user msg) |
| Citations chip row under researched answers | ❌ (doctrine emits links; chip-ify) |

---

# Build order

- **Wave 2 (next):** Settings left-nav shell with Model/Appearance/Keys/
  Advanced/Safety/About + engine_config daemon command + theme accents +
  import/export. Session persistence + resume (daemon sessions_list/resume).
  Ctrl+N, session rename/dropdown.
- **Wave 3:** Skills & Tools page + daemon skills commands + starter delegate
  skills. Usage dashboard + usage_stats aggregation. Status-bar Agents + Cron
  popovers (operator_status).
- **Wave 4:** Aux-models routing in core; fallback chain; MCP tab; attach
  button; minimal-effort + thinking toggle.
- **Wave 5:** Voice (PTT + spoken replies via sidecar), Messaging, Memory &
  Context editor, Archived chats, drag-reorder pins.
