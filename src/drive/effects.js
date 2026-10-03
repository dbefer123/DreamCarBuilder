// Tire smoke / dust particles, sparks and skid marks.
import * as THREE from 'three';
import { sharedTextures } from '../render/textures.js';

const PARTICLE_VS = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = /* glsl */ `
uniform sampler2D tSprite;
uniform float uLight;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(tSprite, gl_PointCoord);
  gl_FragColor = vec4(vColor * uLight, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

class ParticlePool {
  constructor(max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aColor]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aColor', this.aColor);
    this.color = new Float32Array(max * 3);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: { tSprite: { value: sharedTextures().soft }, uScale: { value: 600 }, uLight: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.cursor = 0;
  }

  emit(x, y, z, vx, vy, vz, size, grow, alpha, life, r, gg, b, drag = 1.5, gravity = -0.2) {
    let i;
    if (this.n < this.max) i = this.n++;
    else {
      i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
    }
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = 0;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.alpha0[i] = alpha;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
    this.color.set([r, gg, b], i * 3);
  }

  update(dt) {
    const P = this.aPos.array, S = this.aSize.array, A = this.aAlpha.array, C = this.aColor.array;
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) {
        A[i] = 0;
        S[i] = 0;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      P[i * 3] = this.pos[i * 3];
      P[i * 3 + 1] = this.pos[i * 3 + 1];
      P[i * 3 + 2] = this.pos[i * 3 + 2];
      S[i] = this.size0[i] + this.grow[i] * this.life[i];
      A[i] = this.alpha0[i] * (1 - t) * Math.min(1, t * 8);
      C[i * 3] = this.color[i * 3];
      C[i * 3 + 1] = this.color[i * 3 + 1];
      C[i * 3 + 2] = this.color[i * 3 + 2];
    }
    this.points.geometry.setDrawRange(0, this.n);
    for (const a of [this.aPos, this.aSize, this.aAlpha, this.aColor]) a.needsUpdate = true;
  }

  clear() {
    this.n = 0;
    this.cursor = 0;
  }
}

class SkidMarks {
  constructor(max = 3000) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 6 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(max * 6 * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.next = 0;
    this.count = 0;
    this.last = new Map();
  }

  add(key, x, y, z, nx, nz, width, alpha, r = 0.02, gg = 0.02, b = 0.02) {
    const prev = this.last.get(key);
    this.last.set(key, { x, y, z, nx, nz, width, alpha });
    if (!prev) return;
    const d = Math.hypot(x - prev.x, z - prev.z);
    if (d < 0.05 || d > 3) return;
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    const hw0 = prev.width / 2, hw1 = width / 2;
    const v = [
      [prev.x - prev.nx * hw0, prev.y, prev.z - prev.nz * hw0],
      [prev.x + prev.nx * hw0, prev.y, prev.z + prev.nz * hw0],
      [x + nx * hw1, y, z + nz * hw1],
      [x - nx * hw1, y, z - nz * hw1],
    ];
    const order = [0, 1, 2, 0, 2, 3];
    const P = this.pos.array, C = this.col.array;
    order.forEach((k, j) => {
      P.set(v[k], (i * 6 + j) * 3);
      const a = k < 2 ? prev.alpha : alpha;
      C.set([r, gg, b, a], (i * 6 + j) * 4);
    });
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.count * 6);
  }

  break(key) {
    this.last.delete(key);
  }

  clear() {
    this.count = 0;
    this.next = 0;
    this.last.clear();
    this.mesh.geometry.setDrawRange(0, 0);
  }
}

export class Effects {
  constructor(scene) {
    this.smoke = new ParticlePool(900, false);
    this.sparks = new ParticlePool(300, true);
    this.skids = new SkidMarks(3000);
    scene.add(this.smoke.points, this.sparks.points, this.skids.mesh);
    this.acc = 0;
  }

  setLight(k) {
    this.smoke.material.uniforms.uLight.value = k;
  }

  setViewport(h) {
    this.smoke.material.uniforms.uScale.value = h * 0.9;
    this.sparks.material.uniforms.uScale.value = h * 0.9;
  }

  update(dt, sim, world) {
    for (const w of sim.wheels) {
      const key = w.partId;
      if (!w.contact) {
        this.skids.break(key);
        continue;
      }
      const surf = w.surface;
      const speed = Math.abs(w.vLong);
      const slip = w.slipVel;
      // skid marks on hard surfaces
      if (surf.skid && slip > 2.5) {
        const nx = w.nx, nz = w.nz;
        const nl = Math.hypot(nx, nz) || 1;
        const a = Math.min(0.75, (slip - 2.5) * 0.12);
        this.skids.add(key, w.cpx, w.cpy + 0.02, w.cpz, nx / nl, nz / nl, w.W * 0.9, a);
      } else if (!surf.skid && (slip > 1.5 || speed > 6) && surf.dust > 0.2) {
        const nx = w.nx, nz = w.nz;
        const nl = Math.hypot(nx, nz) || 1;
        this.skids.add(key, w.cpx, w.cpy + 0.02, w.cpz, nx / nl, nz / nl, w.W, 0.18 * surf.dust, 0.09, 0.07, 0.05);
      } else {
        this.skids.break(key);
      }
      // smoke / dust
      const rate = surf.skid ? Math.max(0, slip - 4) * 1.2 : surf.dust * (speed * 0.35 + slip * 1.5);
      let count = rate * dt;
      while (count > 0) {
        if (Math.random() < count) {
          const v = sim.vel;
          if (surf.skid) {
            this.smoke.emit(w.cpx + (Math.random() - 0.5) * 0.3, w.cpy + 0.15, w.cpz + (Math.random() - 0.5) * 0.3,
              v.x * 0.2 + (Math.random() - 0.5), 0.6 + Math.random() * 0.6, v.z * 0.2 + (Math.random() - 0.5),
              1.4, 3.2, 0.42, 2.6 + Math.random(), 0.82, 0.82, 0.84, 1.2, 0.15);
          } else {
            const c = surf.name === 'grass' ? [0.32, 0.29, 0.2] : surf.name === 'salt' ? [0.85, 0.85, 0.82] : [0.55, 0.43, 0.3];
            this.smoke.emit(w.cpx, w.cpy + 0.2, w.cpz,
              v.x * 0.3 + (Math.random() - 0.5) * 1.5, 0.5 + Math.random(), v.z * 0.3 + (Math.random() - 0.5) * 1.5,
              1.2, 2.6, 0.35 * surf.dust + 0.05, 2 + Math.random() * 1.5, c[0], c[1], c[2], 1.6, -0.3);
          }
        }
        count -= 1;
      }
    }
    // sparks from scraping chassis nodes
    for (let i = 0; i < sim.n; i++) {
      const s = sim.scrape[i];
      if (s > 4 && Math.random() < 0.6) {
        for (let k = 0; k < 2; k++) {
          this.sparks.emit(sim.px[i], sim.py[i], sim.pz[i],
            sim.vx[i] * 0.6 + (Math.random() - 0.5) * 3, Math.random() * 3, sim.vz[i] * 0.6 + (Math.random() - 0.5) * 3,
            0.12, 0, 1, 0.25 + Math.random() * 0.3, 6, 2.6, 0.6, 0.5, -9);
        }
      }
    }
    // jet exhaust smoke
    for (const j of sim.jets) {
      if (j.on > 0.05 && Math.random() < 0.6) {
        const dx = sim.px[j.a] - sim.px[j.b], dy = sim.py[j.a] - sim.py[j.b], dz = sim.pz[j.a] - sim.pz[j.b];
        const l = Math.hypot(dx, dy, dz) || 1;
        this.smoke.emit(sim.px[j.a] + (dx / l) * 1.2, sim.py[j.a] + (dy / l) * 1.2, sim.pz[j.a] + (dz / l) * 1.2,
          (dx / l) * 8, (dy / l) * 8 + 0.5, (dz / l) * 8, 0.8, 4, 0.25, 1.8, 0.5, 0.5, 0.52, 1.5, 0.3);
      }
    }
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  clear() {
    this.smoke.clear();
    this.sparks.clear();
    this.skids.clear();
  }

  dispose(scene) {
    scene.remove(this.smoke.points, this.sparks.points, this.skids.mesh);
  }
}
