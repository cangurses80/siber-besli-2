import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPuzzleSeed } from '../src/puzzles/index.js';
import {
  createNewPlayerDocument,
  hasCompleteFirebaseConfig,
  hydratePlayerDocument,
  PLAYER_SCHEMA_VERSION,
  recordPuzzleAttempt,
  recordPuzzleSolve,
  resetPlayerProgress,
  serializePlayerState,
  SERVER_TIMESTAMP_MARKER,
} from '../src/playerStore.js';

const world = JSON.parse(await readFile(new URL('../src/world.json', import.meta.url), 'utf8'));
const validMimarFlags = new Set(['mimar.welcome_seen', 'mimar.transparency_seen']);
const savedTimestamp = Object.freeze({ seconds: 42, nanoseconds: 0 });
const hydrated = hydratePlayerDocument(world, {
  nickname: 'Cesur Baykuş',
  activeRegionId: 'khepri',
  currentIslandId: 'khepri-03',
  solved: {
    'helios-01': { solvedAt: savedTimestamp, durationMs: 1234, attempts: 2 },
    'bilinmeyen-ada': { solvedAt: savedTimestamp, durationMs: 20, attempts: 1 },
  },
  openBridges: ['helios-bridge-01', 'helios-bridge-01', 'bilinmeyen-kopru'],
  openRegionBridges: ['region-bridge-01', 'bilinmeyen-bolge-koprusu'],
  mimarFlags: ['mimar.welcome_seen', 'mimar.welcome_seen', 'mimar.unknown'],
}, { validMimarFlags });

assert.equal(hydrated.nickname, 'Cesur Baykuş');
assert.equal(hydrated.progressState.activeRegionId, 'khepri');
assert.equal(hydrated.progressState.currentIslandId, 'khepri-03');
assert.ok(hydrated.progressState.solvedIslands.has('helios-01'));
assert.equal(hydrated.progressState.solvedIslands.has('bilinmeyen-ada'), false);
assert.ok(hydrated.progressState.openBridges.has('helios-bridge-01'));
assert.ok(hydrated.progressState.openBridges.has('helios-bridge-02'), 'Dünya başlangıç köprüsü korunmalı');
assert.ok(hydrated.progressState.openBridges.has('region-bridge-01'));
assert.equal(hydrated.progressState.openBridges.has('bilinmeyen-kopru'), false);
assert.deepEqual(hydrated.mimarFlags, ['mimar.welcome_seen']);

const serialized = serializePlayerState(
  world,
  hydrated.progressState,
  hydrated.puzzleRecords,
  hydrated.mimarFlags,
);
assert.deepEqual(serialized.openBridges.sort(), ['helios-bridge-01', 'helios-bridge-02']);
assert.deepEqual(serialized.openRegionBridges, ['region-bridge-01']);
assert.deepEqual(Object.keys(serialized.solved), ['helios-01']);
assert.equal(serialized.solvedCount, 1);
assert.equal(serialized.schemaVersion, PLAYER_SCHEMA_VERSION);
assert.deepEqual(serialized.mimarFlags, ['mimar.welcome_seen']);

let records = recordPuzzleAttempt({}, 'helios-03');
assert.equal(records['helios-03'].attempts, 1, 'Odaya giriş attempts değerini artırmalı');
records = recordPuzzleSolve(records, 'helios-03', 1200.6);
assert.equal(records['helios-03'].solvedAt, SERVER_TIMESTAMP_MARKER);
assert.equal(records['helios-03'].durationMs, 1201);
records = recordPuzzleAttempt(records, 'helios-03');
records = recordPuzzleSolve(records, 'helios-03', 77);
assert.equal(records['helios-03'].attempts, 2);
assert.equal(records['helios-03'].solvedAt, SERVER_TIMESTAMP_MARKER, 'İlk solvedAt korunmalı');
assert.equal(records['helios-03'].durationMs, 1201, 'İlk başarılı süre korunmalı');

const existing = recordPuzzleSolve({
  'helios-04': { solvedAt: savedTimestamp, durationMs: 888, attempts: 3 },
}, 'helios-04', 12);
assert.equal(existing['helios-04'].solvedAt, savedTimestamp);
assert.equal(existing['helios-04'].durationMs, 888);

const newDocument = createNewPlayerDocument(world, 'Mor Kaplumbağa');
assert.equal(newDocument.nickname, 'Mor Kaplumbağa');
assert.equal(newDocument.createdAt, SERVER_TIMESTAMP_MARKER);
assert.equal(newDocument.lastSeenAt, SERVER_TIMESTAMP_MARKER);
assert.equal(newDocument.schemaVersion, 1);
assert.deepEqual(newDocument.solved, {});
assert.equal(newDocument.solvedCount, 0);
assert.deepEqual(newDocument.mimarFlags, []);

const legacyPlayer = hydratePlayerDocument(world, { nickname: 'Eski Gezgin' }, { validMimarFlags });
assert.deepEqual(legacyPlayer.mimarFlags, [], 'Eski oyuncu belgesi boş Mimar flag listesiyle hydrate edilmeli');

const reset = resetPlayerProgress(world);
assert.equal(reset.progressState.solvedIslands.size, 0);
assert.deepEqual([...reset.progressState.openBridges].sort(), ['helios-bridge-01', 'helios-bridge-02']);
assert.equal(reset.progressState.activeRegionId, 'helios');
assert.equal(reset.progressState.currentIslandId, 'helios-01');

assert.equal(hasCompleteFirebaseConfig({ a: '', b: '2', c: '3', d: '4', e: '5', f: '6' }), false);
assert.equal(hasCompleteFirebaseConfig({ a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' }), true);
assert.equal(createPuzzleSeed('uid-1', 'helios-01'), createPuzzleSeed('uid-1', 'helios-01'));
assert.notEqual(createPuzzleSeed('uid-1', 'helios-01'), createPuzzleSeed('uid-2', 'helios-01'));

console.log('Firebase kalıcılık sözleşmesi doğrulandı');
console.log('  Hydration, ID filtreleme, round-trip, attempts/duration, reset ve UID seed: tamam');
