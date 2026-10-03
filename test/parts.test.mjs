// Checks for the part model: upgrade levels, v1/v2 migration, sliders, angle locks,
// transmissions, seats, rod pistons, panel aero, jets and part damage.
// node test/parts.test.mjs
import { PRESETS, starterDesign } from '../src/car/presets.js';
import { CarSim } from '../src/physics/sim.js';
import { ArcadeControls } from '../src/physics/controls.js';
import {
  createDesign, addNode, addPart, deserializeDesign, serializeDesign, computeStats, driveLayout, carPrice,
  validateDesign, driverSeat, removeParts, nodeMasses,
} from '../src/car/design.js';
import {
  engineLevelStats, frameYield, wheelLevelFactors, partDefaults, levelPrice, partPrice, lengthLimitOf, lengthPenalty, maxLevel,
} from '../src/car/parts.js';

class Flat {
  constructor(h = () => 0) { this.h = h; }
  heightAt(x, z) { return this.h(x, z); }
  normalAt(x, z, o) { o.x = 0; o.y = 1; o.z = 0; return o; }
  surfaceAt() { return 0; }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0, reverse: false };
function steps(sim, seconds, c = IDLE) {
  for (let f = 0; f < Math.round(seconds * 60); f++) sim.step(1 / 60, typeof c === 'function' ? c(f / 60) : c);
}
function pos(sim, id) {
  const i = sim.index.get(id);
  return { x: sim.px[i], y: sim.py[i], z: sim.pz[i] };
}

// ---- upgrade levels ----
{
  const s20 = engineLevelStats(20);
  check('engine level 20 = 1200 hp / 170 kg', near(s20.power, 1200, 0.01) && near(s20.mass, 170, 0.01), `${s20.power.toFixed(1)} hp ${s20.mass.toFixed(1)} kg`);
  const s9 = engineLevelStats(9);
  check('engine levels rise monotonically', s9.power < s20.power && engineLevelStats(25).power > s20.power, `L9 ${s9.power.toFixed(0)} hp, L25 ${engineLevelStats(25).power.toFixed(0)} hp`);
  check('level 13 wheel = neutral grip and mass', near(wheelLevelFactors(13).grip, 1, 1e-9) && near(wheelLevelFactors(13).mass, 1, 1e-9));
}

