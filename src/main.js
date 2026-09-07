import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import worldData from './world.json';
import { createRenderPipeline } from './render/pipeline.js';
import { createWorldTextureLibrary } from './render/textures.js';
import { createWorldScene } from './scene/worldScene.js';

const canvas = document.querySelector('#world-canvas');
const modeButton = document.querySelector('#camera-mode');
const modeLabel = document.querySelector('#camera-mode-label');
const modeIcon = modeButton.querySelector('.mode-button__icon');
const modeTitle = document.querySelector('#mode-title');
const lockedToast = document.querySelector('#locked-toast');
const islandCard = document.querySelector('#island-card');
const islandName = document.querySelector('#island-name');
const difficulty = document.querySelector('#difficulty');
const difficultyDots = document.querySelector('#difficulty-dots');
const loading = document.querySelector('#loading');
const fpsElement = document.querySelector('#fps');
const transitionShade = document.querySelector('#transition-shade');
const islandLabelsContainer = document.querySelector('#island-labels');
const regionLabelsContainer = document.querySelector('#region-labels');

const searchParams = new URLSearchParams(window.location.search);
const debugMode = searchParams.get('debug') === '1';
const cameraPresetId = searchParams.get('cam');
const clock = new THREE.Clock();
const placeholderScene = new THREE.Scene();
const perspectiveCamera = new THREE.PerspectiveCamera(48, 1, 0.1, 1500);
perspectiveCamera.position.set(73, 60, 86);
const regionCamera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1500);
const worldCamera = new THREE.OrthographicCamera(-400, 400, 400, -400, 0.1, 1800);
regionCamera.up.set(0, 0, -1);
worldCamera.up.set(0, 0, -1);

const pipeline = createRenderPipeline(canvas, placeholderScene, perspectiveCamera);
const textures = createWorldTextureLibrary(pipeline.renderer);
const world = createWorldScene({ renderer: pipeline.renderer, textures, data: worldData, debugMode });

