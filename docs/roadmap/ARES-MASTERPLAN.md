# ARES — Masterplan to blow it out of the water (complete)

The definitive revamp spec. Deep analysis of the whole project + every issue
raised, root-caused against real files, turned into an executable punch list for
Opus. Nothing here is hand-waving — every item names the file/line it lives in
and the acceptance criteria that prove it's done.

**Effort:** S (hours) · M (a day) · L (multi-day). **Impact:** ★ (nice) →
★★★ (transformational).

The brutal truth: **the UI is now far ahead of the agent's competence and the
session architecture is fundamentally single-threaded.** It looks elite but (a)
all chats secretly share ONE daemon session, (b) it re-renders the whole
transcript on every keystroke, (c) it can't open a browser or touch the desktop,
and (d) it shows files only after they're written. Fix the architecture first,
then competence, then polish.

---

# TIER 0 — Architecture: the session engine is broken

## 0.1 Per-instance chats — the daemon has only ONE session  ★★★ L
**Problem:** "my friend sent a message to one chat, clicked another, and it
started responding in the other one." Multiple agents bleed into each other.
**Root cause (confirmed):** [entry.ts:2191](packages/cli/src/entry.ts) creates a
single `let live: LiveSession`, and every `send` ([entry.ts:2451](packages/cli/src/entry.ts))
drives that one session. The UI renders many "session" cards but they all map to
the **same** daemon Session. When you switch the active UI card mid-turn, the
in-flight stream keeps emitting and the UI's `apply()` ([App.tsx ~870](tauri/src/App.tsx),
routes by `activeRef.current`) dumps those events into whatever card is now
focused. Result: cross-talk, lost context, broken state.
**The fix — a multi-session daemon:**
1. Replace the single `live` with a **`Map<sessionId, LiveSession>`** in the
   daemon. Every command carries a `sessionId`; the daemon routes to (or lazily
   creates) that session's `LiveSession`.
2. Each NDJSON event the daemon emits is **tagged with its `sessionId`** so the
   UI routes by id, never by "active card."
3. New commands: `session_open {id, provider, model}`, `session_close {id}`.
   `send` becomes `{type:"send", sessionId, goal}`. Per-session
   reasoning/routing overrides allowed.
4. Sessions run **concurrently** — turn A streams while turn B streams; each has
   its own QueryEngine, abort signal, tool registry, checkpoints. (Shell
   registry/todo state become per-session too — today they're daemon-global,
   noted in the V1 daemon comment.)
5. The UI `apply()` switches from "active card" routing to **`bySessionId`**
   routing. A background session keeps streaming into its card while you read
   another — exactly like ChatGPT/Claude tabs.
**Acceptance:** open 3 chats, fire long tasks in all 3, switch between them
freely — each updates independently, zero bleed-over, all finish correctly.

