// Main menu: blurred live world in the background, blueprint overlay, logo and menu.
import * as THREE from 'three';
import { el, logoHTML } from './dom.js';
import { MENU_ICONS, blueprintSVG } from './icons.js';
import { alertBox, listBox } from './dialogs.js';
import { settingsDialog } from './settingsDialog.js';
import { CarSim } from '../physics/sim.js';
import { CarRenderer } from '../render/carRenderer.js';
import { PostFX } from '../render/post.js';
import { MAP_LIST, MAPS } from '../world/maps/index.js';

export const VERSION = 'web64.0.1.2026.10.01';

export class MainMenu {
  constructor(app) {
    this.app = app;
    this.t = 0;
  }

  async enter() {
    const app = this.app;
    this.world = await app.loadWorld(app.settings.map);
    this._buildBackground();
    this._buildDOM();
    this.resize(window.innerWidth, window.innerHeight);
  }

  _buildBackground() {
    const app = this.app;
    const w = this.world;
    this.camera = w.camera;
    w.scene.setCamera(this.camera);
    const G = w.G;
    // park the current car near the spawn and let it settle
    this.sim = new CarSim(app.design, G.T, { rate: 1000 });
    const s = G.spawn;
    this.sim.spawn(s.x, s.z, s.heading + 0.6);
    for (let i = 0; i < 90; i++) this.sim.step(1 / 60, { throttle: 0, brake: 1, steer: 0, handbrake: 1, boost: 0, reverse: false });
    this.car = new CarRenderer(app.design, { mode: 'drive', register: (m) => w.scene.register(m), unregister: (m) => w.scene.unregister(m) });
    this.car.setFromSim(this.sim);
    w.scene.scene.add(this.car.group);
    this.post = new PostFX(app.renderer, w.scene.scene, this.camera, app.settings.quality === 'ultra' ? 'high' : app.settings.quality);
    app.canvas.style.filter = 'blur(9px) brightness(0.55) sepia(0.28) saturate(0.9)';
  }

  _disposeBackground() {
    const scene = this.world.scene.scene;
    scene.remove(this.car.group);
    this.car.dispose();
    this.post.dispose();
    this.app.canvas.style.filter = '';
  }

  _buildDOM() {
    const app = this.app;
    const item = (label, icon, fn) => el('div', { class: 'item', onclick: fn }, [el('span', label), el('span', { class: 'mi', html: icon || '' })]);
    this.mapLine = el('div', { class: 'map-line' }, [el('span', 'Map:'), el('span', MAPS[this.world.key].name)]);
    this.root = el('div', { class: 'screen main-menu' }, [
      el('div', { class: 'menu-bg' }),
      el('div', { class: 'menu-blueprint', html: blueprintSVG() }),
      el('div', { class: 'logo', html: logoHTML() }),
      this.mapLine,
      el('div', { class: 'items' }, [
        item('Sandbox', MENU_ICONS.sandbox, () => this.sandbox()),
        item('Multiplayer (beta)', MENU_ICONS.multiplayer, () => this.multiplayer()),
        item('Single player', MENU_ICONS.single, () => this.singlePlayer()),
        item('Map', MENU_ICONS.map, () => this.chooseMap()),
        item('Settings', MENU_ICONS.settings, () => settingsDialog(app.ui, (changed) => this.onSettings(changed))),
        item('Exit', '', () => alertBox(app.ui, 'Exit', 'This remake runs in your browser: close the tab to exit. Your cars and settings are saved automatically.')),
      ]),
      el('div', { class: 'foot-left' }, [
        el('a', { onclick: () => this.credits() }, 'Credits'),
        el('a', { href: 'https://dreamcarbuilder.com', target: '_blank', rel: 'noopener' }, 'DreamCarBuilder.com'),
      ]),
      el('div', { class: 'foot-right', onclick: () => this.bug() }, 'Found a bug...'),
      el('div', { class: 'version' }, VERSION),
    ]);
    app.ui.appendChild(this.root);
    this._onKey = (e) => {
      if (e.key === 'Enter') this.sandbox();
    };
    window.addEventListener('keydown', this._onKey);
  }

