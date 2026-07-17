import type {
  Account,
  AccountFilter,
  AccountSource,
  AutomationAdapter,
  DeviceRouter,
  Logger,
  Platform,
  RunResult,
  ScraperTask,
  SecretResolver,
} from "./types.js";

export interface HarnessDeps {
  accounts: AccountSource;
  devices: DeviceRouter;
  secrets: SecretResolver;
  /** One adapter per platform. Accounts on an unregistered platform are skipped. */
  adapters: AutomationAdapter[];
  logger?: Logger;
}

export interface RunOptions {
  filter?: AccountFilter;
  /** Max accounts processed at once. Defaults to 3. */
  concurrency?: number;
  signal?: AbortSignal;
}

/** Outcome for a single account in a batch run. */
export interface AccountOutcome {
  account: Pick<Account, "platform" | "username">;
  result: RunResult;
}

const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

/**
 * The scraper run harness.
 *
 * Loads accounts from a source, routes each to a device, and drives the
 * matching platform adapter — with bounded concurrency and per-account error
 * isolation. Contains no device or platform logic itself; all of that is
 * injected via HarnessDeps.
 */
export class Harness {
  private readonly adapters: Map<Platform, AutomationAdapter>;
  private readonly log: Logger;

  constructor(private readonly deps: HarnessDeps) {
    this.log = deps.logger ?? noopLogger;
    this.adapters = new Map(deps.adapters.map((a) => [a.platform, a]));
  }

  /** Run `task` for every account matching `filter`. Never throws per-account. */
  async run(task: ScraperTask, opts: RunOptions = {}): Promise<AccountOutcome[]> {
    const concurrency = Math.max(1, opts.concurrency ?? 3);
    const signal = opts.signal ?? new AbortController().signal;

    const accounts = await this.deps.accounts.list(opts.filter);
    this.log.info("harness.loaded", { count: accounts.length, task: task.kind });

    const outcomes: AccountOutcome[] = [];
    const queue = [...accounts];

    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        if (signal.aborted) return;
        const account = queue.shift();
        if (!account) return;
        outcomes.push(await this.runOne(account, task, signal));
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () =>
      worker(),
    );
    await Promise.all(workers);

    const failed = outcomes.filter((o) => !o.result.ok).length;
    this.log.info("harness.done", { total: outcomes.length, failed });
    return outcomes;
  }

  private async runOne(
    account: Account,
    task: ScraperTask,
    signal: AbortSignal,
  ): Promise<AccountOutcome> {
    const tag = { platform: account.platform, username: account.username };
    const adapter = this.adapters.get(account.platform);
    if (!adapter) {
      this.log.warn("harness.skip.no-adapter", tag);
      return { account: tag, result: { ok: false, error: { message: `no adapter for ${account.platform}` } } };
    }

    let device;
    try {
      device = await this.deps.devices.acquire(account);
    } catch (err) {
      this.log.error("harness.device.acquire-failed", { ...tag, err: String(err) });
      return { account: tag, result: { ok: false, error: { message: `device acquire failed: ${String(err)}`, retryable: true } } };
    }

    try {
      const result = await adapter.run({
        account,
        device,
        task,
        secrets: this.deps.secrets,
        logger: this.log,
        signal,
      });
      this.log.info(result.ok ? "harness.account.ok" : "harness.account.fail", tag);
      return { account: tag, result };
    } catch (err) {
      this.log.error("harness.account.threw", { ...tag, err: String(err) });
      return { account: tag, result: { ok: false, error: { message: String(err) } } };
    } finally {
      // Always release the device, even if the adapter threw.
      await this.deps.devices.release(device).catch((err) =>
        this.log.error("harness.device.release-failed", { ...tag, err: String(err) }),
      );
    }
  }
}

export type { SecretResolver };
