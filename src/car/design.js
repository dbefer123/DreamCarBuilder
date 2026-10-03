// Car design data model: nodes + parts. Plain JSON-serialisable objects.
// Nodes: { id, x, y, z, friction?, light? }. Parts: { id, type, n: [node ids], ...props }.
import {
  PART_TYPES, ORDERED_TYPES, DEFAULT_COLORS, NODE_BASE_MASS, partDefaults, partMass, mirrorProps,
  enginePower, levelForPower, jetLevelStats, MAX_LEVEL, partPrice, lengthLimitOf, lengthPenalty,
} from './parts.js';

export const DESIGN_VERSION = 3;
export const MIRROR_EPS = 1e-3;
export const CENTER_EPS = 1e-4;

export function createDesign(name = 'Untitled') {
  return {
    name,
    version: DESIGN_VERSION,
    nextId: 1,
    nodes: [],
    parts: [],
    colors: { ...DEFAULT_COLORS },
  };
}

export function cloneDesign(d) {
  return structuredClone(d);
}

export function addNode(d, x, y, z) {
  const n = { id: d.nextId++, x, y, z };
  d.nodes.push(n);
  return n;
}

export function addPart(d, type, nodeIds, props = {}) {
  const p = { id: d.nextId++, type, n: nodeIds.slice(), ...partDefaults(type), ...props };
  d.parts.push(p);
  return p;
}

export function nodeMap(d) {
  const m = new Map();
  for (const n of d.nodes) m.set(n.id, n);
  return m;
}

export function partMap(d) {
  const m = new Map();
  for (const p of d.parts) m.set(p.id, p);
  return m;
}

export function partsUsingNodes(d, ids) {
  const set = ids instanceof Set ? ids : new Set(ids);
  return d.parts.filter((p) => p.n.some((id) => set.has(id)));
}

export function removeNodes(d, ids) {
  const set = ids instanceof Set ? ids : new Set(ids);
  d.nodes = d.nodes.filter((n) => !set.has(n.id));
  d.parts = d.parts.filter((p) => !p.n.some((id) => set.has(id)));
}

export function removeParts(d, ids) {
  const set = ids instanceof Set ? ids : new Set(ids);
  d.parts = d.parts.filter((p) => !set.has(p.id));
}

function sameNodes(type, a, b) {
  if (a.length !== b.length) return false;
  if (ORDERED_TYPES.has(type)) return a.every((v, i) => v === b[i]);
  const s = [...a].sort();
  const t = [...b].sort();
  return s.every((v, i) => v === t[i]);
}

export function findPart(d, type, nodeIds) {
  return d.parts.find((p) => p.type === type && sameNodes(type, p.n, nodeIds)) || null;
}

/** Remove parts that reference missing nodes, use a node twice, or duplicate another part. */
export function normalizeDesign(d) {
  const nm = nodeMap(d);
  const keep = [];
  for (const p of d.parts) {
    const def = PART_TYPES[p.type];
    if (!def || p.n.length !== def.nodes) continue;
    if (!p.n.every((id) => nm.has(id))) continue;
    if (new Set(p.n).size !== p.n.length) continue;
    if (keep.some((q) => q.type === p.type && sameNodes(p.type, q.n, p.n))) continue;
    keep.push(p);
  }
  d.parts = keep;
  // transmissions must point at existing engines / wheels
  const byId = partMap(d);
  for (const p of d.parts) {
    if (p.type !== 'transmission') continue;
    if (p.engine != null && byId.get(p.engine)?.type !== 'engine') p.engine = null;
    if (p.wheel != null && byId.get(p.wheel)?.type !== 'wheel') p.wheel = null;
  }
  let maxId = 0;
  for (const n of d.nodes) maxId = Math.max(maxId, n.id);
  for (const p of d.parts) maxId = Math.max(maxId, p.id);
  d.nextId = Math.max(d.nextId || 1, maxId + 1);
  return d;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function triArea(a, b, c) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return 0.5 * Math.hypot(cx, cy, cz);
}

