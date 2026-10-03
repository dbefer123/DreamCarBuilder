// Driving key bindings (Settings > Controls). Bindings store KeyboardEvent.code values, so
// they follow the physical key position; labels use the keyboard layout when the browser
// can tell (on an AZERTY keyboard the WASD scheme shows as Z Q S D).

// [action, label, default combination 1, default combination 2]
export const ACTIONS = [
  ['accelerate', 'Accelerate', 'KeyW', 'ArrowUp'],
  ['brake', 'Brake/Reverse', 'KeyS', 'ArrowDown'],
  ['steerLeft', 'Steer Left', 'KeyA', 'ArrowLeft'],
  ['steerRight', 'Steer Right', 'KeyD', 'ArrowRight'],
  ['handbrake', 'Hand Brake', 'Space', ''],
  ['boost', 'Boost', 'ShiftLeft', 'ShiftRight'],
  ['gearUp', 'Gear up', 'KeyE', ''],
  ['gearDown', 'Gear down', 'KeyQ', ''],
  ['jetUp', 'Jet Throttle Up', 'KeyX', ''],
  ['jetDown', 'Jet Throttle Down/Reverse', 'KeyZ', ''],
  ['horn', 'Horn', 'KeyH', ''],
  ['action1', 'Action 1', 'Digit1', ''],
  ['action2', 'Action 2', 'Digit2', ''],
  ['action3', 'Action 3', 'Digit3', ''],
  ['respawn', 'Respawn (Shift: restart race)', 'KeyR', ''],
  ['freeRide', 'Free ride', 'KeyF', ''],
  ['camera', 'Change camera', 'KeyV', ''],
  ['cameraReset', 'Reset camera', 'KeyC', ''],
  ['slowMotion', 'Slow motion', 'KeyT', ''],
  ['map', 'Map', 'Escape', 'KeyM'],
  ['garage', 'Exit to garage', 'KeyG', ''],
  ['chat', 'Chat (multiplayer)', 'KeyY', ''],
  ['raceJoin', 'Join a race (multiplayer)', 'KeyJ', ''],
];

export const ACTION_LABELS = Object.fromEntries(ACTIONS.map(([a, l]) => [a, l]));

export function defaultBindings() {
  return Object.fromEntries(ACTIONS.map(([a, , k1, k2]) => [a, [k1, k2]]));
}

/** Default gamepad mapping: right trigger throttle, left trigger brake, left stick steering. */
export function defaultPad() {
  return {
    throttle: { kind: 'button', index: 7 },
    brake: { kind: 'button', index: 6 },
    steering: { kind: 'axis', index: 0, invert: false },
  };
}

const DRIVE = ['accelerate', 'brake', 'steerLeft', 'steerRight'];
export const SCHEMES = {
  Arrows: [['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS'], ['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']],
  WASD: [['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown'], ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']],
  // ZQSD keyboards (AZERTY) report the same physical key codes as WASD
  ZQSD: [['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown'], ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']],
};

export function applyScheme(bindings, name) {
  const s = SCHEMES[name];
  DRIVE.forEach((a, i) => (bindings[a] = s[i].slice()));
  return bindings;
}

/** The bindings in effect (settings override the defaults per action). */
export function bindingsOf(settings) {
  const b = defaultBindings();
  if (settings.bindings) for (const [k, v] of Object.entries(settings.bindings)) if (b[k] && Array.isArray(v)) b[k] = v.slice(0, 2);
  return b;
}

/** Action bound to a key code, if any (first match in table order). */
export function actionForCode(settings, code) {
  const b = bindingsOf(settings);
  for (const [a] of ACTIONS) if (b[a].includes(code)) return a;
  return null;
}

let layoutMap = null;
if (typeof navigator !== 'undefined' && navigator.keyboard?.getLayoutMap) {
  navigator.keyboard.getLayoutMap().then((m) => (layoutMap = m)).catch(() => {});
}

const NAMES = {
  ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow',
  Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
};

/** Human-readable label for a key code. */
export function keyLabel(code) {
  if (!code) return '';
  if (NAMES[code]) return NAMES[code];
  const m = layoutMap?.get(code);
  if (m && m.trim()) return m.length === 1 ? m.toUpperCase() : m;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function padLabel(p) {
  if (!p) return 'Click to configure...';
  return p.kind === 'axis' ? `Axis ${p.index}${p.invert ? ' (inverted)' : ''}` : `Button ${p.index}`;
}
