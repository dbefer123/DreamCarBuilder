// Application shell: renderer, world cache, screens and the main loop.
import * as THREE from 'three';
import { settings, saveSettings } from './core/settings.js';
import { storage } from './core/storage.js';
import { profiles, career } from './core/profile.js';
import { Input } from './core/input.js';
import { MAPS, DEFAULT_MAP } from './world/maps/index.js';
import { generateWorld } from './world/generate.js';
import { WorldScene } from './world/worldScene.js';
import { defaultDesign, starterDesign } from './car/presets.js';
import { mp } from './net/mp.js';
import { el, logoHTML } from './ui/dom.js';

export class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.ui = document.getElementById('ui');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: settings.antialias !== false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = settings.shadows !== false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applyPixelRatio();
    this.input = new Input(window);
    this.settings = settings;
    this.storage = storage;
    this.world = null;
    this.worldKey = null;
    this.screen = null;
    this.profiles = profiles;
    this.profile = career; // Single player progress of the active profile
    this.mode = 'sandbox'; // 'sandbox' (free upgrades) | 'career' (Single player: coins)
    this.mp = mp; // multiplayer connection (Game servers)
    this.design = storage.loadCurrent() || defaultDesign();
    this.size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', () => this.onResize());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  applyPixelRatio() {
    const pr = Math.min(window.devicePixelRatio || 1, 2) * (settings.renderScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  onResize() {
    this.size.set(window.innerWidth, window.innerHeight);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.screen?.resize?.(window.innerWidth, window.innerHeight);
  }

  saveSettings() {
    saveSettings();
  }

  setDesign(d, persist = true) {
    this.design = d;
    if (!persist) return;
    if (this.mode === 'career') career.saveCar(d);
    else storage.saveCurrent(d);
  }

  /** Switch between Sandbox and Single player; each keeps its own car. */
  setMode(mode) {
    this.mode = mode;
    if (mode === 'career') this.design = career.car() || starterDesign();
    else this.design = storage.loadCurrent() || defaultDesign();
  }

  /** Switch to another profile (its cars, tracks and progress). */
  selectProfile(id) {
    this.screen?.flushSave?.(); // pending garage edits belong to the old profile
    if (!profiles.select(id)) return;
    this.setMode(this.mode);
  }

  // ---------------- world ----------------
  /** Graphics settings that are baked into the world scene (shadow cascades, grass) changed. */
  invalidateWorldScene() {
    this.worldDirty = true;
  }

  /** Generate (or reuse) a map. remember: false keeps the Sandbox map choice (Single player). */
  async loadWorld(key = settings.map, camera, { remember = true } = {}) {
    if (!MAPS[key]) key = DEFAULT_MAP;
    if (this.world && this.worldKey === key && !this.worldDirty) return this.world;
    if (this.world && this.worldKey === key && this.worldDirty) {
      // rebuild only the scene from the already generated world
      this.worldDirty = false;
      const G = this.world.G;
      this.world.scene.dispose();
      const cam = this.world.camera;
      const scene = new WorldScene(this.renderer, G, cam, settings);
      scene.setTime(settings.time);
      this.world = { ...this.world, scene };
      return this.world;
    }
    this.worldDirty = false;
    const loading = this.showLoading(`Loading ${MAPS[key].name}`);
    try {
      if (this.world) {
        this.world.scene.dispose();
        this.world = null;
      }
      const G = await generateWorld(MAPS[key], (p, label) => loading.set(p * 0.85, label));
      loading.set(0.9, 'Building scene');
      await new Promise((r) => setTimeout(r, 0));
      const cam = camera || new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 9000);
      const scene = new WorldScene(this.renderer, G, cam, settings);
      scene.setTime(settings.time);
      loading.set(0.97, 'Compiling shaders');
      await new Promise((r) => setTimeout(r, 0));
      try {
        this.renderer.compile(scene.scene, cam);
      } catch (e) {
        console.warn('precompile failed', e);
      }
      this.world = { G, scene, key, camera: cam, tracks: G.tracks };
      this.worldKey = key;
      if (remember) {
        settings.map = key;
        saveSettings();
      }
      return this.world;
    } finally {
      loading.close();
    }
  }

  showLoading(title) {
    const bar = el('div');
    const label = el('div', { class: 'label' }, title);
    const root = el('div', { class: 'loading' }, [
      el('div', { class: 'logo', html: logoHTML() }),
      el('div', { class: 'bar' }, [bar]),
      label,
    ]);
    this.ui.appendChild(root);
    return {
      set: (p, text) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        if (text) label.textContent = `${title}: ${text}…`;
      },
      close: () => root.remove(),
    };
  }

  toast(text, ms = 2200) {
    const t = el('div', { class: 'toast' }, text);
    this.ui.appendChild(t);
    setTimeout(() => (t.style.opacity = '0'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  // ---------------- screens ----------------
  async setScreen(screen) {
    const prev = this.screen;
    this.screen = null; // nothing updates/renders while the next screen loads
    if (prev) await prev.exit?.();
    await screen.enter?.();
    this.screen = screen;
  }

  start() {
    let last = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      // V Sync off = frame limiter (browsers always present on vsync)
      if (!settings.vsync && settings.frameLimit > 0 && now - last < 1000 / settings.frameLimit - 1) return;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (this.screen) {
        this.screen.update?.(dt);
        this.screen.render?.(dt);
      }
      this.input.endFrame();
    };
    loop();
  }
}
