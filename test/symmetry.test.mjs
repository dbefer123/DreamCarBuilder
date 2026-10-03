// Does a perfectly symmetric minimal car drive straight? Isolates code-level asymmetry.
import { createDesign, addNode, addPart, linkEngines } from '../src/car/design.js';
import { CarSim } from '../src/physics/sim.js';
import { ArcadeControls } from '../src/physics/controls.js';

class Flat {
  heightAt() { return 0; }
  normalAt(x, z, o) { o.x = 0; o.y = 1; o.z = 0; return o; }
  surfaceAt() { return 0; }
  queryColliders() {}
}

function build(order) {
  const d = createDesign('sym');
  const N = {};
  const pts = [];
  for (const x of [-1.2, 1.2]) for (const y of [0.25, 0.65]) for (const z of [-0.5, 0.5]) pts.push([x, y, z]);
  const ordered = order === 'leftfirst' ? [...pts].sort((a, b) => a[2] - b[2]) : pts;
  for (const p of ordered) N[p.join(',')] = addNode(d, ...p).id;
  const id = (x, y, z) => N[[x, y, z].join(',')];
  const ids = Object.values(N);
  const rear = [];
  // fully connect the box (rigid, symmetric)
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) addPart(d, 'frame', [ids[i], ids[j]]);
  for (const x of [-1.2, 1.2]) {
    for (const s of [-1, 1]) {
      const hub = addNode(d, x, 0.33, s * 0.8).id;
      const ax = addNode(d, x, 0.33, s * 0.62).id;
      for (const y of [0.25, 0.65]) {
        addPart(d, 'frame', [hub, id(x, y, s * 0.5)]);
        addPart(d, 'frame', [ax, id(x, y, s * 0.5)]);
      }
      addPart(d, 'frame', [hub, ax]);
      addPart(d, 'frame', [hub, id(-x, 0.25, s * 0.5)]);
      addPart(d, 'frame', [ax, id(x, 0.25, -s * 0.5)]);
      const w = addPart(d, 'wheel', [hub, ax], { steer: x > 0 ? 25 : 0, handbrakeKey: x < 0 ? 'handbrake' : 'none' });
      if (x < 0) rear.push(w);
    }
  }
  addPart(d, 'engine', [id(1.2, 0.25, 0.5), id(-1.2, 0.25, 0.5)], { power: 250 });
  addPart(d, 'engine', [id(1.2, 0.25, -0.5), id(-1.2, 0.25, -0.5)], { power: 250 });
  for (const w of rear) linkEngines(d, w, (n, props) => addPart(d, 'transmission', n, props));
  return d;
}

function run(label, setup, coast = false) {
  const sim = new CarSim(build('default'), new Flat());
  setup?.(sim);
  const ctl = new ArcadeControls();
  for (let f = 0; f < 120; f++) sim.step(1 / 60, ctl.update(1 / 60, {}, sim));
  if (coast) {
    for (let i = 0; i < sim.n; i++) sim.vx[i] = 50;
    for (const w of sim.wheels) w.omega = 50 / w.R;
  }
  for (let f = 0; f < 60 * 25; f++) sim.step(1 / 60, coast ? { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0, reverse: false } : ctl.update(1 / 60, { up: 1 }, sim));
  console.log(`${label.padEnd(28)} yaw=${(sim.heading() * 57.3).toFixed(3)}° z=${sim.com.z.toFixed(2)} v=${(sim.speed * 3.6).toFixed(0)} km/h`);
}
run('baseline');
run('no ESC', (s) => { s.drivetrain.stabilityControl = false; });
run('no TC/ESC', (s) => { s.drivetrain.stabilityControl = false; s.drivetrain.tractionControl = false; });
run('coast (no drive)', null, true);
run('coast, rate 4000', (s) => { s.rate = 4000; s.maxSubsteps = 400; }, true);
run('coast, 3 iterations', (s) => { s.iterations = 3; }, true);
