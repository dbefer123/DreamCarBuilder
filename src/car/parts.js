// Part type definitions shared by the editor (bottom settings panel), physics and renderer.
// Every part references design nodes by id through `n: [ids]`.

export const NODE_BASE_MASS = 0.5; // kg per joint
export const MAX_LEVEL = 25;
export const NODE_DEFAULTS = { friction: 0.35, light: null };

export const DEFAULT_COLORS = {
  frames: '#b5a57c',
  panels: '#d5d9de',
  rims: '#c3c7cc',
  remaining: '#8d939b',
};

/** Actions that part key dropdowns can reference (bound to keys in Settings > Controls). */
export const KEY_ACTIONS = [
  ['none', 'None'],
  ['steerLeft', 'Steer Left'],
  ['steerRight', 'Steer Right'],
  ['accelerate', 'Accelerate'],
  ['brake', 'Brake/Reverse'],
  ['handbrake', 'Hand Brake'],
  ['boost', 'Boost'],
  ['gearUp', 'Gear up'],
  ['gearDown', 'Gear down'],
  ['jetUp', 'Jet Throttle Up'],
  ['jetDown', 'Jet Throttle Down/Reverse'],
  ['horn', 'Horn'],
  ['action1', 'Action 1'],
  ['action2', 'Action 2'],
  ['action3', 'Action 3'],
];

export const LIGHT_TYPES = [
  ['none', 'No light'],
  ['headlight', 'Headlight'],
  ['taillight', 'Taillight'],
  ['brake', 'Brake light'],
  ['reverse', 'Reverse light'],
  ['beacon', 'Beacon'],
];

export const TIRE_TYPES = [
  ['road', 'Road'],
  ['slick', 'Slick'],
  ['offroad', 'Offroad'],
  ['rally', 'Rally'],
];

export const PANEL_MATERIALS = [
  ['polished', 'Polished'],
  ['matte', 'Matte'],
  ['metallic', 'Metallic'],
  ['carbon', 'Carbon'],
  ['glass', 'Glass'],
  ['chrome', 'Chrome'],
];

// ---------------- upgrade levels ----------------
export function engineLevelStats(level) {
  const r = level / 20;
  return { power: 1200 * Math.pow(r, 1.4), mass: 170 * Math.pow(r, 0.6) };
}

export function wheelLevelFactors(level) {
  const t = (level - 1) / (MAX_LEVEL - 1);
  return { grip: 0.88 + 0.24 * t, mass: 1.15 - 0.3 * t };
}

export function jetLevelStats(level, powerCoef = 100) {
  const r = level / 20;
  const k = powerCoef / 100;
  return { thrust: 8000 * Math.pow(r, 1.4) * k, mass: (25 + 30 * Math.pow(r, 0.6)) * (0.5 + 0.5 * k) };
}

export const UPGRADABLE = new Set(['engine', 'wheel', 'jet', 'seat']);

/** Highest upgrade level of a part type (the seat has 10, like the original). */
export function maxLevel(type) {
  return PART_TYPES[type]?.maxLevel ?? MAX_LEVEL;
}

// ---------------- Single player prices (coins) ----------------
// Levels get steeply more expensive, as in the original (an engine at level 21 costs ~250k).
const LEVEL_PRICE = {
  engine: (L) => 150 * Math.pow(1.45, L - 1),
  wheel: (L) => 40 * Math.pow(1.27, L - 1),
  jet: (L) => 200 * Math.pow(1.45, L - 1),
  seat: (L) => 200 * Math.pow(2.1, L - 1),
};
const FLAT_PRICE = { shock: 60, rod: 40, transmission: 40, angleLock: 30, slider: 30, limiter: 15 };

/** Coins the part's level is worth (0 for parts without levels). */
export function levelPrice(type, level) {
  const f = LEVEL_PRICE[type];
  return f ? Math.round(f(Math.max(1, level))) : 0;
}

/** Price of a part in coins. `len` = length of 2-node parts, `area` = panel area. */
export function partPrice(p, len = 0, area = 0) {
  if (LEVEL_PRICE[p.type]) return levelPrice(p.type, p.level || 1);
  if (p.type === 'frame') return Math.round(10 * len * (p.weightHardness / 10));
  if (p.type === 'panel') return Math.round(20 * area);
  if (p.type === 'weight') return Math.round(p.mass);
  return FLAT_PRICE[p.type] || 0;
}

/**
 * Single player "Length w/o weight penalty" a part allows: the car may be this long
 * before it gets heavier. Engines, wheels and jets: 3 m + 1/8 m per level; seat: + 1/3 m.
 */
