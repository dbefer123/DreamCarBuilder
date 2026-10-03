// Game profiles (Settings > Preferences: Game 1 / New Game / Delete this game) and the
// Single player progress of the active profile. Each profile has its own car library,
// copied parts, custom tracks, best times, ghosts and Single player coins. The first profile
// keeps the storage keys used before profiles existed, so old saves become "Game 1".
import { serializeDesign, deserializeDesign, carPrice } from '../car/design.js';
import { starterDesign } from '../car/presets.js';

const KEY = 'dcb.profiles.v1';
// per-profile storage names (see storage.js)
export const PROFILE_KEYS = ['cars', 'current', 'parts', 'tracks', 'times', 'ratings', 'career', 'ghosts'];

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let state = null;

export const profiles = {
  _state() {
    if (!state) state = readJSON(KEY, null) || { active: 'p1', list: [{ id: 'p1', name: 'Game 1', created: Date.now() }] };
    return state;
  },
  list() {
    return this._state().list;
  },
  active() {
    const s = this._state();
    return s.list.find((p) => p.id === s.active) || s.list[0];
  },
  /** localStorage key for one of the PROFILE_KEYS of a profile. */
  key(name, id = this.active().id) {
    return id === 'p1' ? `dcb.${name}.v1` : `dcb.${id}.${name}.v1`;
  },
  create(name) {
    const s = this._state();
    const n = Math.max(0, ...s.list.map((p) => Number(p.id.slice(1)) || 0)) + 1;
    const id = `p${n}`;
    s.list.push({ id, name: name || `Game ${n}`, created: Date.now() });
    s.active = id;
    writeJSON(KEY, s);
    return id;
  },
  select(id) {
    const s = this._state();
    if (!s.list.some((p) => p.id === id)) return false;
    s.active = id;
    writeJSON(KEY, s);
    return true;
  },
  rename(id, name) {
    const p = this._state().list.find((q) => q.id === id);
    if (p && name) {
      p.name = name;
      writeJSON(KEY, this._state());
    }
  },
  /** Delete a profile and everything saved in it (the last profile can't be deleted). */
  remove(id) {
    const s = this._state();
    if (s.list.length <= 1) return false;
    for (const k of PROFILE_KEYS) {
      try {
        localStorage.removeItem(this.key(k, id));
      } catch {
        // ignore
      }
    }
    s.list = s.list.filter((p) => p.id !== id);
    if (s.active === id) s.active = s.list[0].id;
    writeJSON(KEY, s);
    return true;
  },
};

/** Single player progress of the active profile (coins, beaten bots, career stats). */
export const START_COINS = 500; // free coins on top of the starter car
const STATS0 = { finishes: 0, opponents: 0, raceTime: 0, mileage: 0, fastest: 0 };

export const career = {
  _data() {
    let d = readJSON(profiles.key('career'), null);
    if (!d || d.version !== 2) {
      // new game, or session-2 upgrade points (worth 20 coins each)
      const old = d;
      d = { version: 2, earned: null, car: old?.car || null, defeated: {}, best: {}, stats: { ...STATS0 } };
      if (old?.earned) d.earned = this._starterValue() + old.earned * 20;
    }
    if (d.earned == null) {
      d.earned = this._starterValue() + START_COINS;
      this._save(d);
    }
    return d;
  },
  _starterValue() {
    return carPrice(starterDesign());
  },
  _save(d) {
    writeJSON(profiles.key('career'), d);
  },
  /** Coins earned so far, including the starter car and starting coins. */
  earned() {
    return this._data().earned;
  },
  /** Coins left with this car ("You have"): earned minus the car's price. */
  coins(design) {
    return this.earned() - carPrice(design);
  },
  stats() {
    return { ...STATS0, ...this._data().stats };
  },
  races() {
    return this.stats().finishes;
  },
  car() {
    const d = this._data();
    if (!d.car) return null;
    try {
      return deserializeDesign(d.car);
    } catch {
      return null;
    }
  },
  saveCar(design) {
    const d = this._data();
    d.car = JSON.parse(serializeDesign(design));
    this._save(d);
  },
  /** Indices of the bots already beaten on a track. */
  defeated(trackKey) {
    return this._data().defeated[trackKey] || [];
  },
  /** Distance driven in Single player (metres). */
  addMileage(m) {
    if (!(m > 0)) return;
    const d = this._data();
    d.stats = { ...STATS0, ...d.stats, mileage: (d.stats?.mileage || 0) + m };
    this._save(d);
  },
  /**
   * Coins for a finished race: the finish prize, plus every bot beaten for the first time.
   * bots = [{ value, time }]. Returns { total, lines, beaten }.
   */
  award({ trackKey, prize, bots = [], time, length }) {
    const d = this._data();
    const done = new Set(d.defeated[trackKey] || []);
    const lines = [['Finish prize', prize]];
    let total = prize;
    const beaten = [];
    bots.forEach((b, i) => {
      if (time < b.time && !done.has(i)) {
        done.add(i);
        beaten.push(i);
        lines.push([`Opponent ${i + 1}`, b.value]);
        total += b.value;
      }
    });
    d.defeated[trackKey] = [...done];
    const st = { ...STATS0, ...d.stats };
    st.finishes++;
    st.opponents += beaten.length;
    st.raceTime += time;
    st.fastest = Math.max(st.fastest, (length / Math.max(1, time)) * 3.6);
    d.stats = st;
    d.earned += total;
    this._save(d);
    return { total, lines, beaten };
  },
};

/** Par time of a track: its own `par`, or the length at 28 m/s (about 100 km/h). */
export function parTime(track, length) {
  return track.par ?? length / 28;
}