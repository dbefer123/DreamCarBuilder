// Multiplayer relay: everyone who opens this site can meet in rooms ("Game servers"): one
// public room per map plus rooms players create. The server only relays. Each client simulates
// its own car and sends its pose; car designs, chat and race-together invitations are passed
// on to the other players in the room. Attached to Vite's dev/preview server (vite.config.js).
import { WebSocketServer } from 'ws';
import { MAP_LIST } from '../src/world/maps/list.js';

export const MP_PATH = '/mp';
export const LIMITS = {
  players: 16, // per room
  rooms: 64,
  name: 24,
  roomName: 32,
  chat: 200,
  track: 64,
  design: 512 * 1024, // serialized car design (bytes)
  rate: 60, // messages per second (bucket refill)
  burst: 120,
};
const RACE_LEAD = 10000; // ms from the invitation to the start
const RACE_MAX = 15 * 60 * 1000; // a race ends at the latest this long after its start
const HEARTBEAT = 15000;
const MAPS = new Map(MAP_LIST.map((m) => [m.key, m.label]));

/** Printable text without control characters, trimmed to `max` characters. */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(isNum);

/**
 * Handle WebSocket upgrades on /mp of an http(s) server (others, like Vite's HMR socket,
 * are left alone). Returns the relay (close() it to stop).
 */
export function attachRelay(httpServer, opts = {}) {
  const relay = new Relay(opts);
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.design + 4096 });
  httpServer.on('upgrade', (req, socket, head) => {
    let path;
    try {
      path = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return;
    }
    if (path !== MP_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => relay.connect(ws));
  });
  httpServer.on('close', () => relay.close());
  relay.wss = wss;
  return relay;
}

export class Relay {
  constructor(opts = {}) {
    this.now = opts.now || (() => Date.now());
    this.rooms = new Map();
    this.clients = new Set();
    this.seq = 0;
    for (const [key, label] of MAPS) this._newRoom(`public-${key}`, `${label} (public)`, key, true);
    this.timer = setInterval(() => this._heartbeat(), opts.heartbeat || HEARTBEAT);
    this.timer.unref?.();
  }

  close() {
    clearInterval(this.timer);
    for (const c of this.clients) c.ws.terminate();
    this.clients.clear();
  }

  _newRoom(id, name, map, isPublic) {
    const room = { id, name, map, public: isPublic, players: new Map(), race: null };
    this.rooms.set(id, room);
    return room;
  }

  connect(ws) {
    const c = { id: ++this.seq, ws, name: `Player ${this.seq}`, room: null, design: null, tokens: LIMITS.burst, last: this.now(), strikes: 0, alive: true };
    this.clients.add(c);
    ws.on('message', (data, isBinary) => this._message(c, data, isBinary));
    ws.on('close', () => this._drop(c));
    ws.on('error', () => this._drop(c));
    ws.on('pong', () => (c.alive = true));
  }

  _drop(c) {
    if (!this.clients.has(c)) return;
    this._leave(c);
    this.clients.delete(c);
  }

