// The consciousness → agent context bridge: the agent gets a SMALL, bounded,
// salience-filtered sense of what the watcher saw — and nothing when idle.

import test from "node:test";
import assert from "node:assert/strict";
import {
  recordConsciousnessObservation,
  consciousnessContextReminder,
  clearConsciousnessObservations,
  consciousnessNoteCount,
} from "../packages/cli/dist/consciousnessContext.js";

test("no observations → no reminder (the common, quiet case)", () => {
  clearConsciousnessObservations();
  assert.equal(consciousnessContextReminder(), null);
});

test("a notable observation is retained and surfaces as bounded ambient context", () => {
  clearConsciousnessObservations();
  const now = 1_000_000;
  recordConsciousnessObservation({ observation: "VS Code shows a failing test in auth.test.ts", at: now });
  const reminder = consciousnessContextReminder(now);
  assert.ok(reminder, "reminder present");
  assert.match(reminder, /PERIPHERAL AWARENESS/);
  assert.match(reminder, /NOT an instruction/);
  assert.match(reminder, /failing test/);
});

test("idle non-notable frames after the first are dropped (no noise)", () => {
  clearConsciousnessObservations();
  const now = 2_000_000;
  recordConsciousnessObservation({ observation: "a code editor is open", at: now }); // first: retained
  const before = consciousnessNoteCount();
  recordConsciousnessObservation({ observation: "a code editor is open still", at: now + 1000 }); // idle: dropped
  assert.equal(consciousnessNoteCount(), before, "idle frame not buffered");
});

test("the watcher's spoken remark is always retained and ranked first", () => {
  clearConsciousnessObservations();
  const now = 3_000_000;
  recordConsciousnessObservation({ observation: "terminal idle", comment: "You've left that build running for a while.", at: now });
  const reminder = consciousnessContextReminder(now);
  assert.ok(reminder);
  assert.match(reminder, /you noted:/);
  assert.match(reminder, /build running/);
});

test("stale observations expire — screen state from an hour ago is not 'now'", () => {
  clearConsciousnessObservations();
  const t0 = 4_000_000;
  recordConsciousnessObservation({ observation: "an error dialog: disk full", at: t0 });
  // 20 minutes later, past the 10-minute freshness window.
  assert.equal(consciousnessContextReminder(t0 + 20 * 60_000), null);
});

test("the reminder is hard-capped in size (never dominates the window)", () => {
  clearConsciousnessObservations();
  const now = 5_000_000;
  for (let i = 0; i < 10; i++) {
    recordConsciousnessObservation({ observation: `error number ${i}: something failed badly with a long description `.repeat(4), at: now + i });
  }
  const reminder = consciousnessContextReminder(now + 10);
  assert.ok(reminder);
  // Cap is 3 items + ~320 chars of body; total stays well under 700 chars incl. header.
  assert.ok(reminder.length < 700, `reminder too large: ${reminder.length}`);
  const bulletCount = (reminder.match(/\n- /g) || []).length;
  assert.ok(bulletCount <= 3, `too many items: ${bulletCount}`);
});
