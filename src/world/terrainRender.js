// Terrain rendering: chunked LOD heightfield meshes shaded entirely from data textures
// (global normals, splat weights, road SDF), so LOD changes never pop the lighting.
import * as THREE from 'three';
import { sharedTextures } from '../render/textures.js';

const CHUNK = 128; // cells per chunk side

function dataTexture(data, N, format, type, opts = {}) {
  const t = new THREE.DataTexture(data, N, N, format, type);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = opts.mip === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = opts.mip !== false;
  t.anisotropy = opts.anisotropy ?? 4;
  t.needsUpdate = true;
  return t;
}

export function terrainNormals(T) {
  const { N, h, cell } = T;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const hl = h[j * N + Math.max(0, i - 1)], hr = h[j * N + Math.min(N - 1, i + 1)];
      const hu = h[Math.max(0, j - 1) * N + i], hd = h[Math.min(N - 1, j + 1) * N + i];
      let nx = (hl - hr) / (2 * cell), nz = (hu - hd) / (2 * cell), ny = 1;
      const l = Math.hypot(nx, ny, nz);
      data[k * 4] = (nx / l * 0.5 + 0.5) * 255;
      data[k * 4 + 1] = (ny / l * 0.5 + 0.5) * 255;
      data[k * 4 + 2] = (nz / l * 0.5 + 0.5) * 255;
      data[k * 4 + 3] = 255;
    }
  }
  return data;
}

export const terrainUniforms = {
  uNight: { value: 0 },
};

