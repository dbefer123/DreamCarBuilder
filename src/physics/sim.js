// XPBD node-beam car simulation ("small steps": many substeps, one iteration each).
// No DOM / three.js dependencies so it can run headless in Node.
import { nodeMasses, bounds, triArea, driveLayout, driverSeat } from '../car/design.js';
import {
  wheelMass, wheelLevelFactors, enginePower, jetThrust, frameYield, frameBreakStrain,
} from '../car/parts.js';
import { SURFACES, NODE_FRICTION, TIRE_GRIP, TIRE_RR } from './surfaces.js';
import { stepWheel } from './tire.js';
import { Drivetrain } from './drivetrain.js';
import { actionValue } from './actions.js';

const GRAV = 9.81;
const RHO = 1.225;
const NODE_RADIUS = 0.04;

const C_FRAME = 0, C_SHOCK = 1, C_ROD = 2, C_LIMIT = 3;

const _N = { x: 0, y: 1, z: 0 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class CarSim {
  /**
   * @param design car design
   * @param world  { heightAt(x,z), normalAt(x,z,out), surfaceAt(x,z), queryColliders(minx,minz,maxx,maxz,out) }
   */
  constructor(design, world, opts = {}) {
    this.world = world;
    this.opts = opts;
    this.plasticity = opts.plasticity ?? true;
    this.breakable = opts.breakable ?? true;
    this.abs = opts.abs ?? true;
    this.gripScale = opts.gripScale ?? 1;
    this.iterations = opts.iterations ?? 1; // symmetric GS passes per substep
    this.design = design;
    this.time = 0;
    this.acc = 0;
    this.sweep = 0;
    this.boostCapacity = 10;
    this.boostLevel = 10;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, boost: 0, reverse: false, boostActive: false };
    this.activeColliders = [];
    this.knockedOut = false;
    this._build(design);
  }

  _build(d) {
    const nodes = d.nodes;
    const n = nodes.length;
    this.n = n;
    this.index = new Map();
    nodes.forEach((nd, i) => this.index.set(nd.id, i));
    const F64 = (k) => new Float64Array(k);
    this.px = F64(n); this.py = F64(n); this.pz = F64(n);
    this.ox = F64(n); this.oy = F64(n); this.oz = F64(n);
    this.vx = F64(n); this.vy = F64(n); this.vz = F64(n);
    this.fx = F64(n); this.fy = F64(n); this.fz = F64(n);
    this.restX = F64(n); this.restY = F64(n); this.restZ = F64(n);
    this.mass = F64(n);
    this.invMass = F64(n);
    this.radius = new Float64Array(n).fill(NODE_RADIUS);
    this.colRadius = new Float64Array(n).fill(NODE_RADIUS);
    this.nodeFric = new Float32Array(n);
    this.scrape = new Float32Array(n); // scraping speed for sparks
    const masses = nodeMasses(d);
    // Single player length penalty: every node gets proportionally heavier
    const massScale = this.opts.massScale || 1;
    let M = 0;
    nodes.forEach((nd, i) => {
      this.restX[i] = nd.x; this.restY[i] = nd.y; this.restZ[i] = nd.z;
      const m = Math.max(0.3, masses.get(nd.id) || 0.3) * massScale;
      this.mass[i] = m;
      this.invMass[i] = 1 / m;
      this.nodeFric[i] = nd.friction ?? NODE_FRICTION;
      M += m;
    });
    this.totalMass = M;
    const I = (id) => this.index.get(id);
    const restDist = (a, b) => Math.hypot(this.restX[a] - this.restX[b], this.restY[a] - this.restY[b], this.restZ[a] - this.restZ[b]);

    // reference shape (rest positions relative to the rest centre of mass)
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += this.mass[i] * this.restX[i]; cy += this.mass[i] * this.restY[i]; cz += this.mass[i] * this.restZ[i];
    }
    cx /= M || 1; cy /= M || 1; cz /= M || 1;
    this.restCom = { x: cx, y: cy, z: cz };
    this.qx = F64(n); this.qy = F64(n); this.qz = F64(n);
    for (let i = 0; i < n; i++) {
      this.qx[i] = this.restX[i] - cx; this.qy[i] = this.restY[i] - cy; this.qz[i] = this.restZ[i] - cz;
    }

    // ---- constraints ----
    // Two-node distance constraints: frames, shocks, rods, limiters, and angle locks
    // (a plastic distance between the two outer nodes). Nearly straight angle locks and
    // sliders are point-on-line constraints solved separately.
    const cons = [];
    this.lines = []; // { a, b, s, t (fixed parameter, or -1 = free slider) }
    for (const p of d.parts) {
      if (p.type === 'frame' || p.type === 'shock' || p.type === 'rod' || p.type === 'limiter') {
        cons.push({ p, a: I(p.n[0]), b: I(p.n[1]) });
      } else if (p.type === 'angleLock') {
        const a = I(p.n[0]), jn = I(p.n[1]), c = I(p.n[2]);
        const ux = this.restX[c] - this.restX[a], uy = this.restY[c] - this.restY[a], uz = this.restZ[c] - this.restZ[a];
        const uu = ux * ux + uy * uy + uz * uz;
        if (uu < 1e-10) continue;
        const t = ((this.restX[jn] - this.restX[a]) * ux + (this.restY[jn] - this.restY[a]) * uy + (this.restZ[jn] - this.restZ[a]) * uz) / uu;
        const ex = this.restX[a] + ux * t - this.restX[jn], ey = this.restY[a] + uy * t - this.restY[jn], ez = this.restZ[a] + uz * t - this.restZ[jn];
        const off = Math.hypot(ex, ey, ez);
        // a straight joint has no first-order stiffness as a distance: lock the joint onto the line instead
        if (off < 0.03 * Math.sqrt(uu) && t > 0.02 && t < 0.98) this.lines.push({ a, b: c, s: jn, t, partId: p.id });
        else cons.push({ p, a, b: c, lock: true });
      } else if (p.type === 'slider') {
        this.lines.push({ a: I(p.n[0]), b: I(p.n[1]), s: I(p.n[2]), t: -1, partId: p.id });
      }
    }
    const k = cons.length;
    this.nc = k;
    this.ca = new Int32Array(k); this.cb = new Int32Array(k);
    this.ctype = new Uint8Array(k);
    this.rest = F64(k); this.rest0 = F64(k); this.base = F64(k);
    this.compl = F64(k); this.damp = F64(k); this.dampR = F64(k);
    this.minL = F64(k); this.maxL = F64(k);
    this.yieldT = F64(k); this.yieldC = F64(k);
    this.breakDev = F64(k);
    this.broken = new Uint8Array(k);
    this.deformAmt = new Float32Array(k);
    this.force = new Float32Array(k);
    this.lambda = new Float64Array(k);
    this.cPart = new Array(k);
    this.partToCon = new Map();
    this.rods = [];
    this.frameCount = 0;
    const nodeFrames = Array.from({ length: n }, () => []);
    cons.forEach(({ p, a, b, lock }, j) => {
      this.ca[j] = a; this.cb[j] = b;
      const L = restDist(a, b);
      this.base[j] = L;
      this.cPart[j] = p.id;
      this.partToCon.set(p.id, j);
      if (lock) {
        this.ctype[j] = C_FRAME;
        this.rest[j] = this.rest0[j] = L;
        const y = 20000 * (p.elasticLimit / 100) * (p.weightHardness / 4);
        this.yieldT[j] = this.yieldC[j] = y;
        this.breakDev[j] = 0.45;
        this.frameCount++;
        nodeFrames[a].push(j); nodeFrames[b].push(j);
        return;
      }
      switch (p.type) {
        case 'frame': {
          this.ctype[j] = C_FRAME;
          this.rest[j] = this.rest0[j] = L;
          const y = frameYield(p);
          this.yieldT[j] = y;
          this.yieldC[j] = y * 0.8;
          this.breakDev[j] = frameBreakStrain(p);
          this.frameCount++;
          nodeFrames[a].push(j); nodeFrames[b].push(j);
          if (p.minRadius > NODE_RADIUS) {
            for (const i of [a, b]) {
              this.radius[i] = Math.max(this.radius[i], p.minRadius);
              this.colRadius[i] = Math.max(this.colRadius[i], p.minRadius);
            }
          }
          break;
        }
        case 'shock': {
          this.ctype[j] = C_SHOCK;
          this.rest[j] = this.rest0[j] = L * p.preCompression;
          this.compl[j] = 1 / Math.max(1, p.hardness);
          const c = p.damping * 100;
          this.damp[j] = c;
          this.dampR[j] = p.rcRatio > 0 ? c * p.rcRatio : c;
          this.minL[j] = L * clamp(1 - p.maxCompression, 0.05, 1);
          this.maxL[j] = L * Math.max(1, p.maxStretch);
          break;
        }
        case 'rod': {
          this.ctype[j] = C_ROD;
          const u0 = p.initial === 'compressed' ? -1 : p.initial === 'stretched' ? 1 : 0;
          const r = {
            j,
            piston: p.mode === 'piston',
            maxC: clamp(p.maxCompression, 0, 0.95),
            maxS: Math.max(1, p.maxStretch),
            ret: Math.max(0.01, p.returnTime),
            ratio: Math.max(0.05, p.ratioOfPeriods ?? 1),
            speedFactor: p.speedFactor ?? 0,
            keyC: p.keyCompress,
            keyS: p.keyStretch,
            u0,
            u: u0,
          };
          this.rods.push(r);
          this.rest[j] = this.rest0[j] = this._rodLength(r, L);
          break;
        }
        case 'limiter':
          this.ctype[j] = C_LIMIT;
          this.rest[j] = this.rest0[j] = L;
          this.minL[j] = L * clamp(1 - p.maxCompression, 0, 1);
          this.maxL[j] = L * Math.max(1, p.maxStretch);
          if (p.minRadius > NODE_RADIUS) {
            for (const i of [a, b]) {
              this.radius[i] = Math.max(this.radius[i], p.minRadius);
              this.colRadius[i] = Math.max(this.colRadius[i], p.minRadius);
            }
          }
          break;
      }
    });
    for (const ln of this.lines) {
      const L = restDist(ln.a, ln.b);
      ln.L = L;
    }

    // ---- wheels ----
    const layout = driveLayout(d);
    this.wheels = [];
    this.damageParts = [];
    const framesAt = (ids) => {
      const set = new Set();
      for (const i of ids) for (const j of nodeFrames[i]) set.add(j);
      return [...set];
    };
    const wheelParts = d.parts.filter((p) => p.type === 'wheel');
    for (const p of wheelParts) {
      const a = I(p.n[0]), b = I(p.n[1]);
      const ax = this.restX[a] - this.restX[b], az = this.restZ[a] - this.restZ[b];
      const ay = this.restY[a] - this.restY[b];
      const al = Math.hypot(ax, ay, az) || 1;
      // forward = up x axis = (az, 0, -ax)
      const fxr = az / al;
      // Settings > Garage 'Reverse of the left side wheels': mirror-image wheels drive the same way
      const spinSign = this.opts.autoReverse !== false && Math.abs(fxr) > 0.05 ? Math.sign(fxr) : 1;
      const m = wheelMass(p);
      const share = layout.engines.length ? layout.wheels.get(p.id) || 0 : 0;
      const pr = clamp(p.pressure ?? 32, 5, 150);
      const th = clamp(p.tireHeight ?? 0.4, 0.05, 0.9);
      const w = {
        partId: p.id,
        a, b,
        R: p.radius,
        W: p.width,
        I: 0.6 * m * p.radius * p.radius,
        driven: share > 0,
        share,
        steerMax: (p.steer * Math.PI) / 180,
        toeRad: ((p.toe || 0) * Math.PI) / 180,
        loadRef: 0,
        brake: p.brake ?? 1,
        handbrakeKey: p.handbrakeKey || 'none',
        hb: 0,
        grip: (p.grip ?? 1) * wheelLevelFactors(p.level || 10).grip,
        tireGrip: TIRE_GRIP[p.tireType] || TIRE_GRIP.road,
        tireRR: TIRE_RR[p.tireType] || TIRE_RR.road,
        kPress: Math.sqrt(pr / 32),
        cPress: Math.pow(pr / 32, 0.15),
        looseGrip: Math.pow(32 / pr, 0.12),
        hardGrip: 1 - 0.04 * Math.log(pr / 32) ** 2,
        rrPress: Math.pow(32 / pr, 0.3),
        rimFrac: 1 - th,
        bottomFrac: 0.55 * th,
        absSlip: p.abs > 0 ? 0.04 + 0.1 * (1 - Math.min(10, p.abs) / 10) : 0,
        health: 1,
        widthFactor: Math.pow(p.width / 0.25, 0.35),
        widthGrip: Math.pow(p.width / 0.25, 0.08),
        escBrake: 0,
        spinSign,
        omega: 0, phi: 0, steer: 0,
        defX: 0, defY: 0,
        driveTorque: 0, rrTorque: 0,
        contact: false, load: 0, slipVel: 0, vLong: 0, vLat: 0,
        cpx: 0, cpy: 0, cpz: 0,
        nx: 0, ny: 0, nz: 1,
        surface: SURFACES[0],
        hubRadius: p.radius * (1 - th),
        cornerMass: 100,
      };
      this.wheels.push(w);
      this.colRadius[a] = Math.max(this.colRadius[a], p.radius);
      this.damageParts.push({ ref: w, cons: framesAt([a, b]), th: 0.04 * (p.elasticLimit / 25), floor: 0.35 });
    }
    const nW = Math.max(1, this.wheels.length);
    let frontX = -Infinity, rearX = Infinity;
    for (const w of this.wheels) {
      w.cornerMass = M / nW;
      w.rear = this.restX[w.a] < cx;
      w.right = this.restZ[w.a] > cz;
      w.toe = w.right ? -w.toeRad : w.toeRad;
      frontX = Math.max(frontX, this.restX[w.a]);
      rearX = Math.min(rearX, this.restX[w.a]);
    }
    this.wheelbase = this.wheels.length > 1 ? Math.max(0.5, frontX - rearX) : 2.5;
    this.avgWheelR = this.wheels.length ? this.wheels.reduce((s, w) => s + w.R, 0) / nW : 0.33;
    this.brakeBase = (1.25 * M * GRAV * this.avgWheelR) / nW;

    // ---- engines, jets, panels, seat ----
    this.engines = [];
    for (const p of layout.engines) {
      const e = {
        partId: p.id,
        power: enginePower(p),
        torqueLimit: p.torqueLimit ?? 1600,
        engineBraking: p.engineBraking ?? 100,
        topSpeed: p.topSpeed || 0,
        gearRatios: p.gearRatios,
        gearUp: p.gearUp,
        gearDown: p.gearDown,
        health: 1,
      };
      this.engines.push(e);
      this.damageParts.push({ ref: e, cons: framesAt(p.n.map(I)), th: 0.04 * (p.elasticLimit / 25), floor: 0.15 });
    }
    this.totalPowerHp = this.engines.reduce((s, e) => s + e.power, 0);
    this.powerHealth = 1;
    this.jets = [];
    this.panels = [];
    // the driver's seat (passenger seats only add mass)
    const driver = driverSeat(d);
    this.seat = -1;
    this.seatPart = null;
    for (const p of d.parts) {
      if (p.type === 'jet') {
        const jt = {
          partId: p.id, a: I(p.n[0]), b: I(p.n[1]),
          thrust: jetThrust(p),
          mode: p.mode || 'accelerate',
          spool: p.spoolTime || 0,
          keyUp: p.throttleUp, keyDown: p.throttleDown,
          cur: 0, thr: 0, on: 0, health: 1,
        };
        this.jets.push(jt);
        this.damageParts.push({ ref: jt, cons: framesAt([jt.a, jt.b]), th: 0.04 * (p.elasticLimit / 25), floor: 0 });
      } else if (p.type === 'panel' && (p.drag || p.lift)) {
        const ids = p.n.map(I);
        this.panels.push({ a: ids[0], b: ids[1], c: ids[2], drag: p.drag || 0, lift: p.lift || 0, balance: p.balance || 0 });
      } else if (p === driver) {
        this.seat = I(p.n[0]);
        this.seatPart = p;
        const st = { health: 1 };
        this.seatState = st;
        this.damageParts.push({ ref: st, cons: framesAt([this.seat]), th: 0.06 * (p.elasticLimit / 25), floor: 0, seat: true });
      }
    }
    this.airRes = (this.seatPart?.airResistance ?? 100) / 100;
    this.rate = this.opts.rate || this.seatPart?.physics || 2000;
    this.maxSubsteps = this.opts.maxSubsteps || Math.ceil(this.rate / 20);

    // aerodynamic base drag from the frontal bounding area
    const bb = bounds(d);
    const frontal = Math.max(0.3, (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z));
    this.cdA = (0.35 + 0.22 * frontal) * this.airRes;
    this.drivetrain = new Drivetrain(this);

    // ---- per-frame outputs ----
    this.com = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.quat = [0, 0, 0, 1];
    this.fwd = { x: 1, y: 0, z: 0 };
    this.up = { x: 0, y: 1, z: 0 };
    this.right = { x: 0, y: 0, z: 1 };
    this.speed = 0;
    this.yawRate = 0;
    this.deformation = 0;
    this.brokenCount = 0;
    this.spawnTime = 0;
    this.spawn(0, 0, 0);
  }

  _rodLength(r, L) {
    return r.u >= 0 ? L * (1 + (r.maxS - 1) * r.u) : L * (1 + r.maxC * r.u);
  }

  /** Place the car at (x, z) with heading (radians, rotation about +Y; 0 = facing +X). */
  spawn(x, z, heading = 0, lift = 0.05) {
    const c = Math.cos(heading), s = Math.sin(heading);
    const rc = this.restCom;
    for (let i = 0; i < this.n; i++) {
      const lx = this.restX[i] - rc.x, lz = this.restZ[i] - rc.z;
      this.px[i] = x + lx * c + lz * s;
      this.pz[i] = z - lx * s + lz * c;
      this.py[i] = this.restY[i];
      this.vx[i] = this.vy[i] = this.vz[i] = 0;
    }
    // lift so nothing is under the ground
    let need = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const g = this.world.heightAt(this.px[i], this.pz[i]);
      need = Math.max(need, g + this.radius[i] - this.py[i]);
    }
    for (const w of this.wheels) {
      const g = this.world.heightAt(this.px[w.a], this.pz[w.a]);
      need = Math.max(need, g + w.R - this.py[w.a]);
    }
    if (!Number.isFinite(need)) need = 0;
    for (let i = 0; i < this.n; i++) {
      this.py[i] += need + lift;
      this.ox[i] = this.px[i]; this.oy[i] = this.py[i]; this.oz[i] = this.pz[i];
    }
    for (const r of this.rods) r.u = r.u0;
    for (let j = 0; j < this.nc; j++) {
      this.rest[j] = this.rest0[j];
      this.broken[j] = 0;
      this.deformAmt[j] = 0;
      this.force[j] = 0;
    }
    for (const w of this.wheels) {
      w.omega = 0; w.defX = 0; w.defY = 0; w.contact = false; w.load = 0; w.slipVel = 0;
    }
    for (const dp of this.damageParts) dp.ref.health = 1;
    for (const j of this.jets) { j.cur = 0; j.thr = 0; j.on = 0; }
    this.powerHealth = 1;
    this.knockedOut = false;
    this.deformation = 0;
    this.brokenCount = 0;
    this.spawnTime = this.time;
    this.acc = 0;
    this.boostLevel = this.boostCapacity;
    this.drivetrain.gear = 1;
    this.quat = [0, Math.sin(heading / 2), 0, Math.cos(heading / 2)];
    this.updateFrame();
  }

  /** Advance by dt seconds of game time. */
  step(dt, controls) {
    if (this.n === 0) return;
    const c = this.controls;
    Object.assign(c, controls);
    // optional fields must not stick from an earlier frame
    if (!controls || !('actions' in controls)) c.actions = null;
    if (!controls || !('steerRaw' in controls)) c.steerRaw = undefined;
    if (!controls || !('assist' in controls)) c.assist = undefined;
    if (this.knockedOut) {
      c.throttle = 0; c.brake = 0; c.steer = 0; c.steerRaw = 0; c.handbrake = 0; c.boost = 0; c.reverse = false;
      c.actions = null;
    }
    // boost bookkeeping
    const wantBoost = c.boost > 0 && this.boostLevel > 0;
    c.boostActive = wantBoost;
    if (wantBoost) this.boostLevel = Math.max(0, this.boostLevel - dt);
    else this.boostLevel = Math.min(this.boostCapacity, this.boostLevel + dt * 0.25);

    this.drivetrain.frameUpdate(dt, c);
    this._frameForces(c, dt);
    this._broadphase(dt);
    this._actuators(c, dt);

    const h = 1 / this.rate;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= h && steps < this.maxSubsteps) {
      this._substep(h, c);
      this.acc -= h;
      steps++;
    }
    if (steps >= this.maxSubsteps) this.acc = 0;
    this.updateFrame();
    this._damage();
    if (this._exploded()) {
      this.exploded = (this.exploded || 0) + 1;
      this.spawn(this.lastSafe?.x || 0, this.lastSafe?.z || 0, this.lastSafe?.heading || 0);
    }
  }

  /** Rods (steering / pistons) and wheel hand brakes follow their key actions. */
  _actuators(c, dt) {
    const raw = c.steerRaw !== undefined;
    const assist = raw && c.assist !== false;
    const v = Math.abs(this.speed);
    for (const r of this.rods) {
      const sIn = actionValue(c, r.keyS), cIn = actionValue(c, r.keyC);
      let target;
      if (r.piston) target = sIn > 0 || cIn > 0 ? sIn - cIn : r.u0;
      else {
        target = sIn - cIn;
        if (assist && r.speedFactor > 0) target /= 1 + 0.353 * r.speedFactor * Math.pow(v / 25, 1.5);
      }
      target = clamp(target, -1, 1);
      // moving away from the initial length takes returnTime * ratio, returning takes returnTime
      const away = Math.abs(target - r.u0) > Math.abs(r.u - r.u0);
      const stepMax = dt / (r.ret * (away ? r.ratio : 1));
      const diff = target - r.u;
      r.u += Math.abs(diff) < stepMax ? diff : Math.sign(diff) * stepMax;
      this.rest[r.j] = this._rodLength(r, this.base[r.j]);
    }
    for (const w of this.wheels) w.hb = actionValue(c, w.handbrakeKey);
  }

  /** Parts lose function when the frames around them are bent past their elastic limit. */
  _damage() {
    const { rest, rest0, broken } = this;
    let pw = 0, ph = 0;
    for (const dp of this.damageParts) {
      let dev = 0;
      for (const j of dp.cons) {
        const e = broken[j] ? 1 : Math.abs(rest[j] - rest0[j]) / rest0[j];
        if (e > dev) dev = e;
      }
      const hl = 1 - smooth(dp.th * 0.5, dp.th, dev);
      // damage is permanent until respawn
      dp.ref.health = Math.min(dp.ref.health, Math.max(dp.floor, hl));
      if (dp.seat && dp.ref.health < 0.1 && this.time - this.spawnTime > 0.6) this.knockedOut = true;
    }
    for (const e of this.engines) { pw += e.power; ph += e.power * e.health; }
    this.powerHealth = pw > 0 ? ph / pw : 1;
  }

  _exploded() {
    const c = this.com;
    if (!Number.isFinite(c.x + c.y + c.z)) return true;
    const v = this.vel;
    if (v.x * v.x + v.y * v.y + v.z * v.z > 400 * 400) return true;
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - c.x, dy = this.py[i] - c.y, dz = this.pz[i] - c.z;
      if (!(dx * dx + dy * dy + dz * dz < 1e4)) return true;
    }
    return false;
  }

  _frameForces(c, dt) {
    const { fx, fy, fz } = this;
    fx.fill(0); fy.fill(0); fz.fill(0);
    // global drag at the centre of mass (distributed by mass so it adds no torque)
    const v = this.vel;
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > 0.1) {
      const k = (-0.5 * RHO * this.cdA * sp) / this.totalMass;
      for (let i = 0; i < this.n; i++) {
        const m = this.mass[i];
        fx[i] += k * v.x * m; fy[i] += k * v.y * m; fz[i] += k * v.z * m;
      }
    }
    // panels: drag along the airflow, lift along the car's up axis (negative = downforce)
    const { px, py, pz, vx, vy, vz } = this;
    const F = this.fwd, U = this.up;
    const wts = [0, 0, 0];
    for (const p of this.panels) {
      const a = p.a, b = p.b, cc = p.c;
      const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
      const wx = px[cc] - px[a], wy = py[cc] - py[a], wz = pz[cc] - pz[a];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const area = 0.5 * Math.hypot(nx, ny, nz);
      if (area < 1e-8) continue;
      const mvx = (vx[a] + vx[b] + vx[cc]) / 3, mvy = (vy[a] + vy[b] + vy[cc]) / 3, mvz = (vz[a] + vz[b] + vz[cc]) / 3;
      const s2 = mvx * mvx + mvy * mvy + mvz * mvz;
      if (s2 < 1) continue;
      const q = 0.5 * RHO * area;
      const kd = -q * p.drag * Math.sqrt(s2);
      const uf = mvx * F.x + mvy * F.y + mvz * F.z;
      const L = q * p.lift * uf * uf;
      const Fx = kd * mvx + L * U.x, Fy = kd * mvy + L * U.y, Fz = kd * mvz + L * U.z;
      // balance shifts the force toward the front (+) or rear (-) node(s)
      const ids = [a, b, cc];
      if (p.balance) {
        const d0 = px[a] * F.x + py[a] * F.y + pz[a] * F.z;
        const d1 = px[b] * F.x + py[b] * F.y + pz[b] * F.z;
        const d2 = px[cc] * F.x + py[cc] * F.y + pz[cc] * F.z;
        const m = (d0 + d1 + d2) / 3;
        const r0 = d0 - m, r1 = d1 - m, r2 = d2 - m;
        const mx = Math.max(Math.abs(r0), Math.abs(r1), Math.abs(r2)) || 1;
        wts[0] = (1 + p.balance * (r0 / mx)) / 3; wts[1] = (1 + p.balance * (r1 / mx)) / 3; wts[2] = (1 + p.balance * (r2 / mx)) / 3;
      } else wts[0] = wts[1] = wts[2] = 1 / 3;
      for (let i = 0; i < 3; i++) {
        const id = ids[i];
        fx[id] += Fx * wts[i]; fy[id] += Fy * wts[i]; fz[id] += Fz * wts[i];
      }
    }
    // jets
    for (const j of this.jets) {
      let demand;
      if (this.knockedOut) demand = 0;
      else if (j.mode === 'boost') demand = c.boostActive ? 1 : 0;
      else if (j.mode === 'max') demand = 1;
      else if (j.mode === 'throttle') {
        j.thr = clamp(j.thr + (actionValue(c, j.keyUp) - actionValue(c, j.keyDown)) * dt * 0.8, -0.5, 1);
        demand = j.thr;
      } else demand = (c.throttle > 0 && !c.reverse ? c.throttle : 0) * (c.boostActive ? 2 : 1);
      if (j.spool > 0) j.cur += (demand - j.cur) * Math.min(1, dt / j.spool);
      else j.cur = demand;
      const on = j.cur * j.health;
      j.on = on;
      if (on === 0) continue;
      const dx = px[j.b] - px[j.a], dy = py[j.b] - py[j.a], dz = pz[j.b] - pz[j.a];
      const l = Math.hypot(dx, dy, dz) || 1;
      const f = (j.thrust * on) / l / 2;
      fx[j.a] += dx * f; fy[j.a] += dy * f; fz[j.a] += dz * f;
      fx[j.b] += dx * f; fy[j.b] += dy * f; fz[j.b] += dz * f;
    }
  }

  _broadphase(dt) {
    this.activeColliders.length = 0;
    if (!this.world.queryColliders) return;
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minx = Math.min(minx, this.px[i]); maxx = Math.max(maxx, this.px[i]);
      minz = Math.min(minz, this.pz[i]); maxz = Math.max(maxz, this.pz[i]);
    }
    if (!(maxx - minx < 500 && maxz - minz < 500)) return; // exploded or NaN: skip
    const m = 2.5 + Math.min(50, Math.hypot(this.vel.x, this.vel.z) * dt * 2);
    this.world.queryColliders(minx - m, minz - m, maxx + m, maxz + m, this.activeColliders);
  }

  _substep(h, c) {
    const n = this.n;
    const { px, py, pz, ox, oy, oz, vx, vy, vz, fx, fy, fz, invMass } = this;
    this.time += h;
    // external per-frame forces + gravity
    for (let i = 0; i < n; i++) {
      const w = invMass[i] * h;
      vx[i] += fx[i] * w;
      vy[i] += fy[i] * w - GRAV * h;
      vz[i] += fz[i] * w;
    }
    // drivetrain + tires
    this.drivetrain.update(h, c);
    for (const w of this.wheels) stepWheel(this, w, h, c);
    // predict
    for (let i = 0; i < n; i++) {
      ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
      px[i] += vx[i] * h; py[i] += vy[i] * h; pz[i] += vz[i] * h;
    }
    this._solveConstraints(h);
    this._solveContacts(h);
    const ih = 1 / h;
    for (let i = 0; i < n; i++) {
      vx[i] = (px[i] - ox[i]) * ih;
      vy[i] = (py[i] - oy[i]) * ih;
      vz[i] = (pz[i] - oz[i]) * ih;
    }
  }

  _solveConstraints(h) {
    // Symmetric Gauss-Seidel: a forward then a backward sweep every substep.
    // (Alternating a single sweep direction between substeps is unstable.)
    this.lambda.fill(0);
    for (let i = 0; i < this.iterations; i++) {
      this._sweep(h, true);
      this._solveLines();
      this._sweep(h, false);
    }
  }

  /** Point-on-line constraints: sliders (free parameter) and straight angle locks (fixed). */
  _solveLines() {
    const { px, py, pz, invMass } = this;
    for (const ln of this.lines) {
      const a = ln.a, b = ln.b, s = ln.s;
      const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
      const uu = ux * ux + uy * uy + uz * uz;
      if (uu < 1e-12) continue;
      let t = ln.t;
      if (t < 0) t = clamp(((px[s] - px[a]) * ux + (py[s] - py[a]) * uy + (pz[s] - pz[a]) * uz) / uu, 0, 1);
      const Cx = px[s] - (px[a] + ux * t), Cy = py[s] - (py[a] + uy * t), Cz = pz[s] - (pz[a] + uz * t);
      const ws = invMass[s], wa = invMass[a] * (1 - t), wb = invMass[b] * t;
      const W = ws + (1 - t) * wa + t * wb;
      if (W <= 0) continue;
      const lx = -Cx / W, ly = -Cy / W, lz = -Cz / W;
      px[s] += ws * lx; py[s] += ws * ly; pz[s] += ws * lz;
      px[a] -= wa * lx; py[a] -= wa * ly; pz[a] -= wa * lz;
      px[b] -= wb * lx; py[b] -= wb * ly; pz[b] -= wb * lz;
    }
  }

  _sweep(h, forward) {
    const { px, py, pz, ox, oy, oz, invMass, ca, cb, ctype, rest, rest0, compl, damp, dampR, minL, maxL, yieldT, yieldC, breakDev, broken, lambda } = this;
    const h2 = h * h;
    const plastic = this.plasticity && this.time - this.spawnTime > 0.6;
    const k = this.nc;
    for (let q = 0; q < k; q++) {
      const j = forward ? q : k - 1 - q;
      if (broken[j]) continue;
      const a = ca[j], b = cb[j];
      const wa = invMass[a], wb = invMass[b];
      const W = wa + wb;
      let dx = px[a] - px[b], dy = py[a] - py[b], dz = pz[a] - pz[b];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-9) continue;
      dx /= L; dy /= L; dz /= L;
      let s = 0;
      const t = ctype[j];
      if (t === C_FRAME || t === C_ROD) {
        const C = L - rest[j];
        s = -C / W;
        if (t === C_FRAME && plastic) {
          const lam = lambda[j];
          const nl = lam + s;
          const lim = (nl > 0 ? yieldC[j] : yieldT[j]) * h2;
          if (nl > lim || nl < -lim) {
            s = (nl > 0 ? lim : -lim) - lam;
            const newL = L + W * s;
            const r0 = rest0[j];
            rest[j] = Math.max(0.3 * r0, Math.min(1.7 * r0, newL));
            const dev = Math.abs(rest[j] - r0) / r0;
            const amt = Math.min(1, dev / 0.15);
            this.deformation += (amt - this.deformAmt[j]) / Math.max(1, this.frameCount);
            this.deformAmt[j] = amt;
            if (this.breakable && dev > breakDev[j]) {
              broken[j] = 1;
              this.brokenCount++;
            }
          }
        }
      } else if (t === C_SHOCK) {
        if (L < minL[j]) s = -(L - minL[j]) / (W + compl[j] * 0.05 / h2);
        else if (L > maxL[j]) s = -(L - maxL[j]) / (W + compl[j] * 0.05 / h2);
        else {
          const C = L - rest[j];
          const at = compl[j] / h2;
          const dl = (px[a] - ox[a] - px[b] + ox[b]) * dx + (py[a] - oy[a] - py[b] + oy[b]) * dy + (pz[a] - oz[a] - pz[b] + oz[b]) * dz;
          // dl > 0: the shock is extending (rebound)
          const gamma = (compl[j] * (dl > 0 ? dampR[j] : damp[j])) / h;
          s = (-C - at * lambda[j] - gamma * dl) / ((1 + gamma) * W + at);
        }
      } else if (t === C_LIMIT) {
        if (L < minL[j]) s = -(L - minL[j]) / W;
        else if (L > maxL[j]) s = -(L - maxL[j]) / W;
        else continue;
      }
      lambda[j] += s;
      this.force[j] = lambda[j] / h2;
      const sa = s * wa, sb = s * wb;
      px[a] += dx * sa; py[a] += dy * sa; pz[a] += dz * sa;
      px[b] -= dx * sb; py[b] -= dy * sb; pz[b] -= dz * sb;
    }
  }

  _solveContacts(h) {
    const { px, py, pz, ox, oz, invMass, radius, colRadius, nodeFric, world } = this;
    const N = _N;
    const cols = this.activeColliders;
    for (let i = 0; i < this.n; i++) {
      if (invMass[i] === 0) continue;
      const r = radius[i];
      let g = world.heightAt(px[i], pz[i]);
      let pen = g + r - py[i];
      this.scrape[i] = 0;
      if (pen > 0.3) {
        // ground jumped up under the node (vertical face of a ramp/platform):
        // behave like a wall and undo the horizontal motion
        px[i] = ox[i];
        pz[i] = oz[i];
        g = world.heightAt(px[i], pz[i]);
        pen = Math.min(0.3, g + r - py[i]);
        this.hit = Math.max(this.hit || 0, 1);
      }
      if (pen > 0) {
        world.normalAt(px[i], pz[i], N);
        const depth = pen * N.y;
        px[i] += N.x * depth; py[i] += N.y * depth; pz[i] += N.z * depth;
        this._friction(i, N.x, N.y, N.z, depth, nodeFric[i], h);
      }
      if (cols.length) {
        const cr = colRadius[i];
        for (let k = 0; k < cols.length; k++) this._collide(i, cols[k], cr, h);
      }
    }
  }

  _friction(i, nx, ny, nz, depth, mu, h) {
    const { px, py, pz, ox, oy, oz } = this;
    const dx = px[i] - ox[i], dy = py[i] - oy[i], dz = pz[i] - oz[i];
    const dn = dx * nx + dy * ny + dz * nz;
    const tx = dx - nx * dn, ty = dy - ny * dn, tz = dz - nz * dn;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-12) return;
    if (tl < mu * 1.2 * depth) {
      px[i] -= tx; py[i] -= ty; pz[i] -= tz;
    } else {
      const f = Math.min(1, (mu * depth) / tl);
      px[i] -= tx * f; py[i] -= ty * f; pz[i] -= tz * f;
      this.scrape[i] = tl / h;
    }
  }

  _collide(i, c, r, h) {
    const { px, py, pz } = this;
    const x = px[i], y = py[i], z = pz[i];
    if (c.kind === 0) {
      // axis-aligned box
      if (x < c.minx - r || x > c.maxx + r || y < c.miny - r || y > c.maxy + r || z < c.minz - r || z > c.maxz + r) return;
      const dxm = x - (c.minx - r), dxp = c.maxx + r - x;
      const dym = y - (c.miny - r), dyp = c.maxy + r - y;
      const dzm = z - (c.minz - r), dzp = c.maxz + r - z;
      let d = dxm, nx = -1, ny = 0, nz = 0;
      if (dxp < d) { d = dxp; nx = 1; ny = 0; nz = 0; }
      if (dym < d) { d = dym; nx = 0; ny = -1; nz = 0; }
      if (dyp < d) { d = dyp; nx = 0; ny = 1; nz = 0; }
      if (dzm < d) { d = dzm; nx = 0; ny = 0; nz = -1; }
      if (dzp < d) { d = dzp; nx = 0; ny = 0; nz = 1; }
      px[i] += nx * d; py[i] += ny * d; pz[i] += nz * d;
      this._friction(i, nx, ny, nz, d, c.mu ?? 0.5, h);
      this.hit = Math.max(this.hit || 0, d / h);
    } else if (c.kind === 1) {
      // vertical cylinder
      if (y < c.y0 - r || y > c.y1 + r) return;
      const dx = x - c.x, dz = z - c.z;
      const dl = Math.sqrt(dx * dx + dz * dz);
      const R = c.r + r;
      if (dl >= R || dl < 1e-9) return;
      const d = R - dl;
      const nx = dx / dl, nz = dz / dl;
      px[i] += nx * d; pz[i] += nz * d;
      this._friction(i, nx, 0, nz, d, 0.5, h);
      this.hit = Math.max(this.hit || 0, d / h);
    } else if (c.kind === 2) {
      const dx = x - c.x, dy = y - c.y, dz = z - c.z;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const R = c.r + r;
      if (dl >= R || dl < 1e-9) return;
      const d = R - dl;
      const nx = dx / dl, ny = dy / dl, nz = dz / dl;
      px[i] += nx * d; py[i] += ny * d; pz[i] += nz * d;
      this._friction(i, nx, ny, nz, d, 0.6, h);
      this.hit = Math.max(this.hit || 0, d / h);
    } else if (c.kind === 3) {
      // moving sphere (another player's car): it advances with its velocity during the step
      // (t0 = sim time when the step began); pushes are capped so a jump in the other car's
      // position can't fling this one
      const t = this.time - (c.t0 ?? this.time);
      const dx = x - (c.x + c.vx * t), dy = y - (c.y + c.vy * t), dz = z - (c.z + c.vz * t);
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const R = c.r + r;
      if (dl >= R || dl < 1e-9) return;
      const d = Math.min(R - dl, 12 * h); // at most 12 m/s of push per substep
      const nx = dx / dl, ny = dy / dl, nz = dz / dl;
      px[i] += nx * d; py[i] += ny * d; pz[i] += nz * d;
      this.hit = Math.max(this.hit || 0, d / h);
    }
  }

  /** Centre of mass, velocity and best-fit rotation (shape matching). */
  updateFrame() {
    const n = this.n;
    if (!n) return;
    const { px, py, pz, vx, vy, vz, mass, qx, qy, qz } = this;
    let M = 0, cx = 0, cy = 0, cz = 0, ux = 0, uy = 0, uz = 0;
    for (let i = 0; i < n; i++) {
      const m = mass[i];
      M += m;
      cx += m * px[i]; cy += m * py[i]; cz += m * pz[i];
      ux += m * vx[i]; uy += m * vy[i]; uz += m * vz[i];
    }
    cx /= M; cy /= M; cz /= M;
    this.com.x = cx; this.com.y = cy; this.com.z = cz;
    this.vel.x = ux / M; this.vel.y = uy / M; this.vel.z = uz / M;
    // A = sum m (p - c) q^T
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
    for (let i = 0; i < n; i++) {
      const m = mass[i];
      const rx = (px[i] - cx) * m, ry = (py[i] - cy) * m, rz = (pz[i] - cz) * m;
      a00 += rx * qx[i]; a01 += rx * qy[i]; a02 += rx * qz[i];
      a10 += ry * qx[i]; a11 += ry * qy[i]; a12 += ry * qz[i];
      a20 += rz * qx[i]; a21 += rz * qy[i]; a22 += rz * qz[i];
    }
    const A = [a00, a01, a02, a10, a11, a12, a20, a21, a22];
    extractRotation(A, this.quat, 20);
    const [x, y, z, w] = this.quat;
    // rotation matrix columns
    this.fwd.x = 1 - 2 * (y * y + z * z); this.fwd.y = 2 * (x * y + z * w); this.fwd.z = 2 * (x * z - y * w);
    this.up.x = 2 * (x * y - z * w); this.up.y = 1 - 2 * (x * x + z * z); this.up.z = 2 * (y * z + x * w);
    this.right.x = 2 * (x * z + y * w); this.right.y = 2 * (y * z - x * w); this.right.z = 1 - 2 * (x * x + y * y);
    this.speed = this.vel.x * this.fwd.x + this.vel.y * this.fwd.y + this.vel.z * this.fwd.z;
    // yaw rate about the car's up axis (least squares over nodes)
    {
      const ux_ = this.up.x, uy_ = this.up.y, uz_ = this.up.z;
      let Lu = 0, Iu = 0;
      const gvx = this.vel.x, gvy = this.vel.y, gvz = this.vel.z;
      for (let i = 0; i < n; i++) {
        const m = mass[i];
        const rx = px[i] - cx, ry = py[i] - cy, rz = pz[i] - cz;
        const wx = vx[i] - gvx, wy = vy[i] - gvy, wz = vz[i] - gvz;
        const lx = ry * wz - rz * wy, ly = rz * wx - rx * wz, lz = rx * wy - ry * wx;
        Lu += m * (lx * ux_ + ly * uy_ + lz * uz_);
        const ru = rx * ux_ + ry * uy_ + rz * uz_;
        Iu += m * (rx * rx + ry * ry + rz * rz - ru * ru);
      }
      this.yawRate = Iu > 1e-9 ? Lu / Iu : 0;
    }
    if (this.up.y > 0.5 && Number.isFinite(cx)) {
      this.lastSafe = { x: cx, z: cz, heading: Math.atan2(-this.fwd.z, this.fwd.x) };
    }
  }

  heading() {
    return Math.atan2(-this.fwd.z, this.fwd.x);
  }

  isFrameBroken(partId) {
    const j = this.partToCon.get(partId);
    return j !== undefined && this.broken[j] === 1;
  }

  /** Stress of a constraint part, normalised to its yield force (0..1+). */
  partStress(partId) {
    const j = this.partToCon.get(partId);
    if (j === undefined || this.ctype[j] !== C_FRAME) return 0;
    return Math.abs(this.force[j]) / this.yieldT[j];
  }

  /** Current length of a rod relative to its built length (for rendering pistons). */
  rodRatio(partId) {
    const j = this.partToCon.get(partId);
    return j === undefined ? 1 : this.rest[j] / this.base[j];
  }

  get gearLabel() {
    return this.drivetrain.gearLabel();
  }

  get rpm() {
    return (this.drivetrain.rpmSmooth * 60) / (2 * Math.PI);
  }
}

