// The Holotable (ARES) — a data-driven hologram BUILD engine, not a demo.
//
// Doctrine: deterministic spine, LLM judgment. Any model — whatever is
// plugged into Ares — drives the Holotable by emitting a declarative
// HoloSpec (parts, wiring runs, assembly steps, bill of materials). The
// engine below is fixed and renders any valid spec: bronze-hologram parts
// with per-part assembly axes, an exploded-view slider, a step-by-step
// ASSEMBLY walkthrough, a glowing wiring overlay, a BOM panel that splits
// print-vs-purchase and exports printable parts as STL straight to your
// slicer, and a raycast inspector. One self-contained HTML file, no build
// step — open it and build the thing in your hands.
//
// Built-in specs: MECH_SPEC (the showpiece) and ROBOT_ARM_SPEC (a real DIY
// 6-servo robot arm: print list, vendor list, wiring map, 8 assembly steps).
// `ares holo --spec file.json` renders anything a model dreams up.

export interface HoloPart {
  id: string;
  name: string;
  /** Primitive geometry kind. */
  kind: "box" | "cylinder" | "sphere" | "icosa" | "capsule" | "cone" | "torus";
  /** Dimensions, kind-specific: box [w,h,d]; cylinder [rTop,rBottom,h]; sphere [r]; icosa [r]; capsule [r,len]; cone [r,h]; torus [r,tube]. */
  size: number[];
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Exploded-view travel direction (default: outward from origin). */
  axis?: [number, number, number];
  /** Exploded-view travel distance (default 1.5). */
  travel?: number;
  /** BOM: 3D-printable part (STL export offered) vs purchased. */
  printable?: boolean;
  /** BOM: where to buy / what to search for. */
  vendor?: string;
  qty?: number;
  /** Inspector note: what this part does, what to watch for. */
  note?: string;
}

export interface HoloWire {
  name: string;
  /** Part ids (wire runs between their centers) or raw [x,y,z] points. */
  from: string | [number, number, number];
  to: string | [number, number, number];
  /** Optional intermediate routing points. */
  via?: Array<[number, number, number]>;
  color?: string;
}

export interface HoloStep {
  title: string;
  instruction: string;
  /** Parts placed in this step (ids). */
  parts: string[];
}

export interface HoloSpec {
  title: string;
  accent?: string;
  parts: HoloPart[];
  wires?: HoloWire[];
  steps?: HoloStep[];
}

export interface HolotableOptions {
  title?: string;
  /** Render a declarative build spec (the main mode). */
  spec?: HoloSpec;
  /** Or load an external GLTF/GLB and explode it radially. */
  modelUrl?: string;
  accent?: string;
}

/** Light validation — throws with a human reason on a malformed spec. */
export function validateHoloSpec(spec: HoloSpec): void {
  if (!spec || typeof spec.title !== "string") throw new Error("HoloSpec: title is required");
  if (!Array.isArray(spec.parts) || spec.parts.length === 0) throw new Error("HoloSpec: parts[] must be non-empty");
  const ids = new Set<string>();
  for (const p of spec.parts) {
    if (!p.id || ids.has(p.id)) throw new Error(`HoloSpec: duplicate or missing part id: ${p.id}`);
    ids.add(p.id);
    if (!Array.isArray(p.position) || p.position.length !== 3) throw new Error(`HoloSpec: part ${p.id} needs position [x,y,z]`);
    if (!Array.isArray(p.size) || p.size.length === 0) throw new Error(`HoloSpec: part ${p.id} needs size[]`);
  }
  for (const w of spec.wires ?? []) {
    for (const end of [w.from, w.to]) {
      if (typeof end === "string" && !ids.has(end)) throw new Error(`HoloSpec: wire "${w.name}" references unknown part ${end}`);
    }
  }
  for (const s of spec.steps ?? []) {
    for (const id of s.parts) {
      if (!ids.has(id)) throw new Error(`HoloSpec: step "${s.title}" references unknown part ${id}`);
    }
  }
}

