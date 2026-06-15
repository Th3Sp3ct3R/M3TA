// ComputerUse — drive the REAL desktop: screenshot, move, click, type, key,
// scroll. The capability that turns "an agent that types" into "an agent that
// operates your machine" — delete a Chrome extension, click through a native
// dialog, drive an app that has no API.
//
// Windows-first and ZERO new dependencies: it shells out to the built-in
// PowerShell + .NET (System.Windows.Forms / System.Drawing + a tiny user32
// P/Invoke). No nut.js, no robotjs, no native module to install — so it can
// never hit the "install loop" the headless browser used to. On non-Windows
// hosts it returns a terminal, non-retriable error telling the model to stop.
//
// Screenshots come back as IMAGE tool-results (EngineToolResult.images), so a
// vision-capable model literally sees the pixels and can act on what's on screen.

import { z } from "zod";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildTool } from "./_shared.js";

const inputSchema = z
  .object({
    action: z
      .enum([
        "screenshot",
        "zoom",
        "move",
        "click",
        "double_click",
        "right_click",
        "type",
        "key",
        "scroll",
        "cursor",
        "launch",
        "activate",
      ])
      .describe(
        "screenshot: capture the screen (downscaled, returned as an image you can see). zoom: capture a native-resolution rectangle at x,y of size w×h so small text/targets are legible and precisely clickable. move: move cursor to x,y. click/double_click/right_click: at x,y (or current position). type: send literal text. key: a key combo — SendKeys notation (^c=Ctrl+C, %{F4}=Alt+F4, {ENTER}, {TAB}, ~=Enter) OR a Windows-key chord like 'WIN', 'WIN+R', 'WIN+I'. scroll: wheel by amount (negative=down). cursor: report the current cursor position. launch: start an app/URI (text=program or ms-settings:/chrome:// URI, key=optional arguments) — use this to OPEN things, never the Win key. activate: bring a window to the foreground by title substring (text).",
      ),
    x: z.number().int().optional().describe("Target X for move/click/zoom — in the pixel coordinates of the LAST image you were shown (top-left origin)."),
    y: z.number().int().optional().describe("Target Y for move/click/zoom — in the pixel coordinates of the LAST image you were shown (top-left origin)."),
    w: z.number().int().positive().optional().describe("Zoom region width in screen pixels (default 800)."),
    h: z.number().int().positive().optional().describe("Zoom region height in screen pixels (default 600)."),
    text: z.string().optional().describe("Literal text for type; program/URI for launch; window-title substring for activate."),
    key: z.string().optional().describe("Key combo for the key action, or launch arguments."),
    amount: z.number().int().optional().describe("Wheel notches for scroll (negative scrolls down). Default 3."),
  })
  .strict();

export interface ComputerUseOutput {
  ok: boolean;
  action: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Downscale factor of the last shown image (physical px per image px). */
  scale?: number;
  error?: string;
  /** Where the screenshot PNG was also saved on disk (for desktop preview). */
  screenshotPath?: string;
  note?: string;
}

const MOUSE_ACTIONS = new Set(["move", "click", "double_click", "right_click"]);

/**
 * The model gives coordinates in the space of the IMAGE it was last shown. A
 * full-res 3840×1080 screen is downscaled to ≤1568px before the model sees it,
 * and on multi-monitor rigs the virtual screen doesn't start at (0,0). Without
 * mapping image-space back to physical-screen-space, every click misses. We
 * remember the last capture's scale+origin and convert here.
 */
let lastShot: { scale: number; originX: number; originY: number } = { scale: 1, originX: 0, originY: 0 };

function toPhysical(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(lastShot.originX + x * lastShot.scale),
    y: Math.round(lastShot.originY + y * lastShot.scale),
  };
}

