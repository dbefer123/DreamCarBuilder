// Keyboard state for gameplay (the editor handles its own pointer/keyboard events).
// Driving actions go through the bindings in Settings > Controls.
import { settings } from './settings.js';
import { ACTIONS, bindingsOf, defaultPad } from './bindings.js';

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.enabled = true;
    target.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e)) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  is(...codes) {
    return codes.some((c) => c && this.down.has(c)) ? 1 : 0;
  }

  /** True once per key press (consumed). */
  hit(code) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame() {
    this.pressed.clear();
  }

  /** Driving input: every bound action (0..1), keyboard merged with the gamepad. */
  driving() {
    const b = bindingsOf(settings);
    const a = {};
    for (const [name] of ACTIONS) a[name] = this.is(...b[name]);
    const pad = { ...defaultPad(), ...(settings.pad || {}) };
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const read = (p, gp) => {
      if (!p) return 0;
      if (p.kind === 'axis') return (gp.axes[p.index] || 0) * (p.invert ? -1 : 1);
      return gp.buttons[p.index]?.value || 0;
    };
    for (const gp of pads) {
      if (!gp) continue;
      const st = read(pad.steering, gp);
      if (Math.abs(st) > 0.12) {
        if (st > 0) a.steerRight = Math.max(a.steerRight, st);
        else a.steerLeft = Math.max(a.steerLeft, -st);
      }
      a.accelerate = Math.max(a.accelerate, Math.max(0, read(pad.throttle, gp)));
      a.brake = Math.max(a.brake, Math.max(0, read(pad.brake, gp)));
      if (gp.buttons[0]?.pressed) a.handbrake = 1;
      if (gp.buttons[1]?.pressed) a.boost = 1;
      if (gp.buttons[5]?.pressed) a.gearUp = 1;
      if (gp.buttons[4]?.pressed) a.gearDown = 1;
    }
    // ArcadeControls input names
    return { ...a, up: a.accelerate, down: a.brake, left: a.steerLeft, right: a.steerRight };
  }
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
