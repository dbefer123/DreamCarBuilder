// Shared population helpers for map definitions.
import { smoothstep } from '../noise.js';
import { ROAD_KIND } from '../terrainData.js';

const HOUSE_COLORS = ['#d8cbb0', '#e6dcc6', '#c9a27e', '#b9b2a6', '#d6c0a0', '#a7826a', '#e9e4d8', '#c4b49a'];
const OFFICE_COLORS = ['#9a9a96', '#b8b4aa', '#8c7766', '#a59a8a', '#c8c3b8', '#7f8487', '#9e8c7a'];
const TOWER_COLORS = ['#5f7f96', '#4f6d7f', '#6e8a99', '#3e5566', '#7a95a3', '#58707a', '#8aa0aa'];

export function pick(G, arr) {
  return arr[Math.floor(G.rnd() * arr.length)];
}

export function populateCity(G, opts = {}) {
  const c = G.city;
  if (!c) return;
  const dt = c.downtown || [(c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2];
  const peak = opts.peak ?? 130;
  const spread = opts.spread ?? 420;
  for (const b of c.blocks) {
    const d = Math.hypot(b.cx - dt[0], b.cz - dt[1]);
    const hmax = 10 + peak * Math.exp(-((d / spread) ** 2));
    const inset = 5;
    const x0 = b.x0 + inset, x1 = b.x1 - inset, z0 = b.z0 + inset, z1 = b.z1 - inset;
    if (b.type === 'park') {
      for (let k = 0; k < 18; k++) {
        G.addTree(x0 + G.rnd() * (x1 - x0), z0 + G.rnd() * (z1 - z0), 1, 0.8 + G.rnd() * 0.6);
      }
      continue;
    }
    if (b.type === 'lot') continue;
    const n = hmax > 85 ? (G.rnd() < 0.55 ? 1 : 2) : hmax > 32 ? 2 : 3;
    const lw = (x1 - x0) / n, ld = (z1 - z0) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (n === 3 && G.rnd() < 0.12) continue; // empty yard
        const gap = 2 + G.rnd() * (n === 1 ? 10 : 5);
        const w = Math.max(8, lw - gap), dd = Math.max(8, ld - gap);
        const floors = Math.max(2, Math.round((hmax * (0.45 + 0.55 * G.rnd())) / 3.4));
        const h = floors * 3.4;
        const style = h > 48 ? 2 : h > 16 ? 1 : 0;
        const color = style === 2 ? pick(G, TOWER_COLORS) : style === 1 ? pick(G, OFFICE_COLORS) : pick(G, HOUSE_COLORS);
        G.addBuilding(x0 + lw * (i + 0.5), z0 + ld * (j + 0.5), w, dd, h, { style, color });
      }
    }
  }
  // street trees on every other street, traffic lights at intersections
  const off = c.hw + 2.6;
  for (let i = 0; i < c.nx; i++) {
    if (i % 2) continue;
    const x = c.x0 + i * c.spacing;
    for (let z = c.z0 + 12; z < c.z1 - 8; z += 22) {
      if (((z - c.z0) % c.spacing) > c.spacing - 14 || ((z - c.z0) % c.spacing) < 14) continue;
      G.addTree(x - off, z, 1, 0.75 + G.rnd() * 0.3);
      G.addTree(x + off, z, 1, 0.75 + G.rnd() * 0.3);
    }
  }
  for (let i = 0; i < c.nx; i++) {
    for (let j = 0; j < c.nz; j++) {
      const x = c.x0 + i * c.spacing, z = c.z0 + j * c.spacing;
      if (opts.lightsEvery && (i + j) % opts.lightsEvery) continue;
      const o = c.hw + 1.4;
      const y = G.T.baseHeightAt(x, z);
      // each pole sits on a corner and reaches over the street to its right
      G.lights.push({ x: x + o, z: z + o, y, rot: Math.PI });
      G.lights.push({ x: x - o, z: z - o, y, rot: 0 });
      G.lights.push({ x: x - o, z: z + o, y, rot: Math.PI / 2 });
      G.lights.push({ x: x + o, z: z - o, y, rot: -Math.PI / 2 });
      for (const [dx, dz] of [[o, o], [-o, -o], [-o, o], [o, -o]]) {
        G.T.addCollider({ kind: 1, x: x + dx, z: z + dz, r: 0.16, y0: y - 1, y1: y + 6 });
      }
    }
  }
}

/** Rows of trees along the outside of public roads (not inside the city). */
export function roadsideTrees(G, road, spacing = 16, offset = 5.5, type = 1) {
  const pts = road.pts;
  let next = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.u < next) continue;
    next = p.u + spacing * (0.8 + G.rnd() * 0.4);
    const q = pts[i - 1];
    const dx = p.x - q.x, dz = p.z - q.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    for (const s of [1, -1]) {
      const o = road.hw + offset + G.rnd() * 3;
      const x = p.x + nx * o * s, z = p.z + nz * o * s;
      if (G.cityBlockAt(x, z)) continue;
      const inf = G.info(x, z);
      if (inf.road < 3 || inf.slope > 0.35) continue;
      G.addTree(x, z, type, 0.8 + G.rnd() * 0.5);
    }
  }
}