## 0.2 Interrupt-to-steer (queue a message mid-turn)  ★★★ M
**Problem:** Want to steer like GPT/Claude — send a message while it's working;
it queues, and folds the steer in at a good moment (after a tool call) so it
acknowledges without losing its place.
**Root cause:** Today `send` while busy either errors or is dropped; there's no
mid-turn user-message injection. Interrupt exists (0.x done earlier) but it
*kills* the turn rather than *steering* it.
**The fix:**
1. A **`steer {sessionId, text}`** command. The daemon enqueues it on that
   session. At the next safe boundary — **after the current tool batch
   completes, before the next model call** (the engine's loop top in
   [queryEngine.ts](packages/core/src/queryEngine.ts) streamTurn) — inject the
   steer as a high-priority user `system_reminder` ("The user just added: …
   adjust course but keep your current objective") so the model acknowledges and
   continues with full context.
2. UI: when busy, the send button becomes **"＋ Steer"** (distinct from Stop).
   Typing + Enter mid-turn queues a steer; a chip shows "1 steer queued." The
   transcript shows the steer as a pending user bubble that "lands" when injected.
3. Keep hard **Stop** (interrupt) as the separate red button. Steer = nudge,
   Stop = halt.
**Acceptance:** during a multi-tool turn, send "actually use TypeScript" — it
appears queued, gets acknowledged after the in-flight tool, and the turn adapts
without restarting.

## 0.3 Chat re-renders on every keystroke (images flicker, can't scroll)  ★★★ M
**Problem:** "every time you type a character it refreshes images and shit, and
you can't scroll while it's working."
**Root cause (confirmed):** `draft` (composer text) is App-level state
([App.tsx:843](tauri/src/App.tsx)); `value={draft}` on the textarea. Every
keystroke `setDraft` → re-renders the **entire App**, including the whole
transcript and every `<img>` (which re-fetches/flickers). `ItemView` is not
memoized; the `.map` re-runs wholesale. Streaming events also re-render
everything, and autoscroll fights manual scroll.
**The fix:**
1. **Isolate the composer** into its own component with local `useState` for the
   text — keystrokes never touch the transcript tree.
2. **Memoize the transcript**: `React.memo` on `ItemView`/`ToolGroup`/`DiffCard`
   keyed by a stable item id + a content hash; only the changed item re-renders.
   Images get a stable `key` + `loading="lazy"` + cached object URLs so they
   never re-fetch.
3. **Scroll containment**: track "is the user near the bottom"; only autoscroll
   when they already are. While they've scrolled up to read, streaming does NOT
   yank them down — show a "↓ jump to latest" pill instead.
4. Throttle streaming-delta state updates (coalesce text deltas per animation
   frame) so a fast token stream doesn't thrash React.
**Acceptance:** type while a turn streams — no image flicker, the transcript
doesn't jump, scrolling up stays put, CPU stays low.

## 0.4 Streaming tool transparency (show it writing, live)  ★★★ M
**Problem:** "it programs the whole file then creates it — we need it quicker
and cleaner, fully in the loop as it does everything."
**Root cause (confirmed):** the protocol has `tool_use_input_delta`
([queryEngine modified types]) but the daemon surfaces `tool_start` only with the
**complete** assembled input (`tool_use_input_done`). So a Write's content
appears only when finished. The UI never sees the file being authored.
**The fix:**
1. **Stream tool input deltas** to the UI: forward `tool_use_input_delta` as the
   model writes the tool args, so a Write/Edit shows its content materializing
   live in the tool card (and, for HTML/artifacts, the Forge preview can
   progressively update).
2. **Open the artifact card immediately** on `tool_start` for a Write to an
   HTML/SVG/holo file — a skeleton that fills in as content streams, then
   finalizes on `tool_end`. Forge preview hot-reloads when the file lands.
3. **Tighter tool cards** (clean transparency): a single live line per tool —
   `✎ Write · landing.html  ▍streaming…  +142` — expandable to the streaming
   body. No dump-then-reveal.
**Acceptance:** ask for an HTML page — the tool card shows it being written line
by line, the Forge opens and fills in progressively, no 10-second silent gap.

---

# TIER 1 — Agentic competence (why it failed the simple stuff)

## 1.1 The browser is broken in the installed app  ★★★ L
**Problem:** "open a browser" looped on a Playwright install for 10 minutes.
**Root cause (confirmed):** [playwrightBrowser.ts](packages/connectors/src/playwrightBrowser.ts)
dynamic-imports `playwright`, which is **externalized out of the runtime bundle**
([package-tauri-runtime.mjs:26](scripts/package-tauri-runtime.mjs)). The installed
app has NO browser, and the thrown error literally says `Run: pnpm add -w
playwright` — the model obeys, runs it in a non-repo workspace, it fails, it
retries forever. **The error message causes the loop.**
**The fix (three parts):**
1. **Bundle Chromium with the installer.** Post-build step runs `playwright
   install chromium` into a runtime resource dir; ship it as a Tauri resource;
   set `PLAYWRIGHT_BROWSERS_PATH` on daemon spawn (main.rs). Browser present on
   first launch, zero install.
2. **Kill the self-install advice.** Missing browser → a terminal, non-retriable
   error: "Browser unavailable — use WebFetch/ImageSearch/ComputerUse instead."
   Never an install command in an error string.
3. **Repeated-failure circuit-breaker** (engine): same tool + same error code N×
   in a row → inject "this approach is dead, change strategy or tell the user."
   The universal backstop for ALL tool death-loops.
**Acceptance:** fresh install, "open example.com and screenshot it" — works first
try, no install, no loop.

## 1.2 No computer-use — it can't touch the real desktop  ★★★ L
**Problem:** "delete a Chrome extension" — no idea what to do.
**Root cause:** Ares has a *headless DOM* browser only. It cannot control the
real machine — real Chrome, OS dialogs, `chrome://extensions`, pixels.
**The fix:**
1. **A `ComputerUse` tool** — screenshot the screen, move/click at coords, type,
   key-combos. Native Anthropic computer-use tool spec on Claude models; a
   cross-model fallback via `nut.js`/Windows UIA. THE capability that turns
   "agent that types" into "agent that operates your machine."
2. **A real-Chrome CDP driver** — launch/attach to the user's Chrome with
   `--remote-debugging-port`, drive the real browser with their logins, manage
   extensions (`chrome.management` via a companion, or navigate
   `chrome://extensions` + toggle).
3. **Doctrine:** an "operating the computer" section — when a task is about the
   user's machine/apps (not files/code), screenshot first, act on what you SEE,
   verify by screenshot.
**Acceptance:** "delete the X extension from Chrome" — it screenshots, navigates
extensions, removes it, confirms by screenshot.

## 1.3 It's not smart about strategy (10-min flails)  ★★ M
**The fix:** (a) the repeated-failure circuit-breaker from 1.1.3; (b) a
**re-plan injection** — when N tools fail in a turn, inject "step back: list what
you tried, what's blocked, 2 different approaches"; (c) a **pre-flight capability
probe** at session start — the daemon tests which heavy tools actually work
(browser? LSP? computer-use?) and injects a CAPABILITIES line so the model never
attempts a tool this build can't honor.

## 1.4 Business-operation readiness  ★★★ L
**Problem:** can't run a business if it can't delete an extension.
**The fix (depends on 1.1–1.2):** once browser + computer-use are real, add the
effector rails the Operator can pull — **email** (SMTP/IMAP or MCP), **payments**
(Stripe MCP), **deploy** (VPS/Vercel token), all gated by The Gate. Wire
**heartbeat → Operator tick** so missions advance overnight with a daily budget
cap (loop exists in [backgroundLoop.ts](packages/operator/src/backgroundLoop.ts);
connect to daemon + surface in the missions popover). Business doctrine:
decompose into milestone goals, each with a verification probe; act through
effectors; report daily.

---

# TIER 2 — Chat that shows, not just tells

## 2.1 Native tables, mermaid, charts  ★★★ M
**Problem:** "show tables and columns without programming in HTML." Markdown
tables render as raw `| --- |`, mermaid as raw code (both visible in screenshots).
**Root cause:** `renderMarkdown` (App.tsx) handles headings/lists/code/images but
**not tables, mermaid, or charts**.
**The fix:** (a) markdown `| a | b |` → themed `<table>` (bronze header, zebra,
sticky); (b) bundle `mermaid`, render ```mermaid blocks to themed SVG inline;
(c) a ```chart block → tiny inline bar/line renderer (no heavy dep); (d) doctrine:
"to show structured/visual info in chat use tables / ```mermaid / ```chart —
never an HTML file unless the user wants a standalone artifact."
**Acceptance:** "list your tools as a graph" draws a real diagram; "compare X/Y"
renders a real table — no raw markup, no HTML file.

## 2.2 Transcript polish  ★★ S
Per-message **copy** + **retry**; **citations chip row** under researched
answers; **syntax highlighting** in code blocks (tiny themed tokenizer).

---

# TIER 3 — Auth that actually works

## 3.1 Anthropic OAuth (Claude Max/Pro via browser)  ★★★ M
**Problem:** Anthropic is API-key only; want a browser popup to use the Max plan,
like OpenAI.
**Root cause:** [openaiAuth.ts](packages/core/src/providers/openaiAuth.ts) has a
full device-code OAuth; Anthropic has none (`AnthropicProvider` reads
key/env only).
**The fix:** implement **Anthropic OAuth PKCE** — open the system browser to the
authorize URL, capture the redirect on a localhost loopback listener, exchange
for tokens, persist + refresh. Mirror the openaiAuth structure. A **"Sign in with
Claude"** button in Settings triggers it (Tauri `shell.open` + loopback). Make
**OpenAI's existing OAuth** a one-click desktop button too (today it's CLI `ares
login`).
**Acceptance:** click "Sign in with Claude" → browser → approve → Anthropic
models stream on the subscription with no API key.

