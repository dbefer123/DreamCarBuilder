// Other players' cars in multiplayer: each is drawn rigidly from the poses it sends, shown
// about 120 ms behind the newest one (interpolated, so network jitter doesn't show), with a
// name tag. Each carries collision spheres that move with it, so cars can bump each other.
import * as THREE from 'three';
import { CarRenderer } from '../render/carRenderer.js';
import { deserializeDesign } from '../car/design.js';
import { makeLabel } from '../render/labels.js';
import { collisionSpheres, makeColliders, poseColliders, beginStep } from '../physics/remoteColliders.js';

const DELAY = 120; // ms behind the newest state
const EXTRAPOLATE = 300; // ms of dead reckoning when states stop coming
const STALE = 3000; // hide a car that has sent nothing for this long
const MAX_NODES = 3000; // ignore absurd designs
// a car is solid only while its motion is smooth: not long extrapolated, no jumps, and not
// right after it appeared (so nobody gets crushed by a lagging or respawning car)
const SOLID_EXTRAPOLATE = 150; // ms
const SOLID_JUMP = 3; // m in one frame
const SOLID_AFTER = 1.5; // s

class RemoteCar {
  constructor(peer, worldScene) {
    this.id = peer.id;
    this.src = peer.d;
    const design = deserializeDesign(peer.d);
    if (!design.nodes.length || design.nodes.length > MAX_NODES) throw new Error('unusable design');
    const rc = peer.rc || [0, 0, 0];
    this.car = new CarRenderer(design, { mode: 'drive', register: (m) => worldScene.register(m), unregister: (m) => worldScene.unregister(m) });
    this.car.setFromDesign(design);
    this.car.group.position.set(-rc[0], -rc[1], -rc[2]);
    // mirror-image wheels roll the other way round their axle (as in sim.js)
    const byId = new Map(design.nodes.map((n) => [n.id, n]));
    for (const w of this.car.wheels) {
      const a = byId.get(w.part.n[0]), b = byId.get(w.part.n[1]);
      const fz = (a.z - b.z) / (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) || 1);
      w.spinSign = Math.abs(fz) > 0.05 ? Math.sign(fz) : 1;
    }
    this.pose = new THREE.Group();
    this.pose.add(this.car.group);
    this.name = peer.name;
    this.label = makeLabel({ text: peer.name, size: 0.026, bg: 'rgba(30,34,38,0.78)', color: '#ffffff' });
    this.root = new THREE.Group();
    this.root.add(this.pose, this.label);
    this.root.visible = false;
    this.top = Math.max(...design.nodes.map((n) => n.y)) - rc[1] + 0.7;
    this.spheres = collisionSpheres(design, rc);
    this.colliders = makeColliders(this.spheres);
    this.solid = false;
    this.calm = 0; // seconds of smooth motion
    this.dist = 0;
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
  }

  setName(name) {
    if (name === this.name) return;
    this.name = name;
    this.label.userData.set({ text: name });
  }

  /** Pose at server time t from the peer's states (null when there is nothing recent). */
  _poseAt(states, t) {
    if (!states.length) return null;
    const last = states[states.length - 1];
    if (t - last.tm > STALE) return null;
    if (t >= last.tm) {
      const k = Math.min(t - last.tm, EXTRAPOLATE) / 1000;
      return { p: [last.p[0] + last.v[0] * k, last.p[1] + last.v[1] * k, last.p[2] + last.v[2] * k], q: last.q, v: last.v, sp: last.sp, ahead: t - last.tm };
    }
    let i = states.length - 1;
    while (i > 0 && states[i - 1].tm > t) i--;
    const b = states[i], a = states[Math.max(0, i - 1)];
    const f = b.tm > a.tm ? Math.max(0, Math.min(1, (t - a.tm) / (b.tm - a.tm))) : 1;
    this._q.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    this._q2.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    this._q.slerp(this._q2, f);
    const L = (u, w) => u + (w - u) * f;
    return {
      p: [L(a.p[0], b.p[0]), L(a.p[1], b.p[1]), L(a.p[2], b.p[2])],
      q: [this._q.x, this._q.y, this._q.z, this._q.w],
      v: [L(a.v[0], b.v[0]), L(a.v[1], b.v[1]), L(a.v[2], b.v[2])],
      sp: L(a.sp, b.sp),
    };
  }

  update(dt, t, states) {
    const pose = this._poseAt(states, t);
    this.root.visible = !!pose;
    if (!pose) {
      this.solid = false;
      this.calm = 0;
      return;
    }
    const prev = this.pose.position;
    const jump = Math.hypot(pose.p[0] - prev.x, pose.p[1] - prev.y, pose.p[2] - prev.z);
    this.calm = jump > SOLID_JUMP || (pose.ahead ?? 0) > SOLID_EXTRAPOLATE ? 0 : this.calm + dt;
    this.solid = this.calm > SOLID_AFTER;
    this.pose.position.set(pose.p[0], pose.p[1], pose.p[2]);
    this.pose.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    this.label.position.set(pose.p[0], pose.p[1] + this.top, pose.p[2]);
    // wheels roll with the reported speed
    this.dist += (pose.sp || 0) * dt;
    for (const w of this.car.wheels) w.spinner.rotation.set((-w.spinSign * this.dist) / (w.part.radius || 0.33), 0, 0);
    // collision spheres follow the car and move on with its velocity during our physics step
    poseColliders(this.spheres, this.colliders, pose.p, pose.q, pose.v);
  }

  dispose(group) {
    group.remove(this.root);
    this.car.dispose();
    this.label.userData.dispose();
  }
}