const controls = new OrbitControls(perspectiveCamera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 34;
controls.maxDistance = 155;
controls.minPolarAngle = THREE.MathUtils.degToRad(18);
controls.maxPolarAngle = THREE.MathUtils.degToRad(78);
controls.target.copy(world.getIslandPosition(world.selectedIslandId));
controls.update();

const MODES = [
  { id: 'explore', label: 'Gezinti', icon: '◎', regionBlend: 0, worldBlend: 0 },
  { id: 'region', label: 'Bölge Haritası', icon: '◇', regionBlend: 1, worldBlend: 0 },
  { id: 'world', label: 'Dünya Haritası', icon: '⌘', regionBlend: 0.55, worldBlend: 1 },
];
const regionById = new Map(worldData.regions.map((region) => [region.id, region]));
const islandById = new Map(worldData.islands.map((island) => [island.id, island]));
const worldCenter = worldData.regions.reduce(
  (sum, region) => sum.add(new THREE.Vector3(...region.position)),
  new THREE.Vector3(),
).multiplyScalar(1 / worldData.regions.length);
const CAMERA_PRESETS = {
  'gate-top': {
    modeId: 'explore',
    islandId: 'helios-01',
    positionOffset: new THREE.Vector3(28, 68, 30),
    targetOffset: new THREE.Vector3(0, 0.4, 0),
  },
  'zeynep-side': {
    modeId: 'explore',
    islandId: 'helios-01',
    positionOffset: new THREE.Vector3(62, 23, 43),
    targetOffset: new THREE.Vector3(1.5, 3.2, -0.8),
  },
  region: { modeId: 'region' },
  world: { modeId: 'world' },
};

let modeIndex = 0;
let activeCamera = perspectiveCamera;
let cameraTarget = controls.target.clone();
let cameraTransition = null;
let toastTimer = null;
let titleTimer = null;
let currentRegionBlend = 0;
let currentWorldBlend = 0;
let pointerStart = null;
let fpsFrames = 0;
let fpsElapsed = 0;

const islandLabelElements = new Map();
world.activeIslands.forEach((island) => {
  const label = createLabel(island.name, `Zorluk ${island.difficulty}`);
  islandLabelsContainer.append(label);
  islandLabelElements.set(island.id, label);
});
const regionLabelElements = new Map();
worldData.regions.forEach((region, index) => {
  const label = createLabel(region.name, index === 0 ? 'Aktif bölge' : 'Kilitli', index !== 0);
  regionLabelsContainer.append(label);
  regionLabelElements.set(region.id, label);
});

document.body.dataset.mode = MODES[modeIndex].id;
fpsElement.hidden = !debugMode;
updateIslandCard(world.selectedIslandId);
window.__CAMERA_PRESET_READY__ = false;
window.__QA_FRAME_COUNT__ = 0;
resize();
applyCameraPreset(cameraPresetId);

modeButton.addEventListener('click', () => {
  const nextIndex = (modeIndex + 1) % MODES.length;
  beginModeTransition(nextIndex);
});
window.addEventListener('resize', resize, { passive: true });
canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
canvas.addEventListener('pointerup', onPointerUp, { passive: true });
canvas.addEventListener('pointercancel', () => { pointerStart = null; }, { passive: true });

world.ready
  .then(() => {
    loading.classList.add('is-done');
    window.__WORLD_READY__ = true;
  })
  .catch((error) => {
    console.error('[world] Varlıklar yüklenemedi', error);
    loading.textContent = 'Dünya yüklenirken bir sorun oluştu.';
    loading.style.color = '#ffd3b0';
    window.__WORLD_READY__ = false;
  });

window.__WORLD_READY__ = false;
const gl = pipeline.renderer.getContext();
const rendererDebugInfo = gl.getExtension('WEBGL_debug_renderer_info');
window.__WORLD_DIAGNOSTICS__ = {
  threeRevision: THREE.REVISION,
  regionCount: worldData.regions.length,
  islandCount: worldData.islands.length,
  activeIslandInstances: world.activeIslands.length,
  landmarkInstances: world.landmarks.counts,
  islandGeometry: world.geometryDiagnostics,
  bridgeGeometryChecks: world.bridgeGeometryChecks,
  cameraTransitionMilliseconds: 800,
  debugMode,
  cameraPresetId,
  renderer: rendererDebugInfo
    ? gl.getParameter(rendererDebugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER),
};

pipeline.renderer.setAnimationLoop(renderFrame);

function renderFrame() {
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  updateCameraTransition(elapsed);
  if (!cameraTransition && MODES[modeIndex].id === 'explore') {
    controls.enabled = true;
    controls.update();
    cameraTarget.copy(controls.target);
  }
  world.update(cameraPresetId ? 2.25 : elapsed, activeCamera);
  updateLabels();
  updateFps(delta);
  pipeline.render(world.scene, activeCamera, delta);
  window.__QA_FRAME_COUNT__ += 1;
}

function beginModeTransition(nextIndex) {
  if (cameraTransition) return;
  const nextMode = MODES[nextIndex];
  const fromMode = MODES[modeIndex];
  const fromPosition = activeCamera.position.clone();
  const fromTarget = cameraTarget.clone();
  const destination = getCameraDestination(nextMode.id);
  const nextCamera = getCamera(nextMode.id);

  controls.enabled = false;
  nextCamera.position.copy(fromPosition);
  activeCamera = nextCamera;
  modeIndex = nextIndex;
  document.body.dataset.mode = nextMode.id;
  modeLabel.textContent = nextMode.label;
  modeIcon.textContent = nextMode.icon;
  modeButton.setAttribute('aria-label', `Kamera modu: ${nextMode.label}`);
  islandCard.classList.toggle('is-hidden', nextMode.id === 'world');
  showModeTitle(nextMode.label);

  cameraTransition = {
    startedAt: clock.elapsedTime,
    duration: 0.8,
    fromPosition,
    toPosition: destination.position,
    fromTarget,
    toTarget: destination.target,
    fromRegionBlend: currentRegionBlend,
    toRegionBlend: nextMode.regionBlend,
    fromWorldBlend: currentWorldBlend,
    toWorldBlend: nextMode.worldBlend,
    nextModeId: nextMode.id,
    previousModeId: fromMode.id,
  };
}

function focusIsland(islandId) {
  const island = islandById.get(islandId);
  if (!island || island.regionId !== world.activeRegion.id) return;
  world.selectIsland(islandId);
  updateIslandCard(islandId);
  if (MODES[modeIndex].id !== 'explore') return;

  const toTarget = world.getIslandPosition(islandId);
  const offset = perspectiveCamera.position.clone().sub(controls.target);
  if (offset.length() < 36 || offset.length() > 150) offset.set(58, 44, 62);
  const toPosition = toTarget.clone().add(offset);
  controls.enabled = false;
  cameraTransition = {
    startedAt: clock.elapsedTime,
    duration: 0.8,
    fromPosition: perspectiveCamera.position.clone(),
    toPosition,
    fromTarget: cameraTarget.clone(),
    toTarget,
    fromRegionBlend: currentRegionBlend,
    toRegionBlend: 0,
    fromWorldBlend: currentWorldBlend,
    toWorldBlend: 0,
    nextModeId: 'explore',
    previousModeId: 'explore',
  };
}

function updateCameraTransition(elapsed) {
  if (!cameraTransition) return;
  const rawProgress = THREE.MathUtils.clamp(
    (elapsed - cameraTransition.startedAt) / cameraTransition.duration,
    0,
    1,
  );
  const progress = easeInOutCubic(rawProgress);
  activeCamera.position.lerpVectors(
    cameraTransition.fromPosition,
    cameraTransition.toPosition,
    progress,
  );
  cameraTarget.lerpVectors(cameraTransition.fromTarget, cameraTransition.toTarget, progress);
  activeCamera.lookAt(cameraTarget);
  currentRegionBlend = THREE.MathUtils.lerp(
    cameraTransition.fromRegionBlend,
    cameraTransition.toRegionBlend,
    progress,
  );
  currentWorldBlend = THREE.MathUtils.lerp(
    cameraTransition.fromWorldBlend,
    cameraTransition.toWorldBlend,
    progress,
  );
  world.setMapBlend(currentRegionBlend, currentWorldBlend);
  transitionShade.classList.toggle('is-midpoint', rawProgress > 0.28 && rawProgress < 0.72);

  if (rawProgress >= 1) {
    const completedMode = cameraTransition.nextModeId;
    cameraTransition = null;
    transitionShade.classList.remove('is-midpoint');
    if (completedMode === 'explore') {
      controls.target.copy(cameraTarget);
      controls.enabled = true;
      controls.update();
    }
  }
}

function getCameraDestination(modeId) {
  if (modeId === 'region') {
    const target = new THREE.Vector3(8, 3, 16);
    return { position: target.clone().add(new THREE.Vector3(0, 225, 0)), target };
  }
  if (modeId === 'world') {
    const target = worldCenter.clone();
    return { position: target.clone().add(new THREE.Vector3(0, 680, 0)), target };
  }
  const target = world.getIslandPosition(world.selectedIslandId);
  return { position: target.clone().add(new THREE.Vector3(64, 48, 70)), target };
}

function getCamera(modeId) {
  if (modeId === 'region') return regionCamera;
  if (modeId === 'world') return worldCamera;
  return perspectiveCamera;
}

function applyCameraPreset(presetId) {
  if (!presetId) {
    window.__CAMERA_PRESET_READY__ = null;
    return;
  }
  const preset = CAMERA_PRESETS[presetId];
  if (!preset) {
    console.warn(`[camera-preset] Bilinmeyen preset: ${presetId}`);
    window.__CAMERA_PRESET_READY__ = 'invalid';
    return;
  }

  const nextIndex = MODES.findIndex((mode) => mode.id === preset.modeId);
  const mode = MODES[nextIndex];
  modeIndex = nextIndex;
  activeCamera = getCamera(mode.id);
  cameraTransition = null;
  currentRegionBlend = mode.regionBlend;
  currentWorldBlend = mode.worldBlend;

  if (preset.islandId) {
    const islandPosition = world.getIslandPosition(preset.islandId);
    cameraTarget.copy(islandPosition).add(preset.targetOffset);
    activeCamera.position.copy(islandPosition).add(preset.positionOffset);
  } else {
    const destination = getCameraDestination(mode.id);
    cameraTarget.copy(destination.target);
    activeCamera.position.copy(destination.position);
  }
  activeCamera.lookAt(cameraTarget);
  if (mode.id === 'explore') {
    controls.target.copy(cameraTarget);
    controls.update();
  }

  document.body.dataset.mode = mode.id;
  modeLabel.textContent = mode.label;
  modeIcon.textContent = mode.icon;
  modeButton.setAttribute('aria-label', `Kamera modu: ${mode.label}`);
  islandCard.classList.toggle('is-hidden', mode.id === 'world');
  world.setMapBlend(currentRegionBlend, currentWorldBlend);
  window.__CAMERA_PRESET_READY__ = presetId;
}

function resize() {
  const width = window.innerWidth;
  const height = Math.max(1, window.innerHeight);
  const aspect = width / height;
  perspectiveCamera.aspect = aspect;
  perspectiveCamera.updateProjectionMatrix();
  configureOrthographic(regionCamera, 86, 82, aspect);
  configureOrthographic(worldCamera, 205, 348, aspect);
  pipeline.resize();
}

function configureOrthographic(camera, minimumHalfHeight, requiredHalfWidth, aspect) {
  const halfHeight = Math.max(minimumHalfHeight, requiredHalfWidth / Math.max(0.3, aspect));
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

function onPointerDown(event) {
  pointerStart = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  };
}

function onPointerUp(event) {
  if (!pointerStart || pointerStart.id !== event.pointerId || cameraTransition) {
    pointerStart = null;
    return;
  }
  const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  const elapsed = performance.now() - pointerStart.time;
  pointerStart = null;
  if (movement > 13 || elapsed > 650) return;
  handleWorldTap(event.clientX, event.clientY);
}

function handleWorldTap(clientX, clientY) {
  const raycaster = new THREE.Raycaster();
  const rect = canvas.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, activeCamera);
  const modeId = MODES[modeIndex].id;

  if (debugMode) {
    const debugHits = raycaster.intersectObjects([
      ...world.islandPickMeshes,
      world.rings,
      ...[...world.landmarks.meshes.values()].map(({ mesh }) => mesh),
      ...world.bridgePickMeshes,
      ...world.regionBridgePickMeshes,
    ], false).filter((hit) => hit.object.visible && hit.object.parent?.visible !== false);
    console.info(`[debug-hit] ${JSON.stringify(debugHits.slice(0, 8).map((hit) => ({
      mesh: hit.object.name || hit.object.type,
      bridgeId: hit.object.userData.bridgeVisual?.bridge.id || null,
      instanceId: Number.isInteger(hit.instanceId) ? hit.instanceId : null,
      distance: Number(hit.distance.toFixed(3)),
    })))}`);
    if (cameraPresetId) return;

    const bridgeMeshes = modeId === 'world'
      ? world.regionBridgePickMeshes
      : [...world.bridgePickMeshes, ...world.regionBridgePickMeshes];
    const bridgeHits = raycaster.intersectObjects(bridgeMeshes, false)
      .filter((hit) => hit.object.visible && hit.object.parent?.visible !== false);
    const bridgeVisual = world.getBridgeHit(bridgeHits);
    if (bridgeVisual) {
      bridgeVisual.toggle();
      showToast(`${bridgeVisual.bridge.id}: ${bridgeVisual.state === 'open' ? 'açık' : 'kapalı'}`);
      return;
    }
  }

  if (modeId !== 'world') {
    const islandHit = raycaster.intersectObjects(world.islandPickMeshes, false)[0];
    if (islandHit && Number.isInteger(islandHit.instanceId)) {
      const islandId = islandHit.object.userData.islandIds[islandHit.instanceId];
      focusIsland(islandId);
      return;
    }
  }

  const regionHits = raycaster.intersectObjects([...world.regionNodes.values()], false)
    .filter((hit) => hit.object.visible);
  if (regionHits[0]?.object.userData.locked) showToast('Bu bölge henüz kilitli');
}

