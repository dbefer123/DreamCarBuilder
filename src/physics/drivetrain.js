// Engine + gearbox + limited-slip coupling feeding torque to driven wheels.
import { actionValue } from './actions.js';

const RPM = (2 * Math.PI) / 60;
const RHO = 1.225;
const G = 9.81;

export class Drivetrain {
  constructor(sim) {
    this.sim = sim;
    const engines = sim.engines || [];
    this.powerW = sim.totalPowerHp * 745.7;
    this.driven = sim.wheels.filter((w) => w.driven);
    // engine part settings (several engines add up)
    const pw = engines.reduce((s, e) => s + e.power, 0);
    this.torqueCap = engines.length ? engines.reduce((s, e) => s + e.torqueLimit, 0) : Infinity;
    this.engineBraking = pw > 0 ? engines.reduce((s, e) => s + e.power * e.engineBraking, 0) / pw / 100 : 1;
    this.topSpeedSet = Math.max(0, ...engines.map((e) => e.topSpeed || 0)) / 3.6;
    const custom = engines.find((e) => Array.isArray(e.gearRatios) && e.gearRatios.length && e.gearRatios.every((g) => g > 0));
    this.customRatios = custom ? custom.gearRatios.slice() : null;
    this.keyUp = engines[0]?.gearUp || 'gearUp';
    this.keyDown = engines[0]?.gearDown || 'gearDown';
    this._upHeld = false;
    this._downHeld = false;
    this.idle = 900 * RPM;
    this.peak = 6200 * RPM;
    this.redline = 7000 * RPM;
    this.eta = 0.9;
    this.lsd = 300;
    this.gear = 1;
    this.shiftTimer = 0;
    this.sinceShift = 0;
    this.rpm = this.idle;
    this.rpmSmooth = this.idle;
    this.engineTorque = 0;
    this.load = 0;
    this.manual = false;
    this.tractionControl = true;
    this.stabilityControl = true;
    this.tc = 1;
    this.escCut = 1;
    this.escActive = 0;
    this.Tpp = this.powerW > 0 ? this.powerW / this.peak : 0;
    this._computeRatios();
  }

  _computeRatios() {
    const sim = this.sim;
    const Rd = this.driven.length ? this.driven.reduce((s, w) => s + w.R, 0) / this.driven.length : 0.33;
    this.Rd = Rd;
    const M = sim.totalMass;
    const P = this.powerW * this.eta;
    // top speed where power = aero drag + rolling resistance
    let lo = 5, hi = 200;
    for (let i = 0; i < 40; i++) {
      const v = (lo + hi) / 2;
      const need = (0.5 * RHO * sim.cdA * v * v + 0.015 * M * G) * v;
      if (need > P) hi = v; else lo = v;
    }
    const vTop = Math.min(180, Math.max(25, lo));
    this.vTop = vTop;
    // auto: peak power at the drag-limited top speed; set: rev limit at the chosen top speed
    const Gtop = this.topSpeedSet > 0 ? (this.redline * Rd) / this.topSpeedSet : (this.peak * Rd) / vTop;
    if (this.customRatios) {
      const g = this.customRatios;
      const last = g[g.length - 1];
      this.ratios = g.map((x) => (x / last) * Gtop);
      this.reverseRatio = -this.ratios[0];
      return;
    }
    const nW = Math.max(1, sim.wheels.length);
    const drivenLoad = (M * G * this.driven.length) / nW;
    const Tneeded = 1.1 * drivenLoad * Rd;
    let G1 = Tneeded / Math.max(1, Math.min(this.torqueCap, this.Tpp * 1.5) * this.eta);
    G1 = Math.min(Gtop * 4.5, Math.max(Gtop * 2.5, G1));
    const spread = G1 / Gtop;
    const N = spread > 3 ? 6 : spread > 2 ? 5 : spread > 1.6 ? 4 : 3;
    this.ratios = [];
    for (let i = 0; i < N; i++) this.ratios.push(G1 * Math.pow(Gtop / G1, i / (N - 1)));
    this.reverseRatio = -G1;
  }

