// Smaller maps: Salt Flats, Crash Test Site, Desert, Highlands.
import { smoothstep } from '../noise.js';
import { ROAD_KIND, forest, desertRocks, shrubs, checkpointsAlong, pointAlong, roadsideTrees, streetLamps } from './common.js';

export function edgeMountains(x, z, half, n, start = 0.8, height = 140) {
  const e = Math.max(Math.abs(x), Math.abs(z)) / half;
  if (e < start) return 0;
  return smoothstep(start, 0.99, e) * (height + 90 * n.ridged(x / 300, z / 300, 4));
}

export const saltFlats = {
  key: 'saltflats',
  name: 'Salt Flats',
  size: 2048,
  seed: 4242,
  saltFlat: true,
  slopeRock: 1,
  plan(G) {
    this.strip = G.addRoad([[-720, 0], [720, 0]], { hw: 12, kind: ROAD_KIND.RUNWAY, straight: true, elevation: 2, blend: 30 });
    G.spawn = { x: -690, z: 0, heading: 0 };
  },
  sample(x, z, o, n) {
    let h = 2 + 0.25 * n.fbm(x / 300, z / 300, 3);
    const m = edgeMountains(x, z, 1024, n, 0.8, 160);
    h += m;
    o.h = h;
    o.rock = smoothstep(5, 30, m);
    o.sand = 1 - o.rock;
  },
  populate(G) {
    desertRocks(G, 60, (x, z, inf) => inf.rock * 0.6);
    G.addTrack({ name: 'Speed run', author: 'DCB', laps: 1, time: 'Noon', checkpoints: [{ x: 0, z: 0, dir: 0, w: 40 }, { x: 690, z: 0, dir: 0, w: 40 }], start: { x: -690, z: 0, heading: 0 } });
  },
};

export const crashSite = {
  key: 'crashsite',
  name: 'Crash Test Site',
  size: 1024,
  seed: 777,
  rockColors: [[0.16, 0.13, 0.1], [0.3, 0.25, 0.19]],
  plan(G) {
    G.addZone({ rect: [-320, -260, 320, 260], blend: 40, height: 5, concrete: true });
    this.loop = G.addRoad([[-400, -330], [400, -330], [440, 0], [400, 330], [-400, 330], [-440, 0]], { hw: 7, closed: true, elevation: 5, grade: 0.03 });
    G.spawn = { x: -280, z: 0, heading: 0 };
  },
  sample(x, z, o, n, G) {
    let h = 5 + 4 * n.fbm(x / 250, z / 250, 3) * smoothstep(300, 420, Math.max(Math.abs(x), Math.abs(z)));
    h += edgeMountains(x, z, 512, n, 0.82, 60);
    h = G.applyZones(x, z, h, o);
    o.h = h;
    o.urban = smoothstep(0.6, 0.95, o.concreteZone || 0);
  },
  populate(G) {
    // jump ramps of increasing size along the centre line
    const sizes = [1, 1.6, 2.4, 3.4];
    sizes.forEach((s, k) => G.addRamp({ x: -150 + k * 70, z: -120, angle: 0, length: 6 + s * 3, width: 10, h0: 0, h1: s }));
    // big kicker + landing
    G.addRamp({ x: -60, z: 60, angle: 0, length: 26, width: 12, h0: 0, h1: 6 });
    G.addRamp({ x: 110, z: 60, angle: 0, length: 40, width: 14, h0: 6, h1: 0 });
    // bumps
    for (let k = 0; k < 10; k++) {
      G.addRamp({ x: -200 + k * 9, z: 180, angle: 0, length: 4.5, width: 12, h0: 0, h1: 0.35 });
      G.addRamp({ x: -195.5 + k * 9, z: 180, angle: 0, length: 4.5, width: 12, h0: 0.35, h1: 0 });
    }
    // crash walls
    G.addBox({ x: 250, z: -120, w: 3, h: 3, d: 22, color: '#bdb8ad' });
    G.addBox({ x: 250, z: 180, w: 3, h: 1.2, d: 22, color: '#d8a33a' });
    // pillar field
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) G.addBox({ x: 120 + i * 14, z: 150 + j * 14 + (i % 2) * 7, w: 1.2, h: 3, d: 1.2, color: '#c7c2b6' });
    // stairs
    for (let k = 0; k < 6; k++) G.addBox({ x: -250 + k * 6, z: -200, w: 6, h: 0.3 * (k + 1), d: 14, y: 5, color: '#a8a39a' });
    // barriers along the pad edge
    for (let x = -300; x <= 300; x += 12) {
      G.addBox({ x, z: -250, w: 10, h: 0.9, d: 0.6, color: '#e8e5de' });
      G.addBox({ x, z: 250, w: 10, h: 0.9, d: 0.6, color: '#e8e5de' });
    }
    forest(G, 600, (x, z) => (Math.max(Math.abs(x), Math.abs(z)) > 360 ? 1 : 0));
    G.addTrack({ name: 'Long jump', author: 'DCB', laps: 1, time: 'Noon', checkpoints: [{ x: 160, z: 60, dir: 0, w: 20 }], start: { x: -230, z: 60, heading: 0 } });
    G.addTrack({ name: 'Perimeter', author: 'DCB', laps: 2, time: 'Morning', checkpoints: checkpointsAlong(this.loop, 6, 0, this.loop.length, 20), start: pointAlong(this.loop, 4) });
  },
};