function updateIslandCard(islandId) {
  const island = islandById.get(islandId);
  if (!island) return;
  islandName.textContent = island.name;
  difficultyDots.textContent = `${'●'.repeat(island.difficulty)}${'○'.repeat(5 - island.difficulty)}`;
  difficulty.setAttribute('aria-label', `Zorluk: ${island.difficulty} / 5`);
}

function updateLabels() {
  if (MODES[modeIndex].id === 'region') {
    world.activeIslands.forEach((island) => {
      positionLabel(islandLabelElements.get(island.id), world.getIslandPosition(island.id), activeCamera);
    });
  } else if (MODES[modeIndex].id === 'world') {
    worldData.regions.forEach((region) => {
      positionLabel(
        regionLabelElements.get(region.id),
        new THREE.Vector3(...region.position).add(new THREE.Vector3(0, 13, 0)),
        activeCamera,
      );
    });
  }
}

function positionLabel(element, worldPosition, camera) {
  const projected = worldPosition.clone().project(camera);
  const visible = projected.z > -1 && projected.z < 1
    && Math.abs(projected.x) < 1.08 && Math.abs(projected.y) < 1.08;
  element.style.display = visible ? 'block' : 'none';
  if (!visible) return;
  element.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`;
  element.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`;
}

function createLabel(title, subtitle, locked = false) {
  const element = document.createElement('span');
  element.className = `world-label${locked ? ' is-locked' : ''}`;
  const titleNode = document.createTextNode(title);
  const small = document.createElement('small');
  small.textContent = subtitle;
  element.append(titleNode, small);
  return element;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  lockedToast.textContent = message;
  lockedToast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => lockedToast.classList.remove('is-visible'), 1250);
}

function showModeTitle(label) {
  window.clearTimeout(titleTimer);
  modeTitle.textContent = label;
  modeTitle.classList.add('is-visible');
  titleTimer = window.setTimeout(() => modeTitle.classList.remove('is-visible'), 1000);
}

function updateFps(delta) {
  if (!debugMode) return;
  fpsFrames += 1;
  fpsElapsed += delta;
  if (fpsElapsed < 0.5) return;
  const fps = Math.round(fpsFrames / fpsElapsed);
  fpsElement.textContent = `${fps} FPS`;
  fpsElement.style.color = fps >= 45 ? '#aef7bf' : fps >= 28 ? '#ffe19b' : '#ff9c91';
  fpsFrames = 0;
  fpsElapsed = 0;
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
