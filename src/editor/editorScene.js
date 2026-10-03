// Garage scene: studio lighting, blueprint backgrounds, per-view grids, node handles,
// selection overlays and tool preview lines.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CarRenderer, makeGhostMaterial, ghostify } from '../render/carRenderer.js';
import { nodeRadiusPx } from './interaction.js';
import { nodeMasses, triArea, createDesign, addNode, addPart } from '../car/design.js';
import { settings } from '../core/settings.js';

export const LAYER_MAIN = 1, LAYER_TOP = 2, LAYER_SIDE = 3;

// node colours as in the original: blue frame nodes, pink nodes of other parts, purple wheel hubs
const COLORS = {
  node: new THREE.Color('#3d7cf2'),
  nodePart: new THREE.Color('#f0808e'),
  hub: new THREE.Color('#a77df2'),
  selected: new THREE.Color('#5ff0ff'),
  active: new THREE.Color('#b8fbff'),
  hover: new THREE.Color('#9fc4ff'),
};
// part highlights: selected parts, frames touching selected nodes, hover
const HL = { selected: '#86d94a', attached: '#b9ea8c', hover: '#d9f3c2' };

function gradientTexture(top, bottom, glow) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  if (glow) grad.addColorStop(0.55, glow);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Checkered ball marker drawn on top of the car (centre of mass / lift). */
function marker(a, b) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? b : a;
      g.fillRect(i * 16, j * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ map: t, depthTest: false }));
  m.renderOrder = 8;
  m.visible = false;
  return m;
}

function gridLines(size, step, majorEvery, plane, colorMinor, colorMajor, offset = 0) {
  const minor = [], major = [];
  const n = Math.round(size / step);
  for (let i = -n; i <= n; i++) {
    const v = i * step;
    const arr = i % majorEvery === 0 ? major : minor;
    if (plane === 'xz') arr.push(-size, offset, v, size, offset, v, v, offset, -size, v, offset, size);
    else if (plane === 'xy') arr.push(-size, v, offset, size, v, offset, v, -size, offset, v, size, offset);
  }
  const mk = (arr, color, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  };
  const grp = new THREE.Group();
  grp.add(mk(minor, colorMinor, 0.35), mk(major, colorMajor, 0.7));
  return grp;
}

function setLayer(obj, layer) {
  obj.traverse((o) => o.layers.set(layer));
}

export class EditorScene {
  constructor(renderer, design) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.bgMain = null;
    this.setBackground(settings.bgTop, settings.bgBottom);
    this.bgSide = gradientTexture('#c6d5ea', '#c6d5ea');
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    const hemi = new THREE.HemisphereLight(0xeef4ff, 0x8a96a8, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(3, 8, 5);
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.7);
    fill.position.set(-5, 3, -4);
    this.scene.add(hemi, sun, fill);

