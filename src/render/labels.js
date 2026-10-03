// Floating labels over cars: Single player opponents' coin values, the best-race ghost and
// multiplayer name tags. Constant size on screen, always facing the camera.
import * as THREE from 'three';

const H = 64; // canvas height in pixels

function drawCoin(g, x, y, r) {
  g.fillStyle = '#f2c04a';
  g.strokeStyle = '#a8761a';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.strokeStyle = '#d39a2a';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, r * 0.62, 0, Math.PI * 2);
  g.stroke();
}

function drawTick(g, x, y) {
  g.strokeStyle = '#2eaa45';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x - 12, y);
  g.lineTo(x - 3, y + 10);
  g.lineTo(x + 14, y - 12);
  g.stroke();
}

/**
 * A label sprite. opts: { text, coin, tick, color, bg, size } where size is the label's
 * height as a fraction of the view height at distance 1 (screen-constant).
 */
export function makeLabel(opts) {
  const canvas = document.createElement('canvas');
  canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 20;
  sprite.userData.set = (o) => {
    const s = { ...sprite.userData.opts, ...o };
    sprite.userData.opts = s;
    const g = canvas.getContext('2d');
    const font = `700 38px "Exo 2", "Segoe UI", sans-serif`;
    g.font = font;
    const tw = Math.ceil(g.measureText(s.text).width);
    const w = 20 + (s.coin ? 46 : 0) + tw + (s.tick ? 40 : 0) + 20;
    if (canvas.width !== w) canvas.width = w;
    g.clearRect(0, 0, w, H);
    g.fillStyle = s.bg ?? 'rgba(255,255,255,0.93)';
    g.beginPath();
    g.roundRect(2, 4, w - 4, H - 8, 10);
    g.fill();
    let x = 20;
    if (s.coin) {
      drawCoin(g, x + 18, H / 2, 17);
      x += 46;
    }
    g.font = font;
    g.fillStyle = s.color ?? '#1d2228';
    g.textBaseline = 'middle';
    g.fillText(s.text, x, H / 2 + 2);
    x += tw;
    if (s.tick) drawTick(g, x + 22, H / 2);
    tex.needsUpdate = true;
    const size = s.size ?? 0.032;
    sprite.scale.set((size * w) / H, size, 1);
  };
  sprite.userData.opts = {};
  sprite.userData.set(opts);
  sprite.userData.dispose = () => {
    tex.dispose();
    mat.dispose();
  };
  return sprite;
}
