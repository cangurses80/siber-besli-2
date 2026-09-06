import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const world = JSON.parse(await readFile(new URL('../src/world.json', import.meta.url), 'utf8'));
const regionIds = new Set(world.regions.map((region) => region.id));
const islandIds = new Set(world.islands.map((island) => island.id));
const bridgeIds = new Set();
const landmarkTypes = new Set(['broken-column', 'tree', 'obelisk', 'arch']);

assert.equal(world.regions.length, 6, 'Dünya tam olarak 6 bölge içermeli');
assert.equal(regionIds.size, world.regions.length, 'Bölge ID değerleri benzersiz olmalı');
assert.equal(world.islands.length, 60, 'Dünya tam olarak 60 ada içermeli');
assert.equal(islandIds.size, world.islands.length, 'Ada ID değerleri benzersiz olmalı');
assert.equal(world.regions[0].islands.length, 8, 'Tutorial bölgesinde tam olarak 8 ada olmalı');

for (const region of world.regions) {
  assert.ok(region.islands.length >= 8 && region.islands.length <= 12, `${region.id}: ada sayısı 8–12 olmalı`);
  assert.equal(region.position.length, 3, `${region.id}: position üç değer içermeli`);
  const listed = new Set(region.islands);
  assert.equal(listed.size, region.islands.length, `${region.id}: islands listesinde tekrar var`);
  for (const islandId of region.islands) {
    const island = world.islands.find((item) => item.id === islandId);
    assert.ok(island, `${region.id}: ${islandId} bulunamadı`);
    assert.equal(island.regionId, region.id, `${islandId}: regionId uyuşmuyor`);
  }
}

for (const island of world.islands) {
  assert.ok(regionIds.has(island.regionId), `${island.id}: geçersiz regionId`);
  assert.ok(regionIds.has(island.regionId) && world.regions.find((r) => r.id === island.regionId).islands.includes(island.id), `${island.id}: bölgenin islands listesinde yok`);
  assert.equal(island.localPosition.length, 3, `${island.id}: localPosition üç değer içermeli`);
  assert.ok([0, 12, 24].includes(island.localPosition[1]), `${island.id}: y yalnızca 0, 12 veya 24 olabilir`);
  assert.ok(island.radius > 0, `${island.id}: radius pozitif olmalı`);
  assert.equal(island.puzzleType, null, `${island.id}: bu checkpoint'te puzzleType null olmalı`);
  assert.ok(Number.isInteger(island.difficulty) && island.difficulty >= 1 && island.difficulty <= 5, `${island.id}: difficulty 1–5 olmalı`);
  assert.ok(['player', 'fixed'].includes(island.seedMode), `${island.id}: geçersiz seedMode`);
  assert.ok(landmarkTypes.has(island.landmark), `${island.id}: geçersiz veya eksik landmark`);
}

const tutorialLandmarks = new Set(
  world.islands
    .filter((island) => island.regionId === world.regions[0].id)
    .map((island) => island.landmark),
);
assert.ok(tutorialLandmarks.size >= 3, 'Tutorial bölgesinde en az 3 landmark türü kullanılmalı');

const islandById = new Map(world.islands.map((island) => [island.id, island]));
for (const bridge of world.bridges) {
  assert.ok(!bridgeIds.has(bridge.id), `${bridge.id}: köprü ID tekrarı`);
  bridgeIds.add(bridge.id);
  assert.ok(islandIds.has(bridge.from) && islandIds.has(bridge.to), `${bridge.id}: geçersiz ada referansı`);
  assert.notEqual(bridge.from, bridge.to, `${bridge.id}: köprü kendisine bağlanamaz`);
  assert.ok(['open', 'closed'].includes(bridge.state), `${bridge.id}: geçersiz state`);
  const from = islandById.get(bridge.from);
  const to = islandById.get(bridge.to);
  assert.equal(from.regionId, to.regionId, `${bridge.id}: ada köprüsü iki farklı bölgeyi bağlıyor`);
  const distance = euclidean(from.localPosition, to.localPosition);
  assert.ok(distance >= 40 && distance <= 60, `${bridge.id}: bağlı ada mesafesi ${distance.toFixed(1)}, 40–60 dışında`);
}