export function streetLamps(G, road, spacing = 45) {
  for (let u = 10; u < road.length; u += spacing) {
    const i = road.pts.findIndex((p) => p.u >= u);
    if (i < 1) continue;
    const p = road.pts[i], q = road.pts[i - 1];
    const dx = p.x - q.x, dz = p.z - q.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    const o = road.hw + 1.5;
    const x = p.x + nx * o, z = p.z + nz * o;
    if (G.cityBlockAt(x, z)) continue;
    G.lamps.push({ x, z, y: G.T.baseHeightAt(x, z), rot: Math.atan2(nx, nz) + Math.PI });
    G.T.addCollider({ kind: 1, x, z, r: 0.12, y0: -1e3, y1: 1e3 });
  }
}

export function forest(G, count, extra = () => 1) {
  const n = G.n;
  return G.scatter(count, count * 12, (x, z, inf) => {
    if (inf.road < 7 || inf.slope > 0.38 || inf.urban > 0.05) return 0;
    const grass = Math.max(0, 1 - inf.sand - inf.rock - inf.dirt - inf.urban);
    if (grass < 0.5) return 0;
    const patch = smoothstep(-0.15, 0.35, n.fbm(x / 330 + 40, z / 330 - 17, 3));
    return grass * grass * (0.1 + 0.9 * patch) * extra(x, z, inf);
  }, (x, z) => {
    const inf = G.info(x, z);
    const conifer = inf.h > (G.map.coniferLine ?? 40) ? 0.8 : 0.25;
    const type = G.rnd() < conifer ? 0 : 1;
    G.addTree(x, z, type, 0.75 + G.rnd() * 0.7);
  });
}

export function desertRocks(G, count, density, big = true) {
  return G.scatter(count, count * 15, (x, z, inf) => {
    if (inf.road < 6 || inf.urban > 0.05) return 0;
    return density(x, z, inf);
  }, (x, z) => {
    const s = big ? 2 + Math.pow(G.rnd(), 2.2) * 12 : 0.4 + G.rnd() * 1.4;
    G.addRock(x, z, s * (0.8 + G.rnd() * 0.5), s * (0.6 + G.rnd() * 0.7), s * (0.8 + G.rnd() * 0.5), big ? 0 : 1, big);
  });
}

export function shrubs(G, count, density) {
  return G.scatter(count, count * 8, (x, z, inf) => {
    if (inf.road < 4 || inf.urban > 0.05) return 0;
    return density(x, z, inf);
  }, (x, z) => {
    const y = G.T.baseHeightAt(x, z);
    G.trees.push({ x, y, z, type: 2, s: 0.5 + G.rnd() * 0.8, rot: G.rnd() * 6.28, tint: G.rnd() });
  });
}

/** Checkpoints spread along a road polyline. */
export function checkpointsAlong(road, count, startU = 0, endU = road.length, width = road.hw * 2 + 6) {
  const cps = [];
  for (let k = 1; k <= count; k++) {
    const u = startU + ((endU - startU) * k) / count;
    const i = Math.max(1, road.pts.findIndex((p) => p.u >= u));
    const p = road.pts[Math.min(i, road.pts.length - 1)];
    const q = road.pts[Math.max(0, i - 1)];
    cps.push({ x: p.x, z: p.z, dir: Math.atan2(-(p.z - q.z), p.x - q.x), w: width });
  }
  return cps;
}

/**
 * An off-road race route (no road is built): a Catmull-Rom curve through the control
 * points, sampled every `spacing` metres as { pts: [{ x, z, u }], length }, the shape
 * checkpointsAlong / pointAlong accept.
 */
export function routeTrack(points, spacing = 4) {
  const pts = [];
  const n = points.length;
  const get = (i) => points[Math.max(0, Math.min(n - 1, i))];
  for (let s = 0; s < n - 1; s++) {
    const p0 = get(s - 1), p1 = get(s), p2 = get(s + 1), p3 = get(s + 2);
    const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / spacing));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  pts.push({ x: points[n - 1][0], z: points[n - 1][1] });
  let u = 0;
  pts[0].u = 0;
  for (let i = 1; i < pts.length; i++) {
    u += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].u = u;
  }
  return { pts, length: u, hw: 4 };
}

export function pointAlong(road, u) {
  const i = Math.max(1, road.pts.findIndex((p) => p.u >= u));
  const p = road.pts[Math.min(i, road.pts.length - 1)];
  const q = road.pts[Math.max(0, i - 1)];
  return { x: p.x, z: p.z, heading: Math.atan2(-(p.z - q.z), p.x - q.x) };
}

export { ROAD_KIND };
