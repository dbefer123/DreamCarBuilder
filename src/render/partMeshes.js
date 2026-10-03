// Procedural meshes for car parts. All geometry is built around simple local frames:
//   wheel: axle along +X (outward), centre at origin
//   shock / rod / frame: along +Y from 0 to 1 (scaled to length)
//   engine: crank axis along +X (front), up +Y
//   jet: thrust along +X, nozzle at origin
//   seat + figure: facing +X, seat base at origin
// Models with several materials are lists of [geometry, material key] (see carMaterials).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function keep(g, attrs = ['position', 'normal']) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!attrs.includes(k)) n.deleteAttribute(k);
  return n;
}

const merge = (list, attrs) => mergeGeometries(list.map((g) => keep(g, attrs)));

// ---------------- small builders ----------------
function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function rbox(w, h, d, r, x = 0, y = 0, z = 0, rotZ = 0) {
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return g;
}

/** Cylinder along X; r1 at the +X end, r2 at the -X end. */
function cylX(r1, r2, len, x = 0, y = 0, z = 0, seg = 18) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg);
  g.rotateZ(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Cylinder (or capsule) between two points. */
function between(a, b, r, capsule = false, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const L = d.length();
  const g = capsule ? new THREE.CapsuleGeometry(r, Math.max(0.001, L - 2 * r), 4, seg) : new THREE.CylinderGeometry(r, r, L, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

/** Bent tube through points. */
function bend(points, r, seg = 12) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, r, 7, false);
}

/** Group lists by material key and merge them: [[geometry, key], ...]. */
function pack(groups) {
  return Object.entries(groups).filter(([, l]) => l.length).map(([key, l]) => [merge(l), key]);
}

// ---------------- wheels ----------------
/**
 * Tire around the axle (+X). Types: road (tread normal map), slick (smooth, square
 * shoulders), offroad (deep knobs), rally (small dense blocks). R is the outer radius.
 */
export function tireGeometry(R, W, type = 'road') {
  const knob = type === 'offroad' ? 0.075 * R : type === 'rally' ? 0.035 * R : 0;
  const Rc = R - knob; // carcass radius under the knobs
  const rimR = Math.max(R * 0.55, R - Math.max(0.09, R * 0.33));
  const hw = W / 2;
  const sh = Math.min(hw * (type === 'slick' ? 0.25 : 0.45), (Rc - rimR) * 0.45);
  // profile (x = radius, y = axial): inner bead -> sidewall -> rounded shoulders -> outer bead
  const pts = [];
  pts.push(new THREE.Vector2(rimR, -hw * 0.9));
  pts.push(new THREE.Vector2(rimR + (Rc - rimR) * 0.55, -hw));
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Rc - sh + Math.cos(a) * sh, -hw + sh + Math.sin(a) * sh));
  }
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Rc - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh));
  }
  pts.push(new THREE.Vector2(rimR + (Rc - rimR) * 0.55, hw));
  pts.push(new THREE.Vector2(rimR, hw * 0.9));
  const g = new THREE.LatheGeometry(pts, 64);
  // lathe axis is +Y; rotate so the axle is +X
  g.rotateZ(-Math.PI / 2);
  // uv.y proportional to the profile: tread in 0.3..0.7, sidewalls outside
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = p.getX(i);
    const r = Math.hypot(p.getY(i), p.getZ(i));
    const side = (Rc - r) / Math.max(1e-3, Rc - rimR);
    let v = 0.5 + 0.2 * Math.max(-1, Math.min(1, ax / hw));
    if (side > 0.05) v = ax < 0 ? 0.3 - 0.3 * side : 0.7 + 0.3 * side;
    uv.setY(i, v);
  }
  if (!knob) return { geometry: g, rimR };
  // tread blocks around the circumference
  const parts = [g];
  const circ = 2 * Math.PI * Rc;
  const rows = type === 'offroad' ? Math.max(16, Math.round(circ / 0.11)) : Math.max(24, Math.round(circ / 0.06));
  const cols = type === 'offroad' ? [-0.28, 0.28] : [-0.33, 0, 0.33];
  const len = (circ / rows) * (type === 'offroad' ? 0.55 : 0.6);
  for (let i = 0; i < rows; i++) {
    const a = (i / rows) * Math.PI * 2;
    cols.forEach((c, k) => {
      // staggered columns
      const off = (k + i) % 2 ? 0.12 : -0.12;
      const b = new THREE.BoxGeometry(W * (type === 'offroad' ? 0.36 : 0.24), knob * 1.6, len);
      b.translate(W * (c + off * 0.3), Rc + knob * 0.3, 0);
      b.rotateX(a);
      parts.push(b);
    });
    if (type === 'offroad' && i % 2 === 0) {
      // shoulder lugs wrapping onto both sidewalls
      for (const s of [-1, 1]) {
        const lug = new THREE.BoxGeometry(knob * 1.4, knob * 2.2, len * 0.9);
        lug.translate(s * (hw - knob * 0.2), Rc - knob * 0.6, 0);
        lug.rotateX(a + Math.PI / rows);
        parts.push(lug);
      }
    }
  }
  return { geometry: merge(parts), rimR };
}

