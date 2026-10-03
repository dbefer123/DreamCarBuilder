// Wheel/tire model: disc contact against the heightfield, brush (relaxation length)
// tire with longitudinal + lateral deflection states and a friction ellipse,
// spin dynamics with drive/brake torque. Forces go to the hub node plus a couple
// on hub/axle nodes for the camber moment.
import { SURFACES, LOOSE } from './surfaces.js';

const N = { x: 0, y: 1, z: 0 };
const N2 = { x: 0, y: 1, z: 0 };

const CX = 30; // longitudinal slip stiffness (× load); peak force near 10 % slip
const CY = 18; // cornering stiffness per rad (× load); peak near 9.5°
const TIRE_K = 160000; // N/m vertical stiffness for a 0.33 m wheel
const TIRE_ZETA = 0.18;

// The camber couple moves contact moments onto the hub/axle pair. It is physically
// nicer but turns structural compliance into rear toe changes that destabilise cars,
// so it is off by default.
export const TIRE_OPTS = { couple: false };

export function stepWheel(sim, w, h, c) {
  const { px, py, pz, vx, vy, vz, invMass } = sim;
  const a = w.a, b = w.b;
  // axle direction (outward)
  let nx = px[a] - px[b], ny = py[a] - py[b], nz = pz[a] - pz[b];
  const dAB = Math.hypot(nx, ny, nz) || 1e-6;
  nx /= dAB; ny /= dAB; nz /= dAB;
  w.nx = nx; w.ny = ny; w.nz = nz;

  // steering (virtual)
  w.steer = c.steer * w.steerMax + w.toe;

  sim.world.normalAt(px[a], pz[a], N);
  let ndotN = N.x * nx + N.y * ny + N.z * nz;
  let dx = -N.x + nx * ndotN, dy = -N.y + ny * ndotN, dz = -N.z + nz * ndotN;
  let dl = Math.hypot(dx, dy, dz);
  w.hubRadius = Math.max(w.W * 0.5, w.R * w.rimFrac * Math.min(1, dl));
  sim.radius[a] = w.hubRadius;
  w.contact = false;
  w.slipVel = 0;
  w.load = 0;

  let Fx = 0;
  if (dl > 0.3) {
    dx /= dl; dy /= dl; dz /= dl;
    let cpx = px[a] + dx * w.R, cpy = py[a] + dy * w.R, cpz = pz[a] + dz * w.R;
    const gh = sim.world.heightAt(cpx, cpz);
    sim.world.normalAt(cpx, cpz, N2);
    const pen = (gh - cpy) * N2.y;
    if (pen > 0 && pen < 0.6 * w.R) {
      // refine with contact normal
      N.x = N2.x; N.y = N2.y; N.z = N2.z;
      ndotN = N.x * nx + N.y * ny + N.z * nz;
      w.contact = true;
      w.cpx = cpx; w.cpy = cpy + pen; w.cpz = cpz;
      let si = sim.world.surfaceAt(cpx, cpz);
      if (!SURFACES[si]) si = 0;
      const surf = SURFACES[si];
      w.surface = surf;

      const hvx = vx[a], hvy = vy[a], hvz = vz[a];
      const vn = hvx * N.x + hvy * N.y + hvz * N.z;
      const scale = w.R / 0.33;
      const kt = TIRE_K * Math.sqrt(scale * (w.W / 0.25)) * w.kPress;
      const mc = w.cornerMass;
      const ct = 2 * TIRE_ZETA * Math.sqrt(kt * mc);
      let Fn = kt * pen - ct * vn;
      const bottom = pen - w.bottomFrac * w.R;
      if (bottom > 0) Fn += kt * 12 * bottom;
      if (Fn < 0) Fn = 0;

      // forward / lateral directions on the ground plane
      let fx = N.y * nz - N.z * ny, fy = N.z * nx - N.x * nz, fz = N.x * ny - N.y * nx;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx = (fx / fl) * w.spinSign; fy = (fy / fl) * w.spinSign; fz = (fz / fl) * w.spinSign;
      if (w.steer !== 0) {
        // right vector = f x N
        const rx = fy * N.z - fz * N.y, ry = fz * N.x - fx * N.z, rz = fx * N.y - fy * N.x;
        const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
        fx = fx * cs + rx * sn; fy = fy * cs + ry * sn; fz = fz * cs + rz * sn;
      }
      // lateral = N x f
      const lx = N.y * fz - N.z * fy, ly = N.z * fx - N.x * fz, lz = N.x * fy - N.y * fx;

      const vLong = hvx * fx + hvy * fy + hvz * fz;
      const vLat = hvx * lx + hvy * ly + hvz * lz;
      const sx = w.omega * w.R - vLong;
      const sy = -vLat;
      const Lx = 0.15 * scale, Ly = 0.35 * scale;
      const roll = Math.abs(vLong);
      const ex = Math.exp((-roll * h) / Lx), ey = Math.exp((-roll * h) / Ly);
      const prevX = w.defX, prevY = w.defY;
      w.defX = w.defX * ex + sx * h;
      w.defY = w.defY * ey + sy * h;
      const rateX = (w.defX - prevX) / h, rateY = (w.defY - prevY) / h;
      // load sensitivity relative to the wheel's own slow-average load:
      // dynamic load transfer lowers axle grip, so suspension balance matters
      if (w.loadRef <= 0) w.loadRef = Fn;
      else w.loadRef += (Fn - w.loadRef) * Math.min(1, h * 0.4);
      const lr = Math.max(0.2, Math.min(4, Fn / Math.max(1, w.loadRef)));
      const sens = Math.pow(lr, -0.18);
      const kx = (CX * Fn) / Lx, ky = (CY * w.widthFactor * w.cPress * Fn * sens) / Ly;
      const cdamp = 1.0 * Fn;
      Fx = kx * w.defX + cdamp * rateX;
      let Fy = ky * w.defY + cdamp * rateY;
      const press = LOOSE[si] ? w.looseGrip : w.hardGrip;
      const mu = surf.mu * w.tireGrip[si] * press * w.grip * w.health * w.widthGrip * sim.gripScale * Math.pow(lr, -0.08);
      const lim = Math.max(1e-6, mu * Fn);
      const Fl = Math.hypot(Fx, Fy);
      const u = Fl / lim; // linear demand relative to the friction limit
      const vs = Math.hypot(sx, sy);
      if (u < 3) {
        // brush model: F = mu*Fn*(u' (3 - 3u' + u'^2)), u' = u/3, initial slope 1
        const scale = u > 1e-9 ? (u - (u * u) / 3 + (u * u * u) / 27) / u : 1;
        Fx *= scale;
        Fy *= scale;
        w.slipVel = u > 2 ? vs * (u - 2) : 0;
      } else {
        // fully sliding: keep the deflection on the saturation boundary
        const muEff = 1 - 0.15 * (1 - Math.exp(-vs / 6));
        const scale = muEff / u;
        Fx *= scale;
        Fy *= scale;
        w.defX *= 3 / u;
        w.defY *= 3 / u;
        w.slipVel = vs;
      }
      w.load = Fn;
      w.vLong = vLong;
      w.vLat = vLat;

      const Fxw = N.x * Fn + fx * Fx + lx * Fy;
      const Fyw = N.y * Fn + fy * Fx + ly * Fy;
      const Fzw = N.z * Fn + fz * Fx + lz * Fy;
      // moment of the contact force about the hub, perpendicular part goes to a couple
      const rx = dx * w.R, ry = dy * w.R, rz = dz * w.R;
      let Mx = ry * Fzw - rz * Fyw, My = rz * Fxw - rx * Fzw, Mz = rx * Fyw - ry * Fxw;
      const Mn = Mx * nx + My * ny + Mz * nz;
      Mx -= nx * Mn; My -= ny * Mn; Mz -= nz * Mn;
      const dd = TIRE_OPTS.couple ? Math.max(dAB, 0.12) : 1e9;
      // couple force on a = (M_perp x n) / d
      const cx = (My * nz - Mz * ny) / dd, cy = (Mz * nx - Mx * nz) / dd, cz = (Mx * ny - My * nx) / dd;
      const wa = invMass[a] * h, wb = invMass[b] * h;
      vx[a] += (Fxw + cx) * wa; vy[a] += (Fyw + cy) * wa; vz[a] += (Fzw + cz) * wa;
      vx[b] -= cx * wb; vy[b] -= cy * wb; vz[b] -= cz * wb;

      // spin: rolling resistance
      w.rrTorque = surf.rr * w.tireRR[si] * w.rrPress * Fn * w.R;
    } else {
      w.rrTorque = 0;
    }
  } else {
    w.rrTorque = 0;
  }
  if (!w.contact) {
    w.defX *= 0.9;
    w.defY *= 0.9;
  }

  // ---- spin dynamics ----
  let T = w.driveTorque - Fx * w.R;
  let omega = w.omega + (h * T) / w.I;
  let brakeT = c.brake * w.brake * sim.brakeBase * (w.R / sim.avgWheelR);
  if (sim.abs && w.absSlip > 0 && brakeT > 0 && w.contact && Math.abs(w.vLong) > 2) {
    const slip = (w.vLong - w.omega * w.R) / Math.abs(w.vLong);
    if (slip * Math.sign(w.vLong) > w.absSlip) brakeT *= 0.2;
  }
  if (w.hb > 0) brakeT += sim.brakeBase * 2.5 * w.hb;
  brakeT += w.escBrake;
  const fric = brakeT + w.rrTorque + 0.5 + 0.004 * Math.abs(omega);
  const dw = (fric * h) / w.I;
  if (Math.abs(omega) <= dw) omega = 0;
  else omega -= Math.sign(omega) * dw;
  if (omega > 600) omega = 600;
  else if (omega < -600) omega = -600;
  w.omega = omega;
  w.phi += omega * h;
  if (w.phi > 1000) w.phi -= Math.PI * 2 * Math.floor(w.phi / (Math.PI * 2));
  else if (w.phi < -1000) w.phi += Math.PI * 2 * Math.floor(-w.phi / (Math.PI * 2));
}
