// Default map (Single player): green rolling hills, rocky ridges, sandy dune country in the
// south-east and mountains around the edge. Ten off-road competitions of growing length,
// each opened by an engine level and paying a finish prize (opponents: drive/bots.js).
import { smoothstep } from '../noise.js';
import { forest, desertRocks, shrubs, checkpointsAlong, pointAlong, routeTrack } from './common.js';
import { edgeMountains } from './others.js';

// name, engine level that opens it, finish prize (coins), time of day, route control points
const TRACKS = [
  ['Meadow run', 1, 60, 'Noon', [[-420, 120], [-300, 60], [-180, 100], [-60, 40], [60, 90], [150, 40]]],
  ['Hill climb', 1, 120, 'Morning', [[-140, -120], [-240, -220], [-200, -340], [-300, -440], [-420, -400], [-520, -480], [-600, -420]]],
  ['Sand trap', 3, 250, 'Noon', [[160, 180], [280, 260], [380, 220], [480, 320], [560, 300], [640, 400], [600, 520], [680, 600], [720, 700]]],
  ['Ridge line', 5, 360, 'Noon', [[-560, -80], [-640, -200], [-560, -320], [-640, -460], [-560, -600], [-420, -660], [-280, -600], [-160, -660], [-60, -560]]],
  ['Dune sea', 7, 600, 'Evening', [[300, 500], [420, 420], [540, 480], [660, 420], [740, 520], [700, 640], [560, 700], [420, 640], [300, 700], [200, 620], [240, 520]]],
  ['Valley', 9, 1000, 'Noon', [[-700, 260], [-580, 360], [-440, 300], [-320, 400], [-180, 340], [-40, 420], [80, 360], [160, 440], [100, 560], [-40, 600], [-180, 560], [-320, 620], [-460, 580]]],
  ['Highland tour', 11, 1800, 'Morning', [[100, -100], [220, -200], [200, -340], [320, -440], [460, -400], [560, -500], [680, -440], [700, -300], [600, -200], [640, -80], [540, 20], [400, -40], [300, 40], [180, 20]]],
  ['Grand loop', 13, 3200, 'Noon', [[-300, -200], [-100, -300], [100, -260], [300, -300], [440, -180], [420, 0], [500, 140], [420, 300], [240, 280], [100, 200], [-40, 240], [-200, 180], [-320, 240], [-440, 120], [-400, -40], [-310, -180]]],
  ['Mountain marathon', 16, 6000, 'Evening', [[-720, 640], [-640, 520], [-720, 380], [-640, 220], [-720, 60], [-680, -100], [-740, -260], [-660, -400], [-740, -560], [-640, -700], [-480, -740], [-320, -680], [-160, -740], [0, -680], [160, -740], [300, -660], [440, -720], [580, -640]]],
  ['Champions', 19, 11000, 'Noon', [[720, 720], [560, 620], [600, 460], [700, 300], [620, 140], [700, -20], [600, -140], [460, -60], [320, -160], [180, -80], [40, -180], [-100, -100], [-240, -180], [-360, -80], [-500, -160], [-600, -40], [-520, 100], [-380, 160], [-240, 100], [-100, 160], [40, 100], [140, 200], [60, 300]]],
];

const CELL = 8; // corridor grid: distance (m) to the nearest route, capped at REACH
const REACH = 60;
const MAX_GRADE = 0.14;