export function buildHolotableHtml(opts: HolotableOptions = {}): string {
  const spec = opts.modelUrl ? null : (opts.spec ?? MECH_SPEC);
  if (spec) validateHoloSpec(spec);
  const title = opts.title ?? spec?.title ?? "ARES // HOLOTABLE";
  const accent = opts.accent ?? spec?.accent ?? "#c79a4e";
  // </script> inside the JSON would terminate the script block — neutralize.
  const specJson = spec ? JSON.stringify(spec).replace(/</g, "\\u003c") : "null";
  const modelUrl = opts.modelUrl ? JSON.stringify(opts.modelUrl) : "null";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0c0a0b; overflow: hidden; font-family: "Cascadia Code", ui-monospace, Consolas, monospace; }
  #scene { position: fixed; inset: 0; display: block; }
  .hud { position: fixed; pointer-events: none; color: ${accent}; text-shadow: 0 0 12px ${accent}66; letter-spacing: 0.14em; }
  #title { top: 18px; left: 22px; font-size: 13px; opacity: 0.9; }
  #part { top: 40px; left: 22px; font-size: 11px; opacity: 0.8; max-width: 44vw; }
  #note { top: 58px; left: 22px; font-size: 10px; opacity: 0.55; max-width: 40vw; letter-spacing: 0.04em; }
  #dock { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; gap: 14px; align-items: center;
          padding: 10px 18px; border: 1px solid ${accent}44; border-radius: 10px; background: #121013cc; backdrop-filter: blur(8px); }
  #dock label, #dock button { color: ${accent}; font-size: 10px; letter-spacing: 0.18em; font-family: inherit; }
  #dock button { background: none; border: 1px solid ${accent}55; border-radius: 6px; padding: 5px 10px; cursor: pointer; }
  #dock button:hover { background: ${accent}22; }
  #dock button.on { background: ${accent}33; }
  #explode { width: 220px; accent-color: ${accent}; }
  #steppanel { position: fixed; left: 50%; bottom: 78px; transform: translateX(-50%); display: none; max-width: 560px;
               padding: 10px 16px; border: 1px solid ${accent}44; border-radius: 10px; background: #121013d9; color: #e9dfd0; }
  #steppanel h3 { margin: 0 0 4px; font-size: 11px; color: ${accent}; letter-spacing: 0.16em; }
  #steppanel p { margin: 0; font-size: 11px; line-height: 1.5; opacity: 0.85; }
  #bom { position: fixed; right: 0; top: 0; bottom: 0; width: 280px; overflow-y: auto; transform: translateX(100%);
         transition: transform 240ms ease; background: #121013ee; border-left: 1px solid ${accent}33; padding: 16px; }
  #bom.open { transform: none; }
  #bom h2 { font-size: 11px; color: ${accent}; letter-spacing: 0.2em; margin: 12px 0 6px; }
  .bomrow { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 5px 0;
            border-bottom: 1px solid ${accent}1a; color: #e9dfd0; font-size: 10px; }
  .bomrow small { opacity: 0.55; display: block; }
  .bomrow button { color: ${accent}; background: none; border: 1px solid ${accent}55; border-radius: 5px;
                   font: inherit; padding: 2px 7px; cursor: pointer; }
  #hint { position: fixed; left: 22px; bottom: 24px; font-size: 10px; opacity: 0.45; }
</style>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<canvas id="scene"></canvas>
<div class="hud" id="title">${escapeHtml(title)}</div>
<div class="hud" id="part">&nbsp;</div>
<div class="hud" id="note">&nbsp;</div>
<div id="steppanel"><h3 id="steptitle"></h3><p id="stepbody"></p></div>
<div id="dock">
  <button id="modebtn">ASSEMBLY MODE</button>
  <button id="prevbtn" style="display:none">&#9664; PREV</button>
  <button id="nextbtn" style="display:none">NEXT &#9654;</button>
  <label for="explode" id="explabel">DISASSEMBLE</label>
  <input id="explode" type="range" min="0" max="1" step="0.001" value="0" />
  <button id="wirebtn">WIRING</button>
  <button id="bombtn">PARTS / BOM</button>
</div>
<aside id="bom"></aside>
<div class="hud" id="hint">drag · rotate&nbsp;&nbsp;wheel · zoom&nbsp;&nbsp;hover · inspect</div>

<script type="module">
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

const ACCENT = new THREE.Color("${accent}");
const SPEC = ${specJson};
const MODEL_URL = ${modelUrl};

// ── stage ─────────────────────────────────────────────────────────────────
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#080708");
scene.fog = new THREE.FogExp2("#080708", 0.028);
const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
camera.position.set(6.5, 4.2, 8.5);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 2.0, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.45;

// ── the projection dais: glowing disc + concentric scan rings ──────────────
const dais = new THREE.Group();
scene.add(dais);
const discMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const disc = new THREE.Mesh(new THREE.CircleGeometry(7.5, 64), discMat);
disc.rotation.x = -Math.PI / 2;
disc.position.y = -0.02;
dais.add(disc);
const ringMats = [];
for (let r = 0; r < 4; r++) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.6 + r * 1.7, 1.66 + r * 1.7, 96),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.22 - r * 0.035, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  dais.add(ring);
  ringMats.push(ring);
}
// faint radial-fade floor grid
const grid = new THREE.GridHelper(50, 50, ACCENT.clone().multiplyScalar(0.6), ACCENT.clone().multiplyScalar(0.14));
grid.material.transparent = true;
grid.material.opacity = 0.16;
scene.add(grid);

