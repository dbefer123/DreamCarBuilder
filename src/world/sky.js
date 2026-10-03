// Sky dome (physical sky + clouds), sun/moon direction, stars, environment map and
// time-of-day presets.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const TIMES = {
  Dawn: { elev: 3, azim: 95, sun: 2.4, sunColor: '#ffb27a', exposure: 0.95, turbidity: 6, rayleigh: 2.6, fog: '#8e98a6', fogDensity: 0.00032, clouds: 0.35, night: 0.25, env: 0.28 },
  Morning: { elev: 22, azim: 120, sun: 4.6, sunColor: '#fff0dc', exposure: 0.64, turbidity: 3, rayleigh: 1.4, fog: '#b3c3d6', fogDensity: 0.00018, clouds: 0.45, night: 0, env: 0.16 },
  Noon: { elev: 58, azim: 170, sun: 5.4, sunColor: '#fffaf0', exposure: 0.6, turbidity: 2.5, rayleigh: 1.2, fog: '#b7c8db', fogDensity: 0.00015, clouds: 0.4, night: 0, env: 0.14 },
  Evening: { elev: 16, azim: 245, sun: 4.2, sunColor: '#ffd9a8', exposure: 0.68, turbidity: 4, rayleigh: 1.8, fog: '#bdb3a7', fogDensity: 0.0002, clouds: 0.5, night: 0, env: 0.17 },
  Sunset: { elev: 2.5, azim: 262, sun: 2.6, sunColor: '#ff9a52', exposure: 0.95, turbidity: 8, rayleigh: 3, fog: '#a08070', fogDensity: 0.00028, clouds: 0.45, night: 0.2, env: 0.25 },
  Night: { elev: -18, azim: 300, sun: 0.0, sunColor: '#9fb4ff', exposure: 1.1, turbidity: 2, rayleigh: 0.6, fog: '#0d1320', fogDensity: 0.0004, clouds: 0.25, night: 1, env: 0.14, moon: 0.4 },
};
export const TIME_LIST = Object.keys(TIMES);

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sky.material.uniforms.cloudScale.value = 0.00022;
    this.sky.material.uniforms.cloudSpeed.value = 0.00003;
    this.sky.material.uniforms.cloudElevation.value = 0.55;
    scene.add(this.sky);
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    this.lightDir = new THREE.Vector3();
    this.stars = this._makeStars();
    scene.add(this.stars);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.envRT = null;
    this.time = 0;
    this.preset = TIMES.Noon;
  }

  _makeStars() {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let x, y, z, l;
      do {
        x = Math.random() * 2 - 1; y = Math.random(); z = Math.random() * 2 - 1;
        l = Math.hypot(x, y, z);
      } while (l > 1 || l < 0.1);
      pos[i * 3] = (x / l) * 4000; pos[i * 3 + 1] = (y / l) * 4000; pos[i * 3 + 2] = (z / l) * 4000;
      const b = 0.4 + Math.random() * 0.6;
      col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b * (0.9 + Math.random() * 0.2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = -9;
    return p;
  }

  setTime(name) {
    const P = TIMES[name] || TIMES.Noon;
    this.preset = P;
    this.name = name;
    const elev = THREE.MathUtils.degToRad(P.elev);
    const az = THREE.MathUtils.degToRad(P.azim);
    // azimuth measured from north (-z) clockwise toward east (+x)
    this.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = P.turbidity;
      u.rayleigh.value = P.rayleigh;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
      u.cloudCoverage.value = P.clouds;
      u.cloudDensity.value = 0.45;
      u.sunPosition.value.copy(this.sunDir);
    }
    this.envSky.material.uniforms.cloudCoverage.value = 0;
    this.stars.material.opacity = P.night;
    // light direction: sun, or the moon at night
    if (P.elev > 0) this.lightDir.copy(this.sunDir).negate();
    else this.lightDir.set(-0.3, -0.8, 0.4).normalize();
    this.scene.fog = new THREE.FogExp2(new THREE.Color(P.fog), P.fogDensity);
    this.renderer.toneMappingExposure = P.exposure;
    this._updateEnv();
  }

  _updateEnv() {
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.preset.env;
  }

  get lightIntensity() {
    const P = this.preset;
    return P.elev > 0 ? P.sun : P.moon || 0.2;
  }

  get lightColor() {
    return new THREE.Color(this.preset.sunColor);
  }

  get night() {
    return this.preset.night;
  }

  update(dt, camera) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.sky.material.uniforms.time.value = this.time;
  }
}
