import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RENDER_CONFIG, isMobileQuality } from '../render/config.js';
import { createCharacter } from './characters.js';

const PALETTES = {
  helios: { grass: 0x5f9a4a, rock: 0x6e5f52, glow: 0xffb84d, node: 0x405b70 },
  khepri: { top: 0xb99b62, rock: 0x4d5154, glow: 0x4bb9dd, node: 0xb98b4a },
  uruk: { top: 0x9c7655, rock: 0x483f42, glow: 0xd57a4d, node: 0x9d684b },
  quetzal: { top: 0x4f977e, rock: 0x334c49, glow: 0xff7668, node: 0x4e9279 },
  parsa: { top: 0x4b9a9d, rock: 0x3f4254, glow: 0xe9ad5a, node: 0x538f91 },
  veda: { top: 0x726d9b, rock: 0x403c55, glow: 0xf28da8, node: 0x77719b },
};

const ISLAND_RADIUS_SCALE = 1.6;
const ORIGINAL_START_ISLAND_RADIUS = 9.5;
const ISLAND_RIM_HEIGHT = 0.32;
const ISLAND_RIM_CENTER_Y = -0.12;
const ISLAND_TOP_LOCAL_Y = ISLAND_RIM_CENTER_Y + ISLAND_RIM_HEIGHT / 2;
const ISLAND_UNDERSIDE_HEIGHT = 1.85;
const ISLAND_UNDERSIDE_CENTER_Y = -1.18;
const ISLAND_BOTTOM_LOCAL_Y = ISLAND_UNDERSIDE_CENTER_Y - ISLAND_UNDERSIDE_HEIGHT / 2;
const STONE_BAND_INNER_RADIUS = 0.82;
const GRASS_DISC_RADIUS = 0.83;
const GRASS_SURFACE_LIFT = 0.02;
const RING_MAJOR_RADIUS = 1.04;
const RING_TUBE_RADIUS = 0.022;
const RING_SURFACE_LIFT = 0.15;
const ISLAND_BRIDGE_RADIUS = 0.23;
const BRIDGE_SURFACE_CLEARANCE = 0.25;
const BRIDGE_EDGE_CLEARANCE = 1.05;
const BRIDGE_CONTROL_OFFSET = 4;
const MIMAR_HEIGHT_RATIO = 0.5;
const MIMAR_HOVER_HEIGHT = 10;
const MIMAR_CHARACTER_OFFSET_RATIO = 0.4;
const MIMAR_LOCAL_OFFSET_DIRECTION = new THREE.Vector2(-0.75, 0.66).normalize();
const MIMAR_IDLE_ROTATION_SPEED = 0.3;
const MIMAR_SPEAKING_ROTATION_MULTIPLIER = 1.8;
const MIMAR_MOVE_DURATION = 0.6;
const MIMAR_GLITCH_DURATION = 0.12;

