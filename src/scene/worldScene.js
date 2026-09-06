import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RENDER_CONFIG, isMobileQuality } from '../render/config.js';
import { createCharacter } from './characters.js';

const PALETTES = {
  helios: { top: 0x98a878, rock: 0x40534b, glow: 0xffcf72, node: 0xcbbd78 },
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
  createLights(scene);
  createClouds(scene, resources);

  const islandGeometry = createIslandBodyGeometry();
  const topGeometry = new THREE.CylinderGeometry(1, 0.94, 0.24, 10, 1, false);
  topGeometry.translate(0, 0.05, 0);
  const ringGeometry = new THREE.TorusGeometry(1.035, 0.045, 4, 32);
  ringGeometry.rotateX(Math.PI / 2);
  ringGeometry.translate(0, 0.19, 0);
  resources.geometries.push(islandGeometry, topGeometry, ringGeometry);

  const palette = PALETTES[activeRegion.id];
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: palette.rock,
    roughness: 0.93,
    metalness: 0.02,
    flatShading: true,
    transparent: true,
  });
  const topMaterial = new THREE.MeshStandardMaterial({
    color: palette.top,
    map: textures.stone.color,
    normalMap: textures.stone.normal,
    roughnessMap: textures.stone.roughness,
    roughness: 0.86,
    metalness: 0.01,
    transparent: true,
  });
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: palette.glow,
    emissiveIntensity: 2.8,
    roughness: 0.36,
    metalness: 0.04,
    transparent: true,
    opacity: 0.96,
    toneMapped: false,
  });
  resources.materials.push(bodyMaterial, topMaterial, ringMaterial);

  const bodies = new THREE.InstancedMesh(islandGeometry, bodyMaterial, activeIslands.length);
  const tops = new THREE.InstancedMesh(topGeometry, topMaterial, activeIslands.length);
  const rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, activeIslands.length);
  bodies.name = 'Tutorial island bodies (instanced)';
  tops.name = 'Tutorial island PBR tops (instanced)';
  rings.name = 'Tutorial island emissive rims (instanced)';
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  tops.castShadow = true;
  tops.receiveShadow = true;
  bodies.frustumCulled = false;
  tops.frustumCulled = false;
  rings.frustumCulled = false;
  tops.userData.islandIds = activeIslands.map((island) => island.id);
  rings.userData.islandIds = activeIslands.map((island) => island.id);
  scene.add(bodies, tops, rings);

  const baseMatrix = new THREE.Object3D();
  const islandAnimation = activeIslands.map((island, index) => {
    const base = vectorFrom(island.localPosition).add(vectorFrom(activeRegion.position));
    islandWorldPositions.set(island.id, base.clone());
    const phase = hashUnit(island.id) * Math.PI * 2;
    rings.setColorAt(index, new THREE.Color(palette.glow));
    return { island, base, phase, bob: 0 };
  });
  rings.instanceColor.needsUpdate = true;

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
      radius: 0.34,
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
      radius: 1.65,
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
  zeynep.scale.setScalar(4.2);
  scene.add(zeynep);

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
    islandAnimation.forEach((item, index) => {
      item.bob = Math.sin(elapsedSeconds * 0.72 + item.phase) * 0.3;
      const radius = item.island.radius;
      baseMatrix.position.set(item.base.x, item.base.y + item.bob, item.base.z);
      baseMatrix.rotation.set(0, item.phase * 0.06, 0);
      baseMatrix.scale.set(radius, Math.max(4.8, radius * 0.72), radius);
      baseMatrix.updateMatrix();
      bodies.setMatrixAt(index, baseMatrix.matrix);

      baseMatrix.position.y = item.base.y + item.bob;
      baseMatrix.scale.set(radius * 0.97, 1, radius * 0.97);
      baseMatrix.updateMatrix();
      tops.setMatrixAt(index, baseMatrix.matrix);

      baseMatrix.scale.set(radius, radius, radius);
      baseMatrix.updateMatrix();
      rings.setMatrixAt(index, baseMatrix.matrix);
      islandWorldPositions.get(item.island.id).set(item.base.x, item.base.y + item.bob, item.base.z);
    });
    bodies.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    rings.instanceMatrix.needsUpdate = true;

    const start = islandWorldPositions.get(activeIslands[0].id);
    zeynep.position.set(start.x + 1.2, start.y + 0.32, start.z + 0.4);
    zeynep.visible = detailOpacity > 0.42;
    zeynep.lookAt(activeCamera.position.x, zeynep.position.y, activeCamera.position.z);
    zeynep.userData.updateIdle(elapsedSeconds, 0.8);
  }

  function setMapBlend(regionAmount, worldAmount) {
    worldBlend = THREE.MathUtils.clamp(worldAmount, 0, 1);
    const regionBlend = THREE.MathUtils.clamp(regionAmount, 0, 1);
    detailOpacity = 1 - regionBlend * 0.42 - worldBlend * 0.48;
    bodyMaterial.opacity = detailOpacity;
    topMaterial.opacity = detailOpacity;
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
        node.material.opacity = 0.2 + regionBlend * 0.12 + worldBlend * 0.68;
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
    rings,
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
  geometry.computeVertexNormals();
  return geometry;
}

function createBridgeMaterials(palette, resources) {
  const islandOpen = new THREE.MeshStandardMaterial({
    color: palette.glow,
    emissive: palette.glow,
    emissiveIntensity: 2.2,
    roughness: 0.42,
    transparent: true,
    toneMapped: false,
  });
  const islandClosed = new THREE.MeshStandardMaterial({
    color: 0x68716f,
    roughness: 0.9,
    transparent: true,
    opacity: 0.38,
  });
  const regionOpen = new THREE.MeshStandardMaterial({
    color: 0xe9c878,
    emissive: 0xe9b951,
    emissiveIntensity: 1.4,
    transparent: true,
    toneMapped: false,
  });
  const regionClosed = new THREE.MeshStandardMaterial({
    color: 0xb4b8aa,
    emissive: 0x8b866a,
    emissiveIntensity: 0.18,
    roughness: 0.84,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
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
        radius,
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
      closedMesh.material.opacity = THREE.MathUtils.clamp(0.56 * amount, 0.035, 0.56);
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
    color: palette.node,
    roughness: 0.94,
    metalness: 0.01,
    transparent: true,
    opacity: active ? 0 : 0.2,
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
  const hemisphere = new THREE.HemisphereLight(0xffe6bc, 0x213a43, 2.2);
  const sun = new THREE.DirectionalLight(0xffdba0, 3.4);
  sun.position.set(-140, 230, -80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isMobileQuality() ? 512 : 1024, isMobileQuality() ? 512 : 1024);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.camera.far = 520;
  scene.add(hemisphere, sun);
}

function createSky(scene, resources) {
  const geometry = new THREE.SphereGeometry(1050, 24, 14);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(0x9dc6bb) },
      zenith: { value: new THREE.Color(0x183c50) },
      sun: { value: new THREE.Color(0xf8d79e) },
    },
    vertexShader: `varying vec3 vDirection; void main() { vDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sun;
      varying vec3 vDirection;
      void main() {
        float heightMix = smoothstep(-0.2, 0.78, vDirection.y);
        vec3 color = mix(horizon, zenith, heightMix);
        float warmBand = pow(max(0.0, 1.0 - abs(vDirection.y - 0.04)), 18.0);
        color = mix(color, sun, warmBand * 0.18);
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
    color: 0xc7d8c8,
    transparent: true,
    opacity: 0.2,
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
    color: 0xf4eee1,
    transparent: true,
    opacity: 0.17,
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
