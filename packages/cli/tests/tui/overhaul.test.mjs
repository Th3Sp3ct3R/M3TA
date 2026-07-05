// Main-UI overhaul — live tool cards, parallel-batch banner, output previews,
// markdown prose, stream cursor, slate toolbar, header model-chip geometry.
import test from "node:test";
import assert from "node:assert/strict";
import { h, frame, strip, fg } from "./helpers.mjs";

import { SLATE } from "../../dist/ui/theme.js";
import { Transcript, LogRow } from "../../dist/ui/chat/LogRow.js";
import { Header } from "../../dist/ui/chat/Header.js";
import { Toolbar } from "../../dist/ui/chat/Toolbar.js";
import { StatusBar } from "../../dist/ui/chat/StatusBar.js";
import { ChatMain } from "../../dist/ui/chat/ChatMain.js";
import { toolbarHitTest, slateModelSpan, SLATE_HEADER_MODEL_ROW, textWidth } from "../../dist/tuiChrome.js";

test("tool card: RUNNING renders a spinner + live elapsed in active amber", () => {
  const f = frame(h(LogRow, { theme: SLATE, line: { tone: "tool", name: "WebSearch", text: "searching the web", running: true, elapsed: "2.3s" }, tick: 0, width: 70 }));
  const s = strip(f);
  assert.match(s, /⠋ WebSearch │ searching the web {2}2\.3s/);
  assert.ok(f.includes(fg(SLATE.active)), "spinner + elapsed in active amber");
  assert.ok(!s.includes("✓"), "a running tool must NOT read as done");
});

test("tool card: settled shows ✓ + duration + dim preview lines", () => {
  const line = { tone: "tool", name: "Weather", text: "Houston, TX", ok: true, elapsed: "547ms", preview: ["Now: 85°F, Partly cloudy", "2026-07-05: 100°F/79°F — Sunny"] };
  const f = frame(h(LogRow, { theme: SLATE, line, tick: 0, width: 70 }));
  const s = strip(f);
  assert.match(s, /✓ Weather │ Houston, TX {2}547ms/);
  assert.match(s, /⤷ Now: 85°F, Partly cloudy/);
  assert.match(s, /2026-07-05: 100°F\/79°F — Sunny/);
});

test("transcript: 2+ running tools get the ⚡ batch banner", () => {
  const lines = [
    { tone: "tool", name: "ImageSearch", text: "4 images", ok: true, elapsed: "747ms" },
    { tone: "tool", name: "Weather", text: "Houston", running: true },
    { tone: "tool", name: "WebSearch", text: "searching", running: true },
  ];
  const s = strip(frame(h(Transcript, { theme: SLATE, lines, tick: 0, width: 70 })));
  assert.match(s, /⚡ 2 tools in flight/);
  const bannerIdx = s.indexOf("2 tools in flight");
  const firstRunIdx = s.indexOf("Weather");
  assert.ok(bannerIdx < firstRunIdx, "banner sits above the first running row");
});

test("transcript: a single running tool gets NO banner", () => {
  const s = strip(frame(h(Transcript, { theme: SLATE, lines: [{ tone: "tool", name: "Bash", text: "npm test", running: true }], tick: 0, width: 70 })));
  assert.ok(!s.includes("in flight"));
});

test("transcript: scrolled state shows the newer-below marker", () => {
  const s = strip(frame(h(Transcript, { theme: SLATE, lines: [{ tone: "assistant", text: "hi" }], tick: 0, scrolled: 12, width: 70 })));
  assert.match(s, /↓ 12 newer/);
});

test("assistant prose: markdown renders headings/inline code with accents", () => {
  const line = { tone: "assistant", md: true, text: "## Plan\nUse `pnpm build` then **ship**." };
  const f = frame(h(LogRow, { theme: SLATE, line, tick: 0, width: 70 }));
  const s = strip(f);
  assert.match(s, /Plan/);
  assert.match(s, /pnpm build/);
  assert.match(s, /ship/);
  assert.ok(f.includes(fg(SLATE.primary)) || f.includes(fg(SLATE.secondary)), "md accents present");
});

test("assistant prose: the streaming draft carries a cursor at tick 0", () => {
  const f = frame(h(LogRow, { theme: SLATE, line: { tone: "assistant", text: "thinking out loud", stream: true }, tick: 0, width: 70 }));
  assert.match(strip(f), /thinking out loud▊/);
});

test("slate toolbar: renders the shared TOOLBAR_ITEMS labels verbatim so hit-tests land", () => {
  const f = strip(frame(h(Toolbar, { theme: SLATE, width: 80 })));
  assert.match(f, /⚔ Models ▾/);
  assert.match(f, /🔥 Effort/);
  assert.match(f, /🎨 Themes/);
  assert.match(f, /⚙ Settings/);
  assert.match(f, /✦ Ultra/);
  // The FIRST button's label starts at CHROME_START_COL (paddingX 1 → col 2):
  assert.equal(toolbarHitTest(2, 24, 24, 80), "models");
  assert.equal(toolbarHitTest(1, 24, 24, 80), null, "col 1 is padding — dead zone");
});

test("header: model chip carries the ▾ affordance; span math covers it", () => {
  const s = strip(frame(h(Header, { theme: SLATE, model: "deepseek-v4-pro", workspace: "D:/Ares", width: 80 })));
  assert.match(s, /ARES {2}deepseek-v4-pro ▾/);
  const span = slateModelSpan("deepseek-v4-pro");
  assert.equal(SLATE_HEADER_MODEL_ROW, 1);
  assert.equal(span.start, 6);
  assert.equal(span.end, 9 + textWidth("deepseek-v4-pro"));
});

test("header: busy wordmark shimmers (gradient colors, not flat primary)", () => {
  const busy = frame(h(Header, { theme: SLATE, model: "m", workspace: "w", busy: true, tick: 9, width: 60 }));
  const idle = frame(h(Header, { theme: SLATE, model: "m", workspace: "w", busy: false, tick: 9, width: 60 }));
  assert.ok(busy.includes(fg("#6ea8fe")) || busy.includes(fg("#54c98c")) || busy.includes(fg("#7dd3c0")), "gradient stop present when busy");
  assert.ok(idle.includes(fg(SLATE.primary)), "idle stays flat primary");
});

test("status bar: working shows the live turn timer + tools count", () => {
  const s = strip(frame(h(StatusBar, { theme: SLATE, working: true, tick: 0, turnElapsed: 12.4, msgs: 3, tools: 7, themeName: "slate", version: "0.18.0", width: 100 })));
  assert.match(s, /working 12s/);
  assert.match(s, /⚙ 7/);
});

test("ChatMain: composes toolbar as the LAST row (bottom-row hit-test alignment)", () => {
  const f = strip(frame(h(ChatMain, {
    snapshot: { model: "m", workspace: "w" }, lines: [], stats: { msgs: 0 },
    busy: false, tick: 0, input: "", themeName: "slate", version: "1.0.0", width: 80, height: 20,
  })));
  const rows = f.split("\n");
  const last = rows[rows.length - 1];
  assert.match(last, /Models ▾/, "toolbar is the final row");
  assert.match(f, /What are we building/);
});
