// Vegetation: leaf-card trees (alpha-tested clusters with volumetric normals), conifers
// with drooping needle branch cards, low-poly far LODs, and camera-following grass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedTextures } from '../render/textures.js';
import { mulberry32, hash2, smoothstep } from './noise.js';
import { propUniforms, prep } from './props.js';

const WIND = /* glsl */ `
#ifdef USE_INSTANCING
  vec3 ipos = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
  float hgt = max(0.0, transformed.y - 1.2);
  float sway = sin(uTime * 1.4 + ipos.x * 0.05 + ipos.z * 0.07) * 0.035 * hgt;
  float flutter = sin(uTime * 6.0 + transformed.x * 3.0 + transformed.z * 2.0 + ipos.x) * 0.012 * hgt;
  transformed.x += sway + flutter;
  transformed.z += sway * 0.6 - flutter;
#endif`;

function windMaterial(params, key, noFlip = false) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = propUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND}`);
    // cards carry volumetric normals: don't flip them on back faces
    if (noFlip) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  m.customProgramCacheKey = () => key;
  return m;
}

function depthMaterial(map) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  d.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = propUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND}`);
  };
  return d;
}

/** A card (quad) with uv, normals bent toward `outward` for soft volumetric shading. */
function card(corners, outwardFn, colorFn) {
  const [a, b, c, d] = corners;
  const pos = [...a, ...b, ...c, ...a, ...c, ...d];
  const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const n = [], col = [];
  for (let i = 0; i < 6; i++) {
    const p = pos.slice(i * 3, i * 3 + 3);
    const o = outwardFn(p);
    n.push(...o);
    col.push(...colorFn(p));
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function solid(g, color) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal'].includes(k)) n.deleteAttribute(k);
  const p = n.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : color;
    c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2];
  }
  n.setAttribute('color', new THREE.BufferAttribute(c, 3));
  n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
  return n;
}

function cylinderBetween(a, b, r0, r1, seg, color) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return solid(g, color);
}

const BARK = [0.13, 0.095, 0.065];

function broadleafGeometry(seed) {
  const rnd = mulberry32(seed);
  const trunk = [];
  const leaves = [];
  const crown = new THREE.Vector3(0, 4.6, 0);
  const R = new THREE.Vector3(2.3, 1.9, 2.3);
  trunk.push(cylinderBetween(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 3.6, 0), 0.24, 0.14, 7, BARK));
  // branches toward the crown
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    const end = new THREE.Vector3(Math.cos(a) * R.x * 0.7, crown.y + (rnd() - 0.3) * 1.2, Math.sin(a) * R.z * 0.7);
    trunk.push(cylinderBetween(new THREE.Vector3(0, 2.4 + rnd() * 0.8, 0), end, 0.09, 0.03, 5, BARK));
  }
  // dark inner volume so the crown never looks hollow
  const inner = new THREE.IcosahedronGeometry(1.5, 1);
  inner.scale(1.15, 0.95, 1.15);
  inner.translate(crown.x, crown.y, crown.z);
  trunk.push(solid(inner, [0.035, 0.06, 0.02]));
  // leaf clusters on the crown shell
  const out = (p) => {
    const v = new THREE.Vector3(p[0] - crown.x, (p[1] - crown.y) * 1.2, p[2] - crown.z).normalize();
    return [v.x, v.y, v.z];
  };
  const shade = (p) => {
    const t = THREE.MathUtils.clamp((p[1] - (crown.y - R.y)) / (2 * R.y), 0, 1);
    const k = 0.55 + 0.45 * t;
    return [k, k, k];
  };
  const n = 22;
  for (let i = 0; i < n; i++) {
    // points on a jittered ellipsoid shell
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const rr = 0.65 + rnd() * 0.35;
    const c = new THREE.Vector3(Math.cos(th) * s * R.x * rr, u * R.y * rr * 0.9, Math.sin(th) * s * R.z * rr).add(crown);
    const size = 1.7 + rnd() * 0.9;
    // three crossed cards per cluster
    for (let k = 0; k < 3; k++) {
      const e = new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
      const q = new THREE.Quaternion().setFromEuler(e);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        const v = new THREE.Vector3(x * size / 2, y * size / 2, 0).applyQuaternion(q).add(c);
        return [v.x, v.y, v.z];
      });
      leaves.push(card(corners, out, shade));
    }
  }
  return { trunk: mergeGeometries(trunk), foliage: mergeGeometries(leaves) };
}

