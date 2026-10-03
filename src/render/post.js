// Post-processing chain: MSAA HDR target -> (GTAO) -> bloom -> output (tone map + sRGB).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { settings } from '../core/settings.js';

export class PostFX {
  constructor(renderer, scene, camera, quality = 'high') {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // Settings > Graphics: Antialiasing (MSAA), ambient occlusion and Bloom can be switched off
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' || settings.antialias === false ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.gtao = null;
    if ((quality === 'high' || quality === 'ultra') && settings.ao !== false) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.9;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1, thickness: 1, scale: 1, samples: quality === 'ultra' ? 16 : 8 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
      this.composer.addPass(this.gtao);
    }
    this.bloom = null;
    if (quality !== 'low' && settings.bloom !== false) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.5, 4);
      this.composer.addPass(this.bloom);
    }
    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  setScene(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.gtao) {
      this.gtao.scene = scene;
      this.gtao.camera = camera;
    }
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  render(dt) {
    if (this.bloom) {
      // bloom works on HDR values before exposure: keep only genuinely bright pixels
      const exp = this.renderer.toneMappingExposure || 1;
      this.bloom.threshold = 10 / exp;
    }
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    if (this.gtao) this.gtao.dispose();
    if (this.bloom) this.bloom.dispose();
  }
}
