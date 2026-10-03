// Yaw stability experiments under full throttle
import { PRESETS } from '../src/car/presets.js';
import { CarSim } from '../src/physics/sim.js';
import { ArcadeControls } from '../src/physics/controls.js';
import { TIRE_OPTS } from '../src/physics/tire.js';

class TestWorld {
  heightAt() { return 0; }
  normalAt(x, z, o) { o.x = 0; o.y = 1; o.z = 0; return o; }
  surfaceAt() { return 0; }
  queryColliders() {}
}
function trial(label, key, setup) {
  TIRE_OPTS.couple = true;
  const t0 = performance.now();
  const design = PRESETS[key]();
  const sim = new CarSim(design, new TestWorld());
  setup?.(sim, design);
  const ctl = new ArcadeControls();
  const dt = 1 / 60;
  let maxYaw = 0;
  for (let f = 0; f < 600; f++) {
    const c = ctl.update(dt, f < 60 ? {} : { up: 1 }, sim);
    sim.step(dt, c);
    maxYaw = Math.max(maxYaw, Math.abs(sim.heading()));
  }
  console.log(`${key.padEnd(8)} ${label.padEnd(34)} maxYaw=${(maxYaw * 57.3).toFixed(2)}° v=${(sim.speed * 3.6).toFixed(0)} z=${sim.com.z.toFixed(2)}  ${((performance.now() - t0) / 10).toFixed(1)} ms/sim-s`);
}
for (const key of ['truck', 'buggy', 'dragster']) {
  trial('baseline', key);
  trial('no couple', key, () => { TIRE_OPTS.couple = false; });
  trial('no couple, 2 iterations', key, (s) => { TIRE_OPTS.couple = false; s.iterations = 2; });
  trial('no couple, 4 iterations', key, (s) => { TIRE_OPTS.couple = false; s.iterations = 4; });
  trial('couple, 4 iterations', key, (s) => { s.iterations = 4; });
}