// ---- Single player coins: prices, length limit, weight penalty ----
{
  check('level prices rise steeply', levelPrice('engine', 1) === 150 && levelPrice('engine', 21) > 250000 && levelPrice('seat', 10) > levelPrice('seat', 9) && levelPrice('frame', 5) === 0,
    `engine L21 ${levelPrice('engine', 21)} c., seat L10 ${levelPrice('seat', 10)} c.`);
  const d = PRESETS.buggy();
  const nm = new Map(d.nodes.map((n) => [n.id, n]));
  let sum = 0;
  for (const p of d.parts) {
    const [a, b, c] = p.n.map((id) => nm.get(id));
    const len = a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
    const area = c ? 0.5 * Math.hypot((b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) : 0;
    sum += partPrice(p, len, area);
  }
  check("car's price is the sum of its parts", carPrice(d) === sum && carPrice(d) > levelPrice('engine', 9), `${carPrice(d)} c.`);
  const seat = { type: 'seat' }, eng = { type: 'engine' }, wh = { type: 'wheel' };
  check('length limits match the original (seat L9 5.67 m, engine L9 4 m / L21 5.5 m, wheel L8 3.88 m)',
    near(lengthLimitOf(seat, 9), 5.67, 0.005) && lengthLimitOf(eng, 9) === 4 && lengthLimitOf(eng, 21) === 5.5 && near(lengthLimitOf(wh, 8), 3.88, 0.01) && lengthLimitOf({ type: 'frame' }) === Infinity);
  check('seat has 10 levels, engines 25', maxLevel('seat') === 10 && maxLevel('engine') === 25 && partDefaults('seat').level === 1);
  check('weight penalty: +12.5 % per metre over the limit', lengthPenalty(3, 4) === 1 && lengthPenalty(6, 4) === 1.25);
  const st = starterDesign();
  const ss = computeStats(st);
  check('the starter car is within its length limit', ss.massScale === 1 && ss.lengthLimit === lengthLimitOf(st.parts.find((p) => p.type === 'seat')), `size ${ss.size.toFixed(2)} m, limit ${ss.lengthLimit.toFixed(2)} m`);
  const drive = new CarSim(st, new Flat());
  const ctl = new ArcadeControls();
  steps(drive, 1);
  for (let f = 0; f < 60 * 6; f++) drive.step(1 / 60, ctl.update(1 / 60, { up: 1, right: f > 240 ? 0.6 : 0 }, drive));
  check('the starter car drives and corners upright', drive.speed > 12 && drive.up.y > 0.8 && validateDesign(st).length === 0, `${(drive.speed * 3.6).toFixed(0)} km/h, up ${drive.up.y.toFixed(2)}`);
  const m1 = new CarSim(st, new Flat()).totalMass, m2 = new CarSim(st, new Flat(), { massScale: 1.5 }).totalMass;
  check('the weight penalty makes the simulated car heavier', near(m2 / m1, 1.5, 1e-6), `${m1.toFixed(0)} → ${m2.toFixed(0)} kg`);
}

// ---- Single player career: starting coins, old points, rewards ----
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const { career, START_COINS } = await import('../src/core/profile.js');
  const starter = carPrice(starterDesign());
  check('a new career starts with the starter car + 500 coins', career.earned() === starter + START_COINS && career.coins(starterDesign()) === START_COINS);
  mem.set('dcb.career.v1', JSON.stringify({ earned: 100, car: null }));
  check('old upgrade points convert to 20 coins each', career.earned() === starter + 2000);
  mem.delete('dcb.career.v1');
  const bots = [{ value: 900, time: 50 }, { value: 300, time: 90 }, { value: 200, time: 120 }];
  const e0 = career.earned();
  const a = career.award({ trackKey: 'default/T', prize: 100, bots, time: 80, length: 1000 });
  const b = career.award({ trackKey: 'default/T', prize: 100, bots, time: 70, length: 1000 });
  const c = career.award({ trackKey: 'default/T', prize: 100, bots, time: 40, length: 1000 });
  const st = career.stats();
  check('finishing pays the prize, each beaten bot pays once', a.total === 600 && b.total === 100 && c.total === 1000 && career.earned() === e0 + 1700 && career.defeated('default/T').length === 3,
    `${a.total} / ${b.total} / ${c.total} c.`);
  check('career stats count finishes and opponents', st.finishes === 3 && st.opponents === 3 && st.raceTime === 190 && near(st.fastest, 90, 1e-6));
  const { storage } = await import('../src/core/storage.js');
  check('best times are saved', storage.setBestTime('default', 'T', 50) && !storage.setBestTime('default', 'T', 60) && storage.bestTime('default', 'T') === 50);
  delete globalThis.localStorage;
}

