// Heightfield + surface data and physics queries. Pure JS (runs in Node too).
import { SURF } from '../physics/surfaces.js';
import { smoothstep } from './noise.js';

export const ROAD_KIND = { PUBLIC: 0, RACE: 1, DIRT: 2, RUNWAY: 3 };
const SDF_MAX = 16; // metres stored around roads
const INTER_MAX = 24;

// float32 -> float16 bits
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
export function toHalf(v) {
  _f32[0] = v;
  const x = _u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m = (m | 0x800000) >>> (1 - e);
    return sign | ((m + 0x1000) >>> 13);
  }
  if (e >= 31) return sign | 0x7c00;
  const h = sign | (e << 10) | ((m + 0x1000) >>> 13);
  return h;
}

export class TerrainData {
  constructor(size, cell = 2) {
    this.size = size;
    this.cell = cell;
    this.half = size / 2;
    this.N = Math.round(size / cell) + 1;
    const NN = this.N * this.N;
    this.h = new Float32Array(NN);
    this.splat = new Uint8Array(NN * 4); // sand, rock, dirt, urban (grass = rest)
    this.surface = new Uint8Array(NN);
    this.roadEdge = new Float32Array(NN).fill(SDF_MAX);
    this.roadCenter = new Float32Array(NN).fill(SDF_MAX);
    this.roadAlong = new Float32Array(NN);
    this.roadKind = new Uint8Array(NN);
    this.interDist = new Float32Array(NN).fill(INTER_MAX);
    this.ramps = [];
    this.rampGrid = null;
    this.colliders = [];
    this.colGrid = new Map();
    this.colCell = 32;
  }

  // ---------------- queries ----------------
  heightAt(x, z) {
    const N = this.N;
    let gx = (x + this.half) / this.cell, gz = (z + this.half) / this.cell;
    if (gx < 0) gx = 0; else if (gx > N - 1.001) gx = N - 1.001;
    if (gz < 0) gz = 0; else if (gz > N - 1.001) gz = N - 1.001;
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const k = j * N + i;
    const h = this.h;
    const a = h[k] + (h[k + 1] - h[k]) * fx;
    const b = h[k + N] + (h[k + N + 1] - h[k + N]) * fx;
    let y = a + (b - a) * fz;
    if (this.rampGrid) {
      const r = this._rampHeight(x, z);
      if (r > y) y = r;
    }
    return y;
  }

  baseHeightAt(x, z) {
    const N = this.N;
    let gx = (x + this.half) / this.cell, gz = (z + this.half) / this.cell;
    gx = Math.max(0, Math.min(N - 1.001, gx));
    gz = Math.max(0, Math.min(N - 1.001, gz));
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const k = j * N + i;
    const h = this.h;
    const a = h[k] + (h[k + 1] - h[k]) * fx;
    const b = h[k + N] + (h[k + N + 1] - h[k + N]) * fx;
    return a + (b - a) * fz;
  }

  normalAt(x, z, out) {
    if (this.rampGrid) {
      const rp = this._rampAt(x, z);
      if (rp && rp.top >= this.baseHeightAt(x, z)) {
        out.x = rp.nx; out.y = rp.ny; out.z = rp.nz;
        return out;
      }
    }
    const N = this.N, c = this.cell;
    let gx = (x + this.half) / c, gz = (z + this.half) / c;
    gx = Math.max(0, Math.min(N - 1.001, gx));
    gz = Math.max(0, Math.min(N - 1.001, gz));
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const k = j * N + i;
    const h = this.h;
    const dhdx = ((h[k + 1] - h[k]) * (1 - fz) + (h[k + N + 1] - h[k + N]) * fz) / c;
    const dhdz = ((h[k + N] - h[k]) * (1 - fx) + (h[k + N + 1] - h[k + 1]) * fx) / c;
    const l = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    out.x = -dhdx / l; out.y = 1 / l; out.z = -dhdz / l;
    return out;
  }

