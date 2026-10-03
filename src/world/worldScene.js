// Assembles a generated world into a three.js scene with sky, cascaded shadows and props.
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { TerrainRenderer, terrainUniforms } from './terrainRender.js';
import { SkySystem } from './sky.js';
import { buildBuildings, buildRocks, buildTrafficLights, buildStreetLamps, buildRamps, buildBoxes, propUniforms } from './props.js';
import { TreeSystem, GrassSystem } from './vegetation.js';

export class WorldScene {
  constructor(renderer, G, camera, settings) {
    this.renderer = renderer;
    this.G = G;
    this.T = G.T;
    this.camera = camera;
    this.settings = settings;
    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.materials = new Set();
    this.sky = new SkySystem(renderer, this.scene);
    this._setupShadows();

    this.terrain = new TerrainRenderer(G);
    this.scene.add(this.terrain.group);
    this.register(this.terrain.material);

    const b = buildBuildings(G.buildings);
    if (b) { this.scene.add(b); this.register(b.material); }
    this.trees = new TreeSystem(G.trees, (m) => this.register(m));
    this.scene.add(this.trees.group);
    this.grass = new GrassSystem(G.T, (m) => this.register(m), {
      radius: settings.quality === 'ultra' ? 60 : settings.quality === 'high' ? 46 : 32,
      spacing: settings.quality === 'ultra' ? 0.6 : 0.75,
    });
    this.grass.enabled = settings.quality !== 'low' && settings.grass !== false;
    this.scene.add(this.grass.mesh);
    const rc = G.map.rockColors?.[1];
    this.rocks = buildRocks(G.rocks, rc ? [rc[0] * 1.15, rc[1] * 1.15, rc[2] * 1.15] : undefined);
    this.scene.add(this.rocks);
    this.scene.add(buildTrafficLights(G.lights));
    this.lamps = buildStreetLamps(G.lamps);
    this.scene.add(this.lamps);
    this.scene.add(buildRamps(G.rampVisuals));
    this.scene.add(buildBoxes(G.boxes));
    this.scene.traverse((o) => {
      if (o.isMesh && o.material && !o.material.isMeshBasicMaterial && !o.material.isShaderMaterial) this.register(o.material);
    });
    // a small pool of point lights that follows the street lamps nearest the camera at night
    this.lampLights = [];
    if (G.lamps.length) {
      for (let i = 0; i < 4; i++) {
        const l = new THREE.PointLight(0xffd7a0, 0, 34, 1.6);
        this.lampLights.push(l);
        this.scene.add(l);
      }
    }
    this.setTime('Noon');
  }

  _updateLampLights(cam) {
    if (!this.lampLights.length) return;
    const night = this.sky.night > 0.15;
    if (!night) {
      for (const l of this.lampLights) l.intensity = 0;
      return;
    }
    const lamps = this.G.lamps;
    const best = [];
    for (const lp of lamps) {
      const d = (lp.x - cam.x) ** 2 + (lp.z - cam.z) ** 2;
      if (best.length < this.lampLights.length || d < best[best.length - 1].d) {
        best.push({ lp, d });
        best.sort((a, b) => a.d - b.d);
        if (best.length > this.lampLights.length) best.pop();
      }
    }
    this.lampLights.forEach((l, i) => {
      const b = best[i];
      if (!b || b.d > 260 * 260) {
        l.intensity = 0;
        return;
      }
      const s = Math.sin(b.lp.rot), c = Math.cos(b.lp.rot);
      // bulb sits 2.2 m along the arm (local +Z) at 7.7 m height
      l.position.set(b.lp.x + s * 2.2, b.lp.y + 7.6, b.lp.z + c * 2.2);
      l.intensity = 260;
    });
  }

  _setupShadows() {
    const q = this.settings.quality;
    const cascades = q === 'low' ? 1 : q === 'medium' ? 2 : 3;
    const size = q === 'ultra' ? 4096 : q === 'low' ? 1024 : 2048;
    this.csm = new CSM({
      maxFar: q === 'low' ? 150 : 600,
      cascades,
      mode: 'practical',
      parent: this.scene,
      shadowMapSize: size,
      lightDirection: this.sky.lightDir,
      camera: this.camera,
      lightIntensity: 3,
      lightNear: 1,
      lightFar: 1400,
      lightMargin: 300,
    });
    this.csm.fade = true;
    // bias is in normalised shadow depth: 1400 m range -> 3e-5 ~ 4 cm
    for (const l of this.csm.lights) {
      l.shadow.bias = -0.00003;
      l.shadow.normalBias = 0.025;
    }
    for (const m of this.materials) this._setupMat(m);
  }

  /** Every lit material in the world must go through CSM (it adds one light per cascade). */
  register(mat) {
    if (!mat || this.materials.has(mat)) return;
    this.materials.add(mat);
    this._setupMat(mat);
  }

  _setupMat(mat) {
    if (!mat.userData.dcbOrigCompile) mat.userData.dcbOrigCompile = mat.onBeforeCompile || null;
    const orig = mat.userData.dcbOrigCompile;
    if (!mat.userData.dcbOrigKey) mat.userData.dcbOrigKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.call(mat) : '';
    const key = mat.userData.dcbOrigKey;
    this.csm.setupMaterial(mat);
    const csmCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      if (orig) orig.call(mat, shader, r);
      csmCompile.call(mat, shader, r);
    };
    mat.customProgramCacheKey = () => `${key}|csm${this.csm.cascades}`;
    mat.needsUpdate = true;
  }

  unregister(mat) {
    if (!this.materials.delete(mat)) return;
    this.csm.shaders.delete(mat);
  }

  setTime(name) {
    this.timeName = name;
    this.sky.setTime(name);
    this.csm.lightDirection.copy(this.sky.lightDir);
    const c = this.sky.lightColor;
    for (const l of this.csm.lights) {
      l.intensity = this.sky.lightIntensity;
      l.color.copy(c);
    }
    const night = this.sky.night;
    terrainUniforms.uNight.value = night;
    propUniforms.uNight.value = night > 0.5 ? 1 : night > 0.15 ? 0.5 : 0;
    const bulb = this.lamps.userData.bulbMat;
    if (bulb) bulb.color.copy(night > 0.15 ? bulb.userData.nightColor : new THREE.Color(0.2, 0.2, 0.2));
  }

  setCamera(camera) {
    this.camera = camera;
    this.csm.camera = camera;
    this.csm.updateFrustums();
  }

  update(dt, camera = this.camera) {
    if (camera !== this.camera) this.setCamera(camera);
    propUniforms.uTime.value += dt;
    this.sky.update(dt, camera);
    const lodQ = this.settings.quality === 'low' ? 0.6 : this.settings.quality === 'ultra' ? 1.5 : 1;
    this.terrain.update(camera.position, lodQ);
    this.trees.update(camera.position, lodQ);
    this.grass.update(camera.position);
    this._updateLampLights(camera.position);
    this.csm.update();
  }

  dispose() {
    this.csm.remove();
    this.csm.dispose();
    this.terrain.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}
