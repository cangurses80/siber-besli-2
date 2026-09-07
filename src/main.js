import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import worldData from './world.json';
import { createProgress } from './progress.js';
import { createPuzzleSeed, getPuzzle } from './puzzles/index.js';
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
const cardEyebrow = document.querySelector('#card-eyebrow');
const islandName = document.querySelector('#island-name');
const islandStatus = document.querySelector('#island-status');
const difficulty = document.querySelector('#difficulty');
const difficultyDots = document.querySelector('#difficulty-dots');
const cardAction = document.querySelector('#card-action');
const loading = document.querySelector('#loading');
const fpsElement = document.querySelector('#fps');
const transitionShade = document.querySelector('#transition-shade');
const islandLabelsContainer = document.querySelector('#island-labels');
const regionLabelsContainer = document.querySelector('#region-labels');
const regionName = document.querySelector('#region-name');
const debugControls = document.querySelector('#debug-controls');
const debugSolveIsland = document.querySelector('#debug-solve-island');
const debugSolveRegion = document.querySelector('#debug-solve-region');
const puzzleRoom = document.querySelector('#puzzle-room');
const puzzleContainer = document.querySelector('#puzzle-container');

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
const progress = createProgress(worldData);
const world = createWorldScene({ renderer: pipeline.renderer, textures, data: worldData, debugMode });
world.syncProgress(progress.state);

const controls = new OrbitControls(perspectiveCamera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 34;
controls.maxDistance = 155;
controls.minPolarAngle = THREE.MathUtils.degToRad(18);
controls.maxPolarAngle = THREE.MathUtils.degToRad(78);
controls.target.copy(world.getIslandPosition(progress.state.currentIslandId));
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
  'puzzle-room': {
    modeId: 'explore',
    islandId: 'helios-01',
    positionOffset: new THREE.Vector3(28, 68, 30),
    targetOffset: new THREE.Vector3(0, 0.4, 0),
    qaState: 'puzzle-room',
  },
  'solved-bridge': {
    modeId: 'explore',
    islandId: 'helios-03',
    positionOffset: new THREE.Vector3(52, 34, 46),
    targetOffset: new THREE.Vector3(-8, 0, 10),
    qaState: 'solved-bridge',
  },
  'region-2': {
    modeId: 'explore',
    islandId: 'khepri-01',
    positionOffset: new THREE.Vector3(64, 48, 70),
    targetOffset: new THREE.Vector3(0, 0.4, 0),
    qaState: 'region-2',
  },
};

let modeIndex = 0;
let activeCamera = perspectiveCamera;
let cameraTarget = controls.target.clone();
let cameraTransition = null;
let regionFlight = null;
let toastTimer = null;
let titleTimer = null;
let currentRegionBlend = 0;
let currentWorldBlend = 0;
let pointerStart = null;
let fpsFrames = 0;
let fpsElapsed = 0;
let elapsedTime = 0;
let selectedIslandId = progress.state.currentIslandId;
let selectedRegionId = progress.state.activeRegionId;
let cardActionHandler = null;
let inputLocked = false;
let puzzleOpen = false;
let puzzleClosing = false;
let activePuzzle = null;
let activePuzzleIsland = null;
let renderPaused = false;
let islandLabelElements = new Map();
const regionLabelElements = new Map();

rebuildIslandLabels();
worldData.regions.forEach((region) => {
  const label = createLabel(region.name, 'Kilitli', true);
  regionLabelsContainer.append(label);
  regionLabelElements.set(region.id, label);
});
updateRegionLabels();

document.body.dataset.mode = MODES[modeIndex].id;
document.body.dataset.inputLocked = 'false';
fpsElement.hidden = !debugMode;
debugControls.hidden = !debugMode || Boolean(cameraPresetId);
updateCard();
window.__CAMERA_PRESET_READY__ = false;
window.__QA_STATE_READY__ = false;
window.__QA_FRAME_COUNT__ = 0;
window.__WORLD_READY__ = false;
window.__RENDER_PAUSED__ = false;
resize();

