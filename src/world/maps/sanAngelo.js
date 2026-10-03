// Workshop: San Angelo — city grid (SW), green hills, northern/eastern desert with
// red mesas, raceway (SE), airstrip, outpost compound and dirt trails.
import { smoothstep } from '../noise.js';
import { ROAD_KIND, populateCity, roadsideTrees, streetLamps, forest, desertRocks, shrubs, checkpointsAlong, pointAlong } from './common.js';

const HALF = 2048;
const CITY_H = 12;

export const sanAngelo = {
  key: 'sanangelo',
  name: 'Workshop: San Angelo',
  size: 4096,
  seed: 1977,
  coniferLine: 48,

  plan(G) {
    G.cityGrid({ x0: -1720, z0: 300, nx: 15, nz: 16, spacing: 100, hw: 7, height: CITY_H, downtown: [-1020, 1080],
      typeAt: (i, j, cx, cz, r) => {
        if (i >= 12 && j <= 4) return r < 0.6 ? 'lot' : 'buildings'; // empty plots near the north-east edge
        if (r < 0.09) return 'park';
        if (r < 0.14) return 'lot';
        return 'buildings';
      } });

    // zones
    G.addZone({ circle: [-60, -1250, 110], blend: 90, height: 'auto', concrete: true });
    G.addZone({ rect: [560, -300, 1760, -230], blend: 120, height: 'auto', concrete: true });
    G.addZone({ rect: [1080, 960, 1900, 1930], blend: 200, height: 'auto' });
    G.addZone({ circle: [1600, -1600, 170], blend: 100, height: 'auto', dirt: true });

    // public roads
    this.highway = G.addRoad([[-313, 1000], [-150, 990], [100, 1000], [400, 1060], [750, 1150], [1000, 1230], [1150, 1300]], { hw: 6, name: 'highway' });
    this.north = G.addRoad([[-1020, 293], [-1020, 150], [-930, -230], [-680, -640], [-360, -1010], [-120, -1190]], { hw: 5 });
    this.east = G.addRoad([[0, -1250], [300, -1160], [520, -880], [590, -520], [560, -265]], { hw: 5 });
    this.south = G.addRoad([[1760, -265], [1720, 60], [1560, 480], [1420, 860], [1330, 1060]], { hw: 5 });
    this.west = G.addRoad([[-1727, 1200], [-1850, 1150], [-1930, 900], [-1900, 400], [-1820, 100]], { hw: 5 });
    G.addIntersection(-313, 1000, 6);
    G.addIntersection(-1020, 293, 5);
    G.addIntersection(-1727, 1200, 5);

    // runway
    this.runway = G.addRoad([[560, -265], [1760, -265]], { hw: 15, kind: ROAD_KIND.RUNWAY, straight: true });

    // race circuit
    this.circuit = G.addRoad([
      [1150, 1300], [1330, 1060], [1640, 1010], [1840, 1150], [1800, 1430], [1600, 1520],
      [1700, 1740], [1500, 1880], [1250, 1800], [1300, 1560], [1140, 1450],
    ], { hw: 8, kind: ROAD_KIND.RACE, closed: true, grade: 0.05 });

    // dirt trails
    const D = { hw: 3.5, kind: ROAD_KIND.DIRT, grade: 0.16, blend: 8 };
    this.trailA = G.addRoad([[-1720, 293], [-1860, -20], [-1720, -420], [-1320, -680], [-1000, -470], [-1110, -110], [-1020, 140]], D);
    this.trailB = G.addRoad([[-1820, 100], [-1500, 10], [-1000, 60], [-600, -20], [-200, 70], [200, 0], [520, 90], [900, 10], [1250, -80], [1720, 0]], D);
    this.trailC = G.addRoad([[300, -1160], [620, -1500], [1000, -1760], [1430, -1640]], D);
    this.trailD = G.addRoad([[400, 1060], [560, 1480], [880, 1800], [1160, 1880]], D);
    this.trailE = G.addRoad([[1760, -265], [1880, -800], [1720, -1260], [1640, -1430]], D);
    this.trailF = G.addRoad([[-680, -640], [-900, -1100], [-1300, -1400], [-1700, -1500]], D);

  },

  sample(x, z, o, n, G) {
    const dx = (x + 900) / 1.25, dz = z - 520;
    const field = 1 - Math.sqrt(dx * dx + dz * dz) / 1500 + 0.2 * n.fbm(x / 900, z / 900, 3);
    const green = smoothstep(0.0, 0.22, field);
    const desert = 1 - green;
    let h = 18 + 14 * n.fbm(x / 1600 + 3.1, z / 1600 - 1.7, 3);
    let rock = 0, sand = 0, dirt = 0;
    if (green > 0.001) {
      const hills = n.fbm(x / 520 + 7.7, z / 520 + 2.2, 5);
      h += green * (24 * Math.max(-0.35, hills) + 9 * n.ridged(x / 300, z / 300, 3));
      dirt += green * 0.35 * smoothstep(0.25, 0.6, n.fbm(x / 140 + 5, z / 140, 3));
    }
    if (desert > 0.001) {
      const warp = 0.6 * n.noise(x / 700, z / 700);
      const dunes = n.ridged(x / 260 + warp, z / 140, 3);
      h += desert * (12 + 8 * dunes);
      sand = desert;
      const mesaReg = smoothstep(150, 650, x) * desert + smoothstep(-500, -1100, z) * desert * 0.6;
      if (mesaReg > 0.001) {
        const mn = n.fbm(x / 380 + 11, z / 380 - 5, 4);
        const mesa = smoothstep(0.28, 0.42, mn) * Math.min(1, mesaReg);
        const terr = Math.floor(mn * 18) / 18;
        h += mesa * (24 + 30 * terr);
        rock = Math.max(rock, mesa);
      }
    }
    const e = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    if (e > 0.85) {
      const edge = smoothstep(0.86, 0.995, e);
      h += edge * (95 + 80 * n.ridged(x / 420, z / 420, 4));
      rock = Math.max(rock, edge * 0.7);
    }
    h = G.applyZones(x, z, h, o);
    let urban = o.urbanZone || 0;
    if (urban > 0) {
      const blk = G.cityBlockAt(x, z);
      if (blk && blk.type === 'park') urban *= 0.0;
      urban = smoothstep(0.55, 0.9, urban);
    }
    const cz = o.concreteZone || 0;
    urban = Math.max(urban, smoothstep(0.6, 0.95, cz));
    dirt = Math.max(dirt, (o.dirtZone || 0) * 0.9);
    const k = 1 - urban;
    o.h = h;
    o.sand = sand * (1 - rock) * k;
    o.rock = rock * k;
    o.dirt = dirt * (1 - rock) * k * (1 - sand * 0.5);
    o.urban = urban;
  },

  populate(G) {
    populateCity(G, { peak: 120, spread: 300 });
    roadsideTrees(G, this.highway, 15, 5);
    roadsideTrees(G, this.north, 22, 6);
    roadsideTrees(G, this.west, 20, 6);
    streetLamps(G, this.highway, 42);

    // outpost compound
    const ox = -60, oz = -1250;
    const sheds = [[-50, -40, 38, 22, 9], [35, -45, 26, 18, 7], [55, 20, 30, 30, 11], [-45, 35, 22, 16, 6], [0, 60, 18, 12, 5]];
    for (const [sx, sz, w, d, h] of sheds) G.addBuilding(ox + sx, oz + sz, w, d, h, { style: 3, color: '#a39b8c' });
    // hangars by the runway
    for (let k = 0; k < 4; k++) G.addBuilding(760 + k * 70, -335, 48, 34, 14, { style: 3, color: '#b5b8ba' });
    G.addBuilding(1100, -340, 16, 16, 22, { style: 1, color: '#c8c3b8' }); // tower
    // raceway grandstands + pits
    G.addBuilding(1500, 1003, 160, 14, 9, { style: 4, color: '#c9ccd0' });
    G.addBuilding(1480, 1040, 120, 12, 6, { style: 1, color: '#e4e2dc' });

    forest(G, 11000);
    desertRocks(G, 520, (x, z, inf) => inf.sand * smoothstep(250, 700, x) * smoothstep(-0.1, 0.4, G.n.fbm(x / 260, z / 260, 2)) * 0.9);
    // rock ring around the arena
    for (let a = 0; a < Math.PI * 2; a += 0.11) {
      if (Math.abs(a - Math.PI * 1.25) < 0.25) continue; // opening toward the trail
      const r = 185 + G.rnd() * 25;
      G.addRock(1600 + Math.cos(a) * r, -1600 + Math.sin(a) * r, 9 + G.rnd() * 8, 8 + G.rnd() * 12, 9 + G.rnd() * 8, 0, true);
    }
    shrubs(G, 2500, (x, z, inf) => inf.sand * 0.25);
    desertRocks(G, 1500, (x, z, inf) => inf.sand * 0.3 + inf.rock * 0.2, false);

    // stunt ramps in the arena and on the apron
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      G.addRamp({ x: 1600 + Math.cos(a) * 70, z: -1600 + Math.sin(a) * 70, angle: -a + Math.PI / 2, length: 14, width: 8, h0: 0, h1: 2.2 + k * 0.6 });
    }
    G.addRamp({ x: 1200, z: -200, angle: 0, length: 18, width: 10, h0: 0, h1: 3.5 });

    // spawn in the right-hand lane of the highway, just outside the city
    const sp = pointAlong(this.highway, 24);
    G.spawn = { x: sp.x + Math.sin(sp.heading) * 2.5, z: sp.z + Math.cos(sp.heading) * 2.5, heading: sp.heading };

    // competitions
    const lap = this.circuit;
    G.addTrack({ name: 'Raceway GP', author: 'DCB', laps: 2, time: 'Noon', checkpoints: checkpointsAlong(lap, 10, 0, lap.length, 26), start: pointAlong(lap, 6) });
    G.addTrack({
      name: 'dragster', author: 'Zaluris', laps: 1, time: 'Noon',
      checkpoints: [{ x: 1720, z: -265, dir: 0, w: 34 }],
      start: { x: 600, z: -265, heading: 0 },
      restrictions: { minWeight: 1250, maxWheelRadius: 78 * 0.0254, selfRepair: false },
    });
    const hw = this.highway;
    G.addTrack({ name: 'Highway run', author: 'DCB', laps: 1, time: 'Morning', checkpoints: checkpointsAlong(hw, 4, 0, hw.length, 20), start: pointAlong(hw, 5) });
    G.addTrack({ name: 'Desert trail', author: 'DCB', laps: 1, time: 'Evening', checkpoints: checkpointsAlong(this.trailC, 4, 0, this.trailC.length, 16), start: pointAlong(this.trailC, 4) });
    G.addTrack({ name: 'Hill trail', author: 'DCB', laps: 1, time: 'Morning', checkpoints: checkpointsAlong(this.trailA, 6, 0, this.trailA.length, 16), start: pointAlong(this.trailA, 4) });
  },
};