// ---- v1 -> v2 migration ----
{
  const v1 = {
    name: 'old', nextId: 20,
    nodes: [
      { id: 1, x: 0, y: 0.5, z: 0 }, { id: 2, x: 1, y: 0.5, z: 0 }, { id: 3, x: 0, y: 0.5, z: 0.5 },
      { id: 4, x: 0, y: 1.0, z: 0 }, { id: 5, x: 1, y: 0.33, z: 0.8 }, { id: 6, x: 1, y: 0.33, z: 0.6 },
    ],
    parts: [
      { id: 7, type: 'frame', n: [1, 2], thickness: 0.05, strength: 2 },
      { id: 8, type: 'shock', n: [1, 4], stiffness: 30000, damping: 2000, preload: 0.05, minRatio: 0.6, maxRatio: 1.1 },
      { id: 9, type: 'rod', n: [1, 3], travel: -0.05 },
      { id: 10, type: 'engine', n: [1, 2], power: 380 },
      { id: 11, type: 'panel', n: [1, 2, 3], aero: 'wing', color: '' },
      { id: 12, type: 'wheel', n: [5, 6], radius: 0.33, width: 0.25, driven: true, steer: 0, brake: 1, handbrake: true, grip: 1 },
      { id: 13, type: 'limiter', n: [2, 3], minRatio: 0.2, maxRatio: 1.4 },
    ],
  };
  const d = deserializeDesign(JSON.stringify(v1));
  const f = d.parts.find((p) => p.type === 'frame');
  const sh = d.parts.find((p) => p.type === 'shock');
  const rod = d.parts.find((p) => p.type === 'rod');
  const eng = d.parts.find((p) => p.type === 'engine');
  const pan = d.parts.find((p) => p.type === 'panel');
  const wh = d.parts.find((p) => p.type === 'wheel');
  const lim = d.parts.find((p) => p.type === 'limiter');
  const v1Yield = 45000 * (0.05 / 0.04) ** 2 * 2;
  check('migration: frame yield preserved', d.version === 3 && near(frameYield(f), v1Yield, v1Yield * 1e-3) && f.thickness === undefined, `${frameYield(f).toFixed(0)} N vs ${v1Yield.toFixed(0)} N`);
  check('migration: shock', sh.hardness === 30000 && sh.damping === 20 && near(sh.preCompression, 1.1, 1e-3) && near(sh.maxCompression, 0.4, 1e-9) && sh.maxStretch === 1.1);
  check('migration: rod keeps steering direction', rod.keyCompress === 'steerRight' && rod.keyStretch === 'steerLeft' && near(rod.maxCompression, 0.1, 1e-3), `${rod.keyCompress}/${rod.keyStretch} c=${rod.maxCompression}`);
  check('migration: engine level from hp', eng.level === 9 && eng.power === undefined, `level ${eng.level} = ${engineLevelStats(eng.level).power.toFixed(0)} hp`);
  check('migration: wing panel gets downforce', pan.lift < 0 && pan.aero === undefined);
  check('migration: wheel hand brake key + level 13', wh.handbrakeKey === 'handbrake' && wh.level === 13);
  check('migration: limiter', near(lim.maxCompression, 0.8, 1e-9) && lim.maxStretch === 1.4);
  const tr = d.parts.filter((p) => p.type === 'transmission');
  check('migration: driven wheel gets a transmission from the engine', tr.length === 1 && tr[0].engine === eng.id && tr[0].wheel === wh.id && tr[0].n[1] === wh.n[1] && wh.driven === undefined);
  const again = deserializeDesign(serializeDesign(d));
  check('v3 round trip is stable', JSON.stringify(again.parts) === JSON.stringify(d.parts));
}

// ---- slider: node stays on its frame and slides to the low end ----
{
  const d = createDesign('slider');
  // rigid tilted rail: a triangle resting on the ground, rail A-B sloping down toward +X
  const A = addNode(d, 0, 1.2, 0).id, B = addNode(d, 1.5, 0.6, 0).id;
  const C = addNode(d, 0, 0.05, -0.6).id, D = addNode(d, 0, 0.05, 0.6).id, E = addNode(d, 1.5, 0.05, 0).id;
  for (const [a, b] of [[A, B], [A, C], [A, D], [B, E], [C, D], [C, E], [D, E], [A, E], [B, C], [B, D]]) addPart(d, 'frame', [a, b]);
  const S = addNode(d, 0.3, 1.08, 0).id;
  addPart(d, 'weight', [S], { mass: 20 });
  addPart(d, 'slider', [A, B, S]);
  const sim = new CarSim(d, new Flat());
  steps(sim, 4);
  const a = pos(sim, A), b = pos(sim, B), s = pos(sim, S);
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const t = ((s.x - a.x) * ux + (s.y - a.y) * uy + (s.z - a.z) * uz) / (ux * ux + uy * uy + uz * uz);
  const off = Math.hypot(s.x - (a.x + ux * t), s.y - (a.y + uy * t), s.z - (a.z + uz * t));
  check('slider node stays on the frame', off < 0.005, `offset ${(off * 1000).toFixed(2)} mm`);
  check('slider slides down to the end of its frame', t > 0.97, `t=${t.toFixed(3)} (started 0.2)`);
}