export function createWorldScene({ renderer, textures, data, debugMode = false }) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(RENDER_CONFIG.world.fogColor, RENDER_CONFIG.world.fogDensity);
  const islandById = new Map(data.islands.map((island) => [island.id, island]));
  const regionById = new Map(data.regions.map((region) => [region.id, region]));
  const globalResources = { geometries: [], materials: [], textures: [] };
  const islandWorldPositions = new Map();
  const bridgeStateOverrides = new Map(
    [...data.bridges, ...data.regionBridges].map((bridge) => [bridge.id, bridge.state]),
  );
  let reachableRegionIds = new Set([data.regions[0].id]);
  let detailedRegion = null;
  let selectedIslandId = data.regions[0].islands[0];
  let detailOpacity = 1;
  let regionBlend = 0;
  let worldBlend = 0;
  let characterIslandId = selectedIslandId;
  let characterMove = null;
  let ghostEntries = [];
  let mimarIslandId = selectedIslandId;
  let mimarMove = null;
  let mimarSpeaking = false;
  let mimarRotation = 0;
  let mimarLastElapsed = 0;
  let mimarGlitchCycle = 0;
  let mimarGlitchStartedAt = null;
  let mimarNextGlitchAt = 8 + hashUnit('mimar-glitch-0') * 7;
  let mimarForcedGlitch = false;

  createSky(scene, globalResources);
  createMist(scene, globalResources);
  const lighting = createLights(scene);
  createClouds(scene, globalResources);

  const sharedGeometries = {
    body: createIslandBodyGeometry(),
    stone: new THREE.RingGeometry(STONE_BAND_INNER_RADIUS, 1, 24, 1),
    grass: new THREE.CircleGeometry(GRASS_DISC_RADIUS, 24),
    ring: new THREE.TorusGeometry(RING_MAJOR_RADIUS, RING_TUBE_RADIUS, 4, 36),
  };
  sharedGeometries.stone.rotateX(-Math.PI / 2);
  sharedGeometries.grass.rotateX(-Math.PI / 2);
  sharedGeometries.ring.rotateX(Math.PI / 2);
  globalResources.geometries.push(...Object.values(sharedGeometries));

  const regionNodes = new Map();
  data.regions.forEach((region, index) => {
    const node = createRegionNode(region, index === 0, globalResources);
    scene.add(node);
    regionNodes.set(region.id, node);
  });

  const regionBridgeMaterials = createBridgeMaterials(PALETTES.helios, globalResources);
  const regionBridgeVisuals = [];
  const regionBridgePickMeshes = [];
  data.regionBridges.forEach((bridge) => {
    const from = vectorFrom(regionById.get(bridge.from).position);
    const to = vectorFrom(regionById.get(bridge.to).position);
    const visual = createBridgeVisual({
      bridge,
      from,
      to,
      radius: 1.3,
      openMaterial: regionBridgeMaterials.regionOpen,
      closedMaterial: regionBridgeMaterials.regionClosed,
      sag: 24,
      tubularSegments: 36,
    });
    visual.group.renderOrder = -1;
    scene.add(visual.group);
    regionBridgeVisuals.push(visual);
    regionBridgePickMeshes.push(...visual.pickMeshes);
  });

  const zeynep = createCharacter('Zeynep', 'front', { resources: globalResources });
  const mimarSourceGeometry = new THREE.OctahedronGeometry(1, 0);
  const mimarGeometry = new THREE.EdgesGeometry(mimarSourceGeometry);
  mimarSourceGeometry.dispose();
  const mimarBasePositions = mimarGeometry.getAttribute('position').array.slice();
  const mimarMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color().setRGB(0.456, 1.44, 1.74),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    toneMapped: false,
  });
  const mimar = new THREE.LineSegments(mimarGeometry, mimarMaterial);
  mimar.name = 'Mimar wireframe octahedron';
  mimar.renderOrder = 5;
  globalResources.geometries.push(mimarGeometry);
  globalResources.materials.push(mimarMaterial);
  scene.add(mimar);
  const ghostGroup = new THREE.Group();
  ghostGroup.name = 'Recent reader ghost silhouettes';
  const ghostTextureReady = new Promise((resolve, reject) => {
    const texture = new THREE.TextureLoader().load(
      '/assets/characters/zeynep_front.png',
      resolve,
      undefined,
      reject,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    globalResources.textures.push(texture);
  });
  const ghostTexture = globalResources.textures.at(-1);
  const ghostMaterial = new THREE.SpriteMaterial({
    map: ghostTexture,
    color: 0x91d5ee,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    toneMapped: false,
  });
  globalResources.materials.push(ghostMaterial);
  scene.add(ghostGroup);
  const contactShadowGeometry = new THREE.CircleGeometry(1, 24);
  contactShadowGeometry.rotateX(-Math.PI / 2);
  const contactShadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x11151a,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    toneMapped: false,
  });
  const contactShadow = new THREE.Mesh(contactShadowGeometry, contactShadowMaterial);
  contactShadow.name = 'Zeynep soft contact shadow';
  contactShadow.renderOrder = 2;
  globalResources.geometries.push(contactShadowGeometry);
  globalResources.materials.push(contactShadowMaterial);
  scene.add(contactShadow, zeynep);

  function createDetailedRegion(regionId) {
    disposeDetailedRegion();
    const activeRegion = regionById.get(regionId);
    if (!activeRegion) throw new Error(`Bilinmeyen bölge: ${regionId}`);
    const activeIslands = activeRegion.islands.map((id) => islandById.get(id));
    const palette = normalizedPalette(activeRegion.id);
    const ownedResources = { geometries: [], materials: [], textures: [] };
    const group = new THREE.Group();
    group.name = `${activeRegion.name} detailed region`;
    scene.add(group);

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: palette.rock,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
      transparent: true,
    });
    const stoneTopMaterial = new THREE.MeshStandardMaterial({
      color: 0xcfc4b0,
      map: textures.stone.color,
      normalMap: textures.stone.normal,
      roughnessMap: textures.stone.roughness,
      roughness: 0.82,
      metalness: 0,
      transparent: true,
    });
    const grassTopMaterial = new THREE.MeshStandardMaterial({
      color: palette.grass,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      depthTest: true,
      depthWrite: true,
    });
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: palette.glow,
      emissiveIntensity: 1.35,
      roughness: 0.4,
      metalness: 0.02,
      transparent: true,
      opacity: 0.96,
      toneMapped: false,
    });
    ownedResources.materials.push(bodyMaterial, stoneTopMaterial, grassTopMaterial, ringMaterial);

    const bodies = new THREE.InstancedMesh(sharedGeometries.body, bodyMaterial, activeIslands.length);
    const stoneTops = new THREE.InstancedMesh(sharedGeometries.stone, stoneTopMaterial, activeIslands.length);
    const tops = new THREE.InstancedMesh(sharedGeometries.grass, grassTopMaterial, activeIslands.length);
    const rings = new THREE.InstancedMesh(sharedGeometries.ring, ringMaterial, activeIslands.length);
    const namePrefix = activeRegion.id === 'helios' ? 'Tutorial' : activeRegion.name;
    bodies.name = `${namePrefix} island bodies (instanced)`;
    stoneTops.name = `${namePrefix} island PBR stone bands (instanced)`;
    tops.name = `${namePrefix} island moss centers (instanced)`;
    rings.name = `${namePrefix} island emissive rims (instanced)`;
    [bodies, stoneTops, tops, rings].forEach((mesh) => { mesh.frustumCulled = false; });
    bodies.renderOrder = 0;
    stoneTops.renderOrder = 1;
    tops.renderOrder = 2;
    rings.renderOrder = 3;
    bodies.castShadow = true;
    bodies.receiveShadow = true;
    stoneTops.castShadow = true;
    stoneTops.receiveShadow = true;
    tops.castShadow = true;
    tops.receiveShadow = true;
    for (const mesh of [bodies, stoneTops, tops, rings]) {
      mesh.userData.islandIds = activeIslands.map((island) => island.id);
    }
    group.add(bodies, stoneTops, tops, rings);

    const islandAnimation = activeIslands.map((island, index) => {
      const base = vectorFrom(island.localPosition).add(vectorFrom(activeRegion.position));
      islandWorldPositions.set(island.id, base.clone());
      const phase = hashUnit(island.id) * Math.PI * 2;
      rings.setColorAt(index, new THREE.Color(palette.glow));
      return {
        island,
        base,
        phase,
        bob: 0,
        rotation: phase * 0.11,
        scaleX: 0.94 + hashUnit(`${island.id}-x`) * 0.12,
        scaleZ: 0.94 + hashUnit(`${island.id}-z`) * 0.12,
      };
    });
    rings.instanceColor.needsUpdate = true;
    const islandAnimationById = new Map(islandAnimation.map((item) => [item.island.id, item]));
    const geometryDiagnostics = createIslandGeometryDiagnostics({
      islandGeometry: sharedGeometries.body,
      stoneTopGeometry: sharedGeometries.stone,
      grassTopGeometry: sharedGeometries.grass,
      grassTopMaterial,
      bodies,
      stoneTops,
      tops,
      animation: islandAnimation[0],
    });
    if (debugMode) console.info(`[geometry-qa] ${activeRegion.id}: ${JSON.stringify(geometryDiagnostics)}`);
    const landmarks = createLandmarkSystem({
      parent: group,
      activeIslands,
      islandAnimationById,
      resources: ownedResources,
      namePrefix,
    });

    const bridgeMaterials = createBridgeMaterials(palette, ownedResources);
    const bridgeVisuals = [];
    const bridgePickMeshes = [];
    const bridgeGeometryChecks = [];
    const activeIslandBridges = data.bridges.filter(
      (bridge) => islandById.get(bridge.from)?.regionId === activeRegion.id,
    );
    activeIslandBridges.forEach((bridge) => {
      const fromAnimation = islandAnimationById.get(bridge.from);
      const toAnimation = islandAnimationById.get(bridge.to);
      const curvePoints = createIslandBridgeCurvePoints(
        fromAnimation,
        toAnimation,
        4.8,
        ISLAND_BRIDGE_RADIUS,
      );
      const visual = createBridgeVisual({
        bridge,
        from: curvePoints[0],
        to: curvePoints[curvePoints.length - 1],
        curvePoints,
        radius: ISLAND_BRIDGE_RADIUS,
        openMaterial: bridgeMaterials.islandOpen,
        closedMaterial: bridgeMaterials.islandClosed,
        sag: 4.8,
        tubularSegments: 28,
        endpointAnimations: [fromAnimation, toAnimation],
      });
      visual.setState(bridgeStateOverrides.get(bridge.id) || bridge.state);
      bridgeGeometryChecks.push(validateIslandBridgeCurve({
        bridge,
        curve: visual.curve,
        endpointAnimations: [fromAnimation, toAnimation],
        sampleCount: 32,
        debugMode,
      }));
      group.add(visual.group);
      bridgeVisuals.push(visual);
      bridgePickMeshes.push(...visual.pickMeshes);
    });

    detailedRegion = {
      group,
      activeRegion,
      activeIslands,
      palette,
      ownedResources,
      bodyMaterial,
      stoneTopMaterial,
      grassTopMaterial,
      ringMaterial,
      bodies,
      stoneTops,
      tops,
      rings,
      islandAnimation,
      islandAnimationById,
      landmarks,
      bridgeVisuals,
      bridgePickMeshes,
      bridgeGeometryChecks,
      geometryDiagnostics,
      baseMatrix: new THREE.Object3D(),
    };
    if (!activeRegion.islands.includes(selectedIslandId)) selectedIslandId = activeRegion.islands[0];
    selectIsland(selectedIslandId);
    setMapBlend(regionBlend, worldBlend);
    refreshRegionNodes();
    return detailedRegion;
  }

  function disposeDetailedRegion() {
    if (!detailedRegion) return;
    setGhostPlayers([]);
    scene.remove(detailedRegion.group);
    detailedRegion.bridgeVisuals.forEach((visual) => visual.dispose());
    detailedRegion.ownedResources.geometries.forEach((item) => item.dispose?.());
    detailedRegion.ownedResources.materials.forEach((item) => item.dispose?.());
    detailedRegion.ownedResources.textures.forEach((item) => item.dispose?.());
    detailedRegion.activeIslands.forEach((island) => islandWorldPositions.delete(island.id));
    detailedRegion = null;
  }

  function selectIsland(islandId) {
    if (!detailedRegion?.islandAnimationById.has(islandId)) return false;
    selectedIslandId = islandId;
    detailedRegion.activeIslands.forEach((island, index) => {
      detailedRegion.rings.setColorAt(
        index,
        new THREE.Color(island.id === islandId ? 0xfff5cf : detailedRegion.palette.glow),
      );
    });
    detailedRegion.rings.instanceColor.needsUpdate = true;
    return true;
  }

  function update(elapsedSeconds, activeCamera) {
    lighting.update(activeCamera);
    regionBridgeVisuals.forEach((visual) => visual.updateAnimation(elapsedSeconds));
    if (!detailedRegion) return;
    const detail = detailedRegion;
    const { baseMatrix } = detail;
    detail.islandAnimation.forEach((item, index) => {
      item.bob = Math.sin(elapsedSeconds * 0.72 + item.phase) * 0.3;
      const centerY = getIslandCenterY(item);
      const topY = getIslandTopY(item);
      const { radiusX, radiusZ } = getIslandRimAxes(item);
      baseMatrix.position.set(item.base.x, centerY, item.base.z);
      baseMatrix.rotation.set(0, item.rotation, 0);
      baseMatrix.scale.set(radiusX, getIslandBodyScaleY(item), radiusZ);
      baseMatrix.updateMatrix();
      detail.bodies.setMatrixAt(index, baseMatrix.matrix);
      baseMatrix.position.y = topY;
      baseMatrix.scale.set(radiusX, 1, radiusZ);
      baseMatrix.updateMatrix();
      detail.stoneTops.setMatrixAt(index, baseMatrix.matrix);
      baseMatrix.position.y = topY + GRASS_SURFACE_LIFT;
      baseMatrix.updateMatrix();
      detail.tops.setMatrixAt(index, baseMatrix.matrix);
      baseMatrix.position.y = topY + RING_SURFACE_LIFT;
      baseMatrix.scale.set(radiusX, (radiusX + radiusZ) / 2, radiusZ);
      baseMatrix.updateMatrix();
      detail.rings.setMatrixAt(index, baseMatrix.matrix);
      islandWorldPositions.get(item.island.id).set(item.base.x, centerY, item.base.z);
    });
    detail.bodies.instanceMatrix.needsUpdate = true;
    detail.stoneTops.instanceMatrix.needsUpdate = true;
    detail.tops.instanceMatrix.needsUpdate = true;
    detail.rings.instanceMatrix.needsUpdate = true;
    detail.landmarks.update(detailOpacity);
    detail.bridgeVisuals.forEach((visual) => {
      visual.updateEndpointMotion();
      visual.updateAnimation(elapsedSeconds);
    });
    updateCharacter(elapsedSeconds, activeCamera);
    updateMimar(elapsedSeconds);
    updateGhostPlayers();
  }

  function setGhostPlayers(records = []) {
    ghostGroup.clear();
    const validRecords = records
      .filter((record) => detailedRegion?.islandAnimationById.has(record.currentIslandId))
      .slice(0, 12);
    const islandCounts = new Map();
    validRecords.forEach((record) => {
      islandCounts.set(record.currentIslandId, (islandCounts.get(record.currentIslandId) || 0) + 1);
    });
    const islandIndexes = new Map();
    ghostEntries = validRecords.map((record) => {
      const slot = islandIndexes.get(record.currentIslandId) || 0;
      islandIndexes.set(record.currentIslandId, slot + 1);
      const sprite = new THREE.Sprite(ghostMaterial);
      sprite.name = `Reader ghost: ${record.nickname}`;
      sprite.renderOrder = 4;
      ghostGroup.add(sprite);
      return {
        uid: record.uid,
        nickname: record.nickname,
        islandId: record.currentIslandId,
        slot,
        slotCount: islandCounts.get(record.currentIslandId),
        sprite,
        labelPosition: new THREE.Vector3(),
      };
    });
    updateGhostPlayers();
    return ghostEntries.length;
  }

  function updateGhostPlayers() {
    if (!detailedRegion) return;
    ghostGroup.visible = detailOpacity > 0.35;
    ghostMaterial.opacity = 0.35 * Math.min(1, detailOpacity / 0.65);
    ghostEntries.forEach((entry) => {
      const animation = detailedRegion.islandAnimationById.get(entry.islandId);
      if (!animation) return;
      const angle = (entry.slot / Math.max(1, entry.slotCount)) * Math.PI * 2
        + hashUnit(entry.islandId) * Math.PI * 2;
      const offsetRadius = animation.island.radius * (entry.slotCount > 1 ? 0.32 : 0.22);
      const mapReadabilityScale = 1 + regionBlend * 1.2;
      const height = animation.island.radius
        * (6.3 / ORIGINAL_START_ISLAND_RADIUS)
        * 1.45
        * mapReadabilityScale;
      entry.sprite.position.set(
        animation.base.x + Math.cos(angle) * offsetRadius,
        getIslandTopY(animation) + height * 0.52,
        animation.base.z + Math.sin(angle) * offsetRadius,
      );
      entry.sprite.scale.set(height * 0.304688, height, 1);
      entry.labelPosition.copy(entry.sprite.position);
      entry.labelPosition.y += height * 0.58;
    });
  }

  function getGhostPositions() {
    return ghostEntries.map((entry) => ({
      uid: entry.uid,
      nickname: entry.nickname,
      islandId: entry.islandId,
      position: entry.labelPosition.clone(),
    }));
  }

  function updateCharacter(elapsedSeconds, activeCamera) {
    if (!detailedRegion) return;
    let moving = Boolean(characterMove);
    let islandId = characterIslandId;
    let characterPosition;
    let shadowPosition;
    let scale;
    if (characterMove) {
      const raw = THREE.MathUtils.clamp(
        (elapsedSeconds - characterMove.startedAt) / characterMove.duration,
        0,
        1,
      );
      const progress = easeInOutCubic(raw);
      const source = getCharacterAnchor(characterMove.fromIslandId);
      const destination = getCharacterAnchor(characterMove.toIslandId);
      const sourceCharacter = source?.character || characterMove.fromCharacter;
      const sourceShadow = source?.shadow || characterMove.fromShadow;
      const sourceScale = source?.scale || characterMove.fromScale;
      characterPosition = sourceCharacter.clone().lerp(destination.character, progress);
      characterPosition.y += Math.sin(progress * Math.PI) * 3.2;
      shadowPosition = sourceShadow.clone().lerp(destination.shadow, progress);
      scale = THREE.MathUtils.lerp(sourceScale, destination.scale, progress);
      islandId = characterMove.toIslandId;
      if (raw >= 1) {
        characterIslandId = characterMove.toIslandId;
        const resolve = characterMove.resolve;
        characterMove = null;
        moving = false;
        resolve?.(true);
      }
    } else {
      const destination = getCharacterAnchor(islandId);
      if (!destination) return;
      characterPosition = destination.character;
      shadowPosition = destination.shadow;
      scale = destination.scale;
    }
    zeynep.position.copy(characterPosition);
    zeynep.scale.setScalar(scale);
    contactShadow.position.copy(shadowPosition);
    contactShadow.scale.setScalar(islandById.get(islandId).radius * (2.7 / ORIGINAL_START_ISLAND_RADIUS));
    zeynep.visible = detailOpacity > 0.42;
    contactShadow.visible = zeynep.visible;
    contactShadowMaterial.opacity = 0.3 * detailOpacity;
    zeynep.lookAt(activeCamera.position.x, zeynep.position.y, activeCamera.position.z);
    zeynep.userData.setPose(moving ? 'back' : 'front');
    if (moving) zeynep.userData.updateRun(elapsedSeconds);
    else zeynep.userData.updateIdle(elapsedSeconds, 0.8);
  }

  function getCharacterAnchor(islandId) {
    const animation = detailedRegion?.islandAnimationById.get(islandId);
    if (!animation) return null;
    const islandScale = animation.island.radius / ORIGINAL_START_ISLAND_RADIUS;
    const offset = new THREE.Vector2(2.8, -1.6).multiplyScalar(islandScale);
    const topY = getIslandTopY(animation);
    return {
      character: new THREE.Vector3(animation.base.x + offset.x, topY + 0.03, animation.base.z + offset.y),
      shadow: new THREE.Vector3(animation.base.x + offset.x, topY + 0.015, animation.base.z + offset.y),
      scale: animation.island.radius * (6.3 / ORIGINAL_START_ISLAND_RADIUS),
    };
  }

  function moveCharacterTo(islandId, startedAt, duration = 0.8) {
    const destination = getCharacterAnchor(islandId);
    if (!destination) return Promise.resolve(false);
    moveMimarTo(islandId, startedAt, duration <= 0 ? 0 : MIMAR_MOVE_DURATION);
    if (characterMove) characterMove.resolve?.(false);
    if (duration <= 0) {
      characterIslandId = islandId;
      characterMove = null;
      zeynep.position.copy(destination.character);
      contactShadow.position.copy(destination.shadow);
      zeynep.scale.setScalar(destination.scale);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      characterMove = {
        fromIslandId: characterIslandId,
        toIslandId: islandId,
        startedAt,
        duration,
        fromCharacter: zeynep.position.clone(),
        fromShadow: contactShadow.position.clone(),
        fromScale: zeynep.scale.x,
        resolve,
      };
    });
  }

  function getMimarAnchor(islandId) {
    const animation = detailedRegion?.islandAnimationById.get(islandId);
    if (!animation) return null;
    const island = animation.island;
    const characterAnchor = getCharacterAnchor(islandId);
    const offset = MIMAR_LOCAL_OFFSET_DIRECTION.clone()
      .rotateAround(new THREE.Vector2(), animation.rotation)
      .multiplyScalar(island.radius * MIMAR_CHARACTER_OFFSET_RATIO);
    return {
      position: new THREE.Vector3(
        characterAnchor.character.x + offset.x,
        getIslandTopY(animation) + MIMAR_HOVER_HEIGHT,
        characterAnchor.character.z + offset.y,
      ),
      scale: island.radius * MIMAR_HEIGHT_RATIO * 0.5,
    };
  }

  function getMimarMetrics() {
    const animation = detailedRegion?.islandAnimationById.get(mimarIslandId);
    const characterAnchor = getCharacterAnchor(mimarIslandId);
    if (!animation || !characterAnchor) return null;
    const islandTopY = getIslandTopY(animation);
    return {
      islandRadius: animation.island.radius,
      islandTopY,
      centerHeight: mimar.position.y - islandTopY,
      horizontalCharacterOffset: Math.hypot(
        mimar.position.x - characterAnchor.character.x,
        mimar.position.z - characterAnchor.character.z,
      ),
      visibleHeight: mimar.scale.y * 2,
    };
  }

  function moveMimarTo(islandId, startedAt, duration = MIMAR_MOVE_DURATION) {
    const destination = getMimarAnchor(islandId);
    if (!destination) return false;
    if (duration <= 0) {
      mimarIslandId = islandId;
      mimarMove = null;
      mimar.position.copy(destination.position);
      mimar.scale.setScalar(destination.scale);
      return true;
    }
    mimarMove = {
      fromIslandId: mimarIslandId,
      toIslandId: islandId,
      startedAt,
      duration,
      fromPosition: mimar.position.clone(),
      fromScale: mimar.scale.x,
    };
    return true;
  }

  function updateMimar(elapsedSeconds) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let anchor;
    if (mimarMove) {
      const raw = THREE.MathUtils.clamp(
        (elapsedSeconds - mimarMove.startedAt) / mimarMove.duration,
        0,
        1,
      );
      const amount = easeInOutCubic(raw);
      const source = getMimarAnchor(mimarMove.fromIslandId);
      const destination = getMimarAnchor(mimarMove.toIslandId);
      if (destination) {
        const sourcePosition = source?.position || mimarMove.fromPosition;
        const sourceScale = source?.scale || mimarMove.fromScale;
        anchor = {
          position: sourcePosition.clone().lerp(destination.position, amount),
          scale: THREE.MathUtils.lerp(sourceScale, destination.scale, amount),
        };
        anchor.position.y += Math.sin(amount * Math.PI) * 2.4;
      }
      if (raw >= 1) {
        mimarIslandId = mimarMove.toIslandId;
        mimarMove = null;
      }
    }
    anchor ||= getMimarAnchor(mimarIslandId);
    if (!anchor) return;

    const delta = Math.max(0, Math.min(0.05, elapsedSeconds - mimarLastElapsed));
    mimarLastElapsed = elapsedSeconds;
    const motionScale = reducedMotion ? 0.15 : 1;
    const rotationSpeed = MIMAR_IDLE_ROTATION_SPEED
      * (mimarSpeaking ? MIMAR_SPEAKING_ROTATION_MULTIPLIER : 1)
      * motionScale;
    mimarRotation += delta * rotationSpeed;
    const breath = reducedMotion ? 1 : 1 + Math.sin(elapsedSeconds * 1.35) * 0.04;
    mimar.position.copy(anchor.position);
    mimar.rotation.y = mimarRotation;
    mimar.scale.setScalar(anchor.scale * breath);
    mimar.visible = detailOpacity > 0.35;
    mimar.material.opacity = (mimarSpeaking ? 1 : 0.72) * Math.min(1, detailOpacity / 0.65);
    mimar.material.color.setRGB(
      ...(mimarSpeaking ? [1.62, 3.84, 4.44] : [0.456, 1.44, 1.74]),
    );
    updateMimarGlitch(elapsedSeconds, reducedMotion);
  }

  function updateMimarGlitch(elapsedSeconds, reducedMotion) {
    restoreMimarGeometry();
    if (reducedMotion && !mimarForcedGlitch) return;
    if (!mimarForcedGlitch && mimarGlitchStartedAt === null && elapsedSeconds >= mimarNextGlitchAt) {
      mimarGlitchStartedAt = elapsedSeconds;
      mimarGlitchCycle += 1;
    }
    const glitchAge = mimarForcedGlitch ? 0.054 : elapsedSeconds - (mimarGlitchStartedAt ?? elapsedSeconds);
    const glitchActive = mimarForcedGlitch
      || (mimarGlitchStartedAt !== null && glitchAge < MIMAR_GLITCH_DURATION);
    if (!glitchActive) {
      if (mimarGlitchStartedAt !== null) {
        mimarGlitchStartedAt = null;
        mimarNextGlitchAt = elapsedSeconds + 8 + hashUnit(`mimar-glitch-${mimarGlitchCycle}`) * 7;
      }
      return;
    }
    const position = mimarGeometry.getAttribute('position');
    const phase = mimarForcedGlitch ? 2 : Math.min(2, Math.floor(glitchAge / 0.04));
    for (let index = 0; index < position.count; index += 1) {
      const offset = (hashUnit(`mimar-${mimarGlitchCycle}-${phase}-${index}`) - 0.5) * 0.22;
      position.setXYZ(
        index,
        mimarBasePositions[index * 3] + offset,
        mimarBasePositions[index * 3 + 1] + offset * 0.55,
        mimarBasePositions[index * 3 + 2] - offset * 0.7,
      );
    }
    position.needsUpdate = true;
  }

  function restoreMimarGeometry() {
    const position = mimarGeometry.getAttribute('position');
    position.array.set(mimarBasePositions);
    position.needsUpdate = true;
  }

  function setMimarSpeaking(speaking) {
    mimarSpeaking = Boolean(speaking);
  }

  function setMimarGlitch(forced) {
    mimarForcedGlitch = Boolean(forced);
    if (!mimarForcedGlitch) restoreMimarGeometry();
  }

  function setMapBlend(regionAmount, worldAmount) {
    regionBlend = THREE.MathUtils.clamp(regionAmount, 0, 1);
    worldBlend = THREE.MathUtils.clamp(worldAmount, 0, 1);
    detailOpacity = 1 - regionBlend * 0.42 - worldBlend * 0.48;
    if (detailedRegion) {
      detailedRegion.bodyMaterial.opacity = detailOpacity;
      detailedRegion.stoneTopMaterial.opacity = detailOpacity;
      detailedRegion.grassTopMaterial.opacity = detailOpacity;
      detailedRegion.ringMaterial.opacity = 0.96 - regionBlend * 0.18 - worldBlend * 0.5;
      detailedRegion.bridgeVisuals.forEach((visual) => visual.setOpacity(1 - worldBlend * 0.62));
    }
    regionBridgeVisuals.forEach((visual) => visual.setOpacity(worldBlend));
    refreshRegionNodes();
  }

  function refreshRegionNodes() {
    data.regions.forEach((region) => {
      const node = regionNodes.get(region.id);
      const active = region.id === detailedRegion?.activeRegion.id;
      const reachable = reachableRegionIds.has(region.id);
      node.userData.locked = !reachable;
      node.userData.active = active;
      node.material.color.setHex(active ? normalizedPalette(region.id).node : reachable ? 0x466b76 : 0x344e64);
      if (active) {
        node.visible = worldBlend > 0.01;
        node.material.opacity = worldBlend * 0.94;
      } else {
        node.visible = true;
        node.material.opacity = Math.min(1, 0.58 + regionBlend * 0.06 + worldBlend * 0.36);
      }
    });
  }

  function syncProgress(snapshot) {
    reachableRegionIds = getReachableRegionsFromSnapshot(snapshot);
    for (const bridge of [...data.bridges, ...data.regionBridges]) {
      setBridgeState(bridge.id, snapshot.openBridges.has(bridge.id) ? 'open' : 'closed');
    }
    refreshRegionNodes();
  }

  function getReachableRegionsFromSnapshot(snapshot) {
    const visited = new Set();
    const queue = [snapshot.activeRegionId];
    while (queue.length) {
      const regionId = queue.shift();
      if (visited.has(regionId)) continue;
      visited.add(regionId);
      data.regionBridges.forEach((bridge) => {
        if (!snapshot.openBridges.has(bridge.id)) return;
        if (bridge.from === regionId) queue.push(bridge.to);
        if (bridge.to === regionId) queue.push(bridge.from);
      });
    }
    return visited;
  }

  function setBridgeState(bridgeId, state, options = {}) {
    bridgeStateOverrides.set(bridgeId, state);
    const visual = [...(detailedRegion?.bridgeVisuals || []), ...regionBridgeVisuals]
      .find((item) => item.bridge.id === bridgeId);
    if (!visual) return false;
    if (options.animate && state === 'open') {
      visual.animateOpen(options.startedAt || 0, options.duration || 1.2);
    } else {
      visual.setState(state);
    }
    return true;
  }

  function getIslandPosition(islandId) {
    return islandWorldPositions.get(islandId)?.clone() || new THREE.Vector3();
  }

  function getBridgeHit(intersections) {
    for (const hit of intersections) {
      const visual = hit.object.userData.bridgeVisual;
      if (visual) return visual;
    }
    return null;
  }

  function getRegionBridge(fromRegionId, toRegionId, openOnly = false) {
    return regionBridgeVisuals.find((visual) => {
      const connects = (visual.bridge.from === fromRegionId && visual.bridge.to === toRegionId)
        || (visual.bridge.from === toRegionId && visual.bridge.to === fromRegionId);
      return connects && (!openOnly || bridgeStateOverrides.get(visual.bridge.id) === 'open');
    }) || null;
  }

  createDetailedRegion(data.regions[0].id);
  moveCharacterTo(characterIslandId, 0, 0);
  setMapBlend(0, 0);
  const ready = Promise.all([textures.ready, zeynep.userData.textureReady, ghostTextureReady]);

  return {
    scene,
    regionNodes,
    regionBridgePickMeshes,
    regionBridgeVisuals,
    islandWorldPositions,
    ready,
    update,
    setMapBlend,
    selectIsland,
    createDetailedRegion,
    disposeDetailedRegion,
    moveCharacterTo,
    setMimarSpeaking,
    setMimarGlitch,
    setGhostPlayers,
    getGhostPositions,
    syncProgress,
    setBridgeState,
    getIslandPosition,
    getBridgeHit,
    getRegionBridge,
    get activeRegion() { return detailedRegion.activeRegion; },
    get activeIslands() { return detailedRegion.activeIslands; },
    get islandPickMeshes() { return [detailedRegion.tops, detailedRegion.stoneTops, detailedRegion.bodies]; },
    get rings() { return detailedRegion.rings; },
    get tops() { return detailedRegion.tops; },
    get landmarks() { return detailedRegion.landmarks; },
    get bridgePickMeshes() { return detailedRegion.bridgePickMeshes; },
    get bridgeVisuals() { return detailedRegion.bridgeVisuals; },
    get bridgeGeometryChecks() { return detailedRegion.bridgeGeometryChecks; },
    get geometryDiagnostics() { return detailedRegion.geometryDiagnostics; },
    get selectedIslandId() { return selectedIslandId; },
    get characterIslandId() { return characterIslandId; },
    get mimarIslandId() { return mimarIslandId; },
    get mimar() { return mimar; },
    get mimarMetrics() { return getMimarMetrics(); },
    get mimarSpeaking() { return mimarSpeaking; },
    get mimarForcedGlitch() { return mimarForcedGlitch; },
    dispose() {
      disposeDetailedRegion();
      regionBridgeVisuals.forEach((visual) => visual.dispose());
      globalResources.geometries.forEach((item) => item.dispose?.());
      globalResources.materials.forEach((item) => item.dispose?.());
      globalResources.textures.forEach((item) => item.dispose?.());
    },
  };
}