  _heartbeat() {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        this._drop(c);
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        // closing
      }
    }
    // finished or abandoned races
    const now = this.now();
    for (const room of this.rooms.values()) if (room.race && now > room.race.start + RACE_MAX) this._endRace(room);
  }

  /** Token bucket: LIMITS.rate messages per second, bursts up to LIMITS.burst. */
  _allow(c) {
    const now = this.now();
    c.tokens = Math.min(LIMITS.burst, c.tokens + ((now - c.last) / 1000) * LIMITS.rate);
    c.last = now;
    if (c.tokens >= 1) {
      c.tokens -= 1;
      return true;
    }
    if (++c.strikes > 600) c.ws.close(1008, 'Too many messages');
    return false;
  }

  _send(c, msg) {
    if (c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  _broadcast(room, msg, except = null) {
    const s = JSON.stringify(msg);
    for (const p of room.players.values()) if (p !== except) this._send(p, s);
  }

  _roomInfo(room) {
    return { id: room.id, name: room.name, map: room.map, mapName: MAPS.get(room.map), players: room.players.size, max: LIMITS.players, public: room.public };
  }

  _raceInfo(race) {
    return { id: race.id, track: race.track, host: race.host, hostName: race.hostName, start: race.start, racers: [...race.racers.entries()].map(([id, r]) => ({ id, name: r.name, time: r.time })) };
  }

  _message(c, data, isBinary) {
    if (isBinary || !this._allow(c)) return;
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const room = c.room;
    switch (m.t) {
      case 'hello':
        c.name = cleanText(m.name, LIMITS.name) || c.name;
        this._send(c, { t: 'welcome', id: c.id, name: c.name, limits: LIMITS, time: this.now() });
        break;
      case 'ping':
        this._send(c, { t: 'pong', c: isNum(m.c) ? m.c : 0, s: this.now() });
        break;
      case 'list':
        this._send(c, { t: 'rooms', rooms: [...this.rooms.values()].map((r) => this._roomInfo(r)) });
        break;
      case 'create': {
        const name = cleanText(m.name, LIMITS.roomName);
        if (!name || !MAPS.has(m.map)) return this._send(c, { t: 'error', msg: 'Give the server a name and pick a map.' });
        if (this.rooms.size >= LIMITS.rooms) return this._send(c, { t: 'error', msg: 'Too many servers right now. Join one of the others.' });
        const r = this._newRoom(`r${++this.seq}`, name, m.map, false);
        this._join(c, r);
        break;
      }
      case 'join': {
        const r = this.rooms.get(m.room);
        if (!r) return this._send(c, { t: 'error', msg: 'That server is gone. Update the list.' });
        if (r === room) return;
        if (r.players.size >= LIMITS.players) return this._send(c, { t: 'error', msg: 'That server is full.' });
        this._join(c, r);
        break;
      }
      case 'leave':
        this._leave(c);
        this._send(c, { t: 'left' });
        break;
      case 's': // car state, ~15 per second
        if (!room || !nums(m.p, 3) || !nums(m.q, 4)) return;
        this._broadcast(room, {
          t: 's', id: c.id, tm: this.now(), p: m.p, q: m.q,
          v: nums(m.v, 3) ? m.v : [0, 0, 0], sp: isNum(m.sp) ? m.sp : 0, st: isNum(m.st) ? m.st : 0,
        }, c);
        break;
      case 'design':
        if (!room || typeof m.d !== 'string' || m.d.length > LIMITS.design) return;
        c.design = { d: m.d, rc: nums(m.rc, 3) ? m.rc : [0, 0, 0] };
        this._broadcast(room, { t: 'design', id: c.id, ...c.design }, c);
        break;
      case 'chat': {
        const text = cleanText(m.text, LIMITS.chat);
        if (room && text) this._broadcast(room, { t: 'chat', id: c.id, name: c.name, text });
        break;
      }
      case 'raceStart': {
        if (!room) return;
        const track = cleanText(m.track, LIMITS.track);
        if (!track) return;
        if (room.race) return this._send(c, { t: 'error', msg: `${room.race.hostName}'s race on ${room.race.track} is still running.` });
        room.race = { id: ++this.seq, track, host: c.id, hostName: c.name, start: this.now() + RACE_LEAD, racers: new Map([[c.id, { name: c.name, time: null }]]) };
        this._broadcast(room, { t: 'raceInvite', race: this._raceInfo(room.race) });
        break;
      }
      case 'raceJoin': {
        const race = room?.race;
        if (!race || race.id !== m.race || race.racers.has(c.id)) return;
        if (this.now() > race.start) return this._send(c, { t: 'error', msg: 'That race has already started.' });
        race.racers.set(c.id, { name: c.name, time: null });
        this._broadcast(room, { t: 'raceUpdate', race: this._raceInfo(race) });
        break;
      }
      case 'raceFinish': {
        const r = room?.race?.racers.get(c.id);
        if (!r || r.time !== null || room.race.id !== m.race || !isNum(m.time) || m.time <= 0) return;
        // a finish can't come in faster than the time it claims
        r.time = Math.max(m.time, (this.now() - room.race.start) / 1000 - 5);
        this._broadcast(room, { t: 'raceUpdate', race: this._raceInfo(room.race) });
        if ([...room.race.racers.values()].every((q) => q.time !== null)) this._endRace(room);
        break;
      }
      case 'raceQuit':
        if (room?.race?.id === m.race) this._quitRace(c, room);
        break;
      default:
    }
  }

  _join(c, room) {
    this._leave(c);
    c.room = room;
    room.players.set(c.id, c);
    const players = [...room.players.values()].filter((p) => p !== c).map((p) => ({ id: p.id, name: p.name, ...(p.design || {}) }));
    this._send(c, { t: 'joined', room: this._roomInfo(room), you: c.id, players, race: room.race ? this._raceInfo(room.race) : null });
    this._broadcast(room, { t: 'peerJoin', id: c.id, name: c.name }, c);
  }

  _leave(c) {
    const room = c.room;
    if (!room) return;
    if (room.race) this._quitRace(c, room);
    room.players.delete(c.id);
    c.room = null;
    c.design = null;
    this._broadcast(room, { t: 'peerLeave', id: c.id });
    if (!room.public && room.players.size === 0) this.rooms.delete(room.id);
  }

  _quitRace(c, room) {
    const race = room.race;
    if (!race || !race.racers.delete(c.id)) return;
    this._broadcast(room, { t: 'raceUpdate', race: this._raceInfo(race) });
    const left = [...race.racers.values()];
    if (!left.length || left.every((q) => q.time !== null)) this._endRace(room);
  }

  _endRace(room) {
    if (!room.race) return;
    this._broadcast(room, { t: 'raceEnd', race: this._raceInfo(room.race) });
    room.race = null;
  }
}
