// Picking, the modal transform operator (G / R / S) and part placement tools.
import * as THREE from 'three';
import { PART_TYPES, frameRadius } from '../car/parts.js';
import { transmissionFor, mirrorNodeMap } from '../car/design.js';

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
export const AXIS_COLORS = { x: 0xff4d4d, y: 0x55dd55, z: 0x4d8dff };
const _v = new THREE.Vector3();

// ---------------- picking ----------------
// Node handles are drawn as spheres of NODE_RADIUS metres, clamped to a pixel range per view
// (editorScene uses the same numbers), so a click picks a node only on its visible sphere.
export const NODE_RADIUS = 0.045;
export const NODE_PX = [5, 15];

export function nodeRadiusPx(view, point) {
  return Math.min(NODE_PX[1], Math.max(NODE_PX[0], NODE_RADIUS / view.worldPerPixel(point)));
}

function segDistT(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { dist: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

function segDist(px, py, ax, ay, bx, by) {
  return segDistT(px, py, ax, ay, bx, by).dist;
}

const _rc = new THREE.Raycaster();
_rc.layers.enableAll();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _hit = new THREE.Vector3();

/**
 * Pick under the cursor: a node when the cursor is on its sphere, otherwise the nearest part
 * along the view ray. Part bodies (engines, jets, seats, ballast, wheels) are raycast
 * against the rendered models (opts.car = CarRenderer), thin parts are tested on screen.
 * Returns { kind: 'node' | 'part', id } or null.
 */
export function pick(model, view, lx, ly, opts = {}) {
  const d = model.d;
  const proj = new Map();
  for (const n of d.nodes) {
    if (model.hidden.has(n.id)) continue;
    proj.set(n.id, view.project(_v.set(n.x, n.y, n.z), {}));
  }
  if (!opts.partsOnly) {
    // opts.magnet widens the catch radius (tools, snapping), opts.exclude skips nodes
    const extra = opts.magnet ?? 4;
    let best = null, bd = Infinity;
    for (const [id, p] of proj) {
      if (p.behind || opts.exclude?.has(id)) continue;
      const n = model.node(id);
      const r = nodeRadiusPx(view, _v.set(n.x, n.y, n.z)) + extra;
      const dd = Math.hypot(p.x - lx, p.y - ly);
      if (dd > r) continue;
      if (dd < bd - 1 || (best && Math.abs(dd - bd) <= 1 && p.z < best.z)) {
        bd = dd;
        best = { kind: 'node', id, z: p.z };
      }
    }
    if (best) return best;
  }
  if (opts.nodesOnly) return null;
  const ray = view.ray(lx, ly);
  const along = (q) => (q.x - ray.origin.x) * ray.direction.x + (q.y - ray.origin.y) * ray.direction.y + (q.z - ray.origin.z) * ray.direction.z;
  let best = null, bt = Infinity;
  const consider = (id, t) => {
    if (t < bt) {
      bt = t;
      best = { kind: 'part', id, z: t };
    }
  };
  const wpos = (id, out) => {
    const n = model.node(id);
    return out.set(n.x, n.y, n.z);
  };
  // rendered part bodies
  const bodies = opts.car ? opts.car.partObjects() : null;
  if (bodies) {
    _rc.ray.copy(ray);
    for (const [id, obj] of bodies) {
      const p = model.part(id);
      if (!p || model.isHidden(p)) continue;
      const hits = _rc.intersectObject(obj, true);
      if (hits.length) consider(id, along(hits[0].point));
    }
  }
  // over a part body, a thin part only wins when the cursor is on its drawn tube
  const overBody = best !== null;
  for (const p of d.parts) {
    if (bodies?.has(p.id)) continue;
    const ps = p.n.map((id) => proj.get(id));
    if (ps.some((q) => !q || q.behind)) continue;
    switch (p.type) {
      case 'frame': case 'shock': case 'rod': case 'limiter': case 'engine': case 'jet': case 'transmission': {
        const { dist, t } = segDistT(lx, ly, ps[0].x, ps[0].y, ps[1].x, ps[1].y);
        let tol = p.type === 'frame' ? 6 : 8;
        if (overBody) {
          const r = (p.type === 'frame' ? frameRadius(p) : p.type === 'shock' ? 0.04 : 0.015) / view.worldPerPixel(wpos(p.n[0], _a));
          tol = Math.max(1.5, r + 1);
        }
        if (dist < tol) consider(p.id, along(wpos(p.n[0], _a).lerp(wpos(p.n[1], _b), t)));
        break;
      }
      case 'wheel': {
        const n = model.node(p.n[0]);
        const rpx = p.radius / view.worldPerPixel(_v.set(n.x, n.y, n.z));
        if (Math.hypot(lx - ps[0].x, ly - ps[0].y) < rpx) consider(p.id, along(_v));
        break;
      }
      case 'panel':
        if (ray.intersectTriangle(wpos(p.n[0], _a), wpos(p.n[1], _b), wpos(p.n[2], _c), false, _hit)) consider(p.id, along(_hit));
        break;
      case 'angleLock': {
        // the brace drawn across the joint, 30 % of the way along each frame
        const j = ps[1];
        const q1x = j.x + (ps[0].x - j.x) * 0.3, q1y = j.y + (ps[0].y - j.y) * 0.3;
        const q2x = j.x + (ps[2].x - j.x) * 0.3, q2y = j.y + (ps[2].y - j.y) * 0.3;
        if (segDist(lx, ly, q1x, q1y, q2x, q2y) < 8) consider(p.id, along(wpos(p.n[1], _a)));
        break;
      }
      case 'slider': {
        // the sleeve around the sliding node
        const sp = ps[2];
        const dx = ps[1].x - ps[0].x, dy = ps[1].y - ps[0].y;
        const l = Math.hypot(dx, dy) || 1;
        const k = Math.min(18, l * 0.15) / l;
        if (segDist(lx, ly, sp.x - dx * k, sp.y - dy * k, sp.x + dx * k, sp.y + dy * k) < 9) consider(p.id, along(wpos(p.n[2], _a)));
        break;
      }
      case 'seat': case 'weight':
        if (Math.hypot(lx - ps[0].x, ly - ps[0].y) < 22) consider(p.id, along(wpos(p.n[0], _a)));
        break;
      default:
    }
  }
  return best;
}

/** Nodes inside a screen rectangle (viewport-local pixels). */
export function boxPick(model, view, x0, y0, x1, y1) {
  const out = [];
  const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
  for (const n of model.d.nodes) {
    if (model.hidden.has(n.id)) continue;
    const p = view.project(_v.set(n.x, n.y, n.z), {});
    if (!p.behind && p.x >= minx && p.x <= maxx && p.y >= miny && p.y <= maxy) out.push(n.id);
  }
  return out;
}

// ---------------- modal transform ----------------
export class TransformOp {
  /**
   * @param mode 'grab' | 'rotate' | 'scale'
   * @param plan { ids: Set, followers: Map(follower -> driver), center: Set }
   */
  constructor(editor, mode, plan, view, lx, ly, opts = {}) {
    this.editor = editor;
    this.model = editor.model;
    this.mode = mode;
    this.view = view;
    this.followers = plan.followers || new Map();
    this.center = plan.center || new Set();
    this.drivers = [...plan.ids].filter((id) => !this.followers.has(id));
    this.all = new Set([...plan.ids, ...this.followers.keys()]);
    this.orig = new Map();
    for (const id of this.all) {
      const n = this.model.node(id);
      if (n) this.orig.set(id, { x: n.x, y: n.y, z: n.z });
    }
    const piv = new THREE.Vector3();
    for (const id of this.drivers) piv.add(_v.set(this.orig.get(id).x, this.orig.get(id).y, this.orig.get(id).z));
    piv.divideScalar(Math.max(1, this.drivers.length));
    this.pivot = piv;
    this.pivotS = view.project(piv, {});
    this.start = { x: lx, y: ly };
    this.mouse = { x: lx, y: ly };
    this.vm = { x: lx, y: ly };
    this.axis = null;
    this.plane = false;
    this.numeric = '';
    this.tweak = !!opts.tweak; // started by click-drag: confirm on release
    // grab: the node being dragged snaps onto a node under the cursor and connects to it on release
    this.lead = opts.lead ?? null;
    this.snapTarget = null;
    this.ctrl = false;
    this.shift = false;
    this.text = '';
    this.apply();
  }

  get axisVec() {
    return this.axis ? AXES[this.axis] : null;
  }

  setAxis(a, plane) {
    if (this.axis === a && this.plane === plane) {
      this.axis = null;
      this.plane = false;
    } else {
      this.axis = a;
      this.plane = plane;
    }
    this.apply();
  }

  onMove(lx, ly, e) {
    const k = e.shiftKey ? 0.1 : 1;
    this.vm.x += (lx - this.mouse.x) * k;
    this.vm.y += (ly - this.mouse.y) * k;
    this.mouse = { x: lx, y: ly };
    this.ctrl = e.ctrlKey || e.metaKey;
    this.apply();
  }

  /** Returns true if the key was consumed. */
  onKey(e) {
    const k = e.key;
    if (k === 'x' || k === 'X' || k === 'y' || k === 'Y' || k === 'z' || k === 'Z') {
      this.setAxis(k.toLowerCase(), e.shiftKey);
      return true;
    }
    if (/^[0-9]$/.test(k) || k === '.' || (k === '-' && this.numeric === '')) {
      this.numeric += k;
      this.apply();
      return true;
    }
    if (k === '-' && this.numeric) {
      this.numeric = this.numeric.startsWith('-') ? this.numeric.slice(1) : `-${this.numeric}`;
      this.apply();
      return true;
    }
    if (k === 'Backspace') {
      this.numeric = this.numeric.slice(0, -1);
      this.apply();
      return true;
    }
    if (k === 'Control') {
      this.ctrl = true;
      this.apply();
      return true;
    }
    return false;
  }

  snapOn() {
    return this.model.snap !== this.ctrl; // Ctrl toggles snapping
  }

  _closestOnAxis(lx, ly, axis) {
    const ray = this.view.ray(lx, ly);
    // closest points between ray (o + t d) and axis line (p + s a)
    const a = axis, d = ray.direction, w0 = ray.origin.clone().sub(this.pivot);
    const A = a.dot(a), B = a.dot(d), C = d.dot(d), D = a.dot(w0), E = d.dot(w0);
    const den = A * C - B * B;
    if (Math.abs(den) < 1e-9) return 0;
    return (C * D - B * E) / den;
  }

  apply() {
    const m = this.model;
    const num = this.numeric !== '' && this.numeric !== '-' && this.numeric !== '.' ? parseFloat(this.numeric) : null;
    const results = new Map();
    const snap = this.snapOn();
    if (this.mode === 'grab') {
      const delta = new THREE.Vector3();
      if (num !== null) {
        delta.copy(this.axisVec || AXES.x).multiplyScalar(num);
      } else if (this.axis && !this.plane) {
        const s0 = this._closestOnAxis(this.start.x, this.start.y, this.axisVec);
        const s1 = this._closestOnAxis(this.vm.x, this.vm.y, this.axisVec);
        delta.copy(this.axisVec).multiplyScalar(s1 - s0);
      } else {
        const n = this.axis ? this.axisVec : this.view.dir();
        const p0 = this.view.planePoint(this.start.x, this.start.y, this.pivot, n);
        const p1 = this.view.planePoint(this.vm.x, this.vm.y, this.pivot, n);
        if (p0 && p1) delta.subVectors(p1, p0);
      }
      // dragging a node over another node lands exactly on it (2D cursor -> 3D node)
      this.snapTarget = null;
      if (this.lead !== null && num === null && !this.axis) {
        const hit = pick(m, this.view, this.vm.x, this.vm.y, { nodesOnly: true, magnet: 14, exclude: this.all });
        if (hit) {
          const t = m.node(hit.id);
          const driver = this.followers.get(this.lead);
          if (driver === undefined) {
            const o = this.orig.get(this.lead);
            delta.set(t.x - o.x, t.y - o.y, t.z - o.z);
          } else {
            // the dragged node mirrors its driver: move the driver onto the target's mirror
            const o = this.orig.get(driver);
            delta.set(t.x - o.x, t.y - o.y, -t.z - o.z);
          }
          this.snapTarget = hit.id;
        }
      }
      if (snap && num === null && this.snapTarget === null) {
        delta.x = m.snapValue(delta.x, true);
        delta.y = m.snapValue(delta.y, true);
        delta.z = m.snapValue(delta.z, true);
      }
      for (const id of this.drivers) {
        const o = this.orig.get(id);
        results.set(id, { x: o.x + delta.x, y: o.y + delta.y, z: o.z + delta.z });
      }
      this.editor.hover = this.snapTarget !== null ? { kind: 'node', id: this.snapTarget } : null;
      const ax = this.axis ? (this.plane ? `plane ⟂ ${this.axis.toUpperCase()}` : `along ${this.axis.toUpperCase()}`) : '';
      const snapText = this.snapTarget !== null ? `   →  release to connect to node #${this.snapTarget}` : '';
      this.text = `Move  D: ${delta.length().toFixed(3)} m  (${delta.x.toFixed(3)}, ${delta.y.toFixed(3)}, ${delta.z.toFixed(3)}) ${ax}${this.numeric ? `  [${this.numeric}]` : ''}${snapText}`;
    } else if (this.mode === 'rotate') {
      const c = this.pivotS;
      const a0 = Math.atan2(-(this.start.y - c.y), this.start.x - c.x);
      const a1 = Math.atan2(-(this.vm.y - c.y), this.vm.x - c.x);
      let ang = a1 - a0;
      let axis = this.axisVec ? this.axisVec.clone() : this.view.dir().clone();
      if (this.axisVec && axis.dot(this.view.dir()) < 0) ang = -ang;
      if (num !== null) ang = (num * Math.PI) / 180;
      else if (snap) ang = Math.round(ang / (Math.PI / 36)) * (Math.PI / 36);
      const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
      for (const id of this.drivers) {
        const o = this.orig.get(id);
        const p = _v.set(o.x, o.y, o.z).sub(this.pivot).applyQuaternion(q).add(this.pivot);
        results.set(id, { x: p.x, y: p.y, z: p.z });
      }
      this.text = `Rotate  ${((ang * 180) / Math.PI).toFixed(1)}°${this.axis ? ` around ${this.axis.toUpperCase()}` : ' (view axis)'}${this.numeric ? `  [${this.numeric}]` : ''}`;
    } else {
      const c = this.pivotS;
      const d0 = Math.max(1, Math.hypot(this.start.x - c.x, this.start.y - c.y));
      let f = Math.hypot(this.vm.x - c.x, this.vm.y - c.y) / d0;
      if (num !== null) f = num;
      else if (snap) f = Math.round(f * 10) / 10;
      for (const id of this.drivers) {
        const o = this.orig.get(id);
        const r = _v.set(o.x, o.y, o.z).sub(this.pivot);
        let out;
        if (!this.axis) out = r.multiplyScalar(f);
        else {
          const a = this.axisVec;
          const along = a.clone().multiplyScalar(r.dot(a));
          const perp = r.clone().sub(along);
          out = this.plane ? along.add(perp.multiplyScalar(f)) : perp.add(along.multiplyScalar(f));
        }
        out.add(this.pivot);
        results.set(id, { x: out.x, y: out.y, z: out.z });
      }
      this.text = `Scale  ${f.toFixed(3)}${this.axis ? (this.plane ? ` (plane ⟂ ${this.axis.toUpperCase()})` : ` along ${this.axis.toUpperCase()}`) : ''}${this.numeric ? `  [${this.numeric}]` : ''}`;
    }
    // write positions; centre-line nodes stay on the symmetry plane, followers mirror drivers
    for (const [id, p] of results) {
      const n = m.node(id);
      if (!n) continue;
      n.x = p.x; n.y = p.y; n.z = this.center.has(id) && m.symmetry ? 0 : p.z;
    }
    for (const [f, dId] of this.followers) {
      const n = m.node(f), src = m.node(dId);
      if (n && src) { n.x = src.x; n.y = src.y; n.z = -src.z; }
    }
    this.editor.scene.setAxisLine(this.pivot, this.axisVec, this.axis ? AXIS_COLORS[this.axis] : 0);
    m.changed('positions');
  }

  confirm() {
    this.editor.scene.setAxisLine(null, null);
    if (this.snapTarget !== null && this.lead !== null) {
      // connect: the dragged node merges into the target (and its mirror twin into the target's twin)
      const m = this.model;
      const pairs = [[this.lead, this.snapTarget]];
      if (m.symmetry) {
        const mm = mirrorNodeMap(m.d);
        const twin = this.followers.get(this.lead) ?? [...this.followers].find(([, d]) => d === this.lead)?.[0];
        const tTwin = mm.get(this.snapTarget);
        if (twin !== undefined && tTwin !== undefined && tTwin !== this.snapTarget && twin !== tTwin) pairs.push([twin, tTwin]);
      }
      for (const [a, b] of pairs) m.mergeInto(a, b);
      this.editor.hover = null;
    }
    this.model.changed('topology');
  }

  cancel() {
    for (const [id, o] of this.orig) {
      const n = this.model.node(id);
      if (n) { n.x = o.x; n.y = o.y; n.z = o.z; }
    }
    this.editor.scene.setAxisLine(null, null);
    this.editor.hover = null;
    this.model.changed('positions');
  }
}

// ---------------- part tools ----------------
// Parts dropped in as a whole with one click in empty space: node positions around the
// snapped cursor point p (as in the original: "place the whole new part where you want to").
const ASSEMBLIES = {
  // hub at the cursor, the axle node 0.25 m toward the car's centre line
  wheel: (p) => [p, { x: p.x, y: p.y, z: p.z + (p.z > 0.02 ? -0.25 : 0.25) }],
  engine: (p) => [{ x: p.x + 0.25, y: p.y, z: p.z }, { x: p.x - 0.25, y: p.y, z: p.z }],
  // nozzle at the cursor, thrust toward +X (forward)
  jet: (p) => [p, { x: p.x + 0.6, y: p.y, z: p.z }],
  seat: (p) => [p],
  weight: (p) => [p],
};

export class PartTool {
  constructor(editor, type) {
    this.editor = editor;
    this.model = editor.model;
    this.type = type;
    this.needs = PART_TYPES[type].nodes;
    this.picked = [];
    this.anchor = null;
    this.engine = null; // transmission tool: the engine picked first
    this.length = 0;
  }

  get assembly() {
    return ASSEMBLIES[this.type] || null;
  }

  hint() {
    const labels = {
      frame: ['Click a node or empty space to start a frame', 'Click the next node (Esc / right click to stop chaining)'],
      shock: ['Click the first shock mount', 'Click the second shock mount'],
      rod: ['Click the first rod end', 'Click the second rod end'],
      limiter: ['Click the first node', 'Click the second node'],
      wheel: ['Click anywhere to place a wheel with its axle (on a node: that node is the wheel centre)'],
      engine: ['Click empty space to place the whole engine, or a node to stretch it between two nodes', 'Click the rear engine mount'],
      jet: ['Click empty space to place the whole jet, or a node (the nozzle) to stretch it', 'Click a node in the thrust direction'],
      panel: ['Click the first corner', 'Click the second corner', 'Click the third corner'],
      seat: ['Click anywhere to place a seat'],
      weight: ['Click anywhere to place ballast'],
      angleLock: ['Click the end of the first frame', 'Click the joint node where the frames meet', 'Click the end of the second frame'],
      transmission: ['Click an engine', 'Click a wheel to link it to the engine'],
    };
    const l = labels[this.type] || ['Click nodes'];
    const step = this.type === 'transmission' ? (this.engine ? 1 : 0) : this.picked.length;
    const len = this.picked.length && this.length > 0 && this.type !== 'panel' ? `  (${this.length.toFixed(2)} m)` : '';
    return `${PART_TYPES[this.type].label}: ${l[Math.min(step, l.length - 1)]}${len}. Esc cancels.`;
  }

  /** Where a click in empty space would create a node. */
  placePoint(view, lx, ly) {
    const m = this.model;
    const last = this.picked.length ? m.node(this.picked[this.picked.length - 1]) : null;
    const anchor = last ? new THREE.Vector3(last.x, last.y, last.z) : this.anchor || new THREE.Vector3(0, 0.4, 0);
    const n = view.ortho || view.fixed ? view.dir().clone() : view.workPlaneNormal();
    const p = view.planePoint(lx, ly, anchor, n);
    if (!p) return null;
    p.x = m.snapValue(p.x);
    p.y = m.snapValue(p.y);
    p.z = m.snapValue(p.z);
    if (m.symmetry && Math.abs(p.z) < 0.03) p.z = 0;
    return p;
  }

  /** Node points of the whole part dropped at p (an existing node keeps its id). */
  assemblyPoints(p, nodeId = null) {
    const pts = this.assembly(p);
    if (nodeId != null) pts[0] = { ...pts[0], id: nodeId };
    return pts;
  }

  onMove(view, lx, ly) {
    const m = this.model;
    const scene = this.editor.scene;
    if (this.type === 'transmission') return this._transmissionMove(view, lx, ly);
    const hit = pick(m, view, lx, ly, { nodesOnly: true, magnet: 12 });
    let target = null;
    if (hit) {
      const n = m.node(hit.id);
      target = new THREE.Vector3(n.x, n.y, n.z);
      scene.setGhost(null);
    } else if (this.allowsNewNodes() || this.assembly) {
      target = this.placePoint(view, lx, ly);
      if (target && !this.assembly) scene.setGhost(target, view.worldPerPixel(target) * 5);
      else scene.setGhost(null);
    } else scene.setGhost(null);
    // see-through preview of the whole part (until stretching starts)
    const stretching = this.picked.length > 0 || (hit && (this.type === 'engine' || this.type === 'jet'));
    if (this.assembly && target && !stretching) scene.setPartGhost(this.type, this.defaultsFor(target), this.assemblyPoints(target));
    else scene.setPartGhost(null);
    const pts = this.picked.map((id) => {
      const n = m.node(id);
      return new THREE.Vector3(n.x, n.y, n.z);
    });
    if (target && pts.length) pts.push(target);
    this.length = pts.length >= 2 ? pts[pts.length - 1].distanceTo(pts[pts.length - 2]) : 0;
    if (this.type === 'panel' && pts.length === 3) pts.push(pts[0].clone());
    scene.setPreview(pts.length >= 2 ? pts : null);
    return hit;
  }

  allowsNewNodes() {
    return ['frame', 'panel', 'shock', 'rod', 'limiter', 'jet', 'engine'].includes(this.type);
  }

  /** Returns a status message or null. */
  onClick(view, lx, ly) {
    const m = this.model;
    if (this.type === 'transmission') return this._transmissionClick(view, lx, ly);
    const hit = pick(m, view, lx, ly, { nodesOnly: true, magnet: 12 });
    // whole-part placement: empty space for every assembly part, any node for wheel / seat / ballast
    if (this.assembly && !this.picked.length && (!hit || !(this.type === 'engine' || this.type === 'jet'))) {
      let p;
      if (hit) {
        const n = m.node(hit.id);
        p = new THREE.Vector3(n.x, n.y, n.z);
      } else p = this.placePoint(view, lx, ly);
      if (!p) return null;
      m.snapshot();
      const ids = this.assemblyPoints(p, hit ? hit.id : null).map((q) => q.id ?? m.createNode(q.x, q.y, q.z).id);
      const created = m.createPart(this.type, ids, this.defaultsFor(p));
      this.editor.scene.setPartGhost(null);
      if (!created) {
        m.undo();
        return 'That part already exists.';
      }
      m.clearSelection();
      m.sel.parts.add(created.id);
      m.sel.activePart = created.id;
      m.changed('topology');
      this._placed();
      return null;
    }
    let id = null;
    if (!this.picked.length) m.snapshot();
    if (hit) id = hit.id;
    else if (this.allowsNewNodes()) {
      const p = this.placePoint(view, lx, ly);
      if (!p) return null;
      id = m.createNode(p.x, p.y, p.z).id;
      m.changed('topology');
    } else return 'Click an existing node.';
    if (this.picked.includes(id)) return null;
    this.picked.push(id);
    if (this.picked.length >= this.needs) {
      const created = m.createPart(this.type, this.picked, this.defaultsFor());
      if (created) {
        m.clearSelection();
        m.sel.parts.add(created.id);
        m.sel.activePart = created.id;
      }
      const last = this.picked[this.picked.length - 1];
      const chain = this.chaining;
      this.picked = this.type === 'frame' && chain ? [last] : [];
      m.changed('topology');
      if (this.type !== 'frame' || !chain) this.editor.scene.setPreview(null);
      if (created) this._placed();
      return created ? null : 'That part already exists.';
    }
    m.changed('selection');
    return null;
  }

  /** Settings > Garage "Keep the part tool active": frames chain, tools stay on. */
  get chaining() {
    return !!this.editor.app?.settings?.chainTools;
  }

  /** After a part is placed the tool switches off (like the original) unless chaining is on. */
  _placed() {
    if (!this.chaining) this.editor.cancelTool();
  }

  /** Engine or wheel under the cursor (its body or one of its nodes). */
  _partAt(view, lx, ly, type) {
    const m = this.model;
    const hit = pick(m, view, lx, ly, { car: this.editor.scene.car, magnet: 10 });
    if (!hit) return null;
    if (hit.kind === 'part') {
      const p = m.part(hit.id);
      return p?.type === type ? p : null;
    }
    return m.d.parts.find((p) => p.type === type && p.n.includes(hit.id)) || null;
  }

  _transmissionMove(view, lx, ly) {
    const scene = this.editor.scene;
    const want = this.engine ? 'wheel' : 'engine';
    const part = this._partAt(view, lx, ly, want);
    if (this.engine) {
      const m = this.model;
      const from = (wp) => {
        const n = m.node(wp ? transmissionFor(m.d, this.engine, wp).n[0] : this.engine.n[0]);
        return new THREE.Vector3(n.x, n.y, n.z);
      };
      let to;
      if (part) {
        const a = m.node(part.n[1]);
        to = new THREE.Vector3(a.x, a.y, a.z);
      } else to = this.placePoint(view, lx, ly);
      scene.setPreview(to ? [from(part), to] : null);
    }
    return part ? { kind: 'part', id: part.id } : null;
  }

  _transmissionClick(view, lx, ly) {
    const m = this.model;
    if (!this.engine) {
      const e = this._partAt(view, lx, ly, 'engine');
      if (!e) return 'Click an engine (its body or one of its nodes) first.';
      this.engine = e;
      return null;
    }
    const w = this._partAt(view, lx, ly, 'wheel');
    if (!w) return 'Click a wheel (its body or one of its nodes) to link it to the engine.';
    const t = transmissionFor(m.d, this.engine, w);
    if (m.d.parts.some((p) => p.type === 'transmission' && p.engine === this.engine.id && p.wheel === w.id)) return 'That wheel is already linked to this engine.';
    m.snapshot();
    const created = m.createPart('transmission', t.n, { engine: t.engine, wheel: t.wheel });
    if (!created) {
      m.undoStack.pop();
      return 'That shaft already exists.';
    }
    m.clearSelection();
    m.sel.parts.add(created.id);
    m.sel.activePart = created.id;
    m.changed('topology');
    // with chaining on, the engine stays picked so more wheels can be linked
    this.engine = m.part(this.engine.id);
    this._placed();
    return null;
  }

  defaultsFor(at = null) {
    const m = this.model;
    if (this.type === 'wheel') {
      // front wheels steer, rear wheels get the hand brake (relative to the car's centre)
      const n = at || m.node(this.picked[0]);
      const xs = m.d.nodes.map((q) => q.x);
      const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
      return n.x > mid ? { steer: 30, handbrakeKey: 'none' } : { steer: 0, handbrakeKey: 'handbrake' };
    }
    if (this.type === 'seat') return { role: m.d.parts.some((p) => p.type === 'seat' && p.role !== 'passenger') ? 'passenger' : 'driver' };
    return {};
  }

  cancel() {
    this.picked = [];
    this.engine = null;
    this.length = 0;
    this.editor.scene.setPreview(null);
    this.editor.scene.setGhost(null);
    this.editor.scene.setPartGhost(null);
  }
}