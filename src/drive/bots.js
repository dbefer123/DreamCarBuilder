// Single player opponents: little blue cars driving a competition's route on a fixed schedule
// (kinematic, so you can drive through them). Bot i finishes at par × f_i, f from 0.8 (fastest)
// to 2.2 (slowest); beating a bot's time pays the coins floating above it, once per bot.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { racePath, pointOnPath, trackLength } from './race.js';
import { makeLabel } from '../render/labels.js';

export const BOT_COUNT = 8;
const F_FAST = 0.8, F_SLOW = 2.2; // target time = par × f
const V_FAST = 6, V_SLOW = 1.6; // coin value = finish prize × v
// speed profile shape (only relative speeds matter: each bot's profile is scaled to its time)
const V_CAP = 40, A_LAT = 5, ACC = 3, DEC = 6;
const LANES = [-3.4, 3.4, -6.4, 6.4]; // start grid: 2 rows of 4 beside and behind the player
const ROW_GAP = 6;
const SCALE = 0.82; // little cars

/** Par time of a track: its own `par`, or its length at 28 m/s. */
function par(track) {
  return track.par ?? trackLength(track) / 28;
}

/** Target times and coin values of a track's opponents, fastest (and richest) first. */
export function botLineup(track, n = BOT_COUNT) {
  const prize = track.sp?.prize ?? 0;
  const P = par(track);
  return Array.from({ length: n }, (_, i) => {
    const k = n > 1 ? i / (n - 1) : 0;
    return { time: P * F_FAST * Math.pow(F_SLOW / F_FAST, k), value: Math.round(prize * V_FAST * Math.pow(V_SLOW / V_FAST, k)) };
  });
}

/**
 * Where each bot is at a race time: a curvature-limited speed profile along the path,
 * stretched so bot i crosses the finish line exactly at its target time.
 */
export class BotSchedule {
  constructor(path, lineup) {
    this.path = path;
    this.lineup = lineup;
    const pts = path.pts;
    const n = pts.length;
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 4)], b = pts[i], c = pts[Math.min(n - 1, i + 4)];
      const h1 = Math.atan2(b.z - a.z, b.x - a.x), h2 = Math.atan2(c.z - b.z, c.x - b.x);
      let dh = h2 - h1;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      const ds = Math.max(1e-3, (c.u - a.u) / 2);
      const kappa = Math.abs(dh) / ds;
      v[i] = Math.min(V_CAP, Math.sqrt(A_LAT / Math.max(kappa, 1e-5)));
    }
    v[0] = Math.min(v[0], 3);
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * ACC * (pts[i].u - pts[i - 1].u)));
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * DEC * (pts[i + 1].u - pts[i].u)));
    // time to reach each point at the natural profile
    const t = new Float64Array(n);
    for (let i = 1; i < n; i++) t[i] = t[i - 1] + (pts[i].u - pts[i - 1].u) / Math.max(0.5, (v[i] + v[i - 1]) / 2);
    this.v = v;
    this.t = t;
    this.T0 = t[n - 1];
  }

  /** Distance a bot with target time `T` has covered at race time `time` (and its speed). */
  progress(T, time) {
    const pts = this.path.pts;
    const n = pts.length;
    const L = this.path.length;
    const scale = this.T0 / T; // natural seconds per race second
    const tn = time * scale;
    if (time <= 0) return { u: 0, speed: 0 };
    if (tn >= this.T0) {
      // past the finish: roll to a stop 20 m later
      const vEnd = this.v[n - 1] * scale;
      const extra = 20 * (1 - Math.exp((-(time - T) * Math.max(vEnd, 1)) / 20));
      return { u: L + extra, speed: vEnd * Math.exp((-(time - T) * Math.max(vEnd, 1)) / 20) };
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] < tn) lo = mid; else hi = mid;
    }
    const k = (tn - this.t[lo]) / Math.max(1e-9, this.t[hi] - this.t[lo]);
    return { u: pts[lo].u + (pts[hi].u - pts[lo].u) * k, speed: (this.v[lo] + (this.v[hi] - this.v[lo]) * k) * scale };
  }
}

