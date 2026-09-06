import * as THREE from 'three';

const ROOT = '/assets/textures';

export function createWorldTextureLibrary(renderer) {
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const manager = new THREE.LoadingManager(resolveReady, undefined, rejectReady);
  const loader = new THREE.TextureLoader(manager);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loaded = [];

  function load(path, { color = false, repeat = [1, 1] } = {}) {
    const texture = loader.load(`${ROOT}/${path}`);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = anisotropy;
    loaded.push(texture);
    return texture;
  }

  const stone = {
    color: load('stone_tiles/stone_tiles_diff_1k.jpg', { color: true, repeat: [1.7, 1.7] }),
    normal: load('stone_tiles/stone_tiles_nor_gl_1k.jpg', { repeat: [1.7, 1.7] }),
    roughness: load('stone_tiles/stone_tiles_rough_1k.jpg', { repeat: [1.7, 1.7] }),
  };

  return {
    stone,
    ready,
    dispose: () => loaded.forEach((texture) => texture.dispose()),
  };
}