function normalizedPalette(regionId) {
  const palette = PALETTES[regionId] || PALETTES.helios;
  return { ...palette, grass: palette.grass || palette.top };
}

function createIslandBodyGeometry() {
  const rim = new THREE.CylinderGeometry(1, 0.9, ISLAND_RIM_HEIGHT, 10, 1, true);
  rim.translate(0, ISLAND_RIM_CENTER_Y, 0);
  const underside = new THREE.ConeGeometry(0.9, ISLAND_UNDERSIDE_HEIGHT, 10, 2, true);
  underside.rotateZ(Math.PI);
  underside.translate(0, ISLAND_UNDERSIDE_CENTER_Y, 0);
  const geometry = mergeGeometries([rim, underside], false);
  rim.dispose();
  underside.dispose();
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const angle = Math.atan2(z, x);
    const depth = THREE.MathUtils.clamp(-y / 2.12, 0, 1);
    const edgeNoise = Math.sin(angle * 3 + 0.71) * 0.15
      + Math.sin(angle * 7 - 1.38) * 0.076
      + Math.sin(y * 4.7 + angle * 2) * 0.05;
    const taperWarp = 1 + edgeNoise * (0.35 + depth * 0.65);
    position.setXYZ(
      index,
      x * taperWarp + depth * 0.32,
      y,
      z * taperWarp - depth * 0.2,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.normalizeNormals();
  return geometry;
}

function createIslandGeometryDiagnostics({
  islandGeometry,
  stoneTopGeometry,
  grassTopGeometry,
  grassTopMaterial,
  bodies,
  stoneTops,
  tops,
  animation,
}) {
  const bodyPosition = islandGeometry.getAttribute('position');
  let bodyMaxLocalY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < bodyPosition.count; index += 1) {
    bodyMaxLocalY = Math.max(bodyMaxLocalY, bodyPosition.getY(index));
  }
  const topY = getIslandTopY(animation);
  return {
    bodyVertexCount: bodyPosition.count,
    bodyMaxLocalY,
    bodyMaxWorldY: getIslandCenterY(animation) + bodyMaxLocalY * getIslandBodyScaleY(animation),
    bodyHorizontalTopTriangles: countHorizontalTopTriangles(islandGeometry, bodyMaxLocalY),
    stoneVertexCount: stoneTopGeometry.getAttribute('position').count,
    stoneWorldY: topY,
    grassVertexCount: grassTopGeometry.getAttribute('position').count,
    grassWorldY: topY + GRASS_SURFACE_LIFT,
    grassColor: `0x${grassTopMaterial.color.getHexString()}`,
    grassDepthTest: grassTopMaterial.depthTest,
    grassDepthWrite: grassTopMaterial.depthWrite,
    renderOrder: {
      body: bodies.renderOrder,
      stone: stoneTops.renderOrder,
      grass: tops.renderOrder,
    },
  };
}