/**
 * Rim around the axle (+X outward). The barrel is a closed lathe profile (inner and outer
 * surfaces and both flanges), so the wheel isn't see-through from the car's side.
 * Styles: 0 twin 6-spoke, 1 five-spoke, 2 ten-spoke mesh, 3 steel dish with holes.
 * Returns { rim, dark } (dark = holes / centre details, may be null).
 */
export function rimGeometry(rimR, W, style = 0) {
  const parts = [], dark = [];
  const hw = W * 0.47;
  const t = Math.max(0.006, rimR * 0.035);
  // barrel cross-section (radius, axial), clockwise around the solid
  const prof = [
    [rimR * 1.05, -hw], [rimR * 1.05, -hw + t], [rimR * 0.99, -hw + 2 * t], [rimR * 0.97, -hw * 0.4],
    [rimR * 0.94, 0], [rimR * 0.97, hw * 0.4], [rimR * 0.99, hw - 2 * t], [rimR * 1.05, hw - t], [rimR * 1.05, hw],
    [rimR * 1.0, hw], [rimR * 0.94, hw - 2 * t], [rimR * 0.92, hw * 0.4], [rimR * 0.89, 0], [rimR * 0.92, -hw * 0.4],
    [rimR * 0.94, -hw + 2 * t], [rimR * 1.0, -hw], [rimR * 1.05, -hw],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const barrel = new THREE.LatheGeometry(prof, 48);
  barrel.rotateZ(-Math.PI / 2);
  parts.push(barrel);
  const face = hw * 0.55; // spokes sit toward the outer side
  const hub = cylX(rimR * 0.2, rimR * 0.26, W * 0.22, face, 0, 0, 20);
  parts.push(hub);
  const cap = new THREE.SphereGeometry(rimR * 0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.rotateZ(-Math.PI / 2);
  cap.translate(face + W * 0.11, 0, 0);
  parts.push(cap);
  const spoke = (a, w, depth, inner = 0.2, outer = 0.92) => {
    const len = rimR * (outer - inner);
    const s = new THREE.BoxGeometry(depth, len, w);
    s.translate(0, rimR * (inner + outer) / 2, 0);
    s.rotateX(a);
    s.translate(face - W * 0.03, 0, 0);
    return s;
  };
  const nuts = (n) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const nut = cylX(rimR * 0.025, rimR * 0.025, W * 0.06, face + W * 0.12, Math.cos(a) * rimR * 0.15, Math.sin(a) * rimR * 0.15, 6);
      dark.push(nut);
    }
  };
  if (style === 1) {
    // five wide spokes, tapered toward the barrel
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const s = new THREE.CylinderGeometry(rimR * 0.06, rimR * 0.13, rimR * 0.72, 4);
      s.rotateY(Math.PI / 4);
      s.scale(0.6, 1, 1);
      s.translate(0, rimR * 0.56, 0);
      s.rotateX(a);
      s.translate(face - W * 0.03, 0, 0);
      parts.push(s);
    }
    nuts(5);
  } else if (style === 2) {
    // ten thin spokes plus an outer ring
    for (let i = 0; i < 10; i++) parts.push(spoke((i / 10) * Math.PI * 2, rimR * 0.035, rimR * 0.05));
    const ring = new THREE.TorusGeometry(rimR * 0.86, rimR * 0.025, 6, 40);
    ring.rotateY(Math.PI / 2);
    ring.translate(face - W * 0.03, 0, 0);
    parts.push(ring);
    nuts(5);
  } else if (style === 3) {
    // pressed steel dish with round holes
    const dish = new THREE.LatheGeometry([
      [0.02, W * 0.06], [rimR * 0.3, W * 0.06], [rimR * 0.45, 0], [rimR * 0.8, -W * 0.04], [rimR * 0.92, -W * 0.02],
    ].map(([r, a]) => new THREE.Vector2(r, a)), 40);
    dish.rotateZ(-Math.PI / 2);
    dish.translate(face, 0, 0);
    parts.push(dish);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const hole = cylX(rimR * 0.08, rimR * 0.08, W * 0.02, face - W * 0.035, Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62, 14);
      dark.push(hole);
    }
    nuts(6);
  } else {
    // twin six-spoke
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2;
      for (const off of [-0.09, 0.09]) parts.push(spoke(a + off, rimR * 0.075, rimR * 0.06));
    }
    nuts(6);
  }
  return { rim: merge(parts), dark: dark.length ? merge(dark) : null };
}