export function makeTerrainMaterial(G, textures) {
  const T = G.T;
  const tex = sharedTextures();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.name = 'terrain';
  const uniforms = {
    tNormalMap: { value: textures.normal },
    tSplat: { value: textures.splat },
    tRoadA: { value: textures.roadA },
    tRoadB: { value: textures.roadB },
    tNoise: { value: tex.noise },
    tDetailN: { value: tex.detailNormal },
    uHalf: { value: T.half },
    uCell: { value: T.cell },
    uN: { value: T.N },
    uSalt: { value: T.saltFlat ? 1 : 0 },
    uNight: terrainUniforms.uNight,
    uRock0: { value: new THREE.Vector3(...(G.map.rockColors?.[0] ?? [0.25, 0.13, 0.08])) },
    uRock1: { value: new THREE.Vector3(...(G.map.rockColors?.[1] ?? [0.42, 0.25, 0.16])) },
  };
  mat.userData.terrainUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vTerrainWorld;
uniform sampler2D tNormalMap, tSplat, tRoadA, tRoadB, tNoise, tDetailN;
uniform float uHalf, uCell, uN, uSalt, uNight;
uniform vec3 uRock0, uRock1;
float terrainRough;
float terrainDetail;
float terrainRoad;
`)
      .replace('#include <map_fragment>', TERRAIN_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRough;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  vec2 guvN = ((vTerrainWorld.xz + uHalf) / uCell + 0.5) / uN;
  vec3 tn = texture2D(tNormalMap, guvN).xyz * 2.0 - 1.0;
  vec2 wpN = vTerrainWorld.xz;
  vec3 d1 = texture2D(tDetailN, wpN / 2.7).xyz * 2.0 - 1.0;
  vec3 d2 = texture2D(tDetailN, wpN / 11.0).xyz * 2.0 - 1.0;
  float fade = 1.0 - smoothstep(60.0, 260.0, length(vTerrainWorld - cameraPosition));
  vec3 pert = vec3(d1.x + d2.x * 0.8, 0.0, d1.y + d2.y * 0.8) * terrainDetail * (0.35 + 0.65 * fade);
  vec3 wn = normalize(tn + pert);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => 'dcb-terrain';
  return mat;
}

const TERRAIN_COLOR = /* glsl */ `
vec2 guv = ((vTerrainWorld.xz + uHalf) / uCell + 0.5) / uN;
vec4 spl = texture2D(tSplat, guv);
float sand = spl.r, rock = spl.g, dirt = spl.b, urban = spl.a;
float grass = clamp(1.0 - sand - rock - dirt - urban, 0.0, 1.0);
vec2 wp = vTerrainWorld.xz;
vec4 n1 = texture2D(tNoise, wp / 23.0);
vec4 n2 = texture2D(tNoise, wp / 170.0);
vec4 n3 = texture2D(tNoise, wp / 3.3);
vec4 n4 = texture2D(tNoise, wp / 0.9);
float macro = n2.b;
float meso = n1.g;
float micro = n3.r * 0.6 + n4.a * 0.4;

vec3 cGrass = mix(vec3(0.045, 0.08, 0.018), vec3(0.11, 0.15, 0.035), smoothstep(0.2, 0.8, macro));
cGrass = mix(cGrass, vec3(0.15, 0.14, 0.06), smoothstep(0.45, 0.85, meso * 0.7 + n3.b * 0.3) * 0.35);
cGrass *= 0.72 + 0.5 * micro;
vec3 cSand = mix(vec3(0.30, 0.19, 0.10), vec3(0.43, 0.30, 0.17), macro) * (0.86 + 0.26 * micro);
if (uSalt > 0.5) cSand = mix(vec3(0.74, 0.74, 0.72), vec3(0.86, 0.86, 0.84), macro) * (0.93 + 0.1 * micro);
vec3 cRock = mix(uRock0, uRock1, meso);
{
  // steep faces: project detail sideways so cliffs don't look stretched
  vec3 gn = texture2D(tNormalMap, guv).xyz * 2.0 - 1.0;
  float steepness = 1.0 - clamp(gn.y, 0.0, 1.0);
  vec2 side = abs(gn.x) > abs(gn.z) ? vTerrainWorld.zy : vTerrainWorld.xy;
  vec4 s1 = texture2D(tNoise, side / vec2(9.0, 4.0));
  vec4 s2 = texture2D(tNoise, side / 1.7);
  float strata = 0.5 + 0.5 * sin(vTerrainWorld.y * 2.2 + s1.b * 6.0);
  float sideDetail = mix(0.8, 1.15, s1.g) * mix(0.85, 1.1, s2.r) * mix(0.8, 1.05, strata);
  float topDetail = 0.8 + 0.3 * sin(vTerrainWorld.y * 1.3 + n1.b * 5.0) * 0.5 + 0.15 * micro;
  cRock *= mix(topDetail, sideDetail, smoothstep(0.25, 0.6, steepness));
}
vec3 cDirt = mix(vec3(0.20, 0.145, 0.09), vec3(0.31, 0.235, 0.15), meso) * (0.8 + 0.35 * micro);
vec3 cUrban = mix(vec3(0.13, 0.13, 0.125), vec3(0.19, 0.185, 0.175), meso) * (0.85 + 0.25 * micro);
{
  // poured concrete slabs: per-slab tint + dark expansion joints
  vec2 slab = floor(wp / 6.0);
  float sv = texture2D(tNoise, (slab + 0.5) / 97.0).a;
  cUrban *= 0.88 + 0.24 * sv;
  vec2 fj = abs(fract(wp / 6.0 + 0.5) - 0.5) * 6.0;
  float jw = max(fwidth(wp.x), 0.02);
  float joint = 1.0 - smoothstep(0.03, 0.03 + jw * 1.5, min(fj.x, fj.y));
  cUrban *= 1.0 - 0.45 * joint;
  cUrban *= 1.0 - 0.15 * smoothstep(0.55, 0.85, n2.r); // stains
}
vec3 col = cGrass * grass + cSand * sand + cRock * rock + cDirt * dirt + cUrban * urban;
terrainRough = 0.97 - urban * 0.12 - rock * 0.08;
terrainDetail = 0.4 * grass + 0.75 * rock + 0.45 * sand + 0.5 * dirt + 0.15 * urban;
terrainRoad = 0.0;

vec4 ra = texture2D(tRoadA, guv);
vec4 rb = texture2D(tRoadB, guv);
float edge = ra.r;
if (edge < 4.0) {
  float center = ra.g;
  float phase = atan(ra.a, ra.b) / 6.2831853 + 0.5;
  float inter = rb.r * 32.0 - 8.0;
  float kind = floor(rb.g * 255.0 / 60.0 + 0.5);
  float aa = max(fwidth(edge), 0.02);
  float caa = max(fwidth(center), 0.01);
  float onRoad = 1.0 - smoothstep(-aa, aa, edge);
  vec3 asph = mix(vec3(0.032, 0.032, 0.034), vec3(0.06, 0.059, 0.057), n3.g) * (0.8 + 0.35 * n1.r) * (0.9 + 0.2 * n4.b);
  float rr = 0.82 - 0.1 * n1.a;
  vec3 paint = vec3(0.0);
  float paintA = 0.0;
  float far = smoothstep(150.0, 600.0, length(vTerrainWorld - cameraPosition));
  if (kind < 0.5) {
    float open = smoothstep(0.3, 1.6, inter);
    float edgeLine = 1.0 - smoothstep(0.075 - aa, 0.075 + aa, abs(edge + 0.42));
    float yellow = 1.0 - smoothstep(0.06 - caa, 0.06 + caa, abs(abs(center) - 0.16));
    paint = mix(paint, vec3(0.75), edgeLine * open);
    paintA = max(paintA, edgeLine * open);
    paint = mix(paint, vec3(0.75, 0.52, 0.06), yellow * open);
    paintA = max(paintA, yellow * open);
    float band = step(1.0, inter) * step(inter, 4.2) * step(edge, -0.4);
    float stripes = smoothstep(0.42, 0.46, fract(center / 1.1)) * (1.0 - smoothstep(0.9, 0.94, fract(center / 1.1)));
    paint = mix(paint, vec3(0.78), band * stripes);
    paintA = max(paintA, band * stripes);
    float stop = step(4.6, inter) * step(inter, 5.1) * step(edge, -0.4) * step(0.3, center);
    paint = mix(paint, vec3(0.78), stop);
    paintA = max(paintA, stop);
  } else if (kind < 1.5) {
    float kerb = step(-1.4, edge) * step(edge, 0.0);
    float stripe = step(0.5, fract(phase * 6.0));
    vec3 kc = mix(vec3(0.55, 0.03, 0.02), vec3(0.8), stripe);
    paint = mix(paint, kc, kerb);
    paintA = max(paintA, kerb);
    float wl = 1.0 - smoothstep(0.09 - aa, 0.09 + aa, abs(edge + 1.6));
    paint = mix(paint, vec3(0.8), wl);
    paintA = max(paintA, wl);
    asph *= 0.9;
  } else if (kind < 2.5) {
    asph = cDirt * 0.9 * (0.85 + 0.3 * n3.b);
    onRoad = 1.0 - smoothstep(-1.5, 1.0, edge + (n1.g - 0.5) * 2.0);
    rr = 0.95;
    float rut = smoothstep(0.35, 0.0, abs(abs(center) - 0.9));
    asph *= 1.0 - 0.18 * rut;
  } else {
    asph = mix(vec3(0.24, 0.24, 0.23), vec3(0.31, 0.31, 0.30), n1.r) * (0.9 + 0.15 * n3.g);
    float dash = step(abs(center), 0.45) * step(phase, 0.5);
    float el = 1.0 - smoothstep(0.18 - aa, 0.18 + aa, abs(edge + 1.0));
    paint = mix(paint, vec3(0.8), max(dash, el));
    paintA = max(paintA, max(dash, el));
    rr = 0.9;
  }
  vec3 rc = mix(asph, paint, paintA * (0.85 - 0.3 * n3.r) * (1.0 - far * 0.5));
  // sidewalks + curbs next to city streets
  if (kind < 0.5 && urban > 0.4 && edge > 0.0) {
    float sw = 1.0 - smoothstep(4.2, 4.6, edge);
    vec3 swc = mix(vec3(0.22, 0.215, 0.205), vec3(0.29, 0.285, 0.27), n1.g) * (0.92 + 0.12 * n3.r);
    float joints = step(0.94, fract(edge / 1.5)) + step(0.97, fract(dot(wp, vec2(0.7071)) / 1.5));
    swc *= 1.0 - 0.15 * clamp(joints, 0.0, 1.0);
    float curb = 1.0 - smoothstep(0.18, 0.26, edge);
    swc = mix(swc, vec3(0.36, 0.355, 0.34), curb);
    col = mix(col, swc, sw);
    terrainRough = mix(terrainRough, 0.9, sw);
  }
  col = mix(col, rc, onRoad);
  terrainRough = mix(terrainRough, rr, onRoad);
  terrainDetail = mix(terrainDetail, 0.08, onRoad);
  terrainRoad = onRoad;
}
diffuseColor.rgb = col;
`;

export class TerrainRenderer {
  constructor(G) {
    const T = G.T;
    this.T = T;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    const N = T.N;
    const roads = T.buildRoadTextures(12);
    this.textures = {
      normal: dataTexture(terrainNormals(T), N, THREE.RGBAFormat, THREE.UnsignedByteType),
      splat: dataTexture(T.splat, N, THREE.RGBAFormat, THREE.UnsignedByteType),
      roadA: dataTexture(roads.a, N, THREE.RGBAFormat, THREE.HalfFloatType, { anisotropy: 8 }),
      roadB: dataTexture(roads.b, N, THREE.RGBAFormat, THREE.UnsignedByteType),
    };
    this.material = makeTerrainMaterial(G, this.textures);
    this.chunks = [];
    this.cache = new Map();
    this.nc = Math.ceil((N - 1) / CHUNK);
    for (let cj = 0; cj < this.nc; cj++) {
      for (let ci = 0; ci < this.nc; ci++) {
        const mesh = new THREE.Mesh(this._geometry(ci, cj, 16), this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        const x0 = ci * CHUNK * T.cell - T.half, z0 = cj * CHUNK * T.cell - T.half;
        const size = CHUNK * T.cell;
        this.chunks.push({ ci, cj, mesh, lod: 16, cx: x0 + size / 2, cz: z0 + size / 2, size });
        this.group.add(mesh);
      }
    }
  }

  _geometry(ci, cj, step) {
    const key = `${ci},${cj},${step}`;
    let g = this.cache.get(key);
    if (g) {
      this.cache.delete(key);
      this.cache.set(key, g);
      return g;
    }
    const T = this.T;
    const N = T.N;
    const i0 = ci * CHUNK, j0 = cj * CHUNK;
    const cellsX = Math.min(CHUNK, N - 1 - i0), cellsZ = Math.min(CHUNK, N - 1 - j0);
    const nx = Math.floor(cellsX / step) + 1, nz = Math.floor(cellsZ / step) + 1;
    const skirt = 2 * (nx + nz);
    const vcount = nx * nz + skirt;
    const pos = new Float32Array(vcount * 3);
    const nrm = new Float32Array(vcount * 3);
    const h = T.h;
    const cell = T.cell, half = T.half;
    let v = 0;
    const put = (i, j, drop) => {
      const gi = Math.min(N - 1, i0 + i * step), gj = Math.min(N - 1, j0 + j * step);
      const k = gj * N + gi;
      pos[v * 3] = gi * cell - half;
      pos[v * 3 + 1] = h[k] - drop;
      pos[v * 3 + 2] = gj * cell - half;
      const hl = h[gj * N + Math.max(0, gi - 1)], hr = h[gj * N + Math.min(N - 1, gi + 1)];
      const hu = h[Math.max(0, gj - 1) * N + gi], hd = h[Math.min(N - 1, gj + 1) * N + gi];
      let ax = (hl - hr) / (2 * cell), az = (hu - hd) / (2 * cell);
      const l = Math.hypot(ax, 1, az);
      nrm[v * 3] = ax / l; nrm[v * 3 + 1] = 1 / l; nrm[v * 3 + 2] = az / l;
      return v++;
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) put(i, j, 0);
    const idx = [];
    const at = (i, j) => j * nx + i;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
        if ((i + j) & 1) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    // skirts
    const drop = 2 + step * 1.5;
    const edgeLoop = [];
    for (let i = 0; i < nx; i++) edgeLoop.push([i, 0]);
    for (let j = 1; j < nz; j++) edgeLoop.push([nx - 1, j]);
    for (let i = nx - 2; i >= 0; i--) edgeLoop.push([i, nz - 1]);
    for (let j = nz - 2; j > 0; j--) edgeLoop.push([0, j]);
    const firstSkirt = v;
    for (const [i, j] of edgeLoop) put(i, j, drop);
    for (let e = 0; e < edgeLoop.length; e++) {
      const [i, j] = edgeLoop[e];
      const [i2, j2] = edgeLoop[(e + 1) % edgeLoop.length];
      const a = at(i, j), b = at(i2, j2);
      const sa = firstSkirt + e, sb = firstSkirt + ((e + 1) % edgeLoop.length);
      idx.push(a, b, sa, b, sb, sa);
      idx.push(a, sa, b, b, sa, sb);
    }
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, v * 3), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.cache.set(key, g);
    if (this.cache.size > 400) {
      const oldest = this.cache.keys().next().value;
      const og = this.cache.get(oldest);
      if (!this.chunks.some((c) => c.mesh.geometry === og)) {
        og.dispose();
        this.cache.delete(oldest);
      }
    }
    return g;
  }

  update(camPos, quality = 1) {
    const k = quality;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(camPos.x - c.cx) - c.size / 2);
      const dz = Math.max(0, Math.abs(camPos.z - c.cz) - c.size / 2);
      const d = Math.hypot(dx, dz, Math.max(0, camPos.y - 300) * 0.5);
      const lod = d < 220 * k ? 1 : d < 600 * k ? 2 : d < 1300 * k ? 4 : d < 2400 * k ? 8 : 16;
      if (lod !== c.lod) {
        c.lod = lod;
        c.mesh.geometry = this._geometry(c.ci, c.cj, lod);
      }
    }
  }

  dispose() {
    for (const g of this.cache.values()) g.dispose();
    for (const t of Object.values(this.textures)) t.dispose();
    this.material.dispose();
  }
}
