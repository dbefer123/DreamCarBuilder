// Multiplayer while driving: sends our car, shows the others (remoteCars.js) and lets them
// bump into us, text chat, and "race together": anyone can start a competition for the room
// and every player chooses whether to join it (J) or keep driving.
import { el, fmtTime } from '../ui/dom.js';
import { RemoteCars } from './remoteCars.js';
import { ChatBox } from './chat.js';
import { serializeDesign } from '../car/design.js';
import { bindingsOf, keyLabel } from '../core/bindings.js';

const SEND_HZ = 15;
const RESULTS_FOR = 20000; // ms the final standings stay up

export class MPSession {
  constructor(drive) {
    this.drive = drive;
    const app = drive.app;
    const mp = (this.mp = app.mp);
    this.roomId = mp.room.id;
    this.remote = new RemoteCars(mp, drive.world.scene);
    // bumping: the physics' collider query also returns the other cars' spheres
    const T = drive.world.G.T;
    this.terrain = T;
    const world = Object.create(T);
    world.queryColliders = (a, b, c, d, out) => {
      T.queryColliders(a, b, c, d, out);
      this.remote.queryColliders(a, b, c, d, out);
    };
    drive.sim.world = world;
    this.chat = new ChatBox(app.ui, (text) => mp.chat(text), mp.limits?.chat);
    this.banner = el('div', { class: 'mp-banner hidden', onclick: () => this.joinRace() });
    this.standings = el('div', { class: 'mp-standings hidden' });
    app.ui.append(this.banner, this.standings);
    this.offs = [
      mp.on('chat', (m) => this.chat.add(m.name, m.text, m.id === mp.id)),
      mp.on('peerJoin', (m) => this.chat.system(`${m.name} joined.`)),
      mp.on('peerLeave', (m) => m.name && this.chat.system(`${m.name} left.`)),
      mp.on('raceInvite', (m) => this.onInvite(m.race)),
      mp.on('raceEnd', (m) => this.onRaceEnd(m.race)),
      mp.on('error', (m) => app.toast(m.msg, 3500)),
      mp.on('close', () => this.onClosed()),
    ];
    this.sentAt = 0;
    this.uiT = 0;
    this.raceId = null; // the room race we joined
    this.results = null; // { race, until } after a race ended
    const keys = bindingsOf(app.settings);
    this.keys = { chat: keyLabel(keys.chat[0]) || 'Y', join: keyLabel(keys.raceJoin[0]) || 'J' };
    this.chat.system(`You are on ${mp.room.name} as ${mp.name}. ${this.keys.chat}: chat. Pick a competition on the map (ESC) and press "Race together" to invite everyone.`);
    this.sendDesign();
    if (mp.race) this.chat.system(`${mp.race.hostName}'s race on ${mp.race.track} is on.`);
  }

  sendDesign() {
    this.mp.sendDesign(serializeDesign(this.drive.design), this.drive.sim.restCom);
  }

  /** A competition of this map by name (built-in or one of ours). */
  _track(name) {
    return this.drive.map.tracks().find((t) => t.name === name) || null;
  }

  get joined() {
    return !!this.raceId && this.mp.race?.id === this.raceId;
  }

  onInvite(race) {
    this.chat.system(`${race.hostName} started a race on ${race.track}. Press ${this.keys.join} to join.`);
    if (race.host === this.mp.id) this.joinRace(true); // the one who started it is in
  }

  /** Join the room's race (optional for everyone): to the start line, countdown to the shared start. */
  joinRace(host = false) {
    const race = this.mp.race;
    if (!race || this.joined) return;
    if (this.mp.serverNow() > race.start) {
      this.drive.app.toast('That race has already started.');
      return;
    }
    const track = this._track(race.track);
    if (!track) {
      this.drive.app.toast(`"${race.track}" isn't one of this map's competitions on your computer.`, 3500);
      return;
    }
    if (!host) this.mp.raceJoin();
    this.raceId = race.id;
    // grid slot: the order of joining (the server's list doesn't have us yet when we join)
    const slot = host ? 0 : race.racers.length;
    this.drive.startRace(track, { mpStart: race.start, slot });
  }

  /** We crossed the finish line of the room race. */
  onFinish(time) {
    if (this.joined) this.mp.raceFinish(time);
  }

  quitRace() {
    if (this.joined) this.mp.raceQuit();
    this.raceId = null;
  }

  onRaceEnd(race) {
    this.results = { race, until: performance.now() + RESULTS_FOR };
    const done = race.racers.filter((r) => r.time !== null).sort((a, b) => a.time - b.time);
    if (done.length) this.chat.system(`Race on ${race.track}: ${done.map((r, i) => `${i + 1}. ${r.name} ${fmtTime(r.time)}`).join(', ')}`);
    if (this.raceId === race.id) this.raceId = null;
  }

  onClosed() {
    this.chat.system('Disconnected from the game server.');
    this.drive.app.toast('Multiplayer: disconnected from the game server.', 4000);
    this.drive.stopMP();
  }

  /** Our physics step is about to run (the other cars' spheres move on from here). */
  beforeStep() {
    this.remote.beginStep(this.drive.sim.time);
  }

  update(dt) {
    const mp = this.mp;
    // paced by the real clock, so frame bursts never flood the server
    const now = performance.now();
    if (now - this.sentAt >= 1000 / SEND_HZ) {
      this.sentAt = now;
      mp.sendState(this.drive.sim);
    }
    this.remote.update(dt);
    this.uiT -= dt;
    if (this.uiT <= 0) {
      this.uiT = 0.25;
      this._updateUI();
    }
  }

  _updateUI() {
    const mp = this.mp;
    const race = mp.race;
    const now = mp.serverNow();
    // invitation banner for those who haven't joined
    const invite = race && !this.joined && now < race.start;
    this.banner.classList.toggle('hidden', !invite);
    if (invite) this.banner.textContent = `${race.hostName} started a race on ${race.track} - press ${this.keys.join} to join (starts in ${Math.ceil((race.start - now) / 1000)} s)`;
    // standings: during a race, and for a while after it
    let show = race;
    if (!show && this.results && performance.now() < this.results.until) show = this.results.race;
    this.standings.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = [...show.racers].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    this.standings.replaceChildren(
      el('div', { class: 'h' }, `${show.track}${race ? '' : ' (finished)'}`),
      ...rows.map((r, i) => el('div', { class: `r ${r.id === mp.id ? 'me' : ''}` }, [
        el('span', `${i + 1}.`),
        el('span', r.name),
        el('span', r.time !== null ? fmtTime(r.time) : race && now < race.start ? 'ready' : 'racing...'),
      ])),
    );
  }

  dispose() {
    for (const off of this.offs) off();
    this.remote.dispose();
    this.chat.dispose();
    this.banner.remove();
    this.standings.remove();
    this.drive.sim.world = this.terrain;
  }
}
