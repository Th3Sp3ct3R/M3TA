// Trust meter — deriveLeash math + the `ares operator trust` CLI surface.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deriveLeash, domainOf } from "../packages/operator/dist/index.js";

const run = promisify(execFile);
const ENTRY = path.resolve("packages/cli/dist/entry.js");

function node(over = {}) {
  return {
    id: "n1",
    kind: "procedural",
    status: "confirmed",
    content: "when the modal blocks the click, press Escape first",
    tags: ["domain:browser"],
    evidence: [{ won: true }, { won: true }],
    ...over,
  };
}

test("deriveLeash: base trust is 1 with no proven procedures", () => {
  const basis = deriveLeash([], "browser");
  assert.equal(basis.level, 1);
  assert.equal(basis.proven.length, 0);
});

test("deriveLeash: a confirmed net-positive procedure lengthens the leash", () => {
  const basis = deriveLeash([node()], "browser");
  assert.equal(basis.level, 2);
  assert.deepEqual(basis.proven, [{ id: "n1", wins: 2, losses: 0 }]);
});

test("deriveLeash: candidates and thin margins contribute nothing", () => {
  const candidate = node({ id: "n2", status: "candidate" });
  const thin = node({ id: "n3", evidence: [{ won: true }, { won: false }] }); // margin 0 < 2
  const semantic = node({ id: "n4", kind: "semantic" });
  const otherDomain = node({ id: "n5", tags: ["domain:fs"] });
  const basis = deriveLeash([candidate, thin, semantic, otherDomain], "browser");
  assert.equal(basis.level, 1);
});

test("deriveLeash: caps at 5 no matter how much proof", () => {
  const nodes = Array.from({ length: 9 }, (_, i) => node({ id: `n${i}` }));
  assert.equal(deriveLeash(nodes, "browser").level, 5);
});

test("domainOf reads the domain: tag", () => {
  assert.equal(domainOf(node()), "browser");
  assert.equal(domainOf(node({ tags: ["misc"] })), undefined);
});

test("ares operator trust --json reports the browser domain at base trust in a fresh home", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ares-trust-"));
  try {
    const { stdout } = await run(process.execPath, [ENTRY, "operator", "trust", "--json", "--home", home], {
      env: { ...process.env, ARES_HOME: home },
    });
    const basis = JSON.parse(stdout);
    assert.ok(Array.isArray(basis));
    const browser = basis.find((b) => b.domain === "browser");
    assert.ok(browser, "browser domain present");
    assert.equal(browser.level, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
