// The Garrison's clock — interval ticks that call injected entity hooks.
// V1 keeps the hooks opaque (() => Promise): the daemon composition wires
// runHeartbeatTick / dream cycles in here; tests wire counters.
//
// Heartbeat: every heartbeatEveryMs (default 30 min).
// Dream: checked every dreamCheckEveryMs (default 10 min); fires only when no
// session.send happened for idleMs (default 2 h), and the idle clock restarts
// after each dream so an idle night doesn't dream every check.
//
// now()/setInterval/clearInterval are injectable so tests use fake timers and
// never wait. Real timers are unref()'d — the scheduler alone never holds the
// process open.

export interface SchedulerHooks {
  heartbeat?: () => Promise<unknown> | unknown;
  dream?: () => Promise<unknown> | unknown;
}

export interface SchedulerOptions {
  hooks: SchedulerHooks;
  /** Heartbeat cadence; default 30 minutes. */
  heartbeatEveryMs?: number;
  /** Dream after this much send-silence; default 2 hours. */
  idleMs?: number;
  /** How often the idle check runs; default 10 minutes. */
  dreamCheckEveryMs?: number;
  /** Epoch ms of the last session.send (SessionManager.lastActivityAt). */
  lastActivityAt?: () => number;
  now?: () => number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  onError?: (hook: "heartbeat" | "dream", err: unknown) => void;
}

const DEFAULT_HEARTBEAT_MS = 30 * 60_000;
const DEFAULT_IDLE_MS = 2 * 60 * 60_000;
const DEFAULT_DREAM_CHECK_MS = 10 * 60_000;

function defaultSetInterval(fn: () => void, ms: number): unknown {
  const timer = setInterval(fn, ms);
  timer.unref?.();
  return timer;
}

function defaultClearInterval(handle: unknown): void {
  clearInterval(handle as Parameters<typeof clearInterval>[0]);
}

export class Scheduler {
  readonly heartbeatEveryMs: number;
  readonly idleMs: number;
  readonly dreamCheckEveryMs: number;

  private readonly opts: SchedulerOptions;
  private readonly setIntervalFn: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalFn: (handle: unknown) => void;
  private readonly nowFn: () => number;
  private handles: unknown[] = [];
  private startedAtMs: number | undefined;
  private lastDreamAt: number | undefined;
  private readonly running = { heartbeat: false, dream: false };

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
    this.heartbeatEveryMs = opts.heartbeatEveryMs ?? DEFAULT_HEARTBEAT_MS;
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.dreamCheckEveryMs = opts.dreamCheckEveryMs ?? DEFAULT_DREAM_CHECK_MS;
    this.setIntervalFn = opts.setIntervalFn ?? defaultSetInterval;
    this.clearIntervalFn = opts.clearIntervalFn ?? defaultClearInterval;
    this.nowFn = opts.now ?? Date.now;
  }

  start(): void {
    if (this.handles.length > 0) return;
    this.startedAtMs = this.nowFn();
    if (this.opts.hooks.heartbeat) {
      this.handles.push(this.setIntervalFn(() => void this.runHook("heartbeat"), this.heartbeatEveryMs));
    }
    if (this.opts.hooks.dream) {
      this.handles.push(this.setIntervalFn(() => this.dreamCheck(), this.dreamCheckEveryMs));
    }
  }

  stop(): void {
    for (const handle of this.handles.splice(0)) this.clearIntervalFn(handle);
  }

  get started(): boolean {
    return this.handles.length > 0;
  }

  /** Epoch ms when a dream becomes eligible; undefined without a dream hook. */
  nextDreamAt(): number | undefined {
    if (!this.opts.hooks.dream) return undefined;
    return this.idleBaseline() + this.idleMs;
  }

  private idleBaseline(): number {
    return Math.max(
      this.opts.lastActivityAt?.() ?? 0,
      this.lastDreamAt ?? 0,
      this.startedAtMs ?? this.nowFn(),
    );
  }

  private dreamCheck(): void {
    if (this.nowFn() - this.idleBaseline() < this.idleMs) return;
    this.lastDreamAt = this.nowFn();
    void this.runHook("dream");
  }

  private async runHook(name: "heartbeat" | "dream"): Promise<void> {
    if (this.running[name]) return; // never overlap a slow hook with itself
    this.running[name] = true;
    try {
      await this.opts.hooks[name]?.();
    } catch (err) {
      this.opts.onError?.(name, err);
    } finally {
      this.running[name] = false;
    }
  }
}