function coniferGeometry(seed) {
  const rnd = mulberry32(seed);
  const trunk = [];
  const cards = [];
  const H = 8.2;
  trunk.push(cylinderBetween(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H, 0), 0.2, 0.04, 6, BARK));
  const core = new THREE.ConeGeometry(1.25, H - 1.6, 8, 1, true);
  core.translate(0, 1.6 + (H - 1.6) / 2, 0);
  trunk.push(solid(core, [0.02, 0.045, 0.025]));
  const tiers = 9;
  for (let t = 0; t < tiers; t++) {
    const y = 1.5 + (t / tiers) * (H - 2.2);
    const L = 2.3 * (1 - t / tiers) + 0.5;
    const k = Math.max(4, Math.round(7 - t * 0.4));
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2 + rnd() * 0.5 + t;
      const droop = -0.35 - rnd() * 0.2;
      const dir = new THREE.Vector3(Math.cos(a), droop, Math.sin(a)).normalize();
      const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(L * 0.42);
      const base = new THREE.Vector3(0, y, 0);
      const tip = base.clone().addScaledVector(dir, L);
      // card spans from the trunk to the tip; uv.x along the branch
      const corners = [
        base.clone().sub(side).add(new THREE.Vector3(0, 0.05, 0)),
        tip.clone().sub(side),
        tip.clone().add(side),
        base.clone().add(side).add(new THREE.Vector3(0, 0.05, 0)),
      ].map((v) => [v.x, v.y, v.z]);
      // rotate card so it lies roughly horizontal (uv: u along branch, v across)
      const g = card([corners[0], corners[1], corners[2], corners[3]], (p) => {
        const v = new THREE.Vector3(p[0], 0.6, p[2]).normalize();
        return [v.x, v.y, v.z];
      }, (p) => {
        const k2 = 0.55 + 0.45 * Math.min(1, Math.hypot(p[0], p[2]) / 2);
        return [k2, k2, k2];
      });
      // remap uvs: u along branch is corner order 0->1, v across 0->3
      const uv = g.attributes.uv;
      const order = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
      order.forEach(([u, v], i) => uv.setXY(i, u, v));
      cards.push(g);
    }
  }
  return { trunk: mergeGeometries(trunk), foliage: mergeGeometries(cards) };
}

function shrubGeometry(seed) {
  const rnd = mulberry32(seed);
  const cards = [];
  const c0 = new THREE.Vector3(0, 0.45, 0);
  for (let i = 0; i < 7; i++) {
    const c = c0.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.7, (rnd() - 0.3) * 0.4, (rnd() - 0.5) * 0.7));
    const size = 0.8 + rnd() * 0.4;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI));
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      const v = new THREE.Vector3(x * size / 2, y * size / 2, 0).applyQuaternion(q).add(c);
      return [v.x, Math.max(0, v.y), v.z];
    });
    cards.push(card(corners, (p) => {
      const v = new THREE.Vector3(p[0], p[1] - 0.2, p[2]).normalize();
      return [v.x, v.y, v.z];
    }, () => [1.3, 1.05, 0.55]));
  }
  return { trunk: null, foliage: mergeGeometries(cards) };
}

function lowTree(type) {
  if (type === 0) {
    const c = new THREE.ConeGeometry(1.9, 7.2, 6, 1);
    c.translate(0, 4.4, 0);
    return solid(c, [0.028, 0.06, 0.032]);
  }
  if (type === 1) {
    const s = new THREE.IcosahedronGeometry(2.5, 1);
    s.scale(1, 0.85, 1);
    s.translate(0, 4.6, 0);
    const t = new THREE.CylinderGeometry(0.15, 0.22, 3, 5);
    t.translate(0, 1.4, 0);
    return mergeGeometries([solid(s, [0.05, 0.095, 0.028]), solid(t, BARK)]);
  }
  const s = new THREE.IcosahedronGeometry(0.7, 0);
  s.translate(0, 0.35, 0);
  return solid(s, [0.14, 0.12, 0.06]);
}