const tutorialId = world.regions[0].id;
const tutorialBridges = world.bridges.filter((bridge) => islandById.get(bridge.from).regionId === tutorialId);
assert.equal(tutorialBridges.filter((bridge) => bridge.state === 'open').length, 2, 'Tutorial bölgesinde tam 2 açık köprü olmalı');
assert.ok(world.bridges.filter((bridge) => islandById.get(bridge.from).regionId !== tutorialId).every((bridge) => bridge.state === 'closed'), 'Kilitli bölgelerin bütün ada köprüleri kapalı olmalı');

const regionById = new Map(world.regions.map((region) => [region.id, region]));
const degree = new Map(world.regions.map((region) => [region.id, 0]));
const adjacency = new Map(world.regions.map((region) => [region.id, []]));
for (const bridge of world.regionBridges) {
  assert.ok(!bridgeIds.has(bridge.id), `${bridge.id}: köprü ID tekrarı`);
  bridgeIds.add(bridge.id);
  assert.ok(regionIds.has(bridge.from) && regionIds.has(bridge.to), `${bridge.id}: geçersiz bölge referansı`);
  assert.notEqual(bridge.from, bridge.to, `${bridge.id}: köprü kendisine bağlanamaz`);
  assert.ok(['open', 'closed'].includes(bridge.state), `${bridge.id}: geçersiz state`);
  const distance = euclidean(regionById.get(bridge.from).position, regionById.get(bridge.to).position);
  assert.ok(distance >= 200 && distance <= 300, `${bridge.id}: bölge merkezi mesafesi ${distance.toFixed(1)}, 200–300 dışında`);
  degree.set(bridge.from, degree.get(bridge.from) + 1);
  degree.set(bridge.to, degree.get(bridge.to) + 1);
  adjacency.get(bridge.from).push(bridge.to);
  adjacency.get(bridge.to).push(bridge.from);
}
assert.ok(world.regionBridges.every((bridge) => bridge.state === 'closed'), 'CP1 boyunca bütün bölge köprüleri kapalı olmalı');

const visited = new Set();
const queue = [world.regions[0].id];
while (queue.length) {
  const regionId = queue.shift();
  if (visited.has(regionId)) continue;
  visited.add(regionId);
  queue.push(...adjacency.get(regionId));
}
assert.equal(visited.size, world.regions.length, 'Bölge grafı bağlantılı olmalı');
const oddDegreeRegions = [...degree.entries()].filter(([, value]) => value % 2 === 1).map(([id]) => id);
assert.ok(oddDegreeRegions.length >= 4, 'Euler yolu olmaması için en az 4 tek dereceli bölge olmalı');
assert.ok(![0, 2].includes(oddDegreeRegions.length), 'Bölge grafında Euler yolu/devresi olmamalı');
assert.deepEqual([...new Set(world.regions.map((region) => region.position[1]))].sort((a, b) => a - b), [0, 60, 120], 'Bölgeler üç yükseklik katmanına dağılmalı');

console.log('world.json doğrulandı');
console.log(`  Bölgeler: ${world.regions.length}`);
console.log(`  Adalar: ${world.islands.length}`);
console.log(`  Ada köprüleri: ${world.bridges.length}`);
console.log(`  Bölge köprüleri: ${world.regionBridges.length}`);
console.log(`  Tutorial landmark türleri (${tutorialLandmarks.size}): ${[...tutorialLandmarks].join(', ')}`);
console.log(`  Tek dereceli bölgeler (${oddDegreeRegions.length}): ${oddDegreeRegions.join(', ')}`);

function euclidean(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}