// ---- angle locks ----
function mast(lock) {
  // a vertical post on a ground triangle, joined only at the base node J
  const d = createDesign('mast');
  const J = addNode(d, 0, 0.05, 0).id;
  const A1 = addNode(d, -0.8, 0.05, -0.5).id, A2 = addNode(d, -0.8, 0.05, 0.5).id, A3 = addNode(d, 0.8, 0.05, 0).id;
  const C = addNode(d, 0.06, 1.2, 0).id; // slightly off vertical so a free hinge falls
  for (const [a, b] of [[J, A1], [J, A2], [J, A3], [A1, A2], [A2, A3], [A1, A3], [J, C]]) addPart(d, 'frame', [a, b]);
  addPart(d, 'weight', [C], { mass: 10 });
  if (lock) {
    addPart(d, 'angleLock', [A1, J, C]);
    addPart(d, 'angleLock', [A3, J, C]);
  }
  const sim = new CarSim(d, new Flat());
  steps(sim, 3);
  return pos(sim, C).y;
}
{
  const free = mast(false), locked = mast(true);
  check('angle lock holds a post upright', free < 0.6 && locked > 1.1, `top without lock y=${free.toFixed(2)} m, with lock y=${locked.toFixed(2)} m`);
}
function beam(lock) {
  // straight beam A-J-C between two pillars with a weight at the joint (no diagonal bracing)
  const d = createDesign('beam');
  const A = addNode(d, -1, 1.05, 0).id, J = addNode(d, 0, 1.05, 0).id, C = addNode(d, 1, 1.05, 0).id;
  const A2 = addNode(d, -1, 1.05, 0.4).id, C2 = addNode(d, 1, 1.05, 0.4).id, J2 = addNode(d, 0, 1.05, 0.4).id;
  for (const [a, b] of [[A, J], [J, C], [A2, J2], [J2, C2], [A, A2], [J, J2], [C, C2], [A, J2], [J2, C]]) addPart(d, 'frame', [a, b]);
  addPart(d, 'weight', [J], { mass: 40 });
  addPart(d, 'weight', [J2], { mass: 40 });
  if (lock) {
    addPart(d, 'angleLock', [A, J, C]);
    addPart(d, 'angleLock', [A2, J2, C2]);
  }
  const pillars = new Flat((x) => (Math.abs(x) > 0.9 ? 1.0 : 0));
  const sim = new CarSim(d, pillars, { breakable: false });
  steps(sim, 3);
  return pos(sim, J).y;
}
{
  const free = beam(false), locked = beam(true);
  check('straight angle lock stiffens a beam', free < 0.6 && locked > 0.95, `joint without lock y=${free.toFixed(2)} m, with lock y=${locked.toFixed(2)} m`);
}

// ---- transmissions route power (and are required) ----
{
  const d = PRESETS.buggy();
  const presetLinks = d.parts.filter((p) => p.type === 'transmission');
  check('buggy preset drives its rear wheels through transmissions', presetLinks.length === 2 && computeStats(d).drivenWheels === 2);
  const dragLinks = PRESETS.dragster().parts.filter((p) => p.type === 'transmission');
  check('twin-engine dragster links both engines to both rear wheels', dragLinks.length === 4 && new Set(dragLinks.map((p) => p.engine)).size === 2);
  removeParts(d, presetLinks.map((p) => p.id));
  const eng = d.parts.find((p) => p.type === 'engine');
  const wheels = d.parts.filter((p) => p.type === 'wheel');
  const fl = wheels.find((w) => {
    const n = d.nodes.find((q) => q.id === w.n[0]);
    return n.x > 0 && n.z < 0;
  });
  addPart(d, 'transmission', [eng.n[0], fl.n[1]], { engine: eng.id, wheel: fl.id });
  const lay = driveLayout(d);
  check('transmission decides the driven wheels', lay.wheels.size === 1 && lay.wheels.get(fl.id) === 1);
  const sim = new CarSim(d, new Flat());
  const ctl = new ArcadeControls();
  steps(sim, 1);
  for (let f = 0; f < 60; f++) sim.step(1 / 60, ctl.update(1 / 60, { up: 1 }, sim));
  const w = sim.wheels.find((q) => q.partId === fl.id);
  const others = sim.wheels.filter((q) => q !== w);
  check('only the linked wheel gets torque', sim.drivetrain.driven.length === 1 && w.driveTorque > 0 && others.every((q) => q.driveTorque === 0) && sim.speed > 1,
    `front-left torque ${w.driveTorque.toFixed(0)} N·m, speed ${(sim.speed * 3.6).toFixed(0)} km/h`);
  // without (or with unconnected) transmissions nothing is driven
  const d2 = PRESETS.buggy();
  removeParts(d2, d2.parts.filter((p) => p.type === 'transmission').map((p) => p.id));
  addPart(d2, 'transmission', [d2.nodes[0].id, d2.nodes[1].id]);
  const sim2 = new CarSim(d2, new Flat());
  steps(sim2, 1);
  for (let f = 0; f < 120; f++) sim2.step(1 / 60, ctl.update(1 / 60, { up: 1 }, sim2));
  check('wheels without a transmission are free', computeStats(d2).drivenWheels === 0 && Math.abs(sim2.speed) < 0.3 && validateDesign(d2).some((t) => /transmission/i.test(t)),
    `speed ${(sim2.speed * 3.6).toFixed(1)} km/h`);
  // a v2 car that used the Driven flag gets transmissions and still drives
  const v2 = JSON.parse(serializeDesign(PRESETS.buggy()));
  v2.version = 2;
  v2.parts = v2.parts.filter((p) => p.type !== 'transmission');
  for (const p of v2.parts) if (p.type === 'wheel') p.driven = v2.nodes.find((n) => n.id === p.n[0]).x < 0;
  const d3 = deserializeDesign(v2);
  const sim3 = new CarSim(d3, new Flat());
  steps(sim3, 1);
  for (let f = 0; f < 180; f++) sim3.step(1 / 60, ctl.update(1 / 60, { up: 1 }, sim3));
  check('v2 Driven flags migrate to transmissions', d3.parts.filter((p) => p.type === 'transmission').length === 2 && computeStats(d3).drivenWheels === 2 && sim3.speed > 8,
    `speed after 3 s ${(sim3.speed * 3.6).toFixed(0)} km/h`);
}