/** Mass per node (Map id -> kg), same numbers the physics uses. */
export function nodeMasses(d) {
  const nm = nodeMap(d);
  const masses = new Map();
  for (const n of d.nodes) masses.set(n.id, NODE_BASE_MASS);
  for (const p of d.parts) {
    const ns = p.n.map((id) => nm.get(id));
    if (ns.some((n) => !n)) continue;
    const len = ns.length >= 2 ? dist(ns[0], ns[1]) : 0;
    const area = ns.length === 3 ? triArea(ns[0], ns[1], ns[2]) : 0;
    const { mass, split } = partMass(p, len, area);
    for (let i = 0; i < ns.length; i++) {
      const f = split ? split[i] : 1 / ns.length;
      masses.set(ns[i].id, masses.get(ns[i].id) + mass * f);
    }
  }
  return masses;
}

export function bounds(d) {
  if (!d.nodes.length) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const n of d.nodes) {
    min.x = Math.min(min.x, n.x); min.y = Math.min(min.y, n.y); min.z = Math.min(min.z, n.z);
    max.x = Math.max(max.x, n.x); max.y = Math.max(max.y, n.y); max.z = Math.max(max.z, n.z);
  }
  const nm = nodeMap(d);
  for (const p of d.parts) {
    if (p.type !== 'wheel') continue;
    const h = nm.get(p.n[0]);
    if (!h) continue;
    const r = p.radius;
    min.x = Math.min(min.x, h.x - r); max.x = Math.max(max.x, h.x + r);
    min.y = Math.min(min.y, h.y - r); max.y = Math.max(max.y, h.y + r);
    min.z = Math.min(min.z, h.z - p.width / 2); max.z = Math.max(max.z, h.z + p.width / 2);
  }
  return { min, max };
}

/** Transmissions that link an existing engine to an existing wheel. */
export function validTransmissions(d) {
  const byId = partMap(d);
  return d.parts.filter((p) => p.type === 'transmission' && byId.get(p.engine)?.type === 'engine' && byId.get(p.wheel)?.type === 'wheel');
}

/**
 * Which wheels are driven and which engines power them. As in the original game, only
 * wheels linked to an engine by a transmission are driven.
 * Returns { wheels: Map(wheelId -> share), engines: [engine parts] }.
 */
export function driveLayout(d) {
  const trans = validTransmissions(d);
  const wheels = new Map();
  const byId = partMap(d);
  const engines = new Set();
  let sum = 0;
  for (const t of trans) {
    engines.add(byId.get(t.engine));
    wheels.set(t.wheel, (wheels.get(t.wheel) || 0) + (t.powerPct > 0 ? t.powerPct : 0));
  }
  // 0 % = equal share of whatever the explicit percentages leave over
  const explicit = [...wheels.values()].reduce((s, v) => s + v, 0);
  const auto = [...wheels.entries()].filter(([, v]) => v === 0).length;
  const rest = Math.max(0, 100 - explicit);
  for (const [id, v] of wheels) {
    const share = v > 0 ? v : (auto ? rest / auto : 0);
    wheels.set(id, share);
    sum += share;
  }
  for (const [id, v] of wheels) wheels.set(id, sum > 0 ? v / sum : 1 / wheels.size);
  return { wheels, engines: [...engines] };
}

/** Engine node nearest a point (where a transmission shaft starts). */
export function nearestEngineNode(d, engine, point) {
  const nm = nodeMap(d);
  let best = engine.n[0], bd = Infinity;
  for (const id of engine.n) {
    const n = nm.get(id);
    const dd = n ? dist(n, point) : Infinity;
    if (dd < bd) { bd = dd; best = id; }
  }
  return best;
}

/** Transmission props + nodes linking an engine to a wheel: [engine node, wheel axle node]. */
export function transmissionFor(d, engine, wheel) {
  const axle = nodeMap(d).get(wheel.n[1]);
  return { n: [nearestEngineNode(d, engine, axle), wheel.n[1]], engine: engine.id, wheel: wheel.id };
}

/**
 * Link every engine to a wheel with its own shaft (presets, old cars that used the
 * `driven` flag). create(nodeIds, props) adds the part.
 */