scene.add(new THREE.AmbientLight(ACCENT, 0.4));
const key = new THREE.PointLight(ACCENT, 70, 90);
key.position.set(6, 9, 6);
scene.add(key);
const underGlow = new THREE.PointLight(new THREE.Color("#e3b86a"), 24, 30);
underGlow.position.set(0, 0.4, 0);
scene.add(underGlow);

// ── ambient mote field ─────────────────────────────────────────────────────
const moteGeo = new THREE.BufferGeometry();
const MOTES = 260;
const motePos = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES; i++) {
  motePos[i * 3] = (Math.random() - 0.5) * 22;
  motePos[i * 3 + 1] = Math.random() * 11;
  motePos[i * 3 + 2] = (Math.random() - 0.5) * 22;
}
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: ACCENT, size: 0.045, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(motes);

// ── the build scan-plane: a bronze sheet that sweeps up through the model ──
const scanPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 9),
  new THREE.MeshBasicMaterial({ color: new THREE.Color("#e3b86a"), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
);
scanPlane.rotation.x = -Math.PI / 2;
scene.add(scanPlane);

// ── hologram materials — wire shell + translucent surface + additive glow ──
function holoMaterials() {
  const wire = new THREE.MeshBasicMaterial({ color: ACCENT, wireframe: true, transparent: true, opacity: 0.9 });
  const surface = new THREE.MeshPhongMaterial({ color: ACCENT, emissive: ACCENT.clone().multiplyScalar(0.25), transparent: true, opacity: 0.12, shininess: 80, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false });
  return { wire, surface, glow };
}

function buildGeometry(part) {
  const s = part.size;
  switch (part.kind) {
    case "box": return new THREE.BoxGeometry(s[0], s[1], s[2]);
    case "cylinder": return new THREE.CylinderGeometry(s[0], s[1] !== undefined ? s[1] : s[0], s[2] !== undefined ? s[2] : 1, 12);
    case "sphere": return new THREE.SphereGeometry(s[0], 14, 12);
    case "icosa": return new THREE.IcosahedronGeometry(s[0], 1);
    case "capsule": return new THREE.CapsuleGeometry(s[0], s[1], 4, 10);
    case "cone": return new THREE.ConeGeometry(s[0], s[1], 10);
    case "torus": return new THREE.TorusGeometry(s[0], s[1], 10, 24);
    default: return new THREE.BoxGeometry(0.5, 0.5, 0.5);
  }
}

// ── parts from spec ───────────────────────────────────────────────────────
const rig = new THREE.Group();
scene.add(rig);
const parts = []; // { group, shell, glowMesh, spec, base, axis, travel, placed }
const byId = new Map();

function addSpecPart(p) {
  const geometry = buildGeometry(p);
  const { wire, surface, glow } = holoMaterials();
  const group = new THREE.Group();
  group.name = p.name;
  const glowMesh = new THREE.Mesh(geometry, glow);
  glowMesh.scale.setScalar(0.985);
  const surfaceMesh = new THREE.Mesh(geometry, surface);
  surfaceMesh.scale.setScalar(0.992);
  const shell = new THREE.Mesh(geometry, wire);
  group.add(glowMesh, surfaceMesh, shell);
  const base = new THREE.Vector3(p.position[0], p.position[1], p.position[2]);
  group.position.copy(base);
  if (p.rotation) group.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
  rig.add(group);
  let axis;
  if (p.axis) axis = new THREE.Vector3(p.axis[0], p.axis[1], p.axis[2]);
  else if (base.lengthSq() > 1e-6) axis = base.clone();
  else axis = new THREE.Vector3(0, 1, 0);
  const entry = { group, shell, glowMesh, spec: p, base, axis: axis.normalize(), travel: p.travel !== undefined ? p.travel : 1.5, placed: true };
  parts.push(entry);
  byId.set(p.id, entry);
  return entry;
}

if (SPEC) {
  for (const p of SPEC.parts) addSpecPart(p);
} else if (MODEL_URL) {
  new GLTFLoader().load(MODEL_URL, (gltf) => {
    const root = gltf.scene;
    rig.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.traverse((child) => {
      if (!child.isMesh) return;
      const { wire } = holoMaterials();
      child.material = wire;
      const cc = new THREE.Box3().setFromObject(child).getCenter(new THREE.Vector3());
      const axis = cc.clone().sub(center);
      if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
      parts.push({ group: child, shell: child, glowMesh: null, spec: { id: child.uuid, name: child.name || "part" }, base: child.position.clone(), axis: axis.normalize(), travel: 1.6, placed: true });
    });
  });
}

// ── wiring overlay: glowing routed runs between part centers ─────────────
const wiring = new THREE.Group();
wiring.visible = false;
scene.add(wiring);
function endpoint(ref) {
  if (Array.isArray(ref)) return new THREE.Vector3(ref[0], ref[1], ref[2]);
  const part = byId.get(ref);
  return part ? part.base.clone() : new THREE.Vector3();
}
if (SPEC && SPEC.wires) {
  for (const w of SPEC.wires) {
    const pts = [endpoint(w.from)];
    for (const v of w.via || []) pts.push(new THREE.Vector3(v[0], v[1], v[2]));
    pts.push(endpoint(w.to));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 40, 0.03, 6, false);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(w.color || "#7fa6a3"),
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(tube, mat);
    mesh.name = "WIRE: " + w.name;
    wiring.add(mesh);
  }
}

