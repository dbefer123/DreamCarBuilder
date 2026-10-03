// Driving screen: physics + car visuals + camera + HUD + races + effects + audio.
import * as THREE from 'three';
import { CarSim } from '../physics/sim.js';
import { ArcadeControls } from '../physics/controls.js';
import { CarRenderer } from '../render/carRenderer.js';
import { PostFX } from '../render/post.js';
import { DriveCamera } from './camera.js';
import { HUD } from './hud.js';
import { MapScreen } from './mapScreen.js';
import { Effects } from './effects.js';
import { Race, trackLength } from './race.js';
import { CarAudio } from '../core/audio.js';
import { createMapImage } from '../world/mapImage.js';
import { isModalOpen, alertBox } from '../ui/dialogs.js';
import { settingsDialog } from '../ui/settingsDialog.js';
import { actionForCode } from '../core/bindings.js';
import { actionValue } from '../physics/actions.js';
import { GhostRecorder, GhostCar } from './ghost.js';
import { Bots, botLineup } from './bots.js';
import { MPSession } from './mpSession.js';
import { isTyping } from '../core/input.js';
import { validateDesign, computeStats, engineLevel } from '../car/design.js';
import { el, fmtTime } from '../ui/dom.js';

let sharedAudio = null;

export class DriveScreen {
  constructor(app, world, opts = {}) {
    this.app = app;
    this.world = world;
    this.opts = opts;
    this.camera = world.camera;
    this.paused = false;
    this.slow = false;
    this.race = null;
    this.chosenSpawn = null;
  }

  async enter() {
    const app = this.app;
    const w = this.world;
    const s = app.settings;
    this.camera.fov = s.fov;
    this.camera.near = 0.1;
    this.camera.far = 9000;
    this.camera.updateProjectionMatrix();
    w.scene.setCamera(this.camera);
    this.design = app.design;
    this.career = app.mode === 'career';
    // Single player: a car longer than its length limit gets heavier
    this.stats = computeStats(this.design);
    const massScale = this.career ? this.stats.massScale : 1;
    this.sim = new CarSim(this.design, w.G.T, { rate: s.physicsRate || undefined, abs: s.abs, autoReverse: s.reverseLeft !== false, massScale });
    this.mileage = 0;
    this._applyAssists();
    this.controls = new ArcadeControls();
    this.controls.steerAssist = s.steerAssist;
    this.car = new CarRenderer(this.design, { mode: 'drive', register: (m) => w.scene.register(m), unregister: (m) => w.scene.unregister(m) });
    w.scene.scene.add(this.car.group);
    this.effects = new Effects(w.scene.scene);
    this.post = new PostFX(app.renderer, w.scene.scene, this.camera, s.quality);
    this.cam = new DriveCamera(this.camera, app.canvas);
    this.cam.advance = s.cameraAdvance ?? 1;
    this.cam.attach();
    this.headlights = this._makeHeadlights();
    this.hud = new HUD(app.ui, { settings: () => this.openSettings(), map: () => this.toggleMap() });
    if (!w.mapImage) w.mapImage = createMapImage(w.G, 1024);
    this.mapImage = w.mapImage;
    this.hud.setMapImage(this.mapImage);
    this.map = new MapScreen(this);
    if (!sharedAudio) sharedAudio = new CarAudio(s.volume);
    this.audio = sharedAudio;
    this.audio.setVolume(s.volume);
    this.audio.setChannels(s);
    this.audio.init();
    this.size = this._carSize();
    this._onKey = (e) => this.onKey(e);
    window.addEventListener('keydown', this._onKey);
    this.resize(window.innerWidth, window.innerHeight);
    // multiplayer: we're in a room on this map (players spawn side by side)
    const inRoom = app.mp.room && app.mp.room.map === w.key;
    if (this.opts.track) this.startRace(this.opts.track);
    else this.spawnAt(w.G.spawn, inRoom ? ((app.mp.id % 6) - 2.5) * 4 : 0);
    if (inRoom) this.startMP();
    if (this.opts.openMap && !this.opts.track) {
      this.paused = true;
      this.map.show();
    }
    const issues = validateDesign(this.design);
    if (issues.length) app.toast(issues[0], 4000);
  }

