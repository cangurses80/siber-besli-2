import { placeholderPuzzle } from './placeholder.js';

const registry = new Map();

export function registerPuzzle(type, puzzle) {
  if (!type || typeof type !== 'string') throw new TypeError('Puzzle type gerekli');
  for (const method of ['generate', 'mount', 'unmount']) {
    if (typeof puzzle?.[method] !== 'function') {
      throw new TypeError(`${type} puzzle için ${method} fonksiyonu gerekli`);
    }
  }
  registry.set(type, puzzle);
  return puzzle;
}

export function getPuzzle(type) {
  return registry.get(type) || null;
}

export function createPuzzleSeed(playerId, islandId) {
  const value = `${playerId}:${islandId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

registerPuzzle('placeholder', placeholderPuzzle);
