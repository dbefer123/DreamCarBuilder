// Editor model: the design being edited, selection, undo history and editing operations.
// All operations respect symmetry mode (mirror across Z = 0).
import {
  addNode, addPart, removeNodes, removeParts, nodeMap, findPart, mirrorNodeMap, mirrorPart, normalizeDesign, cloneDesign,
  migrateDesign, CENTER_EPS, DESIGN_VERSION,
} from '../car/design.js';
import { PART_TYPES, partDefaults } from '../car/parts.js';

const MAX_HISTORY = 120;
const MIRROR_KEYS = { steerLeft: 'steerRight', steerRight: 'steerLeft' };

export class EditorModel {
  constructor(design, onChange) {
    this.d = design;
    this.onChange = onChange; // (kind: 'topology' | 'positions' | 'selection')
    this.sel = { nodes: new Set(), parts: new Set(), activeNode: null, activePart: null };
    this.hidden = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.symmetry = true;
    this.snap = true;
    this.grid = 0.05;
  }

  // ---------------- history ----------------
  snapshot() {
    this.undoStack.push(JSON.stringify(this.d));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.d));
    this._restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.d));
    this._restore(this.redoStack.pop());
    return true;
  }

  _restore(json) {
    const d = JSON.parse(json);
    Object.keys(this.d).forEach((k) => delete this.d[k]);
    Object.assign(this.d, d);
    const ids = new Set(this.d.nodes.map((n) => n.id));
    const pids = new Set(this.d.parts.map((p) => p.id));
    for (const id of [...this.sel.nodes]) if (!ids.has(id)) this.sel.nodes.delete(id);
    for (const id of [...this.sel.parts]) if (!pids.has(id)) this.sel.parts.delete(id);
    this.changed('topology');
  }

  replaceDesign(d) {
    this.snapshot();
    Object.keys(this.d).forEach((k) => delete this.d[k]);
    Object.assign(this.d, cloneDesign(d));
    this.clearSelection();
    this.hidden.clear();
    this.changed('topology');
  }

  changed(kind) {
    this.onChange?.(kind);
  }

  // ---------------- helpers ----------------
  node(id) {
    return this.d.nodes.find((n) => n.id === id);
  }

  part(id) {
    return this.d.parts.find((p) => p.id === id);
  }

  snapValue(v, enabled = this.snap) {
    return enabled ? Math.round(v / this.grid) * this.grid : v;
  }

  /** Node at (nearly) the same position, or a new node. */
  nodeAt(x, y, z) {
    const ex = this.d.nodes.find((n) => Math.abs(n.x - x) < 1e-3 && Math.abs(n.y - y) < 1e-3 && Math.abs(n.z - z) < 1e-3);
    return ex || addNode(this.d, x, y, z);
  }

  /** Create a node (and its mirror when symmetry is on). Returns the main node. */
  createNode(x, y, z) {
    if (this.symmetry && Math.abs(z) < 0.02) z = 0;
    const n = this.nodeAt(x, y, z);
    if (this.symmetry && Math.abs(z) > CENTER_EPS) this.nodeAt(x, y, -z);
    return n;
  }

  /** Create a part and, with symmetry on, its mirrored twin. */
  createPart(type, ids, props = {}) {
    if (new Set(ids).size !== ids.length) return null;
    if (findPart(this.d, type, ids)) return null;
    const p = addPart(this.d, type, ids, props);
    if (this.symmetry) {
      const mm = mirrorNodeMap(this.d);
      // make sure mirror nodes exist
      for (const id of ids) {
        if (!mm.has(id)) {
          const n = this.node(id);
          const m = this.nodeAt(n.x, n.y, -n.z);
          mm.set(id, m.id);
          mm.set(m.id, id);
        }
      }
      mirrorPart(this.d, p, mm);
    }
    return p;
  }

  // ---------------- selection ----------------
  clearSelection() {
    this.sel.nodes.clear();
    this.sel.parts.clear();
    this.sel.activeNode = null;
    this.sel.activePart = null;
  }

  select(hit, extend = false) {
    if (!extend) this.clearSelection();
    if (!hit) {
      this.changed('selection');
      return;
    }
    if (hit.kind === 'node') {
      if (extend && this.sel.nodes.has(hit.id) && this.sel.activeNode === hit.id) {
        this.sel.nodes.delete(hit.id);
        this.sel.activeNode = null;
      } else {
        this.sel.nodes.add(hit.id);
        this.sel.activeNode = hit.id;
      }
    } else {
      if (extend && this.sel.parts.has(hit.id) && this.sel.activePart === hit.id) {
        this.sel.parts.delete(hit.id);
        this.sel.activePart = null;
      } else {
        this.sel.parts.add(hit.id);
        this.sel.activePart = hit.id;
      }
    }
    this.changed('selection');
  }

  selectAll() {
    for (const n of this.d.nodes) if (!this.hidden.has(n.id)) this.sel.nodes.add(n.id);
    for (const p of this.d.parts) if (!this.isHidden(p)) this.sel.parts.add(p.id);
    this.changed('selection');
  }

  isHidden(p) {
    return p.n.some((id) => this.hidden.has(id));
  }

  invertSelection() {
    const nodes = new Set(this.d.nodes.filter((n) => !this.sel.nodes.has(n.id) && !this.hidden.has(n.id)).map((n) => n.id));
    const parts = new Set(this.d.parts.filter((p) => !this.sel.parts.has(p.id) && !this.isHidden(p)).map((p) => p.id));
    this.sel.nodes = nodes;
    this.sel.parts = parts;
    this.sel.activeNode = null;
    this.sel.activePart = null;
    this.changed('selection');
  }

  /** After box-selecting nodes, also select parts whose nodes are all selected. */
  selectNodes(ids, extend) {
    if (!extend) this.clearSelection();
    for (const id of ids) this.sel.nodes.add(id);
    for (const p of this.d.parts) if (p.n.every((id) => this.sel.nodes.has(id))) this.sel.parts.add(p.id);
    this.changed('selection');
  }

  /** Icon row: keep only one part type ('point' = nodes) out of the current selection. */
  keepOnlyType(type) {
    if (type !== 'point') {
      this.sel.nodes.clear();
      this.sel.activeNode = null;
    }
    for (const id of [...this.sel.parts]) if (type === 'point' || this.part(id)?.type !== type) this.sel.parts.delete(id);
    if (this.sel.activePart != null && !this.sel.parts.has(this.sel.activePart)) this.sel.activePart = [...this.sel.parts][0] ?? null;
    this.changed('selection');
  }

  /** Icon row: select every part of a type (replacing the selection unless add). */
  selectByType(type, add = false) {
    if (!add) this.clearSelection();
    for (const p of this.d.parts) if (p.type === type && !this.isHidden(p)) this.sel.parts.add(p.id);
    this.sel.activePart = this.d.parts.find((p) => p.type === type && this.sel.parts.has(p.id))?.id ?? null;
    this.changed('selection');
  }

  /** Icon row: add every part with the same type and settings as a selected part. */
  selectSameParts() {
    const refs = [...this.sel.parts].map((id) => this.part(id)).filter(Boolean);
    const key = (p) => JSON.stringify(Object.entries(p).filter(([k]) => k !== 'id' && k !== 'n').sort());
    const want = new Set(refs.map(key));
    for (const p of this.d.parts) if (!this.isHidden(p) && want.has(key(p))) this.sel.parts.add(p.id);
    this.changed('selection');
  }

  /** Nodes affected by a transform: selected nodes + nodes of selected parts. */
  affectedNodes() {
    const set = new Set(this.sel.nodes);
    for (const id of this.sel.parts) {
      const p = this.part(id);
      if (p) for (const n of p.n) set.add(n);
    }
    for (const id of [...set]) if (this.hidden.has(id)) set.delete(id);
    return set;
  }

  /**
   * Symmetry pairs for a transform: drivers move freely, followers mirror their driver.
   * Returns { drivers: [id], followers: Map(followerId -> driverId), center: Set(id) }.
   */
  symmetryPlan(ids) {
    const drivers = [];
    const followers = new Map();
    const center = new Set();
    if (!this.symmetry) return { drivers: [...ids], followers, center };
    const mm = mirrorNodeMap(this.d);
    const done = new Set();
    for (const id of ids) {
      if (done.has(id)) continue;
      const n = this.node(id);
      const m = mm.get(id);
      if (m === id) {
        center.add(id);
        drivers.push(id);
        done.add(id);
        continue;
      }
      // the +Z member of a pair drives, the other follows
      if (m !== undefined && ids.has(m) && n.z < 0) continue;
      drivers.push(id);
      done.add(id);
      if (m !== undefined) {
        followers.set(m, id);
        done.add(m);
      }
    }
    // members whose driver was skipped above
    for (const id of ids) {
      if (!done.has(id)) {
        const m = mm.get(id);
        if (m !== undefined && done.has(m)) followers.set(id, m);
        else drivers.push(id);
      }
    }
    return { drivers, followers, center };
  }

  // ---------------- operations ----------------
  deleteSelection() {
    if (!this.sel.nodes.size && !this.sel.parts.size) return;
    this.snapshot();
    const nodeIds = new Set(this.sel.nodes);
    const partIds = new Set(this.sel.parts);
    if (this.symmetry) {
      const mm = mirrorNodeMap(this.d);
      for (const id of [...nodeIds]) if (mm.has(id)) nodeIds.add(mm.get(id));
      for (const id of [...partIds]) {
        const p = this.part(id);
        if (!p) continue;
        const ids = p.n.map((n) => mm.get(n));
        if (ids.every((x) => x !== undefined)) {
          const q = findPart(this.d, p.type, ids);
          if (q) partIds.add(q.id);
        }
      }
    }
    removeParts(this.d, partIds);
    removeNodes(this.d, nodeIds);
    this.clearSelection();
    this.changed('topology');
  }

  /** F: 2 nodes -> frame, 3 nodes -> panel, 4 nodes -> two panels. */
  fill() {
    const ids = [...this.sel.nodes];
    if (ids.length < 2 || ids.length > 4) return 'Select 2 nodes for a frame, 3 or 4 for panels.';
    this.snapshot();
    let created = null;
    if (ids.length === 2) created = this.createPart('frame', ids);
    else if (ids.length === 3) created = this.createPart('panel', ids);
    else {
      // order the 4 nodes around their centroid in the best-fit plane
      const ns = ids.map((id) => this.node(id));
      const c = ns.reduce((a, n) => ({ x: a.x + n.x / 4, y: a.y + n.y / 4, z: a.z + n.z / 4 }), { x: 0, y: 0, z: 0 });
      const u = { x: ns[0].x - c.x, y: ns[0].y - c.y, z: ns[0].z - c.z };
      const v0 = { x: ns[1].x - c.x, y: ns[1].y - c.y, z: ns[1].z - c.z };
      const nrm = { x: u.y * v0.z - u.z * v0.y, y: u.z * v0.x - u.x * v0.z, z: u.x * v0.y - u.y * v0.x };
      const v = { x: nrm.y * u.z - nrm.z * u.y, y: nrm.z * u.x - nrm.x * u.z, z: nrm.x * u.y - nrm.y * u.x };
      const ang = (n) => Math.atan2((n.x - c.x) * v.x + (n.y - c.y) * v.y + (n.z - c.z) * v.z, (n.x - c.x) * u.x + (n.y - c.y) * u.y + (n.z - c.z) * u.z);
      ns.sort((a, b) => ang(a) - ang(b));
      created = this.createPart('panel', [ns[0].id, ns[1].id, ns[2].id]);
      this.createPart('panel', [ns[0].id, ns[2].id, ns[3].id]);
    }
    if (!created) {
      this.undoStack.pop();
      return 'That part already exists.';
    }
    this.clearSelection();
    this.sel.parts.add(created.id);
    this.sel.activePart = created.id;
    this.changed('topology');
    return null;
  }

  /** Duplicate selected nodes (and parts among them) in place; returns the new node ids. */
  duplicate() {
    const sel = this.affectedNodes();
    if (!sel.size) return null;
    this.snapshot();
    const map = new Map();
    const plan = this.symmetryPlan(sel);
    const ids = new Set([...sel, ...plan.followers.keys()]);
    const newIds = [];
    for (const id of ids) {
      const n = this.node(id);
      const nn = addNode(this.d, n.x, n.y, n.z);
      if (n.friction != null) nn.friction = n.friction;
      if (n.light) nn.light = structuredClone(n.light);
      map.set(id, nn.id);
      newIds.push(nn.id);
    }
    const parts = this.d.parts.filter((p) => p.n.every((n) => ids.has(n)));
    for (const p of parts) {
      const props = { ...p };
      delete props.id; delete props.n; delete props.type;
      addPart(this.d, p.type, p.n.map((n) => map.get(n)), props);
    }
    this.clearSelection();
    for (const id of newIds) this.sel.nodes.add(id);
    for (const p of this.d.parts) if (p.n.every((n) => this.sel.nodes.has(n))) this.sel.parts.add(p.id);
    // symmetry pairing for the following grab
    const followers = new Map();
    for (const [f, dId] of plan.followers) followers.set(map.get(f), map.get(dId));
    this.changed('topology');
    return { ids: new Set(newIds), followers, center: new Set([...plan.center].map((id) => map.get(id))) };
  }

  /** E: extrude selected nodes; new nodes are joined to the originals by frames. */
  extrude() {
    const sel = new Set(this.sel.nodes);
    if (!sel.size) return null;
    this.snapshot();
    const plan = this.symmetryPlan(sel);
    const ids = new Set([...sel, ...plan.followers.keys()]);
    const map = new Map();
    for (const id of ids) {
      const n = this.node(id);
      const nn = addNode(this.d, n.x, n.y, n.z);
      map.set(id, nn.id);
      addPart(this.d, 'frame', [id, nn.id]);
    }
    // frames between extruded nodes are copied (extruding an edge makes a ladder)
    const between = this.d.parts.filter((p) => p.type === 'frame' && p.n.every((n) => ids.has(n)));
    for (const p of between) {
      const { elasticLimit, weightHardness, ultimateStrength, minRadius, color } = p;
      addPart(this.d, 'frame', p.n.map((n) => map.get(n)), { elasticLimit, weightHardness, ultimateStrength, minRadius, color });
    }
    this.clearSelection();
    for (const id of sel) this.sel.nodes.add(map.get(id));
    this.sel.activeNode = map.get([...sel][sel.size - 1]);
    const followers = new Map();
    for (const [f, dId] of plan.followers) followers.set(map.get(f), map.get(dId));
    this.changed('topology');
    return { ids: new Set(map.values()), followers, center: new Set([...plan.center].map((id) => map.get(id))) };
  }

  /** Ctrl+click: extrude the active node to a point (new node + frame). */
  extrudeTo(p) {
    const from = this.sel.activeNode ?? [...this.sel.nodes].pop();
    this.snapshot();
    const n = this.createNode(p.x, p.y, p.z);
    if (from !== undefined && from !== null && from !== n.id) this.createPart('frame', [from, n.id]);
    this.clearSelection();
    this.sel.nodes.add(n.id);
    this.sel.activeNode = n.id;
    this.changed('topology');
  }

  /** M: merge selected nodes at their centre. */
  merge() {
    const ids = [...this.sel.nodes];
    if (ids.length < 2) return 'Select at least 2 nodes to merge.';
    this.snapshot();
    const keep = this.node(this.sel.activeNode ?? ids[0]);
    const c = ids.reduce((a, id) => {
      const n = this.node(id);
      return { x: a.x + n.x / ids.length, y: a.y + n.y / ids.length, z: a.z + n.z / ids.length };
    }, { x: 0, y: 0, z: 0 });
    keep.x = c.x; keep.y = c.y; keep.z = c.z;
    const others = new Set(ids.filter((id) => id !== keep.id));
    for (const p of this.d.parts) p.n = p.n.map((id) => (others.has(id) ? keep.id : id));
    this.d.nodes = this.d.nodes.filter((n) => !others.has(n.id));
    normalizeDesign(this.d);
    this.clearSelection();
    this.sel.nodes.add(keep.id);
    this.sel.activeNode = keep.id;
    this.changed('topology');
    return null;
  }

  /**
   * Merge node `fromId` into `toId` (drag-to-connect): parts are re-pointed, parts that
   * would use a node twice or duplicate another part are dropped. No snapshot: callers
   * (the move operator) already took one.
   */
  mergeInto(fromId, toId) {
    if (fromId === toId || !this.node(fromId) || !this.node(toId)) return;
    for (const p of this.d.parts) p.n = p.n.map((id) => (id === fromId ? toId : id));
    this.d.nodes = this.d.nodes.filter((n) => n.id !== fromId);
    normalizeDesign(this.d);
    if (this.sel.nodes.delete(fromId)) this.sel.nodes.add(toId);
    if (this.sel.activeNode === fromId) this.sel.activeNode = toId;
    const pids = new Set(this.d.parts.map((p) => p.id));
    for (const id of [...this.sel.parts]) if (!pids.has(id)) this.sel.parts.delete(id);
  }

  hideSelected(unselected = false) {
    if (unselected) {
      for (const n of this.d.nodes) if (!this.sel.nodes.has(n.id)) this.hidden.add(n.id);
    } else {
      for (const id of this.affectedNodes()) this.hidden.add(id);
      this.clearSelection();
    }
    this.changed('selection');
  }

  unhideAll() {
    for (const id of this.hidden) this.sel.nodes.add(id);
    this.hidden.clear();
    this.changed('selection');
  }

  /**
   * Set a property on parts (and their mirror twins with symmetry on).
   * opts.snapshot = false for live slider drags (the caller snapshots once at the start);
   * opts.kind = change kind reported to the editor ('props' skips rebuilding the panel).
   */
  setPartProps(ids, key, value, opts = {}) {
    if (opts.snapshot !== false) this.snapshot();
    for (const id of ids) {
      const p = this.part(id);
      if (!p) continue;
      p[key] = structuredClone(value);
    }
    if (this.symmetry) {
      const mm = mirrorNodeMap(this.d);
      for (const id of ids) {
        const p = this.part(id);
        if (!p) continue;
        const twin = findPart(this.d, p.type, p.n.map((n) => mm.get(n)));
        if (twin && twin !== p && !ids.includes(twin.id)) twin[key] = this._mirrorValue(p, key, value, mm);
      }
    }
    this.changed(opts.kind || 'topology');
  }

  _mirrorValue(p, key, value, mm) {
    if (p.type === 'rod' && (key === 'keyCompress' || key === 'keyStretch')) return MIRROR_KEYS[value] || value;
    if (p.type === 'transmission' && (key === 'wheel' || key === 'engine') && value != null) {
      const q = this.part(value);
      const twin = q && findPart(this.d, q.type, q.n.map((n) => mm.get(n)));
      return twin ? twin.id : value;
    }
    return structuredClone(value);
  }

  /** Set a node property (friction, light) on nodes and their mirror twins. */
  setNodeProps(ids, key, value, opts = {}) {
    if (opts.snapshot !== false) this.snapshot();
    const mm = this.symmetry ? mirrorNodeMap(this.d) : null;
    const done = new Set();
    for (const id of ids) {
      const n = this.node(id);
      if (!n) continue;
      n[key] = structuredClone(value);
      if (n[key] == null) delete n[key];
      done.add(id);
    }
    if (mm) {
      for (const id of ids) {
        const tid = mm.get(id);
        if (tid === undefined || done.has(tid)) continue;
        const t = this.node(tid);
        if (!t) continue;
        let v = structuredClone(value);
        if (key === 'light' && v) v.hAngle = -(v.hAngle || 0);
        t[key] = v;
        if (t[key] == null) delete t[key];
      }
    }
    this.changed(opts.kind || 'props');
  }

  /** Parts plus their mirror twins (when symmetry is on). */
  withTwins(parts) {
    const out = new Map(parts.map((p) => [p.id, p]));
    if (this.symmetry) {
      const mm = mirrorNodeMap(this.d);
      for (const p of parts) {
        const ids = p.n.map((n) => mm.get(n));
        if (ids.some((x) => x === undefined)) continue;
        const t = findPart(this.d, p.type, ids);
        if (t) out.set(t.id, t);
      }
    }
    return [...out.values()];
  }

  /** Red button 1: a node at the middle of each 2-node part; frames are split in two. */
  splitParts(ids) {
    const parts = this.withTwins(ids.map((id) => this.part(id)).filter((p) => p && p.n.length === 2));
    if (!parts.length) return null;
    this.snapshot();
    const newNodes = [];
    for (const p of parts) {
      const a = this.node(p.n[0]), b = this.node(p.n[1]);
      const m = addNode(this.d, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      newNodes.push(m.id);
      if (p.type === 'frame') {
        const props = { ...p };
        delete props.id; delete props.n; delete props.type;
        removeParts(this.d, [p.id]);
        addPart(this.d, 'frame', [a.id, m.id], props);
        addPart(this.d, 'frame', [m.id, b.id], props);
      }
    }
    this.clearSelection();
    for (const id of newNodes) this.sel.nodes.add(id);
    this.sel.activeNode = newNodes[0];
    this.changed('topology');
    return newNodes;
  }

  /** Red button 2: a node that slides freely along each selected frame. */
  addSliders(ids) {
    const frames = this.withTwins(ids.map((id) => this.part(id)).filter((p) => p && p.type === 'frame'));
    if (!frames.length) return null;
    this.snapshot();
    const created = [];
    for (const p of frames) {
      const a = this.node(p.n[0]), b = this.node(p.n[1]);
      const s = addNode(this.d, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      created.push(addPart(this.d, 'slider', [a.id, b.id, s.id]));
    }
    this.clearSelection();
    for (const p of created) {
      this.sel.nodes.add(p.n[2]);
      this.sel.parts.add(p.id);
    }
    this.sel.activeNode = created[0].n[2];
    this.changed('topology');
    return created;
  }

  selectType(type) {
    for (const p of this.d.parts) if (p.type === type && !p.n.some((n) => this.hidden.has(n))) this.sel.parts.add(p.id);
    this.changed('selection');
  }

  deselectType(type) {
    if (type === 'point') {
      this.sel.nodes.clear();
      this.sel.activeNode = null;
    } else {
      for (const id of [...this.sel.parts]) if (this.part(id)?.type === type) this.sel.parts.delete(id);
    }
    this.changed('selection');
  }

  /** Select every part of the same type whose settings match `ref`. */
  selectSimilar(ref) {
    const key = (p) => JSON.stringify(Object.entries(p).filter(([k]) => k !== 'id' && k !== 'n').sort());
    const want = key(ref);
    for (const p of this.d.parts) if (p.type === ref.type && key(p) === want) this.sel.parts.add(p.id);
    this.changed('selection');
  }

  /** Reset parts to the default settings of their type (upgrade levels are kept). */
  resetParts(ids) {
    this.snapshot();
    const parts = this.withTwins(ids.map((id) => this.part(id)).filter(Boolean));
    for (const p of parts) {
      const keep = { id: p.id, type: p.type, n: p.n, level: p.level };
      for (const k of Object.keys(p)) delete p[k];
      Object.assign(p, partDefaults(p.type || keep.type), keep);
      if (keep.level === undefined) delete p.level;
    }
    this.changed('topology');
  }

  /** Move the whole car so its lowest point (wheel bottoms included) sits on y = 0. */
  dropToGround() {
    this.snapshot();
    let minY = Infinity;
    const nm = nodeMap(this.d);
    for (const n of this.d.nodes) minY = Math.min(minY, n.y - 0.04);
    for (const p of this.d.parts) {
      if (p.type === 'wheel') {
        const h = nm.get(p.n[0]);
        if (h) minY = Math.min(minY, h.y - p.radius);
      }
    }
    if (!Number.isFinite(minY)) return;
    for (const n of this.d.nodes) n.y -= minY;
    this.changed('positions');
  }

  centerCar() {
    this.snapshot();
    let minX = Infinity, maxX = -Infinity;
    for (const n of this.d.nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
    }
    const cx = (minX + maxX) / 2;
    for (const n of this.d.nodes) n.x -= cx;
    this.changed('positions');
  }

  /** Copy selection to a portable fragment (for "copied parts"). */
  copyFragment() {
    const ids = this.affectedNodes();
    if (!ids.size) return null;
    const nodes = this.d.nodes.filter((n) => ids.has(n.id)).map((n) => structuredClone(n));
    const parts = this.d.parts.filter((p) => p.n.every((id) => ids.has(id))).map((p) => structuredClone(p));
    return { version: DESIGN_VERSION, nodes, parts };
  }

  pasteFragment(frag, offset = { x: 0, y: 0, z: 0 }) {
    if (!frag || !frag.nodes?.length) return null;
    frag = migrateDesign(structuredClone(frag)); // fragments saved before v2 have no version
    this.snapshot();
    const map = new Map();
    for (const n of frag.nodes) {
      const nn = addNode(this.d, n.x + offset.x, n.y + offset.y, n.z + offset.z);
      if (n.friction != null) nn.friction = n.friction;
      if (n.light) nn.light = structuredClone(n.light);
      map.set(n.id, nn.id);
    }
    const partMapIds = new Map();
    for (const p of frag.parts) {
      if (!PART_TYPES[p.type] || p.n.some((id) => !map.has(id))) continue;
      const props = { ...p };
      delete props.id; delete props.n; delete props.type;
      partMapIds.set(p.id, addPart(this.d, p.type, p.n.map((id) => map.get(id)), props));
    }
    // transmissions inside the fragment follow the copied engine / wheel
    for (const q of partMapIds.values()) {
      if (q.type !== 'transmission') continue;
      if (partMapIds.has(q.engine)) q.engine = partMapIds.get(q.engine).id;
      if (partMapIds.has(q.wheel)) q.wheel = partMapIds.get(q.wheel).id;
    }
    normalizeDesign(this.d);
    this.clearSelection();
    for (const id of map.values()) this.sel.nodes.add(id);
    for (const p of this.d.parts) if (p.n.every((n) => this.sel.nodes.has(n))) this.sel.parts.add(p.id);
    this.changed('topology');
    return { ids: new Set(map.values()), followers: new Map(), center: new Set() };
  }
}
