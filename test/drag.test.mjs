// Straight-line drag run on the real San Angelo runway: logs heading drift.
import { MAPS } from '../src/world/maps/index.js';
import { generateWorld } from '../src/world/generate.js';
import { PRESETS } from '../src/car/presets.js';
import { CarSim } from '../src/physics/sim.js';
import { ArcadeControls } from '../src/physics/controls.js';

const G = await generateWorld(MAPS.sanangelo, () => {});
const key = process.argv[2] || 'buggy';
const design = PRESETS[key]();
if (process.argv[3] === 'mirror') for (const n of design.nodes) n.z = -n.z;
if (process.argv[3] === 'reverse') design.parts.reverse();
const sim = new CarSim(design, G.T);
sim.spawn(600, -265, 0);
const ctl = new ArcadeControls();
for (let f = 0; f < 120; f++) sim.step(1 / 60, ctl.update(1 / 60, {}, sim));
let maxDev = 0;
for (let f = 0; f < 60 * 25; f++) {
  sim.step(1 / 60, ctl.update(1 / 60, { up: 1 }, sim));
  maxDev = Math.max(maxDev, Math.abs(sim.com.z + 265));
  if (f % 60 === 0) {
    const d = sim.drivetrain;
    const toe = sim.wheels.map((w) => {
      const u = sim.up, fw = sim.fwd, r = sim.right;
      let wx = u.y * w.nz - u.z * w.ny, wy = u.z * w.nx - u.x * w.nz, wz = u.x * w.ny - u.y * w.nx;
      wx *= w.spinSign; wy *= w.spinSign; wz *= w.spinSign;
      const ang = Math.atan2(wx * r.x + wy * r.y + wz * r.z, wx * fw.x + wy * fw.y + wz * fw.z) + w.steer;
      return `${w.rear ? 'R' : 'F'}${w.right ? 'r' : 'l'}${(ang * 57.3).toFixed(2)}/${(w.load / 1000).toFixed(1)}`;
    }).join(' ');
    console.log(`t=${(f / 60).toFixed(0)} x=${sim.com.x.toFixed(0)} dz=${(sim.com.z + 265).toFixed(2)} yaw=${(sim.heading() * 57.3).toFixed(2)} r=${sim.yawRate.toFixed(3)} v=${(sim.speed * 3.6).toFixed(0)} gear=${sim.gearLabel} tc=${d.tc.toFixed(2)} esc=${d.escActive.toFixed(2)} | ${toe}`);
  }
  if (sim.com.x > 1750) break;
}
console.log('max lateral deviation', maxDev.toFixed(2), 'm');