export function linkEngines(d, wheel, create) {
  const nm = nodeMap(d);
  const axle = nm.get(wheel.n[1]);
  if (!axle) return;
  const used = new Set();
  for (const e of d.parts) {
    if (e.type !== 'engine') continue;
    // nearest engine node not already carrying a shaft to this wheel
    const ids = e.n.filter((id) => nm.has(id) && !used.has(id)).sort((a, b) => dist(nm.get(a), axle) - dist(nm.get(b), axle));
    if (!ids.length) continue;
    used.add(ids[0]);
    create([ids[0], wheel.n[1]], { engine: e.id, wheel: wheel.id });
  }
}

/** The driver's seat: the first seat whose role isn't passenger (or the first seat). */
export function driverSeat(d) {
  const seats = d.parts.filter((p) => p.type === 'seat');
  return seats.find((p) => p.role !== 'passenger') || seats[0] || null;
}

/** Single player price of the whole car in coins ("Car's price"). */
export function carPrice(d) {
  const nm = nodeMap(d);
  let s = 0;
  for (const p of d.parts) {
    const ns = p.n.map((id) => nm.get(id));
    if (ns.some((n) => !n)) continue;
    s += partPrice(p, ns.length >= 2 ? dist(ns[0], ns[1]) : 0, ns.length === 3 ? triArea(ns[0], ns[1], ns[2]) : 0);
  }
  return s;
}

/** Highest engine level of the car (Single player tracks open by it); 0 without engines. */
export function engineLevel(d) {
  return d.parts.reduce((m, p) => (p.type === 'engine' ? Math.max(m, p.level || 1) : m), 0);
}

/**
 * Single player length limit: the lowest "Length w/o weight penalty" of the driver seat,
 * the engines and the wheels (Infinity when the car has none of them).
 */
export function lengthLimit(d) {
  let lim = Infinity;
  const seat = driverSeat(d);
  if (seat) lim = Math.min(lim, lengthLimitOf(seat));
  for (const p of d.parts) if (p.type === 'engine' || p.type === 'wheel') lim = Math.min(lim, lengthLimitOf(p));
  return lim;
}

export function computeStats(d) {
  const masses = nodeMasses(d);
  let mass = 0;
  for (const m of masses.values()) mass += m;
  const counts = {};
  for (const t of Object.keys(PART_TYPES)) counts[t] = 0;
  const layout = driveLayout(d);
  let powerHp = 0;
  for (const p of d.parts) if (p.type === 'engine') powerHp += enginePower(p);
  const drivenWheels = layout.wheels.size;
  for (const p of d.parts) counts[p.type]++;
  const b = bounds(d);
  const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  const maxWheelRadius = d.parts.filter((p) => p.type === 'wheel').reduce((m, p) => Math.max(m, p.radius), 0);
  return {
    mass,
    powerHp,
    powToMass: mass > 0 ? powerHp / (mass / 1000) : 0,
    size,
    counts,
    drivenWheels,
    nodes: d.nodes.length,
    maxWheelRadius,
    price: carPrice(d),
    // Single player: extra mass when the car is longer than its length limit
    lengthLimit: lengthLimit(d),
    massScale: lengthPenalty(size, lengthLimit(d)),
  };
}

/** Map node id -> id of the node mirrored across Z = 0 (itself for centre-line nodes). */
export function mirrorNodeMap(d, eps = MIRROR_EPS) {
  const map = new Map();
  const buckets = new Map();
  const key = (x, y, z) => `${Math.round(x / eps)}|${Math.round(y / eps)}|${Math.round(z / eps)}`;
  for (const n of d.nodes) {
    const k = key(n.x, n.y, n.z);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(n);
  }
  const near = (x, y, z) => {
    const out = [];
    const bx = Math.round(x / eps), by = Math.round(y / eps), bz = Math.round(z / eps);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = buckets.get(`${bx + dx}|${by + dy}|${bz + dz}`);
      if (arr) for (const c of arr) if (Math.hypot(c.x - x, c.y - y, c.z - z) < eps * 2) out.push(c);
    }
    return out.sort((a, b) => a.id - b.id);
  };
  for (const n of d.nodes) {
    if (Math.abs(n.z) < CENTER_EPS) { map.set(n.id, n.id); continue; }
    // coincident nodes pair up by rank (k-th duplicate on one side <-> k-th on the other)
    const same = near(n.x, n.y, n.z);
    const mirrored = near(n.x, n.y, -n.z).filter((c) => c.id !== n.id);
    if (!mirrored.length) continue;
    const rank = Math.max(0, same.findIndex((c) => c.id === n.id));
    map.set(n.id, mirrored[Math.min(rank, mirrored.length - 1)].id);
  }
  return map;
}