export const desert = {
  key: 'desert',
  name: 'Desert',
  size: 2048,
  seed: 31337,
  plan(G) {
    const D = { hw: 4.5, kind: ROAD_KIND.DIRT, grade: 0.12, blend: 28 };
    this.loop = G.addRoad([[-600, -500], [0, -700], [600, -520], [760, 0], [560, 560], [0, 720], [-560, 520], [-760, 0]], { ...D, closed: true });
    this.cross = G.addRoad([[-760, 0], [-300, 80], [100, -60], [760, 0]], { hw: 5, kind: ROAD_KIND.PUBLIC, blend: 45 });
    G.addZone({ circle: [0, 0, 70], blend: 60, height: 'auto', dirt: true });
    G.spawn = { x: -720, z: 10, heading: 0.1 };
  },
  sample(x, z, o, n, G) {
    const warp = 0.7 * n.noise(x / 500, z / 500);
    const dunes = n.ridged(x / 220 + warp, z / 120, 4);
    let h = 20 + 12 * n.fbm(x / 900, z / 900, 3) + 10 * dunes;
    const mn = n.fbm(x / 300 + 4, z / 300 - 9, 4);
    const mesa = smoothstep(0.29, 0.44, mn);
    h += mesa * (25 + 25 * Math.floor(mn * 14) / 14);
    h += edgeMountains(x, z, 1024, n, 0.84, 110);
    h = G.applyZones(x, z, h, o);
    o.h = h;
    o.rock = mesa;
    o.sand = 1 - mesa;
    o.dirt = (o.dirtZone || 0) * 0.8;
  },
  populate(G) {
    desertRocks(G, 400, (x, z, inf) => 0.2 + inf.rock * 0.5);
    desertRocks(G, 1200, () => 0.4, false);
    shrubs(G, 1800, (x, z, inf) => inf.sand * 0.3);
    G.addTrack({ name: 'Dune loop', author: 'DCB', laps: 1, time: 'Evening', checkpoints: checkpointsAlong(this.loop, 8, 0, this.loop.length, 18), start: pointAlong(this.loop, 3) });
  },
};

export const highlands = {
  key: 'highlands',
  name: 'Highlands',
  size: 2048,
  seed: 8086,
  coniferLine: 30,
  rockColors: [[0.12, 0.12, 0.115], [0.24, 0.235, 0.22]],
  plan(G) {
    this.pass = G.addRoad([
      [-900, 700], [-600, 620], [-420, 380], [-560, 140], [-300, -20], [-80, 120], [160, -40], [60, -300],
      [300, -480], [560, -360], [700, -620], [880, -760],
    ], { hw: 4.5, grade: 0.11 });
    this.stage = G.addRoad([[-900, -700], [-650, -520], [-700, -250], [-420, -300], [-300, -560], [-60, -650], [60, -300]], { hw: 3.5, kind: ROAD_KIND.DIRT, grade: 0.15, blend: 8 });
    const s = pointAlong(this.pass, 3);
    G.spawn = { x: s.x, z: s.z, heading: s.heading };
  },
  sample(x, z, o, n) {
    const ridges = n.ridged(x / 520, z / 520, 5);
    let h = 30 + 90 * ridges * ridges + 30 * n.fbm(x / 260, z / 260, 4);
    h += edgeMountains(x, z, 1024, n, 0.84, 120);
    o.h = h;
    o.rock = smoothstep(120, 160, h) * 0.8;
    o.dirt = 0.25 * smoothstep(0.3, 0.6, n.fbm(x / 120, z / 120, 3));
  },
  populate(G) {
    forest(G, 14000);
    roadsideTrees(G, this.pass, 25, 6, 0);
    streetLamps(G, this.pass, 70);
    desertRocks(G, 300, (x, z, inf) => inf.rock * 0.6 + 0.05);
    G.addTrack({ name: 'Mountain pass', author: 'DCB', laps: 1, time: 'Morning', checkpoints: checkpointsAlong(this.pass, 8, 0, this.pass.length, 16), start: pointAlong(this.pass, 3) });
    G.addTrack({ name: 'Rally stage', author: 'DCB', laps: 1, time: 'Evening', checkpoints: checkpointsAlong(this.stage, 6, 0, this.stage.length, 14), start: pointAlong(this.stage, 3) });
  },
};
