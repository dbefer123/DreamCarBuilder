// Persistent user settings.
const KEY = 'dcb.settings.v1';

export const DEFAULTS = {
  // Graphics
  quality: 'high', // low | medium | high | ultra
  renderScale: 1,
  windowed: true, // false = browser fullscreen
  vsync: true, // false = frame limiter
  frameLimit: 60,
  antialias: true,
  bloom: true,
  ao: true,
  shadows: true,
  grass: true,
  // Preferences
  units: 'mph',
  language: 'en',
  // Driving
  physicsRate: 0, // 0 = the car's own setting (seat part), else 1000 / 2000 / 4000
  abs: true,
  tractionControl: true,
  stability: true,
  steerAssist: true,
  gearbox: 'auto',
  // Race
  fov: 68,
  cameraAdvance: 1, // 0 velocity direction, 1 car direction, 2 look ahead
  showGhost: true,
  // Sounds (0..100, the original's defaults)
  volume: 0.6, // master
  volEngine: 75,
  volWheels: 50,
  volWind: 50,
  volImpacts: 50,
  volEffects: 50,
  // Garage
  reverseLeft: true, // left side wheels spin the same way as the right side
  showCOM: false,
  showCOL: false,
  reverseZoom: false,
  swapMouse: false,
  thinFrames: false,
  showCarInfo: true,
  chainTools: false, // keep the part tool active after placing (frames chain from the last node)
  bgTop: '#bccfe8',
  bgBottom: '#9fb6d6',
  // Controls (null = defaults, see bindings.js)
  bindings: null,
  pad: null,
  // Multiplayer (beta): the name shown above your car
  mpName: '',
  // last used
  map: 'default',
  time: 'Noon',
  cameraDistance: 1,
  invertOrbit: false,
  settingsVersion: 2,
};

export const settings = structuredClone(DEFAULTS);

try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    // v1 settings forced 2 kHz; physics accuracy is now a per-car seat setting by default
    if (!saved.settingsVersion) delete saved.physicsRate;
    Object.assign(settings, saved, { settingsVersion: 2 });
  }
} catch {
  // storage unavailable: defaults only
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function resetSettings(keys = Object.keys(DEFAULTS)) {
  for (const k of keys) settings[k] = structuredClone(DEFAULTS[k]);
}
