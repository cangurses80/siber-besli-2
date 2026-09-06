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

export function createWorldScene({ renderer, textures, data }) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(RENDER_CONFIG.world.fogColor, RENDER_CONFIG.world.fogDensity);
  const activeRegion = data.regions[0];
  const activeIslands = activeRegion.islands.map((id) => data.islands.find((island) => island.id === id));
  const islandById = new Map(data.islands.map((island) => [island.id, island]));
  const regionById = new Map(data.regions.map((region) => [region.id, region]));
  const islandWorldPositions = new Map();
  const resources = { geometries: [], materials: [], textures: [] };

  createSky(scene, resources);
  createMist(scene, resources);
  const lighting = createLights(scene);
  createClouds(scene, resources);

  const islandGeometry = createIslandBodyGeometry();
  const stoneTopGeometry = new THREE.CylinderGeometry(1, 0.94, 0.3, 12, 1, false);
  stoneTopGeometry.translate(0, 0.05, 0);
  const grassTopGeometry = new THREE.CylinderGeometry(0.77, 0.79, 0.14, 14, 1, false);
  grassTopGeometry.translate(0, 0.24, 0);
  const ringGeometry = new THREE.TorusGeometry(1.035, 0.022, 4, 36);
  ringGeometry.rotateX(Math.PI / 2);
  ringGeometry.translate(0, 0.21, 0);
  resources.geometries.push(islandGeometry, stoneTopGeometry, grassTopGeometry, ringGeometry);

  const palette = PALETTES[activeRegion.id];
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
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
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
  resources.materials.push(bodyMaterial, stoneTopMaterial, grassTopMaterial, ringMaterial);

  const bodies = new THREE.InstancedMesh(islandGeometry, bodyMaterial, activeIslands.length);
  const stoneTops = new THREE.InstancedMesh(stoneTopGeometry, stoneTopMaterial, activeIslands.length);
  const tops = new THREE.InstancedMesh(grassTopGeometry, grassTopMaterial, activeIslands.length);
  const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, activeIslands.length);
  bodies.name = 'Tutorial island bodies (instanced)';
  stoneTops.name = 'Tutorial island PBR stone bands (instanced)';
  tops.name = 'Tutorial island moss centers (instanced)';
  rings.name = 'Tutorial island emissive rims (instanced)';
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  stoneTops.castShadow = true;
  stoneTops.receiveShadow = true;
  tops.castShadow = true;
  tops.receiveShadow = true;
  bodies.frustumCulled = false;
  stoneTops.frustumCulled = false;
  tops.frustumCulled = false;
  rings.frustumCulled = false;
  bodies.userData.islandIds = activeIslands.map((island) => island.id);
  stoneTops.userData.islandIds = activeIslands.map((island) => island.id);
  tops.userData.islandIds = activeIslands.map((island) => island.id);
  rings.userData.islandIds = activeIslands.map((island) => island.id);
  scene.add(bodies, stoneTops, tops, rings);

  const baseMatrix = new THREE.Object3D();
  const islandAnimation = activeIslands.map((island, index) => {
    const base = vectorFrom(island.localPosition).add(vectorFrom(activeRegion.position));
    islandWorldPositions.set(island.id, base.clone());
    const phase = hashUnit(island.id) * Math.PI * 2;
    rings.setColorAt(index, new THREE.Color(palette.glow));
    const grassColor = new THREE.Color(palette.grass);
    grassColor.offsetHSL(
      (hashUnit(`${island.id}-hue`) - 0.5) * 0.012,
      (hashUnit(`${island.id}-sat`) - 0.5) * 0.03,
      (hashUnit(`${island.id}-light`) - 0.5) * 0.05,
    );
    tops.setColorAt(index, grassColor);
    return {
      island,
      base,
      phase,
      bob: 0,
      scaleX: 0.94 + hashUnit(`${island.id}-x`) * 0.12,
      scaleZ: 0.94 + hashUnit(`${island.id}-z`) * 0.12,
    };
  });
  rings.instanceColor.needsUpdate = true;
  tops.instanceColor.needsUpdate = true;
  const islandAnimationById = new Map(islandAnimation.map((item) => [item.island.id, item]));
  const landmarks = createLandmarkSystem({ scene, activeIslands, islandAnimationById, resources });

  const bridgeMaterials = createBridgeMaterials(palette, resources);
  const bridgeVisuals = [];
  const bridgePickMeshes = [];
  const activeIslandBridges = data.bridges.filter((bridge) => islandById.get(bridge.from)?.regionId === activeRegion.id);
  activeIslandBridges.forEach((bridge) => {
    const from = islandWorldPositions.get(bridge.from);
    const to = islandWorldPositions.get(bridge.to);
    const visual = createBridgeVisual({
      bridge,
      from: from.clone().add(new THREE.Vector3(0, 0.3, 0)),
      to: to.clone().add(new THREE.Vector3(0, 0.3, 0)),
      radius: 0.23,
      openMaterial: bridgeMaterials.islandOpen,
      closedMaterial: bridgeMaterials.islandClosed,
      sag: 4.8,
      tubularSegments: 28,
    });
    scene.add(visual.group);
    bridgeVisuals.push(visual);
    bridgePickMeshes.push(...visual.pickMeshes);
  });

  const regionNodes = new Map();
  data.regions.forEach((region, index) => {
    const node = createRegionNode(region, index === 0, resources);
    scene.add(node);
    regionNodes.set(region.id, node);
  });

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
      openMaterial: bridgeMaterials.regionOpen,
      closedMaterial: bridgeMaterials.regionClosed,
      sag: 24,
      tubularSegments: 36,
    });
    visual.group.renderOrder = -1;
    scene.add(visual.group);
    regionBridgeVisuals.push(visual);
    regionBridgePickMeshes.push(...visual.pickMeshes);
  });

  const zeynep = createCharacter('Zeynep', 'front', { resources });
  zeynep.scale.setScalar(6.3);
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
  contactShadow.scale.set(2.7, 2.7, 2.7);
  contactShadow.renderOrder = 2;
  resources.geometries.push(contactShadowGeometry);
  resources.materials.push(contactShadowMaterial);
  scene.add(contactShadow, zeynep);

  let selectedIslandId = activeIslands[0].id;
  let detailOpacity = 1;
  let worldBlend = 0;

  function selectIsland(islandId) {
    if (!islandWorldPositions.has(islandId)) return;
    selectedIslandId = islandId;
    activeIslands.forEach((island, index) => {
      rings.setColorAt(index, new THREE.Color(island.id === islandId ? 0xfff5cf : palette.glow));
    });
    rings.instanceColor.needsUpdate = true;
  }

  function update(elapsedSeconds, activeCamera) {
    lighting.update(activeCamera);
    islandAnimation.forEach((item, index) => {
      item.bob = Math.sin(elapsedSeconds * 0.72 + item.phase) * 0.3;
      const radius = item.island.radius;
      baseMatrix.position.set(item.base.x, item.base.y + item.bob, item.base.z);
      baseMatrix.rotation.set(0, item.phase * 0.11, 0);
      baseMatrix.scale.set(
        radius * item.scaleX,
        Math.max(4.8, radius * 0.72),
        radius * item.scaleZ,
      );
      baseMatrix.updateMatrix();
      bodies.setMatrixAt(index, baseMatrix.matrix);

      baseMatrix.position.y = item.base.y + item.bob;
      baseMatrix.scale.set(radius * 0.97 * item.scaleX, 1, radius * 0.97 * item.scaleZ);
      baseMatrix.updateMatrix();
      stoneTops.setMatrixAt(index, baseMatrix.matrix);

      baseMatrix.scale.set(radius * 0.98 * item.scaleX, 1, radius * 0.98 * item.scaleZ);
      baseMatrix.updateMatrix();
      tops.setMatrixAt(index, baseMatrix.matrix);

      baseMatrix.scale.set(radius * item.scaleX, radius, radius * item.scaleZ);
      baseMatrix.updateMatrix();
      rings.setMatrixAt(index, baseMatrix.matrix);
      islandWorldPositions.get(item.island.id).set(item.base.x, item.base.y + item.bob, item.base.z);
    });
    bodies.instanceMatrix.needsUpdate = true;
    stoneTops.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;
    landmarks.update(detailOpacity);

    const start = islandWorldPositions.get(activeIslands[0].id);
    zeynep.position.set(start.x + 2.8, start.y + 0.34, start.z - 1.6);
    contactShadow.position.set(start.x + 2.8, start.y + 0.325, start.z - 1.6);
    zeynep.visible = detailOpacity > 0.42;
    contactShadow.visible = zeynep.visible;
    contactShadowMaterial.opacity = 0.3 * detailOpacity;
    zeynep.lookAt(activeCamera.position.x, zeynep.position.y, activeCamera.position.z);
    zeynep.userData.updateIdle(elapsedSeconds, 0.8);
  }

  function setMapBlend(regionAmount, worldAmount) {
    worldBlend = THREE.MathUtils.clamp(worldAmount, 0, 1);
    const regionBlend = THREE.MathUtils.clamp(regionAmount, 0, 1);
    detailOpacity = 1 - regionBlend * 0.42 - worldBlend * 0.48;
    bodyMaterial.opacity = detailOpacity;
    stoneTopMaterial.opacity = detailOpacity;
    grassTopMaterial.opacity = detailOpacity;
    ringMaterial.opacity = 0.96 - regionBlend * 0.18 - worldBlend * 0.5;

    bridgeVisuals.forEach((visual) => visual.setOpacity(1 - worldBlend * 0.62));
    regionBridgeVisuals.forEach((visual) => visual.setOpacity(0.08 + worldBlend * 0.92));
    data.regions.forEach((region, index) => {
      const node = regionNodes.get(region.id);
      if (index === 0) {
        node.visible = worldBlend > 0.01;
        node.material.opacity = worldBlend * 0.94;
      } else {
        node.visible = true;
        node.material.opacity = Math.min(1, 0.58 + regionBlend * 0.06 + worldBlend * 0.36);
      }
    });
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

  setMapBlend(0, 0);
  const ready = Promise.all([textures.ready, zeynep.userData.textureReady]);

  return {
    scene,
    activeRegion,
    activeIslands,
    regionNodes,
    tops,
    islandPickMeshes: [tops, stoneTops, bodies],
    rings,
    landmarks,
    islandWorldPositions,
    bridgePickMeshes,
    regionBridgePickMeshes,
    bridgeVisuals,
    regionBridgeVisuals,
    ready,
    update,
    setMapBlend,
    selectIsland,
    getIslandPosition,
    getBridgeHit,
    get selectedIslandId() { return selectedIslandId; },
    dispose() {
      [...bridgeVisuals, ...regionBridgeVisuals].forEach((visual) => visual.dispose());
      resources.geometries.forEach((item) => item.dispose?.());
      resources.materials.forEach((item) => item.dispose?.());
      resources.textures.forEach((item) => item.dispose?.());
    },
  };
}

