import type {
  Account,
  AccountFilter,
  AccountSource,
  AutomationAdapter,
  DeviceHandle,
  DeviceRouter,
  Logger,
  Platform,
  RunContext,
  RunResult,
  SecretRef,
  SecretResolver,
} from "./types.js";

/** Console logger with structured-ish output. */
export const consoleLogger: Logger = {
  info: (msg, meta) => console.log(`[info] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[warn] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[error] ${msg}`, meta ?? ""),
};

/** Accounts held in memory, with tag/platform filtering. */
export class InMemoryAccountSource implements AccountSource {
  constructor(private readonly accounts: Account[]) {}

  async list(filter?: AccountFilter): Promise<Account[]> {
    return this.accounts.filter((a) => {
      if (filter?.platform && a.platform !== filter.platform) return false;
      if (filter?.includeTags && !filter.includeTags.every((t) => a.tags.includes(t))) return false;
      if (filter?.excludeTags && filter.excludeTags.some((t) => a.tags.includes(t))) return false;
      return true;
    });
  }
}

/** Resolves refs to obviously-fake values. Never touches a real secret store. */
export class MockSecretResolver implements SecretResolver {
  async resolve(ref: SecretRef): Promise<string> {
    return `mock-secret-for(${ref})`;
  }
}

/** Hands out fake device sessions and tracks acquire/release balance. */
export class MockDeviceRouter implements DeviceRouter {
  private seq = 0;
  public acquired = 0;
  public released = 0;

  async acquire(account: Account): Promise<DeviceHandle> {
    this.acquired++;
    return {
      id: account.deviceName ?? `mock-device-${++this.seq}`,
      provider: "mock",
      meta: { pinned: Boolean(account.deviceName) },
    };
  }

  async release(_handle: DeviceHandle): Promise<void> {
    this.released++;
  }
}

/** Pretends to run a task; succeeds unless the username contains "fail". */
export class MockAdapter implements AutomationAdapter {
  constructor(public readonly platform: Platform) {}

  async run(ctx: RunContext): Promise<RunResult> {
    if (ctx.account.username.includes("fail")) {
      return { ok: false, error: { message: "simulated failure", retryable: true } };
    }
    return {
      ok: true,
      data: { platform: this.platform, username: ctx.account.username, device: ctx.device.id, task: ctx.task.kind },
    };
  }
}

const PLATFORMS: readonly Platform[] = ["instagram", "tiktok", "youtube"];

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

/**
 * Parse an authorized-accounts.csv into Account[].
 *
 * Expected header:
 *   platform,username,email,password_secret_ref,email_password_secret_ref,totp_secret_ref,device_name,tags
 * `tags` is a `;`-separated list. Rows on unknown platforms are skipped.
 */
export function parseAccountsCsv(csv: string): Account[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iPlatform = idx("platform");
  const iUser = idx("username");
  const iEmail = idx("email");
  const iPass = idx("password_secret_ref");
  const iEmailPass = idx("email_password_secret_ref");
  const iTotp = idx("totp_secret_ref");
  const iDevice = idx("device_name");
  const iTags = idx("tags");

  const out: Account[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const platform = (cells[iPlatform] ?? "").trim();
    if (!isPlatform(platform)) continue;

    const clean = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const tagsRaw = clean(iTags);
    out.push({
      platform,
      username: clean(iUser),
      email: clean(iEmail) || undefined,
      passwordRef: clean(iPass) || undefined,
      emailPasswordRef: clean(iEmailPass) || undefined,
      totpRef: clean(iTotp) || undefined,
      deviceName: clean(iDevice) || undefined,
      tags: tagsRaw ? tagsRaw.split(";").map((t) => t.trim()).filter(Boolean) : [],
    });
  }
  return out;
}
