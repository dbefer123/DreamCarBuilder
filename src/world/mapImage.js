// Top-down map image of a generated world (map screen + HUD minimap).
import { ROAD_KIND } from './terrainData.js';

export function createMapImage(G, size = 1024) {
  const T = G.T;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const N = T.N;
  const scale = (N - 1) / size;
  const light = [-0.55, 0.62, -0.55];
  const ll = Math.hypot(...light);
  // the map's own rock colour (grey on Default and Highlands), else red-brown
  const rc = G.map.rockColors?.[1];
  const rock3 = rc ? rc.map((c) => Math.min(255, c * 560)) : [168, 120, 96];
  const boulder = rc ? `rgba(${rock3.map((c) => Math.round(c * 0.7)).join(',')},0.85)` : 'rgba(120,60,40,0.85)';
  for (let py = 0; py < size; py++) {
    const j = Math.min(N - 2, Math.floor(py * scale));
    for (let px = 0; px < size; px++) {
      const i = Math.min(N - 2, Math.floor(px * scale));
      const k = j * N + i;
      const s = T.splat;
      const sand = s[k * 4] / 255, rock = s[k * 4 + 1] / 255, dirt = s[k * 4 + 2] / 255, urban = s[k * 4 + 3] / 255;
      const grass = Math.max(0, 1 - sand - rock - dirt - urban);
      let r = grass * 104 + sand * (T.saltFlat ? 228 : 226) + rock * rock3[0] + dirt * 150 + urban * 205;
      let gg = grass * 128 + sand * (T.saltFlat ? 228 : 208) + rock * rock3[1] + dirt * 120 + urban * 205;
      let b = grass * 62 + sand * (T.saltFlat ? 226 : 160) + rock * rock3[2] + dirt * 90 + urban * 203;
      // hillshade
      const h = T.h;
      const dx = (h[k + 1] - h[k]) / T.cell, dz = (h[k + N] - h[k]) / T.cell;
      const nl = Math.hypot(dx, 1, dz);
      const shade = Math.max(0.35, (-dx * light[0] + light[1] - dz * light[2]) / (nl * ll));
      const f = 0.55 + 0.6 * shade;
      r *= f; gg *= f; b *= f;
      const e = T.roadEdge[k];
      if (e < 0.5) {
        const kind = T.roadKind[k];
        if (kind === ROAD_KIND.DIRT) { r = 92; gg = 74; b = 56; }
        else if (kind === ROAD_KIND.RUNWAY) { r = 120; gg = 120; b = 118; }
        else { r = 52; gg = 54; b = 58; }
      }
      const o = (py * size + px) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const toPx = (x) => ((x + T.half) / T.size) * size;
  // buildings
  for (const bld of G.buildings) {
    const x = toPx(bld.x - bld.w / 2), y = toPx(bld.z - bld.d / 2);
    const w = (bld.w / T.size) * size, hh = (bld.d / T.size) * size;
    const sh = Math.min(6, bld.h / 25);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(x + sh, y + sh, w, hh);
    const l = 210 + Math.min(40, bld.h / 4);
    g.fillStyle = bld.style === 2 ? `rgb(${l - 40},${l - 25},${l - 10})` : `rgb(${l},${l},${l - 6})`;
    g.fillRect(x, y, w, hh);
    g.strokeStyle = 'rgba(80,80,80,0.6)';
    g.lineWidth = 0.6;
    g.strokeRect(x, y, w, hh);
  }
  // trees + rocks
  for (const t of G.trees) {
    if (t.type === 2) continue;
    g.fillStyle = t.type === 0 ? 'rgba(20,52,24,0.75)' : 'rgba(34,72,26,0.7)';
    const r = Math.max(0.8, (2.2 * t.s / T.size) * size);
    g.beginPath();
    g.arc(toPx(t.x), toPx(t.z), r, 0, Math.PI * 2);
    g.fill();
  }
  for (const rk of G.rocks) {
    if (rk.type === 1) continue;
    g.fillStyle = boulder;
    g.beginPath();
    g.arc(toPx(rk.x), toPx(rk.z), Math.max(1, (rk.sx / T.size) * size), 0, Math.PI * 2);
    g.fill();
  }
  for (const b of G.boxes) {
    g.fillStyle = '#d8d4cc';
    g.fillRect(toPx(b.x - b.w / 2), toPx(b.z - b.d / 2), Math.max(1, (b.w / T.size) * size), Math.max(1, (b.d / T.size) * size));
  }
  for (const r of G.rampVisuals) {
    g.save();
    g.translate(toPx(r.x), toPx(r.z));
    g.rotate(-r.angle);
    g.fillStyle = '#c9a43a';
    const w = (r.length / T.size) * size, hh = (r.width / T.size) * size;
    g.fillRect(-w / 2, -hh / 2, w, hh);
    g.restore();
  }
  return { canvas: c, size, toPx, worldSize: T.size, half: T.half };
}