export function brakeGeometry(rimR, W) {
  const disc = cylX(rimR * 0.78, rimR * 0.78, Math.max(0.018, W * 0.08), W * 0.02, 0, 0, 32);
  const caliper = new THREE.BoxGeometry(W * 0.22, rimR * 0.42, rimR * 0.2);
  caliper.translate(W * 0.02, rimR * 0.62, -rimR * 0.25);
  return { disc: merge([disc]), caliper: merge([caliper]) };
}

// ---------------- shocks ----------------
export function shockGeometries() {
  const turns = 9;
  const pts = [];
  for (let i = 0; i <= turns * 24; i++) {
    const t = i / (turns * 24);
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 0.05, 0.12 + t * 0.76, Math.sin(a) * 0.05));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const coil = new THREE.TubeGeometry(curve, turns * 24, 0.0085, 6, false);
  const seatA = new THREE.CylinderGeometry(0.065, 0.065, 0.012, 20);
  seatA.translate(0, 0.115, 0);
  const seatB = seatA.clone();
  seatB.translate(0, 0.77, 0);
  const body = new THREE.CylinderGeometry(0.03, 0.03, 0.56, 16);
  body.translate(0, 0.28, 0);
  const rod = new THREE.CylinderGeometry(0.012, 0.012, 0.6, 10);
  rod.translate(0, 0.7, 0);
  const eye1 = new THREE.TorusGeometry(0.022, 0.009, 6, 12);
  const eye2 = eye1.clone();
  eye2.translate(0, 1, 0);
  return {
    coil: merge([coil, seatA, seatB]),
    body: merge([body, eye1]),
    rod: merge([rod, eye2]),
  };
}

// ---------------- engines (look changes with the upgrade level) ----------------
/** Engine model by level: L1-8 inline-4, L9-17 V8, L18-25 supercharged big-block V8. */
export function engineTier(level) {
  return level <= 8 ? 'i4' : level <= 17 ? 'v8' : 'blown';
}

const ENGINE_CACHE = new Map();
export function engineModel(tier) {
  if (!ENGINE_CACHE.has(tier)) ENGINE_CACHE.set(tier, tier === 'i4' ? inline4() : vEight(tier === 'blown'));
  return ENGINE_CACHE.get(tier);
}

