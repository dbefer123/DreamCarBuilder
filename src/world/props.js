// Instanced world props: buildings (procedural facades), trees, rocks, traffic lights,
// street lamps, ramps, barrier boxes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2, mulberry32 } from './noise.js';

export const propUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

// ---------------- buildings ----------------
const FACADE = /* glsl */ `
{
  vec3 wn = normalize(vBWorldN);
  float style = vBInfo.x;
  float seed = vBInfo.y;
  float baseY = vBInfo.z;
  float bh = vBInfo.w;
  float y = vBWorld.y - baseY;
  float isRoof = step(0.5, wn.y);
  float u = abs(wn.x) > 0.5 ? (vBWorld.z - (vBBox.y - vBBox.w * 0.5)) : (vBWorld.x - (vBBox.x - vBBox.z * 0.5));
  float faceW = abs(wn.x) > 0.5 ? vBBox.w : vBBox.z;
  float floorH = style > 2.5 ? 6.0 : 3.4;
  float bayW = style < 0.5 ? 3.6 : style < 1.5 ? 3.0 : style < 2.5 ? 1.8 : 6.0;
  float nb = max(1.0, floor(faceW / bayW));
  float bw = faceW / nb;
  float fu = fract(u / bw);
  float fv = fract(y / floorH);
  float bayId = floor(u / bw);
  float floorId = floor(y / floorH);
  float rnd = fract(sin(dot(vec3(bayId, floorId, seed + wn.x * 3.0 + wn.z * 7.0), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  vec3 wall = diffuseColor.rgb;
  float win = 0.0;
  vec3 glass = vec3(0.02, 0.03, 0.04);
  if (style < 0.5) {
    win = step(0.25, fu) * step(fu, 0.75) * step(0.3, fv) * step(fv, 0.78);
    wall *= 0.92 + 0.08 * step(0.92, fv);
  } else if (style < 1.5) {
    win = step(0.08, fu) * step(fu, 0.92) * step(0.32, fv) * step(fv, 0.85);
    glass = vec3(0.025, 0.035, 0.05);
  } else if (style < 2.5) {
    win = step(0.025, fu) * step(fu, 0.975) * step(0.12, fv) * step(fv, 0.97);
    glass = mix(vec3(0.02, 0.035, 0.05), wall * 0.35, 0.55) * (0.8 + 0.4 * rnd);
    wall = mix(vec3(0.12, 0.13, 0.14), wall * 0.5, 0.4);
  } else if (style < 3.5) {
    // corrugated metal sheds
    wall *= 0.85 + 0.15 * smoothstep(0.3, 0.7, fract(u / 0.25));
    win = step(0.45, fu) * step(fu, 0.55) * step(0.55, fv) * step(fv, 0.75) * step(floorId, 0.5);
    float door = step(abs(u - faceW * 0.5), faceW * 0.18) * step(y, 5.0);
    wall = mix(wall, wall * 0.6, door);
  } else {
    // grandstand: seat rows
    wall = mix(wall, vec3(0.45, 0.07, 0.05), step(0.5, fract(y / 0.8)) * step(1.0, y));
  }
  // ground floor shops
  float ground = step(y, floorH) * step(0.5, style) * step(style, 2.5);
  win = max(win, ground * step(0.06, fu) * step(fu, 0.94) * step(0.1, fv) * step(fv, 0.9));
  // parapet band
  float top = step(bh - 0.9, y);
  win *= 1.0 - top;
  win *= 1.0 - isRoof;
  vec3 roofCol = mix(vec3(0.16, 0.16, 0.16), wall * 0.6, 0.3);
  vec3 c = mix(wall, glass * (0.7 + 0.6 * rnd), win);
  c = mix(c, roofCol, isRoof);
  diffuseColor.rgb = c;
  bRough = mix(mix(0.85, 0.08, win), 0.95, isRoof);
  bMetal = win * 0.0;
  float lit = step(0.62, rnd) * win * uNight;
  bEmit = vec3(1.0, 0.72, 0.42) * lit * (0.6 + 0.6 * fract(rnd * 7.0)) * 1.6;
  bEmit += ground * win * uNight * vec3(1.0, 0.85, 0.6) * 0.8;
}
`;

function makeBuildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, envMapIntensity: 2.6 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = propUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aBox;
attribute vec4 aInfo;
varying vec3 vBWorld;
varying vec3 vBWorldN;
varying vec4 vBBox;
varying vec4 vBInfo;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 bwp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
vBWorld = bwp.xyz;
vBWorldN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
vBBox = aBox;
vBInfo = aInfo;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBWorld;
varying vec3 vBWorldN;
varying vec4 vBBox;
varying vec4 vBInfo;
uniform float uNight;
float bRough; float bMetal; vec3 bEmit;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bEmit;');
  };
  m.customProgramCacheKey = () => 'dcb-building';
  return m;
}

export function buildBuildings(buildings) {
  if (!buildings.length) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const n = buildings.length;
  const box = new Float32Array(n * 4);
  const info = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(geo, makeBuildingMaterial(), n);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  buildings.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z);
    mesh.setMatrixAt(i, m4);
    col.set(b.color || '#bbbbbb');
    mesh.setColorAt(i, col);
    box.set([b.x, b.z, b.w, b.d], i * 4);
    info.set([b.style, (b.seed % 1000) / 10, b.y, b.h], i * 4);
  });
  geo.setAttribute('aBox', new THREE.InstancedBufferAttribute(box, 4));
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------- trees ----------------
function colorize(geo, fn) {
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const [r, g, b] = fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// ---------------- rocks ----------------
export function buildRocks(rocks, base = [0.34, 0.19, 0.12]) {
  const group = new THREE.Group();
  if (!rocks.length) return group;
  const noise = new Noise2(5);
  const variants = [];
  for (let v = 0; v < 4; v++) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let d = 1 + 0.32 * noise.fbm(x * 1.2 + v * 7, z * 1.2 + y * 1.4, 3) + 0.08 * noise.noise(x * 6, y * 6 + z * 5);
      if (y < -0.2) d *= 0.9;
      // flatten the top into a mesa-like cap for some
      let ny = y * d;
      if (v % 2 === 0 && ny > 0.55) ny = 0.55 + (ny - 0.55) * 0.25;
      p.setXYZ(i, x * d, ny, z * d);
    }
    g.computeVertexNormals();
    colorize(g, (x, y) => {
      const band = 0.85 + 0.15 * Math.sin(y * 9 + x * 2);
      return [base[0] * band, base[1] * band, base[2] * band];
    });
    variants.push(g);
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  for (let v = 0; v < 4; v++) {
    const sub = rocks.filter((r, i) => i % 4 === v);
    if (!sub.length) continue;
    const im = new THREE.InstancedMesh(variants[v], mat, sub.length);
    sub.forEach((r, i) => {
      e.set((r.seed - 0.5) * 0.3, r.rot, (r.seed - 0.5) * 0.2);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.sx, r.sy, r.sz));
      im.setMatrixAt(i, m4);
      const k = r.type === 1 ? 0.75 : 0.85 + r.seed * 0.3;
      col.setRGB(k, k * (0.95 + r.seed * 0.1), k);
      im.setColorAt(i, col);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

// ---------------- traffic lights + lamps ----------------
/** Non-indexed geometry with only position/normal/color, ready for merging. */
export function prep(g, color) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(k)) n.deleteAttribute(k);
  if (color) colorize(n, typeof color === 'function' ? color : () => color);
  return n;
}

function trafficLightGeometry() {
  const metal = [0.22, 0.23, 0.24];
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.11, 0.14, 6.2, 8);
  pole.translate(0, 3.1, 0);
  parts.push(prep(pole, metal));
  const arm = new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6);
  arm.rotateZ(Math.PI / 2);
  arm.translate(2.5, 5.95, 0);
  parts.push(prep(arm, metal));
  for (const x of [2.6, 4.6]) {
    const head = new THREE.BoxGeometry(0.36, 1.05, 0.32);
    head.translate(x, 5.25, 0);
    parts.push(prep(head, [0.05, 0.05, 0.05]));
  }
  return mergeGeometries(parts);
}

function trafficLampGeometry() {
  const parts = [];
  for (const x of [2.6, 4.6]) {
    [[5.58, [1.0, 0.08, 0.04]], [5.25, [1.0, 0.55, 0.05]], [4.92, [0.1, 1.0, 0.35]]].forEach(([y, c], k) => {
      const d = new THREE.CircleGeometry(0.12, 12);
      d.rotateY(Math.PI / 2);
      d.translate(x + 0.185, y, 0);
      const d2 = d.clone();
      d2.rotateY(Math.PI);
      d2.translate(2 * x, 0, 0);
      parts.push(prep(d, c.map((v) => v * (k === 0 ? 1 : 0.15))));
      parts.push(prep(d2, c.map((v) => v * (k === 2 ? 1 : 0.15))));
    });
  }
  return mergeGeometries(parts);
}