    // grids
    this.mainGrid = new THREE.Group();
    this.groundGrid = gridLines(6, 0.5, 2, 'xz', 0x7fa6cf, 0x6f9ac8, 0);
    this.mainGrid.add(this.groundGrid);
    this.planeOutlines = new THREE.Group();
    this.mainGrid.add(this.planeOutlines);
    setLayer(this.mainGrid, LAYER_MAIN);
    this.scene.add(this.mainGrid);
    this.topGrid = gridLines(30, 0.1, 10, 'xz', 0xd4a7c2, 0x87d3e0, -50);
    setLayer(this.topGrid, LAYER_TOP);
    this.scene.add(this.topGrid);
    this.sideGrid = gridLines(30, 0.1, 10, 'xy', 0xd4a7c2, 0x87d3e0, -60);
    setLayer(this.sideGrid, LAYER_SIDE);
    this.scene.add(this.sideGrid);
    // symmetry centre line in the top view
    const cl = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-40, 0, 0), new THREE.Vector3(40, 0, 0)]);
    this.centerLine = new THREE.Line(cl, new THREE.LineDashedMaterial({ color: 0x2f5fd0, dashSize: 0.12, gapSize: 0.08, depthTest: false }));
    this.centerLine.computeLineDistances();
    this.centerLine.position.y = 20;
    setLayer(this.centerLine, LAYER_TOP);
    this.scene.add(this.centerLine);

    // car
    this.car = new CarRenderer(design, { mode: 'editor' });
    this.car.setFramesOpaque(true);
    this.car.setXray(true);
    this.scene.add(this.car.group);

    // node handles
    // node handles: glossy lit spheres (instance colours), a green glow shell on selected ones
    this.handleGeo = new THREE.SphereGeometry(1, 18, 12);
    this.handleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.05, envMapIntensity: 1.4 });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x8cff6a, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending });
    this.handles = null;
    this.glow = null;
    this.handleNodes = [];

    // overlays
    this.overlay = new THREE.Group();
    this.scene.add(this.overlay);
    this.previewMat = new THREE.LineDashedMaterial({ color: 0xff8a1a, dashSize: 0.06, gapSize: 0.04, depthTest: false, transparent: true });
    this.preview = new THREE.Line(new THREE.BufferGeometry(), this.previewMat);
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 10;
    this.preview.visible = false;
    this.scene.add(this.preview);
    this.ghost = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.7, depthTest: false }));
    this.ghost.renderOrder = 11;
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.axisLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false, transparent: true, opacity: 0.9 }));
    this.axisLine.frustumCulled = false;
    this.axisLine.visible = false;
    this.axisLine.renderOrder = 12;
    this.scene.add(this.axisLine);
    this.bgImage = null;
    this.realView = false;

    // centre of mass / centre of lift markers (Settings > Garage)
    this.comMarker = marker('#ffd23a', '#20242a');
    this.colMarker = marker('#4da3ff', '#ffffff');
    this.scene.add(this.comMarker, this.colMarker);
  }

  /** Garage background gradient (Settings > Garage > Background colors). */
  setBackground(top = '#bccfe8', bottom = '#9fb6d6') {
    this.bgMain?.dispose();
    const mix = new THREE.Color(top).lerp(new THREE.Color(bottom), 0.45);
    this.bgMain = gradientTexture(top, bottom, `#${mix.getHexString()}`);
  }

  /** Place the centre of mass and centre of lift markers (hidden when off or undefined). */
  updateMarkers(design, showCOM, showCOL) {
    this.comMarker.visible = false;
    this.colMarker.visible = false;
    if (showCOM && design.nodes.length) {
      const masses = nodeMasses(design);
      let M = 0;
      const c = new THREE.Vector3();
      for (const n of design.nodes) {
        const m = masses.get(n.id) || 0;
        M += m;
        c.x += m * n.x; c.y += m * n.y; c.z += m * n.z;
      }
      if (M > 0) {
        this.comMarker.position.copy(c.multiplyScalar(1 / M));
        this.comMarker.visible = true;
      }
    }
    if (showCOL) {
      // lift-weighted centroid of the panels that make lift or downforce
      const nm = new Map(design.nodes.map((n) => [n.id, n]));
      let W = 0;
      const c = new THREE.Vector3();
      for (const p of design.parts) {
        if (p.type !== 'panel' || !p.lift) continue;
        const ns = p.n.map((id) => nm.get(id));
        if (ns.some((n) => !n)) continue;
        const w = Math.abs(p.lift) * triArea(ns[0], ns[1], ns[2]);
        // balance moves the force toward the front-most (+) or rear-most (-) node
        const xs = ns.map((n) => n.x);
        const lead = ns[xs.indexOf(Math.max(...xs))], tail = ns[xs.indexOf(Math.min(...xs))];
        const target = (p.balance || 0) >= 0 ? lead : tail;
        const b = Math.abs(p.balance || 0) * (2 / 3);
        for (const ax of ['x', 'y', 'z']) c[ax] += w * ((ns[0][ax] + ns[1][ax] + ns[2][ax]) / 3 * (1 - b) + target[ax] * b);
        W += w;
      }
      if (W > 0) {
        this.colMarker.position.copy(c.multiplyScalar(1 / W));
        this.colMarker.visible = true;
      }
    }
  }

  setDesign(design) {
    this.car.build(design);
    this.car.setFramesOpaque(this.car.opaqueFrames);
    this.car.setPanelsVisible(this.car.showPanels);
    this.car.setDecorationsVisible(this.car.showDecorations);
    this._buildHandles(design);
    this._updateOutlines(design);
  }

  _buildHandles(design) {
    for (const k of ['handles', 'glow']) {
      if (this[k]) {
        this.scene.remove(this[k]);
        this[k].dispose();
      }
    }
    const n = Math.max(1, design.nodes.length);
    this.handles = new THREE.InstancedMesh(this.handleGeo, this.handleMat, n);
    this.handles.count = design.nodes.length;
    this.handles.frustumCulled = false;
    this.handles.renderOrder = 5;
    this.scene.add(this.handles);
    this.glow = new THREE.InstancedMesh(this.handleGeo, this.glowMat, n);
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    this.scene.add(this.glow);
    this.handleNodes = design.nodes;
    const partNodes = new Set(), hubs = new Set();
    for (const p of design.parts) {
      if (p.type === 'frame') continue;
      for (const id of p.n) partNodes.add(id);
      if (p.type === 'wheel') hubs.add(p.n[0]);
    }
    this.partNodes = partNodes;
    this.hubNodes = hubs;
  }

  _updateOutlines(design) {
    const g = this.planeOutlines;
    g.clear();
    let minx = -2, maxx = 2, maxy = 1.2;
    for (const n of design.nodes) {
      minx = Math.min(minx, n.x);
      maxx = Math.max(maxx, n.x);
      maxy = Math.max(maxy, n.y);
    }
    minx -= 0.6; maxx += 0.6; maxy += 0.5;
    const hw = 1.6;
    const rect = (pts, color) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
      const l = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
      l.layers.set(LAYER_MAIN);
      g.add(l);
    };
    rect([[minx, 0, -hw], [maxx, 0, -hw], [maxx, 0, hw], [minx, 0, hw]], 0x6fd6e6);
    rect([[minx, 0, 0], [maxx, 0, 0], [maxx, maxy, 0], [minx, maxy, 0]], 0xf08bb3);
  }

  /** Update handle transforms/colours for a viewport (world-sized spheres, clamped in pixels). */
  updateHandles(view, sel, hidden, hoverId) {
    const h = this.handles;
    if (!h) return;
    h.visible = !this.realView;
    this.glow.visible = !this.realView;
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const col = new THREE.Color();
    let g = 0;
    this.handleNodes.forEach((n, i) => {
      if (hidden.has(n.id)) {
        h.setMatrixAt(i, m.makeScale(0, 0, 0));
        return;
      }
      v.set(n.x, n.y, n.z);
      const selected = sel.nodes.has(n.id);
      const r = nodeRadiusPx(view, v) * view.worldPerPixel(v) * (selected ? 1.15 : 1);
      m.makeScale(r, r, r).setPosition(v);
      h.setMatrixAt(i, m);
      let c = this.hubNodes.has(n.id) ? COLORS.hub : this.partNodes.has(n.id) ? COLORS.nodePart : COLORS.node;
      if (selected) {
        c = sel.activeNode === n.id ? COLORS.active : COLORS.selected;
        m.makeScale(r * 2.1, r * 2.1, r * 2.1).setPosition(v);
        this.glow.setMatrixAt(g++, m);
      } else if (hoverId === n.id) c = COLORS.hover;
      h.setColorAt(i, col.copy(c));
    });
    this.glow.count = g;
    h.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    if (h.instanceColor) h.instanceColor.needsUpdate = true;
    for (const mk of [this.comMarker, this.colMarker]) {
      if (mk.visible) mk.scale.setScalar(view.worldPerPixel(mk.position) * 9);
    }
  }

  setHighlights(design, sel, hoverPart) {
    const map = new Map();
    // frames touching selected nodes light up, as in the original
    if (sel.nodes.size) for (const p of design.parts) if (p.type === 'frame' && p.n.some((id) => sel.nodes.has(id))) map.set(p.id, HL.attached);
    for (const id of sel.parts) map.set(id, HL.selected);
    if (hoverPart && !sel.parts.has(hoverPart)) map.set(hoverPart, HL.hover);
    this.car.setHighlight(map);
    // outlines for non-instanced parts
    this.overlay.clear();
    const nm = new Map(design.nodes.map((n) => [n.id, n]));
    for (const id of map.keys()) {
      if (map.get(id) === HL.attached) continue;
      const p = design.parts.find((q) => q.id === id);
      if (!p) continue;
      const col = map.get(id);
      if (p.type === 'wheel') {
        const a = nm.get(p.n[0]), b = nm.get(p.n[1]);
        if (!a || !b) continue;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(p.radius * 1.03, 0.018, 6, 48), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.85 }));
        ring.renderOrder = 6;
        const axis = new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z).normalize();
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
        ring.position.set(a.x, a.y, a.z);
        this.overlay.add(ring);
      } else if (['engine', 'jet', 'seat', 'weight'].includes(p.type)) {
        const src = (this.car.engines.find((e) => e.part.id === id)?.group) || (this.car.jets.find((e) => e.part.id === id)?.group) ||
          (this.car.seats.find((e) => e.part.id === id)?.group) || (this.car.weights.find((e) => e.part.id === id)?.mesh);
        if (!src) continue;
        src.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(src);
        const helper = new THREE.Box3Helper(box, new THREE.Color(col));
        helper.material.depthTest = false;
        helper.renderOrder = 6;
        this.overlay.add(helper);
      }
    }
  }

  setPreview(points, color = 0xff8a1a) {
    if (!points || points.length < 2) {
      this.preview.visible = false;
      return;
    }
    this.preview.geometry.dispose();
    this.preview.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.preview.computeLineDistances();
    this.previewMat.color.set(color);
    this.preview.visible = true;
  }

  /**
   * See-through preview of a part about to be placed: type + props, node positions.
   * setPartGhost(null) hides it.
   */
  setPartGhost(type, props, points) {
    if (!type) {
      if (this.partGhost) this.partGhost.car.group.visible = false;
      return;
    }
    const key = `${type}|${JSON.stringify(props)}|${points.length}`;
    if (!this.partGhost || this.partGhost.key !== key) {
      this._disposePartGhost();
      const d = createDesign('preview');
      const ids = points.map((p) => addNode(d, p.x, p.y, p.z).id);
      addPart(d, type, ids, props);
      const car = new CarRenderer(d, { mode: 'ghost' });
      if (!this.ghostPartMat) this.ghostPartMat = makeGhostMaterial(0x8fe060, 0.45);
      ghostify(car, this.ghostPartMat);
      this.scene.add(car.group);
      this.partGhost = { key, car, d };
    }
    const g = this.partGhost;
    g.d.nodes.forEach((n, i) => {
      n.x = points[i].x;
      n.y = points[i].y;
      n.z = points[i].z;
    });
    g.car.group.visible = true;
    g.car.setFromDesign(g.d);
  }

  _disposePartGhost() {
    if (!this.partGhost) return;
    this.scene.remove(this.partGhost.car.group);
    this.partGhost.car.dispose();
    this.partGhost = null;
  }

  setGhost(p, r) {
    if (!p) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghost.position.copy(p);
    this.ghost.scale.setScalar(r);
  }

  setAxisLine(origin, axis, color) {
    if (!axis) {
      this.axisLine.visible = false;
      return;
    }
    const a = origin.clone().addScaledVector(axis, -50), b = origin.clone().addScaledVector(axis, 50);
    this.axisLine.geometry.dispose();
    this.axisLine.geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    this.axisLine.material.color.set(color);
    this.axisLine.visible = true;
  }

  setBackgroundImage(dataURL, width = 5, opacity = 0.55) {
    if (this.bgImage) {
      this.scene.remove(this.bgImage);
      this.bgImage.material.map?.dispose();
      this.bgImage = null;
    }
    if (!dataURL) return;
    const tex = new THREE.TextureLoader().load(dataURL, (t) => {
      const aspect = t.image.height / t.image.width;
      this.bgImage.scale.set(width, width * aspect, 1);
      this.bgImage.position.y = (width * aspect) / 2 - 0.2;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    this.bgImage = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false }));
    this.bgImage.position.set(0, 1, -3);
    this.bgImage.layers.set(LAYER_SIDE);
    this.bgImage.layers.enable(LAYER_MAIN);
    this.bgImage.renderOrder = -1;
    this.scene.add(this.bgImage);
  }

  setRealView(on) {
    this.realView = on;
    this.mainGrid.visible = !on;
    if (this.handles) this.handles.visible = !on;
    if (this.glow) this.glow.visible = !on;
    this.overlay.visible = !on;
    // real view shows the parts solid; editing view is see-through
    this.car.setXray(!on);
  }

  render(views, sel, hidden, hover, size) {
    const r = this.renderer;
    r.setScissorTest(true);
    const H = size.y;
    for (const v of views) {
      if (!v.visible) continue;
      const { x, y, w, h } = v.rect;
      r.setViewport(x, H - y - h, w, h);
      r.setScissor(x, H - y - h, w, h);
      this.scene.background = v.name === 'main' ? this.bgMain : this.bgSide;
      this.updateHandles(v, sel, hidden, hover);
      r.render(this.scene, v.camera);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
  }

  dispose() {
    this._disposePartGhost();
    this.car.dispose();
    this.envRT.dispose();
    this.bgMain?.dispose();
    this.bgSide.dispose();
  }
}
