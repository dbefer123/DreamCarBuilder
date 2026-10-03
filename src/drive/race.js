// Competitions: checkpoint gates, countdown, timing, laps, penalties and best times.
// Default-map tracks use the original's look: white boards on two poles and white arrows
// along the route.
import * as THREE from 'three';
import { routeTrack } from '../world/maps/common.js';

/** Checkpoint of the Default map: two tall poles, each with a white board on top. */
function boardGate(width, kind, index) {
  const g = new THREE.Group();
  const h = 6.5;
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.3 });
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 160;
  const c = canvas.getContext('2d');
  c.fillStyle = '#f6f6f2';
  c.fillRect(0, 0, 128, 160);
  if (kind === 'finish') {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 10; j++) {
      c.fillStyle = (i + j) % 2 ? '#141414' : '#f6f6f2';
      c.fillRect(i * 16, j * 16, 16, 16);
    }
  } else {
    c.strokeStyle = '#c9cbc6';
    c.lineWidth = 6;
    c.strokeRect(3, 3, 122, 154);
    c.fillStyle = '#2b2f36';
    c.font = '700 76px "Exo 2", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(index + 1), 64, 84);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const bannerMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const postGeo = new THREE.CylinderGeometry(0.07, 0.09, h, 8);
  postGeo.translate(0, h / 2, 0);
  const boardGeo = new THREE.PlaneGeometry(1.5, 1.9);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.z = (s * width) / 2;
    p.castShadow = true;
    g.add(p);
    const b = new THREE.Mesh(boardGeo, bannerMat);
    b.rotation.y = Math.PI / 2;
    b.position.set(0, h - 0.95, (s * width) / 2);
    g.add(b);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 120, 8, 1, true), beamMat);
    beam.position.set(0, h + 60, (s * width) / 2);
    g.add(beam);
  }
  g.userData = { beamMat, bannerMat, postMat, boards: true };
  return g;
}

/** White arrows floating over the route every `spacing` metres, pointing the way. */
function routeArrows(path, T, spacing = 25) {
  const shape = new THREE.Shape();
  // chevron in the XZ plane pointing +X
  shape.moveTo(0.9, 0);
  shape.lineTo(-0.3, 0.8);
  shape.lineTo(-0.3, 0.35);
  shape.lineTo(-0.9, 0.35);
  shape.lineTo(-0.9, -0.35);
  shape.lineTo(-0.3, -0.35);
  shape.lineTo(-0.3, -0.8);
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // lie flat, pointing +X
  geo.rotateZ(0.45); // tilt the tip up so it reads from a low camera
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const count = Math.max(0, Math.floor((path.length - 20) / spacing));
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  mesh.count = count;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < count; k++) {
    const p = pointOnPath(path, 15 + k * spacing);
    q.setFromAxisAngle(up, p.heading);
    m.compose(new THREE.Vector3(p.x, T.heightAt(p.x, p.z) + 1.1, p.z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(k, m);
  }
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The line a competition follows, sampled every ~2 m as { pts: [{ x, z, u }], length }:
 * the track's route when it has one (Default map), else a curve through its checkpoints.
 */
export function racePath(track) {
  if (track._path) return track._path;
  let ctrl;
  if (track.route?.length > 1) ctrl = track.route.map((p) => [p.x, p.z]);
  else {
    ctrl = [[track.start.x, track.start.z]];
    for (let l = 0; l < (track.laps || 1); l++) for (const c of track.checkpoints) ctrl.push([c.x, c.z]);
  }
  const path = routeTrack(ctrl, 2);
  Object.defineProperty(track, '_path', { value: path, enumerable: false });
  return path;
}

/** Point at distance u along a path, with its heading (extends straight past the ends). */
export function pointOnPath(path, u) {
  const pts = path.pts;
  const n = pts.length;
  let i;
  if (u <= 0) i = 1;
  else if (u >= path.length) i = n - 1;
  else {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].u < u) lo = mid; else hi = mid;
    }
    i = hi;
  }
  const a = pts[i - 1], b = pts[i];
  const L = b.u - a.u || 1e-9;
  const t = (u - a.u) / L;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(-(b.z - a.z), b.x - a.x) };
}

function gateMesh(width, kind) {
  const g = new THREE.Group();
  const h = Math.max(5, width * 0.35);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, metalness: 0.2 });
  const bannerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const postGeo = new THREE.CylinderGeometry(0.18, 0.22, h, 10);
  postGeo.translate(0, h / 2, 0);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, postMat);
    p.position.z = (s * width) / 2;
    p.castShadow = true;
    g.add(p);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 140, 10, 1, true), beamMat);
    beam.position.set(0, 70, (s * width) / 2);
    g.add(beam);
  }
  const bannerGeo = new THREE.PlaneGeometry(width, 1.2);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const c = canvas.getContext('2d');
  if (kind === 'finish') {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) {
      c.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
      c.fillRect(i * 16, j * 16, 16, 16);
    }
  } else {
    c.fillStyle = '#e6262b';
    c.fillRect(0, 0, 512, 64);
    c.fillStyle = '#fff';
    c.font = 'italic 700 38px "Exo 2", sans-serif';
    c.textAlign = 'center';
    c.fillText(kind === 'start' ? 'START' : 'CHECKPOINT', 256, 46);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  bannerMat.map = tex;
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.rotation.y = Math.PI / 2;
  banner.position.y = h - 0.6;
  g.add(banner);
  g.userData = { beamMat, bannerMat, postMat };
  return g;
}

