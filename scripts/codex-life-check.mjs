#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_GARRISON_PORT = 7421;
const KNOWN_ADB = "/opt/homebrew/Caskroom/android-platform-tools/36.0.2/platform-tools/adb";
const DEFAULT_DUOPLUS_SESSION = path.join(
  os.homedir(),
  "VAN",
  "mattclone-duo",
  "mattclone_duo",
  "duoplus-session.json",
);

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 8000,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error?.message,
  };
}

function commandPath(name) {
  const result = run("/bin/zsh", ["-lc", `command -v ${name}`], { timeout: 3000 });
  return result.ok ? result.stdout.split("\n")[0] : "";
}

function httpJson(port, route) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: route,
        timeout: 3000,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: JSON.parse(body) });
          } catch {
            resolve({ ok: false, status: res.statusCode, text: body.slice(0, 200) });
          }
        });
      },
    );
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
  });
}

async function checkDuoplusSession(file) {
  if (!fs.existsSync(file)) return { exists: false, file };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { exists: true, file, parseError: error.message };
  }

  const authorization = String(parsed.authorization || "").trim();
  const capturedAt = parsed.captured_at || null;
  const cookieCount = parsed.cookies && typeof parsed.cookies === "object" ? Object.keys(parsed.cookies).length : 0;
  const summary = {
    exists: true,
    file,
    capturedAt,
    ageMinutes: capturedAt ? Math.round((Date.now() - Date.parse(capturedAt)) / 60000) : null,
    hasAuthorization: Boolean(authorization),
    cookieCount,
  };

  if (!authorization || typeof fetch !== "function") return summary;

  try {
    const response = await fetch("https://api.duoplus.cn/account/profile", {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Lang: "en",
      },
      body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    return {
      ...summary,
      liveCheck: {
        ok: response.ok && data?.code === 200,
        status: response.status,
        code: data?.code ?? null,
        message: data?.message ?? null,
      },
    };
  } catch (error) {
    return { ...summary, liveCheck: { ok: false, error: error.message } };
  }
}

function printSection(title, data) {
  console.log(`\n## ${title}`);
  console.log(JSON.stringify(data, null, 2));
}

const aresHome = process.env.ARES_HOME || path.join(os.homedir(), ".ares");
const garrisonPort = Number(process.env.ARES_GARRISON_PORT || DEFAULT_GARRISON_PORT);
const adbPath = commandPath("adb") || (fs.existsSync(KNOWN_ADB) ? KNOWN_ADB : "");
const duoplusSessionFile = process.env.DUOPLUS_SESSION_FILE || DEFAULT_DUOPLUS_SESSION;

const adbDevices = adbPath ? run(adbPath, ["devices", "-l"], { timeout: 8000 }) : { ok: false, error: "adb not found" };
const adbLines = adbDevices.stdout
  ? adbDevices.stdout
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
  : [];

const pm2 = run("pm2", ["jlist"], { timeout: 8000 });
let pm2DuoplusChrome = null;
if (pm2.ok && pm2.stdout) {
  try {
    const processes = JSON.parse(pm2.stdout);
    const proc = processes.find((p) => p?.name === "duoplus-chrome");
    pm2DuoplusChrome = proc
      ? { name: proc.name, status: proc.pm2_env?.status, pid: proc.pid, restarts: proc.pm2_env?.restart_time }
      : null;
  } catch {
    pm2DuoplusChrome = { parseError: true };
  }
}

printSection("Ares", {
  repo: process.cwd(),
  aresHome,
  aresHomeExists: fs.existsSync(aresHome),
  garrisonPort,
  garrisonHealth: await httpJson(garrisonPort, "/health"),
});

printSection("Local ADB", {
  adbPath: adbPath || null,
  serverQueryOk: adbDevices.ok,
  devices: adbLines,
  deviceCount: adbLines.length,
  error: adbDevices.error || (adbDevices.ok ? null : adbDevices.stderr || "adb query failed"),
});

printSection("DuoPlus", {
  cdp9223: await httpJson(9223, "/json/version"),
  pm2DuoplusChrome,
  session: await checkDuoplusSession(duoplusSessionFile),
});
