// "Show your best race" (Settings > Race): the car's pose is recorded during a competition
// and the best run is replayed as a translucent copy of the car that set it.
import * as THREE from 'three';
import { CarRenderer, makeGhostMaterial, ghostify } from '../render/carRenderer.js';
import { serializeDesign, deserializeDesign, computeStats } from '../car/design.js';
import { makeLabel } from '../render/labels.js';

const HZ = 20;
const MAX_SECONDS = 600;

export class GhostRecorder {
  constructor(design, restCom) {
    this.design = design;
    this.restCom = { ...restCom };
    this.frames = [];
    this.next = 0;
  }

  sample(t, sim) {
    if (t < this.next || t > MAX_SECONDS) return;
    this.next = t + 1 / HZ;
    const r = (v) => Math.round(v * 1000) / 1000;
    const q = sim.quat;
    this.frames.push([r(t), r(sim.com.x), r(sim.com.y), r(sim.com.z), r(q[0]), r(q[1]), r(q[2]), r(q[3])]);
  }

  toJSON(time) {
    return { time, design: JSON.parse(serializeDesign(this.design)), restCom: this.restCom, frames: this.frames };
  }
}

export class GhostCar {
  /** opts.label: show "Your Best Race (N kg)" over the ghost (Single player). */
  constructor(data, opts = {}) {
    this.data = data;
    const design = deserializeDesign(data.design);
    this.car = new CarRenderer(design, { mode: 'ghost' });
    this.mat = makeGhostMaterial();
    ghostify(this.car, this.mat);
    // the car is drawn in design coordinates; the pose group carries the recorded rigid motion
    const rc = data.restCom;
    this.car.group.position.set(-rc.x, -rc.y, -rc.z);
    this.pose = new THREE.Group();
    this.pose.add(this.car.group);
    this.group = new THREE.Group();
    this.group.add(this.pose);
    if (opts.label) {
      this.label = makeLabel({ text: `Your Best Race (${Math.round(computeStats(design).mass)} kg)`, size: 0.026, bg: 'rgba(255,255,255,0.8)' });
      this.group.add(this.label);
    }
    this.group.visible = false;
    this.i = 0;
    this._q0 = new THREE.Quaternion();
    this._q1 = new THREE.Quaternion();
  }

  update(t) {
    const f = this.data.frames;
    if (!f.length) return;
    if (t < f[this.i][0]) this.i = 0;
    while (this.i < f.length - 2 && f[this.i + 1][0] <= t) this.i++;
    const a = f[this.i], b = f[Math.min(f.length - 1, this.i + 1)];
    const k = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
    this.pose.position.set(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
    this._q0.set(a[4], a[5], a[6], a[7]);
    this._q1.set(b[4], b[5], b[6], b[7]);
    this.pose.quaternion.slerpQuaternions(this._q0, this._q1, k);
    if (this.label) this.label.position.copy(this.pose.position).y += 1.4;
    // fade out once the best run has finished
    this.group.visible = t <= f[f.length - 1][0] + 1;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.car.dispose();
    this.mat.dispose();
    this.label?.userData.dispose();
  }
}
