// Procedural preset cars: triangulated space-frame chassis, double-wishbone corners,
// coil-over shocks tuned from the car's own mass, steering rods on the front corners.
import { createDesign, addNode, addPart, findPart, nodeMasses, nodeMap, normalizeDesign, linkEngines } from './design.js';

class Builder {
  constructor(name) {
    this.d = createDesign(name);
    this.byKey = new Map();
  }

  node(x, y, z) {
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let id = this.byKey.get(k);
    if (id === undefined) {
      id = addNode(this.d, x, y, z).id;
      this.byKey.set(k, id);
    }
    return id;
  }

  part(type, ids, props = {}) {
    if (new Set(ids).size !== ids.length) return null;
    if (findPart(this.d, type, ids)) return null;
    return addPart(this.d, type, ids, props);
  }

  frame(a, b, props) {
    return this.part('frame', [a, b], props);
  }

  light(id, type, extra = {}) {
    const n = this.d.nodes.find((q) => q.id === id);
    if (n) n.light = { type, vAngle: -4, hAngle: 0, intensity: type === 'headlight' ? 1 : 0.6, length: type === 'headlight' ? 60 : 4, ...extra };
  }
}

const SIDES = [1, -1];

function buildCar(o) {
  const B = new Builder(o.name);
  const xf = o.wheelbase / 2;
  const xr = -o.wheelbase / 2;
  const F = o.front, R = o.rear;
  const kF = Math.min(2, Math.max(1, F.radius / 0.33));
  const kR = Math.min(2, Math.max(1, R.radius / 0.33));
  const zc = o.frameHalfWidth;
  // v1 equivalents: weightHardness = 10 (t/0.04)^2, elasticLimit = 25 x strength
  const strong = { weightHardness: 12.5, elasticLimit: 62 };
  const arm = { weightHardness: 7.5, elasticLimit: 50 };
  const upr = { weightHardness: 15.5, elasticLimit: 100 };

  // ---- stations (cross-sections of the chassis) ----
  const suspSt = (xa, w, k) => [
    { x: xa - 0.25 * k, yl: w.radius * 0.55, yu: w.radius * 1.45, z: zc, tag: 'susp' },
    { x: xa + 0.25 * k, yl: w.radius * 0.55, yu: w.radius * 1.45, z: zc, tag: 'susp' },
  ];
  const rearSt = suspSt(xr, R, kR);
  const frontSt = suspSt(xf, F, kF);
  const ylc = Math.min(rearSt[0].yl, frontSt[0].yl) + 0.02;
  const cockHalf = Math.max(zc, o.cockpitHalfWidth);
  const cockSt = [
    { x: o.cockpitX - o.cockpitLength / 2, yl: ylc, yu: ylc + 0.44, z: cockHalf, tag: 'cock0' },
    { x: o.cockpitX + o.cockpitLength / 2, yl: ylc, yu: ylc + 0.44, z: cockHalf, tag: 'cock1' },
  ];
  let st = [...rearSt, ...cockSt, ...frontSt].sort((a, b) => a.x - b.x);
  // fill long gaps
  const filled = [st[0]];
  for (let i = 1; i < st.length; i++) {
    const a = filled[filled.length - 1], b = st[i];
    const gap = b.x - a.x;
    const n = a.tag === 'cock0' ? 0 : Math.floor(gap / 0.85);
    for (let j = 1; j <= n; j++) {
      const t = j / (n + 1);
      filled.push({ x: a.x + gap * t, yl: a.yl + (b.yl - a.yl) * t, yu: a.yu + (b.yu - a.yu) * t, z: a.z + (b.z - a.z) * t, tag: 'fill' });
    }
    filled.push(b);
  }
  st = filled;
  for (const s of st) {
    s.L = { 1: B.node(s.x, s.yl, s.z), [-1]: B.node(s.x, s.yl, -s.z) };
    s.U = { 1: B.node(s.x, s.yu, s.z), [-1]: B.node(s.x, s.yu, -s.z) };
  }
  const ci0 = st.findIndex((s) => s.tag === 'cock0');
  const ci1 = st.findIndex((s) => s.tag === 'cock1');

  // rings
  for (const s of st) {
    B.frame(s.L[1], s.L[-1], strong);
    B.frame(s.U[1], s.U[-1], strong);
    for (const z of SIDES) B.frame(s.L[z], s.U[z], strong);
    B.frame(s.L[1], s.U[-1]);
    B.frame(s.L[-1], s.U[1]);
  }
  // cells
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i], b = st[i + 1];
    const open = i === ci0; // cockpit cell: open top
    for (const z of SIDES) {
      B.frame(a.L[z], b.L[z], strong);
      B.frame(a.U[z], b.U[z], strong);
      B.frame(a.L[z], b.U[z]);
    }
    B.frame(a.L[1], b.L[-1]);
    B.frame(a.L[-1], b.L[1]);
    if (!open) {
      B.frame(a.U[1], b.U[-1]);
      B.frame(a.U[-1], b.U[1]);
    }
  }

  // ---- roll cage ----
  if (o.cage) {
    const c0 = st[ci0], c1 = st[ci1];
    const H1 = {}, H2 = {};
    for (const z of SIDES) {
      H1[z] = B.node(c0.x + 0.1, ylc + 0.97, z * (cockHalf - 0.12));
      H2[z] = B.node(c1.x - 0.25, ylc + 0.86, z * (cockHalf - 0.1));
    }
    for (const z of SIDES) {
      B.frame(H1[z], c0.U[z], strong);
      B.frame(H1[z], st[ci0 - 1].U[z]);
      B.frame(H1[z], c0.U[-z]);
      B.frame(H2[z], c1.U[z], strong);
      B.frame(H2[z], st[ci1 + 1].U[z]);
      B.frame(H2[z], H1[z], strong);
      B.frame(H2[z], H1[-z]);
    }
    B.frame(H1[1], H1[-1], strong);
    B.frame(H2[1], H2[-1], strong);
  }

  // ---- node attachment helper: rigidly attach a point inside the chassis ----
  const attach = (id, x) => {
    let i = 0;
    while (i < st.length - 2 && st[i + 1].x < x) i++;
    const a = st[i], b = st[i + 1];
    const near = Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b;
    const far = near === a ? b : a;
    for (const z of SIDES) {
      B.frame(id, near.L[z]);
      B.frame(id, near.U[z]);
      B.frame(id, far.L[z]);
    }
  };

  // seat
  const c0 = st[ci0], c1 = st[ci1];
  const seatId = B.node(o.cockpitX - 0.1, ylc + 0.03, 0);
  for (const z of SIDES) {
    B.frame(seatId, c0.L[z]);
    B.frame(seatId, c1.L[z]);
    B.frame(seatId, c0.U[z]);
  }
  B.part('seat', [seatId]);

  // engine
  const eY = o.engineY ?? (ylc + 0.16);
  const E1 = B.node(o.engineX + 0.2, eY, 0);
  const E2 = B.node(o.engineX - 0.2, eY, 0);
  attach(E1, o.engineX + 0.2);
  attach(E2, o.engineX - 0.2);
  B.frame(E1, E2, strong);
  B.part('engine', [E1, E2], { level: o.engineLevel, torqueLimit: 5000 });
  if (o.twinEngine) {
    // second engine block ahead of the first (dragster)
    const E0 = B.node(o.engineX + 0.6, eY, 0);
    attach(E0, o.engineX + 0.6);
    B.frame(E0, E1, strong);
    B.part('engine', [E0, E1], { level: o.engineLevel, torqueLimit: 5000 });
  }

  // nose and tail
  const first = st[0], last = st[st.length - 1];
  const nose = {}, tail = {};
  for (const z of SIDES) {
    nose[z] = B.node(last.x + o.noseLength, last.yl + 0.08, z * zc * 0.7);
    tail[z] = B.node(first.x - 0.3, first.yl + 0.12, z * zc * 0.8);
  }
  for (const z of SIDES) {
    B.frame(nose[z], last.L[z]);
    B.frame(nose[z], last.U[z]);
    B.frame(nose[z], last.L[-z]);
    B.frame(tail[z], first.L[z]);
    B.frame(tail[z], first.U[z]);
    B.frame(tail[z], first.L[-z]);
  }
  B.frame(nose[1], nose[-1]);
  B.frame(tail[1], tail[-1]);
  for (const z of SIDES) {
    B.light(nose[z], 'headlight');
    B.light(tail[z], 'brake');
  }

  // ---- suspension corners ----
  const shocks = [];
  const corner = (xa, w, k, s, isFront) => {
    const stA = st.find((q) => Math.abs(q.x - (xa - 0.25 * k)) < 1e-6);
    const stB = st.find((q) => Math.abs(q.x - (xa + 0.25 * k)) < 1e-6);
    const Rw = w.radius, th = w.track / 2;
    const inner = th - w.width / 2;
    const H = B.node(xa, Rw, s * th);
    const I = B.node(xa, Rw, s * (inner - 0.05));
    const UT = B.node(xa, Rw * 1.45, s * (inner - 0.03));
    const UB = B.node(xa, Rw * 0.55, s * (inner - 0.01));
    const S = B.node(xa - 0.16 * k, Rw, s * (inner - 0.05));
    const up = [H, I, UT, UB, S];
    for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) B.frame(up[i], up[j], upr);
    B.frame(UT, stA.U[s], arm);
    B.frame(UT, stB.U[s], arm);
    B.frame(UB, stA.L[s], arm);
    B.frame(UB, stB.L[s], arm);
    const T = B.node(xa - 0.16 * k, Rw, s * zc);
    B.frame(T, stA.L[s]);
    B.frame(T, stA.U[s]);
    B.frame(T, stB.L[s]);
    B.frame(T, stA.L[-s]);
    if (isFront && o.steerTravel) {
      // steering right (steer > 0) shortens the right-hand rod and lengthens the left one
      const len = Math.hypot(0, 0, s * (inner - 0.05) - s * zc) || 0.1;
      const frac = Math.round((o.steerTravel / len) * 1000) / 1000;
      B.part('rod', [T, S], {
        mode: 'steering', maxCompression: frac, maxStretch: 1 + frac,
        keyStretch: s > 0 ? 'steerLeft' : 'steerRight', keyCompress: s > 0 ? 'steerRight' : 'steerLeft',
      });
    }
    else B.frame(T, S, arm);
    const TW = B.node(xa, Rw * 1.45 + 0.34 * k, s * (zc + 0.04));
    for (const z of SIDES) {
      B.frame(TW, stA.U[z]);
      B.frame(TW, stB.U[z]);
    }
    const shock = B.part('shock', [UB, TW], { maxCompression: Math.round((1 - (o.bumpStop ?? 0.62)) * 100) / 100, maxStretch: o.reboundStop ?? 1.12 });
    shocks.push({ shock, isFront });
    const wheel = B.part('wheel', [H, I], {
      radius: Rw,
      width: w.width,
      steer: isFront && !o.steerTravel ? 30 : 0,
      toe: isFront ? 0 : (o.rearToe ?? 0.3),
      brake: isFront ? 1.0 : 0.75,
      handbrakeKey: isFront ? 'none' : 'handbrake',
      grip: w.grip ?? 1.0,
      level: w.level ?? 13,
      tireType: w.tireType ?? 'road',
      pressure: w.pressure ?? 32,
    });
    if (w.driven) drivenWheels.push(wheel);
  };
  const drivenWheels = [];
  for (const s of SIDES) {
    corner(xf, F, kF, s, true);
    corner(xr, R, kR, s, false);
  }
  // ---- transmissions: a shaft from every engine to every driven wheel ----
  for (const wheel of drivenWheels) linkEngines(B.d, wheel, (ids, props) => B.part('transmission', ids, props));

  // ---- panels ----
  const body = {};
  const quad = (a, b, c, d, props = body) => {
    B.part('panel', [a, b, c], props);
    B.part('panel', [c, b, d], props);
  };
  quad(c0.L[1], c0.L[-1], c1.L[1], c1.L[-1]);
  for (let i = ci1 + 1; i < st.length - 1; i++) quad(st[i].U[1], st[i].U[-1], st[i + 1].U[1], st[i + 1].U[-1]);
  quad(last.U[1], last.U[-1], nose[1], nose[-1]);
  for (let i = 0; i < ci0 - 1; i++) quad(st[i].U[1], st[i].U[-1], st[i + 1].U[1], st[i + 1].U[-1]);

  // ---- rear wing ----
  if (o.wing) {
    // Pylon box above the rear rails (fully triangulated), wing tips braced from below.
    const r0 = st[0], r1 = st[1];
    const half = o.wing.halfSpan;
    const rise = Math.tan((o.wing.angle * Math.PI) / 180) * o.wing.chord;
    const yR = r0.yu + o.wing.height;
    const xR = r0.x - 0.1, xF = r0.x - 0.1 + o.wing.chord;
    const WR = {}, WF = {}, MR = {}, MF = {};
    for (const z of SIDES) {
      MR[z] = B.node(xR, yR, z * r0.z);
      MF[z] = B.node(xF, yR + rise, z * r0.z);
      WR[z] = B.node(xR, yR, z * half);
      WF[z] = B.node(xF, yR + rise, z * half);
    }
    for (const z of SIDES) {
      B.frame(MR[z], r0.U[z]);
      B.frame(MF[z], r0.U[z]);
      B.frame(MF[z], r1.U[z]);
      B.frame(MR[z], MF[z]);
      B.frame(MR[z], MF[-z]);
      B.frame(WR[z], MR[z]);
      B.frame(WR[z], MF[z]);
      B.frame(WR[z], r0.U[z]);
      B.frame(WF[z], MF[z]);
      B.frame(WF[z], WR[z]);
      B.frame(WF[z], r1.U[z]);
    }
    B.frame(MR[1], MR[-1]);
    B.frame(MF[1], MF[-1]);
    B.frame(MF[1], r1.U[-1]);
    B.frame(MR[1], r0.U[-1]);
    quad(WR[1], WR[-1], WF[1], WF[-1], { lift: o.wing.lift ?? -1.0, drag: o.wing.drag ?? 0.2, color: o.wing.color || '' });
  }

  // ---- tune shocks from the actual mass distribution ----
  const d = normalizeDesign(B.d);
  const masses = nodeMasses(d);
  const nm = nodeMap(d);
  let M = 0, mx = 0;
  for (const n of d.nodes) {
    const m = masses.get(n.id);
    M += m;
    mx += m * n.x;
  }
  const xcom = mx / M;
  const frontShare = Math.min(0.8, Math.max(0.2, (xcom - xr) / (xf - xr)));
  for (const { shock, isFront } of shocks) {
    const a = nm.get(shock.n[0]), b = nm.get(shock.n[1]);
    const L = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const mr = Math.abs(b.y - a.y) / L;
    const mc = (M * (isFront ? frontShare : 1 - frontShare)) / 2;
    const f = o.rideFreq ?? 1.8;
    const kw = mc * (2 * Math.PI * f) ** 2;
    const ks = kw / (mr * mr);
    shock.hardness = Math.round(ks / 100) * 100;
    // damping is in units of 100 N*s/m, pre-compression is the spring's free length / built length
    shock.damping = Math.round((2 * (o.damping ?? 0.45) * Math.sqrt(kw * mc)) / (mr * mr) / 10) / 10;
    const preload = (mc * 9.81) / mr / shock.hardness;
    shock.preCompression = Math.round(((L + preload) / L) * 1000) / 1000;
  }
  d.colors = { ...d.colors, ...(o.colors || {}) };
  return d;
}

