import * as THREE from 'three';
import { isMobileQuality } from '../render/config.js';

const CHARACTER_ASSET_ROOT = new URL('/assets/characters/', window.location.origin);
const CHARACTER_RATIOS = await loadCharacterRatios();
const CHILD_HEIGHT = 1.45;
const MOBILE_TEXTURE_HEIGHT = 512;
const ALPHA_TEST = 0.5;
const IDLE_PERIOD_SECONDS = 3;
const IDLE_AMPLITUDE_RAD = THREE.MathUtils.degToRad(0.5);

const PROFILES = Object.freeze({
  Zeynep: { asset: 'zeynep', height: CHILD_HEIGHT },
});

export function createCharacter(name, pose = 'front', options = {}) {
  const profile = PROFILES[name] || PROFILES.Zeynep;
  const resolvedPose = pose === 'back' ? 'back' : 'front';
  const ratio = CHARACTER_RATIOS[profile.asset]?.[resolvedPose];
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new Error(`Missing character ratio for ${profile.asset}_${resolvedPose}`);
  }

  const ownsResources = !options.resources;
  const resources = options.resources || { geometries: [], materials: [], textures: [] };
  const group = new THREE.Group();
  const textureUrl = new URL(`${profile.asset}_${resolvedPose}.png`, CHARACTER_ASSET_ROOT).href;
  const { texture, ready } = loadCharacterTexture(textureUrl, resources);
  const geometry = registerGeometry(new THREE.PlaneGeometry(profile.height * ratio, profile.height), resources);
  const material = registerMaterial(new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: ALPHA_TEST,
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  }), resources);
  const depthMaterial = registerMaterial(new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: texture,
    alphaTest: ALPHA_TEST,
    side: THREE.DoubleSide,
  }), resources);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${name} ${resolvedPose} billboard`;
  mesh.position.y = profile.height / 2;
  mesh.castShadow = true;
  mesh.customDepthMaterial = depthMaterial;
  group.add(mesh);

  group.name = name;
  const textureReady = ready.then((loadedTexture) => loadedTexture);
  Object.assign(group.userData, {
    characterName: name,
    characterGeometryMode: 'billboard',
    characterPose: resolvedPose,
    characterMesh: mesh,
    textureReady,
    updateIdle(elapsedSeconds, phase = 0) {
      mesh.rotation.z = Math.sin(elapsedSeconds * Math.PI * 2 / IDLE_PERIOD_SECONDS + phase)
        * IDLE_AMPLITUDE_RAD;
    },
  });

  if (ownsResources) {
    group.userData.dispose = () => {
      resources.geometries.forEach((item) => item.dispose?.());
      resources.materials.forEach((item) => item.dispose?.());
      resources.textures.forEach((item) => item.dispose?.());
    };
  }
  return group;
}

async function loadCharacterRatios() {
  const response = await fetch(new URL('characters.json', CHARACTER_ASSET_ROOT));
  if (!response.ok) throw new Error(`Character ratios could not be loaded (${response.status})`);
  return response.json();
}

function loadCharacterTexture(url, resources) {
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const texture = new THREE.TextureLoader().load(
    url,
    (loadedTexture) => {
      if (isMobileQuality() && loadedTexture.image.height > MOBILE_TEXTURE_HEIGHT) {
        loadedTexture.image = downscaleTextureImage(loadedTexture.image, MOBILE_TEXTURE_HEIGHT);
      }
      loadedTexture.generateMipmaps = true;
      loadedTexture.minFilter = THREE.LinearMipmapLinearFilter;
      loadedTexture.magFilter = THREE.LinearFilter;
      loadedTexture.needsUpdate = true;
      resolveReady(loadedTexture);
    },
    undefined,
    (error) => rejectReady(error || new Error(`Character texture could not be loaded: ${url}`)),
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  registerTexture(texture, resources);
  return { texture, ready };
}

function downscaleTextureImage(image, targetHeight) {
  const canvas = document.createElement('canvas');
  canvas.height = targetHeight;
  canvas.width = Math.max(1, Math.round(image.width * targetHeight / image.height));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function registerGeometry(geometry, resources) { resources.geometries?.push(geometry); return geometry; }
function registerMaterial(material, resources) { resources.materials?.push(material); return material; }
function registerTexture(texture, resources) { resources.textures?.push(texture); return texture; }