// ---- passenger seats ----
{
  const d = PRESETS.buggy();
  const m0 = [...nodeMasses(d).values()].reduce((a, b) => a + b, 0);
  const driver = d.parts.find((p) => p.type === 'seat');
  const pas = addPart(d, 'seat', [d.nodes[5].id], { role: 'passenger', seatType: 'classic', physics: 4000 });
  const m1 = [...nodeMasses(d).values()].reduce((a, b) => a + b, 0);
  const sim = new CarSim(d, new Flat());
  check('a passenger seat adds mass but is not the driver', driverSeat(d) === driver && sim.seatPart === driver && sim.rate === 2000 && near(m1 - m0, 80, 1e-6) && pas.role === 'passenger');
  d.parts.find((p) => p === driver).role = 'passenger';
  check('a car needs a driver seat', validateDesign(d).some((t) => /driver/i.test(t)));
}

// ---- piston rod ----
{
  const d = createDesign('piston');
  const A = addNode(d, 0, 0.05, 0).id, B = addNode(d, 1, 0.05, 0).id;
  addPart(d, 'rod', [A, B], { mode: 'piston', maxStretch: 1.5, maxCompression: 0.3, keyStretch: 'action1', keyCompress: 'action2', returnTime: 0.2, ratioOfPeriods: 1 });
  addPart(d, 'weight', [A], { mass: 5 });
  addPart(d, 'weight', [B], { mass: 5 });
  const sim = new CarSim(d, new Flat());
  const len = () => { const a = pos(sim, A), b = pos(sim, B); return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); };
  steps(sim, 1, { ...IDLE, actions: { action1: 1 } });
  const ext = len();
  steps(sim, 1, { ...IDLE, actions: { action2: 1 } });
  const comp = len();
  steps(sim, 1);
  const back = len();
  check('piston extends, retracts and returns', near(ext, 1.5, 0.02) && near(comp, 0.7, 0.02) && near(back, 1.0, 0.02), `${ext.toFixed(3)} / ${comp.toFixed(3)} / ${back.toFixed(3)} m`);
}

// ---- panel aero and jets ----
{
  const d = createDesign('plate');
  const a = addNode(d, 0, 1, -0.5).id, b = addNode(d, 0, 1, 0.5).id, c = addNode(d, -1, 1, 0).id;
  addPart(d, 'panel', [a, b, c], { lift: -1, drag: 0.5 });
  addPart(d, 'jet', [c, a], { mode: 'max', level: 20 });
  const sim = new CarSim(d, new Flat());
  for (let i = 0; i < sim.n; i++) { sim.vx[i] = 30; sim.vy[i] = 0; sim.vz[i] = 0; }
  sim.updateFrame();
  sim._frameForces(IDLE, 1 / 60);
  let fx = 0, fy = 0;
  for (let i = 0; i < sim.n; i++) { fx += sim.fx[i]; fy += sim.fy[i]; }
  const q = 0.5 * 1.225 * 900 * 0.5;
  // jet at level 20 (8 kN) pushes toward +x, drag opposes, lift -1 pulls down
  const jetX = sim.jets[0].thrust * (1 / Math.hypot(1, 0.5));
  check('panel lift and drag', near(fy, -q, 1) && near(fx, jetX - q * 0.5 - 0.5 * 1.225 * sim.cdA * 900, 5),
    `fy=${fy.toFixed(0)} N (expect ${(-q).toFixed(0)}), fx=${fx.toFixed(0)} N`);
  check('jet in maximum-thrust mode fires without throttle', sim.jets[0].on === 1 && near(sim.jets[0].thrust, 8000, 1));
}

