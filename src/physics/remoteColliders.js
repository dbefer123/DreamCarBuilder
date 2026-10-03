// Collision shape of another player's car (multiplayer): spheres in car coordinates that
// follow its pose. They are "kind 3" colliders for CarSim (moving spheres, see sim.js).

const MAX_SPHERES = 48;

/** Spheres in car coordinates (relative to the rest centre of mass rc): nodes thinned on a grid, plus one per wheel. */
export function collisionSpheres(design, rc) {
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const out = [];
  for (const w of design.parts) {
    if (w.type !== 'wheel') continue;
    const n = byId.get(w.n[0]);
    if (n) out.push({ x: n.x - rc[0], y: n.y - rc[1], z: n.z - rc[2], r: w.radius || 0.33 });
  }
  let cell = 0.5;
  let pts;
  do {
    const seen = new Set();
    pts = [];
    for (const n of design.nodes) {
      const key = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)},${Math.floor(n.z / cell)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push(n);
    }
    cell *= 1.4;
  } while (pts.length + out.length > MAX_SPHERES && cell < 8);
  for (const n of pts.slice(0, MAX_SPHERES - out.length)) out.push({ x: n.x - rc[0], y: n.y - rc[1], z: n.z - rc[2], r: 0.3 });
  return out;
}

export function makeColliders(spheres) {
  return spheres.map((s) => ({ kind: 3, r: s.r, x: 0, y: -1e6, z: 0, vx: 0, vy: 0, vz: 0, t0: 0, minx: 0, maxx: 0, minz: 0, maxz: 0 }));
}

/**
 * Move the colliders to a pose: p = centre of mass [x, y, z], q = rotation quaternion
 * [x, y, z, w], v = velocity [x, y, z] (they keep moving with it during a physics step).
 */
export function poseColliders(spheres, colliders, p, q, v) {
  const [qx, qy, qz, qw] = q;
  const m = Math.hypot(v[0], v[2]) * 0.05;
  for (let k = 0; k < spheres.length; k++) {
    const s = spheres[k], c = colliders[k];
    // rotate s by q
    const ix = qw * s.x + qy * s.z - qz * s.y;
    const iy = qw * s.y + qz * s.x - qx * s.z;
    const iz = qw * s.z + qx * s.y - qy * s.x;
    const iw = -qx * s.x - qy * s.y - qz * s.z;
    c.x = p[0] + ix * qw + iw * -qx + iy * -qz - iz * -qy;
    c.y = p[1] + iy * qw + iw * -qy + iz * -qx - ix * -qz;
    c.z = p[2] + iz * qw + iw * -qz + ix * -qy - iy * -qx;
    c.vx = v[0]; c.vy = v[1]; c.vz = v[2];
    c.minx = c.x - c.r - m; c.maxx = c.x + c.r + m;
    c.minz = c.z - c.r - m; c.maxz = c.z + c.r + m;
  }
}

/** Mark the start of a physics step (sim.time): the spheres advance from here. */
export function beginStep(colliders, simTime) {
  for (const c of colliders) c.t0 = simTime;
}