  surfaceAt(x, z) {
    if (this.rampGrid && this._rampAt(x, z)) return SURF.CONCRETE;
    const N = this.N;
    const i = Math.round((x + this.half) / this.cell), j = Math.round((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= N || j >= N) return SURF.GRASS;
    return this.surface[j * N + i];
  }

  /** Road info at a world point (nearest grid vertex). */
  roadAt(x, z) {
    const N = this.N;
    const i = Math.round((x + this.half) / this.cell), j = Math.round((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= N || j >= N) return null;
    const k = j * N + i;
    return { edge: this.roadEdge[k], kind: this.roadKind[k] };
  }

  queryColliders(minx, minz, maxx, maxz, out) {
    const cs = this.colCell;
    const i0 = Math.floor(minx / cs), i1 = Math.floor(maxx / cs);
    const j0 = Math.floor(minz / cs), j1 = Math.floor(maxz / cs);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const arr = this.colGrid.get(i * 73856093 ^ j * 19349663);
      if (!arr) continue;
      for (const c of arr) {
        if (seen.has(c)) continue;
        if (c.maxx < minx || c.minx > maxx || c.maxz < minz || c.minz > maxz) continue;
        seen.add(c);
        out.push(c);
      }
    }
  }

  addCollider(c) {
    // normalise bounds for broadphase
    if (c.kind === 1) { c.minx = c.x - c.r; c.maxx = c.x + c.r; c.minz = c.z - c.r; c.maxz = c.z + c.r; }
    if (c.kind === 2) { c.minx = c.x - c.r; c.maxx = c.x + c.r; c.minz = c.z - c.r; c.maxz = c.z + c.r; }
    this.colliders.push(c);
    const cs = this.colCell;
    for (let j = Math.floor(c.minz / cs); j <= Math.floor(c.maxz / cs); j++) {
      for (let i = Math.floor(c.minx / cs); i <= Math.floor(c.maxx / cs); i++) {
        const key = i * 73856093 ^ j * 19349663;
        let arr = this.colGrid.get(key);
        if (!arr) this.colGrid.set(key, (arr = []));
        arr.push(c);
      }
    }
  }

  // ---------------- ramps (analytic height overlays) ----------------
  /**
   * Ramp/platform: oriented rectangle centred at (x, z), rotated by `angle` about Y,
   * `length` along local x, `width` along local z, top rising from h0 (at -length/2)
   * to h1 (at +length/2) above `base`.
   */
  addRamp(r) {
    const c = Math.cos(r.angle), s = Math.sin(r.angle);
    r.c = c; r.s = s;
    const slope = (r.h1 - r.h0) / r.length;
    // normal of plane y = base + h0 + slope*(lx + L/2): gradient along local x
    const gx = slope * c, gz = -slope * s; // d/dx, d/dz of world-space height
    const l = Math.sqrt(gx * gx + gz * gz + 1);
    r.nx = -gx / l; r.ny = 1 / l; r.nz = -gz / l;
    this.ramps.push(r);
    if (!this.rampGrid) this.rampGrid = new Map();
    const ext = Math.hypot(r.length, r.width) / 2 + 1;
    for (let j = Math.floor((r.z - ext) / 16); j <= Math.floor((r.z + ext) / 16); j++) {
      for (let i = Math.floor((r.x - ext) / 16); i <= Math.floor((r.x + ext) / 16); i++) {
        const key = i * 73856093 ^ j * 19349663;
        let arr = this.rampGrid.get(key);
        if (!arr) this.rampGrid.set(key, (arr = []));
        arr.push(r);
      }
    }
  }

  _rampAt(x, z) {
    const arr = this.rampGrid.get(Math.floor(x / 16) * 73856093 ^ Math.floor(z / 16) * 19349663);
    if (!arr) return null;
    let best = null, bh = -Infinity;
    for (const r of arr) {
      const dx = x - r.x, dz = z - r.z;
      // local coords: rotation by angle about Y (x' = x c - z s ... with three's convention)
      const lx = dx * r.c - dz * r.s;
      const lz = dx * r.s + dz * r.c;
      if (Math.abs(lx) > r.length / 2 || Math.abs(lz) > r.width / 2) continue;
      const top = r.base + r.h0 + (r.h1 - r.h0) * (lx / r.length + 0.5);
      if (top > bh) { bh = top; best = r; }
    }
    if (best) best.top = bh;
    return best;
  }

  _rampHeight(x, z) {
    const r = this._rampAt(x, z);
    return r ? r.top : -Infinity;
  }

  // ---------------- generation helpers ----------------
  /**
   * Rasterise a road polyline into the SDF fields and the carving accumulators.
   * pts: [{x, z, u, e}] densified points with along-distance u and elevation e.
   */
  rasterRoad(road, acc) {
    const { N, cell, half } = this;
    const pts = road.pts;
    const hw = road.hw;
    const margin = SDF_MAX;
    const blend = road.blend ?? 14;
    const reach = hw + Math.max(margin, blend);
    for (let s = 0; s < pts.length - 1; s++) {
      const p0 = pts[s], p1 = pts[s + 1];
      const sx = p1.x - p0.x, sz = p1.z - p0.z;
      const L2 = sx * sx + sz * sz;
      if (L2 < 1e-9) continue;
      const L = Math.sqrt(L2);
      const i0 = Math.max(0, Math.floor((Math.min(p0.x, p1.x) - reach + half) / cell));
      const i1 = Math.min(N - 1, Math.ceil((Math.max(p0.x, p1.x) + reach + half) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(p0.z, p1.z) - reach + half) / cell));
      const j1 = Math.min(N - 1, Math.ceil((Math.max(p0.z, p1.z) + reach + half) / cell));
      for (let j = j0; j <= j1; j++) {
        const z = j * cell - half;
        for (let i = i0; i <= i1; i++) {
          const x = i * cell - half;
          const qx = x - p0.x, qz = z - p0.z;
          let t = (qx * sx + qz * sz) / L2;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const cx = qx - sx * t, cz = qz - sz * t;
          const d = Math.sqrt(cx * cx + cz * cz);
          if (d > reach) continue;
          const k = j * N + i;
          const edge = d - hw;
          if (edge < this.roadEdge[k]) {
            this.roadEdge[k] = edge;
            const side = sx * qz - sz * qx >= 0 ? 1 : -1;
            this.roadCenter[k] = Math.max(-SDF_MAX, Math.min(SDF_MAX, side * d));
            this.roadAlong[k] = p0.u + L * t;
            this.roadKind[k] = road.kind;
          }
          if (acc && road.carve !== false) {
            const w = edge < 1 ? 1 : 1 - smoothstep(1, blend, edge);
            if (w > 0) {
              const e = p0.e + (p1.e - p0.e) * t;
              const ww = w * w * w + 1e-4;
              acc.ws[k] += ww;
              acc.we[k] += ww * e;
              if (w > acc.wm[k]) acc.wm[k] = w;
            }
          }
        }
      }
    }
  }

