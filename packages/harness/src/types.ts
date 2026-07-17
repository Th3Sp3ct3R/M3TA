/**
 * Harness (AzA) domain interfaces.
 *
 * The harness is an *orchestrator*: it never contains device or platform
 * automation logic itself. Those are injected through these interfaces, so the
 * concrete implementations (e.g. mattclone-duo's @julio/device-control and
 * @julio/automation) can live in a separate repo and be wired in without
 * touching the runner.
 */

export type Platform = "instagram" | "tiktok" | "youtube";

/**
 * A reference to a secret, never the secret itself. Mirrors the
 * `keychain:...` refs used in authorized-accounts.csv. Resolved lazily and
 * only at point of use via a SecretResolver.
 */
export type SecretRef = string;

/** One authorized account, as loaded from a source (CSV, DB, etc.). */
export interface Account {
  platform: Platform;
  username: string;
  email?: string;
  passwordRef?: SecretRef;
  emailPasswordRef?: SecretRef;
  totpRef?: SecretRef;
  /** Preferred device to run this account on, if pinned. */
  deviceName?: string;
  tags: string[];
}

/** Loads the set of accounts to operate on. */
export interface AccountSource {
  list(filter?: AccountFilter): Promise<Account[]>;
}

export interface AccountFilter {
  platform?: Platform;
  /** Include only accounts carrying ALL of these tags. */
  includeTags?: string[];
  /** Exclude any account carrying ANY of these tags (e.g. "do-not-assign"). */
  excludeTags?: string[];
}

/** Turns a SecretRef into a plaintext value at point of use. */
export interface SecretResolver {
  resolve(ref: SecretRef): Promise<string>;
}

/** An acquired, ready-to-drive device session. */
export interface DeviceHandle {
  id: string;
  provider: string;
  /** Opaque provider-specific session detail (ADB serial, CDP url, etc.). */
  readonly meta: Readonly<Record<string, unknown>>;
}

/** Maps an account to a device and manages the session lifecycle. */
export interface DeviceRouter {
  acquire(account: Account): Promise<DeviceHandle>;
  release(handle: DeviceHandle): Promise<void>;
}

/** A unit of scraper work to perform for an account. */
export interface ScraperTask {
  kind: string;
  target?: string;
  params?: Record<string, unknown>;
}

/** Everything an adapter needs to perform one task. */
export interface RunContext {
  account: Account;
  device: DeviceHandle;
  task: ScraperTask;
  secrets: SecretResolver;
  logger: Logger;
  signal: AbortSignal;
}

/** Platform-specific automation. One adapter per platform. */
export interface AutomationAdapter {
  readonly platform: Platform;
  run(ctx: RunContext): Promise<RunResult>;
}

export interface RunResult {
  ok: boolean;
  data?: unknown;
  error?: { message: string; retryable?: boolean };
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
