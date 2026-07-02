// Feed a Mission Learning Card into living memory — exactly once.
//
// When a lesson is distilled, its summary becomes a `procedural` memory so the
// unified recall can surface it on future turns ("you've hit this before").
// Idempotency is keyed on the card id via the memory `source`: re-running
// `ares mission learn` on the same mission never plants a duplicate lesson.

import { MemoryRouter, type MemoryStore } from "@ares/mind";

/** Tag stamped on every card lesson — the dedicated provenance marker. `source`
 *  is a freeform string overloaded by many subsystems (light-dreaming, synthesis,
 *  conversation-reflection, v4-vector-store…), so matching on `source === id`
 *  alone could collide with a non-card memory that happens to reuse the id string.
 *  Requiring this tag too keeps the dedup scoped to actual card lessons. */
const CARD_PROVENANCE_TAG = "learning-card";

export interface CardMemoryInput {
  /** The learning card id — stored in `source` and matched (with the card tag) for dedup. */
  id: string;
  summary: string;
  tags?: string[];
}

/** Returns true if a new memory was written, false if the card was already recorded.
 *  Idempotency lives in the ONE write spine: the router's "card" channel dedupes
 *  on source id + the card provenance tag, so a same-id memory from an unrelated
 *  subsystem can never masquerade as this card's recorded lesson. */
export async function recordCardMemoryOnce(store: MemoryStore, input: CardMemoryInput): Promise<boolean> {
  const report = await new MemoryRouter(store).write("card", [{
    kind: "procedural",
    content: input.summary,
    tags: ["lesson", CARD_PROVENANCE_TAG, ...(input.tags ?? [])],
    source: input.id,
  }]);
  return report.written.length > 0;
}