modeButton.addEventListener('click', () => {
  if (inputLocked) return;
  beginModeTransition((modeIndex + 1) % MODES.length);
});
cardAction.addEventListener('click', () => cardActionHandler?.());
debugSolveIsland.addEventListener('click', solveSelectedIslandForDebug);
debugSolveRegion.addEventListener('click', solveActiveRegionForDebug);
window.addEventListener('resize', resize, { passive: true });
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && puzzleOpen && !puzzleClosing) closePuzzleRoom();
});
canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
canvas.addEventListener('pointerup', onPointerUp, { passive: true });
canvas.addEventListener('pointercancel', () => { pointerStart = null; }, { passive: true });

progress.subscribe((event) => {
  world.syncProgress(event.state);
  updateRegionLabels();
  updateCard();
});

pipeline.renderer.setAnimationLoop(renderFrame);

world.ready
  .then(async () => {
    loading.classList.add('is-done');
    window.__WORLD_READY__ = true;
    await applyCameraPreset(cameraPresetId);
    refreshDiagnostics();
  })
  .catch((error) => {
    console.error('[world] Varlıklar yüklenemedi', error);
    loading.textContent = 'Dünya yüklenirken bir sorun oluştu.';
    loading.style.color = '#ffd3b0';
    window.__WORLD_READY__ = false;
  });

function renderFrame() {
  const delta = Math.min(clock.getDelta(), 0.05);
  elapsedTime += delta;
  if (regionFlight) updateRegionFlight(elapsedTime);
  else updateCameraTransition(elapsedTime);
  if (!cameraTransition && !regionFlight && MODES[modeIndex].id === 'explore') {
    controls.enabled = !inputLocked;
    controls.update();
    cameraTarget.copy(controls.target);
  }
  const worldElapsed = cameraPresetId ? 2.25 : elapsedTime;
  world.update(worldElapsed, activeCamera);
  updateLabels();
  updateFps(delta);
  pipeline.render(world.scene, activeCamera, delta);
  window.__QA_FRAME_COUNT__ += 1;
}