/** Create the mirrored copy of a part if all mirrored nodes exist and it isn't there yet. */
export function mirrorPart(d, part, mirrorMap) {
  const ids = part.n.map((id) => mirrorMap.get(id));
  if (ids.some((id) => id === undefined)) return null;
  if (ids.every((id, i) => id === part.n[i])) return null; // lies on the centre line
  if (findPart(d, part.type, ids)) return null;
  const props = mirrorProps(part);
  delete props.id; delete props.n; delete props.type;
  if (part.type === 'transmission') {
    // point the copy at the mirrored wheel / engine when they exist
    const twin = (id, type) => {
      const q = d.parts.find((x) => x.id === id);
      if (!q) return id;
      const m = findPart(d, type, q.n.map((nid) => mirrorMap.get(nid)));
      return m ? m.id : id;
    };
    if (props.wheel != null) props.wheel = twin(props.wheel, 'wheel');
    if (props.engine != null) props.engine = twin(props.engine, 'engine');
  }
  return addPart(d, part.type, ids, props);
}

const NODE_KEYS = ['friction', 'light'];

function cleanNode(n, round) {
  const out = { id: n.id, x: round(+n.x), y: round(+n.y), z: round(+n.z) };
  for (const k of NODE_KEYS) if (n[k] != null) out[k] = structuredClone(n[k]);
  return out;
}

export function serializeDesign(d) {
  const r = (v) => Math.round(v * 10000) / 10000;
  const out = {
    ...d,
    version: DESIGN_VERSION,
    nodes: d.nodes.map((n) => cleanNode(n, r)),
  };
  return JSON.stringify(out);
}

// ---------------- v1 -> v2 migration ----------------
const V1_TO_V2 = {
  frame(p) {
    const t = (p.thickness ?? 0.04) / 0.04;
    return { elasticLimit: round2(25 * (p.strength ?? 1)), weightHardness: round2(10 * t * t), ultimateStrength: 50, minRadius: 0 };
  },
  shock(p, L) {
    return {
      hardness: p.stiffness ?? 40000,
      damping: round2((p.damping ?? 2500) / 100),
      preCompression: L > 1e-6 ? Math.round(((L + (p.preload ?? 0.04)) / L) * 1000) / 1000 : 1.1,
      maxCompression: round2(1 - (p.minRatio ?? 0.62)),
      maxStretch: p.maxRatio ?? 1.12,
      rcRatio: 0,
    };
  },
  rod(p, L) {
    const tr = p.travel ?? 0.06;
    const frac = L > 1e-6 ? Math.min(0.9, Math.abs(tr) / L) : 0.1;
    // v1: rest = L + steer * travel, steer > 0 = right
    return {
      mode: 'steering',
      maxCompression: Math.round(frac * 1000) / 1000,
      maxStretch: Math.round((1 + frac) * 1000) / 1000,
      keyStretch: tr >= 0 ? 'steerRight' : 'steerLeft',
      keyCompress: tr >= 0 ? 'steerLeft' : 'steerRight',
      initial: 'initial',
    };
  },
  limiter(p) {
    return { maxCompression: round2(1 - (p.minRatio ?? 0)), maxStretch: p.maxRatio ?? 1 };
  },
  wheel(p) {
    // level 13 = the v1 grip and mass, tire height 0.4 = the v1 rim size
    return { level: 13, tireHeight: 0.4, handbrakeKey: p.handbrake ? 'handbrake' : 'none' };
  },
  engine(p) {
    // engines keep their horsepower as closely as integer levels allow; v1 had no torque cap
    return { level: levelForPower(p.power ?? 400), torqueLimit: 5000, topSpeed: 0 };
  },
  jet(p) {
    const thrust = p.thrust ?? 6000;
    const level = Math.max(1, Math.min(MAX_LEVEL, Math.round(20 * Math.pow(thrust / 8000, 1 / 1.4))));
    const coef = Math.max(10, Math.min(300, Math.round((100 * thrust) / jetLevelStats(level, 100).thrust)));
    return { level, powerCoef: coef, mode: 'accelerate' };
  },
  panel(p) {
    if (p.aero === 'wing') return { drag: 0.2, lift: -1.0 };
    return { drag: 0, lift: 0 };
  },
};
const V1_DROP = {
  frame: ['thickness', 'strength'],
  shock: ['stiffness', 'preload', 'minRatio', 'maxRatio'],
  rod: ['travel'],
  limiter: ['minRatio', 'maxRatio'],
  wheel: ['handbrake'],
  engine: ['power'],
  jet: ['thrust'],
  panel: ['aero'],
};

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Upgrade an older design object in place:
 * v1 -> v2: parts used physical units and global settings;
 * v2 -> v3: wheels were driven by a `driven` flag, now only through transmissions.
 */