export class RemoteCars {
  constructor(mp, worldScene) {
    this.mp = mp;
    this.worldScene = worldScene;
    this.cars = new Map();
    this.bad = new Map(); // id -> design that failed to load (not retried)
    this.group = new THREE.Group();
    worldScene.scene.add(this.group);
  }

  update(dt) {
    const mp = this.mp;
    for (const [id, peer] of mp.peers) {
      let car = this.cars.get(id);
      if (car && car.src !== peer.d) {
        car.dispose(this.group);
        this.cars.delete(id);
        car = null;
      }
      if (!car && peer.d && this.bad.get(id) !== peer.d) {
        try {
          car = new RemoteCar(peer, this.worldScene);
          this.cars.set(id, car);
          this.group.add(car.root);
        } catch {
          this.bad.set(id, peer.d);
        }
      }
      car?.setName(peer.name);
    }
    for (const [id, car] of this.cars) {
      if (mp.peers.has(id)) continue;
      car.dispose(this.group);
      this.cars.delete(id);
    }
    const t = mp.serverNow() - DELAY;
    for (const car of this.cars.values()) car.update(dt, t, mp.peers.get(car.id).states);
  }

  /** Our physics step starts now: the spheres advance from here with their velocity. */
  beginStep(simTime) {
    for (const car of this.cars.values()) beginStep(car.colliders, simTime);
  }

  /** The terrain's collider query, extended with the other cars (see sim.js kind 3). */
  queryColliders(minx, minz, maxx, maxz, out) {
    for (const car of this.cars.values()) {
      if (!car.solid) continue;
      for (const c of car.colliders) if (c.maxx >= minx && c.minx <= maxx && c.maxz >= minz && c.minz <= maxz) out.push(c);
    }
  }

  /** Name, distance and position of each visible car (for the minimap). */
  positions() {
    return [...this.cars.values()].filter((c) => c.root.visible).map((c) => ({ name: c.name, x: c.pose.position.x, z: c.pose.position.z }));
  }

  dispose() {
    for (const car of this.cars.values()) car.dispose(this.group);
    this.cars.clear();
    this.worldScene.scene.remove(this.group);
  }
}
