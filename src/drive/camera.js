// Driving cameras: chase (mouse-orbitable, C / middle click resets), driver view, free orbit.
import * as THREE from 'three';

export class DriveCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.mode = 'chase';
    this.yaw = 0; // offset around the car
    this.pitch = 0.18;
    this.zoom = 1;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.drag = null;
    this.initialized = false;
    this.headingSmooth = 0;
    this.advance = 1; // Settings > Race: 0 velocity direction, 1 car direction, 2 look ahead
    this._down = (e) => {
      if (e.button === 1) {
        this.reset();
        e.preventDefault();
        return;
      }
      if (e.button === 0 || e.button === 2) this.drag = { x: e.clientX, y: e.clientY };
    };
    this._move = (e) => {
      if (!this.drag) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -0.25, 1.35);
      this.drag = { x: e.clientX, y: e.clientY };
    };
    this._up = () => (this.drag = null);
    this._wheel = (e) => {
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.35, 4);
    };
  }

  attach() {
    this.dom.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    this.dom.addEventListener('wheel', this._wheel, { passive: true });
  }

  detach() {
    this.dom.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    this.dom.removeEventListener('wheel', this._wheel);
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0.18;
    this.zoom = 1;
  }

  cycle() {
    this.mode = this.mode === 'chase' ? 'driver' : this.mode === 'driver' ? 'orbit' : 'chase';
  }

  snap() {
    this.initialized = false;
  }

  update(dt, sim, size, world) {
    const cam = this.camera;
    const com = sim.com;
    const fwd = sim.fwd;
    let heading = Math.atan2(-fwd.z, fwd.x);
    const v = sim.vel;
    const vh = Math.hypot(v.x, v.z);
    // follow the direction of travel instead of the nose (drifts, reversing stays car-aligned)
    if (this.advance === 0 && vh > 3 && v.x * fwd.x + v.z * fwd.z > 0) heading = Math.atan2(-v.z, v.x);
    if (sim.up.y < 0.2) heading = this.headingSmooth; // keep calm while tumbling
    // smooth heading (unwrap)
    let dh = heading - this.headingSmooth;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.headingSmooth += dh * Math.min(1, dt * 4);
    if (!this.initialized) this.headingSmooth = heading;
    const dist = Math.max(4.5, size * 1.45) * this.zoom;
    const target = new THREE.Vector3(com.x, com.y + Math.max(0.6, size * 0.12), com.z);
    if (this.advance === 2 && vh > 1) {
      // look ahead of the car along its velocity
      const k = Math.min(12, vh * 0.4) / vh;
      target.x += v.x * k;
      target.z += v.z * k;
    }
    if (this.mode === 'driver' && sim.seat >= 0) {
      const i = sim.seat;
      const up = sim.up;
      const p = new THREE.Vector3(sim.px[i] + up.x * 0.85 - fwd.x * 0.05, sim.py[i] + up.y * 0.85 - fwd.y * 0.05, sim.pz[i] + up.z * 0.85 - fwd.z * 0.05);
      cam.position.copy(p);
      const look = p.clone().add(new THREE.Vector3(fwd.x, fwd.y, fwd.z).multiplyScalar(10));
      look.y += 0.2;
      cam.up.set(up.x, up.y, up.z);
      cam.lookAt(look);
      cam.up.set(0, 1, 0);
      this.initialized = true;
      return;
    }
    const yaw = (this.mode === 'orbit' ? 0 : this.headingSmooth) + Math.PI + this.yaw;
    const pitch = this.pitch;
    const want = new THREE.Vector3(
      target.x + Math.cos(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z - Math.sin(yaw) * Math.cos(pitch) * dist,
    );
    if (world) {
      const g = world.heightAt(want.x, want.z) + 0.6;
      if (want.y < g) want.y = g;
    }
    if (!this.initialized) {
      this.pos.copy(want);
      this.look.copy(target);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt * (this.drag ? 30 : 7));
    this.pos.lerp(want, k);
    this.look.lerp(target, 1 - Math.exp(-dt * 18));
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
  }
}
