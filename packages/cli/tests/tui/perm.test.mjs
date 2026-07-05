// In-frame permission card — the fix for the invisible raw-stderr prompt that
// hung turns forever. Renders + click geometry.
import test from "node:test";
import assert from "node:assert/strict";
import { h, frame, strip, fg } from "./helpers.mjs";

import { SLATE } from "../../dist/ui/theme.js";
import { PermissionCard } from "../../dist/ui/chat/PermissionCard.js";
import { ChatMain } from "../../dist/ui/chat/ChatMain.js";
import { permHitTest, permButtonsRow, textWidth } from "../../dist/tuiChrome.js";

test("permission card: tool name, reason, and the three answers", () => {
  const f = frame(h(PermissionCard, { theme: SLATE, toolName: "Spotify", reason: "wants to control playback", tick: 0, width: 70 }));
  const s = strip(f);
  assert.match(s, /⚠ Spotify │ wants to control playback/);
  assert.match(s, /\[1\] allow once/);
  assert.match(s, /\[2\] always allow/);
  assert.match(s, /\[3\] deny/);
  assert.ok(f.includes(fg(SLATE.success)), "allow once in success green");
  assert.ok(f.includes(fg(SLATE.danger)), "deny in danger red");
});

test("permission geometry: buttons row is screenH-6; spans land on the labels", () => {
  const H = 24;
  assert.equal(permButtonsRow(H), 18);
  // content starts col 3 (border + padding)
  assert.equal(permHitTest(3, 18, H), "allow_once");
  const w1 = textWidth("[1] allow once");
  assert.equal(permHitTest(3 + w1 - 1, 18, H), "allow_once", "last col of button 1");
  assert.equal(permHitTest(3 + w1, 18, H), null, "gap is a dead zone");
  assert.equal(permHitTest(3 + w1 + 3, 18, H), "allow_always", "button 2 after the 3-col gap");
  assert.equal(permHitTest(3, 17, H), null, "wrong row misses");
});

test("ChatMain: permNode renders directly above the status bar", () => {
  const perm = h(PermissionCard, { theme: SLATE, toolName: "Email", reason: "send a message", tick: 0, width: 80 });
  const f = strip(frame(h(ChatMain, {
    snapshot: { model: "m", workspace: "w" }, lines: [], stats: { msgs: 0 },
    busy: true, tick: 0, input: "", permNode: perm, themeName: "slate", version: "1.0.0", width: 80, height: 24,
  })));
  const rows = f.split("\n");
  const btnRowIdx = rows.findIndex((r) => r.includes("[1] allow once"));
  assert.ok(btnRowIdx > 0, "buttons row rendered");
  // Bottom cluster below the card: card bottom border, status, input(3), toolbar
  assert.equal(rows.length - 1 - btnRowIdx, 6, "buttons row sits exactly 6 rows above the frame bottom");
  assert.match(rows[btnRowIdx + 2], /working/, "status bar right under the card");
});
