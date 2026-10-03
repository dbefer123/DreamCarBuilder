// Procedural textures generated at startup (no image assets).
import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';

/** Tileable value noise: returns Float32Array size*size in [0,1]. */
export function tileNoise(size, cells, seed, octaves = 1) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const rnd = mulberry32(seed + o * 101);
    const lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * c;
      const y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const ya = y0 % c, yb = (y0 + 1) % c;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * c;
        const x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % c, xb = (x0 + 1) % c;
        const a = lat[ya * c + xa], b = lat[ya * c + xb], cc = lat[yb * c + xa], d = lat[yb * c + xb];
        out[y * size + x] += amp * (a + (b - a) * sx + (cc - a + (d - cc - b + a) * sx) * sy);
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function dataTex(data, size, format = THREE.RGBAFormat, opts = {}) {
  const t = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = opts.anisotropy ?? 8;
  if (opts.srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** RGBA noise bands (fine..coarse), tileable. */
export function makeNoiseTexture(size = 512) {
  const a = tileNoise(size, 64, 11, 2);
  const b = tileNoise(size, 16, 23, 3);
  const c = tileNoise(size, 6, 37, 3);
  const d = tileNoise(size, 128, 41, 1);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = a[i] * 255;
    data[i * 4 + 1] = b[i] * 255;
    data[i * 4 + 2] = c[i] * 255;
    data[i * 4 + 3] = d[i] * 255;
  }
  return dataTex(data, size);
}

/** Tileable detail normal map (bumpy ground). */
export function makeDetailNormal(size = 512, strength = 3.0) {
  const h1 = tileNoise(size, 32, 77, 3);
  const h2 = tileNoise(size, 128, 91, 2);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = h1[i] * 0.7 + h2[i] * 0.3;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x], d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = h[y * size + x] * 255;
    }
  }
  return dataTex(data, size);
}

/** Tire tread normal map: u around the circumference, v across the profile. */
export function makeTreadNormal() {
  const W = 1024, H = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#8080ff';
  g.fillRect(0, 0, W, H);
  // height field drawn as grey then converted
  const hc = document.createElement('canvas');
  hc.width = W; hc.height = H;
  const hg = hc.getContext('2d');
  hg.fillStyle = '#fff';
  hg.fillRect(0, 0, W, H);
  hg.fillStyle = '#000';
  // the tread occupies the middle of the lathe profile (v 0.3..0.7)
  const t0 = 20, t1 = 44;
  for (const y of [26, 31.5, 37]) hg.fillRect(0, y, W, 1.6);
  for (let x = 0; x < W; x += 16) {
    hg.fillRect(x, t0, 2.5, 6);
    hg.fillRect(x + 8, t1 - 6, 2.5, 6);
    hg.fillRect(x + 4, 27, 1.5, 4);
    hg.fillRect(x + 12, 33, 1.5, 4);
  }
  const src = hg.getImageData(0, 0, W, H).data;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const hAt = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let nx = (hAt(x - 1, y) - hAt(x + 1, y)) * 2.5, ny = (hAt(x, y - 1) - hAt(x, y + 1)) * 2.5, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * W + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Leaf cluster alpha texture for broadleaf foliage cards (dense centre, ragged edge). */
export function makeLeafTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const rnd = mulberry32(5);
  const cx = size / 2, cy = size / 2;
  // twigs
  g.strokeStyle = 'rgb(70,52,34)';
  g.lineWidth = 3;
  for (let k = 0; k < 7; k++) {
    const a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * size * 0.4, cy + Math.sin(a) * size * 0.4);
    g.stroke();
  }
  for (let k = 0; k < 1500; k++) {
    // gaussian-ish distribution around the centre
    const rr = Math.sqrt(-2 * Math.log(Math.max(1e-6, rnd()))) * size * 0.17;
    const aa = rnd() * Math.PI * 2;
    const x = cx + Math.cos(aa) * rr, y = cy + Math.sin(aa) * rr;
    if (Math.hypot(x - cx, y - cy) > size * 0.48) continue;
    const r = size * (0.012 + rnd() * 0.02);
    const a = rnd() * Math.PI;
    const shade = 0.55 + rnd() * 0.45;
    const yellow = rnd() * 0.25;
    g.fillStyle = `rgb(${Math.round((70 + 60 * yellow) * shade)},${Math.round(140 * shade)},${Math.round(40 * shade)})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.5, a, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Conifer branch card: a central stem with needles, transparent background. */
export function makeNeedleTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const rnd = mulberry32(17);
  g.lineCap = 'round';
  // stem along the card from left (trunk) to right (tip), drooping
  for (let k = 0; k < 900; k++) {
    const t = rnd();
    const sx = t * size * 0.95, sy = size * 0.5 + t * t * size * 0.08;
    const len = (1 - t * 0.7) * size * (0.12 + rnd() * 0.12);
    const side = rnd() < 0.5 ? -1 : 1;
    const a = side * (0.6 + rnd() * 0.6) + 0.4;
    const shade = 0.5 + rnd() * 0.5;
    g.strokeStyle = `rgb(${Math.round(28 * shade)},${Math.round(70 * shade)},${Math.round(38 * shade)})`;
    g.lineWidth = 1.5 + rnd() * 1.5;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Grass blades (white, tinted per vertex/instance), alpha in the blades. */
export function makeGrassTexture(w = 256, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  const rnd = mulberry32(23);
  for (let k = 0; k < 70; k++) {
    const x = rnd() * w;
    const bh = h * (0.45 + rnd() * 0.55);
    const lean = (rnd() - 0.5) * w * 0.12;
    const bw = 2 + rnd() * 3.5;
    const shade = 0.7 + rnd() * 0.3;
    const grd = g.createLinearGradient(0, h, 0, h - bh);
    grd.addColorStop(0, `rgb(${Math.round(120 * shade)},${Math.round(150 * shade)},${Math.round(90 * shade)})`);
    grd.addColorStop(1, `rgb(${Math.round(230 * shade)},${Math.round(240 * shade)},${Math.round(170 * shade)})`);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - bw, h);
    g.quadraticCurveTo(x + lean * 0.3, h - bh * 0.6, x + lean, h - bh);
    g.quadraticCurveTo(x + lean * 0.3 + bw * 0.4, h - bh * 0.6, x + bw, h);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round sprite for particles. */
export function makeSoftSprite(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  return t;
}

let _cache = null;
export function sharedTextures() {
  if (_cache) return _cache;
  _cache = {
    noise: makeNoiseTexture(512),
    detailNormal: makeDetailNormal(512),
    tread: makeTreadNormal(),
    leaf: makeLeafTexture(),
    needle: makeNeedleTexture(),
    grass: makeGrassTexture(),
    soft: makeSoftSprite(),
  };
  return _cache;
}