function inline4() {
  const g = { engineBlock: [], engineHeads: [], darkMetal: [], pipes: [], polished: [] };
  const L = 0.5;
  const xs = [0, 1, 2, 3].map((i) => -L * 0.33 + i * L * 0.22);
  g.engineBlock.push(rbox(L, 0.26, 0.22, 0.015, 0, 0.1, 0)); // block
  g.engineBlock.push(rbox(L * 0.86, 0.09, 0.2, 0.02, 0, -0.07, 0)); // oil pan
  g.engineBlock.push(box(L * 0.96, 0.07, 0.21, 0, 0.265, 0)); // head
  g.engineHeads.push(rbox(L * 0.9, 0.06, 0.17, 0.025, 0, 0.33, 0)); // cam cover
  for (const x of xs) g.engineHeads.push(box(0.02, 0.012, 0.13, x + 0.05, 0.365, 0)); // cover ribs
  for (const x of xs) g.darkMetal.push(between([x, 0.36, 0.05], [x, 0.38, 0.1], 0.008)); // plug leads
  // intake: runners from the head to a plenum on the left (-Z) with a cone filter
  for (const x of xs) g.polished.push(bend([[x, 0.27, -0.1], [x, 0.32, -0.15], [x, 0.31, -0.21]], 0.02));
  g.darkMetal.push(rbox(L * 0.82, 0.1, 0.08, 0.02, 0, 0.31, -0.24));
  g.darkMetal.push(cylX(0.065, 0.05, 0.14, L * 0.48, 0.31, -0.24));
  // exhaust: 4-into-1 on the right (+Z)
  for (const x of xs) g.pipes.push(bend([[x, 0.24, 0.1], [x, 0.21, 0.18], [x * 0.6 - 0.04, 0.06, 0.2], [-L * 0.32, -0.01, 0.19]], 0.018));
  g.pipes.push(cylX(0.032, 0.032, 0.28, -L * 0.5, -0.01, 0.19));
  // front: crank and cam pulleys with the belt, alternator
  g.darkMetal.push(cylX(0.065, 0.065, 0.03, L / 2 + 0.02, 0.05, 0));
  g.darkMetal.push(cylX(0.048, 0.048, 0.03, L / 2 + 0.02, 0.3, 0));
  for (const z of [0.05, -0.05]) g.darkMetal.push(box(0.014, 0.26, 0.018, L / 2 + 0.035, 0.175, z));
  g.darkMetal.push(cylX(0.05, 0.05, 0.1, L * 0.36, 0.13, 0.155));
  // bell housing toward the back
  g.engineBlock.push(cylX(0.11, 0.145, 0.13, -L / 2 - 0.065, 0.08, 0));
  return pack(g);
}