function createIslandBodyGeometry() {
  const rim = new THREE.CylinderGeometry(1, 0.9, 0.32, 10, 1, false);
  rim.translate(0, -0.12, 0);
  const underside = new THREE.ConeGeometry(0.9, 1.85, 10, 2, false);
  underside.rotateZ(Math.PI);
  underside.translate(0, -1.18, 0);
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
    const edgeNoise = Math.sin(angle * 3 + 0.71) * 0.075
      + Math.sin(angle * 7 - 1.38) * 0.038
      + Math.sin(y * 4.7 + angle * 2) * 0.025;
    const taperWarp = 1 + edgeNoise * (0.35 + depth * 0.65);
    position.setXYZ(
      index,
      x * taperWarp + depth * 0.16,
      y,
      z * taperWarp - depth * 0.1,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.normalizeNormals();
  return geometry;
}

function createLandmarkSystem({ scene, activeIslands, islandAnimationById, resources }) {
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
      ? new THREE.Vector2(-2.7, 1.8)
      : new THREE.Vector2(Math.cos(angle) * distance, Math.sin(angle) * distance);
    entriesByType.get(island.landmark).push({
      island,
      animation: islandAnimationById.get(island.id),
      offset,
      rotation: hashUnit(`${island.id}-landmark-rotation`) * Math.PI * 2,
      size: 0.92 + hashUnit(`${island.id}-landmark-size`) * 0.16,
    });
  });

  const dummy = new THREE.Object3D();
  const meshes = new Map();
  const materials = [];
  for (const [type, definition] of Object.entries(landmarkDefinitions)) {
    const entries = entriesByType.get(type);
    const mesh = new THREE.InstancedMesh(definition.geometry, definition.material, entries.length);
    mesh.name = `Tutorial ${type} landmarks (instanced)`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
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
        const { base, bob } = entry.animation;
        dummy.position.set(
          base.x + entry.offset.x,
          base.y + bob + 0.33,
          base.z + entry.offset.y,
        );
        dummy.rotation.set(0, entry.rotation, 0);
        const scale = definition.scale * entry.size;
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

function createBridgeVisual({ bridge, from, to, radius, openMaterial, closedMaterial, sag, tubularSegments }) {
  const group = new THREE.Group();
  group.name = bridge.id;
  const distance = from.distanceTo(to);
  const direction = to.clone().sub(from);
  const points = [
    from,
    from.clone().addScaledVector(direction, 0.32).add(new THREE.Vector3(0, -Math.min(sag, distance * 0.13), 0)),
    from.clone().addScaledVector(direction, 0.68).add(new THREE.Vector3(0, -Math.min(sag, distance * 0.13), 0)),
    to,
  ];
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const openMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, tubularSegments, radius, 5, false), openMaterial);
  openMesh.name = `${bridge.id} open tube`;
  group.add(openMesh);

  const closedSegmentGeometries = [];
  const closedRadius = radius * 0.7;
  const dashCount = 9;
  for (let index = 0; index < dashCount; index += 1) {
    const startT = index / dashCount;
    const endT = Math.min(1, startT + 0.58 / dashCount);
    const middleT = (startT + endT) / 2;
    const segmentCurve = new THREE.CatmullRomCurve3([
      curve.getPoint(startT),
      curve.getPoint(middleT),
      curve.getPoint(endT),
    ], false, 'centripetal');
    closedSegmentGeometries.push(
      new THREE.TubeGeometry(
        segmentCurve,
        Math.max(3, Math.floor(tubularSegments / dashCount)),
        closedRadius,
        5,
        false,
      ),
    );
  }
  const closedGeometry = mergeGeometries(closedSegmentGeometries, false);
  closedSegmentGeometries.forEach((geometry) => geometry.dispose());
  const closedMesh = new THREE.Mesh(closedGeometry, closedMaterial);
  closedMesh.name = `${bridge.id} merged closed dashes`;
  group.add(closedMesh);

  const state = { value: bridge.state };
  const pickMeshes = [openMesh, closedMesh];
  const visual = {
    group,
    bridge,
    pickMeshes,
    get state() { return state.value; },
    toggle() { this.setState(state.value === 'open' ? 'closed' : 'open'); },
    setState(nextState) {
      state.value = nextState;
      openMesh.visible = nextState === 'open';
      closedMesh.visible = nextState === 'closed';
    },
    setOpacity(amount) {
      group.visible = amount > 0.01;
      group.traverse((object) => {
        if (object.isMesh) object.userData.opacityScale = amount;
      });
      openMesh.material.opacity = THREE.MathUtils.clamp(amount, 0.08, 1);
      closedMesh.material.opacity = THREE.MathUtils.clamp(amount, 0.04, 1);
    },
    dispose() {
      openMesh.geometry.dispose();
      closedGeometry.dispose();
    },
  };
  pickMeshes.forEach((mesh) => { mesh.userData.bridgeVisual = visual; });
  visual.setState(bridge.state);
  return visual;
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
