// localStorage-backed car library, copied parts, custom tracks, best times and ghosts of
// the active profile (see profile.js).
import { serializeDesign, deserializeDesign } from '../car/design.js';
import { profiles } from './profile.js';

const k = (name) => profiles.key(name);

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const storage = {
  listCars() {
    const lib = read(k('cars'), {});
    return Object.entries(lib)
      .map(([name, v]) => ({ name, saved: v.saved, stats: v.stats }))
      .sort((a, b) => b.saved - a.saved);
  },
  saveCar(name, design, stats) {
    const lib = read(k('cars'), {});
    lib[name] = { saved: Date.now(), design: JSON.parse(serializeDesign({ ...design, name })), stats };
    return write(k('cars'), lib);
  },
  loadCar(name) {
    const lib = read(k('cars'), {});
    return lib[name] ? deserializeDesign(lib[name].design) : null;
  },
  deleteCar(name) {
    const lib = read(k('cars'), {});
    delete lib[name];
    write(k('cars'), lib);
  },
  saveCurrent(design) {
    write(k('current'), JSON.parse(serializeDesign(design)));
  },
  loadCurrent() {
    const d = read(k('current'), null);
    try {
      return d ? deserializeDesign(d) : null;
    } catch {
      return null;
    }
  },
  saveParts(name, fragment) {
    const lib = read(k('parts'), {});
    lib[name] = { saved: Date.now(), fragment };
    return write(k('parts'), lib);
  },
  listParts() {
    return Object.entries(read(k('parts'), {})).map(([name, v]) => ({ name, saved: v.saved })).sort((a, b) => b.saved - a.saved);
  },
  loadParts(name) {
    return read(k('parts'), {})[name]?.fragment || null;
  },
  deleteParts(name) {
    const lib = read(k('parts'), {});
    delete lib[name];
    write(k('parts'), lib);
  },
  customTracks(mapKey) {
    return read(k('tracks'), {})[mapKey] || [];
  },
  saveCustomTrack(mapKey, track) {
    const all = read(k('tracks'), {});
    all[mapKey] = (all[mapKey] || []).filter((t) => t.name !== track.name);
    all[mapKey].push(track);
    write(k('tracks'), all);
  },
  deleteCustomTrack(mapKey, name) {
    const all = read(k('tracks'), {});
    all[mapKey] = (all[mapKey] || []).filter((t) => t.name !== name);
    write(k('tracks'), all);
  },
  bestTime(mapKey, trackName) {
    return read(k('times'), {})[`${mapKey}/${trackName}`] ?? null;
  },
  setBestTime(mapKey, trackName, t) {
    const all = read(k('times'), {});
    const id = `${mapKey}/${trackName}`;
    if (all[id] === undefined || t < all[id]) {
      all[id] = t;
      write(k('times'), all);
      return true;
    }
    return false;
  },
  /** Recorded best run for "Show your best race" (see drive/ghost.js). */
  ghost(mapKey, trackName) {
    return read(k('ghosts'), {})[`${mapKey}/${trackName}`] || null;
  },
  saveGhost(mapKey, trackName, ghost) {
    const all = read(k('ghosts'), {});
    all[`${mapKey}/${trackName}`] = ghost;
    if (write(k('ghosts'), all)) return true;
    // storage full: keep only this ghost
    return write(k('ghosts'), { [`${mapKey}/${trackName}`]: ghost });
  },
  rating(mapKey, trackName) {
    return read(k('ratings'), {})[`${mapKey}/${trackName}`] || 0;
  },
  setRating(mapKey, trackName, r) {
    const all = read(k('ratings'), {});
    all[`${mapKey}/${trackName}`] = r;
    write(k('ratings'), all);
  },
};

/** Trigger a browser download of text content. */
export function downloadText(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ask the user to pick a file and resolve with its text (or data URL for images). */
export function pickFile(accept, asDataURL = false) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, data: r.result });
      if (asDataURL) r.readAsDataURL(f);
      else r.readAsText(f);
    };
    input.click();
  });
}
