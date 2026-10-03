// Bottom settings panel for the selected parts, modelled on the original game: it replaces
// the parts toolbar while something is selected. Header (arrows, title, action buttons,
// stats), upgrade bar for engines / wheels / jets, two columns of sliders and a row of
// dropdowns. Point Settings (friction, lights, position) for selected nodes.
import { el } from '../ui/dom.js';
import { PANEL_ICONS } from '../ui/icons.js';
import { modal } from '../ui/dialogs.js';
import {
  PART_TYPES, LIGHT_TYPES, TIRE_TYPES, PANEL_MATERIALS, NODE_DEFAULTS, KEY_ACTIONS,
  upgradeRows, partMass, enginePower, jetThrust, wheelMass, maxLevel, levelPrice,
} from '../car/parts.js';
import { nodeMap, nodeMasses, driveLayout, dist, triArea } from '../car/design.js';
import { CarSim } from '../physics/sim.js';

const POINT = 'point';
const S = (key, label, min, max, step) => ({ key, label, min, max, step });

const POINT_DEF = {
  label: 'Point Settings',
  help: 'Friction: how strongly this node grips the ground when it scrapes along it. Lights: headlights shine forward and light the road at night, tail lights glow with the headlights, brake lights with the brakes, reverse lights when reversing, beacons flash. Vert. / Hor. angle aim the light (degrees from straight ahead), Length is its range in metres.',
};
const POINT_SLIDERS = [
  [S('friction', 'Friction:', 0, 2, 0.01), S('vAngle', 'Vert. angle:', -90, 90, 1), S('intensity', 'Intensity:', 0, 3, 0.05)],
  [S('hAngle', 'Hor. angle:', -180, 180, 1), S('length', 'Length:', 1, 150, 1)],
];
const LIGHT_DEFAULT = { type: 'headlight', vAngle: -4, hAngle: 0, intensity: 1, length: 60 };

const label = (options, v) => options.find(([k]) => k === v)?.[1] || '';
const fmt = (v, d = 2) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(d));