export const defaultMap = {
  key: 'default',
  name: 'Default',
  size: 2048,
  seed: 2048,
  coniferLine: 70,
  rockColors: [[0.13, 0.13, 0.125], [0.26, 0.255, 0.245]], // grey rock, as in the original
  tracksInfo: TRACKS,
  plan(G) {
    this.routes = TRACKS.map((t) => routeTrack(t[4]));
    for (const r of this.routes) this._profile(r, G.n);
    this._corridor(G.T);
    const s = pointAlong(this.routes[0], 2);
    G.spawn = { x: s.x, z: s.z, heading: s.heading };
  },

  /** Height along a route: the terrain under it, smoothed and limited to a 14 % grade (like a road). */
  _profile(r, n) {
    const pts = r.pts;
    let e = pts.map((p) => this._shape(p.x, p.z, n, 0).h);
    for (let it = 0; it < 3; it++) {
      e = e.map((_, i) => {
        let s = 0, c = 0;
        for (let k = Math.max(0, i - 8); k <= Math.min(pts.length - 1, i + 8); k++) {
          s += e[k];
          c++;
        }
        return s / c;
      });
    }
    const fwd = e.slice(), bwd = e.slice();
    for (let i = 1; i < pts.length; i++) {
      const g = MAX_GRADE * (pts[i].u - pts[i - 1].u);
      fwd[i] = Math.min(fwd[i - 1] + g, Math.max(fwd[i - 1] - g, fwd[i]));
    }
    for (let i = pts.length - 2; i >= 0; i--) {
      const g = MAX_GRADE * (pts[i + 1].u - pts[i].u);
      bwd[i] = Math.min(bwd[i + 1] + g, Math.max(bwd[i + 1] - g, bwd[i]));
    }
    pts.forEach((p, i) => (p.e = (fwd[i] + bwd[i]) / 2));
  },

  /** Rasterise every route into a coarse distance grid (tracks stay smooth and clear). */
  _corridor(T) {
    const N = Math.round(T.size / CELL) + 1;
    const half = T.half;
    const d = new Float32Array(N * N).fill(REACH);
    // height of the nearest route point of each cell (the trail is levelled to it)
    const pe = new Float32Array(N * N);
    for (const r of this.routes) {
      const pts = r.pts;
      for (let s = 0; s < pts.length - 1; s += 2) {
        const a = pts[s], b = pts[Math.min(s + 2, pts.length - 1)];
        const sx = b.x - a.x, sz = b.z - a.z;
        const L2 = sx * sx + sz * sz || 1e-9;
        const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - REACH + half) / CELL));
        const i1 = Math.min(N - 1, Math.ceil((Math.max(a.x, b.x) + REACH + half) / CELL));
        const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - REACH + half) / CELL));
        const j1 = Math.min(N - 1, Math.ceil((Math.max(a.z, b.z) + REACH + half) / CELL));
        for (let j = j0; j <= j1; j++) {
          const z = j * CELL - half;
          for (let i = i0; i <= i1; i++) {
            const x = i * CELL - half;
            const t = Math.max(0, Math.min(1, ((x - a.x) * sx + (z - a.z) * sz) / L2));
            const dist = Math.hypot(x - a.x - sx * t, z - a.z - sz * t);
            const k = j * N + i;
            if (dist < d[k]) {
              d[k] = dist;
              pe[k] = a.e + (b.e - a.e) * t;
            }
          }
        }
      }
    }
    this.corr = { N, d, pe, half };
  },

  _lerpGrid(arr, x, z) {
    const { N, half } = this.corr;
    let gx = (x + half) / CELL, gz = (z + half) / CELL;
    gx = Math.max(0, Math.min(N - 1.001, gx));
    gz = Math.max(0, Math.min(N - 1.001, gz));
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
    const k = j * N + i;
    const top = arr[k] + (arr[k + 1] - arr[k]) * fx;
    const bot = arr[k + N] + (arr[k + N + 1] - arr[k + N]) * fx;
    return top + (bot - top) * fz;
  },

  /** Distance from (x, z) to the nearest competition route (up to 60 m). */
  routeDist(x, z) {
    return this._lerpGrid(this.corr.d, x, z);
  },

  /** Terrain before levelling the trails; k = 0 on a route, 1 away from them. */
  _shape(x, z, n, k) {
    // green rolling hills; tracks get gentler bumps and cut through the rocky ridges
    let h = 40 + 16 * n.fbm(x / 480, z / 480, 4) + 1.4 * n.fbm(x / 40, z / 40, 3) * (0.35 + 0.65 * k);
    const ridge = smoothstep(0.56, 0.96, n.ridged(x / 360 + 11, z / 360 - 5, 4)) * 22 * k;
    h += ridge;
    // dune country in the south-east
    const sd = Math.hypot(x - 540, z - 520) + 110 * n.noise(x / 300, z / 300);
    const sand = 1 - smoothstep(300, 430, sd);
    const warp = 0.6 * n.noise(x / 400, z / 400);
    h += sand * (7 * n.ridged(x / 170 + warp, z / 95, 3) * (0.3 + 0.7 * k) - 4);
    return { h, ridge, sand };
  },

  sample(x, z, o, n) {
    const rd = this.routeDist(x, z);
    const s = this._shape(x, z, n, smoothstep(6, 45, rd));
    let h = s.h;
    if (rd < 22) {
      // the trail follows its smoothed profile, level across, blending into the hills beside it
      h += (this._lerpGrid(this.corr.pe, x, z) - h) * 0.9 * (1 - smoothstep(3, 22, rd));
    }
    const m = edgeMountains(x, z, 1024, n, 0.8, 170);
    h += m;
    o.h = h;
    o.rock = Math.max(smoothstep(5, 15, s.ridge), smoothstep(10, 45, m));
    o.sand = s.sand * (1 - o.rock);
    o.dirt = (1 - s.sand) * (1 - o.rock) * 0.4 * smoothstep(0.3, 0.6, n.fbm(x / 110 + 3, z / 110, 3));
  },

  populate(G) {
    const away = (min) => (x, z) => this.routeDist(x, z) > min;
    forest(G, 5000, (x, z, inf) => (away(20)(x, z) ? 1 - inf.sand : 0));
    desertRocks(G, 260, (x, z, inf) => (away(16)(x, z) ? 0.04 + inf.rock * 0.7 : 0));
    desertRocks(G, 1400, (x, z, inf) => (away(6)(x, z) ? 0.25 + inf.rock * 0.4 : 0), false);
    shrubs(G, 1500, (x, z, inf) => (away(5)(x, z) ? inf.sand * 0.4 + 0.05 : 0));
    TRACKS.forEach(([name, engineLevel, prize, time], i) => {
      const r = this.routes[i];
      const tier = i + 1;
      G.addTrack({
        name,
        author: 'DCB',
        laps: 1,
        time,
        start: pointAlong(r, 2),
        checkpoints: checkpointsAlong(r, Math.max(4, Math.round(r.length / 105)), 0, r.length, 16),
        // the route every ~12 m: arrow markers and the opponents' path
        route: r.pts.filter((p, j) => j % 3 === 0 || j === r.pts.length - 1).map((p) => ({ x: p.x, z: p.z })),
        gates: 'boards',
        par: r.length / (14 + 1.8 * tier),
        sp: { engineLevel, prize, tier },
      });
    });
  },
};
