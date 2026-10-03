// World generation pipeline: map plan -> heights/splat -> roads (profile, SDF, carve)
// -> surfaces -> population (buildings, trees, rocks, ramps). Pure JS.
import { TerrainData, ROAD_KIND } from './terrainData.js';
import { Noise2, mulberry32, smoothstep, clamp } from './noise.js';

export { ROAD_KIND };

function catmullRom(pts, closed, spacing) {
  const out = [];
  const n = pts.length;
  const get = (i) => {
    if (closed) return pts[(i + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const p0 = get(s - 1), p1 = get(s), p2 = get(s + 1), p3 = get(s + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  if (closed) out.push({ ...out[0] });
  else out.push({ x: pts[n - 1][0], z: pts[n - 1][1] });
  let u = 0;
  out[0].u = 0;
  for (let i = 1; i < out.length; i++) {
    u += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    out[i].u = u;
  }
  return out;
}

export class GenContext {
  constructor(T, noise, map) {
    this.T = T;
    this.n = noise;
    this.map = map;
    this.rnd = mulberry32(map.seed * 7919 + 13);
    this.roads = [];
    this.intersections = [];
    this.zones = [];
    this.zonesEnabled = true;
    this.city = null;
    this.buildings = [];
    this.trees = [];
    this.rocks = [];
    this.lights = []; // traffic lights
    this.lamps = []; // street lamps
    this.boxes = []; // visual + collider boxes (walls, barriers)
    this.rampVisuals = [];
    this.tracks = [];
    this.checkpointsVisual = [];
    this.spawn = { x: 0, z: 0, heading: 0 };
    this.labels = [];
  }

  // ---------- plan helpers ----------
  addRoad(points, opts = {}) {
    const road = {
      ctrl: points,
      hw: opts.hw ?? 5,
      kind: opts.kind ?? ROAD_KIND.PUBLIC,
      closed: !!opts.closed,
      elevation: opts.elevation, // fixed height or undefined (follow terrain)
      smooth: opts.smooth ?? true,
      grade: opts.grade ?? 0.09,
      blend: opts.blend,
      name: opts.name,
      trees: opts.trees,
    };
    road.pts = opts.straight ? points.map((p) => ({ x: p[0], z: p[1] })) : catmullRom(points, road.closed, 4);
    if (opts.straight) {
      let u = 0;
      road.pts[0].u = 0;
      for (let i = 1; i < road.pts.length; i++) {
        u += Math.hypot(road.pts[i].x - road.pts[i - 1].x, road.pts[i].z - road.pts[i - 1].z);
        road.pts[i].u = u;
      }
    }
    road.length = road.pts[road.pts.length - 1].u;
    this.roads.push(road);
    return road;
  }

  addIntersection(x, z, r, linf = false) {
    this.intersections.push({ x, z, r, linf });
  }

  /** Flatten zone. shape: {rect:[x0,z0,x1,z1]} or {circle:[x,z,r]}; height 'auto' or number. */
  addZone(z) {
    z.blend = z.blend ?? 60;
    this.zones.push(z);
    return z;
  }

  zoneWeight(zn, x, z) {
    let d;
    if (zn.rect) {
      const [x0, z0, x1, z1] = zn.rect;
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      d = Math.hypot(dx, dz);
    } else {
      const [cx, cz, r] = zn.circle;
      d = Math.max(0, Math.hypot(x - cx, z - cz) - r);
    }
    if (d >= zn.blend) return 0;
    return 1 - smoothstep(0, zn.blend, d);
  }

  applyZones(x, z, h, o) {
    if (!this.zonesEnabled) return h;
    o.urbanZone = 0;
    o.dirtZone = 0;
    o.concreteZone = 0;
    for (const zn of this.zones) {
      const w = this.zoneWeight(zn, x, z);
      if (w <= 0) continue;
      h += (zn.height - h) * w;
      if (zn.urban) o.urbanZone = Math.max(o.urbanZone, w);
      if (zn.dirt) o.dirtZone = Math.max(o.dirtZone, w);
      if (zn.concrete) o.concreteZone = Math.max(o.concreteZone, w);
    }
    return h;
  }

  cityGrid(opts) {
    const { x0, z0, nx, nz, spacing, hw, height } = opts;
    const x1 = x0 + (nx - 1) * spacing, z1 = z0 + (nz - 1) * spacing;
    this.city = { x0, z0, x1, z1, nx, nz, spacing, hw, height, blocks: [], downtown: opts.downtown };
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * spacing;
      this.addRoad([[x, z0 - hw], [x, z1 + hw]], { hw, straight: true, elevation: height, carve: true });
    }
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * spacing;
      this.addRoad([[x0 - hw, z], [x1 + hw, z]], { hw, straight: true, elevation: height });
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) this.addIntersection(x0 + i * spacing, z0 + j * spacing, hw, true);
    // blocks
    for (let i = 0; i < nx - 1; i++) {
      for (let j = 0; j < nz - 1; j++) {
        const bx0 = x0 + i * spacing + hw, bx1 = x0 + (i + 1) * spacing - hw;
        const bz0 = z0 + j * spacing + hw, bz1 = z0 + (j + 1) * spacing - hw;
        const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
        const r = this.rnd();
        let type = 'buildings';
        if (opts.typeAt) type = opts.typeAt(i, j, cx, cz, r);
        else if (r < 0.1) type = 'park';
        else if (r < 0.17) type = 'lot';
        this.city.blocks.push({ i, j, x0: bx0, z0: bz0, x1: bx1, z1: bz1, cx, cz, type });
      }
    }
    this.addZone({ rect: [x0 - 30, z0 - 30, x1 + 30, z1 + 30], height, blend: 120, urban: true });
    return this.city;
  }

  cityBlockAt(x, z) {
    const c = this.city;
    if (!c || x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) return null;
    const i = Math.floor((x - c.x0) / c.spacing), j = Math.floor((z - c.z0) / c.spacing);
    return c.blocks[i * (c.nz - 1) + j] || null;
  }

  addTrack(t) {
    t.restrictions = { ...DEFAULT_RESTRICTIONS, ...(t.restrictions || {}) };
    t.builtin = true;
    this.tracks.push(t);
  }

  addRamp(r) {
    r.base = r.base ?? this.T.baseHeightAt(r.x, r.z);
    this.T.addRamp(r);
    this.rampVisuals.push(r);
  }

  addBox(b) {
    // axis aligned box resting on the terrain (or at b.y)
    const y = b.y ?? this.T.baseHeightAt(b.x, b.z) - 0.3;
    const box = { ...b, y };
    this.boxes.push(box);
    this.T.addCollider({ kind: 0, minx: b.x - b.w / 2, maxx: b.x + b.w / 2, miny: y, maxy: y + b.h, minz: b.z - b.d / 2, maxz: b.z + b.d / 2, mu: 0.5 });
    return box;
  }

  addBuilding(x, z, w, d, h, opts = {}) {
    const y = opts.y ?? this.T.baseHeightAt(x, z) - 0.5;
    const b = { x, z, w, d, h: h + 0.5, y, color: opts.color, style: opts.style ?? 0, seed: Math.floor(this.rnd() * 1e6) };
    this.buildings.push(b);
    this.T.addCollider({ kind: 0, minx: x - w / 2, maxx: x + w / 2, miny: y, maxy: y + b.h, minz: z - d / 2, maxz: z + d / 2, mu: 0.4 });
    return b;
  }

  addTree(x, z, type, scale) {
    const y = this.T.baseHeightAt(x, z);
    this.trees.push({ x, y, z, type, s: scale, rot: this.rnd() * Math.PI * 2, tint: this.rnd() });
    this.T.addCollider({ kind: 1, x, z, r: 0.18 * scale + 0.05, y0: y - 1, y1: y + 4 * scale });
  }

  addRock(x, z, sx, sy, sz, type = 0, collide = true) {
    const y = this.T.baseHeightAt(x, z);
    const rock = { x, y: y - sy * 0.25, z, sx, sy, sz, type, rot: this.rnd() * Math.PI * 2, seed: this.rnd() };
    this.rocks.push(rock);
    if (collide && sy > 0.6) {
      const r = Math.min(sx, sz) * 0.85;
      this.T.addCollider({ kind: 2, x, y: rock.y + sy * 0.15, z, r: Math.max(r, sy * 0.6) });
    }
  }

  /** Random points inside the map accepted with probability density(x, z, info). */
  scatter(count, attempts, density, place) {
    const half = this.T.half * 0.97;
    let placed = 0;
    for (let a = 0; a < attempts && placed < count; a++) {
      const x = (this.rnd() * 2 - 1) * half;
      const z = (this.rnd() * 2 - 1) * half;
      const p = density(x, z, this.info(x, z));
      if (p > 0 && this.rnd() < p) {
        place(x, z);
        placed++;
      }
    }
    return placed;
  }

  info(x, z) {
    const T = this.T;
    const N = T.N;
    const i = clamp(Math.round((x + T.half) / T.cell), 0, N - 1);
    const j = clamp(Math.round((z + T.half) / T.cell), 0, N - 1);
    const k = j * N + i;
    const s = T.splat;
    const nrm = T.normalAt(x, z, { x: 0, y: 1, z: 0 });
    return {
      h: T.h[k],
      sand: s[k * 4] / 255,
      rock: s[k * 4 + 1] / 255,
      dirt: s[k * 4 + 2] / 255,
      urban: s[k * 4 + 3] / 255,
      road: T.roadEdge[k],
      slope: 1 - nrm.y,
    };
  }
}

export const DEFAULT_RESTRICTIONS = {
  disableSlowMotion: true,
  minWeight: 0,
  maxSize: 20,
  noHiddenParts: false,
  maxWheelRadius: 2.0,
  selfRepair: false,
  allowSpoilers: true,
  maxLift: 2e7,
  maxLiftCoefficient: 1000,
  gearbox: 'Any',
  maxEngines: 10,
  maxJets: 10,
  minWheels: 3,
  maxWheels: 12,
  maxDrivingWheels: 12,
  maxShocks: 32,
  maxRods: 32,
  maxFrames: 800,
  maxPanels: 400,
  maxLimiters: 200,
  penalty: 5,
  boost: '200% / 10 sec.',
};

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export async function generateWorld(map, onProgress = () => {}) {
  const t0 = performance.now();
  const T = new TerrainData(map.size, map.cell ?? 2);
  T.saltFlat = !!map.saltFlat;
  const noise = new Noise2(map.seed);
  const G = new GenContext(T, noise, map);
  map.plan(G);

  // zone heights: sample the raw terrain at the zone centre
  G.zonesEnabled = false;
  const tmp = {};
  for (const zn of G.zones) {
    if (zn.height !== undefined && zn.height !== 'auto') continue;
    const c = zn.rect ? [(zn.rect[0] + zn.rect[2]) / 2, (zn.rect[1] + zn.rect[3]) / 2] : [zn.circle[0], zn.circle[1]];
    map.sample(c[0], c[1], tmp, noise, G);
    zn.height = tmp.h + (zn.raise ?? 0);
  }
  G.zonesEnabled = true;

  // heights + splat
  const { N, cell, half } = T;
  const o = {};
  for (let j = 0; j < N; j++) {
    const z = j * cell - half;
    for (let i = 0; i < N; i++) {
      const x = i * cell - half;
      o.sand = o.rock = o.dirt = o.urban = 0;
      map.sample(x, z, o, noise, G);
      const k = j * N + i;
      T.h[k] = o.h;
      T.splat[k * 4] = clamp(o.sand * 255, 0, 255);
      T.splat[k * 4 + 1] = clamp(o.rock * 255, 0, 255);
      T.splat[k * 4 + 2] = clamp(o.dirt * 255, 0, 255);
      T.splat[k * 4 + 3] = clamp(o.urban * 255, 0, 255);
    }
    if ((j & 63) === 0) {
      onProgress(0.05 + 0.6 * (j / N), 'Shaping terrain');
      await yieldFrame();
    }
  }

  // road elevation profiles
  onProgress(0.66, 'Laying roads');
  await yieldFrame();
  for (const road of G.roads) {
    const pts = road.pts;
    if (road.elevation !== undefined) {
      for (const p of pts) p.e = road.elevation;
      continue;
    }
    for (const p of pts) p.e = T.baseHeightAt(p.x, p.z);
    // smooth
    const win = 6;
    for (let it = 0; it < 4; it++) {
      const e = pts.map((p) => p.e);
      for (let i = 0; i < pts.length; i++) {
        let s = 0, c = 0;
        for (let k = -win; k <= win; k++) {
          let q = i + k;
          if (road.closed) q = (q + pts.length - 1) % (pts.length - 1);
          else if (q < 0 || q >= pts.length) continue;
          s += e[q];
          c++;
        }
        // keep the end points (junctions) fixed
        if (!road.closed && (i === 0 || i === pts.length - 1)) continue;
        pts[i].e = s / c;
      }
    }
    // grade limit (forward + backward, averaged)
    const g = road.grade;
    const fwd = pts.map((p) => p.e), bwd = pts.map((p) => p.e);
    for (let i = 1; i < pts.length; i++) {
      const ds = pts[i].u - pts[i - 1].u;
      fwd[i] = clamp(fwd[i], fwd[i - 1] - g * ds, fwd[i - 1] + g * ds);
    }
    for (let i = pts.length - 2; i >= 0; i--) {
      const ds = pts[i + 1].u - pts[i].u;
      bwd[i] = clamp(bwd[i], bwd[i + 1] - g * ds, bwd[i + 1] + g * ds);
    }
    for (let i = 0; i < pts.length; i++) pts[i].e = (fwd[i] + bwd[i]) / 2;
    if (road.closed) pts[pts.length - 1].e = pts[0].e;
  }

  // rasterise roads + carve
  const NN = N * N;
  const acc = { ws: new Float32Array(NN), we: new Float32Array(NN), wm: new Float32Array(NN) };
  let ri = 0;
  for (const road of G.roads) {
    T.rasterRoad(road, acc);
    if ((++ri & 7) === 0) {
      onProgress(0.66 + 0.14 * (ri / G.roads.length), 'Laying roads');
      await yieldFrame();
    }
  }
  for (const it of G.intersections) T.rasterIntersection(it.x, it.z, it.r, it.linf);
  for (let k = 0; k < NN; k++) {
    const w = acc.wm[k];
    if (w > 0) T.h[k] += (acc.we[k] / acc.ws[k] - T.h[k]) * w;
  }

  // slope rock + road shoulders
  onProgress(0.82, 'Painting surfaces');
  await yieldFrame();
  const nrm = { x: 0, y: 1, z: 0 };
  for (let j = 0; j < N; j++) {
    const z = j * cell - half;
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = i * cell - half;
      T.normalAt(x, z, nrm);
      const slope = 1 - nrm.y;
      const s = T.splat;
      let rock = s[k * 4 + 1] / 255;
      const steep = smoothstep(0.22, 0.42, slope) * (map.slopeRock ?? 1);
      if (steep > rock) {
        const add = steep - rock;
        rock = steep;
        // take it from the other channels proportionally
        const f = 1 - add;
        s[k * 4] *= f; s[k * 4 + 2] *= f; s[k * 4 + 3] *= f;
      }
      s[k * 4 + 1] = rock * 255;
      const e = T.roadEdge[k];
      if (e < 3 && T.roadKind[k] === ROAD_KIND.DIRT) {
        const w = 1 - smoothstep(-1, 3, e);
        s[k * 4 + 2] = Math.max(s[k * 4 + 2], w * 255);
      }
      if (e < 2.5 && e > -0.5 && T.roadKind[k] !== ROAD_KIND.DIRT && !G.cityBlockAt(x, z)) {
        // gravel shoulders
        const w = 1 - smoothstep(0, 2.5, e);
        s[k * 4 + 2] = Math.max(s[k * 4 + 2], w * 200);
      }
    }
  }
  T.computeSurfaces();

  onProgress(0.88, 'Populating');
  await yieldFrame();
  map.populate(G);
  onProgress(1, 'Done');
  G.genTime = performance.now() - t0;
  return G;
}