export const PRESETS = {
  buggy: () => buildCar({
    name: 'Buggy',
    wheelbase: 2.6,
    frameHalfWidth: 0.32,
    cockpitX: 0,
    cockpitLength: 1.1,
    cockpitHalfWidth: 0.55,
    engineX: -0.7,
    noseLength: 0.4,
    engineLevel: 9,
    cage: true,
    steerTravel: 0.055,
    front: { radius: 0.33, width: 0.24, track: 1.6, driven: false },
    rear: { radius: 0.35, width: 0.36, track: 1.64, driven: true },
    wing: { halfSpan: 0.7, chord: 0.32, height: 0.42, angle: 12 },
    rideFreq: 1.8,
  }),
  dragster: () => buildCar({
    name: 'Dragster',
    wheelbase: 4.4,
    frameHalfWidth: 0.26,
    cockpitX: -1.15,
    cockpitLength: 1.0,
    cockpitHalfWidth: 0.42,
    engineX: 0.0,
    noseLength: 0.6,
    engineLevel: 20,
    twinEngine: true,
    cage: true,
    steerTravel: 0.04,
    front: { radius: 0.3, width: 0.13, track: 1.25, driven: false },
    rear: { radius: 0.48, width: 0.46, track: 1.55, driven: true, grip: 1.25, tireType: 'slick' },
    wing: { halfSpan: 0.8, chord: 0.45, height: 0.9, angle: 16 },
    rideFreq: 2.2,
    colors: { frames: '#b5a57c' },
  }),
  truck: () => buildCar({
    name: 'Monster truck',
    wheelbase: 3.0,
    frameHalfWidth: 0.42,
    cockpitX: 0,
    cockpitLength: 1.1,
    cockpitHalfWidth: 0.6,
    engineX: 0.75,
    noseLength: 0.35,
    engineLevel: 16,
    cage: true,
    steerTravel: 0.07,
    front: { radius: 0.8, width: 0.6, track: 2.5, driven: true, tireType: 'offroad', pressure: 20 },
    rear: { radius: 0.8, width: 0.6, track: 2.5, driven: true, tireType: 'offroad', pressure: 20 },
    bumpStop: 0.55,
    reboundStop: 1.25,
    rideFreq: 1.3,
    damping: 0.5,
  }),
};

export const PRESET_LIST = [
  { key: 'buggy', label: 'Buggy' },
  { key: 'dragster', label: 'Dragster' },
  { key: 'truck', label: 'Monster truck' },
];

export function defaultDesign() {
  return PRESETS.buggy();
}

/**
 * Single player starts with a short buggy at low part levels (engine 3, wheels 2, seat 1).
 * It stays within the 3 m a level-1 seat allows, so it races without a weight penalty.
 */
export function starterDesign() {
  const d = buildCar({
    name: 'Starter buggy',
    wheelbase: 1.95,
    frameHalfWidth: 0.3,
    cockpitX: 0.05,
    cockpitLength: 0.95,
    cockpitHalfWidth: 0.5,
    engineX: -0.55,
    noseLength: 0.12,
    engineLevel: 3,
    cage: true,
    steerTravel: 0.05,
    front: { radius: 0.31, width: 0.22, track: 1.45, driven: false },
    rear: { radius: 0.33, width: 0.3, track: 1.5, driven: true },
    rideFreq: 1.8,
  });
  for (const p of d.parts) {
    if (p.type === 'engine') p.level = 3;
    if (p.type === 'wheel') p.level = 2;
    if (p.type === 'seat') p.level = 1;
  }
  return d;
}