// ── BOM panel: print list, purchase list, STL export to your slicer ───────
const bomEl = document.getElementById("bom");
const exporter = new STLExporter();
function downloadStl(entry) {
  // Export the shell mesh with its world transform baked, ready to slice.
  const mesh = new THREE.Mesh(entry.shell.geometry.clone(), new THREE.MeshBasicMaterial());
  mesh.rotation.copy(entry.group.rotation);
  mesh.updateMatrixWorld(true);
  const stl = exporter.parse(mesh, { binary: false });
  const blob = new Blob([stl], { type: "model/stl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = entry.spec.id + ".stl";
  a.click();
  URL.revokeObjectURL(a.href);
}
if (SPEC) {
  const printables = parts.filter((p) => p.spec.printable);
  const purchases = parts.filter((p) => !p.spec.printable);
  const section = (label) => {
    const h = document.createElement("h2");
    h.textContent = label;
    bomEl.appendChild(h);
  };
  const row = (entry, withStl) => {
    const div = document.createElement("div");
    div.className = "bomrow";
    const left = document.createElement("div");
    const qty = entry.spec.qty && entry.spec.qty > 1 ? " \\u00d7" + entry.spec.qty : "";
    left.innerHTML = entry.spec.name + qty + (entry.spec.vendor ? "<small>" + entry.spec.vendor + "</small>" : "");
    div.appendChild(left);
    if (withStl) {
      const btn = document.createElement("button");
      btn.textContent = "STL";
      btn.title = "export for 3D printing";
      btn.addEventListener("click", () => downloadStl(entry));
      div.appendChild(btn);
    }
    bomEl.appendChild(div);
  };
  if (printables.length) { section("PRINT THESE (" + printables.length + ")"); printables.forEach((p) => row(p, true)); }
  if (purchases.length) { section("BUY THESE (" + purchases.length + ")"); purchases.forEach((p) => row(p, false)); }
  if (SPEC.wires && SPEC.wires.length) {
    section("WIRING RUNS (" + SPEC.wires.length + ")");
    for (const w of SPEC.wires) {
      const div = document.createElement("div");
      div.className = "bomrow";
      div.innerHTML = "<div>" + w.name + "</div>";
      bomEl.appendChild(div);
    }
  }
}

// ── modes: INSPECT (exploded slider) / ASSEMBLY (step walkthrough) ────────
const exploded = { current: 0, target: 0 };
const steps = (SPEC && SPEC.steps) || [];
let mode = "inspect";
let stepIndex = -1; // -1 = nothing placed yet
const modeBtn = document.getElementById("modebtn");
const prevBtn = document.getElementById("prevbtn");
const nextBtn = document.getElementById("nextbtn");
const slider = document.getElementById("explode");
const expLabel = document.getElementById("explabel");
const stepPanel = document.getElementById("steppanel");
const stepTitle = document.getElementById("steptitle");
const stepBody = document.getElementById("stepbody");

slider.addEventListener("input", (e) => { exploded.target = Number(e.target.value); });
document.getElementById("wirebtn").addEventListener("click", (e) => {
  wiring.visible = !wiring.visible;
  e.target.classList.toggle("on", wiring.visible);
});
document.getElementById("bombtn").addEventListener("click", (e) => {
  bomEl.classList.toggle("open");
  e.target.classList.toggle("on", bomEl.classList.contains("open"));
});

function applyStep() {
  const placedIds = new Set();
  for (let i = 0; i <= stepIndex && i < steps.length; i++) for (const id of steps[i].parts) placedIds.add(id);
  const currentIds = stepIndex >= 0 && stepIndex < steps.length ? new Set(steps[stepIndex].parts) : new Set();
  for (const p of parts) {
    p.placed = placedIds.has(p.spec.id);
    p.group.visible = p.placed;
    p.current = currentIds.has(p.spec.id);
    if (p.shell.material) p.shell.material.opacity = p.current ? 1.0 : 0.45;
  }
  if (stepIndex >= 0 && stepIndex < steps.length) {
    stepPanel.style.display = "block";
    stepTitle.textContent = "STEP " + (stepIndex + 1) + "/" + steps.length + " — " + steps[stepIndex].title;
    stepBody.textContent = steps[stepIndex].instruction;
  } else {
    stepPanel.style.display = "none";
  }
  prevBtn.disabled = stepIndex < 0;
  nextBtn.disabled = stepIndex >= steps.length - 1;
}

modeBtn.addEventListener("click", () => {
  if (steps.length === 0) { modeBtn.textContent = "NO STEPS IN SPEC"; return; }
  mode = mode === "inspect" ? "assembly" : "inspect";
  const assembly = mode === "assembly";
  modeBtn.classList.toggle("on", assembly);
  modeBtn.textContent = assembly ? "INSPECT MODE" : "ASSEMBLY MODE";
  prevBtn.style.display = nextBtn.style.display = assembly ? "" : "none";
  slider.style.display = expLabel.style.display = assembly ? "none" : "";
  if (assembly) { exploded.target = 0; stepIndex = steps.length ? 0 : -1; applyStep(); }
  else { stepIndex = -1; stepPanel.style.display = "none"; for (const p of parts) { p.group.visible = true; p.current = false; if (p.shell.material) p.shell.material.opacity = 0.85; } }
});
prevBtn.addEventListener("click", () => { if (stepIndex > 0) { stepIndex--; applyStep(); } });
nextBtn.addEventListener("click", () => { if (stepIndex < steps.length - 1) { stepIndex++; applyStep(); } });

// ── raycast inspector ─────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-2, -2);
canvas.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
const partLabel = document.getElementById("part");
const noteLabel = document.getElementById("note");

// ── loop ──────────────────────────────────────────────────────────────────
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;
  exploded.current += (exploded.target - exploded.current) * Math.min(1, dt * 7);
  const t = mode === "assembly" ? 0 : exploded.current;
  for (const p of parts) {
    // exploded translation along the assembly axis
    p.group.position.copy(p.base).addScaledVector(p.axis, t * p.travel);
    // assembly mode: the current step's parts pulse
    if (p.current && p.glowMesh) p.glowMesh.material.opacity = 0.10 + 0.10 * Math.sin(time * 5);
    else if (p.glowMesh) p.glowMesh.material.opacity = 0.07;
  }
  // wiring fades out as the build comes apart (runs are routed assembled)
  if (wiring.visible) for (const m of wiring.children) m.material.opacity = 0.85 * Math.max(0, 1 - t * 2.2);
  rig.rotation.y += dt * 0.1 * (mode === "assembly" ? 0 : 1 - t * 0.6);
  wiring.rotation.y = rig.rotation.y;

  // dais scan rings breathe; the build scan-plane sweeps up through the model
  dais.rotation.y -= dt * 0.08;
  for (let r = 0; r < ringMats.length; r++) {
    ringMats[r].material.opacity = (0.22 - r * 0.035) * (0.6 + 0.4 * Math.sin(time * 1.4 - r * 0.8));
  }
  scanPlane.position.y = ((time * 0.7) % 5);
  scanPlane.material.opacity = 0.16 * (0.4 + 0.6 * Math.abs(Math.sin(time * 0.7 * Math.PI)));
  underGlow.intensity = 20 + 8 * Math.sin(time * 1.6);
  // motes drift slowly upward, wrapping
  const mp = moteGeo.attributes.position.array;
  for (let i = 1; i < mp.length; i += 3) { mp[i] += dt * 0.18; if (mp[i] > 11) mp[i] = 0; }
  moteGeo.attributes.position.needsUpdate = true;
  motes.rotation.y += dt * 0.01;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([rig, wiring], true);
  let label = "", note = "";
  if (hits.length > 0) {
    let node = hits[0].object;
    while (node && !node.name && node.parent) node = node.parent;
    label = (node && node.name) || "";
    const entry = parts.find((p) => p.group === node);
    if (entry && entry.spec.note) note = entry.spec.note;
    if (entry && entry.spec.printable) note = (note ? note + " " : "") + "[3D-PRINTABLE — STL in BOM]";
  }
  partLabel.textContent = label ? "> " + label : "\\u00a0";
  noteLabel.textContent = note || "\\u00a0";

  controls.update();
  renderer.render(scene, camera);
});
</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Built-in specs ────────────────────────────────────────────────────────

