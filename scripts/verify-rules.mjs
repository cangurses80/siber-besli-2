import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const projectId = 'siber-besli-2-rules-test';
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const testEnvironment = await initializeTestEnvironment({
  projectId,
  firestore: { rules },
});

try {
  const uid = 'rules-test-player';
  const database = testEnvironment.authenticatedContext(uid).firestore();
  const initialPlayer = {
    nickname: 'Cesur Baykuş',
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    activeRegionId: 'helios',
    currentIslandId: 'helios-01',
    solved: {},
    openBridges: ['helios-bridge-01', 'helios-bridge-02'],
    openRegionBridges: [],
    schemaVersion: 1,
  };

  const playerRef = doc(database, 'players', uid);
  await assertSucceeds(setDoc(playerRef, initialPlayer, { merge: true }));
  await assertFails(setDoc(doc(database, 'players', 'another-player'), initialPlayer, { merge: true }));
  await assertFails(updateDoc(playerRef, {
    openBridges: ['not-a-world-bridge'],
  }));
  await assertSucceeds(setDoc(playerRef, {
    solved: {
      'helios-01': {
        solvedAt: serverTimestamp(),
        durationMs: 4200,
        attempts: 1,
      },
    },
  }, { merge: true }));
  await assertSucceeds(setDoc(playerRef, {
    currentIslandId: 'helios-02',
    solved: {
      'helios-02': {
        solvedAt: null,
        durationMs: 0,
        attempts: 1,
      },
    },
  }, { merge: true }));
  const mergedPlayer = await getDoc(playerRef);
  assert.deepEqual(
    Object.keys(mergedPlayer.data().solved).sort(),
    ['helios-01', 'helios-02'],
    'Kısmi solved yazıları mevcut kayıtları korumalı',
  );
  await assertSucceeds(updateDoc(playerRef, {
    lastSeenAt: serverTimestamp(),
  }));
  await assertFails(setDoc(playerRef, {
    currentIslandId: 'helios-03',
    solved: {
      'helios-03': {
        solvedAt: serverTimestamp(),
        durationMs: -1,
        attempts: 0,
      },
    },
  }, { merge: true }));
  await assertFails(setDoc(playerRef, {
    solved: {
      'unknown-island': {
        solvedAt: serverTimestamp(),
        durationMs: 100,
        attempts: 1,
      },
    },
  }, { merge: true }));
  await assertSucceeds(updateDoc(playerRef, { solved: {} }));
  assert.ok(true);
  console.log('Firestore güvenlik kuralları doğrulandı');
  console.log('  Create, UID izolasyonu, kısmi solved merge, ID/record, heartbeat ve reset: tamam');
} finally {
  await testEnvironment.cleanup();
}