// ---- part damage ----
{
  const wall = { kind: 0, minx: 30, maxx: 32, miny: -1, maxy: 4, minz: -10, maxz: 10, mu: 0.5 };
  const world = new Flat();
  world.queryColliders = (minx, minz, maxx, maxz, out) => { if (wall.maxx >= minx && wall.minx <= maxx) out.push(wall); };
  const d = PRESETS.buggy();
  for (const p of d.parts) if (p.type === 'engine' || p.type === 'seat') p.elasticLimit = 1;
  const sim = new CarSim(d, world);
  const ctl = new ArcadeControls();
  steps(sim, 1);
  for (let f = 0; f < 60 * 7; f++) sim.step(1 / 60, ctl.update(1 / 60, { up: 1 }, sim));
  check('crash damage costs engine power', sim.powerHealth < 0.9, `engine health ${(sim.powerHealth * 100).toFixed(0)} %, deformation ${(sim.deformation * 100).toFixed(1)} %`);
  check('a crushed cockpit knocks the driver out', sim.knockedOut === true);
  sim.spawn(0, 0, 0);
  check('respawn repairs parts', sim.powerHealth === 1 && !sim.knockedOut);
  // a normal car survives normal driving
  const sim2 = new CarSim(PRESETS.buggy(), new Flat());
  steps(sim2, 1);
  for (let f = 0; f < 60 * 6; f++) sim2.step(1 / 60, ctl.update(1 / 60, { up: 1, right: f > 200 ? 1 : 0 }, sim2));
  check('default elastic limits survive hard driving', sim2.powerHealth === 1 && !sim2.knockedOut);
  const sim3 = new CarSim(PRESETS.buggy(), world);
  steps(sim3, 1);
  for (let f = 0; f < 60 * 7; f++) sim3.step(1 / 60, ctl.update(1 / 60, { up: 1 }, sim3));
  console.log(`      default limits after a wall crash: engine ${(sim3.powerHealth * 100).toFixed(0)}%, wheels ${sim3.wheels.map((w) => (w.health * 100).toFixed(0)).join('/')}%, knocked out ${sim3.knockedOut}`);
}

// ---- multiplayer: another player's car bumps ours ----
{
  const { collisionSpheres, makeColliders, poseColliders, beginStep } = await import('../src/physics/remoteColliders.js');
  const other = PRESETS.buggy();
  const otherSim = new CarSim(other, new Flat());
  const rc = [otherSim.restCom.x, otherSim.restCom.y, otherSim.restCom.z];
  const spheres = collisionSpheres(other, rc);
  const cols = makeColliders(spheres);
  const world = new Flat();
  world.queryColliders = (minx, minz, maxx, maxz, out) => { for (const c of cols) if (c.maxx >= minx && c.minx <= maxx && c.maxz >= minz && c.minz <= maxz) out.push(c); };
  const sim = new CarSim(PRESETS.buggy(), world);
  steps(sim, 1);
  const y = sim.com.y;
  // the other car comes from behind at 8 m/s and drives on through for a second
  let x = -6.5;
  for (let f = 0; f < 90; f++) {
    x += 8 / 60;
    poseColliders(spheres, cols, [x, y, 0], [0, 0, 0, 1], [8, 0, 0]);
    beginStep(cols, sim.time);
    sim.step(1 / 60, IDLE);
  }
  check('a bump from another player pushes the car without wrecking it', sim.vel.x > 4 && sim.deformation < 0.05 && !sim.knockedOut && sim.up.y > 0.8 && spheres.length <= 48,
    `pushed to ${sim.vel.x.toFixed(1)} m/s, deformation ${(sim.deformation * 100).toFixed(1)} %, ${spheres.length} spheres`);
}

// ---- per-car physics accuracy from the seat ----
{
  const d = PRESETS.buggy();
  d.parts.find((p) => p.type === 'seat').physics = 4000;
  check('seat physics setting sets the rate', new CarSim(d, new Flat()).rate === 4000 && new CarSim(d, new Flat(), { rate: 1000 }).rate === 1000);
  check('defaults match the original screenshots', partDefaults('shock').hardness === 20000 && partDefaults('angleLock').elasticLimit === 100 && partDefaults('transmission').radius === 0.021);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