export class TreeSystem {
  constructor(trees, register = () => {}, cellSize = 320) {
    this.group = new THREE.Group();
    this.cells = [];
    if (!trees.length) return;
    const tex = sharedTextures();
    // two variants per type for variety
    const variants = [
      [coniferGeometry(11), coniferGeometry(12)],
      [broadleafGeometry(21), broadleafGeometry(22)],
      [shrubGeometry(31), shrubGeometry(32)],
    ];
    const low = [0, 1, 2].map(lowTree);
    const trunkMat = windMaterial({ vertexColors: true, roughness: 0.9 }, 'dcb-trunk');
    const leafMat = windMaterial({ map: tex.leaf, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.78, alphaToCoverage: true }, 'dcb-leaf', true);
    const needleMat = windMaterial({ map: tex.needle, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, alphaToCoverage: true }, 'dcb-needle', true);
    const lowMat = windMaterial({ vertexColors: true, roughness: 0.9, flatShading: false }, 'dcb-lowtree');
    for (const m of [trunkMat, leafMat, needleMat, lowMat]) register(m);
    const leafDepth = depthMaterial(tex.leaf);
    const needleDepth = depthMaterial(tex.needle);
    this.materials = [trunkMat, leafMat, needleMat, lowMat];

    const buckets = new Map();
    for (const t of trees) {
      const key = `${Math.floor(t.x / cellSize)},${Math.floor(t.z / cellSize)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (im, list) => {
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        s.setScalar(t.s);
        s.y *= 0.9 + t.tint * 0.25;
        p.set(t.x, t.y - 0.05, t.z);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
        const k = 0.8 + t.tint * 0.4;
        col.setRGB(k * (0.92 + t.tint * 0.16), k, k * (1.08 - t.tint * 0.25));
        im.setColorAt(i, col);
      });
      im.computeBoundingSphere();
    };
    for (const list of buckets.values()) {
      const cell = { hi: [], lo: [], cx: 0, cz: 0 };
      for (const t of list) { cell.cx += t.x; cell.cz += t.z; }
      cell.cx /= list.length;
      cell.cz /= list.length;
      for (let type = 0; type < 3; type++) {
        const ofType = list.filter((t) => t.type === type);
        if (!ofType.length) continue;
        for (let v = 0; v < 2; v++) {
          const sub = ofType.filter((t, i) => i % 2 === v);
          if (!sub.length) continue;
          const geo = variants[type][v];
          if (geo.trunk) {
            const im = new THREE.InstancedMesh(geo.trunk, trunkMat, sub.length);
            place(im, sub);
            im.castShadow = true;
            im.receiveShadow = true;
            cell.hi.push(im);
            this.group.add(im);
          }
          const fm = new THREE.InstancedMesh(geo.foliage, type === 0 ? needleMat : leafMat, sub.length);
          place(fm, sub);
          fm.castShadow = type !== 2;
          fm.receiveShadow = true;
          fm.customDepthMaterial = type === 0 ? needleDepth : leafDepth;
          cell.hi.push(fm);
          this.group.add(fm);
        }
        const lm = new THREE.InstancedMesh(low[type], lowMat, ofType.length);
        place(lm, ofType);
        lm.castShadow = false;
        lm.receiveShadow = true;
        cell.lo.push(lm);
        this.group.add(lm);
      }
      this.cells.push(cell);
    }
  }

  update(camPos, quality = 1) {
    const near = 300 * quality, far = 1700 * quality;
    for (const c of this.cells) {
      const d = Math.hypot(camPos.x - c.cx, camPos.z - c.cz);
      const showHi = d < near;
      const showLo = !showHi && d < far;
      for (const m of c.hi) m.visible = showHi;
      for (const m of c.lo) m.visible = showLo;
    }
  }
}

// ---------------- grass ----------------
export class GrassSystem {
  constructor(T, register = () => {}, opts = {}) {
    this.T = T;
    this.radius = opts.radius ?? 46;
    this.spacing = opts.spacing ?? 0.75;
    const tex = sharedTextures();
    // clump: three crossed quads
    const parts = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.PlaneGeometry(1.1, 0.55, 1, 2);
      g.translate(0, 0.275, 0);
      g.rotateY((k / 3) * Math.PI);
      parts.push(g);
    }
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    // normals pointing up (grass lit like the ground), colour darker at the base
    const n = geo.attributes.normal, pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < n.count; i++) {
      n.setXYZ(i, 0, 1, 0);
      const t = pos.getY(i) / 0.55;
      const k = 0.45 + 0.55 * t;
      col.set([k, k, k], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.max = Math.ceil(((Math.PI * this.radius * this.radius) / (this.spacing * this.spacing)) * 1.1);
    const mat = new THREE.MeshStandardMaterial({ map: tex.grass, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, alphaToCoverage: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = propUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 gp = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
  float t = transformed.y / 0.55;
  float w = sin(uTime * 2.1 + gp.x * 0.35 + gp.z * 0.27) * 0.5 + sin(uTime * 3.7 + gp.x * 0.9) * 0.25;
  transformed.x += w * 0.12 * t * t;
  transformed.z += w * 0.07 * t * t;
#endif`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    mat.customProgramCacheKey = () => 'dcb-grass';
    register(mat);
    this.material = mat;
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.last = null;
    this.enabled = true;
  }

  update(camPos, force = false) {
    if (!this.enabled) {
      this.mesh.count = 0;
      return;
    }
    if (!force && this.last && Math.hypot(camPos.x - this.last.x, camPos.z - this.last.z) < 4 && Math.abs(camPos.y - this.last.y) < 20) return;
    this.last = { x: camPos.x, y: camPos.y, z: camPos.z };
    const T = this.T;
    const groundH = T.heightAt(camPos.x, camPos.z);
    if (camPos.y - groundH > 60) {
      this.mesh.count = 0;
      return;
    }
    const sp = this.spacing, R = this.radius;
    const i0 = Math.floor((camPos.x - R) / sp), i1 = Math.ceil((camPos.x + R) / sp);
    const j0 = Math.floor((camPos.z - R) / sp), j1 = Math.ceil((camPos.z + R) / sp);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const N = T.N;
    let n = 0;
    for (let j = j0; j <= j1 && n < this.max; j++) {
      for (let i = i0; i <= i1 && n < this.max; i++) {
        const h1 = hash2(i, j, 7), h2 = hash2(i, j, 13), h3 = hash2(i, j, 29);
        const x = (i + h1) * sp, z = (j + h2) * sp;
        const d = Math.hypot(x - camPos.x, z - camPos.z);
        if (d > R) continue;
        const gi = Math.round((x + T.half) / T.cell), gj = Math.round((z + T.half) / T.cell);
        if (gi < 0 || gj < 0 || gi >= N || gj >= N) continue;
        const k = gj * N + gi;
        if (T.roadEdge[k] < 0.8) continue;
        const sp4 = T.splat;
        const grass = 1 - (sp4[k * 4] + sp4[k * 4 + 1] + sp4[k * 4 + 2] + sp4[k * 4 + 3]) / 255;
        if (grass < 0.55 || h3 > grass * 1.1) continue;
        const y = T.heightAt(x, z);
        const fade = 1 - smoothstep(R * 0.65, R, d);
        q.setFromAxisAngle(up, h3 * Math.PI * 2);
        const sc = (0.7 + h1 * 0.6) * fade * (0.6 + 0.4 * grass);
        s.set(sc * (0.9 + h2 * 0.3), sc * (0.8 + h3 * 0.6), sc);
        p.set(x, y - 0.02, z);
        m4.compose(p, q, s);
        this.mesh.setMatrixAt(n, m4);
        // match the terrain's grass tint (dry patches lighter / yellower)
        const dry = smoothstep(0.55, 0.85, hash2(Math.floor(x / 23), Math.floor(z / 23), 3));
        col.setRGB(0.13 + 0.09 * dry + h2 * 0.03, 0.19 + 0.03 * dry + h1 * 0.04, 0.05 + 0.02 * dry);
        this.mesh.setColorAt(n, col);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export { prep };