  /** Gearbox ratios relative to top gear (what the Gear ratios dialog shows for automatic gearing). */
  relativeRatios() {
    const last = this.ratios[this.ratios.length - 1];
    return this.ratios.map((r) => Math.round((r / last) * 100) / 100);
  }

  get gearCount() {
    return this.ratios.length;
  }

  ratio() {
    if (this.gear === -1) return this.reverseRatio;
    if (this.gear === 0) return 0;
    return this.ratios[this.gear - 1];
  }

  gearLabel() {
    if (this.gear === -1) return 'R';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }

  torqueAt(w) {
    const x = w / this.peak;
    const low = Math.min(1, 0.55 + (0.45 * x) / 0.35);
    return this.Tpp * Math.max(0, 1.5 - 0.5 * x * x) * low;
  }

  avgDrivenOmega() {
    if (!this.driven.length) return 0;
    let s = 0;
    for (const w of this.driven) s += w.omega;
    return s / this.driven.length;
  }

  /** Per frame: gear selection (auto box + arcade reverse). */
  frameUpdate(dt, c) {
    this.sinceShift += dt;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    // manual gear keys (the engine part chooses which actions shift)
    const up = actionValue(c, this.keyUp) > 0.5, down = actionValue(c, this.keyDown) > 0.5;
    if (this.manual) {
      if (up && !this._upHeld) this.shiftUp();
      if (down && !this._downHeld) this.shiftDown();
    }
    this._upHeld = up;
    this._downHeld = down;
    const speed = this.sim.speed;
    // arcade direction selection
    if (c.reverse && this.gear !== -1 && speed < 1.0) {
      this.gear = -1;
      this.sinceShift = 0;
    } else if (!c.reverse && c.throttle > 0 && this.gear === -1 && speed > -1.0) {
      this.gear = 1;
      this.sinceShift = 0;
    }
    if (this.gear >= 1 && !this.manual) {
      const wv = Math.abs(this.avgDrivenOmega());
      const rpm = wv * this.ratios[this.gear - 1];
      if (rpm > 0.97 * this.redline && this.gear < this.ratios.length && this.sinceShift > 0.45) {
        this.gear++;
        this.shiftTimer = 0.16;
        this.sinceShift = 0;
      } else if (this.gear > 1 && this.sinceShift > 0.6) {
        const lower = wv * this.ratios[this.gear - 2];
        if (lower < 0.82 * this.redline && rpm < 0.62 * this.peak) {
          this.gear--;
          this.shiftTimer = 0.12;
          this.sinceShift = 0;
        }
      }
    }
    const target = Math.max(this.idle, this.rpm);
    this.rpmSmooth += (target - this.rpmSmooth) * Math.min(1, dt * 12);
    this._stability(dt, c);
  }

  /**
   * Electronic stability control: compares the measured yaw rate with the one the
   * steering asks for and brakes individual wheels (plus cuts power) to correct it.
   */
  _stability(dt, c) {
    const sim = this.sim;
    for (const w of sim.wheels) w.escBrake = 0;
    this.escActive = 0;
    let cutTarget = 1;
    const v = sim.speed;
    if (this.stabilityControl && v > 6 && sim.wheels.length >= 3 && sim.up.y > 0.5) {
      // estimate the steering angle from the front wheels' heading relative to the body
      const f = sim.fwd, u = sim.up, r = sim.right;
      let delta = 0, nf = 0, grounded = 0;
      for (const w of sim.wheels) {
        if (w.contact) grounded++;
        if (w.rear) continue;
        // wheel forward = spinSign * (up x axle)
        let wx = u.y * w.nz - u.z * w.ny, wy = u.z * w.nx - u.x * w.nz, wz = u.x * w.ny - u.y * w.nx;
        wx *= w.spinSign; wy *= w.spinSign; wz *= w.spinSign;
        const along = wx * f.x + wy * f.y + wz * f.z;
        const side = wx * r.x + wy * r.y + wz * r.z;
        delta += Math.atan2(side, along) + w.steer;
        nf++;
      }
      if (nf && grounded >= 3) {
        delta /= nf;
        const vch = 22;
        const rTarget = (-v * delta) / (sim.wheelbase * (1 + (v / vch) ** 2));
        const e = sim.yawRate - rTarget;
        // tight band when driving straight (acts as a yaw damper), looser while cornering
        const straight = Math.abs(c.steer) < 0.05 && v > 15;
        const margin = straight ? 0.004 : 0.012 + 0.15 * Math.abs(rTarget);
        const excess = Math.abs(e) - margin;
        if (excess > 0) {
          // e > 0: rotating left too fast -> brake right-hand wheels (and vice versa)
          const brakeRight = e > 0;
          const amount = Math.min(1, excess / 0.1) * sim.brakeBase * 0.8;
          for (const w of sim.wheels) {
            if (w.right !== brakeRight) continue;
            w.escBrake = amount * (w.rear ? 0.3 : 1);
          }
          cutTarget = Math.max(0.1, 1 - excess * 10);
          this.escActive = Math.min(1, excess / 0.1);
        }
      }
    }
    this.escCut = cutTarget < this.escCut ? cutTarget : Math.min(cutTarget, this.escCut + dt * 2);
  }

