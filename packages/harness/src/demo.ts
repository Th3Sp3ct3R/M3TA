/**
 * End-to-end smoke demo for the harness, wired entirely with mocks.
 * Run with: pnpm --filter @ares/harness demo
 *
 * Proves the orchestration loop works — account load → device route → adapter
 * run → device release — before any real device/automation impl is connected.
 */
import { Harness } from "./runner.js";
import {
  consoleLogger,
  InMemoryAccountSource,
  MockAdapter,
  MockDeviceRouter,
  MockSecretResolver,
  parseAccountsCsv,
} from "./mocks.js";

const SAMPLE_CSV = `platform,username,email,password_secret_ref,email_password_secret_ref,totp_secret_ref,device_name,tags
tiktok,creator_ok,ok@example.com,keychain:tiktok-creator_ok-password,,,,tiktok;prod
instagram,ig_ok,,keychain:ig-ig_ok-password,,,PinnedDevice7,instagram;prod
tiktok,creator_fail,fail@example.com,keychain:tiktok-creator_fail-password,,,,tiktok;prod
tiktok,skip_me,,,,,,do-not-assign`;

async function main(): Promise<void> {
  const accounts = parseAccountsCsv(SAMPLE_CSV);
  const devices = new MockDeviceRouter();

  const harness = new Harness({
    accounts: new InMemoryAccountSource(accounts),
    devices,
    secrets: new MockSecretResolver(),
    adapters: [new MockAdapter("tiktok"), new MockAdapter("instagram"), new MockAdapter("youtube")],
    logger: consoleLogger,
  });

  const outcomes = await harness.run(
    { kind: "scrape-profile" },
    { concurrency: 2, filter: { excludeTags: ["do-not-assign"] } },
  );

  console.log("\n=== outcomes ===");
  for (const o of outcomes) {
    console.log(`${o.result.ok ? "✓" : "✗"} ${o.account.platform}/${o.account.username}`, o.result.ok ? o.result.data : o.result.error);
  }
  console.log(`\ndevices acquired=${devices.acquired} released=${devices.released} (must be equal)`);

  const failed = outcomes.filter((o) => !o.result.ok).length;
  console.log(`total=${outcomes.length} failed=${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