// Müller et al. 2016, "A Robust Method to Extract the Rotational Part of Deformations".
// A is row-major 3x3, q = [x, y, z, w] is updated in place (warm started).
export function extractRotation(A, q, iters) {
  for (let it = 0; it < iters; it++) {
    const [x, y, z, w] = q;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    // columns of R and A
    const c0 = [r00, r10, r20], c1 = [r01, r11, r21], c2 = [r02, r12, r22];
    const a0 = [A[0], A[3], A[6]], a1 = [A[1], A[4], A[7]], a2 = [A[2], A[5], A[8]];
    const cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const x0 = cr(c0, a0), x1 = cr(c1, a1), x2 = cr(c2, a2);
    const dot = c0[0] * a0[0] + c0[1] * a0[1] + c0[2] * a0[2] + c1[0] * a1[0] + c1[1] * a1[1] + c1[2] * a1[2] + c2[0] * a2[0] + c2[1] * a2[1] + c2[2] * a2[2];
    const inv = 1 / (Math.abs(dot) + 1e-9);
    const ox = (x0[0] + x1[0] + x2[0]) * inv, oy = (x0[1] + x1[1] + x2[1]) * inv, oz = (x0[2] + x1[2] + x2[2]) * inv;
    const wl = Math.hypot(ox, oy, oz);
    if (wl < 1e-9) break;
    const half = wl / 2, s = Math.sin(half) / wl;
    const dqx = ox * s, dqy = oy * s, dqz = oz * s, dqw = Math.cos(half);
    // q = dq * q
    const nx = dqw * x + dqx * w + dqy * z - dqz * y;
    const ny = dqw * y - dqx * z + dqy * w + dqz * x;
    const nz = dqw * z + dqx * y - dqy * x + dqz * w;
    const nw = dqw * w - dqx * x - dqy * y - dqz * z;
    const l = Math.hypot(nx, ny, nz, nw);
    q[0] = nx / l; q[1] = ny / l; q[2] = nz / l; q[3] = nw / l;
  }
}

export { triArea };