/** Static load share of each wheel (minimum-norm distribution that balances the weight). */
function wheelLoads(d) {
  const masses = nodeMasses(d);
  const nm = nodeMap(d);
  let M = 0, cx = 0, cz = 0;
  for (const n of d.nodes) {
    const m = masses.get(n.id);
    M += m; cx += m * n.x; cz += m * n.z;
  }
  cx /= M || 1; cz /= M || 1;
  const ws = d.parts.filter((p) => p.type === 'wheel').map((p) => ({ id: p.id, n: nm.get(p.n[0]) })).filter((w) => w.n);
  const out = new Map();
  if (!ws.length) return out;
  // L_i = a + b x_i + c z_i with sum L = 1, sum L x = cx, sum L z = cz
  let s1 = 0, sx = 0, sz = 0, sxx = 0, sxz = 0, szz = 0;
  for (const w of ws) {
    const x = w.n.x, z = w.n.z;
    s1 += 1; sx += x; sz += z; sxx += x * x; sxz += x * z; szz += z * z;
  }
  const A = [[s1, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]];
  const b = [1, cx, cz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  let coef = null;
  if (Math.abs(D) > 1e-9) {
    coef = [0, 1, 2].map((k) => det(A.map((row, r) => row.map((v, c) => (c === k ? b[r] : v)))) / D);
  }
  let sum = 0;
  for (const w of ws) {
    const v = coef ? Math.max(0, coef[0] + coef[1] * w.n.x + coef[2] * w.n.z) : 1;
    out.set(w.id, v);
    sum += v;
  }
  for (const [k, v] of out) out.set(k, sum > 0 ? v / sum : 1 / ws.length);
  return out;
}

export class PartPanel {
  constructor(garage) {
    this.g = garage;
    this.root = el('div', { class: 'partpanel hidden' });
    this.group = null;
    this.preview = null;
    this._lastActive = null;
    this._editing = false;
    this.colorInput = el('input', { type: 'color', class: 'pp-color-input' });
    this.colorInput.addEventListener('change', () => this._applyColor(this.colorInput.value));
  }

  get model() { return this.g.model; }
  get design() { return this.g.design; }

  // ---------------- selection groups ----------------
  groups() {
    const m = this.model;
    const byType = new Map();
    for (const id of m.sel.parts) {
      const p = m.part(id);
      if (!p) continue;
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(p);
    }
    const out = Object.keys(PART_TYPES).filter((t) => byType.has(t)).map((t) => ({ key: t, parts: byType.get(t) }));
    const nodes = [...m.sel.nodes].map((id) => m.node(id)).filter(Boolean);
    if (nodes.length) out.push({ key: POINT, nodes, parts: [] });
    return out;
  }

  cycle(dir) {
    const gs = this.groups();
    if (gs.length < 2) return;
    const i = gs.findIndex((g) => g.key === this.group);
    this.group = gs[(i + dir + gs.length) % gs.length].key;
    this.preview = null;
    this.render();
  }

  /** Rebuild the panel; returns false when nothing is selected. */
  render() {
    const gs = this.groups();
    const root = this.root;
    root.innerHTML = '';
    if (!gs.length) {
      this.group = null;
      return false;
    }
    const m = this.model;
    const active = m.sel.activePart != null ? `p${m.sel.activePart}` : m.sel.activeNode != null ? `n${m.sel.activeNode}` : null;
    let g = gs.find((x) => x.key === this.group);
    if (!g || (active && active !== this._lastActive)) {
      const t = m.sel.activePart != null ? m.part(m.sel.activePart)?.type : m.sel.activeNode != null ? POINT : null;
      g = gs.find((x) => x.key === t) || g || gs[0];
    }
    this._lastActive = active;
    if (g.key !== this.group) this.preview = null;
    this.group = g.key;
    this.cur = g;
    root.append(this._header(g, gs.length));
    const def = g.key === POINT ? null : PART_TYPES[g.key];
    if (def?.upgradable) root.append(this._upgradeBar(g));
    this.body = el('div', { class: 'pp-body' });
    root.append(this.body);
    this._fillBody();
    root.append(this._footer(g));
    root.append(this.colorInput);
    return true;
  }

  _fillBody() {
    const g = this.cur;
    this.body.innerHTML = '';
    if (this.preview) {
      this.body.append(this._comparison(g, this.preview));
      return;
    }
    const cols = g.key === POINT ? this._pointSliders(g) : PART_TYPES[g.key].sliders;
    const wrap = el('div', { class: 'pp-cols' });
    for (const col of cols) {
      const c = el('div', { class: 'pp-col' });
      for (const s of col) if (!s.when || g.key === POINT || s.when(g.parts[0])) c.append(this._sliderRow(g, s));
      wrap.append(c);
    }
    this.body.append(wrap);
  }

  // ---------------- header ----------------
  _title(g) {
    if (g.key === POINT) {
      const lt = g.nodes[0].light?.type || 'none';
      return `Point Settings - ${label(LIGHT_TYPES, lt)}${g.nodes.length > 1 ? ` (${g.nodes.length})` : ''}`;
    }
    const p = g.parts[0];
    let variant = '';
    if (g.key === 'wheel') variant = label(TIRE_TYPES, p.tireType);
    else if (g.key === 'rod') variant = p.mode === 'piston' ? 'Piston' : 'Steering';
    else if (g.key === 'panel') variant = label(PANEL_MATERIALS, p.material);
    else if (g.key === 'seat') variant = `${p.role === 'passenger' ? 'Passenger' : 'Driver'}, ${p.seatType === 'classic' ? 'Classic' : p.seatType === 'bucket' ? 'Bucket' : 'Sport'}`;
    const n = g.parts.length;
    return `${PART_TYPES[g.key].label}${variant ? ` - ${variant}` : ''}${n > 1 ? ` (${n})` : ''}`;
  }

  _header(g, groupCount) {
    const def = g.key === POINT ? POINT_DEF : PART_TYPES[g.key];
    const ids = g.parts.map((p) => p.id);
    const icon = (name, title, fn, cls = '') => el('div', { class: `pp-ic ${cls}`, title, html: PANEL_ICONS[name], onclick: fn });
    const m = this.model;
    const icons = [
      icon('selectType', g.key === POINT ? 'Select all points' : `Select all ${def.label.toLowerCase()} parts`, () => {
        if (g.key === POINT) m.selectAll();
        else m.selectType(g.key);
      }),
      icon('deselect', 'Deselect these', () => m.deselectType(g.key)),
      icon('similar', 'Select parts with identical settings', () => {
        if (g.key === POINT) {
          const ref = JSON.stringify([g.nodes[0].friction ?? null, g.nodes[0].light ?? null]);
          for (const n of this.design.nodes) if (JSON.stringify([n.friction ?? null, n.light ?? null]) === ref) m.sel.nodes.add(n.id);
          m.changed('selection');
        } else m.selectSimilar(g.parts[0]);
      }),
      icon('reset', 'Reset to default settings', () => {
        if (g.key === POINT) {
          m.setNodeProps(g.nodes.map((n) => n.id), 'friction', null);
          m.setNodeProps(g.nodes.map((n) => n.id), 'light', null, { snapshot: false, kind: 'topology' });
          this.render();
        } else m.resetParts(ids);
      }),
      icon('delete', 'Delete (X)', () => {
        if (g.key === POINT) {
          m.sel.parts.clear();
        } else {
          m.sel.nodes.clear();
          for (const id of [...m.sel.parts]) if (m.part(id)?.type !== g.key) m.sel.parts.delete(id);
        }
        m.deleteSelection();
      }),
      icon('help', 'Help', () => this._help(g)),
    ];
    if (g.key !== POINT && 'color' in (PART_TYPES[g.key].defaults || {})) {
      icons.push(icon('color', 'Colour', () => {
        this.colorInput.value = g.parts[0].color || this.design.colors[PART_TYPES[g.key].layer] || '#ffffff';
        this.colorInput.click();
      }));
    }
    const red = [];
    if (def.twoNodeActions) {
      red.push(icon('midpoint', g.key === 'frame' ? 'Add a node in the middle (splits the frame in two)' : 'Add a node in the middle', () => {
        const nodes = m.splitParts(ids);
        if (nodes) this.g.setStatus(`Added ${nodes.length} node${nodes.length > 1 ? 's' : ''}.`);
      }, 'red'));
      if (g.key === 'frame') {
        red.push(icon('slider', 'Add a slider: a node that moves freely along the frame', () => {
          const s = m.addSliders(ids);
          if (s) this.g.setStatus('Slider added: connect parts to the new node.');
        }, 'red'));
      }
    }
    const stats = this._stats(g);
    return el('div', { class: 'pp-head' }, [
      el('div', { class: `pp-arrow ${groupCount < 2 ? 'off' : ''}`, title: 'Previous part type', onclick: () => this.cycle(-1) }, '◀'),
      el('div', { class: 'pp-title' }, this._title(g)),
      el('div', { class: `pp-arrow ${groupCount < 2 ? 'off' : ''}`, title: 'Next part type', onclick: () => this.cycle(1) }, '▶'),
      el('div', { class: 'pp-icons' }, icons),
      red.length ? el('div', { class: 'pp-icons' }, red) : null,
      this.statsEl = el('div', { class: `pp-stats ${stats.bad ? 'bad' : ''}` }, stats.text),
    ]);
  }

  /** Refresh just the stats text (cheap; used while dragging sliders). */
  updateStats() {
    if (!this.cur || !this.statsEl) return;
    const s = this._stats(this.cur);
    this.statsEl.textContent = s.text;
    this.statsEl.classList.toggle('bad', !!s.bad);
  }

  _stats(g) {
    const d = this.design;
    const nm = nodeMap(d);
    if (g.key === POINT) {
      const masses = nodeMasses(d);
      const kg = g.nodes.reduce((s, n) => s + (masses.get(n.id) || 0), 0);
      return { text: `${g.nodes.length} point${g.nodes.length > 1 ? 's' : ''} | ${fmt(kg, 1)} kg` };
    }
    const ps = g.parts;
    const len = (p) => {
      const a = nm.get(p.n[0]), b = nm.get(p.n[1]);
      return a && b ? dist(a, b) : 0;
    };
    const mass = (p) => {
      const ns = p.n.map((id) => nm.get(id));
      return partMass(p, ns.length >= 2 ? dist(ns[0], ns[1]) : 0, ns.length === 3 ? triArea(ns[0], ns[1], ns[2]) : 0).mass;
    };
    const kg = ps.reduce((s, p) => s + mass(p), 0);
    switch (g.key) {
      case 'wheel': {
        const p = ps[0];
        const load = wheelLoads(d).get(p.id) || 0;
        const power = driveLayout(d).wheels.get(p.id) || 0;
        return { text: `Load: ${(load * 100).toFixed(1)}% | Power: ${(power * 100).toFixed(0)}% | Ø ${(p.radius * 2).toFixed(2)} m | ${wheelMass(p).toFixed(1)} kg` };
      }
      case 'engine': {
        const hp = ps.reduce((s, p) => s + enginePower(p), 0);
        return { text: `${hp.toFixed(0)} hp | ${kg.toFixed(0)} kg` };
      }
      case 'jet': {
        const n = ps.reduce((s, p) => s + jetThrust(p), 0);
        return { text: `${(n / 1000).toFixed(1)} kN | ${kg.toFixed(0)} kg` };
      }
      case 'panel': {
        const area = ps.reduce((s, p) => {
          const ns = p.n.map((id) => nm.get(id));
          return s + (ns.every(Boolean) ? triArea(ns[0], ns[1], ns[2]) : 0);
        }, 0);
        return { text: `${area.toFixed(2)} m² | ${kg.toFixed(1)} kg` };
      }
      case 'transmission': {
        const p = ps[0];
        const byId = new Map(d.parts.map((q) => [q.id, q]));
        if (byId.get(p.engine)?.type !== 'engine' || byId.get(p.wheel)?.type !== 'wheel') return { text: 'Not used', bad: true };
        return { text: `${this._partName(byId.get(p.engine))} → ${this._partName(byId.get(p.wheel))} | ${len(p).toFixed(2)} m` };
      }
      case 'angleLock': {
        const p = ps[0];
        const a = nm.get(p.n[0]), j = nm.get(p.n[1]), c = nm.get(p.n[2]);
        const u = { x: a.x - j.x, y: a.y - j.y, z: a.z - j.z }, v = { x: c.x - j.x, y: c.y - j.y, z: c.z - j.z };
        const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / ((Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z)) || 1);
        return { text: `${((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI).toFixed(0)}° | ${kg.toFixed(1)} kg` };
      }
      case 'slider': return { text: `Rail ${len(ps[0]).toFixed(2)} m | ${kg.toFixed(1)} kg` };
      case 'seat': case 'weight': return { text: `${kg.toFixed(0)} kg` };
      default: {
        const L = ps.reduce((s, p) => s + len(p), 0);
        return { text: `${L.toFixed(2)} m | ${kg.toFixed(1)} kg` };
      }
    }
  }

  _partName(p) {
    if (!p) return 'None';
    const nm = nodeMap(this.design);
    const list = this.design.parts.filter((q) => q.type === p.type);
    if (p.type === 'wheel') {
      const h = nm.get(p.n[0]);
      const xs = list.map((q) => nm.get(q.n[0])?.x ?? 0);
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const fr = list.length <= 2 ? '' : h.x >= mid ? 'F' : 'R';
      const side = Math.abs(h.z) < 0.02 ? 'C' : h.z > 0 ? 'R' : 'L';
      return `Wheel ${fr}${side} #${list.indexOf(p) + 1}`;
    }
    return `${PART_TYPES[p.type].label} #${list.indexOf(p) + 1}`;
  }

  // ---------------- upgrades ----------------
  // Like the original: green squares up to the current level, grey above; in Single player
  // the current level's price sits beside the bar and the coin cost of a hovered level below it.
  _upgradeBar(g) {
    const p = g.parts[0];
    const cur = p.level || 1;
    const max = maxLevel(p.type);
    const bar = el('div', { class: 'pp-bar' });
    for (let L = 1; L <= max; L++) {
      const sq = el('div', { class: `sq ${L <= cur ? 'on' : ''} ${max <= 10 ? 'wide' : ''}`, title: `Level ${L}` });
      sq.addEventListener('mouseenter', () => {
        this.preview = L;
        bar.querySelectorAll('.sq').forEach((q, i) => q.classList.toggle('pv', i < L));
        this._fillBody();
      });
      sq.addEventListener('mouseleave', () => {
        this.preview = null;
        bar.querySelectorAll('.sq').forEach((q) => q.classList.remove('pv'));
        this._fillBody();
      });
      sq.addEventListener('click', () => this.setLevel(L));
      bar.append(sq);
    }
    const budget = this.g.upgradeBudget();
    const info = budget ? `${levelPrice(p.type, cur)} c.` : `Level ${cur} / ${max}`;
    return el('div', { class: 'pp-upg' }, [bar, el('span', { class: 'pp-upg-t' }, info)]);
  }

  /** Coins needed to put the selected parts (and mirror twins) at level L (negative = refund). */
  _levelDelta(g, L) {
    const parts = this.model.withTwins(g.parts);
    let delta = 0;
    for (const p of parts) delta += levelPrice(p.type, L) - levelPrice(p.type, p.level || 1);
    return { delta, twins: parts.length > g.parts.length };
  }

  setLevel(L) {
    const g = this.cur;
    if (!g || g.key === POINT) return;
    const budget = this.g.upgradeBudget();
    if (budget) {
      const { delta } = this._levelDelta(g, L);
      if (delta > budget.left) {
        this.g.setStatus(`Not enough coins: level ${L} costs ${delta} c. and you have ${budget.left} c. Win races to earn more.`, 5000);
        return;
      }
    }
    this.preview = null;
    this.model.setPartProps(g.parts.map((p) => p.id), 'level', L);
  }

  _comparison(g, L) {
    const p = g.parts[0];
    const cur = p.level || 1;
    const budget = this.g.upgradeBudget();
    const now = upgradeRows(p, cur, !!budget), next = upgradeRows(p, L, !!budget);
    const rows = [el('div', { class: 'h' }, ''), el('div', { class: 'h' }, 'Current Level'), el('div', { class: 'h' }, 'New Level')];
    now.forEach(([name, v], i) => {
      const nv = next[i][1];
      const pct = v ? ((nv / v - 1) * 100) : 0;
      // heavier is worse, everything else is better when it goes up
      const good = /Weight/.test(name) ? pct < 0 : pct > 0;
      rows.push(
        el('div', { class: 'k' }, name),
        el('div', fmt(v, 1)),
        el('div', [fmt(nv, 1), Math.abs(pct) >= 0.5 ? el('span', { class: good ? 'up' : 'down' }, ` (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)`) : null]),
      );
    });
    let cost;
    if (!budget) cost = el('div', { class: 'note' }, 'Sandbox: upgrades are free.');
    else {
      const { delta, twins } = this._levelDelta(g, L);
      const short = delta > budget.left;
      cost = el('div', { class: `cost ${short ? 'bad' : delta < 0 ? 'refund' : ''}` }, [
        el('span', { class: 'coin' }),
        `${delta > 0 ? '-' : '+'}${Math.abs(delta)} c.${twins ? ' (+Symmetry)' : ''}`,
      ]);
    }
    return el('div', { class: 'pp-compare' }, [
      cost,
      el('div', { class: 'ttl' }, `Upgrade Level: ${L} / ${maxLevel(p.type)}`),
      el('div', { class: 'grid' }, rows),
    ]);
  }

  // ---------------- sliders ----------------
  _pointSliders(g) {
    const lt = g.nodes[0].light?.type;
    if (lt && lt !== 'none') return POINT_SLIDERS;
    return [[POINT_SLIDERS[0][0]], []];
  }

  _get(g, key) {
    if (g.key === POINT) {
      const n = g.nodes[0];
      if (key === 'friction') return n.friction ?? NODE_DEFAULTS.friction;
      return n.light?.[key] ?? LIGHT_DEFAULT[key];
    }
    return g.parts[0][key];
  }

  _set(g, key, value, live) {
    const m = this.model;
    const opts = { snapshot: !live, kind: live ? 'props' : 'topology' };
    if (g.key === POINT) {
      const ids = g.nodes.map((n) => n.id);
      if (key === 'friction') m.setNodeProps(ids, 'friction', value, opts);
      else {
        // light fields are edited per node so each keeps its own type
        if (!live) m.snapshot();
        for (const n of g.nodes) {
          if (!n.light) continue;
          m.setNodeProps([n.id], 'light', { ...n.light, [key]: value }, { snapshot: false, kind: 'props' });
        }
        if (!live) m.changed('topology');
      }
      return;
    }
    m.setPartProps(g.parts.map((p) => p.id), key, value, opts);
  }

  _sliderRow(g, s) {
    const v0 = Number(this._get(g, s.key) ?? 0);
    const range = el('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: v0 });
    const box = el('input', { type: 'number', min: s.min, max: s.max, step: s.step, value: +v0.toFixed(4) });
    range.addEventListener('input', () => {
      if (!this._editing) {
        this.model.snapshot();
        this._editing = true;
      }
      const v = Number(range.value);
      box.value = +v.toFixed(4);
      this._set(g, s.key, v, true);
    });
    range.addEventListener('change', () => {
      this._editing = false;
      range.blur(); // keep editor hotkeys working
      this.g.onModelChange('topology');
    });
    box.addEventListener('change', () => {
      let v = parseFloat(box.value);
      if (!Number.isFinite(v)) return;
      v = Math.min(s.max, Math.max(s.min, v));
      range.value = v;
      this._set(g, s.key, v, false);
    });
    return el('div', { class: 'pp-row' }, [el('span', { class: 'lbl' }, s.label), range, box]);
  }

  // ---------------- footer (dropdowns) ----------------
  _footer(g) {
    const f = el('div', { class: 'pp-foot' });
    if (g.key === POINT) {
      const lt = g.nodes[0].light?.type || 'none';
      const sel = this._select(LIGHT_TYPES, lt, (v) => {
        const ids = g.nodes.map((n) => n.id);
        this.model.setNodeProps(ids, 'light', v === 'none' ? null : { ...LIGHT_DEFAULT, ...(g.nodes[0].light || {}), type: v }, { kind: 'topology' });
      }, 'Light type');
      f.append(sel);
      // position (median of the selected points)
      const c = g.nodes.reduce((a, n) => ({ x: a.x + n.x / g.nodes.length, y: a.y + n.y / g.nodes.length, z: a.z + n.z / g.nodes.length }), { x: 0, y: 0, z: 0 });
      for (const ax of ['x', 'y', 'z']) {
        const inp = el('input', { type: 'number', step: '0.05', value: c[ax].toFixed(3) });
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v)) this.g.moveNodes(g.nodes.map((n) => n.id), ax, v - c[ax]);
        });
        f.append(el('label', { class: `pp-xyz ${ax}` }, [ax.toUpperCase(), inp]));
      }
      return f;
    }
    const def = PART_TYPES[g.key];
    const p = g.parts[0];
    for (const s of def.selects) {
      if (s.when && !s.when(p)) continue;
      if (s.button) {
        f.append(el('button', { class: 'pp-btn', onclick: () => this.gearRatios(g) }, s.button));
        continue;
      }
      let options = s.options;
      if (options === 'engines' || options === 'wheels') {
        const type = options === 'engines' ? 'engine' : 'wheel';
        options = [[null, 'None'], ...this.design.parts.filter((q) => q.type === type).map((q) => [q.id, this._partName(q)])];
      }
      let cur = p[s.key];
      if (!options.some(([k]) => k === cur)) options = [...options, [cur, String(cur)]];
      f.append(this._select(options, cur, (v) => this.model.setPartProps(g.parts.map((q) => q.id), s.key, v), s.label));
    }
    return f;
  }

  _select(options, cur, onChange, title) {
    const sel = el('select', { class: 'pp-sel', title: title || '' }, options.map(([k, t], i) => el('option', { value: String(i), selected: k === cur }, t)));
    sel.addEventListener('change', () => {
      sel.blur();
      onChange(options[Number(sel.value)][0]);
    });
    const wrap = el('label', { class: 'pp-selwrap' }, [title && title !== 'Light type' ? el('span', { class: 'pp-sl' }, title) : null, sel]);
    return wrap;
  }

  _applyColor(value) {
    const g = this.cur;
    if (!g || g.key === POINT) return;
    this.model.setPartProps(g.parts.map((p) => p.id), 'color', value);
  }

  // ---------------- dialogs ----------------
  _help(g) {
    const def = g.key === POINT ? POINT_DEF : PART_TYPES[g.key];
    const keys = g.key !== POINT && def.selects?.some((s) => s.options === KEY_ACTIONS);
    modal(this.g.app.ui, (box, close) => {
      box.append(
        el('h2', def.label),
        el('p', def.help || ''),
        def.upgradable ? el('p', "Upgrade bar: hover a level to compare it with the current one, click to apply it. In Single player, levels cost coins earned by racing (lowering a level refunds it) and set the car's length limit; in Sandbox they are free.") : null,
        keys ? el('p', 'Key dropdowns choose which driver action moves the part. Bind actions to keys in Settings > Controls.') : null,
        def.twoNodeActions ? el('p', 'Red buttons: the circle adds a node in the middle (a frame is split in two); the square adds a slider node that moves freely along the frame.') : null,
        el('div', { class: 'row' }, [el('button', { class: 'btn', onclick: () => close() }, 'Close')]),
      );
    });
  }

  gearRatios(g) {
    const p = g.parts[0];
    let ratios = Array.isArray(p.gearRatios) && p.gearRatios.length ? p.gearRatios.slice() : null;
    const auto = () => {
      const flat = { heightAt: () => 0, normalAt: (x, z, o) => { o.x = 0; o.y = 1; o.z = 0; return o; }, surfaceAt: () => 0 };
      const d = structuredClone(this.design);
      for (const q of d.parts) if (q.type === 'engine') q.gearRatios = null;
      try {
        return new CarSim(d, flat).drivetrain.relativeRatios();
      } catch {
        return [3.2, 2.1, 1.5, 1.2, 1];
      }
    };
    modal(this.g.app.ui, (box, close) => {
      let list = ratios || auto();
      const listEl = el('div', { class: 'gear-list' });
      const draw = () => {
        listEl.innerHTML = '';
        list.forEach((r, i) => {
          const inp = el('input', { type: 'number', min: 0.05, max: 20, step: 0.01, value: r });
          inp.addEventListener('change', () => {
            const v = parseFloat(inp.value);
            if (Number.isFinite(v) && v > 0) list[i] = v;
          });
          listEl.append(el('label', [`${i + 1}:`, inp]));
        });
      };
      draw();
      const status = el('p', { class: 'note' }, ratios ? 'Custom ratios.' : 'Automatic ratios (shown for reference).');
      box.append(
        el('h2', 'Gear ratios'),
        el('p', 'Gearbox ratio of each gear. The final drive is set from the engine\'s Top speed (or automatically), so only the spacing matters: the last gear reaches the top speed.'),
        listEl,
        status,
        el('div', { class: 'row' }, [
          el('button', { class: 'btn outline', onclick: () => { if (list.length < 8) { list.push(Math.max(0.3, +(list[list.length - 1] * 0.8).toFixed(2))); draw(); } } }, 'Add gear'),
          el('button', { class: 'btn outline', onclick: () => { if (list.length > 1) { list.pop(); draw(); } } }, 'Remove gear'),
          el('button', { class: 'btn outline', onclick: () => { close(); this.model.setPartProps(g.parts.map((q) => q.id), 'gearRatios', null); } }, 'Automatic'),
          el('button', { class: 'btn outline', onclick: () => close() }, 'Cancel'),
          el('button', { class: 'btn green', onclick: () => { close(); this.model.setPartProps(g.parts.map((q) => q.id), 'gearRatios', list.slice()); } }, 'OK'),
        ]),
      );
    });
  }
}

export { wheelLoads };