function instanced(geo, mat, items, place) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const m4 = new THREE.Matrix4();
  items.forEach((it, i) => {
    place(it, m4);
    im.setMatrixAt(i, m4);
  });
  im.computeBoundingSphere();
  return im;
}

export function buildTrafficLights(lights) {
  const group = new THREE.Group();
  if (!lights.length) return group;
  const place = (it, m4) => m4.makeRotationY(it.rot).setPosition(it.x, it.y, it.z);
  const body = instanced(trafficLightGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.5 }), lights, place);
  body.castShadow = true;
  body.receiveShadow = true;
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  lampMat.color.setScalar(14);
  const lamps = instanced(trafficLampGeometry(), lampMat, lights, place);
  group.add(body, lamps);
  return group;
}

export function buildStreetLamps(lamps) {
  const group = new THREE.Group();
  if (!lamps.length) return group;
  const metal = [0.35, 0.36, 0.37];
  const pole = new THREE.CylinderGeometry(0.08, 0.12, 8, 8);
  pole.translate(0, 4, 0);
  const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6);
  arm.rotateX(Math.PI / 2);
  arm.translate(0, 7.9, 1.1);
  const head = new THREE.BoxGeometry(0.35, 0.14, 0.7);
  head.translate(0, 7.85, 2.2);
  const geo = mergeGeometries([pole, arm, head].map((g) => prep(g, metal)));
  const place = (it, m4) => m4.makeRotationY(it.rot).setPosition(it.x, it.y, it.z);
  const body = instanced(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }), lamps, place);
  body.castShadow = true;
  const bulb = new THREE.PlaneGeometry(0.3, 0.6);
  bulb.rotateX(Math.PI / 2);
  bulb.translate(0, 7.77, 2.2);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, side: THREE.DoubleSide });
  bulbMat.userData.nightColor = new THREE.Color(12, 8.5, 5.5);
  const bulbs = instanced(bulb, bulbMat, lamps, place);
  group.add(body, bulbs);
  group.userData.bulbMat = bulbMat;
  return group;
}

// ---------------- ramps + boxes ----------------
export function buildRamps(ramps) {
  const group = new THREE.Group();
  if (!ramps.length) return group;
  const geos = [];
  for (const r of ramps) {
    const L = r.length / 2, W = r.width / 2;
    const b = -0.5;
    const t0 = r.h0, t1 = r.h1;
    // 8 corners: bottom then top (local x along length)
    const v = [
      [-L, b, -W], [L, b, -W], [L, b, W], [-L, b, W],
      [-L, t0, -W], [L, t1, -W], [L, t1, W], [-L, t0, W],
    ];
    const faces = [[4, 7, 6, 5], [0, 1, 2, 3], [0, 4, 5, 1], [2, 6, 7, 3], [1, 5, 6, 2], [3, 7, 4, 0]];
    const pos = [];
    for (const f of faces) {
      const [a, bb, c, d] = f.map((i) => v[i]);
      pos.push(...a, ...bb, ...c, ...a, ...c, ...d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const top = Math.max(t0, t1);
    colorize(g, (x, y, z) => {
      if (y > Math.min(t0, t1) - 0.01 && Math.abs(z) < W - 0.01 && Math.abs(x) < L - 0.01) return [0.42, 0.41, 0.39];
      const stripe = Math.floor((x + z + y) / 0.6) % 2 === 0;
      return stripe ? [0.7, 0.5, 0.05] : [0.06, 0.06, 0.06];
    });
    g.rotateY(r.angle);
    g.translate(r.x, r.base, r.z);
    void top;
    geos.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

export function buildBoxes(boxes) {
  const group = new THREE.Group();
  if (!boxes.length) return group;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), boxes.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  boxes.forEach((b, i) => {
    m4.makeScale(b.w, b.h + 0.3, b.d).setPosition(b.x, b.y, b.z);
    im.setMatrixAt(i, m4);
    im.setColorAt(i, col.set(b.color || '#cccccc'));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  group.add(im);
  return group;
}

export { mulberry32 };
