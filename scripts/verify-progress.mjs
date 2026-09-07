import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProgress } from '../src/progress.js';

const world = JSON.parse(await readFile(new URL('../src/world.json', import.meta.url), 'utf8'));
const progress = createProgress(world);

assert.deepEqual(
  [...progress.state.openBridges].sort(),
  ['helios-bridge-01', 'helios-bridge-02'],
  'Başlangıçtaki iki açık ada köprüsü yüklenmeli',
);
assert.deepEqual(
  [...progress.getReachableIslandIds('helios')].sort(),
  ['helios-01', 'helios-02', 'helios-03'],
  'İlk erişilebilir ada kümesi açık köprü zincirini izlemeli',
);

assert.equal(progress.setBridgeState('helios-bridge-01', 'closed'), true);
assert.deepEqual(
  [...progress.getReachableIslandIds('helios')],
  ['helios-01'],
  'BFS kapalı köprüden geçmemeli',
);
assert.equal(progress.setBridgeState('helios-bridge-01', 'open'), true);

let eventCount = 0;
const unsubscribe = progress.subscribe(() => { eventCount += 1; });
const solveResult = progress.solveIsland('helios-03');
assert.equal(solveResult.newlySolved, true);
assert.ok(progress.state.solvedIslands.has('helios-03'));
assert.ok(progress.state.openBridges.has('helios-bridge-02'));
assert.ok(progress.state.openBridges.has('helios-bridge-03'));
assert.ok(progress.getReachableIslandIds('helios').has('helios-04'));
const eventsAfterFirstSolve = eventCount;
const repeatedSolve = progress.solveIsland('helios-03');
assert.equal(repeatedSolve.changed, false, 'Aynı çözüm ikinci kez state değiştirmemeli');
assert.equal(eventCount, eventsAfterFirstSolve, 'İdempotent çözüm ikinci olay üretmemeli');
unsubscribe();

const regionUnlockResult = progress.solveIsland('helios-05');
assert.ok(regionUnlockResult.openedBridgeIds.includes('region-bridge-01'));
assert.ok(progress.state.openBridges.has('region-bridge-01'));
assert.deepEqual(
  [...progress.getReachableRegionIds()].sort(),
  ['helios', 'khepri'],
  'Bölge BFS açık region bridge üzerinden ilerlemeli',
);

assert.equal(progress.setBridgeState('region-bridge-01', 'closed'), true);
assert.deepEqual([...progress.getReachableRegionIds()], ['helios']);
assert.equal(progress.setBridgeState('region-bridge-01', 'open'), true);
assert.ok(progress.getReachableRegionIds().has('khepri'));

const fresh = createProgress(world);
assert.equal(fresh.state.solvedIslands.size, 0, 'Yeni progress örneği çözülmüş ada taşımamalı');
assert.equal(fresh.state.activeRegionId, 'helios');
assert.equal(fresh.state.currentIslandId, 'helios-01');
assert.deepEqual([...fresh.getReachableRegionIds()], ['helios']);

const hydratedProgress = createProgress(world, {
  solvedIslands: ['helios-01', 'bilinmeyen-ada'],
  openBridges: ['helios-bridge-03', 'bilinmeyen-kopru'],
  activeRegionId: 'helios',
  currentIslandId: 'helios-03',
});
assert.ok(hydratedProgress.state.solvedIslands.has('helios-01'));
assert.equal(hydratedProgress.state.solvedIslands.has('bilinmeyen-ada'), false);
assert.ok(hydratedProgress.state.openBridges.has('helios-bridge-03'));
assert.equal(hydratedProgress.state.currentIslandId, 'helios-03');
assert.equal(hydratedProgress.reset(), true);
assert.equal(hydratedProgress.state.solvedIslands.size, 0);
assert.deepEqual([...hydratedProgress.state.openBridges].sort(), ['helios-bridge-01', 'helios-bridge-02']);

console.log('İlerleme modeli doğrulandı');
console.log('  Başlangıç BFS: helios-01, helios-02, helios-03');
console.log('  Ada çözümü, idempotentlik, bridge state ve bölge BFS: tamam');
