// Prompt A/B — does the full Ares persona EARN its tokens on coding tasks?
//
// Runs the eval suite twice against a real provider: once with the compact
// eval prompt (variant "compact"), once with the product's full
// buildSystemPrompt() persona (variant "persona"). Compares score + tokens.
// Every sentence of the persona is paid on every turn of every session —
// this is the experiment that decides what stays.
//
// Usage:
//   node tests/eval/promptAb.mjs --provider anthropic [--task <id>]
//
// Requires a working provider key (env or Ares settings). Mock mode is
// meaningless here (the scripted provider ignores the prompt) and is refused.

import { loadTasks, runEval } from "./runner.mjs";

const args = process.argv.slice(2);
const value = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const provider = value("--provider", "anthropic");
if (provider === "mock") {
  console.error("promptAb needs a real provider — the scripted mock ignores prompts entirely.");
  process.exit(2);
}
const taskId = value("--task", null);
const tasks = (await loadTasks()).filter((t) => !taskId || t.id === taskId);

const { buildSystemPrompt } = await import("../../packages/cli/dist/entry/turnPipeline.js");
const persona = buildSystemPrompt();

console.log(`A/B over ${tasks.length} task(s) via ${provider}`);
console.log(`variant "compact": ~${Math.round(0.25 * 300)} tokens · variant "persona": ~${Math.round(persona.length / 4).toLocaleString()} tokens of system prompt\n`);

console.log(`[A] compact…`);
const compact = await runEval({ tasks, providerName: provider });
console.log(`    ${compact.passed}/${compact.taskCount} · ${compact.totalInputTokens} in / ${compact.totalOutputTokens} out\n`);

console.log(`[B] full persona…`);
const full = await runEval({ tasks, providerName: provider, systemPrompt: persona });
console.log(`    ${full.passed}/${full.taskCount} · ${full.totalInputTokens} in / ${full.totalOutputTokens} out\n`);

const rate = (b) => `${(b.successRate * 100).toFixed(1)}%`;
console.log("VERDICT");
console.log(`  score   compact ${rate(compact)}  vs  persona ${rate(full)}`);
console.log(`  tokens  compact ${compact.totalInputTokens + compact.totalOutputTokens}  vs  persona ${full.totalInputTokens + full.totalOutputTokens}`);
const delta = full.successRate - compact.successRate;
console.log(
  delta > 0.02
    ? "  → the persona EARNS its tokens on these tasks."
    : delta < -0.02
      ? "  → the persona is COSTING accuracy — trim it against this suite."
      : "  → no meaningful score difference — the persona is paying rent in tokens only; consider conditional injection.",
);
