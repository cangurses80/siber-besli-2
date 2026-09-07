import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'siber-besli-2-rules-test';
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const testEnvironment = await initializeTestEnvironment({ projectId, firestore: { rules } });

try {
  await seedAggregates();
  const freshShardUid = 'fresh-shard-player';
  await assertSucceeds(registerPlayer(
    testEnvironment.authenticatedContext(freshShardUid).firestore(),
    freshShardUid,
    'Mor Kaplumbağa',
    9,
  ));
  const uid = 'rules-test-player';
  const db = testEnvironment.authenticatedContext(uid).firestore();
  await assertSucceeds(registerPlayer(db, uid, 'Cesur Baykuş', 2));

  await assertFails(updateDoc(doc(db, 'counters/global/shards/2'), { players: increment(2) }));
  await assertFails(updateDoc(doc(db, 'counters/global/shards/3'), { solved: increment(1) }));
  await assertFails(setDoc(doc(db, 'leaderboard/another-player'), profile('Sahte Panda', 0), { merge: true }));
  await assertFails(setDoc(doc(db, `leaderboard/${uid}`), profile('Yanlış İsim', 0), { merge: true }));

  await assertSucceeds(solveIsland(db, uid, {
    nickname: 'Cesur Baykuş',
    islandId: 'helios-01',
    shardId: 4,
    durationMs: 240000,
  }));
  const playerAfterSolve = await getDoc(doc(db, `players/${uid}`));
  assert.equal(playerAfterSolve.data().solvedCount, 1);

  await assertFails(updateDoc(doc(db, 'counters/global/shards/4'), { solved: increment(1) }));
  await assertFails(setDoc(doc(db, `aggregateContributions/${uid}/solves/helios-01`), {
    shardId: 4,
    durationMs: 240000,
    createdAt: serverTimestamp(),
  }));

  const wrongUid = 'wrong-duration-player';
  const wrongDb = testEnvironment.authenticatedContext(wrongUid).firestore();
  await assertSucceeds(registerPlayer(wrongDb, wrongUid, 'Meraklı Yunus', 1));
  await assertFails(solveIsland(wrongDb, wrongUid, {
    nickname: 'Meraklı Yunus',
    islandId: 'helios-02',
    shardId: 5,
    durationMs: 180000,
    statsDurationMs: 180001,
  }));

  const firstStatsUid = 'first-stats-player';
  const firstStatsDb = testEnvironment.authenticatedContext(firstStatsUid).firestore();
  await assertSucceeds(registerPlayer(firstStatsDb, firstStatsUid, 'Neşeli Panda', 6));
  await assertSucceeds(solveIsland(firstStatsDb, firstStatsUid, {
    nickname: 'Neşeli Panda',
    islandId: 'helios-03',
    shardId: 7,
    durationMs: 90000,
  }));

  await assertFails(leaveNote(db, uid, 'helios-01', 'gecersiz-cumle'));
  await assertSucceeds(leaveNote(db, uid, 'helios-01', 'surprising-rule'));
  await assertFails(leaveNote(db, uid, 'helios-01', 'second-try'));
  await assertSucceeds(leaveNote(firstStatsDb, firstStatsUid, 'helios-03', 'good-luck'));

  const publicDb = testEnvironment.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(collection(publicDb, 'leaderboard')));
  await assertSucceeds(getDoc(doc(publicDb, 'counters/global/shards/4')));
  await assertSucceeds(getDoc(doc(publicDb, 'islandStats/helios-01')));
  await assertSucceeds(getDocs(collection(publicDb, 'notes/helios-01/entries')));
  await assertFails(getDoc(doc(publicDb, `players/${uid}`)));
  await assertFails(getDoc(doc(testEnvironment.authenticatedContext('other').firestore(), `players/${uid}`)));

  console.log('Firestore topluluk kuralları doğrulandı');
  console.log('  Atomik kayıt/çözüm/not, +2 reddi, replay koruması, UID izolasyonu ve public read: tamam');
} finally {
  await testEnvironment.cleanup();
}

async function seedAggregates() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (let shard = 0; shard < 9; shard += 1) {
      batch.set(doc(db, `counters/global/shards/${shard}`), { solved: 0, players: 0 });
    }
    batch.set(doc(db, 'islandStats/helios-01'), { solvedCount: 0, sumDurationMs: 0 });
    batch.set(doc(db, 'islandStats/helios-02'), { solvedCount: 0, sumDurationMs: 0 });
    batch.set(doc(db, 'notes/helios-01/entries/surprising-rule'), { count: 0 });
    batch.set(doc(db, 'notes/helios-01/entries/second-try'), { count: 0 });
    await batch.commit();
  });
}

function registerPlayer(db, uid, nickname, playerShard) {
  const batch = writeBatch(db);
  batch.set(doc(db, `players/${uid}`), initialPlayer(nickname));
  batch.set(doc(db, `aggregateContributions/${uid}`), {
    registered: true,
    playerShard,
    solvedCount: 0,
    lastSolvedShard: null,
    lastSolvedIslandId: null,
    lastDurationMs: 0,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, `counters/global/shards/${playerShard}`), {
    players: increment(1),
    solved: increment(0),
  }, { merge: true });
  batch.set(doc(db, `leaderboard/${uid}`), profile(nickname, 0));
  return batch.commit();
}

function solveIsland(db, uid, {
  nickname,
  islandId,
  shardId,
  durationMs,
  statsDurationMs = durationMs,
}) {
  const batch = writeBatch(db);
  batch.set(doc(db, `players/${uid}`), {
    currentIslandId: islandId,
    solvedCount: 1,
    solved: {
      [islandId]: { solvedAt: serverTimestamp(), durationMs, attempts: 1 },
    },
    lastSeenAt: serverTimestamp(),
  }, { merge: true });
  batch.update(doc(db, `aggregateContributions/${uid}`), {
    solvedCount: increment(1),
    lastSolvedShard: shardId,
    lastSolvedIslandId: islandId,
    lastDurationMs: durationMs,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, `aggregateContributions/${uid}/solves/${islandId}`), {
    shardId,
    durationMs,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, `counters/global/shards/${shardId}`), { solved: increment(1) });
  batch.set(doc(db, `islandStats/${islandId}`), {
    solvedCount: increment(1),
    sumDurationMs: increment(statsDurationMs),
  }, { merge: true });
  batch.set(doc(db, `leaderboard/${uid}`), profile(nickname, 1, islandId), { merge: true });
  return batch.commit();
}

function leaveNote(db, uid, islandId, phraseId) {
  const batch = writeBatch(db);
  batch.set(doc(db, `noteChoices/${uid}/islands/${islandId}`), {
    phraseId,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, `notes/${islandId}/entries/${phraseId}`), { count: increment(1) }, { merge: true });
  return batch.commit();
}

function initialPlayer(nickname) {
  return {
    nickname,
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    activeRegionId: 'helios',
    currentIslandId: 'helios-01',
    solvedCount: 0,
    solved: {},
    openBridges: ['helios-bridge-01', 'helios-bridge-02'],
    openRegionBridges: [],
    schemaVersion: 1,
  };
}

function profile(nickname, solvedCount, currentIslandId = 'helios-01') {
  return {
    nickname,
    solvedCount,
    currentIslandId,
    activeRegionId: 'helios',
    updatedAt: serverTimestamp(),
  };
}
