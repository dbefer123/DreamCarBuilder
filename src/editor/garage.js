// Garage editor screen: three viewports (perspective + top + side), Blender-style
// navigation/editing, part toolbar, properties sidebar and the ESC menu.
import * as THREE from 'three';
import { EditorScene, LAYER_MAIN, LAYER_TOP, LAYER_SIDE } from './editorScene.js';
import { Viewport } from './viewport.js';
import { EditorModel } from './model.js';
import { pick, boxPick, TransformOp, PartTool, AXIS_COLORS } from './interaction.js';
import { PartPanel } from './partPanel.js';
import { PART_TYPES } from '../car/parts.js';
import { el } from '../ui/dom.js';
import { TOOL_ICONS, TOOL_LIST, viewIcon, SMALL_ICONS, SELECT_ACTIONS } from '../ui/icons.js';
import { modal, alertBox, confirmBox, promptBox, listBox, isModalOpen } from '../ui/dialogs.js';
import { settingsDialog } from '../ui/settingsDialog.js';
import { computeStats, cloneDesign, serializeDesign, deserializeDesign, validateDesign, mirrorNodeMap, carPrice, driverSeat } from '../car/design.js';
import { PRESETS, PRESET_LIST, defaultDesign } from '../car/presets.js';
import { MAP_LIST, CAREER_MAP } from '../world/maps/index.js';
import { downloadText, pickFile } from '../core/storage.js';
import { isTyping } from '../core/input.js';

const BOTTOM = 168;

export class GarageScreen {
  constructor(app) {
    this.app = app;
    this.layout3 = true;
    this.tool = null;
    this.op = null;
    this.nav = null;
    this.box = null;
    this.hover = null;
    this.panelOn = true; // N toggles the bottom part panel
    this.status = '';
    this.saveTimer = null;
  }

  // ---------------- lifecycle ----------------
  enter() {
    const app = this.app;
    // edits are saved to the profile and mode the garage was opened in
    this.profileId = app.profiles.active().id;
    this.mode = app.mode;
    this.design = cloneDesign(app.design);
    this.model = new EditorModel(this.design, (k) => this.onModelChange(k));
    this.scene = new EditorScene(app.renderer, this.design);
    this.views = [
      new Viewport('main', { layer: LAYER_MAIN, view: 'persp' }),
      new Viewport('top', { layer: LAYER_TOP, view: 'top', fixed: true }),
      new Viewport('side', { layer: LAYER_SIDE, view: 'right', fixed: true }),
    ];
    for (const v of this.views) v.visible = true;
    this.prevToneMapping = app.renderer.toneMapping;
    this.prevExposure = app.renderer.toneMappingExposure;
    app.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    app.renderer.toneMappingExposure = 1.0;
    this.buildUI();
    this.scene.setDesign(this.design);
    this.layout();
    this.frameAll(true);
    this._handlers = {
      down: (e) => this.onPointerDown(e),
      move: (e) => this.onPointerMove(e),
      up: (e) => this.onPointerUp(e),
      wheel: (e) => this.onWheel(e),
      key: (e) => this.onKey(e),
      keyup: (e) => this.onKeyUp(e),
      dbl: (e) => e.preventDefault(),
    };
    const c = app.canvas;
    c.addEventListener('pointerdown', this._handlers.down);
    window.addEventListener('pointermove', this._handlers.move);
    window.addEventListener('pointerup', this._handlers.up);
    c.addEventListener('wheel', this._handlers.wheel, { passive: false });
    window.addEventListener('keydown', this._handlers.key);
    window.addEventListener('keyup', this._handlers.keyup);
    this.refreshUI();
  }

  exit() {
    this.flushSave();
    const c = this.app.canvas;
    c.removeEventListener('pointerdown', this._handlers.down);
    window.removeEventListener('pointermove', this._handlers.move);
    window.removeEventListener('pointerup', this._handlers.up);
    c.removeEventListener('wheel', this._handlers.wheel);
    window.removeEventListener('keydown', this._handlers.key);
    window.removeEventListener('keyup', this._handlers.keyup);
    this.root.remove();
    this.scene.dispose();
    this.app.renderer.toneMapping = this.prevToneMapping;
    this.app.renderer.toneMappingExposure = this.prevExposure;
  }

  resize() {
    this.layout();
  }

  layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const top = H - BOTTOM;
    const side = this.layout3 ? Math.round(W * 0.3) : 0;
    const [main, tv, sv] = this.views;
    main.setRect(0, 0, W - side, top);
    tv.visible = sv.visible = this.layout3;
    if (this.layout3) {
      tv.setRect(W - side, 0, side, Math.floor(top / 2));
      sv.setRect(W - side, Math.floor(top / 2), side, top - Math.floor(top / 2));
    }
    this.root.classList.toggle('single', !this.layout3);
    this.sideDivider.style.display = this.layout3 ? '' : 'none';
    this.sideSplit.style.display = this.layout3 ? '' : 'none';
    this.drawAxes();
  }

  // ---------------- model changes ----------------
  onModelChange(kind) {
    if (kind === 'props') {
      // live slider edit: rebuild the 3D car on the next frame, keep the panel as it is
      this._propsDirty = true;
      this.panel.updateStats();
      this.refreshStats();
      this.scheduleSave();
      return;
    }
    if (kind === 'topology') {
      this._propsDirty = false;
      this.scene.setDesign(this.design);
      const seat = driverSeat(this.design);
      if (seat?.grid) this.model.grid = seat.grid;
    }
    else if (kind === 'positions') {
      this.scene.car.setFromDesign(this.design);
    }
    if (kind !== 'positions' || !this.op) this.scene.setHighlights(this.design, this.model.sel, this.hover?.kind === 'part' ? this.hover.id : null);
    if (kind !== 'selection') this.scheduleSave();
    if (kind === 'positions' && this.op) return; // keep dragging cheap
    this.refreshUI();
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 400);
  }

  flushSave() {
    clearTimeout(this.saveTimer);
    if (this.app.profiles.active().id !== this.profileId || this.app.mode !== this.mode) return;
    this.app.setDesign(cloneDesign(this.design));
  }

  // ---------------- UI ----------------
  buildUI() {
    const app = this.app;
    const root = (this.root = el('div', { class: 'screen garage' }));
    // top left
    root.append(el('div', { class: 'topleft' }, [
      el('div', { class: 'tl', onclick: () => this.showTutorial() }, [el('span', { html: '&#128214;' }), el('span', { class: 'key' }, 'F1'), 'Tutorial']),
      el('div', { class: 'tl', onclick: () => this.showHotkeys() }, [el('span', { html: '&#9000;' }), el('span', { class: 'key' }, 'F2'), 'Hotkeys']),
      el('div', { class: 'tl', onclick: () => this.defaultDesign() }, [el('span', { html: '&#8634;' }), 'Default design']),
    ]));
    // view presets
    const views = el('div', { class: 'views' });
    ['persp', 'front', 'back', 'left', 'right', 'top', 'bottom'].forEach((k, i) => {
      views.append(el('div', { class: 'v', title: `View ${i + 1}`, onclick: () => this.setMainView(k) }, [el('span', { class: 'n' }, String(i + 1)), el('span', { html: viewIcon(k) })]));
    });
    views.append(el('div', { class: 'v', title: 'Toggle top/side views', onclick: () => { this.layout3 = !this.layout3; this.layout(); } }, [el('span', { html: viewIcon('layout') })]));
    root.append(views);
    // layer swatches
    const layers = el('div', { class: 'layers' });
    this.swatches = {};
    for (const [key, label] of [['frames', 'Frames'], ['panels', 'Panels'], ['rims', 'Rims'], ['remaining', 'Remaining']]) {
      const input = el('input', { type: 'color', value: this.design.colors[key] });
      input.oninput = () => {
        this.design.colors[key] = input.value;
        sw.style.background = input.value;
        this.scene.car.setColors(this.design.colors);
        this.scheduleSave();
      };
      const sw = el('span', { class: 'sw', style: { background: this.design.colors[key] } }, [input]);
      this.swatches[key] = { sw, input };
      layers.append(el('label', { class: 'ly' }, [sw, label]));
    }
    root.append(layers);
    // small buttons
    this.snapBtn = el('div', { class: 'sb', title: 'Snap to grid (Ctrl toggles while moving)', html: SMALL_ICONS.snap, onclick: () => { this.model.snap = !this.model.snap; this.refreshUI(); } });
    root.append(el('div', { class: 'smallbtns' }, [
      this.snapBtn,
      el('div', { class: 'sb', title: 'Put the car on the ground', html: SMALL_ICONS.ground, onclick: () => this.model.dropToGround() }),
      el('div', { class: 'sb', title: 'Centre the car', html: SMALL_ICONS.center, onclick: () => this.model.centerCar() }),
    ]));
    // selection actions (original icon row): one type / same parts / invert / engines / seat / hide / show
    this.actionBtns = {};
    const modes = el('div', { class: 'modebtns' });
    for (const [k, tip, svg, needsSel] of SELECT_ACTIONS) {
      const b = el('div', { class: 'mb', 'data-tip': tip, html: svg, onclick: (e) => this.selectAction(k, e) });
      b._needsSel = needsSel;
      this.actionBtns[k] = b;
      modes.append(b);
    }
    modes.append(el('div', { class: 'mb', 'data-tip': 'Hide selected (H)', html: '<svg viewBox="0 0 24 22" width="26" height="22"><path d="M2 11 Q12 2 22 11 Q12 20 2 11 Z" stroke="#fff" stroke-width="1.6" fill="none"/><circle cx="12" cy="11" r="3.5" fill="#fff"/><line x1="4" y1="19" x2="20" y2="3" stroke="#fff" stroke-width="1.8"/></svg>', onclick: () => this.model.hideSelected() }));
    modes.append(el('div', { class: 'mb', 'data-tip': 'Show all hidden (Alt+H)', html: '<svg viewBox="0 0 24 22" width="26" height="22"><path d="M2 11 Q12 2 22 11 Q12 20 2 11 Z" stroke="#fff" stroke-width="1.6" fill="none"/><circle cx="12" cy="11" r="3.5" fill="#fff"/></svg>', onclick: () => this.model.unhideAll() }));
    root.append(modes);
    // stats
    this.statsEl = el('div', { class: 'stats' });
    root.append(this.statsEl);
    // toolbar
    const tb = (this.toolbarEl = el('div', { class: 'toolbar' }));
    this.toolBtns = {};
    for (const [key, label, tip] of TOOL_LIST) {
      const b = el('div', { class: 'tool', onclick: () => this.selectTool(key) }, [el('span', { html: TOOL_ICONS[key] }), el('div', { class: 'tip' }, `${label}: ${tip}`)]);
      this.toolBtns[key] = b;
      tb.append(b);
    }
    tb.append(el('div', { class: 'help', title: 'Hotkeys (F2)', onclick: () => this.showHotkeys() }, '?'));
    root.append(tb);
    // dividers + labels for side views
    this.sideDivider = el('div', { class: 'side-divider' });
    this.sideSplit = el('div', { class: 'side-split' });
    root.append(this.sideDivider, this.sideSplit);
    this.axesTop = el('div', { class: 'axes' });
    this.axesSide = el('div', { class: 'axes' });
    root.append(this.axesTop, this.axesSide);
    root.append(el('div', { class: 'front-label' }, '⟶ Front'));
    // bottom right panel
    const chk = (label, get, set) => {
      const c = el('input', { type: 'checkbox' });
      c.onchange = () => set(c.checked);
      c._get = get;
      return { c, row: el('label', {}, [c, label]) };
    };
    this.checks = [
      chk('Symmetry Mode [L]', () => this.model.symmetry, (v) => { this.model.symmetry = v; this.refreshUI(); }),
      chk('Opaque frames [O]', () => this.scene.car.opaqueFrames, (v) => { this.scene.car.setFramesOpaque(v); this.refreshUI(); }),
      chk('Hide panels [C]', () => !this.scene.car.showPanels, (v) => { this.scene.car.setPanelsVisible(!v); this.refreshUI(); }),
      chk('Hide decorations [D]', () => !this.scene.car.showDecorations, (v) => { this.scene.car.setDecorationsVisible(!v); this.refreshUI(); }),
    ];
    // Single player always races on the Default map
    const career = app.mode === 'career';
    const shownMap = career ? CAREER_MAP : app.settings.map;
    const mapSel = el('select', { disabled: career, title: career ? 'Single player races on the Default map' : '' }, MAP_LIST.map((m) => el('option', { value: m.key, selected: m.key === shownMap }, m.label)));
    mapSel.onchange = () => { app.settings.map = mapSel.value; app.saveSettings(); };
    this.mapSel = mapSel;
    root.append(el('div', { class: 'bottom-right' }, [
      el('div', { class: 'checks' }, [...this.checks.map((c) => c.row), el('div', { class: 'hint' }, '[Space] - Real view')]),
      el('div', { class: 'actions' }, [
        el('div', { class: 'undo' }, [
          el('div', { title: 'Undo (Ctrl+Z)', html: '<svg viewBox="0 0 24 16" width="26" height="16"><path d="M8 3 L3 8 L8 13 M3 8 L15 8 Q21 8 21 14" stroke="#fff" stroke-width="2" fill="none"/></svg>', onclick: () => this.undo() }),
          el('div', { title: 'Redo (Ctrl+Shift+Z)', html: '<svg viewBox="0 0 24 16" width="26" height="16"><path d="M16 3 L21 8 L16 13 M21 8 L9 8 Q3 8 3 14" stroke="#fff" stroke-width="2" fill="none"/></svg>', onclick: () => this.redo() }),
        ]),
        el('div', { class: 'menubtn', onclick: () => this.openMenu() }, 'Menu (ESC)'),
        el('div', { class: 'racebtn', onclick: () => this.race() }, 'RACE ! (Enter)'),
      ]),
      el('div', { class: 'mapsel' }, [el('span', { html: '&#128444;' }), mapSel]),
    ]));
    // bottom part panel (replaces the toolbar while something is selected)
    this.panel = new PartPanel(this);
    this.hintEl = el('div', { class: 'pp-hint hidden' }, 'Click any empty space - New parts menu');
    root.append(this.panel.root, this.hintEl);
    // status, operator header
    this.statusEl = el('div', { class: 'status hidden' });
    this.headerEl = el('div', { class: 'header-op hidden' });
    this.boxEl = el('div', { class: 'boxsel hidden' });
    root.append(this.statusEl, this.headerEl, this.boxEl);
    app.ui.appendChild(root);
  }

  drawAxes() {
    const [, tv, sv] = this.views;
    const mk = (v, labels) => {
      const r = v.rect;
      const x0 = 18, y0 = 40;
      const arrows = labels.map(([dx, dy, label, color]) => `<line x1="${x0}" y1="${y0}" x2="${x0 + dx * 26}" y2="${y0 + dy * 26}" stroke="${color}" stroke-width="2.5"/><text x="${x0 + dx * 34 + (dx ? 0 : 6)}" y="${y0 + dy * 34 + (dy ? (dy > 0 ? 8 : 0) : 4)}" fill="${color}" font-size="13" font-family="Exo 2" font-weight="600">${label}</text>`).join('');
      return { html: `<svg width="64" height="76">${arrows}</svg>`, left: r.x + r.w - 70, top: r.y + 4 };
    };
    const place = (div, v, labels) => {
      if (!v.visible) {
        div.style.display = 'none';
        return;
      }
      const a = mk(v, labels);
      div.style.display = '';
      div.innerHTML = a.html;
      div.style.left = `${a.left}px`;
      div.style.top = `${a.top}px`;
    };
    // top view: X right, +Z down the screen; side view: X right, Y up
    place(this.axesTop, tv, [[1, 0, 'X', '#e5333a'], [0, 1, 'Z', '#3d6ee8']]);
    place(this.axesSide, sv, [[1, 0, 'X', '#e5333a'], [0, -1, 'Y', '#2ea844']]);
  }

  refreshStats() {
    const s = computeStats(this.design);
    const seat = driverSeat(this.design);
    const rate = (this.app.settings.physicsRate || seat?.physics || 2000) / 1000;
    const budget = this.upgradeBudget();
    let sp = '';
    if (budget) {
      // Single player: price, coins left and the length limit (like the original's stats corner)
      const left = budget.earned - s.price;
      const over = s.massScale > 1;
      const rating = left < 0 ? '<span class="bad">too expensive: sell some upgrades</span>' : over ? '<span class="bad">overweight: longer than its length limit</span>' : 'good single player car';
      sp = `<br>Length limit: <b>${Number.isFinite(s.lengthLimit) ? `${s.lengthLimit.toFixed(2)} m` : '—'}</b>`
        + (over ? `<br><span class="bad">Weight penalty: +${Math.round(s.mass * (s.massScale - 1))} kg</span>` : '')
        + `<br>Car's price: <b>${s.price} c.</b><br><span class="coin"></span><b class="${left < 0 ? 'bad' : ''}">${left} c.</b><br>${rating}`;
    }
    this.statsEl.innerHTML = `Physics: <span class="y">${rate} kHz</span><br>Pow. / m: <b>${Math.round(s.powToMass)} hp/t</b><br>Power: <b>${Math.round(s.powerHp)} hp</b><br>Size: <b>${s.size.toFixed(2)} m</b><br>Weight: <b>${Math.round(s.mass)} kg</b>${sp}`;
  }

  /** Coins in Single player ({ earned, left }), or null in Sandbox where everything is free. */
  upgradeBudget() {
    if (this.app.mode !== 'career' || !this.app.profile) return null;
    const earned = this.app.profile.earned();
    return { earned, left: earned - carPrice(this.design) };
  }

  refreshUI() {
    if (!this.root) return;
    this.refreshStats();
    const st = this.app.settings;
    this.statsEl.classList.toggle('hidden', st.showCarInfo === false);
    this.scene.updateMarkers(this.design, st.showCOM, st.showCOL);
    for (const c of this.checks) c.c.checked = c.c._get();
    for (const [k, b] of Object.entries(this.toolBtns)) b.classList.toggle('on', this.tool?.type === k);
    const anySel = this.model.sel.nodes.size + this.model.sel.parts.size > 0;
    for (const b of Object.values(this.actionBtns)) b.classList.toggle('off', b._needsSel && !anySel);
    this.snapBtn.style.opacity = this.model.snap ? '1' : '0.45';
    for (const [k, { sw, input }] of Object.entries(this.swatches)) {
      sw.style.background = this.design.colors[k];
      input.value = this.design.colors[k];
    }
    this.renderPanel();
    const msg = this.op ? '' : this.tool ? this.tool.hint() : this.status;
    this.statusEl.textContent = msg;
    this.statusEl.classList.toggle('hidden', !msg);
  }

  setStatus(msg, ms = 3500) {
    this.status = msg || '';
    this.refreshUI();
    clearTimeout(this._statusT);
    if (msg) this._statusT = setTimeout(() => { this.status = ''; this.refreshUI(); }, ms);
  }

  /** Icon row above the parts bar (original game's selection actions). */
  selectAction(k, e) {
    const m = this.model;
    switch (k) {
      case 'oneType': {
        // keep only one of the part types in the selection
        const counts = new Map();
        for (const id of m.sel.parts) {
          const p = m.part(id);
          if (p) counts.set(p.type, (counts.get(p.type) || 0) + 1);
        }
        const items = [...counts].map(([t, n]) => [`${PART_TYPES[t].label} (${n})`, '', () => m.keepOnlyType(t)]);
        if (m.sel.nodes.size) items.push([`Points (${m.sel.nodes.size})`, '', () => m.keepOnlyType('point')]);
        if (!items.length) return;
        const r = e.currentTarget.getBoundingClientRect();
        this.showMenuAt(r.left, r.top - items.length * 28 - 34, 'Keep only', items);
        break;
      }
      case 'same': m.selectSameParts(); break;
      case 'invert': m.invertSelection(); break;
      case 'engines': m.selectByType('engine', e.shiftKey); break;
      case 'seat': m.selectByType('seat', e.shiftKey); break;
      default:
    }
  }

  // ---------------- bottom part panel ----------------
  renderPanel() {
    const show = this.panelOn && !this.tool ? this.panel.render() : false;
    this.panel.root.classList.toggle('hidden', !show);
    this.toolbarEl.classList.toggle('hidden', !!show);
    this.hintEl.classList.toggle('hidden', !show);
  }

  /** Move nodes along an axis by delta (Point Settings X/Y/Z boxes), keeping symmetry. */
  moveNodes(ids, ax, delta) {
    const m = this.model;
    m.snapshot();
    const plan = m.symmetryPlan(new Set(ids));
    for (const id of plan.drivers) {
      const n = m.node(id);
      n[ax] += delta;
      if (ax === 'z' && plan.center.has(id) && m.symmetry) n.z = 0;
    }
    for (const [f, d] of plan.followers) {
      const n = m.node(f), src = m.node(d);
      n.x = src.x; n.y = src.y; n.z = -src.z;
    }
    m.changed('positions');
  }

  // ---------------- tools ----------------
  selectTool(key) {
    if (key === 'presets') {
      this.choosePreset();
      return;
    }
    if (this.tool?.type === key) {
      this.cancelTool();
      return;
    }
    this.cancelTool();
    this.tool = new PartTool(this, key);
    this.refreshUI();
  }

  cancelTool() {
    if (this.tool) this.tool.cancel();
    this.tool = null;
    this.refreshUI();
  }

  async choosePreset() {
    const choice = await listBox(this.app.ui, 'Preset cars', PRESET_LIST.map((p) => ({ label: p.label, value: p.key })));
    if (!choice) return;
    this.model.replaceDesign(PRESETS[choice]());
    this.afterReplace();
  }

  async defaultDesign() {
    if (!(await confirmBox(this.app.ui, 'Default design', 'Replace the current car with the default buggy? (Ctrl+Z undoes this.)', 'Replace'))) return;
    this.model.replaceDesign(defaultDesign());
    this.afterReplace();
  }

  afterReplace() {
    this.frameAll(true);
    this.refreshUI();
    this.flushSave();
  }

  setMainView(name) {
    this.views[0].setView(name);
  }

  frameAll(all = true) {
    const box = new THREE.Box3();
    const ids = all ? null : this.model.affectedNodes();
    for (const n of this.design.nodes) {
      if (ids && ids.size && !ids.has(n.id)) continue;
      box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z));
    }
    for (const p of this.design.parts) {
      if (p.type !== 'wheel') continue;
      const h = this.model.node(p.n[0]);
      if (!h || (ids && ids.size && !ids.has(h.id))) continue;
      box.expandByPoint(new THREE.Vector3(h.x, h.y - p.radius, h.z));
      box.expandByPoint(new THREE.Vector3(h.x, h.y + p.radius, h.z));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 1.2, 1));
    if (all) {
      for (const v of this.views) v.frame(box, v.fixed ? 1.12 : 1.25);
    } else this.views[0].frame(box, 1.6);
  }

  // ---------------- input ----------------
  viewAt(cx, cy) {
    return this.views.find((v) => v.visible && v.contains(cx, cy)) || null;
  }

  onPointerDown(ev) {
    if (isModalOpen()) return;
    // Settings > Garage: swap the right and middle mouse buttons
    const swap = this.app.settings.swapMouse && (ev.button === 1 || ev.button === 2);
    const e = swap ? { clientX: ev.clientX, clientY: ev.clientY, pointerId: ev.pointerId, altKey: ev.altKey, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, button: ev.button === 1 ? 2 : 1, preventDefault: () => ev.preventDefault() } : ev;
    const v = this.viewAt(e.clientX, e.clientY);
    if (!v) return;
    this.app.canvas.setPointerCapture?.(e.pointerId);
    const { x: lx, y: ly } = v.local(e.clientX, e.clientY);
    this.closeContext();
    // modal operator: LMB confirm, RMB cancel
    if (this.op) {
      if (e.button === 0) this.finishOp(true);
      else if (e.button === 2) this.finishOp(false);
      return;
    }
    // navigation (original layout): middle drag pans, right drag rotates, left drag box-selects.
    // Alt + left drag also rotates (Alt + Shift pans, Alt + Ctrl zooms).
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      const mode = e.button === 1 || e.shiftKey || v.fixed ? 'pan' : e.ctrlKey ? 'zoom' : 'orbit';
      this.nav = { view: v, mode, x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      // a right drag rotates; a right click without moving runs rightClick() on release
      this.rpress = { view: v, lx, ly, x: e.clientX, y: e.clientY, ctrl: e.ctrlKey, shift: e.shiftKey };
      return;
    }
    if (e.button !== 0) return;
    if (this.tool) {
      const msg = this.tool.onClick(v, lx, ly);
      if (msg) this.setStatus(msg);
      this.refreshUI();
      return;
    }
    if (this.boxPending) {
      this.boxPending = false;
      this.box = { view: v, x0: lx, y0: ly, shift: true };
      return;
    }
    if (e.ctrlKey) {
      this.ctrlPlace(v, lx, ly);
      return;
    }
    const hit = pick(this.model, v, lx, ly, { car: this.scene.car });
    this.press = { view: v, x: lx, y: ly, cx: e.clientX, cy: e.clientY, hit, shift: e.shiftKey, moved: false };
  }

  /** Right click (no drag): cancel the tool step, Ctrl = extrude to the cursor, else the Edit menu. */
  rightClick(r) {
    if (this.tool) {
      // RMB ends chaining / cancels the tool step
      if (this.tool.picked.length || this.tool.engine) this.tool.cancel();
      else this.cancelTool();
      this.refreshUI();
      return;
    }
    if (r.ctrl) {
      this.ctrlPlace(r.view, r.lx, r.ly);
      return;
    }
    this.openContext(r.x, r.y);
  }

  ctrlPlace(v, lx, ly) {
    // Blender's Ctrl+click: extrude the active node to the cursor
    const tmp = new PartTool(this, 'frame');
    const active = this.model.sel.activeNode ?? [...this.model.sel.nodes].pop();
    if (active !== undefined && active !== null) tmp.picked = [active];
    const hit = pick(this.model, v, lx, ly, { nodesOnly: true });
    if (hit && active !== undefined && active !== null) {
      this.model.snapshot();
      this.model.createPart('frame', [active, hit.id]);
      this.model.clearSelection();
      this.model.sel.nodes.add(hit.id);
      this.model.sel.activeNode = hit.id;
      this.model.changed('topology');
      return;
    }
    const p = tmp.placePoint(v, lx, ly);
    if (p) this.model.extrudeTo(p);
  }

  onPointerMove(e) {
    if (isModalOpen()) return;
    if (this.rpress && !this.nav && Math.hypot(e.clientX - this.rpress.x, e.clientY - this.rpress.y) > 4) {
      const r = this.rpress;
      this.nav = { view: r.view, mode: r.shift || r.view.fixed ? 'pan' : 'orbit', x: r.x, y: r.y, fromRight: true };
    }
    if (this.nav) {
      const dx = e.clientX - this.nav.x, dy = e.clientY - this.nav.y;
      this.nav.x = e.clientX;
      this.nav.y = e.clientY;
      const v = this.nav.view;
      // dragging right turns the car right (as if grabbing it)
      if (this.nav.mode === 'orbit') v.orbit(dx, dy);
      else if (this.nav.mode === 'pan') v.pan(dx, dy);
      else v.zoom(Math.exp(dy * 0.01));
      return;
    }
    if (this.op) {
      const v = this.op.view;
      const { x, y } = v.local(e.clientX, e.clientY);
      this.op.onMove(x, y, e);
      this.headerEl.textContent = this.op.text;
      return;
    }
    if (this.press) {
      const p = this.press;
      const { x, y } = p.view.local(e.clientX, e.clientY);
      if (!p.moved && Math.hypot(x - p.x, y - p.y) > 4) {
        p.moved = true;
        if (p.hit) {
          // click-drag on an element: select it and move it (tweak)
          const m = this.model;
          const already = p.hit.kind === 'node' ? m.sel.nodes.has(p.hit.id) : m.sel.parts.has(p.hit.id);
          if (!already) m.select(p.hit, p.shift);
          this.startOp('grab', p.view, p.x, p.y, true, p.hit.kind === 'node' ? p.hit.id : null);
          this.op.onMove(x, y, e);
          this.press = null;
          return;
        }
        this.box = { view: p.view, x0: p.x, y0: p.y, shift: p.shift };
        this.press = null;
      }
    }
    if (this.box) {
      const b = this.box;
      const { x, y } = b.view.local(e.clientX, e.clientY);
      b.x1 = x;
      b.y1 = y;
      const r = b.view.rect;
      Object.assign(this.boxEl.style, {
        left: `${r.x + Math.min(b.x0, x)}px`, top: `${r.y + Math.min(b.y0, y)}px`,
        width: `${Math.abs(x - b.x0)}px`, height: `${Math.abs(y - b.y0)}px`,
      });
      this.boxEl.classList.remove('hidden');
      return;
    }
    // hover
    const v = this.viewAt(e.clientX, e.clientY);
    if (!v) return;
    const { x, y } = v.local(e.clientX, e.clientY);
    let hit;
    if (this.tool) hit = this.tool.onMove(v, x, y);
    else hit = pick(this.model, v, x, y, { car: this.scene.car });
    const key = hit ? `${hit.kind}${hit.id}` : '';
    if (key !== this._hoverKey) {
      this._hoverKey = key;
      this.hover = hit;
      this.scene.setHighlights(this.design, this.model.sel, hit?.kind === 'part' ? hit.id : null);
    }
  }

  onPointerUp(e) {
    const r = this.rpress;
    this.rpress = null;
    if (this.nav) {
      this.nav = null;
      return;
    }
    if (r) {
      this.rightClick(r);
      return;
    }
    if (this.op && this.op.tweak && e.button === 0) {
      this.finishOp(true);
      return;
    }
    if (this.box) {
      const b = this.box;
      this.boxEl.classList.add('hidden');
      if (b.x1 !== undefined) this.model.selectNodes(boxPick(this.model, b.view, b.x0, b.y0, b.x1, b.y1), b.shift);
      this.box = null;
      return;
    }
    if (this.press) {
      const p = this.press;
      this.press = null;
      this.model.select(p.hit, p.shift);
    }
  }

  onWheel(e) {
    if (isModalOpen()) return;
    const v = this.viewAt(e.clientX, e.clientY);
    if (!v) return;
    e.preventDefault();
    if (e.ctrlKey) v.pan(-e.deltaY * 0.5, 0);
    else if (e.shiftKey) v.pan(0, -e.deltaY * 0.5);
    else v.zoom((e.deltaY > 0) !== !!this.app.settings.reverseZoom ? 1.12 : 1 / 1.12);
  }

  startOp(mode, view, lx, ly, tweak = false, lead = null) {
    const m = this.model;
    const ids = m.affectedNodes();
    if (!ids.size) {
      this.setStatus('Select something first.');
      return;
    }
    // the node that snaps onto other nodes: the one dragged, or the only selected node
    if (lead === null && mode === 'grab' && m.sel.nodes.size === 1 && !m.sel.parts.size) lead = [...m.sel.nodes][0];
    m.snapshot();
    const plan = m.symmetryPlan(ids);
    const all = new Set([...plan.drivers]);
    this.op = new TransformOp(this, mode, { ids: all, followers: plan.followers, center: plan.center }, view, lx, ly, { tweak, lead: mode === 'grab' ? lead : null });
    this.headerEl.textContent = this.op.text;
    this.headerEl.classList.remove('hidden');
    this.refreshUI();
  }

  startOpWithPlan(mode, plan) {
    const v = this._lastView || this.views[0];
    const lx = this._lastMouse ? this._lastMouse.x - v.rect.x : v.rect.w / 2;
    const ly = this._lastMouse ? this._lastMouse.y - v.rect.y : v.rect.h / 2;
    const drivers = new Set([...plan.ids].filter((id) => !plan.followers.has(id)));
    this.op = new TransformOp(this, mode, { ids: drivers, followers: plan.followers, center: plan.center }, v, lx, ly);
    this.op._undoOnCancel = true; // callers took a snapshot before creating the new geometry
    this.headerEl.textContent = this.op.text;
    this.headerEl.classList.remove('hidden');
  }

  finishOp(ok) {
    if (!this.op) return;
    if (ok) this.op.confirm();
    else {
      this.op.cancel();
      if (this.op._undoOnCancel) this.model.undo();
      else this.model.undoStack.pop();
    }
    this.op = null;
    this.headerEl.classList.add('hidden');
    this.refreshUI();
  }

  mouseView() {
    const p = this._lastMouse;
    if (!p) return { v: this.views[0], x: this.views[0].rect.w / 2, y: this.views[0].rect.h / 2 };
    const v = this.viewAt(p.x, p.y) || this.views[0];
    const l = v.local(p.x, p.y);
    return { v, x: l.x, y: l.y };
  }

  onKeyUp(e) {
    if (this.op && (e.key === 'Control' || e.key === 'Meta')) {
      this.op.ctrl = false;
      this.op.apply();
    }
  }

  onKey(e) {
    if (isModalOpen() || isTyping(e)) return;
    const k = e.key;
    const code = e.code;
    const ctrl = e.ctrlKey || e.metaKey;
    const m = this.model;
    // modal transform
    if (this.op) {
      if (k === 'Escape') { this.finishOp(false); e.preventDefault(); return; }
      if (k === 'Enter' || k === ' ') { this.finishOp(true); e.preventDefault(); return; }
      if (k === 'g' || k === 'r' || k === 's') {
        // switch operator, keep it running from the same start
        const op = this.op;
        op.cancel();
        const plan = { ids: new Set(op.drivers), followers: op.followers, center: op.center };
        this.op = new TransformOp(this, k === 'g' ? 'grab' : k === 'r' ? 'rotate' : 'scale', plan, op.view, op.start.x, op.start.y);
        this.op.vm = { ...op.vm };
        this.op.mouse = { ...op.mouse };
        this.op.apply();
        this.headerEl.textContent = this.op.text;
        return;
      }
      if (this.op.onKey(e)) {
        this.headerEl.textContent = this.op.text;
        e.preventDefault();
      }
      return;
    }
    const mv = this.mouseView();
    // numpad navigation (Blender)
    const numpad = {
      Numpad1: ctrl ? 'back' : 'front', Numpad3: ctrl ? 'left' : 'right', Numpad7: ctrl ? 'bottom' : 'top',
    };
    if (numpad[code]) { this.views[0].setView(numpad[code]); e.preventDefault(); return; }
    if (code === 'Numpad5') { const v = this.views[0]; v.ortho = !v.ortho; v._autoOrtho = false; v.update(); return; }
    if (code === 'Numpad4') { this.views[0].orbit(-15 / 0.008 * (Math.PI / 180), 0); return; }
    if (code === 'Numpad6') { this.views[0].orbit(15 / 0.008 * (Math.PI / 180), 0); return; }
    if (code === 'Numpad8') { this.views[0].orbit(0, 15 / 0.008 * (Math.PI / 180)); return; }
    if (code === 'Numpad2') { this.views[0].orbit(0, -15 / 0.008 * (Math.PI / 180)); return; }
    if (code === 'Numpad9') { this.views[0].yaw += Math.PI; this.views[0].update(); return; }
    if (code === 'NumpadDecimal' || code === 'NumpadComma') { this.frameAll(false); return; }
    if (code === 'Home') { this.frameAll(true); return; }
    if (code === 'NumpadAdd') { mv.v.zoom(1 / 1.15); return; }
    if (code === 'NumpadSubtract') { mv.v.zoom(1.15); return; }
    // view presets (original UI: 1..7)
    if (!ctrl && /^Digit[1-7]$/.test(code)) {
      this.setMainView(['persp', 'front', 'back', 'left', 'right', 'top', 'bottom'][Number(code.slice(5)) - 1]);
      return;
    }
    if (k === 'F1') { e.preventDefault(); this.showTutorial(); return; }
    if (k === 'F2') { e.preventDefault(); this.showHotkeys(); return; }
    if (k === 'Escape') {
      if (this.contextEl) { this.closeContext(); return; }
      if (this.tool) { this.cancelTool(); return; }
      this.openMenu();
      return;
    }
    if (k === 'Enter') { this.race(); return; }
    if (code === 'Space' || code === 'Tab') {
      e.preventDefault();
      this.scene.setRealView(!this.scene.realView);
      return;
    }
    if (ctrl && code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (ctrl && code === 'KeyY') { e.preventDefault(); this.redo(); return; }
    if (ctrl && code === 'KeyC') { this.clipboard = m.copyFragment(); this.setStatus(this.clipboard ? 'Copied.' : 'Nothing to copy.'); return; }
    if (ctrl && code === 'KeyV') {
      const plan = m.pasteFragment(this.clipboard, { x: 0, y: 0, z: 0 });
      if (plan) this.startOpWithPlan('grab', plan);
      return;
    }
    if (ctrl && code === 'KeyS') { e.preventDefault(); this.saveCar(); return; }
    if (ctrl && code === 'KeyI') { e.preventDefault(); m.invertSelection(); return; }
    if (ctrl) return;
    switch (code) {
      case 'KeyG': this.startOp('grab', mv.v, mv.x, mv.y); break;
      case 'KeyR': this.startOp('rotate', mv.v, mv.x, mv.y); break;
      case 'KeyS': this.startOp('scale', mv.v, mv.x, mv.y); break;
      case 'KeyE': {
        const plan = m.extrude();
        if (plan) {
          this.startOpWithPlan('grab', plan);
          this.op._undoOnCancel = true;
        } else this.setStatus('Select nodes to extrude.');
        break;
      }
      case 'KeyD':
        if (e.shiftKey) {
          const plan = m.duplicate();
          if (plan) {
            this.startOpWithPlan('grab', plan);
            this.op._undoOnCancel = true;
          }
        } else {
          this.scene.car.setDecorationsVisible(!this.scene.car.showDecorations);
          this.refreshUI();
        }
        break;
      case 'KeyF': { const msg = m.fill(); if (msg) this.setStatus(msg); break; }
      case 'KeyX': case 'Delete': m.deleteSelection(); break;
      case 'KeyM': { const msg = m.merge(); if (msg) this.setStatus(msg); break; }
      case 'KeyA':
        if (e.altKey) { e.preventDefault(); m.clearSelection(); m.changed('selection'); }
        else if (e.shiftKey) this.openAddMenu();
        else if (m.sel.nodes.size || m.sel.parts.size) { if (this._lastA && performance.now() - this._lastA < 400) { m.clearSelection(); m.changed('selection'); } else m.selectAll(); }
        else m.selectAll();
        this._lastA = performance.now();
        break;
      case 'KeyB': this.startBoxSelect(); break;
      case 'KeyH':
        if (e.altKey) { e.preventDefault(); m.unhideAll(); } else m.hideSelected(e.shiftKey);
        break;
      case 'KeyN': this.panelOn = !this.panelOn; this.refreshUI(); break;
      case 'KeyL': m.symmetry = !m.symmetry; this.setStatus(`Symmetry ${m.symmetry ? 'on' : 'off'}`); break;
      case 'KeyO': this.scene.car.setFramesOpaque(!this.scene.car.opaqueFrames); this.refreshUI(); break;
      case 'KeyC': this.scene.car.setPanelsVisible(!this.scene.car.showPanels); this.refreshUI(); break;
      default:
    }
  }

  startBoxSelect() {
    this.boxPending = true;
    this.setStatus('Box select: drag a rectangle.');
  }

  undo() {
    if (this.op) return;
    if (this.tool) this.tool.cancel();
    if (this.model.undo()) this.setStatus('Undo');
  }

  redo() {
    if (this.op) return;
    if (this.model.redo()) this.setStatus('Redo');
  }

  // ---------------- context + add menu ----------------
  openContext(cx, cy) {
    const m = this.model;
    const items = [
      ['Grab', 'G', () => { const mv = this.mouseView(); this.startOp('grab', mv.v, mv.x, mv.y); }],
      ['Rotate', 'R', () => { const mv = this.mouseView(); this.startOp('rotate', mv.v, mv.x, mv.y); }],
      ['Scale', 'S', () => { const mv = this.mouseView(); this.startOp('scale', mv.v, mv.x, mv.y); }],
      ['Extrude', 'E', () => { const plan = m.extrude(); if (plan) { this.startOpWithPlan('grab', plan); this.op._undoOnCancel = true; } }],
      ['Fill (frame / panel)', 'F', () => { const msg = m.fill(); if (msg) this.setStatus(msg); }],
      ['Duplicate', 'Shift D', () => { const plan = m.duplicate(); if (plan) { this.startOpWithPlan('grab', plan); this.op._undoOnCancel = true; } }],
      ['Merge at centre', 'M', () => { const msg = m.merge(); if (msg) this.setStatus(msg); }],
      ['Delete', 'X', () => m.deleteSelection()],
      ['Hide', 'H', () => m.hideSelected()],
      ['Unhide all', 'Alt H', () => m.unhideAll()],
      ['Frame selected', 'Numpad .', () => this.frameAll(false)],
    ];
    this.showMenuAt(cx, cy, 'Edit', items);
  }

  openAddMenu() {
    const mv = this.mouseView();
    const p = this._lastMouse || { x: 200, y: 200 };
    const items = TOOL_LIST.filter(([k]) => k !== 'presets').map(([k, label]) => [label, '', () => this.selectTool(k)]);
    items.unshift(['Node at cursor', '', () => {
      const tool = new PartTool(this, 'frame');
      const pt = tool.placePoint(mv.v, mv.x, mv.y);
      if (!pt) return;
      this.model.snapshot();
      const n = this.model.createNode(pt.x, pt.y, pt.z);
      this.model.clearSelection();
      this.model.sel.nodes.add(n.id);
      this.model.sel.activeNode = n.id;
      this.model.changed('topology');
    }]);
    this.showMenuAt(p.x, p.y, 'Add', items);
  }

  showMenuAt(cx, cy, title, items) {
    this.closeContext();
    const menu = el('div', { class: 'context-menu' }, [el('div', { class: 'ttl' }, title), ...items.map(([label, sc, fn]) => el('div', {
      class: 'ci',
      onclick: () => { this.closeContext(); fn(); },
    }, [el('span', label), el('span', { class: 'sc' }, sc)]))]);
    menu.style.left = `${Math.min(cx, window.innerWidth - 220)}px`;
    menu.style.top = `${Math.min(cy, window.innerHeight - items.length * 28 - 40)}px`;
    this.app.ui.appendChild(menu);
    this.contextEl = menu;
    setTimeout(() => {
      this._ctxClose = (ev) => { if (!menu.contains(ev.target)) this.closeContext(); };
      window.addEventListener('pointerdown', this._ctxClose);
    }, 0);
  }

  closeContext() {
    if (this.contextEl) {
      this.contextEl.remove();
      this.contextEl = null;
      window.removeEventListener('pointerdown', this._ctxClose);
    }
  }

  // ---------------- menu dialog (ESC) ----------------
  openMenu() {
    if (this.op) return;
    modal(this.app.ui, (box, close) => {
      box.classList.add('menu-dialog');
      const g = (title, buttons) => el('div', { class: 'group' }, [el('h3', title), ...buttons]);
      const b = (label, cls, fn) => el('button', { class: `btn ${cls}`, onclick: () => { close(true); fn(); } }, label);
      box.append(
        g('Files', [b('Save car', '', () => this.saveCar()), b('Load car', 'green', () => this.loadCar()), b('Clear design', 'red', () => this.clearDesign())]),
        g('Share (offline)', [b('Export car file', '', () => this.exportCar()), b('Import car file', 'green', () => this.importCar()), b('Preset cars', 'green', () => this.choosePreset())]),
        g('Background image', [el('div', { style: { display: 'flex', gap: '6px' } }, [b('Load', 'green', () => this.loadBackground()), b('Clear', '', () => this.scene.setBackgroundImage(null))]), el('div', { style: { height: '32px' } }), b('Settings...', '', () => this.openSettings())]),
        g('Parts', [b('Save copied parts', '', () => this.saveParts()), b('Load copied parts', 'green', () => this.loadParts())]),
        g('Parts files', [b('Export parts file', '', () => this.exportParts()), b('Import parts file', 'green', () => this.importParts())]),
        el('div', {}),
        el('div', { class: 'bottom' }, [
          el('button', { class: 'btn red', onclick: () => { close(true); this.exitToMenu(); } }, 'Exit to main menu'),
          el('button', { class: 'btn outline', onclick: () => close(false) }, 'Back (ESC)'),
        ]),
      );
    }, { class: 'menu' });
  }

  async saveCar() {
    const name = await promptBox(this.app.ui, 'Save car', 'Name', this.design.name || 'My car');
    if (!name) return;
    this.design.name = name;
    this.app.storage.saveCar(name, this.design, computeStats(this.design));
    this.flushSave();
    this.setStatus(`Saved “${name}”.`);
  }

  async loadCar() {
    const cars = this.app.storage.listCars();
    const items = cars.map((c) => ({
      label: c.name,
      meta: `${new Date(c.saved).toLocaleString()}${c.stats ? ` · ${Math.round(c.stats.mass)} kg · ${Math.round(c.stats.powerHp)} hp` : ''}`,
      value: c.name,
    }));
    const name = await listBox(this.app.ui, 'Load car', items, { empty: 'No saved cars yet. Use “Save car” first.', onDelete: (n) => this.app.storage.deleteCar(n) });
    if (!name) return;
    const d = this.app.storage.loadCar(name);
    if (!d) return;
    this.model.replaceDesign(d);
    this.afterReplace();
    this.setStatus(`Loaded “${name}”.`);
  }

  async clearDesign() {
    if (!(await confirmBox(this.app.ui, 'Clear design', 'Remove every node and part? (Ctrl+Z undoes this.)', 'Clear', true))) return;
    const d = cloneDesign(this.design);
    d.nodes = [];
    d.parts = [];
    this.model.replaceDesign(d);
    this.afterReplace();
  }

  exportCar() {
    const name = (this.design.name || 'car').replace(/[^\w\- ]+/g, '').trim() || 'car';
    downloadText(`${name}.dcbcar.json`, serializeDesign(this.design));
  }

  async importCar() {
    const f = await pickFile('.json,.dcbcar,application/json');
    if (!f) return;
    try {
      const d = deserializeDesign(f.data);
      this.model.replaceDesign(d);
      this.afterReplace();
      this.setStatus(`Imported ${f.name}.`);
    } catch (err) {
      alertBox(this.app.ui, 'Import failed', `That file isn't a car design (${err.message}).`);
    }
  }

  async loadBackground() {
    const f = await pickFile('image/*', true);
    if (f) this.scene.setBackgroundImage(f.data, 5);
  }

  async saveParts() {
    const frag = this.model.copyFragment();
    if (!frag) {
      this.setStatus('Select the parts to save first.');
      return;
    }
    const name = await promptBox(this.app.ui, 'Save copied parts', 'Name', 'Suspension corner');
    if (!name) return;
    this.app.storage.saveParts(name, frag);
    this.setStatus(`Saved parts “${name}”.`);
  }

  async loadParts() {
    const items = this.app.storage.listParts().map((p) => ({ label: p.name, meta: new Date(p.saved).toLocaleString(), value: p.name }));
    const name = await listBox(this.app.ui, 'Load copied parts', items, { empty: 'No saved parts yet.', onDelete: (n) => this.app.storage.deleteParts(n) });
    if (!name) return;
    const plan = this.model.pasteFragment(this.app.storage.loadParts(name));
    if (plan) this.startOpWithPlan('grab', plan);
  }

  exportParts() {
    const frag = this.model.copyFragment();
    if (!frag) {
      this.setStatus('Select the parts to export first.');
      return;
    }
    downloadText('parts.dcbparts.json', JSON.stringify(frag));
  }

  async importParts() {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const frag = JSON.parse(f.data);
      if (!frag.nodes || !frag.parts) throw new Error('missing nodes/parts');
      const plan = this.model.pasteFragment(frag);
      if (plan) this.startOpWithPlan('grab', plan);
    } catch (err) {
      alertBox(this.app.ui, 'Import failed', `That file isn't a parts file (${err.message}).`);
    }
  }

  async openSettings() {
    await settingsDialog(this.app.ui, (changed) => {
      const st = this.app.settings;
      if (changed.includes('profile')) {
        // another profile: open its car
        this.app.setScreen(new GarageScreen(this.app));
        return;
      }
      if (changed.includes('bgTop') || changed.includes('bgBottom')) this.scene.setBackground(st.bgTop, st.bgBottom);
      this.refreshUI();
    });
  }

  async exitToMenu() {
    this.flushSave();
    const { MainMenu } = await import('../ui/mainMenu.js');
    await this.app.setScreen(new MainMenu(this.app));
  }

  async race() {
    if (this.op) return;
    const issues = validateDesign(this.design);
    if (this.design.nodes.length === 0) {
      alertBox(this.app.ui, 'Nothing to drive', 'Build a car first, or load a preset car from the toolbar.');
      return;
    }
    const budget = this.upgradeBudget();
    if (budget && budget.left < 0) {
      alertBox(this.app.ui, 'Not enough coins', `This car costs <b>${budget.earned - budget.left} c.</b>, but you have earned <b>${budget.earned} c.</b> so far.<br><br>Lower some part levels (select the part and click a lower square on its level bar) or remove parts, then race to earn more coins.`);
      return;
    }
    if (issues.length) this.app.toast(issues[0], 3500);
    this.flushSave();
    const { DriveScreen } = await import('../drive/drive.js');
    // multiplayer: back to the game server we came from, with the changed car
    const mp = this.app.mp;
    if (this.app.mode !== 'career' && mp.connected && mp.lastRoom && !mp.room) {
      try {
        const room = await mp.join(mp.lastRoom.id);
        const world = await this.app.loadWorld(room.map, undefined, { remember: false });
        await this.app.setScreen(new DriveScreen(this.app, world, {}));
        return;
      } catch (e) {
        mp.lastRoom = null;
        this.app.toast(`Multiplayer: ${e.message}`, 3500);
      }
    }
    // Single player always races on the Default map, and goes straight to its map screen
    const world = this.app.mode === 'career' ? await this.app.loadWorld(CAREER_MAP, undefined, { remember: false }) : await this.app.loadWorld(this.app.settings.map);
    await this.app.setScreen(new DriveScreen(this.app, world, { openMap: this.app.mode === 'career' }));
  }

  showHotkeys() {
    const rows = [
      ['h', 'Navigation'],
      ['Right mouse drag', 'Rotate the view (Alt + left drag also rotates)'],
      ['Middle mouse drag / Shift + right drag', 'Pan'],
      ['Mouse wheel / Alt + Ctrl + left drag', 'Zoom'],
      ['Numpad 1 / 3 / 7', 'Front / right / top view (Ctrl: opposite side)'],
      ['Numpad 5', 'Toggle perspective / orthographic'],
      ['Numpad 2 4 6 8 / 9', 'Orbit in 15° steps / flip around'],
      ['Numpad . / Home', 'Frame selection / frame everything'],
      ['1 – 7', 'View presets (top bar)'],
      ['h', 'Selection'],
      ['Left click', 'Select (Shift: add / toggle)'],
      ['Left drag on empty space / B', 'Box select'],
      ['A / Alt+A / Ctrl+I', 'Select all / deselect / invert'],
      ['H / Shift+H / Alt+H', 'Hide selected / hide others / unhide'],
      ['h', 'Editing'],
      ['G / R / S', 'Move / rotate / scale (click-drag also moves)'],
      ['  then X Y Z', 'Lock to an axis (Shift + axis: lock to the plane)'],
      ['  then type a number', 'Exact value (metres / degrees / factor)'],
      ['  Ctrl / Shift', 'Toggle snapping / precision'],
      ['  Left click, Enter / right click, Esc', 'Confirm / cancel'],
      ['E', 'Extrude selected nodes (new nodes joined by frames)'],
      ['Ctrl + click', 'Extrude the active node to the cursor'],
      ['F', 'Fill: 2 nodes → frame, 3–4 nodes → panel(s)'],
      ['Shift+D', 'Duplicate'],
      ['M', 'Merge selected nodes'],
      ['X / Delete', 'Delete'],
      ['Shift+A', 'Add menu'],
      ['Right click (without dragging)', 'Edit menu'],
      ['N', 'Show / hide the part settings panel'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Ctrl+C / Ctrl+V', 'Copy / paste parts'],
      ['Ctrl+S', 'Save car'],
      ['h', 'Garage'],
      ['L / O / C / D', 'Symmetry / opaque frames / hide panels / hide decorations'],
      ['Space or Tab', 'Real view'],
      ['Enter', 'RACE!'],
      ['Esc', 'Menu'],
    ];
    modal(this.app.ui, (box, close) => {
      const grid = el('div', { class: 'hotkeys' });
      for (const [a, b] of rows) {
        if (a === 'h') grid.append(el('div', { class: 'h' }, b));
        else grid.append(el('div', { class: 'k' }, a), el('div', b));
      }
      box.append(el('h2', 'Hotkeys'), grid, el('div', { class: 'row' }, [el('button', { class: 'btn', onclick: () => close() }, 'Close')]));
    });
  }

  showTutorial() {
    const steps = [
      '<b>1. Look around.</b> Right-drag rotates the view, middle-drag pans, the wheel zooms. The right-hand views show the car from the top and the side.',
      '<b>2. Build a frame.</b> Pick the <i>Frame</i> tool and click in a view: every click places a node (snapped to the grid) and joins it to the previous one. Right-click ends the chain. With Symmetry Mode on, everything you build is mirrored to the other side.',
      '<b>3. Shape it like in Blender.</b> Select nodes and press G to move, R to rotate, S to scale. Press X, Y or Z to lock to an axis and type a number for exact values. E extrudes nodes, F joins two nodes with a frame, M merges nodes.',
      '<b>4. Triangulate.</b> A frame box only stays rigid when its faces have diagonals. Add cross-braces with F or the Frame tool, otherwise the car will fold up.',
      '<b>5. Add running gear.</b> Wheels need a hub node (the wheel centre) and an axle node. Shocks join a suspension arm to the chassis. Give the car an engine (two mount nodes) and a driver seat.',
      '<b>6. Tune.</b> Select a part: its settings replace the parts bar at the bottom. Drag the sliders, pick keys and tire types from the dropdowns, and click the coloured bar to upgrade engines, wheels and jets. Click empty space to get the parts bar back.',
      '<b>7. Race!</b> Press Enter. In the world press Esc for the map, R to respawn, G to come back to the garage.',
    ];
    modal(this.app.ui, (box, close) => {
      box.append(el('h2', 'Tutorial'), ...steps.map((s) => el('p', { html: s })), el('div', { class: 'row' }, [el('button', { class: 'btn', onclick: () => close() }, 'Got it')]));
    });
  }

  // ---------------- loop ----------------
  update() {
    if (this._propsDirty) {
      this._propsDirty = false;
      this.scene.setDesign(this.design);
      this.scene.setHighlights(this.design, this.model.sel, this.hover?.kind === 'part' ? this.hover.id : null);
    }
  }

  render() {
    // Settings > Garage: reduce the frames' radiuses when zooming in
    const fs = this.app.settings.thinFrames ? Math.min(1, Math.max(0.3, this.views[0].dist / 6)) : 1;
    if (Math.abs(fs - this.scene.car.frameScale) > 0.02) {
      this.scene.car.frameScale = fs;
      this.scene.car.update();
    }
    const size = this.app.renderer.getSize(new THREE.Vector2());
    this.scene.render(this.views, this.model.sel, this.model.hidden, this.hover?.kind === 'node' ? this.hover.id : null, size);
  }
}

// track the mouse globally for G/R/S started from the keyboard
window.addEventListener('pointermove', (e) => {
  const s = window.dcb?.screen;
  if (s instanceof GarageScreen) {
    s._lastMouse = { x: e.clientX, y: e.clientY };
    s._lastView = s.viewAt(e.clientX, e.clientY) || s._lastView;
  }
});

export { mirrorNodeMap, AXIS_COLORS };
