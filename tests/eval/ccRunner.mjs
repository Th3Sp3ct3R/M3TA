// Claude Code comparison runner — the OTHER line on the scoreboard.
//
// Runs the exact same eval tasks through the Claude Code CLI (`claude -p`,
// headless, permissions skipped) in the same seeded temp workspaces, graded by
// the same deterministic graders as the Ares runner. Same model family, same
// tasks, same judge — the only variable left is the harness. That is the
// number the gap-closing plan steers by.
//
// Usage:
//   node tests/eval/ccRunner.mjs                 # all tasks
//   node tests/eval/ccRunner.mjs --task <id>     # one task
//   node tests/eval/ccRunner.mjs --json          # machine-readable
//
// Requires a logged-in Claude Code CLI on PATH (override: ARES_CC_CMD).
// Each task costs real usage on the owner's Claude plan — mind the suite size.

import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { loadTasks, gradeTask, seedWorkspace } from "./runner.mjs";

const CC_CMD = process.env.ARES_CC_CMD || "claude";
const TASK_TIMEOUT_MS = Number(process.env.ARES_CC_TIMEOUT_MS) || 240_000;

/** Run one task through headless Claude Code in `workspace`. */
export function runCcOnTask(task, workspace, { timeoutMs = TASK_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // Prompt goes over STDIN so quoting/newlines survive every shell.
    // Scrub session markers so a run launched from INSIDE Claude Code doesn't
    // look nested to the child CLI.
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
      if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) delete env[k];
    }
    const child = spawn(CC_CMD, ["-p", "--dangerously-skip-permissions"], {
      cwd: workspace,
      env,
      shell: process.platform === "win32", // resolve claude.cmd on PATH
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      resolve({ durationMs: Date.now() - t0, error, outputTail: (out + err).slice(-400) });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(`timeout after ${timeoutMs}ms`);
    }, timeoutMs);
    child.stdout.on("data", (b) => (out += b.toString("utf8")));
    child.stderr.on("data", (b) => (err += b.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      finish(`spawn failed: ${e.message} (is the Claude Code CLI on PATH?)`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? null : `exit ${code}`);
    });
    child.stdin.write(task.prompt);
    child.stdin.end();
  });
}

/** Run the suite through Claude Code. Same scoreboard shape as runEval. */
export async function runCcEval({ tasks, keepWorkspaces = false } = {}) {
  const allTasks = tasks ?? (await loadTasks());
  const results = [];
  const suiteStart = Date.now();
  for (const task of allTasks) {
    const workspace = await seedWorkspace(task);
    const run = await runCcOnTask(task, workspace);
    const grade = gradeTask(task, workspace);
    results.push({
      id: task.id,
      title: task.title || task.id,
      passed: grade.passed,
      detail: grade.detail,
      toolCalls: 0, // opaque — CC doesn't expose per-run tool counts headlessly
      inputTokens: 0,
      outputTokens: 0,
      error: run.error,
      durationMs: run.durationMs,
    });
    if (!keepWorkspaces) await rm(workspace, { recursive: true, force: true });
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    schemaVersion: 1,
    suite: "coding-eval-v1",
    provider: "claude-code",
    taskCount: results.length,
    passed,
    failed: results.length - passed,
    successRate: results.length ? passed / results.length : 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: Date.now() - suiteStart,
    tasks: results,
  };
}

// CLI entry
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const taskId = args.includes("--task") ? args[args.indexOf("--task") + 1] : null;
  const tasks = (await loadTasks()).filter((t) => !taskId || t.id === taskId);
  if (tasks.length === 0) {
    console.error(`no task matched ${taskId}`);
    process.exit(2);
  }
  const board = await runCcEval({ tasks });
  if (args.includes("--json")) {
    console.log(JSON.stringify(board, null, 2));
  } else {
    const { formatScoreboard } = await import("./runner.mjs");
    console.log(formatScoreboard(board));
  }
  process.exit(board.failed === 0 ? 0 : 1);
}
