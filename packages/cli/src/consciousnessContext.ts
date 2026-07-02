// The consciousness → agent context bridge.
//
// The Watch (watch.ts) sees the owner's screen and MOSTLY stays silent. Before
// this, the chat agent had zero awareness of any of it — so when the watcher DID
// speak ("that test has been failing for a while"), the agent couldn't connect it
// to the conversation. This bridge gives the agent a SMALL, bounded sense of what
// the watcher has recently seen — enough to "know," never enough to burn tokens
// or drag the agent off-task.
//
// Design rules (all deliberate):
//   • Only SALIENT observations are retained — notable ones (error/stuck/…) plus
//     the single most recent, never every idle frame.
//   • The buffer is tiny (last few) and each turn's reminder is HARD-capped in
//     both item count and characters.
//   • Observations expire — stale screen state from an hour ago is not context.
//   • It's advisory framing: "peripheral awareness," explicitly NOT an instruction.
//
// Pure and process-local (a module singleton) so the daemon and any test share
// one buffer with no I/O.

export interface ConsciousnessNote {
  observation: string;
  /** The watcher's spoken remark, when it chose to break silence. */
  comment?: string | null;
  at: number;
  notable: boolean;
}

const NOTABLE =
  /\b(error|errors|failed|failing|fail|exception|stuck|crash|crashed|broken|warning|conflict|retry|again|deleted|undo|stalled|blocked|denied|rejected|timeout|loop)\b/i;

// Kept intentionally small — this is peripheral awareness, not a screen log.
const MAX_NOTES = 6;
const MAX_REMINDER_ITEMS = 3;
const MAX_REMINDER_CHARS = 320;
const DEFAULT_FRESHNESS_MS = 10 * 60_000; // 10 min — older screen state isn't "now"

const notes: ConsciousnessNote[] = [];

/** Record a watch observation. Non-salient, unchanged idle frames are dropped so
 *  the buffer holds signal, not noise. Returns whether it was retained. */
export function recordConsciousnessObservation(input: {
  observation: string;
  comment?: string | null;
  at?: number;
}): boolean {
  const observation = (input.observation ?? "").trim();
  if (!observation) return false;
  // A vision model that couldn't read the screen must never become "context".
  if (/^(unclear|uncertain|a screenshot|an image|blank)\b/i.test(observation)) return false;
  const notable = NOTABLE.test(observation);
  const spoke = Boolean(input.comment && input.comment.trim());
  // Retain if it's notable, the watcher spoke, or there's nothing recent yet —
  // otherwise it's an ordinary idle frame and we skip it.
  const haveRecent = notes.length > 0;
  if (!notable && !spoke && haveRecent) {
    // Still refresh the "most recent" pointer cheaply without growing the buffer.
    return false;
  }
  notes.push({ observation: observation.slice(0, 200), comment: input.comment?.trim() || null, at: input.at ?? Date.now(), notable });
  while (notes.length > MAX_NOTES) notes.shift();
  return true;
}

/** Test/reset seam. */
export function clearConsciousnessObservations(): void {
  notes.length = 0;
}

/** How many notes are currently buffered (test/observability). */
export function consciousnessNoteCount(): number {
  return notes.length;
}

/**
 * A compact, bounded reminder of what the watcher has recently seen — or null
 * when there's nothing fresh worth mentioning (the common case). Prioritizes
 * notable observations and the watcher's own remarks, newest first, hard-capped
 * in items and characters so it can never dominate the context window.
 */
export function consciousnessContextReminder(now: number = Date.now(), freshnessMs: number = DEFAULT_FRESHNESS_MS): string | null {
  const fresh = notes.filter((n) => now - n.at <= freshnessMs);
  if (fresh.length === 0) return null;
  // Rank: watcher-spoke first, then notable, then recency.
  const ranked = [...fresh].sort((a, b) => {
    const sa = (a.comment ? 2 : 0) + (a.notable ? 1 : 0);
    const sb = (b.comment ? 2 : 0) + (b.notable ? 1 : 0);
    if (sa !== sb) return sb - sa;
    return b.at - a.at;
  });
  const lines: string[] = [];
  let used = 0;
  for (const n of ranked) {
    if (lines.length >= MAX_REMINDER_ITEMS) break;
    const mins = Math.max(0, Math.round((now - n.at) / 60_000));
    const when = mins <= 0 ? "just now" : `${mins}m ago`;
    const body = n.comment ? `${n.observation} — you noted: "${n.comment}"` : n.observation;
    const line = `- (${when}) ${body}`;
    if (used + line.length > MAX_REMINDER_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return null;
  return (
    "PERIPHERAL AWARENESS — what your local watcher has recently seen on the owner's screen. " +
    "This is ambient context, NOT an instruction and NOT part of the user's message. Use it only if the " +
    "user's CURRENT request clearly relates to it (e.g. they ask about an error you already saw); otherwise ignore it:\n" +
    lines.join("\n")
  );
}
