// Renders a car design from node positions (design pose in the editor, simulated pose
// while driving). Frames, shocks and rods are instanced; wheels/engines/jets/driver are
// small groups positioned from their nodes.
import * as THREE from 'three';
import { sharedTextures } from './textures.js';
import { frameThickness, frameRadius, enginePower, jetThrust } from '../car/parts.js';
import { tireGeometry, rimGeometry, brakeGeometry, shockGeometries, engineTier, engineModel, jetModel, seatModel, figureModel, weightGeometry, carMaterials } from './partMeshes.js';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();
const _jv = new THREE.Vector3();

let SHOCK = null, WEIGHT = null;
const FRAME_GEO = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  g.translate(0, 0.5, 0);
  return g;
})();
const JOINT_GEO = new THREE.SphereGeometry(1, 12, 8);
const XRAY_MATS = ['tire', 'tireSlick', 'tireKnobby', 'rim', 'disc', 'caliper', 'coil', 'shockBody', 'chrome', 'polished', 'engineBlock', 'engineHeads', 'darkMetal',
  'pipes', 'suit', 'suitPassenger', 'helmet', 'visor', 'seat', 'seatShell', 'seatLeather', 'harness', 'jet', 'jetDark', 'weight', 'rod', 'limiter'];
const PANEL_MATS = { polished: 'panel', matte: 'panelMatte', metallic: 'panelMetallic', carbon: 'panelCarbon', glass: 'panelGlass', chrome: 'panelChrome' };
const ROD_GEO = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
  g.translate(0, 0.5, 0);
  return g;
})();

function lazyGeos() {
  if (!SHOCK) {
    SHOCK = shockGeometries();
    WEIGHT = weightGeometry();
  }
}

/** See-through single-colour material for part previews (garage) and best-race ghosts. */
export function makeGhostMaterial(color = 0xa9d6ff, opacity = 0.28) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
}

