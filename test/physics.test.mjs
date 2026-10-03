// Headless physics checks: node test/physics.test.mjs [preset]
import { PRESETS } from '../src/car/presets.js';
import { CarSim } from '../src/physics/sim.js';
import { ArcadeControls } from '../src/physics/controls.js';
import { computeStats, nodeMasses } from '../src/car/design.js';

class TestWorld {
  constructor(slopeDeg = 0, walls = []) {
    this.t = Math.tan((slopeDeg * Math.PI) / 180);
    this.walls = walls;
  }
  heightAt(x) { return x * this.t; }
  normalAt(x, z, o) {
    const l = Math.hypot(this.t, 1);
    o.x = -this.t / l; o.y = 1 / l; o.z = 0;
    return o;
  }
  surfaceAt() { return 0; }
  queryColliders(minx, minz, maxx, maxz, out) {
    for (const w of this.walls) if (w.maxx >= minx && w.minx <= maxx && w.maxz >= minz && w.minz <= maxz) out.push(w);
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

function run(sim, ctl, seconds, input, onFrame) {
  const dt = 1 / 60;
  const frames = Math.round(seconds / dt);
  for (let f = 0; f < frames; f++) {
    const inp = typeof input === 'function' ? input(f * dt) : input;
    const c = ctl.update(dt, inp, sim);
    sim.step(dt, c);
    if (onFrame) onFrame(f * dt);
    if (!Number.isFinite(sim.com.x + sim.com.y + sim.com.z)) return false;
  }
  return true;
}

function finite(sim) {
  for (let i = 0; i < sim.n; i++) if (!Number.isFinite(sim.px[i] + sim.py[i] + sim.pz[i])) return false;
  return true;
}

const which = process.argv[2] ? [process.argv[2]] : Object.keys(PRESETS);
for (const key of which) {
  const design = PRESETS[key]();
  const stats = computeStats(design);
  console.log(`\n=== ${design.name}: ${design.nodes.length} nodes, ${design.parts.length} parts, ${stats.mass.toFixed(0)} kg, ${stats.powerHp} hp ===`);

  // 1. settle
  {
    const sim = new CarSim(design, new TestWorld());
    const ctl = new ArcadeControls();
    const restComY = sim.restCom.y;
    const t0 = performance.now();
    const ok = run(sim, ctl, 4, {});
    const ms = performance.now() - t0;
    const sag = restComY - sim.com.y;
    const v = Math.hypot(sim.vel.x, sim.vel.y, sim.vel.z);
    check(`${key}: settles`, ok && finite(sim) && v < 0.05 && Math.abs(sag) < 0.07 && sim.deformation === 0,
      `sag=${(sag * 100).toFixed(1)}cm v=${v.toFixed(3)} deform=${(sim.deformation * 100).toFixed(2)}% upY=${sim.up.y.toFixed(3)}`);
    console.log(`      perf: ${(ms / 4).toFixed(1)} ms per simulated second (${sim.rate} Hz), gears ${sim.drivetrain.ratios.map((r) => r.toFixed(2)).join('/')} vTop~${(sim.drivetrain.vTop * 3.6).toFixed(0)} km/h`);
    const loads = sim.wheels.map((w) => (w.load / 9.81).toFixed(0)).join(', ');
    console.log(`      wheel loads (kg): ${loads}`);
  }

  // 2. accelerate
  {
    const sim = new CarSim(design, new TestWorld());
    const ctl = new ArcadeControls();
    run(sim, ctl, 1.5, {});
    let t100 = null;
    let t = 0;
    const ok = run(sim, ctl, 10, { up: 1 }, (tt) => {
      t = tt;
      if (t100 === null && sim.speed * 3.6 >= 100) t100 = tt;
    });
    check(`${key}: accelerates`, ok && sim.speed > 25 && sim.up.y > 0.8,
      `0-100 km/h ${t100 ? t100.toFixed(2) + 's' : 'n/a'}, v(10s)=${(sim.speed * 3.6).toFixed(0)} km/h gear=${sim.gearLabel} rpm=${sim.rpm.toFixed(0)} drift z=${sim.com.z.toFixed(2)}m upY=${sim.up.y.toFixed(3)}`);
  }

  // 3. turn
  {
    const sim = new CarSim(design, new TestWorld());
    const ctl = new ArcadeControls();
    run(sim, ctl, 1, {});
    // get to ~15 m/s
    run(sim, ctl, 8, () => ({ up: sim.speed < 15 ? 1 : 0 }));
    let prevH = sim.heading();
    let dh = 0;
    let minUp = 1;
    const ok = run(sim, ctl, 4, () => ({ up: sim.speed < 15 ? 0.6 : 0, right: 1 }), () => {
      minUp = Math.min(minUp, sim.up.y);
      let d = sim.heading() - prevH;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      dh += d;
      prevH = sim.heading();
    });
    const yawRate = dh / 4;
    const radius = Math.abs(sim.speed / (yawRate || 1e-6));
    check(`${key}: turns right`, ok && dh < -0.5 && minUp > 0.5,
      `heading change=${(dh * 57.3).toFixed(0)}° radius~${radius.toFixed(1)}m speed=${(sim.speed * 3.6).toFixed(0)} km/h minUpY=${minUp.toFixed(2)}`);
  }

  // 4. brake
  {
    const sim = new CarSim(design, new TestWorld());
    const ctl = new ArcadeControls();
    run(sim, ctl, 1, {});
    run(sim, ctl, 12, () => ({ up: sim.speed < 25 ? 1 : 0 }));
    const x0 = sim.com.x, v0 = sim.speed;
    let stopped = null;
    let dist = 0;
    const ok = run(sim, ctl, 8, () => (stopped === null ? { down: 1 } : {}), (t) => {
      if (stopped === null && sim.speed < 0.5) {
        stopped = t;
        dist = sim.com.x - x0;
      }
    });
    check(`${key}: brakes`, ok && stopped !== null && dist < 3 * (v0 * v0) / (2 * 9.81) + 5,
      `from ${(v0 * 3.6).toFixed(0)} km/h: ${dist.toFixed(1)} m in ${stopped?.toFixed(2)} s (ideal ${((v0 * v0) / (2 * 9.81)).toFixed(1)} m), upY=${sim.up.y.toFixed(2)}`);
  }

  // 5. slope hold
  {
    const sim = new CarSim(design, new TestWorld(10));
    const ctl = new ArcadeControls();
    run(sim, ctl, 3, {});
    const x0 = sim.com.x, z0 = sim.com.z;
    run(sim, ctl, 5, {});
    const drift = Math.hypot(sim.com.x - x0, sim.com.z - z0);
    check(`${key}: holds on 10° slope`, drift < 0.05, `drift ${(drift * 100).toFixed(2)} cm over 5 s`);
  }

  // 6. crash
  {
    const wall = { kind: 0, minx: 40, maxx: 42, miny: -1, maxy: 4, minz: -10, maxz: 10, mu: 0.5 };
    const sim = new CarSim(design, new TestWorld(0, [wall]));
    const ctl = new ArcadeControls();
    run(sim, ctl, 1, {});
    let vHit = 0;
    const ok = run(sim, ctl, 8, (t) => ({ up: 1 }), () => {
      if (sim.com.x < 36) vHit = sim.speed;
    });
    const ok2 = run(sim, ctl, 2, {});
    check(`${key}: crash deforms`, ok && ok2 && finite(sim) && sim.deformation > 0.005,
      `impact ${(vHit * 3.6).toFixed(0)} km/h, deformation ${(sim.deformation * 100).toFixed(1)}%, broken ${sim.brokenCount}, com.x=${sim.com.x.toFixed(1)}`);
  }

  // 7. long random run
  {
    const sim = new CarSim(design, new TestWorld());
    const ctl = new ArcadeControls();
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let cur = {};
    const ok = run(sim, ctl, 60, (t) => {
      if (Math.floor(t * 2) !== Math.floor((t - 1 / 60) * 2)) {
        cur = { up: rnd() > 0.3 ? 1 : 0, down: rnd() > 0.85 ? 1 : 0, left: rnd() > 0.7 ? 1 : 0, right: rnd() > 0.7 ? 1 : 0, handbrake: rnd() > 0.9, boost: rnd() > 0.9 };
      }
      return cur;
    });
    check(`${key}: 60 s random driving stays finite`, ok && finite(sim), `pos=(${sim.com.x.toFixed(0)}, ${sim.com.z.toFixed(0)}) deform=${(sim.deformation * 100).toFixed(1)}% upY=${sim.up.y.toFixed(2)}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