  async exit() {
    window.removeEventListener('keydown', this._onKey);
    this._saveMileage();
    if (this.mps) {
      // leave the room unless we're moving to another one (the garage can bring us back)
      this.mps.quitRace();
      if (this.app.mp.room?.id === this.mps.roomId) this.app.mp.leave();
      this.stopMP();
    }
    this.cam.detach();
    this.hud.dispose();
    this.map.hide();
    this.audio.silence();
    const scene = this.world.scene.scene;
    scene.remove(this.car.group);
    this.car.dispose();
    this.effects.dispose(scene);
    if (this.race) this.race.dispose(scene);
    this._clearBots();
    this._clearGhost();
    for (const l of this.headlights.lights) scene.remove(l, l.target);
    this.post.dispose();
  }

  _applyAssists() {
    const s = this.app.settings;
    this.sim.abs = s.abs;
    this.sim.drivetrain.tractionControl = s.tractionControl;
    this.sim.drivetrain.stabilityControl = s.stability;
    this.sim.drivetrain.manual = s.gearbox === 'manual';
  }

  _carSize() {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const n of this.design.nodes) {
      min = [Math.min(min[0], n.x), Math.min(min[1], n.y), Math.min(min[2], n.z)];
      max = [Math.max(max[0], n.x), Math.max(max[1], n.y), Math.max(max[2], n.z)];
    }
    return Math.max(2, max[0] - min[0], max[2] - min[2]);
  }

  _makeHeadlights() {
    const scene = this.world.scene.scene;
    const lights = [];
    // headlight nodes (Point Settings); cars without any get two automatic lamps
    const nodes = this.design.nodes.filter((n) => n.light?.type === 'headlight').slice(0, 4);
    const specs = nodes.length ? nodes.map((n) => ({ id: n.id, light: n.light })) : [-1, 1].map((side) => ({ side }));
    for (const sp of specs) {
      const L = sp.light || { length: 90, intensity: 1, vAngle: -5, hAngle: 0 };
      // decay 1 keeps the ground right in front of a low lamp from blowing out; ~3 lux at 25 m
      const l = new THREE.SpotLight(0xfff2dd, 0, Math.max(5, L.length * 1.5), 0.42, 0.5, 1);
      l.castShadow = false;
      l.userData = { ...sp, L };
      scene.add(l, l.target);
      lights.push(l);
    }
    return { lights, on: false };
  }

  _updateHeadlights() {
    const night = this.world.scene.sky.night;
    const on = night > 0.15;
    const sim = this.sim;
    const c = sim.controls;
    this.car.setLightState({
      headlights: on,
      brake: c.brake > 0.05 && Math.abs(sim.speed) > 0.3 ? 1 : 0,
      reverse: sim.drivetrain.gear === -1 ? 1 : 0,
      time: sim.time,
    });
    let fx = 0;
    for (const n of this.design.nodes) fx = Math.max(fx, n.x);
    const f = sim.fwd, r = sim.right, u = sim.up;
    for (const l of this.headlights.lights) {
      const { side, id, L } = l.userData;
      l.intensity = on ? 70 * (L.intensity ?? 1) : 0;
      if (!on) continue;
      let p;
      if (id !== undefined) {
        const i = sim.index.get(id);
        p = new THREE.Vector3(sim.px[i], sim.py[i], sim.pz[i]);
      } else {
        const off = fx - sim.restCom.x;
        p = new THREE.Vector3(sim.com.x + f.x * off + r.x * side * 0.55 + u.x * 0.2, sim.com.y + f.y * off + r.y * side * 0.55 + u.y * 0.2, sim.com.z + f.z * off + r.z * side * 0.55 + u.z * 0.2);
      }
      l.position.copy(p);
      // aim: horizontal angle turns right (+), vertical angle tilts up (+)
      const h = ((L.hAngle || 0) * Math.PI) / 180, v = ((L.vAngle ?? -5) * Math.PI) / 180;
      const ch = Math.cos(h) * Math.cos(v), sh = Math.sin(h) * Math.cos(v), sv = Math.sin(v);
      const dx = f.x * ch + r.x * sh + u.x * sv, dy = f.y * ch + r.y * sh + u.y * sv, dz = f.z * ch + r.z * sh + u.z * sv;
      l.target.position.set(p.x + dx * 20, p.y + dy * 20, p.z + dz * 20);
      l.target.updateMatrixWorld();
    }
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.world.scene.csm.updateFrustums();
    const s = this.app.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(s.x, s.y);
    this.effects.setViewport(s.y);
  }

  // ---------------- spawning / races ----------------
  /** Spawn at p, `side` metres to the side of its heading (multiplayer start grids). */
  spawnAt(p, side = 0) {
    const h = p.heading ?? 0;
    p = { ...p, x: p.x + Math.sin(h) * side, z: p.z + Math.cos(h) * side };
    this.sim.spawn(p.x, p.z, h);
    this.lastSpawn = { ...p };
    this.controls.reset();
    this.effects.clear();
    this.cam.snap();
    this.car.setFromSim(this.sim);
  }

  respawn(chosen = false) {
    if (chosen && this.chosenSpawn) {
      this.spawnAt(this.chosenSpawn);
    } else if (this.race && this.race.state !== 'finished') {
      // respawn at the last passed checkpoint (with a penalty)
      const i = this.race.next - 1;
      const cp = i >= 0 ? this.race.track.checkpoints[i] : null;
      this.spawnAt(cp ? { x: cp.x, z: cp.z, heading: cp.dir } : this.race.track.start);
      this.race.respawned();
    } else {
      const safe = this.sim.lastSafe;
      this.spawnAt(safe ? { x: safe.x, z: safe.z, heading: safe.heading } : this.lastSpawn);
    }
  }

  /** Single player competition (a Default-map track with a prize)? */
  isCareerTrack(track) {
    return this.career && !!track?.sp;
  }

  /** Single player: the track needs a higher engine level than the car has. */
  lockedTrack(track) {
    return this.isCareerTrack(track) && engineLevel(this.design) < track.sp.engineLevel;
  }

  trackKey(track) {
    return `${this.world.key}/${track.name}`;
  }

  /**
   * Start a competition. opts.mpStart: server time of a multiplayer race-together start
   * (the countdown runs until then).
   */
  startRace(track, opts = {}) {
    if (this.lockedTrack(track)) {
      this.app.toast(`This track opens at engine level ${track.sp.engineLevel}.`);
      return;
    }
    if (!opts.mpStart) this.mps?.quitRace();
    this.map.hide();
    const scene = this.world.scene.scene;
    if (this.race) this.race.dispose(scene);
    this.race = new Race(track, this.world.G, this.world.key, this.app.storage);
    if (opts.mpStart) {
      this.race.mpStart = opts.mpStart;
      this.race.countdown = (opts.mpStart - this.app.mp.serverNow()) / 1000;
    }
    scene.add(this.race.group);
    // Single player opponents
    this._clearBots();
    if (this.isCareerTrack(track)) {
      this.bots = new Bots(track, this.world.G.T, { defeated: this.app.profile.defeated(this.trackKey(track)), register: (m) => this.world.scene.register(m) });
      scene.add(this.bots.group);
    }
    this.botClock = 0;
    // best-run ghost: record this run, replay the stored best one
    this._clearGhost();
    this.recorder = new GhostRecorder(this.design, this.sim.restCom);
    const best = this.app.settings.showGhost ? this.app.storage.ghost(this.world.key, track.name) : null;
    if (best) {
      try {
        this.ghost = new GhostCar(best, { label: this.career });
        scene.add(this.ghost.group);
      } catch {
        this.ghost = null;
      }
    }
    if (track.time && track.time !== this.world.scene.timeName) this.setTime(track.time);
    // race together: a start grid, alternating left and right of the line
    const slot = opts.slot || 0;
    this.spawnAt(track.start, slot ? (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 3.6 : 0);
    this.paused = false;
  }

  restartRace() {
    if (this.race) this.startRace(this.race.track);
  }

  _clearGhost() {
    if (this.ghost) this.ghost.dispose(this.world.scene.scene);
    this.ghost = null;
  }

  _clearBots() {
    if (this.bots) this.bots.dispose(this.world.scene.scene);
    this.bots = null;
  }

  /** Single player mileage is collected while driving and saved now and then. */
  _saveMileage() {
    if (this.career && this.mileage > 1) this.app.profile.addMileage(this.mileage);
    this.mileage = 0;
  }

  // ---------------- multiplayer ----------------
  startMP() {
    if (!this.mps) this.mps = new MPSession(this);
  }

  stopMP() {
    this.mps?.dispose();
    this.mps = null;
  }

  /** Map screen > Multiplayer > Connect...: pick a game server (loads its map). */
  async mpConnect() {
    const { serversDialog, enterRoom } = await import('../ui/serversDialog.js');
    const room = await serversDialog(this.app);
    if (!room) {
      if (this.map.open) this.map.render();
      return;
    }
    await enterRoom(this.app, room);
  }

  /** Map screen > Multiplayer > Logout...: leave the room and disconnect. */
  mpLogout() {
    this.mps?.quitRace();
    this.stopMP();
    this.app.mp.leave();
    this.app.mp.disconnect();
    if (this.map.open) this.map.render();
  }

  freeRide() {
    this.mps?.quitRace();
    this._clearGhost();
    this._clearBots();
    this.recorder = null;
    if (this.race) {
      this.race.dispose(this.world.scene.scene);
      this.race = null;
    }
    this.closeMap();
  }

  setTime(name) {
    this.world.scene.setTime(name);
    this.app.settings.time = name;
    this.app.saveSettings();
  }

  // ---------------- UI ----------------
  toggleMap() {
    if (this.map.open) this.closeMap();
    else {
      this.paused = true;
      this.map.show();
    }
  }

  closeMap() {
    this.map.hide();
    this.paused = false;
  }

  async openSettings() {
    this.paused = true;
    await settingsDialog(this.app.ui, (changed) => {
      const s = this.app.settings;
      if (changed.includes('profile')) {
        this.exitToGarage();
        return;
      }
      if (changed.includes('quality')) {
        this.app.toast('Shadow and grass quality apply the next time the map loads (e.g. after the garage).');
        this.post.dispose();
        this.post = new PostFX(this.app.renderer, this.world.scene.scene, this.camera, s.quality);
        this.resize(window.innerWidth, window.innerHeight);
      }
      if (changed.includes('renderScale')) {
        this.app.applyPixelRatio();
        this.resize(window.innerWidth, window.innerHeight);
      }
      if (changed.includes('fov')) {
        this.camera.fov = s.fov;
        this.camera.updateProjectionMatrix();
        this.world.scene.csm.updateFrustums();
      }
      if (changed.includes('physicsRate')) {
        this.sim.rate = s.physicsRate || this.sim.seatPart?.physics || 2000;
        this.sim.maxSubsteps = Math.ceil(this.sim.rate / 20);
      }
      if (changed.some((k) => ['antialias', 'bloom', 'ao'].includes(k)) && !changed.includes('quality')) {
        this.post.dispose();
        this.post = new PostFX(this.app.renderer, this.world.scene.scene, this.camera, s.quality);
        this.resize(window.innerWidth, window.innerHeight);
      }
      this.cam.advance = s.cameraAdvance ?? 1;
      if (changed.includes('showGhost') && !s.showGhost) this._clearGhost();
      this.controls.steerAssist = s.steerAssist;
      this._applyAssists();
      this.audio.setVolume(s.volume);
      this.audio.setChannels(s);
    });
    if (!this.map.open) this.paused = false;
    else this.map.render();
  }

  async exitToGarage() {
    const { GarageScreen } = await import('../editor/garage.js');
    await this.app.setScreen(new GarageScreen(this.app));
  }

  onKey(e) {
    if (isModalOpen() || isTyping(e)) return;
    const code = e.code;
    const act = actionForCode(this.app.settings, code);
    if (this.mps && !this.map.open && (act === 'chat' || act === 'raceJoin')) {
      e.preventDefault();
      if (act === 'chat') this.mps.chat.open();
      else this.mps.joinRace();
      return;
    }
    if (code === 'Escape' || act === 'map') {
      e.preventDefault();
      if (this.map.editing) {
        this.map.editing = null;
        this.map.render();
        return;
      }
      this.toggleMap();
    } else if (code === 'F1') {
      e.preventDefault();
      this.openSettings();
    } else if (act === 'garage') {
      this.exitToGarage();
    } else if (this.map.open) {
      if (act === 'freeRide') this.freeRide();
      if (act === 'respawn' && !e.shiftKey) { this.closeMap(); this.respawn(true); }
      if (act === 'respawn' && e.shiftKey) this.restartRace();
    } else if (act === 'respawn') {
      if (e.shiftKey) this.restartRace();
      else this.respawn(!!this.chosenSpawn && !this.race);
    } else if (act === 'freeRide') {
      this.freeRide();
    } else if (act === 'cameraReset') {
      this.cam.reset();
    } else if (act === 'camera') {
      this.cam.cycle();
    } else if (act === 'slowMotion') {
      if (this.race && this.race.track.restrictions?.disableSlowMotion) this.app.toast('Slow motion is disabled on this track.');
      else this.slow = !this.slow;
    } else if (code === 'Enter' && this.race && this.race.state === 'finished') {
      this.restartRace();
    }
  }

  // ---------------- loop ----------------
  update(dt) {
    const w = this.world;
    const sim = this.sim;
    const input = this.app.input;
    if (!this.paused && !isModalOpen()) {
      const raw = input.driving();
      let c = this.controls.update(dt, raw, sim);
      let simDt = this.slow ? dt * 0.25 : dt;
      if (this.race) {
        // race together: count down to the start on the server's clock
        if (this.race.mpStart && this.race.state === 'countdown') this.race.countdown = (this.race.mpStart - this.app.mp.serverNow()) / 1000;
        const res = this.race.update(dt, sim);
        if (res.hold) c = { ...c, throttle: 0, brake: 1, reverse: false };
        if (this.race.state === 'running' && this.recorder) this.recorder.sample(this.race.time, sim);
        if (this.ghost) this.ghost.update(this.race.state === 'countdown' ? 0 : this.race.time);
        if (this.bots) {
          // opponents keep driving after you finish
          this.botClock = this.race.state === 'countdown' ? 0 : this.race.state === 'finished' ? this.botClock + dt : this.race.time;
          this.bots.update(this.botClock, dt);
        }
        if (res.finished) {
          if (this.race.newBest && this.recorder) this.app.storage.saveGhost(this.world.key, this.race.track.name, this.recorder.toJSON(this.race.final));
          if (this.race.mpStart) this.mps?.onFinish(this.race.final);
          this.showResult();
        }
        if (this.race.state === 'finished') c = { ...c, throttle: 0, brake: Math.max(c.brake, 0.4) };
      }
      this.mps?.beforeStep();
      sim.step(simDt, c);
      if (this.career) {
        this.mileage += Math.abs(sim.speed) * simDt;
        if (this.mileage > 500) this._saveMileage();
      }
      if (sim.hit) {
        this.audio.impact(Math.min(1.5, sim.hit / 30));
        sim.hit = 0;
      }
      this.effects.update(simDt, sim, w.G.T);
    }
    this.car.setFromSim(sim);
    // other players keep moving while we're paused
    this.mps?.update(dt);
    this.hud.others = this.mps ? this.mps.remote.positions() : null;
    this.cam.update(dt, sim, this.size, w.G.T);
    this._updateHeadlights();
    w.scene.update(dt, this.camera);
    this.effects.setLight(Math.max(0.15, 1 - w.scene.sky.night * 0.85));
    this.hud.update(dt, sim, this.app.settings.units, this.race, this.slow, this.race && this.isCareerTrack(this.race.track));
    let squeal = 0, gravel = 0;
    for (const wh of sim.wheels) {
      if (!wh.contact) continue;
      if (wh.surface.skid) squeal += Math.max(0, wh.slipVel - 2);
      else gravel += Math.abs(wh.vLong) * wh.surface.dust;
    }
    this.audio.update({
      rpm: sim.rpm,
      load: sim.drivetrain.load * (sim.controls.boostActive ? 1.3 : 1),
      power: sim.totalPowerHp,
      speed: Math.hypot(sim.vel.x, sim.vel.y, sim.vel.z),
      squeal,
      gravel,
      paused: this.paused,
      horn: actionValue(sim.controls, sim.seatPart?.hornKey || 'horn') > 0,
    });
  }

  showResult() {
    const r = this.race;
    const lines = [`Time: <b>${fmtTime(r.final)}</b>`];
    if (r.penalties) lines.push(`Penalties: ${r.penalties} × ${r.track.restrictions?.penalty ?? 5} s`);
    lines.push(r.newBest ? 'New best time!' : `Best: ${fmtTime(r.best)}`);
    if (this.isCareerTrack(r.track)) {
      // coins: the finish prize, plus every opponent beaten for the first time
      this._saveMileage();
      const lineup = botLineup(r.track);
      const a = this.app.profile.award({ trackKey: this.trackKey(r.track), prize: r.track.sp.prize, bots: lineup, time: r.final, length: trackLength(r.track) });
      for (const i of a.beaten) this.bots?.setBeaten(i);
      const coin = '<span class="coin"></span>';
      const place = 1 + lineup.filter((b) => b.time < r.final).length;
      lines.push(`Place: <b>${place} / ${lineup.length + 1}</b>`);
      lines.push(...a.lines.map(([t, c]) => `${t}: <span style="color:#7ee07f">+${c} c.</span>`));
      const before = this.app.profile.defeated(this.trackKey(r.track)).length - a.beaten.length;
      if (before) lines.push(`<span style="color:#aab2bb">${before} opponent${before > 1 ? 's' : ''} beaten before (paid once).</span>`);
      lines.push(`Total: <b style="color:#7ee07f">+${a.total} c.</b> &nbsp; You have: ${coin}<b>${this.app.profile.coins(this.design)} c.</b>`);
    }
    if (r.mpStart) lines.push('Race together: the standings are at the top right.');
    lines.push('<span style="color:#aab2bb">Press Enter or Shift+R to race again, F for free ride.</span>');
    alertBox(this.app.ui, `${r.track.name}: finished`, lines.join('<br>'));
  }

  render(dt) {
    this.post.render(dt);
  }
}

export { el };