## 3.2 Provider catalog truth  ★★ S
Wire the newly-added **deepseek** + **ollama-cloud** keys (now in uiSettings)
end-to-end: provider branches in `selectProvider`, model fetchers, UI rows — same
pattern as OpenRouter/Brave. Every listed provider must actually authenticate +
stream + list models.

---

# TIER 4 — Control surfaces the user called out

## 4.1 Routing lanes need model PICKERS  ★★ S
**Problem:** "routing should show all models for each provider, not make me type
them." Routing lanes use a bare `<input>`.
**The fix:** drop the existing `ModelPicker` (provider-grouped, searchable,
live-fetched) into each lane. Pick provider → real model list. Zero memorization.

## 4.2 Theme system — a real revamp  ★★★ M
**Problem:** "themes don't really change much."
**Root cause:** themes only swap `--accent`; bg/surfaces/backdrop unchanged.
**The fix:** promote themes to **full palettes** — each sets `--bg`,
`--bg-raised`, `--panel`, `--text`, line opacities, AND a matching backdrop
treatment (Steel = cooler helm, Nightfall = blue-shifted, Crimson = ember-red,
Obsidian = near-black OLED, Parchment = light mode). Preview cards render the
actual surface. Cross-fade the root vars on switch.

## 4.3 Artifacts tab revamp  ★★ M
Bigger gallery with **lightbox** (full view, prev/next), inline file preview
(open in Forge), link cards with favicons + domains, animated type filters, a
"this session / all sessions" toggle, persistence across restarts (reads on-disk
store via `session_history`), and **drag-an-artifact-to-attach** onto the composer.

