// Multiplayer client: connects to the relay on this site (/mp, see server/relay.js), keeps an
// estimate of the server clock and passes messages between the game and the other players
// in the room. One shared instance (`mp`), so a connection survives screen changes.

const PING_EVERY = 2000;

export class MPClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.id = null;
    this.name = '';
    this.room = null; // { id, name, map, ... } while in a room
    this.peers = new Map(); // id -> { id, name, d (design JSON), rc, states: [] }
    this.race = null; // race-together info from the server
    this.offset = 0; // server time - local time (ms)
    this.rtt = Infinity;
    this._pings = [];
  }

  get connected() {
    return this.ws?.readyState === 1 && this.id !== null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  _emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) {
      try {
        fn(msg);
      } catch (e) {
        console.error(e);
      }
    }
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  /** Current time on the server's clock (ms). */
  serverNow() {
    return Date.now() + this.offset;
  }

  /** Connect (or reuse the connection) under a player name. */
  connect(name) {
    if (this.connected) return Promise.resolve(this);
    this.disconnect();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/mp`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let ok = false;
      const fail = () => {
        if (!ok) reject(new Error('Could not reach the game server. Multiplayer needs the game\'s Node server ("npm run dev" or "npm run serve"); static hosting such as GitHub Pages can\'t run it. Single player and Sandbox work everywhere.'));
      };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name }));
      ws.onerror = fail;
      ws.onclose = () => {
        fail();
        if (this.ws === ws) this._closed();
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          ok = true;
          this.id = m.id;
          this.name = m.name;
          this.limits = m.limits;
          this.offset = m.time - Date.now();
          this._ping();
          this._pingTimer = setInterval(() => this._ping(), PING_EVERY);
          resolve(this);
        }
        this._message(m);
      };
    });
  }

  disconnect() {
    clearInterval(this._pingTimer);
    this.lastRoom = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
      this._closed();
    }
  }

  _closed() {
    clearInterval(this._pingTimer);
    const was = this.room;
    this.ws = null;
    this.id = null;
    this.room = null;
    this.race = null;
    this.peers.clear();
    this._emit('close', { room: was });
  }

  _ping() {
    this.send({ t: 'ping', c: performance.now() });
  }

  /** Resolve with the next message of a type (or reject on an error message / timeout). */
  _await(type, ms = 5000) {
    return new Promise((resolve, reject) => {
      const offs = [];
      const done = (fn, v) => {
        offs.forEach((o) => o());
        clearTimeout(timer);
        fn(v);
      };
      offs.push(this.on(type, (m) => done(resolve, m)));
      offs.push(this.on('error', (m) => done(reject, new Error(m.msg))));
      offs.push(this.on('close', () => done(reject, new Error('Disconnected from the game server.'))));
      const timer = setTimeout(() => done(reject, new Error('The game server did not answer.')), ms);
    });
  }

  async list() {
    const p = this._await('rooms');
    this.send({ t: 'list' });
    return (await p).rooms;
  }

  async join(roomId) {
    const p = this._await('joined');
    this.send({ t: 'join', room: roomId });
    return (await p).room;
  }

  async create(name, map) {
    const p = this._await('joined');
    this.send({ t: 'create', name, map });
    return (await p).room;
  }

  /** Leave the room (staying connected); `lastRoom` lets the garage bring you back. */
  leave() {
    if (!this.room) return;
    this.send({ t: 'leave' });
    this.lastRoom = this.room;
    this.room = null;
    this.race = null;
    this.peers.clear();
    this._emit('roomChange', null);
  }

  /** Our car's pose for the others (call ~15 times a second). */
  sendState(sim) {
    const r = (v) => Math.round(v * 1000) / 1000;
    const q = sim.quat;
    this.send({
      t: 's',
      p: [r(sim.com.x), r(sim.com.y), r(sim.com.z)],
      q: [r(q[0]), r(q[1]), r(q[2]), r(q[3])],
      v: [r(sim.vel.x), r(sim.vel.y), r(sim.vel.z)],
      sp: r(sim.speed),
      st: r(sim.controls?.steer || 0),
    });
  }

  sendDesign(json, restCom) {
    this.send({ t: 'design', d: json, rc: [restCom.x, restCom.y, restCom.z] });
  }

  chat(text) {
    this.send({ t: 'chat', text });
  }

  raceStart(track) {
    this.send({ t: 'raceStart', track });
  }

  raceJoin() {
    if (this.race) this.send({ t: 'raceJoin', race: this.race.id });
  }

  raceFinish(time) {
    if (this.race) this.send({ t: 'raceFinish', race: this.race.id, time });
  }

  raceQuit() {
    if (this.race) this.send({ t: 'raceQuit', race: this.race.id });
  }

  _peer(id, name) {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, name: name || `Player ${id}`, d: null, rc: [0, 0, 0], states: [] };
      this.peers.set(id, p);
    }
    if (name) p.name = name;
    return p;
  }

  _message(m) {
    switch (m.t) {
      case 'pong': {
        // keep the clock offset from the fastest recent round trip
        const rtt = performance.now() - m.c;
        this._pings.push({ rtt, offset: m.s + rtt / 2 - Date.now() });
        if (this._pings.length > 8) this._pings.shift();
        const best = this._pings.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.rtt = best.rtt;
        this.offset = best.offset;
        break;
      }
      case 'joined':
        this.room = m.room;
        this.peers.clear();
        for (const p of m.players) Object.assign(this._peer(p.id, p.name), { d: p.d || null, rc: p.rc || [0, 0, 0] });
        this.race = m.race;
        this._emit('roomChange', m.room);
        break;
      case 'peerJoin':
        this._peer(m.id, m.name);
        break;
      case 'peerLeave':
        m.name = this.peers.get(m.id)?.name;
        this.peers.delete(m.id);
        break;
      case 'design':
        Object.assign(this._peer(m.id), { d: m.d, rc: m.rc });
        break;
      case 's': {
        const p = this._peer(m.id);
        p.states.push(m);
        if (p.states.length > 40) p.states.shift();
        break;
      }
      case 'raceInvite':
      case 'raceUpdate':
        this.race = m.race;
        break;
      case 'raceEnd':
        this.race = null;
        break;
      default:
    }
    this._emit(m.t, m);
  }
}

export const mp = new MPClient();