  rasterIntersection(x, z, r, linf = false) {
    const { N, cell, half } = this;
    const reach = r + INTER_MAX;
    const i0 = Math.max(0, Math.floor((x - reach + half) / cell)), i1 = Math.min(N - 1, Math.ceil((x + reach + half) / cell));
    const j0 = Math.max(0, Math.floor((z - reach + half) / cell)), j1 = Math.min(N - 1, Math.ceil((z + reach + half) / cell));
    for (let j = j0; j <= j1; j++) {
      const dz = j * cell - half - z;
      for (let i = i0; i <= i1; i++) {
        const dx = i * cell - half - x;
        const d = (linf ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz)) - r;
        const k = j * N + i;
        if (d < this.interDist[k]) this.interDist[k] = d;
      }
    }
  }

  /** Finalise surfaces from roads + splat. */
  computeSurfaces() {
    const NN = this.N * this.N;
    for (let k = 0; k < NN; k++) {
      const e = this.roadEdge[k];
      if (e < 0) {
        const kind = this.roadKind[k];
        if (kind === ROAD_KIND.DIRT) this.surface[k] = SURF.DIRT;
        else if (kind === ROAD_KIND.RUNWAY) this.surface[k] = SURF.CONCRETE;
        else if (kind === ROAD_KIND.RACE && e > -1.3) this.surface[k] = SURF.KERB;
        else this.surface[k] = SURF.ASPHALT;
        continue;
      }
      const s = this.splat;
      const sand = s[k * 4], rock = s[k * 4 + 1], dirt = s[k * 4 + 2], urban = s[k * 4 + 3];
      const grass = Math.max(0, 255 - sand - rock - dirt - urban);
      let best = SURF.GRASS, bv = grass;
      if (sand > bv) { bv = sand; best = this.saltFlat ? SURF.SALT : SURF.SAND; }
      if (rock > bv) { bv = rock; best = SURF.ROCK; }
      if (dirt > bv) { bv = dirt; best = SURF.DIRT; }
      if (urban > bv) { bv = urban; best = SURF.CONCRETE; }
      this.surface[k] = best;
    }
  }

  /** GPU road textures: RGBA half (edge, centre, cos, sin) + RGBA8 (inter, kind). */
  buildRoadTextures(period = 12) {
    const NN = this.N * this.N;
    const a = new Uint16Array(NN * 4);
    const b = new Uint8Array(NN * 4);
    const w = (2 * Math.PI) / period;
    for (let k = 0; k < NN; k++) {
      const e = this.roadEdge[k];
      a[k * 4] = toHalf(e);
      a[k * 4 + 1] = toHalf(this.roadCenter[k]);
      const u = this.roadAlong[k] * w;
      a[k * 4 + 2] = toHalf(Math.cos(u));
      a[k * 4 + 3] = toHalf(Math.sin(u));
      b[k * 4] = Math.max(0, Math.min(255, Math.round(((this.interDist[k] + 8) / 32) * 255)));
      b[k * 4 + 1] = this.roadKind[k] * 60;
      b[k * 4 + 2] = 0;
      b[k * 4 + 3] = 255;
    }
    return { a, b };
  }
}