export const ComputerUseTool = buildTool({
  name: "ComputerUse",
  description:
    "Control the REAL desktop (mouse, keyboard, screen) — for tasks about the user's machine and native apps, not files/code: clicking through a GUI, managing a browser extension, operating an app with no API. Doctrine: SCREENSHOT FIRST to see the screen, act on what you SEE (coordinates are screen pixels from the top-left), then screenshot again to verify. Windows only. Note: this controls the user's actual machine — be deliberate and confirm destructive/outward actions.",
  safety: "external-state",
  concurrency: "exclusive",
  inputZod: inputSchema,
  activityDescription: (i) => {
    if (i.action === "screenshot") return "Capturing the screen";
    if (i.action === "type") return "Typing on the desktop";
    if (i.action === "key") return `Pressing ${i.key ?? "a key"}`;
    if (MOUSE_ACTIONS.has(i.action) && i.x !== undefined) return `${i.action} at ${i.x},${i.y}`;
    return `Computer: ${i.action}`;
  },

  async call(i, _ctx): Promise<{ output: ComputerUseOutput; display: string; images?: Array<{ mediaType: string; data: string }> }> {
    if (process.env.ARES_COMPUTER_USE === "0") {
      throw new Error("COMPUTER_USE_DISABLED: ComputerUse is turned off (ARES_COMPUTER_USE=0).");
    }
    if (process.platform !== "win32") {
      // Terminal, non-retriable — do NOT try to install anything, switch tools.
      throw new Error(
        "COMPUTER_USE_UNAVAILABLE: desktop control is Windows-only in this build. Use the Browser tool for web tasks, or do the work through files/CLI instead.",
      );
    }

    const result = await runComputerAction(i);
    if (!result.ok) {
      throw new Error(`ComputerUse ${i.action} failed: ${result.error ?? "unknown error"}`);
    }

    if ((i.action === "screenshot" || i.action === "zoom") && result.image) {
      // Remember how to map image-space coords back to physical-screen-space
      // for the next click/move.
      lastShot = {
        scale: result.scale && result.scale > 0 ? result.scale : 1,
        originX: result.originX ?? 0,
        originY: result.originY ?? 0,
      };
      // Persist a copy under ARES_HOME (asset-protocol scope) so the desktop can
      // preview it; fall back to tmp if home isn't set.
      let screenshotPath: string | undefined;
      try {
        const base = process.env.ARES_HOME
          ? path.join(process.env.ARES_HOME, "screenshots")
          : path.join(os.tmpdir(), "ares-screenshots");
        await fs.mkdir(base, { recursive: true });
        screenshotPath = path.join(base, `shot-${Date.now()}.png`);
        await fs.writeFile(screenshotPath, Buffer.from(result.image, "base64"));
      } catch {
        screenshotPath = undefined;
      }
      const native = i.action === "zoom" ? "(native resolution)" : `(downscaled ${result.scale?.toFixed(2)}×)`;
      const output: ComputerUseOutput = {
        ok: true,
        action: i.action,
        width: result.width,
        height: result.height,
        scale: lastShot.scale,
        screenshotPath,
        note: `Captured ${native}. Give click/move coordinates in THIS image's pixel space (top-left origin); they're mapped to the real screen automatically. If a target is small or text is hard to read, 'zoom' into its region for a native-resolution view.`,
      };
      return {
        output,
        display: `Captured ${i.action} ${result.width}×${result.height}`,
        images: [{ mediaType: "image/png", data: result.image }],
      };
    }

    const output: ComputerUseOutput = {
      ok: true,
      action: i.action,
      x: result.x,
      y: result.y,
    };
    return { output, display: describeDone(i, result) };
  },
});

function describeDone(i: z.infer<typeof inputSchema>, r: PsResult): string {
  switch (i.action) {
    case "cursor":
      return `Cursor at ${r.x},${r.y}`;
    case "move":
      return `Moved to ${r.x},${r.y}`;
    case "type":
      return `Typed ${(i.text ?? "").length} chars`;
    case "key":
      return `Pressed ${i.key ?? ""}`;
    case "scroll":
      return `Scrolled ${i.amount ?? 3}`;
    default:
      return `${i.action} done`;
  }
}

interface PsResult {
  ok: boolean;
  action?: string;
  image?: string;
  width?: number;
  height?: number;
  scale?: number;
  originX?: number;
  originY?: number;
  x?: number;
  y?: number;
  error?: string;
}

/** Escape literal text for SendKeys: wrap special chars, turn newlines/tabs
 *  into real key presses. */