/** The showpiece mech — now data like everything else. */
export const MECH_SPEC: HoloSpec = {
  title: "ARES // HOLOTABLE — MK I",
  parts: [
    { id: "core", name: "REACTOR CORE", kind: "icosa", size: [0.42], position: [0, 2.55, 0.1], axis: [0, 0, 1], travel: 1.4, printable: false, vendor: "fusion not included", note: "Power bus root — everything wires back here." },
    { id: "torso", name: "TORSO FRAME", kind: "box", size: [1.7, 1.6, 1.0], position: [0, 2.6, 0], axis: [0, 0, -1], travel: 1.2, printable: true },
    { id: "pelvis", name: "PELVIC MOUNT", kind: "cylinder", size: [0.55, 0.7, 0.55], position: [0, 1.55, 0], axis: [0, -1, 0.2], travel: 1.0, printable: true },
    { id: "helm", name: "HELM SENSOR ARRAY", kind: "sphere", size: [0.42], position: [0, 3.75, 0.05], axis: [0, 1, 0], travel: 1.3, printable: true },
    { id: "lshoulder", name: "L SHOULDER ACTUATOR", kind: "sphere", size: [0.34], position: [-1.18, 3.18, 0], axis: [-1, 0.4, 0], travel: 1.5 },
    { id: "rshoulder", name: "R SHOULDER ACTUATOR", kind: "sphere", size: [0.34], position: [1.18, 3.18, 0], axis: [1, 0.4, 0], travel: 1.5 },
    { id: "larm", name: "L ARM SERVO CHAIN", kind: "cylinder", size: [0.18, 0.24, 1.5], position: [-1.32, 2.2, 0], axis: [-1, -0.2, 0], travel: 1.9 },
    { id: "rarm", name: "R ARM SERVO CHAIN", kind: "cylinder", size: [0.18, 0.24, 1.5], position: [1.32, 2.2, 0], axis: [1, -0.2, 0], travel: 1.9 },
    { id: "lhand", name: "L GAUNTLET", kind: "box", size: [0.4, 0.45, 0.45], position: [-1.36, 1.2, 0.05], axis: [-1, -0.6, 0.3], travel: 2.3, printable: true },
    { id: "rhand", name: "R GAUNTLET", kind: "box", size: [0.4, 0.45, 0.45], position: [1.36, 1.2, 0.05], axis: [1, -0.6, 0.3], travel: 2.3, printable: true },
    { id: "lfemur", name: "L FEMUR STRUT", kind: "cylinder", size: [0.22, 0.26, 1.3], position: [-0.45, 0.85, 0], axis: [-0.5, -1, 0], travel: 1.6 },
    { id: "rfemur", name: "R FEMUR STRUT", kind: "cylinder", size: [0.22, 0.26, 1.3], position: [0.45, 0.85, 0], axis: [0.5, -1, 0], travel: 1.6 },
    { id: "lfoot", name: "L FOOT PLATE", kind: "box", size: [0.5, 0.3, 0.85], position: [-0.45, 0.16, 0.12], axis: [-0.3, -1, 0.4], travel: 2.1, printable: true },
    { id: "rfoot", name: "R FOOT PLATE", kind: "box", size: [0.5, 0.3, 0.85], position: [0.45, 0.16, 0.12], axis: [0.3, -1, 0.4], travel: 2.1, printable: true },
  ],
  wires: [
    { name: "core → helm sensor bus", from: "core", to: "helm", via: [[0.3, 3.2, 0.3]], color: "#7fa6a3" },
    { name: "core → L arm power", from: "core", to: "larm", via: [[-0.9, 2.9, 0.4]], color: "#b03a3a" },
    { name: "core → R arm power", from: "core", to: "rarm", via: [[0.9, 2.9, 0.4]], color: "#b03a3a" },
    { name: "core → leg drive trunk", from: "core", to: "pelvis", color: "#e3b86a" },
  ],
  steps: [
    { title: "Pelvis and legs", instruction: "Mount the femur struts into the pelvic mount, then bolt the foot plates on. This is the stance the whole frame loads onto.", parts: ["pelvis", "lfemur", "rfemur", "lfoot", "rfoot"] },
    { title: "Torso frame", instruction: "Drop the torso frame onto the pelvic mount and torque the spine coupling.", parts: ["torso"] },
    { title: "Reactor core", instruction: "Seat the reactor core into the chest cavity. Route nothing yet — wiring comes after the limbs.", parts: ["core"] },
    { title: "Shoulders and arms", instruction: "Press the shoulder actuators into their sockets, then hang the arm servo chains and gauntlets.", parts: ["lshoulder", "rshoulder", "larm", "rarm", "lhand", "rhand"] },
    { title: "Helm", instruction: "Crown it. The sensor array clips onto the neck ring — mind the bus connector orientation.", parts: ["helm"] },
  ],
};