export function lengthLimitOf(p, level = p.level || 1) {
  if (p.type === 'seat') return 3 + (level - 1) / 3;
  if (p.type === 'engine' || p.type === 'wheel' || p.type === 'jet') return 3 + (level - 1) / 8;
  return Infinity;
}

/** Extra mass factor for a car `size` metres long with a length limit (Single player). */
export function lengthPenalty(size, limit) {
  return 1 + 0.125 * Math.max(0, size - limit);
}

/** Stats shown in the upgrade comparison table for a part at a given level. */
export function upgradeRows(p, level, singlePlayer = false) {
  const len = singlePlayer ? [['Length w/o weight penalty:', lengthLimitOf(p, level)]] : [];
  if (p.type === 'engine') {
    const s = engineLevelStats(level);
    return [['Power (hp):', s.power], ...len, ['Weight w/o frames (kg):', s.mass]];
  }
  if (p.type === 'wheel') {
    const f = wheelLevelFactors(level);
    return [['Friction:', f.grip * 100], ...len, ['Weight (kg):', wheelMass({ ...p, level })]];
  }
  if (p.type === 'jet') {
    const s = jetLevelStats(level, p.powerCoef);
    return [['Thrust (N):', s.thrust], ...len, ['Weight (kg):', s.mass]];
  }
  if (p.type === 'seat') return [['Length w/o weight penalty:', lengthLimitOf(p, level)]];
  return [];
}

// ---------------- derived physical quantities ----------------
export function frameThickness(p) {
  return 0.04 * Math.sqrt(Math.max(0.5, p.weightHardness) / 10);
}

export function frameRadius(p) {
  return Math.max(frameThickness(p) / 2, p.minRadius || 0);
}

export function frameYield(p) {
  return 45000 * (p.elasticLimit / 25) * (p.weightHardness / 10);
}

export function frameBreakStrain(p) {
  return 0.15 + 0.006 * p.ultimateStrength;
}

export function wheelMass(p) {
  return (8 + 110 * p.radius * p.width) * wheelLevelFactors(p.level || 10).mass;
}

export function engineMass(p) {
  return engineLevelStats(p.level || 10).mass;
}

export function enginePower(p) {
  return engineLevelStats(p.level || 10).power;
}

export function jetMass(p) {
  return jetLevelStats(p.level || 10, p.powerCoef ?? 100).mass;
}

export function jetThrust(p) {
  return jetLevelStats(p.level || 10, p.powerCoef ?? 100).thrust;
}

/** Inverse of the engine formula (used when migrating v1 cars that stored horsepower). */
export function levelForPower(hp) {
  return Math.max(1, Math.min(MAX_LEVEL, Math.round(20 * Math.pow(Math.max(1, hp) / 1200, 1 / 1.4))));
}

/**
 * Mass of a part in kg and how it is split over its nodes (fractions sum to 1).
 * `len` is the distance between the first two nodes, `area` the panel area.
 */
export function partMass(p, len = 0, area = 0) {
  switch (p.type) {
    case 'frame': return { mass: 3.2 * len * (p.weightHardness / 10), split: null };
    case 'shock': return { mass: 3 + 4 * len, split: null };
    case 'rod': return { mass: (1.5 + 2 * len) * (p.weightHardness / 10), split: null };
    case 'limiter': return { mass: (0.3 + 0.3 * len) * (p.weightHardness / 10), split: null };
    case 'wheel': return { mass: wheelMass(p), split: [0.75, 0.25] };
    case 'engine': return { mass: engineMass(p), split: null };
    case 'jet': return { mass: jetMass(p), split: null };
    case 'panel': return { mass: 4.5 * area, split: null };
    case 'seat': return { mass: 80, split: null };
    case 'weight': return { mass: p.mass, split: null };
    case 'angleLock': return { mass: 0.3 * (p.weightHardness / 4), split: [0.25, 0.5, 0.25] };
    case 'slider': return { mass: 1.2, split: [0, 0, 1] };
    case 'transmission': return { mass: 0, split: null };
    default: return { mass: 0, split: null };
  }
}

// ---------------- UI schema ----------------
// Slider / select specs may carry when(part): shown only when it returns true.
const isDriver = (p) => p.role !== 'passenger';
// sliders: two columns of { key, label, min, max, step }
// selects: bottom-row dropdowns { key, label?, options }
const S = (key, label, min, max, step) => ({ key, label, min, max, step });
const keySel = (key, label) => ({ key, label, options: KEY_ACTIONS });