## 4.4 Settings animation + de-bland pass  ★★ S
Animated tab/pane transitions (slide/cross-fade), staggered row reveals, bronze
sweep on the nav, spring-physics toggles, hover-reactive hero mark, a satisfying
Apply confirm pulse.

---

# TIER 5 — Voice (Claude-desktop parity)

## 5.1 Speech-to-text input  ★★ M
**Problem:** "when I talk it should transcribe like Claude desktop."
**Root cause:** the voice sidecar ([voice_service/](voice_service/), ws://127.0.0.1:8765)
already has Whisper STT + Kokoro TTS, auto-started by main.rs — the UI never
wires the mic.
**The fix:** (a) **push-to-talk + live transcription** — mic button streams audio
to the STT ws, drops transcript into the input live (hold + toggle modes); (b)
**spoken replies** — pipe assistant text to the Kokoro TTS ws, speaker toggle in
the status bar; (c) a **Voice settings tab** — sidecar status, STT/TTS on/off,
voice picker (`GET /voices`), speed.

---

# TIER 6 — Structural unlocks (make it durable)

## 6.1 Session resume in the rail  ★★ M
Backend `session_history`/`sessions_list` exist; hydrate the rail from disk at
boot, click a past session → load its transcript, continue it (daemon rebuilds
the Session with `initialMessages`). Pairs with the multi-session daemon (0.1) —
each rail card is a real, independently-resumable session. Unlocks archived chats
+ persistent pins + usage history.

## 6.2 Skills & Tools as a first-class page  ★★ M
Promote the Settings skills tab to a full page (category chips with counts,
Skills/Toolsets tabs, enable toggles); ship 3 starter delegate-skills
(claude-code / codex / opencode) via a SkillCraft seed.

## 6.3 Per-task auxiliary model routing  ★★ M
Expose the internal task slots (apply-edits, summarizer, title-gen, verifier,
recall, subagent) as per-task model overrides — the Hermes "Auxiliary models"
table. Core has the slots; surface + persist the assignments.

---

# Execution order for Opus

**Phase A — fix the foundation (nothing else matters until these land):**
1. **0.1 multi-session daemon** — the per-instance bleed-over. Biggest fix.
2. **0.3 chat re-render perf** — composer isolation + transcript memo + scroll
   containment. Stops the flicker/jank.
3. **0.4 streaming tool transparency** — stream tool-input deltas, live artifact
   cards.
4. **0.2 interrupt-to-steer** — queue + safe-boundary injection.

**Phase B — competence:**
5. **1.1 bundle browser + kill install-loop + circuit-breaker.**
6. **1.3 strategy smarts** (re-plan + capability probe).
7. **1.2 ComputerUse + real-Chrome CDP** — the "delete my extension" capability.

**Phase C — show + auth:**
8. **2.1 native tables/mermaid/charts.**
9. **3.1 Anthropic OAuth** (+ one-click OpenAI).
10. **3.2 provider catalog truth.**

**Phase D — surfaces + polish:**
11. **4.1 routing pickers**, **4.2 full themes**, **4.3 artifacts**, **4.4 settings animation.**
12. **5.1 speech-to-text.**

**Phase E — durability + scale:**
13. **6.1 session resume**, **6.2 skills page**, **6.3 aux routing.**
14. **1.4 business effectors** (email/payments/deploy + overnight ticking).

Every item is grounded in a real file/line. Phase A is the architecture rewrite
that makes Ares behave like a real multi-agent app; everything after is built on
that foundation.
