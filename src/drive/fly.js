// Temporary free-fly camera for checking world visuals.
import * as THREE from 'three';
import { PostFX } from '../render/post.js';

export class FlyScreen {
  constructor(app, world) {
    this.app = app;
    this.world = world;
    this.camera = world.camera;
    const s = world.G.spawn;
    const y = world.G.T.heightAt(s.x, s.z);
    this.camera.position.set(s.x - 12, y + 4, s.z + 6);
    this.yaw = -0.4;
    this.pitch = -0.08;
    this.post = new PostFX(app.renderer, world.scene.scene, this.camera, app.settings.quality);
    this.drag = null;
    this._down = (e) => (this.drag = { x: e.clientX, y: e.clientY });
    this._up = () => (this.drag = null);
    this._move = (e) => {
      if (!this.drag) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.004;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - (e.clientY - this.drag.y) * 0.004));
      this.drag = { x: e.clientX, y: e.clientY };
    };
  }

  enter() {
    const c = this.app.canvas;
    c.addEventListener('pointerdown', this._down);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointermove', this._move);
    this.resize(window.innerWidth, window.innerHeight);
  }

  exit() {
    const c = this.app.canvas;
    c.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointermove', this._move);
    this.post.dispose();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.world.scene.csm.updateFrustums();
    const s = this.app.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(s.x, s.y);
  }

  /** Debug helper: place the camera (yaw/pitch in degrees). */
  look(x, y, z, yawDeg, pitchDeg) {
    const T = this.world.G.T;
    this.camera.position.set(x, T.heightAt(x, z) + y, z);
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
  }

  update(dt) {
    const inp = this.app.input;
    const sp = (inp.is('ShiftLeft') ? 120 : 25) * dt;
    const f = new THREE.Vector3(Math.sin(this.yaw) * -1, 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    if (inp.is('KeyW')) this.camera.position.addScaledVector(f, sp);
    if (inp.is('KeyS')) this.camera.position.addScaledVector(f, -sp);
    if (inp.is('KeyD')) this.camera.position.addScaledVector(r, sp);
    if (inp.is('KeyA')) this.camera.position.addScaledVector(r, -sp);
    if (inp.is('KeyE')) this.camera.position.y += sp;
    if (inp.is('KeyQ')) this.camera.position.y -= sp;
    const T = this.world.G.T;
    const g = T.heightAt(this.camera.position.x, this.camera.position.z);
    if (this.camera.position.y < g + 1.2) this.camera.position.y = g + 1.2;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    for (const t of ['Dawn', 'Morning', 'Noon', 'Evening', 'Sunset', 'Night'].entries()) {
      if (inp.hit(`Digit${t[0] + 1}`)) this.world.scene.setTime(t[1]);
    }
    this.world.scene.update(dt, this.camera);
  }

  render(dt) {
    this.post.render(dt);
  }
}
