// The Holotable v2 — a data-driven hologram BUILD engine. Any model drives it
// by emitting a HoloSpec (parts, wires, steps, BOM); the engine is fixed.
// These tests cover the engine bones, the spec contract (validation, custom
// specs, escaping), the built-in builds, and the CLI front door.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "packages", "cli", "dist", "entry.js");
const holotable = () => import("../packages/cli/dist/holotable.js");

test("engine bones: hologram, exploded view, assembly mode, wiring, BOM, STL export", async () => {
  const { buildHolotableHtml } = await holotable();
  const html = buildHolotableHtml();

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /"three": "https:\/\/cdn\.jsdelivr\.net\/npm\/three@/);
  assert.match(html, /OrbitControls/);
  // Exploded view (slider + per-part assembly axes).
  assert.match(html, /id="explode" type="range"/);
  assert.match(html, /exploded/);
  assert.match(html, /addScaledVector\(p\.axis/);
  // Hologram look.
  assert.match(html, /wireframe: true/);
  assert.match(html, /AdditiveBlending/);
  assert.match(html, /#c79a4e/);
  // The build-engine surfaces.
  assert.match(html, /ASSEMBLY MODE/);
  assert.match(html, /STLExporter/);
  assert.match(html, /CatmullRomCurve3/);
  assert.match(html, /PARTS \/ BOM/);
  assert.match(html, /Raycaster/);
  assert.ok(!html.includes("${escapeHtml"), "no unrendered template fragments");
});

test("any-model contract: a custom HoloSpec renders with its parts, wires, and steps embedded", async () => {
  const { buildHolotableHtml } = await holotable();
  const spec = {
    title: "TEST RIG",
    parts: [
      { id: "a", name: "PLATE A", kind: "box", size: [1, 0.2, 1], position: [0, 0, 0], printable: true },
      { id: "b", name: "MAST B", kind: "cylinder", size: [0.1, 0.1, 2], position: [0, 1.2, 0], vendor: "aluminum tube 10mm" },
    ],
    wires: [{ name: "a to b run", from: "a", to: "b", color: "#ff0000" }],
    steps: [{ title: "Mount", instruction: "Bolt the mast to the plate.", parts: ["a", "b"] }],
  };
  const html = buildHolotableHtml({ spec });
  assert.match(html, /PLATE A/);
  assert.match(html, /aluminum tube 10mm/);
  assert.match(html, /a to b run/);
  assert.match(html, /Bolt the mast to the plate\./);
});

test("validation: malformed specs are refused with human reasons", async () => {
  const { buildHolotableHtml, validateHoloSpec } = await holotable();
  assert.throws(() => buildHolotableHtml({ spec: { title: "x", parts: [] } }), /parts\[\] must be non-empty/);
  assert.throws(
    () =>
      validateHoloSpec({
        title: "x",
        parts: [{ id: "a", name: "A", kind: "box", size: [1], position: [0, 0, 0] }],
        wires: [{ name: "w", from: "a", to: "ghost" }],
      }),
    /unknown part ghost/,
  );
  assert.throws(
    () =>
      validateHoloSpec({
        title: "x",
        parts: [
          { id: "a", name: "A", kind: "box", size: [1], position: [0, 0, 0] },
          { id: "a", name: "A2", kind: "box", size: [1], position: [0, 0, 0] },
        ],
      }),
    /duplicate/,
  );
});

test("escaping: titles and spec content cannot break out of the document", async () => {
  const { buildHolotableHtml } = await holotable();
  const html = buildHolotableHtml({
    title: '<script>alert("x")</script>',
    spec: {
      title: "safe",
      parts: [{ id: "a", name: "</script><script>alert(1)</script>", kind: "box", size: [1], position: [0, 0, 0] }],
    },
  });
  assert.ok(!html.includes('<script>alert'), "injection neutralized");
  assert.match(html, /\\u003c/, "spec angle brackets unicode-escaped");
});

test("built-in builds: the robot arm is a complete buildable spec", async () => {
  const { ROBOT_ARM_SPEC, validateHoloSpec } = await holotable();
  validateHoloSpec(ROBOT_ARM_SPEC);
  const printables = ROBOT_ARM_SPEC.parts.filter((p) => p.printable);
  const purchases = ROBOT_ARM_SPEC.parts.filter((p) => !p.printable && p.vendor);
  assert.ok(printables.length >= 5, "real print list");
  assert.ok(purchases.length >= 4, "real vendor list");
  assert.ok(ROBOT_ARM_SPEC.wires.length >= 6, "full wiring map");
  assert.ok(ROBOT_ARM_SPEC.steps.length >= 7, "full assembly walkthrough");
  // Every servo channel is wired to the controller.
  const servoWires = ROBOT_ARM_SPEC.wires.filter((w) => w.from === "controller");
  assert.ok(servoWires.length >= 5);
});

test("CLI: holo (mech), holo arm, holo --spec file.json all forge valid documents", { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ares-holo-"));
  const env = { ...process.env, ARES_HOME: dir, ARES_AGENT_ENABLED: "0", NO_COLOR: "1" };
  const run = (...argv) =>
    spawnSync(process.execPath, [entry, "holo", ...argv], { cwd: root, encoding: "utf8", windowsHide: true, env });

  const mechOut = path.join(dir, "mech.html");
  assert.equal(run("--out", mechOut).status, 0);
  const mech = await readFile(mechOut, "utf8");
  for (const marker of ["three", "exploded", "input", "wireframe", "REACTOR CORE"]) {
    assert.ok(mech.includes(marker), `mech missing ${marker}`);
  }

  const armOut = path.join(dir, "arm.html");
  assert.equal(run("arm", "--out", armOut).status, 0);
  const arm = await readFile(armOut, "utf8");
  assert.ok(arm.includes("PCA9685") && arm.includes("GRIPPER JAW L"), "arm spec embedded");

  const specFile = path.join(dir, "custom.json");
  await writeFile(
    specFile,
    JSON.stringify({
      title: "CUSTOM",
      parts: [{ id: "x", name: "X PART", kind: "sphere", size: [1], position: [0, 1, 0] }],
    }),
    "utf8",
  );
  const customOut = path.join(dir, "custom.html");
  assert.equal(run(specFile, "--out", customOut).status, 0);
  assert.match(await readFile(customOut, "utf8"), /X PART/);

  // A malformed spec fails loudly, exit 2.
  const badFile = path.join(dir, "bad.json");
  await writeFile(badFile, JSON.stringify({ title: "bad", parts: [] }), "utf8");
  const bad = run(badFile, "--out", path.join(dir, "bad.html"));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /parts\[\]/);

  await rm(dir, { recursive: true, force: true });
});