export const PART_TYPES = {
  frame: {
    label: 'Frame',
    nodes: 2,
    layer: 'frames',
    twoNodeActions: true,
    defaults: { elasticLimit: 25, weightHardness: 10, ultimateStrength: 50, minRadius: 0, color: '' },
    sliders: [
      [S('elasticLimit', 'Elastic limit:', 1, 100, 1), S('weightHardness', 'Weight & Hardness:', 1, 30, 0.5)],
      [S('ultimateStrength', 'Ultimate strength:', 0, 100, 1), S('minRadius', 'Minimum radius:', 0, 0.3, 0.005)],
    ],
    selects: [],
    help: 'Elastic limit: force before the frame bends. Weight & Hardness: thicker, heavier, stronger tube. Ultimate strength: how far it bends before it snaps. Minimum radius: collision radius of the frame ends.',
  },
  shock: {
    label: 'Shock',
    nodes: 2,
    layer: 'remaining',
    twoNodeActions: true,
    defaults: { hardness: 20000, maxCompression: 0.3, damping: 40, preCompression: 1.12, maxStretch: 1.0, rcRatio: 0 },
    sliders: [
      [S('hardness', 'Hardness:', 1000, 300000, 500), S('maxCompression', 'Max compression:', 0.05, 0.9, 0.01), S('damping', 'Damping:', 0, 300, 1)],
      [S('preCompression', 'Pre-compression:', 1, 2, 0.01), S('maxStretch', 'Max stretch:', 1, 2, 0.01), S('rcRatio', 'R/C Damping ratio:', 0, 4, 0.05)],
    ],
    selects: [],
    help: 'Hardness: spring rate (N/m). Pre-compression: free length of the spring as a multiple of the built length, so the car sits at the height you built it. Max compression / stretch: bump and rebound stops. Damping: damper strength. R/C ratio: rebound vs compression damping (0 = equal).',
  },
  rod: {
    label: 'Rod',
    nodes: 2,
    layer: 'remaining',
    twoNodeActions: true,
    defaults: { mode: 'steering', maxCompression: 0.2, weightHardness: 10, ratioOfPeriods: 1.3, maxStretch: 1.2, returnTime: 0.1, speedFactor: 1.7, keyCompress: 'steerLeft', keyStretch: 'steerRight', initial: 'initial' },
    sliders: [
      [S('maxCompression', 'Max compression:', 0, 0.9, 0.005), S('weightHardness', 'Weight & Hardness:', 1, 30, 0.5), S('ratioOfPeriods', 'Ratio of periods:', 0.2, 5, 0.05)],
      [S('maxStretch', 'Max stretch:', 1, 3, 0.005), S('returnTime', 'Return time:', 0.02, 3, 0.01), S('speedFactor', 'Car speed factor:', 0, 5, 0.05)],
    ],
    selects: [
      { key: 'mode', options: [['steering', 'Steering'], ['piston', 'Piston']] },
      keySel('keyCompress', 'Compress'),
      keySel('keyStretch', 'Stretch'),
      { key: 'initial', options: [['initial', 'Initial'], ['compressed', 'Compressed'], ['stretched', 'Stretched']] },
    ],
    help: 'A rod changes length with its keys. Steering mode follows the steering input; Piston mode moves while a key is held and returns to the initial length when released. Max compression: fraction of the length it can shorten by. Max stretch: multiple of the length it can extend to. Return time: seconds to travel back to the initial length. Ratio of periods: time to move away from the initial length relative to the return time. Car speed factor: reduces steering travel at speed (steering mode).',
  },
  limiter: {
    label: 'Limiter',
    nodes: 2,
    layer: 'remaining',
    twoNodeActions: true,
    defaults: { maxCompression: 0.5, weightHardness: 10, maxStretch: 1.5, minRadius: 0 },
    sliders: [
      [S('maxCompression', 'Max compression:', 0, 1, 0.01), S('weightHardness', 'Weight & Hardness:', 1, 30, 0.5)],
      [S('maxStretch', 'Max stretch:', 1, 3, 0.01), S('minRadius', 'Minimum radius:', 0, 0.3, 0.005)],
    ],
    selects: [],
    help: 'A limiter is slack between its compression and stretch limits and rigid outside them (a strap or bump stop).',
  },
  wheel: {
    label: 'Wheel',
    nodes: 2, // [hub (wheel centre), axle node]
    layer: 'rims',
    upgradable: true,
    twoNodeActions: true,
    defaults: {
      level: 10, elasticLimit: 25, radius: 0.33, width: 0.25, pressure: 32, tireHeight: 0.4, abs: 5,
      tireType: 'road', handbrakeKey: 'none', rim: 0, steer: 0, toe: 0, brake: 1, grip: 1.0,
    },
    sliders: [
      [S('elasticLimit', 'Elastic limit:', 1, 100, 1), S('width', 'Width:', 0.05, 1, 0.005), S('pressure', 'Pressure (psi):', 10, 120, 1)],
      [S('radius', 'Radius:', 0.1, 2, 0.005), S('tireHeight', 'Tire height:', 0.1, 0.7, 0.01), S('abs', 'ABS:', 0, 10, 1)],
    ],
    selects: [
      { key: 'tireType', options: TIRE_TYPES },
      keySel('handbrakeKey', 'Hand brake'),
      { key: 'rim', options: [[0, 'Rim 0'], [1, 'Rim 1'], [2, 'Rim 2'], [3, 'Rim 3']] },
      { key: 'steer', options: [[0, 'No steering'], [20, 'Steer 20°'], [30, 'Steer 30°'], [40, 'Steer 40°'], [-10, 'Rear steer 10°']] },
    ],
    help: 'Wheel centre = hub node, the second node sets the axle direction. A wheel is driven when a Transmission links it to an engine. Pressure: low = softer and grippier on loose ground. Tire height: sidewall height as a fraction of the radius. ABS: anti-lock strength (0 = off). Steering here is virtual; use rods for real steering geometry.',
  },
  engine: {
    label: 'Engine',
    nodes: 2,
    layer: 'remaining',
    upgradable: true,
    twoNodeActions: true,
    defaults: { level: 10, elasticLimit: 25, topSpeed: 0, torqueLimit: 1600, engineBraking: 100, gearUp: 'gearUp', gearDown: 'gearDown', gearRatios: null },
    sliders: [
      [S('elasticLimit', 'Elastic limit:', 1, 100, 1), S('topSpeed', 'Top speed:', 0, 600, 1)],
      [S('torqueLimit', 'Torque limitation:', 50, 5000, 10), S('engineBraking', 'Engine braking:', 0, 300, 1)],
    ],
    selects: [keySel('gearUp', 'Gear up'), keySel('gearDown', 'Gear down'), { key: '__gearRatios', button: 'Gear ratios...' }],
    help: 'Power comes from the upgrade level. Top speed (km/h at the rev limit in top gear) sets the gearing; 0 = automatic, geared for the speed where power meets drag. Torque limitation caps crank torque (N·m). Engine braking scales the drag when you lift off. Gear ratios: the spacing of the gears (automatic by default). Elastic limit: how much deformation of the frames around the engine it survives before losing power.',
  },
  jet: {
    label: 'Jet',
    nodes: 2, // thrust pushes from node 0 toward node 1, flame at node 0
    layer: 'remaining',
    upgradable: true,
    twoNodeActions: true,
    defaults: { level: 10, elasticLimit: 25, spoolTime: 0, powerCoef: 100, mode: 'accelerate', throttleUp: 'jetUp', throttleDown: 'jetDown' },
    sliders: [
      [S('elasticLimit', 'Elastic limit:', 1, 100, 1), S('spoolTime', 'Period of increase:', 0, 5, 0.05)],
      [S('powerCoef', 'Weight & Power coef.:', 10, 300, 1)],
    ],
    selects: [
      keySel('throttleUp', 'Throttle up'),
      keySel('throttleDown', 'Throttle down'),
      { key: 'mode', options: [['accelerate', 'With accelerator'], ['boost', 'With boost'], ['throttle', 'Throttle keys'], ['max', 'Maximum thrust']] },
    ],
    help: 'Thrust comes from the upgrade level × Weight & Power coef. Period of increase: spool-up time. Modes: fire with the accelerator, with boost, with the throttle keys (persistent, can reverse), or always at maximum thrust.',
  },
  panel: {
    label: 'Panel',
    nodes: 3,
    layer: 'panels',
    defaults: { drag: 0, balance: 0, lift: 0, material: 'polished', color: '' },
    sliders: [
      [S('drag', 'Drag coefficient:', 0, 2, 0.01), S('balance', 'Balance:', -1, 1, 0.05)],
      [S('lift', 'Lift coefficient:', -3, 3, 0.05)],
    ],
    selects: [{ key: 'material', options: PANEL_MATERIALS }],
    help: 'Drag: air resistance of this panel. Lift: negative = downforce (pushes the car toward its floor). Balance: moves the aero force toward the front (+) or rear (−) nodes.',
  },
  seat: {
    label: 'Seat',
    nodes: 1,
    layer: 'remaining',
    // the level only matters in Single player: it raises the car's length limit
    upgradable: true,
    maxLevel: 10,
    defaults: { level: 1, role: 'driver', elasticLimit: 25, airResistance: 100, seatType: 'sport', grid: 0.025, physics: 2000, hornKey: 'horn' },
    sliders: [
      [S('elasticLimit', 'Elastic limit:', 1, 100, 1)],
      [{ ...S('airResistance', 'Air resistance of points:', 0, 300, 1), when: isDriver }],
    ],
    selects: [
      { key: 'role', options: [['driver', 'Driver'], ['passenger', 'Passenger']] },
      { key: 'seatType', options: [['sport', 'Sport'], ['classic', 'Classic'], ['bucket', 'Bucket']] },
      { key: 'grid', label: '#', options: [[0.01, '0.01m'], [0.025, '0.025m'], [0.05, '0.05m'], [0.1, '0.1m'], [0.25, '0.25m']], when: isDriver },
      { key: 'physics', options: [[1000, 'Normal (1 kHz)'], [2000, 'Advanced (2 kHz)'], [4000, 'Extreme (4 kHz)']], when: isDriver },
      { ...keySel('hornKey', 'Horn'), when: isDriver },
    ],
    help: 'Driver or Passenger: a car has one driver (the first driver seat) and any number of passengers (80 kg each). Seat type: Sport, Classic or Bucket. The driver seat holds car-wide settings: air resistance of all nodes (%), the garage grid step, physics accuracy for this car and the horn key. Elastic limit: if the cockpit around the driver is crushed past it, the driver is knocked out until you respawn.',
  },
  weight: {
    label: 'Ballast',
    nodes: 1,
    layer: 'remaining',
    defaults: { mass: 50 },
    sliders: [[S('mass', 'Mass:', 1, 3000, 1)], []],
    selects: [],
    help: 'Extra mass on a node.',
  },
  angleLock: {
    label: 'Angle Lock',
    nodes: 3, // [end, joint, end]
    layer: 'frames',
    defaults: { elasticLimit: 100, weightHardness: 4 },
    sliders: [[S('elasticLimit', 'Elastic limit:', 1, 200, 1)], [S('weightHardness', 'Weight & Hardness:', 0.5, 20, 0.5)]],
    selects: [],
    help: 'Locks the angle between the two frames meeting at the middle node, so a joint is stiff without a diagonal brace. Elastic limit: torque before it bends permanently.',
  },
  transmission: {
    label: 'Transmission',
    nodes: 2,
    layer: 'remaining',
    defaults: { radius: 0.021, powerPct: 0, engine: null, wheel: null },
    sliders: [[S('radius', 'Radius:', 0.005, 0.08, 0.001)], [S('powerPct', 'Engine pow. %:', 0, 100, 1)]],
    selects: [{ key: 'engine', label: 'Engine', options: 'engines' }, { key: 'wheel', label: 'Wheel', options: 'wheels' }],
    help: 'A drive shaft from an engine to a wheel: only wheels linked to an engine by a transmission are driven. With the Transmission tool, click an engine and then a wheel. Engine pow. %: share of power for this wheel (0 = equal share).',
  },
  slider: {
    label: 'Slider',
    nodes: 3, // [frame end A, frame end B, sliding node]
    layer: 'remaining',
    defaults: {},
    sliders: [[], []],
    selects: [],
    help: 'The sliding node can move freely along the frame between its two end nodes.',
  },
};

// Order matters for these types (hub/axle, thrust direction, engine front/back, joint in the middle).
export const ORDERED_TYPES = new Set(['wheel', 'jet', 'engine', 'angleLock', 'slider']);

export function partDefaults(type) {
  return structuredClone(PART_TYPES[type].defaults);
}

// Mirror a part's props when it is copied across the symmetry plane.
export function mirrorProps(p) {
  const q = structuredClone(p);
  if (q.type === 'rod') {
    const swap = { steerLeft: 'steerRight', steerRight: 'steerLeft' };
    const a = q.keyCompress, b = q.keyStretch;
    if (swap[a] || swap[b]) {
      q.keyCompress = swap[a] || a;
      q.keyStretch = swap[b] || b;
    }
  }
  return q;
}
