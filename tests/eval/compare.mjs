// The scoreboard — Ares vs Claude Code on identical tasks, one table, plus a
// trend line appended to ~/.ares/telemetry/eval-trend.jsonl so HELM (and the
// nightly job) can chart whether the gap is closing.
//
// Usage:
//   node tests/eval/compare.mjs                       # both sides, all tasks
//   node tests/eval/compare.mjs --skip-cc             # Ares side only
//   node tests/eval/compare.mjs --skip-ares           # CC side only
//   node tests/eval/compare.mjs --task <id>           # one task, both sides
//   node tests/eval/compare.mjs --provider anthropic  # Ares provider (default)
//
// Ares side needs an Anthropic key (env or Ares settings); CC side needs a
// logged-in `claude` CLI. Both cost real money/quota — the suite is sized for
// single-digit dollars.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadTasks, runEval } from "./runner.mjs";
import { runCcEval } from "./ccRunner.mjs";
import { telemetryDir } from "../../packages/core/dist/index.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);

const taskId = value("--task", null);
const provider = value("--provider", "anthropic");
const tasks = (await loadTasks()).filter((t) => !taskId || t.id === taskId);
if (tasks.length === 0) {
  console.error(`no task matched ${taskId}`);
  process.exit(2);
}

console.log(`Comparing on ${tasks.length} task(s) — Ares(${provider}) vs Claude Code…`);

let ares = null;
let cc = null;
if (!flag("--skip-ares")) {
  console.log(`\n[1/2] Ares engine via ${provider}…`);
  ares = await runEval({ tasks, providerName: provider });
  console.log(`      ${ares.passed}/${ares.taskCount} in ${(ares.totalDurationMs / 1000).toFixed(1)}s`);
}
if (!flag("--skip-cc")) {
  console.log(`\n[2/2] Claude Code headless…`);
  cc = await runCcEval({ tasks });
  console.log(`      ${cc.passed}/${cc.taskCount} in ${(cc.totalDurationMs / 1000).toFixed(1)}s`);
}

// ── the table ────────────────────────────────────────────────────────────
const idW = Math.max(4, ...tasks.map((t) => t.id.length));
const cell = (r) => (r ? `${r.passed ? "PASS" : "FAIL"} ${String(Math.round(r.durationMs / 100) / 10).padStart(5)}s` : "   —      ");
console.log("");
console.log(`${"TASK".padEnd(idW)}  ${"ARES".padEnd(11)}  ${"CLAUDE CODE".padEnd(11)}`);
console.log("-".repeat(idW + 28));
for (const t of tasks) {
  const a = ares?.tasks.find((r) => r.id === t.id);
  const c = cc?.tasks.find((r) => r.id === t.id);
  const marker = a && c && a.passed !== c.passed ? (a.passed ? "  ← Ares wins" : "  ← CC wins") : "";
  console.log(`${t.id.padEnd(idW)}  ${cell(a)}  ${cell(c)}${marker}`);
}
console.log("-".repeat(idW + 28));
const pct = (b) => (b ? `${(b.successRate * 100).toFixed(1)}%` : "—");
console.log(`SCORE   Ares: ${pct(ares)}   Claude Code: ${pct(cc)}`);
if (ares) console.log(`ARES TOKENS: ${ares.totalInputTokens} in / ${ares.totalOutputTokens} out`);

// ── the trend line ───────────────────────────────────────────────────────
const trendFile = path.join(telemetryDir(), "eval-trend.jsonl");
await mkdir(path.dirname(trendFile), { recursive: true });
const entry = {
  at: new Date().toISOString(),
  taskCount: tasks.length,
  ares: ares ? { provider, passed: ares.passed, rate: ares.successRate, inputTokens: ares.totalInputTokens, outputTokens: ares.totalOutputTokens, ms: ares.totalDurationMs } : null,
  claudeCode: cc ? { passed: cc.passed, rate: cc.successRate, ms: cc.totalDurationMs } : null,
};
await appendFile(trendFile, JSON.stringify(entry) + "\n", "utf8");
console.log(`\ntrend appended → ${trendFile}`);
