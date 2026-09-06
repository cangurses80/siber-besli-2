import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RENDER_CONFIG, isMobileQuality } from './config.js';

export function createRenderPipeline(canvas, scene, camera) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobileQuality(),
    powerPreference: 'high-performance',
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER_CONFIG.renderer.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    RENDER_CONFIG.bloom.strength,
    RENDER_CONFIG.bloom.radius,
    RENDER_CONFIG.bloom.threshold,
  );
  const outputPass = new OutputPass();
  const composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const mobile = isMobileQuality();
    const cap = mobile
      ? RENDER_CONFIG.renderer.pixelRatioCapMobile
      : RENDER_CONFIG.renderer.pixelRatioCapDesktop;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, cap);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    const bloomScale = mobile ? RENDER_CONFIG.bloom.mobileResolutionScale : 1;
    bloomPass.setSize(width * pixelRatio * bloomScale, height * pixelRatio * bloomScale);
  }

  function render(activeScene, activeCamera, delta) {
    if (renderPass.scene !== activeScene) renderPass.scene = activeScene;
    if (renderPass.camera !== activeCamera) renderPass.camera = activeCamera;
    composer.render(delta);
  }

  resize();
  return { renderer, composer, renderPass, bloomPass, outputPass, render, resize };
}
