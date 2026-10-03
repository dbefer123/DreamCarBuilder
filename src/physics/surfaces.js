// Ground surface types. Index order is shared with the world generator.
export const SURF = {
  ASPHALT: 0,
  GRASS: 1,
  SAND: 2,
  DIRT: 3,
  ROCK: 4,
  CONCRETE: 5,
  SALT: 6,
  KERB: 7,
};

export const SURFACES = [
  { name: 'asphalt', mu: 1.0, rr: 0.013, dust: 0.0, skid: 1 },
  { name: 'grass', mu: 0.72, rr: 0.045, dust: 0.25, skid: 0 },
  { name: 'sand', mu: 0.62, rr: 0.09, dust: 1.0, skid: 0 },
  { name: 'dirt', mu: 0.76, rr: 0.035, dust: 0.8, skid: 0 },
  { name: 'rock', mu: 0.85, rr: 0.02, dust: 0.3, skid: 0 },
  { name: 'concrete', mu: 0.95, rr: 0.013, dust: 0.0, skid: 1 },
  { name: 'salt', mu: 0.82, rr: 0.016, dust: 0.5, skid: 0 },
  { name: 'kerb', mu: 0.92, rr: 0.02, dust: 0.0, skid: 1 },
];

// Friction of bare chassis nodes scraping along the ground (default; nodes can override).
export const NODE_FRICTION = 0.35;

// Tire type multipliers per surface index: grip (mu) and rolling resistance.
//                asphalt grass sand dirt rock concrete salt kerb
export const TIRE_GRIP = {
  road: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  slick: [1.12, 0.75, 0.7, 0.75, 0.9, 1.1, 0.85, 1.08],
  offroad: [0.88, 1.2, 1.3, 1.22, 1.05, 0.88, 1.1, 0.88],
  rally: [0.96, 1.1, 1.12, 1.15, 1.02, 0.96, 1.06, 0.96],
};
export const TIRE_RR = {
  road: [1, 1, 1, 1, 1, 1, 1, 1],
  slick: [0.95, 1.3, 1.4, 1.3, 1, 0.95, 1.2, 0.95],
  offroad: [1.15, 0.8, 0.7, 0.8, 1, 1.15, 0.9, 1.15],
  rally: [1.05, 0.9, 0.85, 0.9, 1, 1.05, 0.95, 1.05],
};
// Surfaces where low tire pressure helps (loose ground).
export const LOOSE = [false, true, true, true, false, false, true, false];