export function migrateDesign(d) {
  const nm = new Map(d.nodes.map((n) => [n.id, n]));
  if ((d.version || 1) < 2) {
    for (const p of d.parts) {
      const fn = V1_TO_V2[p.type];
      if (!fn) continue;
      const a = nm.get(p.n[0]), b = nm.get(p.n[1]);
      const L = a && b ? dist(a, b) : 0;
      const add = fn(p, L);
      for (const k of V1_DROP[p.type] || []) delete p[k];
      Object.assign(p, add);
    }
    d.version = 2;
  }
  if (d.version < 3) {
    // flagged wheels get a shaft from every engine (wheels defaulted to driven); cars
    // that already linked wheels with transmissions keep exactly those
    const linked = d.parts.some((p) => p.type === 'transmission' && p.engine != null && p.wheel != null);
    let next = Math.max(d.nextId || 1, ...d.nodes.map((n) => n.id + 1), ...d.parts.map((p) => p.id + 1));
    for (const w of d.parts.filter((p) => p.type === 'wheel')) {
      const driven = w.driven !== false;
      delete w.driven;
      if (!driven || linked) continue;
      linkEngines(d, w, (n, props) => d.parts.push({ id: next++, type: 'transmission', n, radius: 0.021, powerPct: 0, ...props }));
    }
    d.nextId = next;
    d.version = 3;
  }
  return d;
}

export function deserializeDesign(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : structuredClone(json);
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.parts)) throw new Error('Not a car design file');
  migrateDesign(d);
  const out = createDesign(d.name || 'Untitled');
  out.colors = { ...DEFAULT_COLORS, ...(d.colors || {}) };
  out.nodes = d.nodes.map((n) => cleanNode(n, (v) => v));
  out.parts = d.parts
    .filter((p) => PART_TYPES[p.type])
    .map((p) => ({ ...partDefaults(p.type), ...p, n: p.n.slice() }));
  out.nextId = d.nextId || 1;
  return normalizeDesign(out);
}

export function validateDesign(d) {
  const issues = [];
  const s = computeStats(d);
  if (s.counts.wheel === 0) issues.push('The car has no wheels.');
  if (s.counts.engine === 0 && s.counts.jet === 0) issues.push('No engine: driving wheels need an engine.');
  else if (s.counts.wheel > 0 && s.counts.engine > 0 && s.drivenWheels === 0 && s.counts.jet === 0) {
    issues.push('No transmissions: link the engine to the wheels with the Transmission tool.');
  }
  if (d.nodes.length > 0 && d.parts.length === 0) issues.push('Nodes are not connected by any parts.');
  const seats = d.parts.filter((p) => p.type === 'seat');
  if (!seats.length) issues.push('No seat: the car needs a driver.');
  else if (!seats.some((p) => p.role !== 'passenger')) issues.push('No driver seat: set one seat\'s role to Driver.');
  else if (seats.filter((p) => p.role !== 'passenger').length > 1) issues.push('More than one driver seat: only the first one is used.');
  return issues;
}