// ---------------- the little blue car ----------------
let shared = null;
function botAssets() {
  if (shared) return shared;
  const paint = new THREE.MeshStandardMaterial({ color: 0x2a62d8, roughness: 0.32, metalness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18202a, roughness: 0.08, metalness: 0.6 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xc4c9cf, roughness: 0.3, metalness: 0.7 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
  const chassis = new RoundedBoxGeometry(2.3, 0.44, 1.34, 2, 0.14);
  chassis.translate(0, 0.5, 0);
  const cabin = new RoundedBoxGeometry(1.15, 0.34, 1.12, 2, 0.12);
  cabin.translate(-0.18, 0.86, 0);
  const roof = new RoundedBoxGeometry(1.0, 0.1, 1.02, 2, 0.05);
  roof.translate(-0.2, 1.05, 0);
  const wheel = new THREE.CylinderGeometry(0.3, 0.3, 0.26, 18);
  wheel.rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.17, 0.17, 0.28, 12);
  rim.rotateX(Math.PI / 2);
  const light = new THREE.BoxGeometry(0.04, 0.1, 0.28);
  shared = { paint, glass, tire, hub, lamp, chassis, cabin, roof, wheel, rim, light };
  return shared;
}

function botModel(A) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(A.chassis, A.paint);
  add(A.cabin, A.glass);
  add(A.roof, A.paint);
  for (const z of [-0.36, 0.36]) add(A.light, A.lamp, 1.15, 0.56, z).castShadow = false;
  const wheels = [];
  for (const x of [-0.78, 0.78]) {
    for (const z of [-0.62, 0.62]) {
      const w = new THREE.Group();
      w.position.set(x, 0.3, z);
      const t = new THREE.Mesh(A.wheel, A.tire);
      t.castShadow = true;
      w.add(t, new THREE.Mesh(A.rim, A.hub));
      g.add(w);
      wheels.push(w);
    }
  }
  return { group: g, wheels };
}

/** The opponents of one Single player race (visuals + schedule). */
export class Bots {
  /** opts: { defeated: [indices already beaten], register(mat) } */
  constructor(track, T, opts = {}) {
    this.track = track;
    this.T = T;
    this.lineup = botLineup(track);
    this.path = racePath(track);
    this.schedule = new BotSchedule(this.path, this.lineup);
    this.group = new THREE.Group();
    const A = botAssets();
    if (opts.register) for (const m of [A.paint, A.glass, A.tire, A.hub]) opts.register(m);
    const done = new Set(opts.defeated || []);
    this.bots = this.lineup.map((b, i) => {
      const m = botModel(A);
      const label = makeLabel({ text: String(b.value), coin: true, tick: done.has(i) });
      this.group.add(m.group, label);
      return { ...b, index: i, ...m, label, beaten: done.has(i), lane: LANES[i % 4], row: Math.floor(i / 4), phase: i * 1.7 };
    });
    this._m = new THREE.Matrix4();
    this._f = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._z = new THREE.Vector3();
    this._s = new THREE.Vector3(SCALE, SCALE, SCALE);
    this.update(0, 0);
  }

  /** Mark bot i beaten (tick on its label). */
  setBeaten(i) {
    const b = this.bots[i];
    if (!b || b.beaten) return;
    b.beaten = true;
    b.label.userData.set({ tick: true });
  }

  update(time, dt) {
    const T = this.T;
    const L = this.path.length;
    for (const b of this.bots) {
      const pr = this.schedule.progress(b.time, time);
      // start grid: front row level with the start, back row behind it
      const u0 = 2 - b.row * ROW_GAP;
      const u = u0 + pr.u * (L - u0) / L;
      const settle = Math.min(1, pr.u / 80);
      const lat = b.lane * (1 - settle * settle * (3 - 2 * settle)) + 1.4 * Math.sin(u / 37 + b.phase) * settle;
      const p = pointOnPath(this.path, u);
      const c = Math.cos(p.heading), s = Math.sin(p.heading);
      // (sin h, cos h) points to the model's +Z side of the path
      const x = p.x + s * lat, z = p.z + c * lat;
      // pose from the ground under the four wheels
      const hf = T.heightAt(x + c * 0.8, z - s * 0.8), hr = T.heightAt(x - c * 0.8, z + s * 0.8);
      const hzp = T.heightAt(x + s * 0.62, z + c * 0.62), hzn = T.heightAt(x - s * 0.62, z - c * 0.62);
      const F = this._f.set(1.6 * c, hf - hr, -1.6 * s).normalize();
      const Z = this._z.set(1.24 * s, hzp - hzn, 1.24 * c);
      const U = this._u.crossVectors(Z, F).normalize();
      Z.crossVectors(F, U);
      b.group.matrixAutoUpdate = false;
      b.group.matrix.makeBasis(F, U, Z).scale(this._s).setPosition(x, (hf + hr + hzp + hzn) / 4, z);
      b.group.matrixWorldNeedsUpdate = true;
      for (const w of b.wheels) w.rotation.z -= (pr.speed * dt) / (0.3 * SCALE);
      b.label.position.set(x, (hf + hr + hzp + hzn) / 4 + 1.35, z);
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    for (const b of this.bots) b.label.userData.dispose();
  }
}