function countHorizontalTopTriangles(geometry, topY) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;
  let horizontalTriangles = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const vertexIndices = [0, 1, 2].map((offset) => (
      index ? index.getX(triangle * 3 + offset) : triangle * 3 + offset
    ));
    if (vertexIndices.every((vertexIndex) => Math.abs(position.getY(vertexIndex) - topY) < 1e-6)) {
      horizontalTriangles += 1;
    }
  }
  return horizontalTriangles;
}

function createLandmarkSystem({ parent, activeIslands, islandAnimationById, resources, namePrefix }) {
  const landmarkDefinitions = {
    'broken-column': {
      geometry: createBrokenColumnGeometry(),
      material: new THREE.MeshStandardMaterial({
        color: 0xd9cbb0,
        roughness: 0.82,
        metalness: 0,
        flatShading: true,
        transparent: true,
      }),
      scale: 1.45,
    },
    tree: createTreeLandmarkDefinition(),
    obelisk: {
      geometry: createObeliskGeometry(),
      material: new THREE.MeshStandardMaterial({
        color: 0xd9cbb0,
        roughness: 0.8,
        metalness: 0,
        flatShading: true,
        transparent: true,
      }),
      scale: 1.45,
    },
    arch: {
      geometry: createArchGeometry(),
      material: new THREE.MeshStandardMaterial({
        color: 0xd9cbb0,
        roughness: 0.84,
        metalness: 0,
        flatShading: true,
        transparent: true,
      }),
      scale: 1.55,
    },
  };

  const entriesByType = new Map(Object.keys(landmarkDefinitions).map((type) => [type, []]));
  activeIslands.forEach((island) => {
    const angle = hashUnit(`${island.id}-landmark-angle`) * Math.PI * 2;
    const distance = island.radius * (0.2 + hashUnit(`${island.id}-landmark-distance`) * 0.11);
    const offset = island.id === 'helios-01'
      ? new THREE.Vector2(-2.7, 1.8).multiplyScalar(island.radius / ORIGINAL_START_ISLAND_RADIUS)
      : new THREE.Vector2(Math.cos(angle) * distance, Math.sin(angle) * distance);
    entriesByType.get(island.landmark).push({
      island,
      animation: islandAnimationById.get(island.id),
      offset,
      rotation: hashUnit(`${island.id}-landmark-rotation`) * Math.PI * 2,
      size: 0.92 + hashUnit(`${island.id}-landmark-size`) * 0.16,
      originalRadius: island.radius / ISLAND_RADIUS_SCALE,
    });
  });

  const dummy = new THREE.Object3D();
  const meshes = new Map();
  const materials = [];
  for (const [type, definition] of Object.entries(landmarkDefinitions)) {
    const entries = entriesByType.get(type);
    const mesh = new THREE.InstancedMesh(definition.geometry, definition.material, entries.length);
    mesh.name = `${namePrefix} ${type} landmarks (instanced)`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    meshes.set(type, { mesh, entries, definition });
    materials.push(definition.material);
    resources.geometries.push(definition.geometry);
  }
  resources.materials.push(...materials);
  const treeTexture = landmarkDefinitions.tree.material.map;
  if (treeTexture) resources.textures.push(treeTexture);

  function update(opacity) {
    for (const { mesh, entries, definition } of meshes.values()) {
      definition.material.opacity = opacity;
      entries.forEach((entry, index) => {
        const { base } = entry.animation;
        dummy.position.set(
          base.x + entry.offset.x,
          getIslandTopY(entry.animation) + 0.02,
          base.z + entry.offset.y,
        );
        dummy.rotation.set(0, entry.rotation, 0);
        const scale = definition.scale * entry.size * (entry.island.radius / entry.originalRadius);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return {
    meshes,
    counts: Object.fromEntries([...entriesByType].map(([type, entries]) => [type, entries.length])),
    update,
  };
}

function createBrokenColumnGeometry() {
  const base = new THREE.CylinderGeometry(0.5, 0.56, 0.18, 8);
  base.translate(0, 0.09, 0);
  const shaft = new THREE.CylinderGeometry(0.25, 0.31, 1.5, 8);
  shaft.rotateZ(-0.1);
  shaft.translate(0.08, 0.91, 0);
  const brokenTop = new THREE.BoxGeometry(0.56, 0.18, 0.48);
  brokenTop.rotateZ(0.18);
  brokenTop.translate(-0.04, 1.69, 0.02);
  const geometry = mergeGeometries([base, shaft, brokenTop], false);
  base.dispose();
  shaft.dispose();
  brokenTop.dispose();
  return geometry;
}

function createTreeLandmarkDefinition() {
  const front = new THREE.PlaneGeometry(1.6, 2.7);
  front.translate(0, 1.35, 0);
  const side = front.clone();
  side.rotateY(Math.PI / 2);
  const geometry = mergeGeometries([front, side], false);
  front.dispose();
  side.dispose();
  const texture = createTreeTexture();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    alphaTest: 0.38,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  return { geometry, material, scale: 1.75 };
}

function createTreeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 384;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#5a4030';
  context.beginPath();
  context.moveTo(112, 366);
  context.lineTo(121, 166);
  context.lineTo(142, 166);
  context.lineTo(149, 366);
  context.closePath();
  context.fill();
  context.fillStyle = '#3f8a3f';
  [[128, 118, 82], [82, 174, 58], [178, 170, 61], [128, 202, 72]].forEach(([x, y, radius]) => {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });
  context.fillStyle = 'rgba(103, 169, 84, .74)';
  [[105, 91, 38], [157, 132, 32], [93, 186, 29]].forEach(([x, y, radius]) => {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  return texture;
}

function createObeliskGeometry() {
  const base = new THREE.BoxGeometry(0.82, 0.22, 0.82);
  base.translate(0, 0.11, 0);
  const shaft = new THREE.CylinderGeometry(0.08, 0.34, 2.6, 4, 1, false);
  shaft.translate(0, 1.5, 0);
  const geometry = mergeGeometries([base, shaft], false);
  base.dispose();
  shaft.dispose();
  return geometry;
}

function createArchGeometry() {
  const left = new THREE.BoxGeometry(0.3, 1.35, 0.38);
  left.translate(-0.67, 0.675, 0);
  const right = new THREE.BoxGeometry(0.3, 1.35, 0.38);
  right.translate(0.67, 0.675, 0);
  const crown = new THREE.TorusGeometry(0.67, 0.15, 4, 10, Math.PI);
  crown.translate(0, 1.34, 0);
  const geometry = mergeGeometries([left, right, crown], false);
  left.dispose();
  right.dispose();
  crown.dispose();
  return geometry;
}

function createBridgeMaterials(palette, resources) {
  const islandOpen = new THREE.MeshStandardMaterial({
    color: palette.glow,
    emissive: palette.glow,
    emissiveIntensity: 1.15,
    roughness: 0.48,
    transparent: true,
    toneMapped: false,
  });
  const islandClosed = new THREE.MeshStandardMaterial({
    color: 0x4a4a52,
    roughness: 0.88,
    transparent: true,
    opacity: 1,
  });
  const regionOpen = new THREE.MeshStandardMaterial({
    color: 0xe9c878,
    emissive: 0xe9b951,
    emissiveIntensity: 0.95,
    transparent: true,
    toneMapped: false,
  });
  const regionClosed = new THREE.MeshStandardMaterial({
    color: 0x4a4a52,
    roughness: 0.86,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  });
  resources.materials.push(islandOpen, islandClosed, regionOpen, regionClosed);
  return { islandOpen, islandClosed, regionOpen, regionClosed };
}

function getIslandCenterY(animation) {
  return animation.base.y + animation.bob;
}

function getIslandBodyScaleY(animation) {
  return Math.max(4.8, animation.island.radius * 0.72);
}

function getIslandTopY(animation) {
  return getIslandCenterY(animation) + ISLAND_TOP_LOCAL_Y * getIslandBodyScaleY(animation);
}

function getIslandRimAxes(animation) {
  return {
    radiusX: animation.island.radius * animation.scaleX,
    radiusZ: animation.island.radius * animation.scaleZ,
  };
}

function getIslandRimRadiusInDirection(animation, worldDirection) {
  const { rotation } = animation;
  const { radiusX, radiusZ } = getIslandRimAxes(animation);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const localDirectionX = cos * worldDirection.x - sin * worldDirection.z;
  const localDirectionZ = sin * worldDirection.x + cos * worldDirection.z;
  return 1 / Math.sqrt(
    (localDirectionX * localDirectionX) / (radiusX * radiusX)
      + (localDirectionZ * localDirectionZ) / (radiusZ * radiusZ),
  );
}

function createIslandBridgeCurvePoints(fromAnimation, toAnimation, sag, tubeRadius) {
  const horizontalDirection = toAnimation.base.clone().sub(fromAnimation.base);
  horizontalDirection.y = 0;
  if (horizontalDirection.lengthSq() === 0) horizontalDirection.set(1, 0, 0);
  horizontalDirection.normalize();

  const startEdge = getIslandBridgeEdge(fromAnimation, horizontalDirection, tubeRadius);
  const endEdge = getIslandBridgeEdge(toAnimation, horizontalDirection.clone().negate(), tubeRadius);
  const distance = startEdge.distanceTo(endEdge);
  const sagDepth = Math.min(sag, distance * 0.13);
  const saggingMidpoint = startEdge.clone().lerp(endEdge, 0.5);
  saggingMidpoint.y -= sagDepth;

  return [
    startEdge,
    startEdge.clone().addScaledVector(horizontalDirection, BRIDGE_CONTROL_OFFSET),
    saggingMidpoint,
    endEdge.clone().addScaledVector(horizontalDirection, -BRIDGE_CONTROL_OFFSET),
    endEdge,
  ];
}

function getIslandBridgeEdge(animation, outwardDirection, tubeRadius) {
  const effectiveRadius = getIslandRimRadiusInDirection(animation, outwardDirection);
  return animation.base.clone()
    .addScaledVector(outwardDirection, effectiveRadius * BRIDGE_EDGE_CLEARANCE)
    .setY(getIslandTopY(animation) + tubeRadius + BRIDGE_SURFACE_CLEARANCE);
}

function validateIslandBridgeCurve({ bridge, curve, endpointAnimations, sampleCount, debugMode }) {
  let minimumClearance = Number.POSITIVE_INFINITY;
  const violations = [];
  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const point = curve.getPoint(sampleIndex / sampleCount);
    endpointAnimations.forEach((animation) => {
      const clearance = getIslandVolumeClearance(point, animation, ISLAND_BRIDGE_RADIUS);
      minimumClearance = Math.min(minimumClearance, clearance);
      if (clearance < 0) {
        violations.push({ islandId: animation.island.id, sampleIndex, clearance });
      }
    });
  }
  if (debugMode && violations.length > 0) {
    violations.forEach(({ islandId, sampleIndex, clearance }) => {
      console.warn(
        `[bridge-clearance] ${bridge.id} / ${islandId} / örnek ${sampleIndex}: ${clearance.toFixed(3)} birim ihlal`,
      );
    });
  }
  return { bridgeId: bridge.id, sampleCount, minimumClearance, violations: violations.length };
}

function getIslandVolumeClearance(point, animation, tubeRadius) {
  const { radiusX, radiusZ } = getIslandRimAxes(animation);
  const cos = Math.cos(animation.rotation);
  const sin = Math.sin(animation.rotation);
  const worldX = point.x - animation.base.x;
  const worldZ = point.z - animation.base.z;
  const localX = cos * worldX - sin * worldZ;
  const localZ = sin * worldX + cos * worldZ;
  const expandedRadiusX = radiusX + tubeRadius;
  const expandedRadiusZ = radiusZ + tubeRadius;
  const normalizedDistance = Math.sqrt(
    (localX * localX) / (expandedRadiusX * expandedRadiusX)
      + (localZ * localZ) / (expandedRadiusZ * expandedRadiusZ),
  );
  const horizontalClearance = (normalizedDistance - 1) * Math.min(expandedRadiusX, expandedRadiusZ);
  const topClearance = point.y - (getIslandTopY(animation) + tubeRadius);
  const bodyBottomY = getIslandCenterY(animation) + ISLAND_BOTTOM_LOCAL_Y * getIslandBodyScaleY(animation);
  const bottomClearance = bodyBottomY - tubeRadius - point.y;
  return Math.max(horizontalClearance, topClearance, bottomClearance);
}

function createBridgeVisual({
  bridge,
  from,
  to,
  curvePoints,
  radius,
  openMaterial,
  closedMaterial,
  sag,
  tubularSegments,
  endpointAnimations = null,
}) {
  const group = new THREE.Group();
  group.name = bridge.id;
  const openVisualMaterial = openMaterial.clone();
  const closedVisualMaterial = closedMaterial.clone();
  openVisualMaterial.transparent = true;
  closedVisualMaterial.transparent = true;
  const distance = from.distanceTo(to);
  const direction = to.clone().sub(from);
  const points = curvePoints || [
    from,
    from.clone().addScaledVector(direction, 0.32).add(new THREE.Vector3(0, -Math.min(sag, distance * 0.13), 0)),
    from.clone().addScaledVector(direction, 0.68).add(new THREE.Vector3(0, -Math.min(sag, distance * 0.13), 0)),
    to,
  ];
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const radialSegments = 5;
  const openGeometry = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  addBridgeProgressAttribute(openGeometry, 0, 1, tubularSegments, radialSegments);
  const openMesh = new THREE.Mesh(openGeometry, openVisualMaterial);
  openMesh.name = `${bridge.id} open tube`;
  group.add(openMesh);

  const closedSegmentGeometries = [];
  const closedRadius = radius * 0.7;
  const dashCount = 9;
  for (let index = 0; index < dashCount; index += 1) {
    const startT = index / dashCount;
    const endT = Math.min(1, startT + 0.58 / dashCount);
    const middleT = (startT + endT) / 2;
    const dashTubularSegments = Math.max(3, Math.floor(tubularSegments / dashCount));
    const segmentCurve = new THREE.CatmullRomCurve3([
      curve.getPoint(startT),
      curve.getPoint(middleT),
      curve.getPoint(endT),
    ], false, 'centripetal');
    const dashGeometry = new THREE.TubeGeometry(
      segmentCurve,
      dashTubularSegments,
      closedRadius,
      radialSegments,
      false,
    );
    addBridgeProgressAttribute(dashGeometry, startT, endT, dashTubularSegments, radialSegments);
    closedSegmentGeometries.push(dashGeometry);
  }
  const closedGeometry = mergeGeometries(closedSegmentGeometries, false);
  closedSegmentGeometries.forEach((geometry) => geometry.dispose());
  const closedMesh = new THREE.Mesh(closedGeometry, closedVisualMaterial);
  closedMesh.name = `${bridge.id} merged closed dashes`;
  group.add(closedMesh);

  const state = { value: bridge.state };
  let opacityScale = 1;
  let animation = null;
  let openWeight = bridge.state === 'open' ? 1 : 0;
  let closedWeight = bridge.state === 'closed' ? 1 : 0;
  const pickMeshes = [openMesh, closedMesh];
  const openDeformer = createBridgeVerticalDeformer(openGeometry);
  const closedDeformer = createBridgeVerticalDeformer(closedGeometry);
  const visual = {
    group,
    bridge,
    curve,
    pickMeshes,
    get state() { return state.value; },
    toggle() { this.setState(state.value === 'open' ? 'closed' : 'open'); },
    setState(nextState) {
      animation = null;
      state.value = nextState;
      openWeight = nextState === 'open' ? 1 : 0;
      closedWeight = nextState === 'closed' ? 1 : 0;
      applyOpacity();
    },
    animateOpen(startedAt, duration = 1.2) {
      state.value = 'open';
      animation = { startedAt, duration };
      openWeight = 0;
      closedWeight = 1;
      applyOpacity();
    },
    updateAnimation(elapsedSeconds) {
      if (!animation) return;
      const raw = THREE.MathUtils.clamp(
        (elapsedSeconds - animation.startedAt) / animation.duration,
        0,
        1,
      );
      const progress = easeInOutCubic(raw);
      openWeight = progress;
      closedWeight = 1 - progress;
      applyOpacity();
      if (raw >= 1) animation = null;
    },
    updateEndpointMotion() {
      if (!endpointAnimations) return;
      const [fromAnimation, toAnimation] = endpointAnimations;
      openDeformer.update(fromAnimation.bob, toAnimation.bob);
      closedDeformer.update(fromAnimation.bob, toAnimation.bob);
    },
    setOpacity(amount) {
      opacityScale = THREE.MathUtils.clamp(amount, 0, 1);
      applyOpacity();
    },
    dispose() {
      openGeometry.dispose();
      closedGeometry.dispose();
      openVisualMaterial.dispose();
      closedVisualMaterial.dispose();
    },
  };
  function applyOpacity() {
    group.visible = opacityScale > 0.01;
    openMesh.visible = group.visible && openWeight > 0.01;
    closedMesh.visible = group.visible && closedWeight > 0.01;
    openVisualMaterial.opacity = opacityScale * openWeight;
    closedVisualMaterial.opacity = opacityScale * closedWeight;
    openVisualMaterial.depthWrite = openWeight > 0.5;
    closedVisualMaterial.depthWrite = closedWeight > 0.5;
  }
  pickMeshes.forEach((mesh) => { mesh.userData.bridgeVisual = visual; });
  visual.setState(bridge.state);
  return visual;
}

function addBridgeProgressAttribute(geometry, startT, endT, tubularSegments, radialSegments) {
  const rowSize = radialSegments + 1;
  const progress = new Float32Array(geometry.getAttribute('position').count);
  for (let index = 0; index < progress.length; index += 1) {
    const row = Math.min(tubularSegments, Math.floor(index / rowSize));
    progress[index] = THREE.MathUtils.lerp(startT, endT, row / tubularSegments);
  }
  geometry.setAttribute('bridgeProgress', new THREE.BufferAttribute(progress, 1));
}

function createBridgeVerticalDeformer(geometry) {
  const position = geometry.getAttribute('position');
  const progress = geometry.getAttribute('bridgeProgress');
  const baseY = new Float32Array(position.count);
  for (let index = 0; index < position.count; index += 1) baseY[index] = position.getY(index);

  return {
    update(fromBob, toBob) {
      for (let index = 0; index < position.count; index += 1) {
        position.setY(index, baseY[index] + THREE.MathUtils.lerp(fromBob, toBob, progress.getX(index)));
      }
      position.needsUpdate = true;
    },
  };
}

function createRegionNode(region, active, resources) {
  const palette = PALETTES[region.id];
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  geometry.scale(27, 8.5, 22);
  geometry.rotateY(hashUnit(region.id) * Math.PI);
  const material = new THREE.MeshStandardMaterial({
    color: active ? palette.node : 0x344e64,
    roughness: 0.94,
    metalness: 0.01,
    transparent: true,
    opacity: active ? 0 : 0.62,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${region.name} region silhouette`;
  mesh.position.copy(vectorFrom(region.position)).add(new THREE.Vector3(0, -5, 0));
  mesh.userData.regionId = region.id;
  mesh.userData.locked = !active;
  mesh.visible = !active;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  resources.geometries.push(geometry);
  resources.materials.push(material);
  return mesh;
}

function createLights(scene) {
  const hemisphere = new THREE.HemisphereLight(0x9ec5ff, 0x6b5a48, 1.6);
  const sun = new THREE.DirectionalLight(0xffd2a0, 2.0);
  sun.position.set(130, 150, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isMobileQuality() ? 512 : 1024, isMobileQuality() ? 512 : 1024);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.camera.far = 520;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.025;

  const cameraFill = new THREE.DirectionalLight(0xffffff, 0.5);
  const cameraFillTarget = new THREE.Object3D();
  cameraFill.name = 'Camera direction fill';
  cameraFill.castShadow = false;
  cameraFill.target = cameraFillTarget;
  const viewDirection = new THREE.Vector3();
  scene.add(hemisphere, sun, cameraFill, cameraFillTarget);

  return {
    hemisphere,
    sun,
    cameraFill,
    update(camera) {
      camera.getWorldDirection(viewDirection);
      cameraFill.position.copy(camera.position);
      cameraFillTarget.position.copy(camera.position).addScaledVector(viewDirection, 100);
      cameraFill.updateMatrixWorld();
      cameraFillTarget.updateMatrixWorld();
    },
  };
}

function createSky(scene, resources) {
  const geometry = new THREE.SphereGeometry(1050, 24, 14);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(0xf0a06f) },
      middle: { value: new THREE.Color(0x43bfd0) },
      zenith: { value: new THREE.Color(0x272452) },
    },
    vertexShader: `varying vec3 vDirection; void main() { vDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 middle;
      uniform vec3 zenith;
      varying vec3 vDirection;
      void main() {
        float lowerMix = smoothstep(-0.32, 0.2, vDirection.y);
        float upperMix = smoothstep(0.2, 0.92, vDirection.y);
        vec3 color = mix(horizon, middle, lowerMix);
        color = mix(color, zenith, upperMix);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.renderOrder = -10;
  scene.add(sky);
  resources.geometries.push(geometry);
  resources.materials.push(material);
}

function createMist(scene, resources) {
  const geometry = new THREE.CircleGeometry(780, 48);
  const material = new THREE.MeshBasicMaterial({
    color: 0xd58b72,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  [-42, -60, -82].forEach((height, index) => {
    const mist = new THREE.Mesh(geometry, material);
    mist.rotation.x = -Math.PI / 2;
    mist.position.set(90, height, 20);
    mist.scale.setScalar(1 - index * 0.08);
    scene.add(mist);
  });
  resources.geometries.push(geometry);
  resources.materials.push(material);
}

function createClouds(scene, resources) {
  const texture = createCloudTexture();
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: 0xd7f1eb,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    fog: true,
  });
  const count = isMobileQuality()
    ? RENDER_CONFIG.quality.cloudCountMobile
    : RENDER_CONFIG.quality.cloudCountDesktop;
  let seed = 1947;
  for (let index = 0; index < count; index += 1) {
    seed = (seed * 16807) % 2147483647;
    const x = ((seed / 2147483647) - 0.5) * 820;
    seed = (seed * 16807) % 2147483647;
    const y = 12 + (seed / 2147483647) * 145;
    seed = (seed * 16807) % 2147483647;
    const z = ((seed / 2147483647) - 0.5) * 610;
    seed = (seed * 16807) % 2147483647;
    const scale = 44 + (seed / 2147483647) * 62;
    const cloud = new THREE.Sprite(material);
    cloud.position.set(x, y, z);
    cloud.scale.set(scale * 1.8, scale, 1);
    scene.add(cloud);
  }
  resources.textures.push(texture);
  resources.materials.push(material);
}

function createCloudTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 64, 4, 128, 64, 92);
  gradient.addColorStop(0, 'rgba(255,255,255,.92)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,.58)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

function vectorFrom(values) { return new THREE.Vector3(values[0], values[1], values[2]); }

function hashUnit(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