function escapeSendKeys(text: string): string {
  return text
    .replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`)
    .replace(/\r\n|\r|\n/g, "{ENTER}")
    .replace(/\t/g, "{TAB}");
}

let scriptPathPromise: Promise<string> | null = null;

async function ensureScript(): Promise<string> {
  scriptPathPromise ??= (async () => {
    const file = path.join(os.tmpdir(), "ares-computeruse.ps1");
    await fs.writeFile(file, POWERSHELL_DRIVER, "utf8");
    return file;
  })();
  return scriptPathPromise;
}

async function runComputerAction(input: z.infer<typeof inputSchema>): Promise<PsResult> {
  const script = await ensureScript();
  const actionFile = path.join(os.tmpdir(), `ares-cu-${randomUUID()}.json`);
  // Mouse actions: convert the model's image-space coordinates to physical
  // screen pixels. zoom: x,y are already physical (the region's top-left).
  let physX: number | null = input.x ?? null;
  let physY: number | null = input.y ?? null;
  if (MOUSE_ACTIONS.has(input.action) && input.x !== undefined && input.y !== undefined) {
    const p = toPhysical(input.x, input.y);
    physX = p.x;
    physY = p.y;
  }
  await fs.writeFile(
    actionFile,
    JSON.stringify({
      action: input.action,
      x: physX,
      y: physY,
      w: input.w ?? null,
      h: input.h ?? null,
      // Literal text must be SendKeys-escaped so +^%~(){}[] aren't read as
      // modifiers, and newlines/tabs become real key presses. launch/activate
      // use the raw text (program path / window title), not SendKeys-escaped.
      text: input.action === "type" ? escapeSendKeys(input.text ?? "") : (input.text ?? ""),
      key: input.key ?? "",
      amount: input.amount ?? 3,
    }),
    "utf8",
  );
  try {
    const ps = process.env.ARES_POWERSHELL || "powershell";
    const stdout = await spawnCapture(
      ps,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, actionFile],
      20_000,
    );
    const marker = "ARES_RESULT:";
    const line = stdout.split(/\r?\n/).find((l) => l.includes(marker));
    if (!line) {
      return { ok: false, error: `no result from PowerShell driver. Output: ${stdout.slice(0, 300)}` };
    }
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length)) as PsResult;
  } finally {
    await fs.rm(actionFile, { force: true }).catch(() => {});
  }
}

function spawnCapture(program: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdout.includes("ARES_RESULT:")) return resolve(stdout);
      if (code === 0) return resolve(stdout);
      reject(new Error(stderr.trim() || `PowerShell exited ${code}`));
    });
  });
}

// The driver: reads one action from a JSON file, performs it via .NET + a tiny
// user32 P/Invoke, prints exactly one `ARES_RESULT:{json}` line.
const POWERSHELL_DRIVER = String.raw`param([string]$ActionFile)
$ErrorActionPreference = 'Stop'
function Out-Result($obj) { Write-Output ("ARES_RESULT:" + ($obj | ConvertTo-Json -Compress -Depth 6)) }
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AresIn {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
}
"@
  $a = Get-Content -Raw -LiteralPath $ActionFile | ConvertFrom-Json
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  function Set-Pos($x, $y) { [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point([int]$x, [int]$y) }
  function Mouse($down, $up) {
    [AresIn]::mouse_event($down, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 25
    [AresIn]::mouse_event($up, 0, 0, 0, [IntPtr]::Zero)
  }
  function Take-Shot {
    $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size)
    $g.Dispose()
    # Downscale so the long edge is <= 1568px: that's the model's vision limit,
    # above which the API silently shrinks it (and small UI text becomes ~5px,
    # unaimable). Report the scale so coordinates can be mapped back.
    $maxEdge = [Math]::Max($vs.Width, $vs.Height)
    $scale = 1.0
    if ($maxEdge -gt 1568) { $scale = $maxEdge / 1568.0 }
    $outW = [int][Math]::Round($vs.Width / $scale)
    $outH = [int][Math]::Round($vs.Height / $scale)
    $scaled = New-Object System.Drawing.Bitmap($outW, $outH)
    $sg = [System.Drawing.Graphics]::FromImage($scaled)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.DrawImage($bmp, 0, 0, $outW, $outH)
    $sg.Dispose(); $bmp.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $scaled.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $scaled.Dispose()
    return @{ image = [Convert]::ToBase64String($ms.ToArray()); width = $outW; height = $outH; scale = $scale; originX = $vs.X; originY = $vs.Y }
  }
  switch ($a.action) {
    'screenshot' {
      $s = Take-Shot
      Out-Result @{ ok = $true; action = 'screenshot'; image = $s.image; width = $s.width; height = $s.height; scale = $s.scale; originX = $s.originX; originY = $s.originY }
    }
    'zoom' {
      $zx = [int]$a.x; $zy = [int]$a.y
      $zw = [int]$a.w; $zh = [int]$a.h
      if ($zw -le 0) { $zw = 800 }
      if ($zh -le 0) { $zh = 600 }
      $bmp = New-Object System.Drawing.Bitmap($zw, $zh)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($zx, $zy, 0, 0, (New-Object System.Drawing.Size($zw, $zh)))
      $g.Dispose()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
      # Native resolution: scale 1, origin = region top-left, so a click in this
      # image maps straight to the screen.
      Out-Result @{ ok = $true; action = 'zoom'; image = [Convert]::ToBase64String($ms.ToArray()); width = $zw; height = $zh; scale = 1.0; originX = $zx; originY = $zy }
    }
    'launch' {
      if ([string]$a.key -ne '') { Start-Process -FilePath ([string]$a.text) -ArgumentList ([string]$a.key) }
      else { Start-Process ([string]$a.text) }
      Out-Result @{ ok = $true; action = 'launch' }
    }
    'activate' {
      Add-Type -AssemblyName Microsoft.VisualBasic
      [Microsoft.VisualBasic.Interaction]::AppActivate([string]$a.text)
      Out-Result @{ ok = $true; action = 'activate' }
    }
    'cursor' {
      $p = [System.Windows.Forms.Cursor]::Position
      Out-Result @{ ok = $true; action = 'cursor'; x = $p.X; y = $p.Y }
    }
    'move' {
      Set-Pos $a.x $a.y
      Out-Result @{ ok = $true; action = 'move'; x = [int]$a.x; y = [int]$a.y }
    }
    'click' {
      if ($a.x -ne $null) { Set-Pos $a.x $a.y; Start-Sleep -Milliseconds 20 }
      Mouse 0x0002 0x0004
      $p = [System.Windows.Forms.Cursor]::Position
      Out-Result @{ ok = $true; action = 'click'; x = $p.X; y = $p.Y }
    }
    'double_click' {
      if ($a.x -ne $null) { Set-Pos $a.x $a.y; Start-Sleep -Milliseconds 20 }
      Mouse 0x0002 0x0004; Start-Sleep -Milliseconds 60; Mouse 0x0002 0x0004
      $p = [System.Windows.Forms.Cursor]::Position
      Out-Result @{ ok = $true; action = 'double_click'; x = $p.X; y = $p.Y }
    }
    'right_click' {
      if ($a.x -ne $null) { Set-Pos $a.x $a.y; Start-Sleep -Milliseconds 20 }
      Mouse 0x0008 0x0010
      $p = [System.Windows.Forms.Cursor]::Position
      Out-Result @{ ok = $true; action = 'right_click'; x = $p.X; y = $p.Y }
    }
    'scroll' {
      $notches = [int]$a.amount
      if ($notches -eq 0) { $notches = 3 }
      $delta = $notches * 120
      if ($delta -lt 0) { $delta = $delta + 4294967296 }
      [AresIn]::mouse_event(0x0800, 0, 0, [uint32]$delta, [IntPtr]::Zero)
      Out-Result @{ ok = $true; action = 'scroll' }
    }
    'type' {
      [System.Windows.Forms.SendKeys]::SendWait([string]$a.text)
      Out-Result @{ ok = $true; action = 'type' }
    }
    'key' {
      $k = [string]$a.key
      if ($k -match '^(?i:win)\b') {
        # SendKeys can't press the Windows key. Hold LWIN (0x5B) and tap the rest.
        $rest = ($k -replace '^(?i:win)\s*\+?\s*', '')
        [AresIn]::keybd_event(0x5B, 0, 0, [IntPtr]::Zero)
        if ($rest.Length -gt 0) { [System.Windows.Forms.SendKeys]::SendWait($rest) }
        Start-Sleep -Milliseconds 40
        [AresIn]::keybd_event(0x5B, 0, 2, [IntPtr]::Zero)
        Out-Result @{ ok = $true; action = 'key' }
      } else {
        [System.Windows.Forms.SendKeys]::SendWait($k)
        Out-Result @{ ok = $true; action = 'key' }
      }
    }
    default { Out-Result @{ ok = $false; error = ("unknown action: " + $a.action) } }
  }
}
catch {
  Out-Result @{ ok = $false; error = $_.Exception.Message }
}
`;