/** Draw every mesh of a car renderer with one material. */
export function ghostify(car, mat) {
  car.group.traverse((o) => {
    if (o.isMesh) {
      o.material = mat;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
}

/** Orthonormal basis with +X along `x` and +Y as close as possible to `up`. */
export function basisMatrix(x, up, out) {
  const ux = up.x - x.x * (up.x * x.x + up.y * x.y + up.z * x.z);
  const uy = up.y - x.y * (up.x * x.x + up.y * x.y + up.z * x.z);
  const uz = up.z - x.z * (up.x * x.x + up.y * x.y + up.z * x.z);
  let yl = Math.hypot(ux, uy, uz);
  let yx, yy, yz;
  if (yl < 1e-4) {
    // x is parallel to up: pick any perpendicular
    const t = Math.abs(x.x) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    yx = t[1] * x.z - t[2] * x.y; yy = t[2] * x.x - t[0] * x.z; yz = t[0] * x.y - t[1] * x.x;
    yl = Math.hypot(yx, yy, yz);
  } else {
    yx = ux; yy = uy; yz = uz;
  }
  yx /= yl; yy /= yl; yz /= yl;
  const zx = x.y * yz - x.z * yy, zy = x.z * yx - x.x * yz, zz = x.x * yy - x.y * yx;
  return out.set(x.x, yx, zx, 0, x.y, yy, zy, 0, x.z, yz, zz, 0, 0, 0, 0, 1);
}

export class CarRenderer {
  /**
   * @param design car design
   * @param opts { mode: 'drive' | 'editor', register(material) }
   */
  constructor(design, opts = {}) {
    lazyGeos();
    this.mode = opts.mode || 'drive';
    this.register = opts.register || (() => {});
    this.unregister = opts.unregister || null;
    this.group = new THREE.Group();
    this.group.name = 'car';
    this.mats = carMaterials(design.colors, this.mode);
    const tex = sharedTextures();
    this.mats.tire.normalMap = tex.tread;
    this.mats.tire.normalScale.set(1.4, 1.4);
    this.mats.frame.color.set(0xffffff);
    for (const m of Object.values(this.mats)) if (!m.isMeshBasicMaterial) this.register(m);
    this.showDecorations = true;
    this.showPanels = true;
    this.opaqueFrames = true;
    this.highlight = new Map(); // partId -> color
    this.frameScale = 1; // editor: thinner frames when zoomed in (Settings > Garage)
    this.build(design);
  }

  dispose() {
    this._clear();
    for (const m of Object.values(this.mats)) {
      this.unregister?.(m);
      m.dispose();
    }
  }

  _clear() {
    for (const o of this._owned || []) {
      if (o.geometry && !o.userData.shared) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    }
    this._owned = [];
    this.group.clear();
  }

  _own(o) {
    this._owned.push(o);
    this.group.add(o);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
  }

  setColors(colors) {
    this.colors = { ...colors };
    this.mats.rim.color.set(colors.rims);
    this.mats.joint.color.set(colors.frames);
    this._recolor();
    this._panelColors();
  }

  build(design) {
    this._clear();
    this.design = design;
    this.colors = { ...design.colors };
    this.mats.rim.color.set(this.colors.rims);
    this.mats.joint.color.set(this.colors.frames);
    const n = design.nodes.length;
    this.index = new Map();
    design.nodes.forEach((nd, i) => this.index.set(nd.id, i));
    this.pos = new Float32Array(n * 3);
    this.up = new THREE.Vector3(0, 1, 0);
    this.fwd = new THREE.Vector3(1, 0, 0);
    const parts = design.parts;
    const by = (t) => parts.filter((p) => p.type === t);
    this.frames = by('frame');
    this.shocks = by('shock');
    this.rods = by('rod');
    this.limiters = by('limiter');
    this.panels = by('panel');
    this.wheels = [];
    this.engines = [];
    this.jets = [];
    this.seats = [];
    this.weights = [];
    this.partIndex = new Map(); // partId -> { kind, i }

    // frames + joints
    this.frameMesh = new THREE.InstancedMesh(FRAME_GEO, this.mats.frame, Math.max(1, this.frames.length));
    this.frameMesh.count = this.frames.length;
    this.frameMesh.userData.shared = true;
    this.frames.forEach((p, i) => this.partIndex.set(p.id, { kind: 'frame', i }));
    this._own(this.frameMesh);
    const jointR = new Map();
    for (const p of this.frames) {
      for (const id of p.n) jointR.set(id, Math.max(jointR.get(id) || 0, frameThickness(p) * 0.62));
    }
    this.jointNodes = [...jointR.entries()].map(([id, r]) => ({ i: this.index.get(id), r }));
    this.jointMesh = new THREE.InstancedMesh(JOINT_GEO, this.mats.joint, Math.max(1, this.jointNodes.length));
    this.jointMesh.count = this.mode === 'drive' ? this.jointNodes.length : 0;
    this.jointMesh.userData.shared = true;
    this._own(this.jointMesh);

    // shocks
    const ns = Math.max(1, this.shocks.length);
    this.shockMeshes = [
      new THREE.InstancedMesh(SHOCK.coil, this.mats.coil, ns),
      new THREE.InstancedMesh(SHOCK.body, this.mats.shockBody, ns),
      new THREE.InstancedMesh(SHOCK.rod, this.mats.chrome, ns),
    ];
    for (const m of this.shockMeshes) {
      m.count = this.shocks.length;
      m.userData.shared = true;
      this._own(m);
    }
    this.shocks.forEach((p, i) => this.partIndex.set(p.id, { kind: 'shock', i }));

    // rods + limiters
    this.rodMesh = new THREE.InstancedMesh(ROD_GEO, this.mats.rod, Math.max(1, this.rods.length));
    this.rodMesh.count = this.rods.length;
    this.rodMesh.userData.shared = true;
    this._own(this.rodMesh);
    this.rods.forEach((p, i) => this.partIndex.set(p.id, { kind: 'rod', i }));
    this.limMesh = new THREE.InstancedMesh(ROD_GEO, this.mats.limiter, Math.max(1, this.limiters.length));
    this.limMesh.count = this.limiters.length;
    this.limMesh.userData.shared = true;
    this._own(this.limMesh);
    this.limiters.forEach((p, i) => this.partIndex.set(p.id, { kind: 'limiter', i }));

    // angle locks (a brace across the joint), transmission shafts, slider sleeves
    this.locks = by('angleLock');
    this.shafts = by('transmission');
    this.sliders = by('slider');
    const inst = (geo, mat, list, kind) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      m.count = list.length;
      m.userData.shared = true;
      this._own(m);
      list.forEach((p, i) => this.partIndex.set(p.id, { kind, i }));
      return m;
    };
    this.lockMesh = inst(ROD_GEO, this.mats.lock, this.locks, 'angleLock');
    this.shaftMesh = inst(ROD_GEO, this.mats.chrome, this.shafts, 'transmission');
    this.sleeveMesh = inst(ROD_GEO, this.mats.shockBody, this.sliders, 'slider');

    // node lights
    this.lamps = design.nodes.filter((nd) => nd.light && nd.light.type && nd.light.type !== 'none')
      .map((nd) => ({ i: this.index.get(nd.id), light: nd.light, id: nd.id }));
    this.lampMesh = new THREE.InstancedMesh(JOINT_GEO, this.mats.lamp, Math.max(1, this.lamps.length));
    this.lampMesh.count = this.lamps.length;
    this.lampMesh.userData.shared = true;
    this.lampMesh.castShadow = false;
    this.group.add(this.lampMesh);
    this._owned.push(this.lampMesh);
    this.lightState = { headlights: this.mode !== 'drive', brake: 0, reverse: 0, time: 0 };

    // panels: one mesh per surface material
    this.panelGroups = [];
    const byMat = new Map();
    for (const p of this.panels) {
      const k = PANEL_MATS[p.material] ? p.material : 'polished';
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k).push(p);
    }
    for (const [k, list] of byMat) {
      const n3 = list.length * 9;
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n3), 3));
      pg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n3), 3));
      pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n3), 3));
      const mesh = new THREE.Mesh(pg, this.mats[PANEL_MATS[k]]);
      mesh.frustumCulled = false;
      this._own(mesh);
      if (k === 'glass') mesh.castShadow = false;
      const g = { key: k, list, mesh };
      list.forEach((p, i) => this.partIndex.set(p.id, { kind: 'panel', i, g }));
      this.panelGroups.push(g);
    }
    this._panelColors();

    // models made of [geometry, material key] lists (shared geometry, see partMeshes.js)
    const addModel = (g, list) => {
      for (const [geo, key] of list) {
        const m = new THREE.Mesh(geo, this.mats[key]);
        m.castShadow = m.receiveShadow = true;
        m.userData.shared = true;
        g.add(m);
        this._owned.push(m);
      }
    };
    // wheels: tire per type, rim per style
    for (const p of by('wheel')) {
      const { geometry: tg, rimR } = tireGeometry(p.radius, p.width, p.tireType);
      const rg = rimGeometry(rimR, p.width, p.rim || 0);
      const bg = brakeGeometry(rimR, p.width);
      const outer = new THREE.Group();
      const spinner = new THREE.Group();
      const tireMat = p.tireType === 'slick' ? this.mats.tireSlick : p.tireType === 'offroad' || p.tireType === 'rally' ? this.mats.tireKnobby : this.mats.tire;
      const tire = new THREE.Mesh(tg, tireMat);
      const rim = new THREE.Mesh(rg.rim, this.mats.rim);
      const disc = new THREE.Mesh(bg.disc, this.mats.disc);
      const cal = new THREE.Mesh(bg.caliper, this.mats.caliper);
      const meshes = [tire, rim, disc, cal];
      spinner.add(tire, rim, disc);
      if (rg.dark) {
        const dk = new THREE.Mesh(rg.dark, this.mats.darkMetal);
        spinner.add(dk);
        meshes.push(dk);
      }
      for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; this._owned.push(m); }
      outer.add(spinner, cal);
      this.group.add(outer);
      const w = { part: p, outer, spinner, a: this.index.get(p.n[0]), b: this.index.get(p.n[1]), phi: 0, steer: 0, spinSign: 1, decor: [cal] };
      this.partIndex.set(p.id, { kind: 'wheel', i: this.wheels.length });
      this.wheels.push(w);
    }
    // engines: the model shows the upgrade level (inline-4 / V8 / supercharged V8), size follows power
    for (const p of by('engine')) {
      const g = new THREE.Group();
      addModel(g, engineModel(engineTier(p.level || 10)));
      const s = Math.min(1.7, Math.max(0.65, Math.cbrt(enginePower(p) / 450)));
      this.group.add(g);
      this.partIndex.set(p.id, { kind: 'engine', i: this.engines.length });
      this.engines.push({ part: p, group: g, scale: s, a: this.index.get(p.n[0]), b: this.index.get(p.n[1]) });
    }
    // jets
    for (const p of by('jet')) {
      const g = new THREE.Group();
      const model = jetModel();
      addModel(g, model.parts);
      const flame = new THREE.Mesh(model.flame, this.mats.flame);
      flame.userData.shared = true;
      flame.visible = false;
      g.add(flame);
      this._owned.push(flame);
      this.group.add(g);
      const s = Math.min(2.5, Math.max(0.6, Math.cbrt(jetThrust(p) / 6000)));
      this.partIndex.set(p.id, { kind: 'jet', i: this.jets.length });
      this.jets.push({ part: p, group: g, flame, scale: s, a: this.index.get(p.n[0]), b: this.index.get(p.n[1]), on: 0 });
    }
    // seats: seat type + driver or passenger figure
    for (const p of by('seat')) {
      const g = new THREE.Group();
      addModel(g, seatModel(p.seatType));
      addModel(g, figureModel(p.role === 'passenger' ? 'passenger' : 'driver'));
      this.group.add(g);
      this.partIndex.set(p.id, { kind: 'seat', i: this.seats.length });
      this.seats.push({ part: p, group: g, a: this.index.get(p.n[0]) });
    }
    for (const p of by('weight')) {
      const m = new THREE.Mesh(WEIGHT, this.mats.weight);
      m.castShadow = true;
      m.userData.shared = true;
      this.group.add(m);
      this._owned.push(m);
      const s = Math.cbrt(p.mass / 50);
      this.partIndex.set(p.id, { kind: 'weight', i: this.weights.length });
      this.weights.push({ part: p, mesh: m, scale: s, a: this.index.get(p.n[0]) });
    }
    this._recolor();
    this.setFromDesign(design);
  }

  _panelColors() {
    for (const g of this.panelGroups || []) {
      const col = g.mesh.geometry.attributes.color;
      g.list.forEach((p, i) => {
        const hl = this.highlight.get(p.id);
        _col.set(hl || p.color || this.colors.panels);
        // carbon weave reads as a dark tint of the chosen colour
        if (!hl && g.key === 'carbon') _col.multiplyScalar(0.22);
        for (let k = 0; k < 3; k++) col.setXYZ(i * 3 + k, _col.r, _col.g, _col.b);
      });
      col.needsUpdate = true;
    }
  }

  _recolor() {
    const fc = new THREE.Color(this.colors.frames);
    this.frames.forEach((p, i) => {
      const hl = this.highlight.get(p.id);
      this.frameMesh.setColorAt(i, hl ? _col.set(hl) : p.color ? _col.set(p.color) : fc);
    });
    if (this.frameMesh.instanceColor) this.frameMesh.instanceColor.needsUpdate = true;
    const tint = (mesh, list, base) => {
      list.forEach((p, i) => {
        const hl = this.highlight.get(p.id);
        mesh.setColorAt(i, hl ? _col.set(hl) : _col.set(base));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    tint(this.shockMeshes[0], this.shocks, '#ffffff');
    tint(this.shockMeshes[1], this.shocks, '#ffffff');
    tint(this.rodMesh, this.rods, '#ffffff');
    tint(this.limMesh, this.limiters, '#ffffff');
    tint(this.lockMesh, this.locks, '#f2c04a');
    tint(this.shaftMesh, this.shafts, '#ffffff');
    tint(this.sleeveMesh, this.sliders, '#ffffff');
    this._panelColors();
  }

  /** Driving state for node lights: { headlights: bool, brake: 0..1, reverse: 0..1, time: s }. */
  setLightState(s) {
    Object.assign(this.lightState, s);
  }

  _lampColor(l) {
    const s = this.lightState;
    const k = l.intensity ?? 1;
    switch (l.type) {
      case 'headlight': return _col.setRGB(1, 0.93, 0.8).multiplyScalar(s.headlights ? 3 * k + 0.5 : 0.6);
      case 'taillight': return _col.setRGB(1, 0.05, 0.03).multiplyScalar(s.headlights ? 1.6 * k : 0.35);
      case 'brake': return _col.setRGB(1, 0.04, 0.02).multiplyScalar(0.35 + (s.headlights ? 0.8 : 0) + s.brake * 3.5 * k);
      case 'reverse': return _col.setRGB(1, 1, 1).multiplyScalar(0.3 + s.reverse * 3 * k);
      case 'beacon': {
        const on = this.mode !== 'drive' || Math.sin(s.time * 9) > 0.2;
        return _col.setRGB(1, 0.45, 0.02).multiplyScalar(on ? 3.5 * k : 0.2);
      }
      default: return _col.setRGB(1, 1, 1);
    }
  }

  setHighlight(map) {
    this.highlight = map;
    this._recolor();
  }

  setFramesOpaque(opaque) {
    this.opaqueFrames = opaque;
    this.mats.frame.transparent = !opaque;
    this.mats.frame.opacity = opaque ? 1 : 0.45;
    this.mats.frame.depthWrite = opaque;
    this.mats.frame.needsUpdate = true;
  }

  setPanelsVisible(v) {
    this.showPanels = v;
    for (const g of this.panelGroups) g.mesh.visible = v;
  }

  /** Rendered models of body parts (editor picking): Map partId -> Object3D (visible ones). */
  partObjects() {
    const m = new Map();
    const add = (list, key) => {
      for (const e of list) if (e[key].visible) m.set(e.part.id, e[key]);
    };
    add(this.engines, 'group');
    add(this.jets, 'group');
    add(this.seats, 'group');
    add(this.weights, 'mesh');
    add(this.wheels, 'outer');
    return m;
  }

  /**
   * Editor x-ray like the original: wheels, shocks, engines, seats, jets and ballast are
   * drawn see-through so the nodes inside them stay visible. Frames and panels stay as they are.
   */
  setXray(on) {
    this.xray = on;
    for (const k of XRAY_MATS) {
      const m = this.mats[k];
      if (!m) continue;
      m.transparent = on;
      m.opacity = on ? 0.3 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }

  setDecorationsVisible(v) {
    this.showDecorations = v;
    for (const e of this.engines) e.group.visible = v;
    for (const s of this.seats) s.group.visible = v;
    for (const w of this.weights) w.mesh.visible = v;
  }

  // ---------------- pose ----------------
  setFromDesign(design = this.design) {
    const nm = design.nodes;
    for (let i = 0; i < nm.length; i++) {
      this.pos[i * 3] = nm[i].x;
      this.pos[i * 3 + 1] = nm[i].y;
      this.pos[i * 3 + 2] = nm[i].z;
    }
    this.up.set(0, 1, 0);
    this.fwd.set(1, 0, 0);
    for (const w of this.wheels) {
      w.phi = 0;
      w.steer = 0;
      w.spinSign = 1;
    }
    for (const j of this.jets) j.on = 0;
    this.update();
  }

  setFromSim(sim) {
    const ids = this.design.nodes;
    for (let i = 0; i < ids.length; i++) {
      const k = sim.index.get(ids[i].id);
      this.pos[i * 3] = sim.px[k];
      this.pos[i * 3 + 1] = sim.py[k];
      this.pos[i * 3 + 2] = sim.pz[k];
    }
    this.up.set(sim.up.x, sim.up.y, sim.up.z);
    this.fwd.set(sim.fwd.x, sim.fwd.y, sim.fwd.z);
    const wmap = this._simWheels || (this._simWheels = new Map(sim.wheels.map((w) => [w.partId, w])));
    for (const w of this.wheels) {
      const sw = wmap.get(w.part.id);
      if (!sw) continue;
      w.phi = sw.phi;
      w.steer = sw.steer;
      w.spinSign = sw.spinSign;
    }
    const jmap = this._simJets || (this._simJets = new Map(sim.jets.map((j) => [j.partId, j])));
    for (const j of this.jets) j.on = jmap.get(j.part.id)?.on || 0;
    this._broken = sim;
    this.update();
  }

  _p(i, out) {
    return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  _segment(mesh, k, ia, ib, r) {
    this._p(ia, _a);
    this._p(ib, _b);
    return this._segmentAB(mesh, k, r);
  }

  /** Cylinder instance from _a to _b. */
  _segmentAB(mesh, k, r) {
    _v.subVectors(_b, _a);
    const L = _v.length();
    if (L < 1e-6) {
      _m.makeScale(0, 0, 0);
    } else {
      _v.divideScalar(L);
      _q.setFromUnitVectors(_yAxis, _v);
      _s.set(r, L, r);
      _m.compose(_a, _q, _s);
    }
    mesh.setMatrixAt(k, _m);
    return L;
  }

  update() {
    const sim = this._broken;
    // frames
    this.frames.forEach((p, i) => {
      const ia = this.index.get(p.n[0]), ib = this.index.get(p.n[1]);
      if (sim && sim.isFrameBroken(p.id)) {
        this.frameMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
        return;
      }
      this._segment(this.frameMesh, i, ia, ib, frameRadius(p) * this.frameScale);
    });
    this.frameMesh.instanceMatrix.needsUpdate = true;
    this.frameMesh.computeBoundingSphere();
    this.jointNodes.forEach((j, k) => {
      this._p(j.i, _a);
      _m.makeScale(j.r, j.r, j.r).setPosition(_a);
      this.jointMesh.setMatrixAt(k, _m);
    });
    this.jointMesh.instanceMatrix.needsUpdate = true;
    this.jointMesh.computeBoundingSphere();
    // shocks: coil + body + rod spanning node0 -> node1
    this.shocks.forEach((p, i) => {
      const ia = this.index.get(p.n[0]), ib = this.index.get(p.n[1]);
      this._p(ia, _a);
      this._p(ib, _b);
      _v.subVectors(_b, _a);
      const L = _v.length() || 1e-6;
      _v.divideScalar(L);
      _q.setFromUnitVectors(_yAxis, _v);
      const rs = Math.min(1.8, Math.max(0.7, (p.restLength || L) / 0.7));
      _s.set(rs, L, rs);
      _m.compose(_a, _q, _s);
      for (const m of this.shockMeshes) m.setMatrixAt(i, _m);
    });
    for (const m of this.shockMeshes) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    this.rods.forEach((p, i) => this._segment(this.rodMesh, i, this.index.get(p.n[0]), this.index.get(p.n[1]), 0.012));
    this.rodMesh.instanceMatrix.needsUpdate = true;
    this.rodMesh.computeBoundingSphere();
    this.limiters.forEach((p, i) => this._segment(this.limMesh, i, this.index.get(p.n[0]), this.index.get(p.n[1]), 0.008));
    this.limMesh.instanceMatrix.needsUpdate = true;
    this.limMesh.computeBoundingSphere();
    // angle locks: brace between points 30 % along each frame from the joint (max 0.3 m)
    this.locks.forEach((p, i) => {
      const ia = this.index.get(p.n[0]), ij = this.index.get(p.n[1]), ic = this.index.get(p.n[2]);
      this._p(ij, _jv);
      this._p(ia, _a).sub(_jv);
      const la = _a.length() || 1;
      _a.multiplyScalar(Math.min(0.3, la * 0.3) / la).add(_jv);
      this._p(ic, _b).sub(_jv);
      const lc = _b.length() || 1;
      _b.multiplyScalar(Math.min(0.3, lc * 0.3) / lc).add(_jv);
      this._segmentAB(this.lockMesh, i, 0.014);
    });
    this.lockMesh.instanceMatrix.needsUpdate = true;
    this.lockMesh.computeBoundingSphere();
    this.shafts.forEach((p, i) => this._segment(this.shaftMesh, i, this.index.get(p.n[0]), this.index.get(p.n[1]), p.radius || 0.021));
    this.shaftMesh.instanceMatrix.needsUpdate = true;
    this.shaftMesh.computeBoundingSphere();
    this.sliders.forEach((p, i) => {
      const ia = this.index.get(p.n[0]), ib = this.index.get(p.n[1]), is = this.index.get(p.n[2]);
      this._p(ib, _b);
      this._p(ia, _a);
      _v.subVectors(_b, _a).normalize().multiplyScalar(0.07);
      this._p(is, _a).sub(_v);
      this._p(is, _b).add(_v);
      this._segmentAB(this.sleeveMesh, i, 0.034);
    });
    this.sleeveMesh.instanceMatrix.needsUpdate = true;
    this.sleeveMesh.computeBoundingSphere();
    // lamps
    this.lamps.forEach((l, k) => {
      this._p(l.i, _a);
      const r = l.light.type === 'beacon' ? 0.06 : 0.045;
      _m.makeScale(r, r, r).setPosition(_a);
      this.lampMesh.setMatrixAt(k, _m);
      this.lampMesh.setColorAt(k, this._lampColor(l.light));
    });
    this.lampMesh.instanceMatrix.needsUpdate = true;
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
    this.lampMesh.computeBoundingSphere();
    // panels
    for (const g of this.panelGroups) {
      const pa = g.mesh.geometry.attributes.position;
      g.list.forEach((p, i) => {
        for (let k = 0; k < 3; k++) {
          const ii = this.index.get(p.n[k]);
          pa.setXYZ(i * 3 + k, this.pos[ii * 3], this.pos[ii * 3 + 1], this.pos[ii * 3 + 2]);
        }
      });
      pa.needsUpdate = true;
      g.mesh.geometry.computeVertexNormals();
    }
    // wheels
    for (const w of this.wheels) {
      this._p(w.a, _a);
      this._p(w.b, _b);
      _v.subVectors(_a, _b).normalize();
      basisMatrix(_v, this.up, _m);
      w.outer.position.copy(_a);
      w.outer.quaternion.setFromRotationMatrix(_m);
      if (w.steer) {
        _q.setFromAxisAngle(this.up, -w.steer);
        w.outer.quaternion.premultiply(_q);
      }
      w.spinner.rotation.set(-w.spinSign * w.phi, 0, 0);
    }
    // engines: crank axis node0 (front) <- node1
    for (const e of this.engines) {
      this._p(e.a, _a);
      this._p(e.b, _b);
      _v.subVectors(_a, _b);
      if (_v.lengthSq() < 1e-8) _v.copy(this.fwd);
      _v.normalize();
      basisMatrix(_v, this.up, _m);
      e.group.position.addVectors(_a, _b).multiplyScalar(0.5);
      e.group.quaternion.setFromRotationMatrix(_m);
      e.group.scale.setScalar(e.scale);
    }
    for (const j of this.jets) {
      this._p(j.a, _a);
      this._p(j.b, _b);
      _v.subVectors(_b, _a);
      if (_v.lengthSq() < 1e-8) _v.copy(this.fwd);
      _v.normalize();
      basisMatrix(_v, this.up, _m);
      j.group.position.copy(_a);
      j.group.quaternion.setFromRotationMatrix(_m);
      j.group.scale.setScalar(j.scale);
      j.flame.visible = j.on > 0.01;
      if (j.flame.visible) j.flame.scale.set(0.6 + j.on * 1.6 * (0.85 + Math.random() * 0.3), 1 + j.on * 0.3, 1 + j.on * 0.3);
    }
    for (const s of this.seats) {
      this._p(s.a, _a);
      basisMatrix(this.fwd, this.up, _m);
      s.group.position.copy(_a);
      s.group.quaternion.setFromRotationMatrix(_m);
    }
    for (const w of this.weights) {
      this._p(w.a, _a);
      basisMatrix(this.fwd, this.up, _m);
      w.mesh.position.copy(_a);
      w.mesh.quaternion.setFromRotationMatrix(_m);
      w.mesh.scale.setScalar(w.scale);
    }
  }
}

export { _up };