export class Race {
  constructor(track, world, mapKey, storage) {
    this.track = track;
    this.world = world;
    this.mapKey = mapKey;
    this.storage = storage;
    this.group = new THREE.Group();
    this.state = 'countdown';
    this.countdown = 3.2;
    this.time = 0;
    this.lap = 1;
    this.laps = track.laps || 1;
    this.next = 0;
    this.penalties = 0;
    this.splits = [];
    this.flash = null;
    this.flashT = 0;
    const boards = track.gates === 'boards';
    this.gates = track.checkpoints.map((cp, i) => {
      const last = i === track.checkpoints.length - 1;
      const g = boards ? boardGate(cp.w || 16, last ? 'finish' : 'cp', i) : gateMesh(cp.w || 16, last ? 'finish' : 'cp');
      const y = world.T.heightAt(cp.x, cp.z);
      g.position.set(cp.x, y, cp.z);
      g.rotation.y = cp.dir ?? 0;
      this.group.add(g);
      return g;
    });
    // progress along the route ("0/1165 m")
    this.path = racePath(track);
    this.length = this.path.length;
    this.distance = 0;
    this._pi = 0;
    if (boards) {
      this.arrows = routeArrows(this.path, world.T);
      this.group.add(this.arrows);
    }
    this.best = storage.bestTime(mapKey, track.name);
    this._colorGates();
  }

  _colorGates() {
    this.gates.forEach((g, i) => {
      const active = i === this.next;
      g.visible = this.state !== 'finished' && (i >= this.next || this.laps > this.lap);
      g.userData.beamMat.color.set(active ? 0xffd040 : 0x60a0ff);
      g.userData.beamMat.opacity = active ? 0.32 : g.userData.boards ? 0 : 0.1;
      if (g.userData.boards) g.userData.bannerMat.color.set(active ? 0xffe27a : 0xffffff);
    });
  }

  /** Distance driven along the route: nearest path point, searched near the last one. */
  _track(com) {
    const pts = this.path.pts;
    let best = this._pi, bd = Infinity;
    const lo = Math.max(0, this._pi - 30), hi = Math.min(pts.length - 1, this._pi + 60);
    for (let i = lo; i <= hi; i++) {
      const d = (pts[i].x - com.x) ** 2 + (pts[i].z - com.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd > 40 * 40) {
      // far off the route (respawn, shortcut): search everything
      for (let i = 0; i < pts.length; i++) {
        const d = (pts[i].x - com.x) ** 2 + (pts[i].z - com.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    this._pi = best;
    this.distance = Math.min(this.length, pts[best].u);
  }

  get penaltyTime() {
    return this.penalties * (this.track.restrictions?.penalty ?? 5);
  }

  respawned() {
    if (this.state === 'running') this.penalties++;
  }

  update(dt, sim) {
    if (this.flashT > 0) this.flashT -= dt;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = 'running';
      return { hold: true };
    }
    if (this.state !== 'running') {
      this.prev = { x: sim.com.x, z: sim.com.z };
      return { hold: false };
    }
    this.time += dt;
    this._track(sim.com);
    const cp = this.track.checkpoints[this.next];
    const prev = this.prev || { x: sim.com.x, z: sim.com.z };
    this.prev = { x: sim.com.x, z: sim.com.z };
    if (this._passed(cp, prev, sim.com)) {
      this.splits.push(this.time);
      this.next++;
      if (this.next >= this.track.checkpoints.length) {
        if (this.lap >= this.laps) {
          this.state = 'finished';
          this.distance = this.length;
          this.final = this.time + this.penaltyTime;
          this.newBest = this.storage.setBestTime(this.mapKey, this.track.name, this.final);
          this.best = this.storage.bestTime(this.mapKey, this.track.name);
          this._colorGates();
          return { finished: true };
        }
        this.lap++;
        this.next = 0;
        this.setFlash(`Lap ${this.lap} / ${this.laps}`);
      } else {
        this.setFlash(`Checkpoint ${this.next} / ${this.track.checkpoints.length}`);
      }
      this._colorGates();
      return { checkpoint: true };
    }
    return {};
  }

  /** Passed if the car crossed the gate line within its width, or is very close to its centre. */
  _passed(cp, a, b) {
    const w = (cp.w || 16) / 2 + 1.5;
    const dx = b.x - cp.x, dz = b.z - cp.z;
    if (dx * dx + dz * dz < 8 * 8) return true;
    const dir = cp.dir ?? 0;
    // gate line runs along the local z axis (perpendicular to the track direction)
    const fx = Math.cos(dir), fz = -Math.sin(dir);
    const sa = (a.x - cp.x) * fx + (a.z - cp.z) * fz;
    const sb = (b.x - cp.x) * fx + (b.z - cp.z) * fz;
    if (sa > 0 || sb < 0) return false; // must cross from behind to in front
    const t = sa / (sa - sb || 1e-9);
    const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
    const lateral = Math.hypot(px - cp.x, pz - cp.z);
    return lateral <= w;
  }

  setFlash(text) {
    this.flash = text;
    this.flashT = 1.6;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material?.map) o.material.map.dispose();
    });
  }
}

/** Track length: along its route (Default map), else along its checkpoints from the start. */
export function trackLength(track) {
  if (track.route?.length > 1) return racePath(track).length;
  let L = 0;
  let p = track.start;
  for (const c of track.checkpoints) {
    L += Math.hypot(c.x - p.x, c.z - p.z);
    p = c;
  }
  return L * (track.laps || 1);
}