  shiftUp() {
    if (this.gear === -1) this.gear = 1;
    else if (this.gear < this.ratios.length) this.gear++;
    this.shiftTimer = 0.16;
    this.sinceShift = 0;
  }

  shiftDown() {
    if (this.gear > 1) this.gear--;
    else if (this.gear === 1 && this.sim.speed < 1) this.gear = -1;
    this.shiftTimer = 0.12;
    this.sinceShift = 0;
  }

  /** Per substep: distribute engine torque over driven wheels. */
  update(h, c) {
    const n = this.driven.length;
    if (!n) return;
    const G = this.ratio();
    const wAvg = this.avgDrivenOmega();
    let Te = 0;
    const throttle = c.throttle;
    const boost = c.boostActive ? 2.0 : 1.0;
    const wWheelEngine = wAvg * G;
    let wEngine;
    const cap = this.torqueCap;
    if (G === 0 || this.shiftTimer > 0) {
      wEngine = this.idle + throttle * (this.redline - this.idle) * 0.8;
      Te = 0;
    } else if (wWheelEngine < this.idle * 1.6) {
      // clutch slipping: engine held at launch rpm
      wEngine = this.idle * 1.6 + throttle * (0.55 * this.peak - this.idle * 1.6);
      Te = Math.min(cap, throttle * this.torqueAt(wEngine)) * boost;
    } else {
      wEngine = wWheelEngine;
      if (wEngine > this.redline) Te = 0;
      else Te = Math.min(cap, throttle * this.torqueAt(wEngine)) * boost;
      if (throttle < 0.05) Te = -this.Tpp * 0.12 * this.engineBraking * Math.min(1, wEngine / this.redline);
    }
    // crash damage around the engine(s) costs power
    if (Te > 0) Te *= this.sim.powerHealth ?? 1;
    // traction control: back off while driven wheels spin
    if (this.tractionControl && Te > 0) {
      let slip = 0;
      const dir = G < 0 ? -1 : 1;
      for (const w of this.driven) {
        if (!w.contact) continue;
        const s = (dir * (w.omega * w.R - w.vLong)) / Math.max(Math.abs(w.vLong), 3);
        if (s > slip) slip = s;
      }
      // keep slip under the point where the friction ellipse starts eating lateral grip
      const target = Math.abs(this.sim.speed) > 15 ? 0.028 : 0.06;
      if (slip > target) this.tc = Math.max(0.05, this.tc - h * (5 + 60 * (slip - target)));
      else this.tc = Math.min(1, this.tc + h * 1.2);
      Te *= this.tc;
    }
    if (Te > 0) Te *= this.escCut;
    this.rpm = wEngine;
    this.engineTorque = Te;
    this.load = throttle;
    const Tw = Te * G * this.eta;
    for (const w of this.driven) w.driveTorque = Tw * (w.share ?? 1 / n) + this.lsd * (wAvg - w.omega);
  }
}
