export * from "./types.js";
export { Harness } from "./runner.js";
export type { HarnessDeps, RunOptions, AccountOutcome } from "./runner.js";
export {
  consoleLogger,
  InMemoryAccountSource,
  MockSecretResolver,
  MockDeviceRouter,
  MockAdapter,
  parseAccountsCsv,
} from "./mocks.js";

// Target sources — the "who to act ON" side (leads).
export type { Target, TargetQuery, TargetSource } from "./targets/types.js";
export {
  LiveTargetSource,
  McpHttpClient,
  mapRowToTarget,
  queryToArgs,
} from "./targets/live.js";
export type { LiveTargetOptions } from "./targets/live.js";
export { MockTargetSource, TARGET_FIXTURE_ROWS } from "./targets/mock.js";
