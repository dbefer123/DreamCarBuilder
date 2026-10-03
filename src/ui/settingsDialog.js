// Settings dialog laid out like the original game: tab list on the left (the active tab is
// orange), settings on the right, Cancel / OK at the bottom. Tabs: Garage, Controls, Race,
// Sounds, Graphics, Driving (assists, added in this remake) and Preferences (profiles).
import { el } from './dom.js';
import { modal, confirmBox, promptBox } from './dialogs.js';
import { settings, saveSettings, DEFAULTS } from '../core/settings.js';
import { ACTIONS, bindingsOf, defaultBindings, defaultPad, applyScheme, keyLabel, padLabel } from '../core/bindings.js';
import { profiles } from '../core/profile.js';

const TABS = ['Garage', 'Controls', 'Race', 'Sounds', 'Graphics', 'Driving', 'Preferences'];
let lastTab = 'Garage';

/**
 * Opens the dialog. onApply(changedKeys) lets the caller react (rebuild post FX, camera...).
 * 'profile' is reported when the active profile changed (which happens immediately).
 */
export function settingsDialog(ui, onApply = () => {}, opts = {}) {
  const draft = structuredClone(settings);
  draft.bindings = bindingsOf(settings);
  draft.pad = { ...defaultPad(), ...(settings.pad || {}) };
  let tab = opts.tab || lastTab;
  let profileChanged = false;
  return modal(ui, (box, close) => {
    box.classList.add('settings-dialog');
    const tabsEl = el('div', { class: 'st-tabs' });
    const body = el('div', { class: 'st-body' });
    const finish = (ok) => {
      lastTab = tab;
      let changed = [];
      if (ok) {
        draft.bindings = sameJSON(draft.bindings, defaultBindings()) ? null : draft.bindings;
        draft.pad = sameJSON(draft.pad, defaultPad()) ? null : draft.pad;
        changed = Object.keys(draft).filter((k) => !sameJSON(draft[k], settings[k]));
        Object.assign(settings, draft);
        saveSettings();
        applyGlobal(changed);
      }
      if (profileChanged) changed.push('profile');
      if (changed.length) onApply(changed);
      close(ok);
    };
    const show = (name) => {
      tab = name;
      for (const t of tabsEl.children) t.classList.toggle('on', t.dataset.tab === name);
      body.innerHTML = '';
      BUILDERS[name](body, draft, {
        box,
        ui,
        rerender: () => show(name),
        profileChanged: () => (profileChanged = true),
      });
    };
    for (const name of TABS) tabsEl.append(el('div', { class: 'st-tab', 'data-tab': name, onclick: () => show(name) }, name));
    box.append(
      el('div', { class: 'st-title' }, [el('span', 'Settings'), el('span', { class: 'st-x', title: 'Close', onclick: () => finish(false) }, '✕')]),
      el('div', { class: 'st-main' }, [tabsEl, body]),
      el('div', { class: 'st-foot' }, [
        el('button', { class: 'btn outline', onclick: () => finish(false) }, 'Cancel'),
        el('button', { class: 'btn green', onclick: () => finish(true) }, 'OK'),
      ]),
    );
    show(tab);
  }, { class: 'settings', focus: false });
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Effects that don't depend on the current screen. */
function applyGlobal(changed) {
  const app = window.dcb;
  if (!app) return;
  if (changed.some((k) => ['quality', 'shadows', 'grass'].includes(k))) {
    app.renderer.shadowMap.enabled = settings.shadows !== false;
    app.invalidateWorldScene?.();
  }
  if (changed.includes('renderScale')) app.applyPixelRatio?.();
  if (changed.includes('windowed')) {
    try {
      if (!settings.windowed && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else if (settings.windowed && document.fullscreenElement) document.exitFullscreen?.();
    } catch {
      // fullscreen not allowed here
    }
  }
  if (changed.includes('antialias')) app.toast?.('Antialiasing of the 3D view changes after the page reloads (the post-processing part applies now).', 4000);
}

// ---------------- widgets ----------------
function check(draft, key, label, onChange) {
  const c = el('input', { type: 'checkbox', checked: !!draft[key] });
  c.addEventListener('change', () => {
    draft[key] = c.checked;
    onChange?.();
  });
  return el('label', { class: 'st-check' }, [c, el('span', label)]);
}

function slider(draft, key, label, min, max, step, fmt = (v) => v) {
  const r = el('input', { type: 'range', min, max, step, value: draft[key] });
  const n = el('input', { type: 'number', min, max, step, value: draft[key] });
  r.addEventListener('input', () => {
    draft[key] = Number(r.value);
    n.value = fmt(draft[key]);
  });
  n.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Number(n.value)));
    if (!Number.isFinite(v)) return;
    draft[key] = v;
    r.value = v;
  });
  return el('div', { class: 'st-slider' }, [el('span', { class: 'st-l' }, label), r, n]);
}

