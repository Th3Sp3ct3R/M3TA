// The ONE reflection scheduler (core-redesign Phase 3, entry-point consolidation).
//
// Ares historically had ~six reflection writers, several owning their own
// cadence: the heartbeat's setInterval, session-end light-dream + consolidate
// wired ad hoc inside the runtime, deep-dream/witness/conversation-reflect
// fired from their callers. This scheduler is the single owner of WHEN
// reflection runs; the passes themselves are pure functions it calls. No
// reflection loop may own its own timer anymore — the interval trigger here is
// the only timer.
//
// Guarantees:
//   • one timer total (start() replaces any prior one; stop() clears it)
//   • single-flight per trigger — a fire() while the same trigger is already
//     running is skipped, never queued (reflection is periodic; skipping a
//     pass is always safe, double-running is not)
//   • pass isolation — a throwing pass is reported, never breaks its siblings
//     or the caller (the silent-degrade invariant)

import type { ReflectionResult } from "@ares/mind";

export type ReflectionTrigger = "interval" | "turnEnd" | "sessionEnd";

/** A pure reflection pass: given a timestamp, do the work, optionally report. */
export type ReflectionPassFn = (ctx: { now: Date }) => Promise<ReflectionResult | void> | ReflectionResult | void;

export interface ReflectionPassOutcome {
  name: string;
  ok: boolean;
  result?: ReflectionResult;
  error?: string;
}

interface RegisteredPass {
  trigger: ReflectionTrigger;
  name: string;
  run: ReflectionPassFn;
}

export class ReflectionScheduler {
  private readonly passes: RegisteredPass[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly inFlight = new Set<ReflectionTrigger>();
  private onOutcomes: ((trigger: ReflectionTrigger, outcomes: ReflectionPassOutcome[]) => void) | undefined;

  /** Register a pass under a trigger. Passes run sequentially in registration order. */
  register(trigger: ReflectionTrigger, name: string, run: ReflectionPassFn): this {
    this.passes.push({ trigger, name, run });
    return this;
  }

  /** Observe every fire's outcomes (interval fires have no awaiting caller). */
  observe(fn: (trigger: ReflectionTrigger, outcomes: ReflectionPassOutcome[]) => void): this {
    this.onOutcomes = fn;
    return this;
  }

  /** Start THE timer: fires the "interval" trigger every `everyMs`. Replaces any
   *  prior timer; never holds the process open. */
  start(everyMs: number): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      void this.fire("interval").catch(() => undefined);
    }, everyMs);
    this.timer.unref?.();
  }

  /** Stop the timer. Registered passes stay; fire() still works on demand. */
  stop(): void {
    this.stopTimer();
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Run every pass registered under `trigger`, sequentially, errors contained.
   *  Single-flight: returns [] without running anything when the same trigger
   *  is already mid-fire. */
  async fire(trigger: ReflectionTrigger, opts: { now?: Date } = {}): Promise<ReflectionPassOutcome[]> {
    if (this.inFlight.has(trigger)) return [];
    this.inFlight.add(trigger);
    const outcomes: ReflectionPassOutcome[] = [];
    try {
      const now = opts.now ?? new Date();
      for (const pass of this.passes) {
        if (pass.trigger !== trigger) continue;
        try {
          const result = await pass.run({ now });
          outcomes.push({ name: pass.name, ok: true, ...(result ? { result } : {}) });
        } catch (err) {
          outcomes.push({ name: pass.name, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      this.inFlight.delete(trigger);
    }
    this.onOutcomes?.(trigger, outcomes);
    return outcomes;
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
