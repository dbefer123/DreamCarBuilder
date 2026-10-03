// Headless world generation timing + sanity, and the buggy driving on the real terrain.
import { MAPS } from '../src/world/maps/index.js';
import { generateWorld } from '../src/world/generate.js';
import { PRESETS } from '../src/car/presets.js';
import { CarSim } from '../src/physics/sim.js';
import { ArcadeControls } from '../src/physics/controls.js';

const keys = process.argv[2] ? [process.argv[2]] : Object.keys(MAPS);
for (const key of keys) {
  const map = MAPS[key];
  const t0 = performance.now();
  const G = await generateWorld(map, () => {});
  const T = G.T;
  let minH = Infinity, maxH = -Infinity, nan = 0;
  for (const v of T.h) { if (!Number.isFinite(v)) nan++; minH = Math.min(minH, v); maxH = Math.max(maxH, v); }
  console.log(`${map.name}: ${(performance.now() - t0).toFixed(0)} ms, N=${T.N}, h=[${minH.toFixed(1)}, ${maxH.toFixed(1)}], NaN=${nan}, roads=${G.roads.length}, buildings=${G.buildings.length}, trees=${G.trees.length}, rocks=${G.rocks.length}, lights=${G.lights.length}, colliders=${T.colliders.length}, tracks=${G.tracks.length}`);
  // drive the buggy from the spawn for 15 s
  const sim = new CarSim(PRESETS.buggy(), T);
  sim.spawn(G.spawn.x, G.spawn.z, G.spawn.heading);
  const ctl = new ArcadeControls();
  const t1 = performance.now();
  for (let f = 0; f < 900; f++) {
    const c = ctl.update(1 / 60, f < 60 ? {} : { up: 0.7 }, sim);
    sim.step(1 / 60, c);
  }
  const d = Math.hypot(sim.com.x - G.spawn.x, sim.com.z - G.spawn.z);
  console.log(`   drive: ${d.toFixed(0)} m in 14 s, v=${(sim.speed * 3.6).toFixed(0)} km/h, upY=${sim.up.y.toFixed(2)}, deform=${(sim.deformation * 100).toFixed(1)}%, sim ${((performance.now() - t1) / 15).toFixed(1)} ms/sim-s, surface=${T.surfaceAt(sim.com.x, sim.com.z)}`);
}