function textField(draft, key, label, maxlength) {
  const t = el('input', { type: 'text', value: draft[key] || '', maxlength });
  t.addEventListener('input', () => (draft[key] = t.value.trim()));
  return el('div', { class: 'st-select' }, [el('span', { class: 'st-l' }, label), t]);
}

function select(draft, key, label, options, onChange) {
  const s = el('select', {}, options.map(([v, t], i) => el('option', { value: String(i), selected: String(draft[key]) === String(v) }, t)));
  s.addEventListener('change', () => {
    draft[key] = options[Number(s.value)][0];
    onChange?.();
  });
  return el('div', { class: 'st-select' }, [el('span', { class: 'st-l' }, label), s]);
}

function resetBtn(draft, keys, rerender, label = 'Reset') {
  return el('button', {
    class: 'btn outline st-reset',
    onclick: () => {
      for (const k of keys) draft[k] = structuredClone(DEFAULTS[k]);
      rerender();
    },
  }, label);
}

// ---------------- tabs ----------------
const BUILDERS = {
  Garage(body, d, ctx) {
    const color = (key) => {
      const c = el('input', { type: 'color', value: d[key] });
      c.addEventListener('input', () => (d[key] = c.value));
      return c;
    };
    body.append(
      check(d, 'reverseLeft', 'Reverse of the left side wheels/transmissions'),
      check(d, 'showCOM', 'Center of mass'),
      check(d, 'showCOL', 'Center of lift'),
      check(d, 'reverseZoom', 'Reverse mouse wheel zoom'),
      check(d, 'swapMouse', 'Swap right and middle mouse buttons'),
      check(d, 'thinFrames', "Reduce the frames' radiuses when zooming in"),
      check(d, 'showCarInfo', 'Show the information about your car'),
      check(d, 'chainTools', 'Keep the part tool active after placing (chain frames)'),
      el('div', { class: 'st-colors' }, [el('span', 'Background colors:'), color('bgTop'), color('bgBottom'), resetBtn(d, ['bgTop', 'bgBottom'], ctx.rerender)]),
      el('p', { class: 'st-note' }, 'Reverse of the left side wheels: mirror-image wheels on the left spin the same way as the right ones, so both sides drive the car forward. Switch it off to set every wheel\'s direction yourself.'),
    );
  },

  Controls(body, d, ctx) {
    const table = el('div', { class: 'st-keys' }, [el('div', { class: 'h' }, 'Action'), el('div', { class: 'h' }, 'Combination 1'), el('div', { class: 'h' }, 'Combination 2')]);
    const capture = (cell, action, slot) => {
      cell.textContent = 'Press a key...';
      cell.classList.add('wait');
      ctx.box.dataset.capturing = '1';
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', onKey, true);
        delete ctx.box.dataset.capturing;
        // Esc cancels, except when binding the map (whose default key is Esc)
        if (e.code !== 'Escape' || action === 'map') {
          let code = e.code;
          if (e.code === 'Backspace' || e.code === 'Delete') code = '';
          if (code) for (const [a] of ACTIONS) d.bindings[a] = d.bindings[a].map((c) => (c === code ? '' : c));
          d.bindings[action][slot] = code;
        }
        ctx.rerender();
      };
      // registered after the dialog's own Escape handler, which checks the capturing flag
      setTimeout(() => window.addEventListener('keydown', onKey, true), 0);
    };
    for (const [action, label] of ACTIONS) {
      table.append(el('div', { class: 'a' }, label));
      for (let slot = 0; slot < 2; slot++) {
        const cell = el('div', { class: 'k', title: 'Click, then press a key (Backspace clears)' }, keyLabel(d.bindings[action][slot]) || '—');
        cell.addEventListener('click', () => capture(cell, action, slot));
        table.append(cell);
      }
    }
    for (const [key, label] of [['throttle', 'Controller Throttle'], ['brake', 'Controller Brake'], ['steering', 'Controller Steering']]) {
      const cell = el('div', { class: 'k pad', title: 'Click, then move the stick / pull the trigger / press the button' }, padLabel(d.pad[key]));
      cell.addEventListener('click', () => configurePad(cell, d, key, ctx));
      table.append(el('div', { class: 'a' }, label), cell, el('div', { class: 'k dim' }, ''));
    }
    body.append(
      table,
      el('div', { class: 'st-schemes' }, [
        el('span', 'Scheme:'),
        ...['Arrows', 'WASD', 'ZQSD'].map((n) => el('button', { class: 'btn', onclick: () => { applyScheme(d.bindings, n); ctx.rerender(); } }, n)),
        el('button', { class: 'btn outline', onclick: () => { d.bindings = defaultBindings(); d.pad = defaultPad(); ctx.rerender(); } }, 'Reset'),
      ]),
      el('p', { class: 'st-note' }, 'Parts use these actions too: a rod set to "Action 1" moves with that key, an engine shifts with its Gear up / Gear down keys (manual gearbox), a jet in "Throttle keys" mode uses the jet throttle keys. ZQSD is the same physical keys as WASD on an AZERTY keyboard.'),
    );
  },

  Race(body, d, ctx) {
    body.append(
      slider(d, 'fov', 'Vertical field of view', 40, 110, 1),
      slider(d, 'cameraAdvance', 'Advance of the camera', 0, 2, 1),
      el('div', { class: 'st-note' }, '(0 - Velocity direction, 1 - Car direction, 2 - Advance)'),
      el('div', {}, [resetBtn(d, ['fov', 'cameraAdvance'], ctx.rerender)]),
      check(d, 'showGhost', 'Show your best race'),
      el('p', { class: 'st-note' }, 'Show your best race: in competitions, a see-through copy of the car replays your best run.'),
    );
  },

  Sounds(body, d, ctx) {
    body.append(
      slider(d, 'volEngine', 'Engine', 0, 100, 1),
      slider(d, 'volWheels', 'Wheels', 0, 100, 1),
      slider(d, 'volWind', 'Wind', 0, 100, 1),
      slider(d, 'volImpacts', 'Impacts', 0, 100, 1),
      slider(d, 'volEffects', 'Effects', 0, 100, 1),
      slider(d, 'volume', 'Master volume', 0, 1, 0.05),
      el('div', {}, [resetBtn(d, ['volEngine', 'volWheels', 'volWind', 'volImpacts', 'volEffects', 'volume'], ctx.rerender)]),
    );
  },

  Graphics(body, d, ctx) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const res = [0.5, 0.67, 0.75, 1, 1.25, 1.5].map((s) => [s, `${Math.round(window.innerWidth * dpr * s)} x ${Math.round(window.innerHeight * dpr * s)}${s === 1 ? ' (native)' : ''}`]);
    const monitor = el('div', { class: 'st-select' }, [
      el('span', { class: 'st-l' }, 'Select monitor'),
      el('select', { disabled: true, title: 'Browsers can\'t choose a monitor: move the window instead.' }, [el('option', 'Current monitor')]),
    ]);
    body.append(
      check(d, 'windowed', 'Windowed'),
      select(d, 'renderScale', 'Screen resolution', res),
      monitor,
      select(d, 'quality', 'Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']]),
      check(d, 'vsync', 'V Sync', ctx.rerender),
      ...(d.vsync ? [] : [select(d, 'frameLimit', 'Frame limit', [[30, '30 fps'], [60, '60 fps'], [90, '90 fps'], [120, '120 fps'], [144, '144 fps']])]),
      check(d, 'antialias', 'Antialiasing'),
      check(d, 'bloom', 'Bloom'),
      el('div', { class: 'st-sub' }, 'More'),
      check(d, 'ao', 'Ambient occlusion (High / Ultra)'),
      check(d, 'shadows', 'Shadows'),
      check(d, 'grass', 'Grass (Medium and above)'),
      el('p', { class: 'st-note' }, 'Quality, shadows and grass apply the next time a map loads (for example after the garage).'),
    );
  },

  Driving(body, d) {
    body.append(
      select(d, 'gearbox', 'Gearbox', [['auto', 'Automatic'], ['manual', 'Manual (engine gear keys)']]),
      check(d, 'abs', 'ABS (strength per wheel in its settings)'),
      check(d, 'tractionControl', 'Traction control'),
      check(d, 'stability', 'Stability control'),
      check(d, 'steerAssist', 'Speed-sensitive steering (rods use their Car speed factor)'),
      select(d, 'physicsRate', 'Physics accuracy', [[0, "Car's setting (seat)"], [1000, 'Normal (1 kHz)'], [2000, 'Advanced (2 kHz)'], [4000, 'Extreme (4 kHz)']]),
      el('p', { class: 'st-note' }, 'Driving assists are not in the original game; switch them all off for its raw handling.'),
    );
  },

  Preferences(body, d, ctx) {
    const list = profiles.list();
    const cur = profiles.active();
    const sel = el('select', {}, list.map((p) => el('option', { value: p.id, selected: p.id === cur.id }, p.name)));
    sel.addEventListener('change', () => {
      window.dcb?.selectProfile(sel.value);
      ctx.profileChanged();
      ctx.rerender();
    });
    body.append(
      el('p', { class: 'st-note' }, 'These settings are available on the start page of the game:'),
      select(d, 'language', 'Language', [['en', 'English']]),
      select(d, 'units', 'Speed unit', [['mph', 'mph'], ['kmh', 'km/h']]),
      textField(d, 'mpName', 'Multiplayer name', 24),
      el('div', { class: 'st-sub' }, 'Profiles'),
      el('div', { class: 'st-profiles' }, [
        sel,
        el('button', {
          class: 'btn green',
          onclick: async () => {
            const name = await promptBox(ctx.ui, 'New Game', 'Name', `Game ${list.length + 1}`);
            if (!name) return;
            const id = profiles.create(name);
            window.dcb?.selectProfile(id);
            ctx.profileChanged();
            ctx.rerender();
          },
        }, 'New Game'),
        el('button', {
          class: 'btn red',
          disabled: list.length < 2,
          onclick: async () => {
            const p = profiles.active();
            if (!(await confirmBox(ctx.ui, 'Delete this game', `Delete "${p.name}" with its cars, tracks, best times and Single player progress? This can't be undone.`, 'Delete', true))) return;
            profiles.remove(p.id);
            window.dcb?.selectProfile(profiles.active().id);
            ctx.profileChanged();
            ctx.rerender();
          },
        }, 'Delete this game'),
      ]),
      el('p', { class: 'st-note' }, 'Each game has its own car library, copied parts, custom tracks, best times and Single player coins. Settings are shared.'),
    );
  },
};

/** Wait for a gamepad axis or button and assign it to a controller action. */
function configurePad(cell, d, key, ctx) {
  const pads = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  if (!pads().length) {
    cell.textContent = 'No controller found: press a button on it first';
    setTimeout(() => ctx.rerender(), 2500);
    return;
  }
  cell.textContent = key === 'steering' ? 'Move the stick to the right...' : 'Pull the trigger / press the button...';
  const base = pads().map((p) => p.axes.slice());
  const t0 = performance.now();
  const poll = () => {
    if (!cell.isConnected) return;
    for (const [pi, p] of pads().entries()) {
      for (let i = 0; i < p.buttons.length; i++) {
        if (p.buttons[i].value > 0.5) {
          d.pad[key] = { kind: 'button', index: i };
          ctx.rerender();
          return;
        }
      }
      for (let i = 0; i < p.axes.length; i++) {
        const dv = p.axes[i] - (base[pi]?.[i] ?? 0);
        if (Math.abs(dv) > 0.5) {
          d.pad[key] = { kind: 'axis', index: i, invert: dv < 0 };
          ctx.rerender();
          return;
        }
      }
    }
    if (performance.now() - t0 > 8000) {
      ctx.rerender();
      return;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}