  async exit() {
    window.removeEventListener('keydown', this._onKey);
    this.root.remove();
    this._disposeBackground();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.world.scene.csm.updateFrustums();
    const s = this.app.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(s.x, s.y);
  }

  async sandbox() {
    this.app.setMode('sandbox');
    const { GarageScreen } = await import('../editor/garage.js');
    await this.app.setScreen(new GarageScreen(this.app));
  }

  /** Multiplayer (beta): everyone on this site; pick a game server, drive on its map. */
  async multiplayer() {
    const { serversDialog, enterRoom } = await import('./serversDialog.js');
    const room = await serversDialog(this.app);
    if (room) await enterRoom(this.app, room);
  }

  /** Single player: a garage with coins earned by racing competitions. */
  async singlePlayer() {
    const app = this.app;
    app.setMode('career');
    if (!app.profile.races()) {
      await alertBox(app.ui, 'Single player', `You start with a starter buggy and <b>${app.profile.coins(app.design)} coins</b>. Engines, wheels, jets and the seat cost coins to upgrade: select one in the garage and click its level bar. Higher levels also raise the car's length limit; a longer car gets heavier.<br><br>Race on the Default map to earn coins: every finish pays the track's prize, and each blue opponent car you beat pays the coins shown above it (once). New tracks open as your engine level grows.`);
    }
    const { GarageScreen } = await import('../editor/garage.js');
    await app.setScreen(new GarageScreen(app));
  }

  async chooseMap() {
    const app = this.app;
    const key = await listBox(app.ui, 'Map', MAP_LIST.map((m) => ({ label: m.label, meta: `${MAPS[m.key].size} m`, value: m.key })));
    if (!key || key === this.world.key) return;
    this._disposeBackground();
    this.root.classList.add('hidden');
    this.world = await app.loadWorld(key);
    this._buildBackground();
    this.mapLine.lastChild.textContent = MAPS[key].name;
    this.root.classList.remove('hidden');
    this.resize(window.innerWidth, window.innerHeight);
  }

  /** Rebuild what the settings affect; a profile switch reloads the menu with that profile's car. */
  async onSettings(changed) {
    if (changed.includes('profile')) {
      await this.app.setScreen(new MainMenu(this.app));
      return;
    }
    if (changed.some((k) => ['quality', 'antialias', 'bloom', 'ao'].includes(k))) {
      this.post.dispose();
      this.post = new PostFX(this.app.renderer, this.world.scene.scene, this.camera, this.app.settings.quality === 'ultra' ? 'high' : this.app.settings.quality);
      this.resize(window.innerWidth, window.innerHeight);
    }
  }

  credits() {
    alertBox(this.app.ui, 'Credits', 'A modern fan remake inspired by <b>Dream Car Builder</b>.<br><br>Engine: three.js, Vite. Physics: XPBD node-beam solver with a brush tire model. All terrain, textures, models and sounds are generated procedurally at startup.<br><br>Built with Claude Code.');
  }

  bug() {
    alertBox(this.app.ui, 'Found a bug...', 'Write it down in your Obsidian vault under <b>Projects / Dream Car Builder / Roadmap</b> and ask Claude to fix it next session.');
  }

  update(dt) {
    this.t += dt;
    const c = this.sim.com;
    const a = this.t * 0.06 + 2.3;
    const r = 7.5;
    const T = this.world.G.T;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    this.camera.position.set(x, Math.max(T.heightAt(x, z) + 1.2, c.y + 1.4), z);
    this.camera.lookAt(c.x, c.y + 0.3, c.z);
    this.world.scene.update(dt, this.camera);
  }

  render(dt) {
    this.post.render(dt);
  }
}