function vEight(blown) {
  const g = { engineBlock: [], engineHeads: [], darkMetal: [], pipes: [], polished: [] };
  const L = 0.62;
  g.engineBlock.push(rbox(L, 0.32, 0.36, 0.02, 0, 0.12, 0));
  g.engineBlock.push(rbox(L * 0.9, 0.12, 0.3, 0.03, 0, -0.08, 0));
  const covers = blown ? g.polished : g.engineHeads;
  for (const s of [1, -1]) {
    // cylinder banks at 45 degrees with valve covers
    const bank = new THREE.BoxGeometry(L * 0.96, 0.18, 0.2);
    bank.rotateX(-s * Math.PI / 4);
    bank.translate(0, 0.33, s * 0.17);
    g.engineBlock.push(bank);
    const vc = new RoundedBoxGeometry(L * 0.92, 0.07, 0.17, 3, 0.025);
    vc.rotateX(-s * Math.PI / 4);
    vc.translate(0, 0.42, s * 0.26);
    covers.push(vc);
    if (!blown) {
      // tube headers: 4 primaries per side into a collector
      for (let i = 0; i < 4; i++) {
        const x = -L * 0.36 + i * L * 0.24;
        g.pipes.push(bend([[x, 0.24, s * 0.3], [x, 0.18, s * 0.4], [x * 0.5 - 0.06, 0.04, s * 0.41], [-L * 0.36, 0.0, s * 0.39]], 0.019));
      }
      g.pipes.push(cylX(0.035, 0.035, 0.3, -L * 0.55, 0.0, s * 0.39));
    } else {
      // zoomie headers: individual chrome pipes swept up and back
      for (let i = 0; i < 4; i++) {
        const x = -L * 0.36 + i * L * 0.24;
        g.polished.push(bend([[x, 0.25, s * 0.3], [x - 0.02, 0.3, s * 0.42], [x - 0.1, 0.42, s * 0.5]], 0.024, 8));
      }
    }
  }
  // intake manifold
  g.engineBlock.push(box(L * 0.78, 0.07, 0.2, 0, 0.47, 0));
  if (!blown) {
    // 4-barrel carburettor under a round chrome air cleaner
    g.darkMetal.push(box(0.14, 0.08, 0.14, 0, 0.53, 0));
    g.polished.push(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 32).translate(0, 0.6, 0));
    g.darkMetal.push(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8).translate(0, 0.645, 0));
  } else {
    // roots supercharger, injector hat with butterflies, belt drive at the front
    g.darkMetal.push(rbox(0.46, 0.17, 0.22, 0.03, 0, 0.6, 0));
    for (let i = 0; i < 7; i++) g.polished.push(box(0.012, 0.15, 0.23, -0.2 + i * 0.066, 0.6, 0));
    g.polished.push(rbox(0.3, 0.12, 0.22, 0.02, 0.02, 0.74, 0));
    for (let i = 0; i < 3; i++) g.darkMetal.push(box(0.06, 0.012, 0.16, -0.08 + i * 0.09, 0.805, 0));
    g.darkMetal.push(cylX(0.075, 0.075, 0.04, L / 2 + 0.06, 0.6, 0));
    for (const z of [0.07, -0.07]) g.darkMetal.push(box(0.016, 0.5, 0.02, L / 2 + 0.06, 0.36, z));
  }
  // pulleys at the front
  for (const [y, z, r] of [[0.12, 0, 0.09], [0.32, 0.12, 0.05], [0.32, -0.12, 0.05], [0.0, 0.14, 0.045]]) g.darkMetal.push(cylX(r, r, 0.04, L / 2 + 0.03, y, z));
  // bell housing to the back
  g.engineBlock.push(cylX(0.16, blown ? 0.24 : 0.2, 0.22, -L / 2 - 0.1, 0.1, 0));
  return pack(g);
}

