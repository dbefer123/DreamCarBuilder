// One editor viewport: camera (perspective or orthographic), Blender-style turntable
// navigation and screen <-> world helpers. Rects are in CSS pixels, top-left origin.
import * as THREE from 'three';

const DEG = Math.PI / 180;

export const VIEW_PRESETS = {
  persp: { yaw: 118 * DEG, pitch: 24 * DEG, ortho: false },
  front: { yaw: 0, pitch: 0, ortho: true },
  back: { yaw: 180 * DEG, pitch: 0, ortho: true },
  right: { yaw: 90 * DEG, pitch: 0, ortho: true },
  left: { yaw: -90 * DEG, pitch: 0, ortho: true },
  top: { yaw: 90 * DEG, pitch: 89.999 * DEG, ortho: true },
  bottom: { yaw: 90 * DEG, pitch: -89.999 * DEG, ortho: true },
};

export class Viewport {
  constructor(name, opts = {}) {
    this.name = name;
    this.fixed = !!opts.fixed; // fixed views (top/side panels) only pan + zoom
    this.layer = opts.layer ?? 1;
    this.rect = { x: 0, y: 0, w: 100, h: 100 };
    this.persp = new THREE.PerspectiveCamera(35, 1, 0.02, 400);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
    for (const c of [this.persp, this.orthoCam]) {
      c.layers.enable(0);
      c.layers.enable(this.layer);
    }
    this.target = new THREE.Vector3(0, 0.5, 0);
    this.yaw = VIEW_PRESETS.persp.yaw;
    this.pitch = VIEW_PRESETS.persp.pitch;
    this.dist = 8;
    this.ortho = false;
    this.preset = 'persp';
    this.background = opts.background || null;
    this._r = new THREE.Raycaster();
    this.setView(opts.view || 'persp');
  }

  get camera() {
    return this.ortho ? this.orthoCam : this.persp;
  }

  setRect(x, y, w, h) {
    this.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    this.update();
  }

  contains(cx, cy) {
    const r = this.rect;
    return cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
  }

  local(cx, cy) {
    return { x: cx - this.rect.x, y: cy - this.rect.y };
  }

  setView(name, keepTarget = true) {
    const p = VIEW_PRESETS[name];
    if (!p) return;
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.ortho = p.ortho || (this.fixed && this.ortho);
    this._autoOrtho = p.ortho && !this.fixed;
    this.preset = name;
    if (!keepTarget) this.target.set(0, 0.5, 0);
    this.update();
  }

  /** Camera direction (from target toward camera). */
  dir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(cp * Math.cos(this.yaw), Math.sin(this.pitch), cp * Math.sin(this.yaw));
  }

  upVec(out = new THREE.Vector3()) {
    const sp = Math.sin(this.pitch);
    return out.set(-sp * Math.cos(this.yaw), Math.cos(this.pitch), -sp * Math.sin(this.yaw));
  }

  update() {
    const aspect = this.rect.w / this.rect.h;
    const d = this.dir();
    const up = this.upVec();
    for (const cam of [this.persp, this.orthoCam]) {
      cam.position.copy(this.target).addScaledVector(d, this.dist);
      cam.up.copy(up);
      cam.lookAt(this.target);
    }
    this.persp.aspect = aspect;
    this.persp.near = Math.max(0.01, this.dist * 0.005);
    this.persp.far = this.dist * 60 + 100;
    this.persp.updateProjectionMatrix();
    const hh = this.dist * Math.tan((this.persp.fov * DEG) / 2);
    this.orthoCam.left = -hh * aspect;
    this.orthoCam.right = hh * aspect;
    this.orthoCam.top = hh;
    this.orthoCam.bottom = -hh;
    this.orthoCam.near = -this.dist * 40;
    this.orthoCam.far = this.dist * 40;
    this.orthoCam.updateProjectionMatrix();
    this.persp.updateMatrixWorld();
    this.orthoCam.updateMatrixWorld();
  }

  orbit(dx, dy) {
    if (this.fixed) return;
    this.yaw += dx * 0.008;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.008, -89.999 * DEG, 89.999 * DEG);
    if (this._autoOrtho) {
      // Blender "auto perspective": leaving an axis view returns to perspective
      this.ortho = false;
      this._autoOrtho = false;
    }
    this.preset = 'free';
    this.update();
  }

  /** Pan by a screen-space delta in pixels. */
  pan(dx, dy) {
    const wpp = this.worldPerPixel(this.target);
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    this.target.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp);
    this.update();
  }

  zoom(f) {
    this.dist = THREE.MathUtils.clamp(this.dist * f, 0.3, 300);
    this.update();
  }

  /** World units per screen pixel at a point (depth-dependent for perspective). */
  worldPerPixel(point) {
    if (this.ortho) return (this.orthoCam.top - this.orthoCam.bottom) / this.rect.h;
    const d = this.persp.position.distanceTo(point);
    return (2 * d * Math.tan((this.persp.fov * DEG) / 2)) / this.rect.h;
  }

  /** Project a world point to viewport-local pixels; z is NDC depth, behind = true if behind camera. */
  project(v, out = {}) {
    const p = _p.copy(v).project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * this.rect.w;
    out.y = (-p.y * 0.5 + 0.5) * this.rect.h;
    out.z = p.z;
    out.behind = p.z > 1 || p.z < -1;
    return out;
  }

  ray(lx, ly) {
    const ndc = new THREE.Vector2((lx / this.rect.w) * 2 - 1, -(ly / this.rect.h) * 2 + 1);
    this._r.setFromCamera(ndc, this.camera);
    return this._r.ray.clone();
  }

  /** Point under the cursor on the plane through `anchor` with normal `n`. */
  planePoint(lx, ly, anchor, n) {
    const ray = this.ray(lx, ly);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, anchor);
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(plane, hit)) return hit;
    return null;
  }

  /** Principal axis plane most facing the camera (for placing new nodes). */
  workPlaneNormal() {
    const d = this.dir();
    const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
    if (ay >= ax && ay >= az) return new THREE.Vector3(0, 1, 0);
    if (az >= ax) return new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3(1, 0, 0);
  }

  frame(box, pad = 1.25) {
    if (box.isEmpty()) return;
    box.getCenter(this.target);
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 0.5) * 0.5 * pad;
    const aspect = this.rect.w / this.rect.h;
    const fov = this.persp.fov * DEG;
    const fit = r / Math.sin(Math.min(fov, fov * aspect) / 2);
    this.dist = Math.max(0.5, fit);
    this.update();
  }
}

const _p = new THREE.Vector3();