/** A real build: DIY 6-servo robot arm — print list, vendor list, wiring, steps. */
export const ROBOT_ARM_SPEC: HoloSpec = {
  title: "ARES // HOLOTABLE — DIY ROBOT ARM",
  parts: [
    { id: "base", name: "BASE PLATE", kind: "cylinder", size: [1.6, 1.8, 0.3], position: [0, 0.15, 0], axis: [0, -1, 0], travel: 1.2, printable: true, note: "Print at 40% infill minimum — the whole arm cantilevers off this." },
    { id: "bearing", name: "TURNTABLE BEARING", kind: "torus", size: [1.0, 0.12], position: [0, 0.42, 0], rotation: [1.5707963, 0, 0], axis: [0, -1, 0.4], travel: 1.4, vendor: "lazy susan bearing 120mm", note: "Takes the yaw load off the base servo spline." },
    { id: "baseservo", name: "BASE YAW SERVO", kind: "box", size: [0.55, 0.5, 0.5], position: [0, 0.75, 0], axis: [0, -1, -0.6], travel: 1.6, vendor: "MG996R metal-gear servo", qty: 1, note: "The hardest-working servo in the build. Metal gears are not optional." },
    { id: "shoulderbracket", name: "SHOULDER BRACKET", kind: "box", size: [0.7, 0.9, 0.5], position: [0, 1.35, 0], axis: [-0.6, 0.4, 0], travel: 1.5, printable: true },
    { id: "shoulderservo", name: "SHOULDER SERVO", kind: "box", size: [0.55, 0.5, 0.5], position: [0, 1.85, 0], axis: [0.8, 0.3, 0], travel: 1.6, vendor: "MG996R metal-gear servo", qty: 1 },
    { id: "upperarm", name: "UPPER ARM BEAM", kind: "box", size: [0.32, 1.5, 0.32], position: [0, 2.7, 0], axis: [0, 1, -0.5], travel: 1.6, printable: true, note: "Hollow print with 3 perimeters — stiffness over weight." },
    { id: "elbowservo", name: "ELBOW SERVO", kind: "box", size: [0.5, 0.45, 0.45], position: [0, 3.5, 0], axis: [-0.8, 0.4, 0], travel: 1.7, vendor: "MG90S micro servo", qty: 1 },
    { id: "forearm", name: "FOREARM BEAM", kind: "box", size: [0.26, 1.2, 0.26], position: [0, 4.25, 0.25], rotation: [0.5, 0, 0], axis: [0, 1, 0.6], travel: 1.7, printable: true },
    { id: "wristservo", name: "WRIST SERVO", kind: "box", size: [0.4, 0.35, 0.35], position: [0, 4.85, 0.6], axis: [0.8, 0.5, 0], travel: 1.8, vendor: "MG90S micro servo", qty: 1 },
    { id: "gripperbase", name: "GRIPPER CHASSIS", kind: "box", size: [0.5, 0.3, 0.4], position: [0, 5.2, 0.85], axis: [0, 1, 0.8], travel: 1.9, printable: true },
    { id: "gripperjawl", name: "GRIPPER JAW L", kind: "box", size: [0.1, 0.45, 0.3], position: [-0.18, 5.55, 1.0], axis: [-1, 0.6, 0.4], travel: 2.1, printable: true, qty: 1 },
    { id: "gripperjawr", name: "GRIPPER JAW R", kind: "box", size: [0.1, 0.45, 0.3], position: [0.18, 5.55, 1.0], axis: [1, 0.6, 0.4], travel: 2.1, printable: true, qty: 1 },
    { id: "controller", name: "SERVO CONTROLLER (PCA9685)", kind: "box", size: [0.9, 0.15, 0.6], position: [2.2, 0.2, 0], axis: [1, 0, 0.3], travel: 1.4, vendor: "PCA9685 16-ch PWM board", note: "Drives all 5 servos from 2 I2C pins. Your brain board (Pi/Jetson for Cosmos) talks to this." },
    { id: "brain", name: "BRAIN BOARD", kind: "box", size: [1.0, 0.18, 0.7], position: [2.2, 0.2, 1.1], axis: [1, 0, 0.8], travel: 1.5, vendor: "Raspberry Pi 5 / Jetson Orin Nano (for vision models)", note: "This is where your robotics model lives. Camera plugs here too." },
    { id: "psu", name: "5V 10A PSU", kind: "box", size: [1.1, 0.5, 0.7], position: [2.2, 0.45, -1.1], axis: [1, 0, -0.8], travel: 1.5, vendor: "5V 10A switching supply", note: "Servos NEVER share the brain's power rail. Common ground only." },
  ],
  wires: [
    { name: "PSU → controller V+ (heavy gauge)", from: "psu", to: "controller", color: "#b03a3a" },
    { name: "brain → controller I2C (SDA/SCL)", from: "brain", to: "controller", color: "#7fa6a3" },
    { name: "controller → base yaw servo (ch0)", from: "controller", to: "baseservo", via: [[1.2, 0.5, 0]], color: "#e3b86a" },
    { name: "controller → shoulder servo (ch1)", from: "controller", to: "shoulderservo", via: [[1.3, 1.3, 0]], color: "#e3b86a" },
    { name: "controller → elbow servo (ch2)", from: "controller", to: "elbowservo", via: [[1.4, 2.6, 0]], color: "#e3b86a" },
    { name: "controller → wrist servo (ch3)", from: "controller", to: "wristservo", via: [[1.5, 3.8, 0.4]], color: "#e3b86a" },
    { name: "controller → gripper servo (ch4)", from: "controller", to: "gripperbase", via: [[1.6, 4.4, 0.7]], color: "#e3b86a" },
  ],
  steps: [
    { title: "Print the structure", instruction: "Print: base plate (40% infill), shoulder bracket, upper arm beam, forearm beam, gripper chassis + both jaws. PETG over PLA if the arm will run for hours — servo heat creeps.", parts: ["base"] },
    { title: "Base and bearing", instruction: "Bolt the turntable bearing onto the base plate. The bearing carries the load so the yaw servo only has to steer.", parts: ["bearing"] },
    { title: "Yaw servo", instruction: "Mount the MG996R under the bearing, spline up, and center it (write the PWM center value down — you will need it in software).", parts: ["baseservo"] },
    { title: "Shoulder", instruction: "Bolt the shoulder bracket to the bearing top plate, then seat the shoulder servo into the bracket.", parts: ["shoulderbracket", "shoulderservo"] },
    { title: "Arm beams", instruction: "Attach the upper arm beam to the shoulder horn, mount the elbow servo at its top, then hang the forearm beam off the elbow horn.", parts: ["upperarm", "elbowservo", "forearm"] },
    { title: "Wrist and gripper", instruction: "Wrist servo into the forearm end, gripper chassis on the wrist horn, jaws onto the gripper gears. Check jaw mesh by hand before powering.", parts: ["wristservo", "gripperbase", "gripperjawl", "gripperjawr"] },
    { title: "Electronics bench", instruction: "Place the PCA9685, brain board, and PSU off-arm. Toggle WIRING to see every run: heavy red is servo power, teal is I2C, bronze is per-channel signal.", parts: ["controller", "brain", "psu"] },
    { title: "Wire and first light", instruction: "Wire per the overlay (servos to ch0–ch4, COMMON GROUND between PSU and brain). First test: center all channels at 1500µs, THEN attach horns. Your vision/robotics model drives the brain board from here.", parts: [] },
  ],
};