// ---------------- jet ----------------
let JET_CACHE = null;
/** Turbojet: { parts: [[geometry, key], ...], flame: geometry }. Nozzle at the origin, intake toward +X. */
export function jetModel() {
  if (JET_CACHE) return JET_CACHE;
  const g = { jet: [], jetDark: [], polished: [] };
  // casing: closed lathe profile (outer skin, intake lip, inner duct)
  const prof = [
    [0.10, 0], [0.125, 0.1], [0.15, 0.16], [0.155, 0.55], [0.165, 0.76], [0.162, 0.84], [0.15, 0.865], [0.137, 0.85],
    [0.135, 0.6], [0.12, 0.2], [0.088, 0.03], [0.10, 0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const casing = new THREE.LatheGeometry(prof, 40);
  casing.rotateZ(-Math.PI / 2);
  g.jet.push(casing);
  // panel line rings
  for (const x of [0.26, 0.41, 0.56]) {
    const t = new THREE.TorusGeometry(0.1565, 0.005, 6, 40);
    t.rotateY(Math.PI / 2);
    t.translate(x, 0, 0);
    g.jetDark.push(t);
  }
  // fan: spinner, hub and twisted blades
  const spinner = new THREE.ConeGeometry(0.05, 0.11, 18);
  spinner.rotateZ(-Math.PI / 2);
  spinner.translate(0.77, 0, 0);
  g.polished.push(spinner);
  g.jetDark.push(cylX(0.06, 0.06, 0.03, 0.71, 0, 0));
  for (let i = 0; i < 16; i++) {
    const b = new THREE.BoxGeometry(0.035, 0.085, 0.006);
    b.rotateY(0.6);
    b.translate(0, 0.095, 0);
    b.rotateX((i / 16) * Math.PI * 2);
    b.translate(0.71, 0, 0);
    g.polished.push(b);
  }
  // turbine face deep inside and the exhaust cone
  g.jetDark.push(cylX(0.115, 0.115, 0.01, 0.2, 0, 0, 24));
  const cone = new THREE.ConeGeometry(0.05, 0.12, 16);
  cone.rotateZ(Math.PI / 2);
  cone.translate(0.1, 0, 0);
  g.jetDark.push(cone);
  // nozzle petals
  for (let i = 0; i < 16; i++) {
    const p = new THREE.BoxGeometry(0.12, 0.006, 0.042);
    p.rotateZ(0.22);
    p.translate(0.055, 0.115, 0);
    p.rotateX((i / 16) * Math.PI * 2);
    g.jetDark.push(p);
  }
  // mounting pylon on top
  g.jetDark.push(rbox(0.34, 0.08, 0.035, 0.012, 0.42, 0.19, 0));
  // flame: outer cone, bright core and shock diamonds, built along +Y (wide end at the
  // nozzle, tips downstream) and turned to point toward -X
  const outer = new THREE.ConeGeometry(0.1, 1, 18, 1, true);
  outer.translate(0, 0.5, 0);
  const core = new THREE.ConeGeometry(0.055, 0.6, 14, 1, true);
  core.translate(0, 0.3, 0);
  const fl = [outer, core];
  for (const [y, r] of [[0.22, 0.05], [0.42, 0.04], [0.6, 0.03]]) {
    const dmd = new THREE.SphereGeometry(r, 10, 6);
    dmd.scale(1, 1.8, 1);
    dmd.translate(0, y, 0);
    fl.push(dmd);
  }
  const flame = merge(fl);
  flame.rotateZ(Math.PI / 2); // +Y -> -X
  JET_CACHE = { parts: pack(g), flame };
  return JET_CACHE;
}

// ---------------- seats and figures ----------------
const SEAT_CACHE = new Map();
/** Seat by type: sport (shell, bolsters, harness), classic (upholstered), bucket (deep shell). */
export function seatModel(type = 'sport') {
  if (SEAT_CACHE.has(type)) return SEAT_CACHE.get(type);
  const g = { seatShell: [], seat: [], seatLeather: [], harness: [], chrome: [] };
  if (type === 'classic') {
    g.seatLeather.push(rbox(0.46, 0.12, 0.48, 0.045, 0, 0.06, 0));
    g.seatLeather.push(rbox(0.12, 0.58, 0.48, 0.045, -0.26, 0.38, 0, 0.2));
    g.seatLeather.push(rbox(0.09, 0.15, 0.27, 0.035, -0.34, 0.82, 0));
    for (const z of [0.07, -0.07]) g.chrome.push(between([-0.33, 0.66, z], [-0.34, 0.76, z], 0.009));
    // stitched seams across the cushion
    for (const x of [-0.09, 0.07]) g.seat.push(box(0.012, 0.01, 0.42, x, 0.123, 0));
  } else if (type === 'bucket') {
    g.seatShell.push(box(0.44, 0.03, 0.44, 0, 0.015, 0));
    const back = box(0.03, 0.74, 0.44);
    back.rotateZ(0.18);
    back.translate(-0.25, 0.37, 0);
    g.seatShell.push(back);
    for (const z of [0.235, -0.235]) {
      g.seatShell.push(box(0.5, 0.3, 0.025, -0.03, 0.16, z));
      const wing = box(0.13, 0.46, 0.025);
      wing.rotateZ(0.18);
      wing.translate(-0.25, 0.5, z);
      g.seatShell.push(wing);
      const head = box(0.12, 0.2, 0.025);
      head.translate(-0.31, 0.78, z * 0.55);
      g.seatShell.push(head);
    }
    g.seat.push(rbox(0.38, 0.03, 0.36, 0.012, 0.02, 0.045, 0));
    g.seat.push(rbox(0.03, 0.55, 0.34, 0.012, -0.22, 0.38, 0, 0.18));
  } else {
    g.seatShell.push(rbox(0.44, 0.07, 0.42, 0.03, 0, 0.035, 0));
    g.seatShell.push(rbox(0.08, 0.7, 0.44, 0.035, -0.26, 0.38, 0, 0.22));
    for (const z of [0.2, -0.2]) {
      g.seatShell.push(rbox(0.38, 0.11, 0.06, 0.025, 0.01, 0.1, z));
      g.seatShell.push(rbox(0.09, 0.52, 0.065, 0.025, -0.22, 0.38, z * 1.05, 0.22));
      g.seatShell.push(rbox(0.1, 0.2, 0.05, 0.02, -0.32, 0.76, z * 0.65));
    }
    g.seat.push(box(0.3, 0.015, 0.28, 0.02, 0.075, 0));
    const insert = box(0.015, 0.46, 0.28);
    insert.rotateZ(0.22);
    insert.translate(-0.21, 0.38, 0);
    g.seat.push(insert);
    // 5-point harness
    for (const z of [0.08, -0.08]) g.harness.push(between([-0.27, 0.7, z], [0.06, 0.2, z * 0.6], 0.012, false, 4));
    g.harness.push(box(0.035, 0.03, 0.4, 0.06, 0.15, 0));
    g.harness.push(box(0.04, 0.12, 0.04, 0.1, 0.1, 0));
    g.chrome.push(box(0.05, 0.05, 0.02, 0.07, 0.17, 0));
  }
  const out = pack(g);
  SEAT_CACHE.set(type, out);
  return out;
}

const FIGURE_CACHE = new Map();
/** Seated figure: the driver holds the steering wheel; a passenger rests the hands on the lap. */
export function figureModel(role = 'driver') {
  if (FIGURE_CACHE.has(role)) return FIGURE_CACHE.get(role);
  const passenger = role === 'passenger';
  const suitKey = passenger ? 'suitPassenger' : 'suit';
  const g = { [suitKey]: [], helmet: [], visor: [], darkMetal: [] };
  const suit = g[suitKey];
  // torso leaning back
  const torso = new THREE.CapsuleGeometry(0.15, 0.32, 4, 12);
  torso.rotateZ(0.28);
  torso.translate(-0.12, 0.42, 0);
  suit.push(torso);
  for (const z of [0.1, -0.1]) {
    suit.push(between([-0.05, 0.15, z], [0.35, 0.16, z], 0.07, true)); // thigh
    suit.push(between([0.35, 0.16, z], [0.55, -0.12, z], 0.06, true)); // shin
    if (passenger) {
      suit.push(between([-0.12, 0.6, z * 1.9], [0.0, 0.34, z * 2.0], 0.05, true)); // upper arm down
      suit.push(between([0.0, 0.34, z * 2.0], [0.24, 0.24, z * 1.3], 0.045, true)); // forearm on the lap
    } else {
      suit.push(between([-0.12, 0.6, z * 2], [0.06, 0.48, z * 2.1], 0.05, true)); // upper arm
      suit.push(between([0.06, 0.48, z * 2.1], [0.3, 0.56, z * 1.3], 0.045, true)); // forearm to the wheel
    }
  }
  const head = new THREE.SphereGeometry(0.135, 20, 14);
  head.scale(1.05, 1, 0.95);
  head.translate(-0.02, 0.8, 0);
  g.helmet.push(head);
  const v = new THREE.SphereGeometry(0.138, 20, 10, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.38, Math.PI * 0.2);
  v.rotateY(-Math.PI / 2);
  v.scale(1.05, 1, 0.95);
  v.translate(-0.02, 0.8, 0);
  g.visor.push(v);
  if (!passenger) {
    const wheel = new THREE.TorusGeometry(0.15, 0.018, 8, 28);
    wheel.rotateY(Math.PI / 2);
    wheel.rotateZ(0.5);
    wheel.translate(0.33, 0.56, 0);
    g.darkMetal.push(wheel);
    g.darkMetal.push(between([0.33, 0.56, 0], [0.62, 0.38, 0], 0.02));
  }
  const out = pack(g);
  FIGURE_CACHE.set(role, out);
  return out;
}

export function weightGeometry() {
  return merge([rbox(0.3, 0.2, 0.3, 0.02)]);
}

// ---------------- materials ----------------
export function carMaterials(colors, mode = 'drive') {
  const editor = mode === 'editor';
  const m = {
    frame: new THREE.MeshStandardMaterial({ color: colors.frames, metalness: 0.55, roughness: 0.42 }),
    joint: new THREE.MeshStandardMaterial({ color: colors.frames, metalness: 0.55, roughness: 0.42 }),
    panel: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.15, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12, side: THREE.DoubleSide, envMapIntensity: 1.6 }),
    // tires and rims are double sided so the inside of the wheel isn't see-through
    tire: new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0, roughness: 0.88, side: THREE.DoubleSide }),
    tireSlick: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0, roughness: 0.55, side: THREE.DoubleSide }),
    tireKnobby: new THREE.MeshStandardMaterial({ color: 0x161719, metalness: 0, roughness: 0.95, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ color: colors.rims, metalness: 0.9, roughness: 0.26, envMapIntensity: 2, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.85, roughness: 0.35 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xb8231f, metalness: 0.3, roughness: 0.45 }),
    coil: new THREE.MeshStandardMaterial({ color: 0xd8a21e, metalness: 0.5, roughness: 0.35 }),
    shockBody: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.35 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.14, envMapIntensity: 2.2 }),
    // polished aluminium: reads bright in the garage studio light and outdoors
    polished: new THREE.MeshStandardMaterial({ color: 0xc9ced5, metalness: 0.85, roughness: 0.26, envMapIntensity: 1.6 }),
    engineBlock: new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.7, roughness: 0.4 }),
    engineHeads: new THREE.MeshStandardMaterial({ color: 0xb0261f, metalness: 0.4, roughness: 0.3 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.5, roughness: 0.5 }),
    pipes: new THREE.MeshStandardMaterial({ color: 0x7a5a3e, metalness: 0.8, roughness: 0.35 }),
    suit: new THREE.MeshStandardMaterial({ color: 0xe9eaec, metalness: 0, roughness: 0.6 }),
    suitPassenger: new THREE.MeshStandardMaterial({ color: 0x3a6fd0, metalness: 0, roughness: 0.62 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xf2f3f5, metalness: 0, roughness: 0.25, clearcoat: 1 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x0d0f12, metalness: 0.6, roughness: 0.08 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1d1f23, metalness: 0.1, roughness: 0.7 }),
    seatShell: new THREE.MeshPhysicalMaterial({ color: 0x24282d, metalness: 0.3, roughness: 0.38, clearcoat: 0.8 }),
    seatLeather: new THREE.MeshStandardMaterial({ color: 0x7a4428, metalness: 0.05, roughness: 0.55 }),
    harness: new THREE.MeshStandardMaterial({ color: 0xc23a2a, metalness: 0, roughness: 0.7 }),
    rod: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.85, roughness: 0.3 }),
    limiter: new THREE.MeshStandardMaterial({ color: 0xe0b020, metalness: 0.2, roughness: 0.6 }),
    jet: new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }),
    jetDark: new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.8, roughness: 0.45 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    weight: new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.5, roughness: 0.5 }),
    // panel surface materials (Panel > Material)
    panelMatte: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.86, side: THREE.DoubleSide }),
    panelMetallic: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.85, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.18, side: THREE.DoubleSide, envMapIntensity: 1.8 }),
    panelCarbon: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.35, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    panelGlass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2 }),
    panelChrome: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1, roughness: 0.07, side: THREE.DoubleSide, envMapIntensity: 2.4 }),
    lock: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.45 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  };
  m.flame.color.setScalar(1).multiply(new THREE.Color(14, 5, 1.2));
  if (editor) {
    m.frame.transparent = false;
  }
  return m;
}