function beginModeTransition(nextIndex) {
  if (cameraTransition || regionFlight || inputLocked) return;
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
  if (nextMode.id === 'world') selectedRegionId = progress.state.activeRegionId;
  updateCard();
  showModeTitle(nextMode.label);

  cameraTransition = {
    startedAt: elapsedTime,
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

function focusIsland(islandId, duration = 0.8) {
  const island = islandById.get(islandId);
  if (!island || island.regionId !== world.activeRegion.id) return false;
  selectedIslandId = islandId;
  world.selectIsland(islandId);
  updateCard();
  if (MODES[modeIndex].id !== 'explore') return true;

  const toTarget = world.getIslandPosition(islandId);
  const offset = perspectiveCamera.position.clone().sub(controls.target);
  if (offset.length() < 36 || offset.length() > 150) offset.set(58, 44, 62);
  controls.enabled = false;
  cameraTransition = {
    startedAt: elapsedTime,
    duration,
    fromPosition: perspectiveCamera.position.clone(),
    toPosition: toTarget.clone().add(offset),
    fromTarget: cameraTarget.clone(),
    toTarget,
    fromRegionBlend: currentRegionBlend,
    toRegionBlend: 0,
    fromWorldBlend: currentWorldBlend,
    toWorldBlend: 0,
    nextModeId: 'explore',
    previousModeId: 'explore',
  };
  return true;
}

function updateCameraTransition(now) {
  if (!cameraTransition) return;
  const rawProgress = THREE.MathUtils.clamp(
    (now - cameraTransition.startedAt) / cameraTransition.duration,
    0,
    1,
  );
  const progressAmount = easeInOutCubic(rawProgress);
  activeCamera.position.lerpVectors(
    cameraTransition.fromPosition,
    cameraTransition.toPosition,
    progressAmount,
  );
  cameraTarget.lerpVectors(cameraTransition.fromTarget, cameraTransition.toTarget, progressAmount);
  activeCamera.lookAt(cameraTarget);
  currentRegionBlend = THREE.MathUtils.lerp(
    cameraTransition.fromRegionBlend,
    cameraTransition.toRegionBlend,
    progressAmount,
  );
  currentWorldBlend = THREE.MathUtils.lerp(
    cameraTransition.fromWorldBlend,
    cameraTransition.toWorldBlend,
    progressAmount,
  );
  world.setMapBlend(currentRegionBlend, currentWorldBlend);
  transitionShade.classList.toggle('is-midpoint', rawProgress > 0.28 && rawProgress < 0.72);

  if (rawProgress >= 1) {
    const completedMode = cameraTransition.nextModeId;
    cameraTransition = null;
    transitionShade.classList.remove('is-midpoint');
    if (completedMode === 'explore') {
      controls.target.copy(cameraTarget);
      controls.enabled = !inputLocked;
      controls.update();
    }
  }
}

function getCameraDestination(modeId) {
  if (modeId === 'region') {
    const target = new THREE.Vector3(...world.activeRegion.position).add(new THREE.Vector3(8, 3, 16));
    return { position: target.clone().add(new THREE.Vector3(0, 225, 0)), target };
  }
  if (modeId === 'world') {
    return { position: worldCenter.clone().add(new THREE.Vector3(0, 680, 0)), target: worldCenter.clone() };
  }
  const target = world.getIslandPosition(selectedIslandId);
  return { position: target.clone().add(new THREE.Vector3(64, 48, 70)), target };
}

function getCamera(modeId) {
  if (modeId === 'region') return regionCamera;
  if (modeId === 'world') return worldCamera;
  return perspectiveCamera;
}

async function applyCameraPreset(presetId) {
  if (!presetId) {
    window.__CAMERA_PRESET_READY__ = null;
    window.__QA_STATE_READY__ = null;
    return;
  }
  const preset = CAMERA_PRESETS[presetId];
  if (!preset) {
    console.warn(`[camera-preset] Bilinmeyen preset: ${presetId}`);
    window.__CAMERA_PRESET_READY__ = 'invalid';
    window.__QA_STATE_READY__ = 'invalid';
    return;
  }

  prepareQaState(preset.qaState);
  const nextIndex = MODES.findIndex((mode) => mode.id === preset.modeId);
  const mode = MODES[nextIndex];
  modeIndex = nextIndex;
  activeCamera = getCamera(mode.id);
  cameraTransition = null;
  currentRegionBlend = mode.regionBlend;
  currentWorldBlend = mode.worldBlend;

  if (preset.islandId) {
    selectedIslandId = preset.islandId;
    world.selectIsland(preset.islandId);
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
  world.setMapBlend(currentRegionBlend, currentWorldBlend);
  updateCard();
  updateRegionLabels();
  if (preset.qaState === 'puzzle-room') {
    await openPuzzleRoom(islandById.get('helios-01'), { instant: true, pauseRender: false });
  }
  window.__QA_STATE_READY__ = presetId;
  window.__CAMERA_PRESET_READY__ = presetId;
}

function prepareQaState(qaState) {
  if (qaState === 'solved-bridge') {
    const result = progress.solveIsland('helios-03');
    result.openedBridgeIds.forEach((bridgeId) => world.setBridgeState(bridgeId, 'open'));
  }
  if (qaState === 'region-2') {
    progress.solveIsland('helios-05');
    progress.setActiveRegion('khepri');
    world.createDetailedRegion('khepri');
    world.syncProgress(progress.state);
    selectedIslandId = progress.state.currentIslandId;
    selectedRegionId = 'khepri';
    world.selectIsland(selectedIslandId);
    world.moveCharacterTo(selectedIslandId, elapsedTime, 0);
    regionName.textContent = world.activeRegion.name;
    rebuildIslandLabels();
  }
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
  if (inputLocked) return;
  pointerStart = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  };
}

function onPointerUp(event) {
  if (!pointerStart || pointerStart.id !== event.pointerId || cameraTransition || regionFlight || inputLocked) {
    pointerStart = null;
    return;
  }
  const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  const duration = performance.now() - pointerStart.time;
  pointerStart = null;
  if (movement > 13 || duration > 650) return;
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
      const nextState = bridgeVisual.state === 'open' ? 'closed' : 'open';
      progress.setBridgeState(bridgeVisual.bridge.id, nextState);
      showToast(`${bridgeVisual.bridge.id}: ${nextState === 'open' ? 'açık' : 'kapalı'}`);
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

  const regionHit = raycaster.intersectObjects([...world.regionNodes.values()], false)
    .filter((hit) => hit.object.visible)[0];
  if (regionHit) selectRegion(regionHit.object.userData.regionId);
}

function selectRegion(regionId) {
  selectedRegionId = regionId;
  updateCard();
  if (!progress.isRegionReachable(regionId)) showToast('Bu bölge henüz kilitli');
}

function updateCard() {
  cardActionHandler = null;
  cardAction.hidden = true;
  islandCard.classList.remove('is-locked', 'is-solved');
  if (MODES[modeIndex].id === 'world') {
    updateRegionCard();
    return;
  }
  const island = islandById.get(selectedIslandId);
  if (!island || island.regionId !== progress.state.activeRegionId) {
    islandCard.classList.add('is-hidden');
    return;
  }
  islandCard.classList.remove('is-hidden');
  cardEyebrow.textContent = 'SEÇİLİ ADA';
  islandName.textContent = island.name;
  difficulty.hidden = false;
  difficultyDots.textContent = `${'●'.repeat(island.difficulty)}${'○'.repeat(5 - island.difficulty)}`;
  difficulty.setAttribute('aria-label', `Zorluk: ${island.difficulty} / 5`);
  const solved = progress.state.solvedIslands.has(island.id);
  const reachable = progress.isIslandReachable(island.id);
  if (!reachable) {
    islandCard.classList.add('is-locked');
    islandStatus.textContent = 'Kilitli — önce komşu adayı çöz';
    return;
  }
  if (solved) {
    islandCard.classList.add('is-solved');
    islandStatus.textContent = '✓ Çözüldü';
    showCardAction('Tekrar oyna', () => enterIsland(island));
    return;
  }
  islandStatus.textContent = 'Erişilebilir';
  showCardAction('Gir', () => enterIsland(island));
}

function updateRegionCard() {
  const region = regionById.get(selectedRegionId);
  if (!region) {
    islandCard.classList.add('is-hidden');
    return;
  }
  islandCard.classList.remove('is-hidden');
  cardEyebrow.textContent = 'SEÇİLİ BÖLGE';
  islandName.textContent = region.name;
  difficulty.hidden = true;
  if (region.id === progress.state.activeRegionId) {
    islandStatus.textContent = 'Aktif bölge';
    return;
  }
  const directBridge = world.getRegionBridge(progress.state.activeRegionId, region.id, true);
  if (directBridge && progress.isRegionReachable(region.id)) {
    islandStatus.textContent = 'Açık bölge köprüsüyle erişilebilir';
    showCardAction('Bölgeye geç', () => beginRegionTransition(region.id, directBridge));
    return;
  }
  islandCard.classList.add('is-locked');
  islandStatus.textContent = progress.isRegionReachable(region.id)
    ? 'Bu bölgeye önce komşu bölgeden geç'
    : 'Kilitli — çıkış adasını çöz';
}

function showCardAction(label, handler) {
  cardAction.textContent = label;
  cardAction.hidden = false;
  cardActionHandler = handler;
}

async function enterIsland(island) {
  if (inputLocked || !progress.isIslandReachable(island.id)) return;
  setInputLocked(true);
  if (progress.state.currentIslandId !== island.id) {
    progress.setCurrentIsland(island.id);
    await world.moveCharacterTo(island.id, elapsedTime, 0.8);
  }
  await openPuzzleRoom(island);
  setInputLocked(false);
}

async function openPuzzleRoom(island, { instant = false, pauseRender = true } = {}) {
  if (puzzleOpen) return;
  const puzzle = getPuzzle(island.puzzleType);
  if (!puzzle) {
    showToast('Bu bulmaca türü kayıtlı değil');
    return;
  }
  puzzleOpen = true;
  activePuzzle = puzzle;
  activePuzzleIsland = island;
  const spec = puzzle.generate(createPuzzleSeed('local', island.id), island.difficulty);
  puzzleRoom.hidden = false;
  puzzleRoom.setAttribute('aria-hidden', 'false');
  puzzle.mount(puzzleContainer, spec, {
    island,
    onSolve: () => handlePuzzleSolve(island),
    onExit: () => closePuzzleRoom(),
  });
  if (instant) {
    puzzleRoom.style.transition = 'none';
    puzzleRoom.classList.add('is-open');
    puzzleRoom.getBoundingClientRect();
    puzzleRoom.style.removeProperty('transition');
  } else {
    await nextFrame();
    puzzleRoom.classList.add('is-open');
    await wait(400);
  }
  if (puzzleOpen && pauseRender) pauseWorldRendering();
}

async function closePuzzleRoom() {
  if (!puzzleOpen || puzzleClosing) return;
  puzzleClosing = true;
  if (renderPaused) resumeWorldRendering();
  activePuzzle?.unmount();
  puzzleRoom.classList.remove('is-open');
  await wait(400);
  puzzleRoom.hidden = true;
  puzzleRoom.setAttribute('aria-hidden', 'true');
  puzzleOpen = false;
  puzzleClosing = false;
  activePuzzle = null;
  activePuzzleIsland = null;
}

async function handlePuzzleSolve(island) {
  if (puzzleClosing || activePuzzleIsland?.id !== island.id) return;
  await closePuzzleRoom();
  const result = progress.solveIsland(island.id);
  result.openedBridgeIds.forEach((bridgeId) => {
    world.setBridgeState(bridgeId, 'open', { animate: true, startedAt: elapsedTime, duration: 1.2 });
  });
  if (result.focusIslandId) focusIsland(result.focusIslandId, 1.5);
}

function pauseWorldRendering() {
  if (renderPaused) return;
  pipeline.renderer.setAnimationLoop(null);
  renderPaused = true;
  window.__RENDER_PAUSED__ = true;
}

function resumeWorldRendering() {
  if (!renderPaused) return;
  clock.getDelta();
  renderPaused = false;
  window.__RENDER_PAUSED__ = false;
  pipeline.renderer.setAnimationLoop(renderFrame);
}

function solveSelectedIslandForDebug() {
  const island = islandById.get(selectedIslandId);
  if (!island || island.regionId !== progress.state.activeRegionId) return;
  const result = progress.solveIsland(island.id);
  result.openedBridgeIds.forEach((bridgeId) => {
    world.setBridgeState(bridgeId, 'open', { animate: true, startedAt: elapsedTime, duration: 1.2 });
  });
  if (result.focusIslandId) focusIsland(result.focusIslandId, 1.5);
}

function solveActiveRegionForDebug() {
  progress.solveRegion(progress.state.activeRegionId);
  world.syncProgress(progress.state);
  showToast('Aktif bölge tamamen çözüldü');
}

function beginRegionTransition(targetRegionId, bridgeVisual) {
  if (inputLocked || regionFlight || !bridgeVisual || bridgeVisual.state !== 'open') return;
  setInputLocked(true);
  cameraTransition = null;
  controls.enabled = false;
  activeCamera = perspectiveCamera;
  const reverse = bridgeVisual.bridge.to === progress.state.activeRegionId;
  regionFlight = {
    targetRegionId,
    bridgeVisual,
    reverse,
    startedAt: elapsedTime,
    duration: 2.5,
    midpointLoaded: false,
  };
  transitionShade.classList.add('is-midpoint');
}

function updateRegionFlight(now) {
  const raw = THREE.MathUtils.clamp((now - regionFlight.startedAt) / regionFlight.duration, 0, 1);
  const eased = easeInOutCubic(raw);
  const curveT = regionFlight.reverse ? 1 - eased : eased;
  const lookT = THREE.MathUtils.clamp(
    curveT + (regionFlight.reverse ? -0.018 : 0.018),
    0,
    1,
  );
  const point = regionFlight.bridgeVisual.curve.getPoint(curveT);
  const lookPoint = regionFlight.bridgeVisual.curve.getPoint(lookT);
  const tangent = lookPoint.clone().sub(point).normalize();
  const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(22 * Math.sin(raw * Math.PI));
  perspectiveCamera.position.copy(point).add(side).add(new THREE.Vector3(0, 24 + Math.sin(raw * Math.PI) * 12, 0));
  cameraTarget.copy(lookPoint).add(new THREE.Vector3(0, 2, 0));
  perspectiveCamera.lookAt(cameraTarget);
  currentWorldBlend = 1 - eased;
  currentRegionBlend = 0;
  world.setMapBlend(0, currentWorldBlend);

  if (!regionFlight.midpointLoaded && raw >= 0.5) {
    regionFlight.midpointLoaded = true;
    progress.setActiveRegion(regionFlight.targetRegionId);
    world.createDetailedRegion(regionFlight.targetRegionId);
    world.syncProgress(progress.state);
    selectedIslandId = progress.state.currentIslandId;
    selectedRegionId = progress.state.activeRegionId;
    world.selectIsland(selectedIslandId);
    world.moveCharacterTo(selectedIslandId, now, 0);
    regionName.textContent = world.activeRegion.name;
    rebuildIslandLabels();
    updateRegionLabels();
  }

  if (raw >= 1) finishRegionTransition();
}

function finishRegionTransition() {
  regionFlight = null;
  transitionShade.classList.remove('is-midpoint');
  modeIndex = 0;
  activeCamera = perspectiveCamera;
  currentRegionBlend = 0;
  currentWorldBlend = 0;
  document.body.dataset.mode = 'explore';
  modeLabel.textContent = MODES[0].label;
  modeIcon.textContent = MODES[0].icon;
  modeButton.setAttribute('aria-label', 'Kamera modu: Gezinti');
  world.setMapBlend(0, 0);
  const target = world.getIslandPosition(selectedIslandId);
  cameraTarget.copy(target);
  controls.target.copy(target);
  controls.enabled = true;
  controls.update();
  setInputLocked(false);
  updateCard();
}

function setInputLocked(locked) {
  inputLocked = locked;
  document.body.dataset.inputLocked = String(locked);
  modeButton.disabled = locked;
  cardAction.disabled = locked;
}

function rebuildIslandLabels() {
  islandLabelsContainer.replaceChildren();
  islandLabelElements = new Map();
  world.activeIslands.forEach((island) => {
    const label = createLabel(island.name, `Zorluk ${island.difficulty}`);
    islandLabelsContainer.append(label);
    islandLabelElements.set(island.id, label);
  });
}

function updateRegionLabels() {
  const reachable = progress.getReachableRegionIds();
  worldData.regions.forEach((region) => {
    const label = regionLabelElements.get(region.id);
    if (!label) return;
    const subtitle = label.querySelector('small');
    const active = region.id === progress.state.activeRegionId;
    subtitle.textContent = active ? 'Aktif bölge' : reachable.has(region.id) ? 'Erişilebilir' : 'Kilitli';
    label.classList.toggle('is-locked', !reachable.has(region.id));
  });
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
  if (!element) return;
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

function refreshDiagnostics() {
  const gl = pipeline.renderer.getContext();
  const rendererDebugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  window.__WORLD_DIAGNOSTICS__ = {
    threeRevision: THREE.REVISION,
    regionCount: worldData.regions.length,
    islandCount: worldData.islands.length,
    activeRegionId: world.activeRegion.id,
    activeIslandInstances: world.activeIslands.length,
    landmarkInstances: world.landmarks.counts,
    islandGeometry: world.geometryDiagnostics,
    bridgeGeometryChecks: world.bridgeGeometryChecks,
    detailedRegionCount: 1,
    progress: {
      solvedIslands: [...progress.state.solvedIslands],
      openBridges: [...progress.state.openBridges],
      activeRegionId: progress.state.activeRegionId,
      currentIslandId: progress.state.currentIslandId,
    },
    cameraTransitionMilliseconds: 800,
    debugMode,
    cameraPresetId,
    renderer: rendererDebugInfo
      ? gl.getParameter(rendererDebugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
