import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

const SHARD_COUNT = 10;
const GHOST_LIMIT = 12;
const LEADERBOARD_LIMIT = 20;
const LEADERBOARD_CACHE_MS = 5 * 60_000;
const MAX_RETRY_ATTEMPTS = 5;

export function createCommunityClient({ persistence, worldData, notePhrases, qaPreset = null }) {
  if (qaPreset && ['world-counter', 'island-stats', 'ghost-region'].includes(qaPreset)) {
    return createFixtureCommunity(worldData, notePhrases, qaPreset);
  }
  if (persistence.mode !== 'firebase' || !persistence.firestore) {
    return createEmptyCommunity();
  }

  const db = persistence.firestore;
  const uid = persistence.playerId;
  const islandIds = new Set(worldData.islands.map((island) => island.id));
  const phraseIds = new Set(notePhrases.map((phrase) => phrase.id));
  const islandCache = new Map();
  const noteChoiceCache = new Map();
  const retryTasks = new Map();
  let counterCache = null;
  let leaderboardCache = null;
  let leaderboardCachedAt = 0;
  let disposed = false;
  let registrationPromise = Promise.resolve({ ok: true, skipped: true });

  function ensureRegistration({ playerPatch, nickname, solvedCount, currentIslandId, activeRegionId }) {
    registrationPromise = registrationPromise.then(async () => {
      const contributionRef = doc(db, 'aggregateContributions', uid);
      const snapshot = await getDoc(contributionRef);
      const leaderboardRef = doc(db, 'leaderboard', uid);
      const profile = leaderboardData({ nickname, solvedCount, currentIslandId, activeRegionId });
      if (snapshot.exists()) {
        return persistence.savePlayerAtomically(
          playerPatch,
          'community-profile',
          ({ batch }) => batch.set(leaderboardRef, profile, { merge: true }),
          { expectedNickname: nickname },
        );
      }

      const playerShard = randomShard();
      const result = await persistence.savePlayerAtomically(
        playerPatch,
        'community-register',
        ({ batch }) => {
          batch.set(contributionRef, {
            registered: true,
            playerShard,
            solvedCount,
            lastSolvedShard: null,
            lastSolvedIslandId: null,
            lastDurationMs: 0,
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'counters', 'global', 'shards', String(playerShard)), {
            players: increment(1),
            solved: increment(0),
          }, { merge: true });
          batch.set(leaderboardRef, profile);
        },
        { expectedNickname: nickname },
      );
      if (!result.ok) scheduleRetry('registration', () => ensureRegistration({
        playerPatch,
        nickname,
        solvedCount,
        currentIslandId,
        activeRegionId,
      }));
      return result;
    }).catch((error) => {
      reportCommunityError('registration', error);
      return { ok: false, error };
    });
    return registrationPromise;
  }

  async function savePlayerAndProfile({ playerPatch, nickname, solvedCount, currentIslandId, activeRegionId }, reason) {
    await registrationPromise;
    return persistence.savePlayerAtomically(
      playerPatch,
      reason,
      ({ batch }) => batch.set(doc(db, 'leaderboard', uid), leaderboardData({
        nickname,
        solvedCount,
        currentIslandId,
        activeRegionId,
      }), { merge: true }),
    );
  }

  async function recordFirstSolve({
    playerPatch,
    nickname,
    solvedCount,
    currentIslandId,
    activeRegionId,
    islandId,
    durationMs,
  }) {
    if (!islandIds.has(islandId)) return { ok: false, reason: 'invalid-island' };
    await registrationPromise;
    const receiptRef = doc(db, 'aggregateContributions', uid, 'solves', islandId);
    const existingReceipt = await getDoc(receiptRef);
    if (existingReceipt.exists()) {
      return savePlayerAndProfile({
        playerPatch,
        nickname,
        solvedCount,
        currentIslandId,
        activeRegionId,
      }, 'solve-already-counted');
    }

    const safeDuration = Math.min(3_599_999, Math.max(1, Math.round(durationMs)));
    const shardId = randomShard();
    const contributionRef = doc(db, 'aggregateContributions', uid);
    const result = await persistence.savePlayerAtomically(
      playerPatch,
      'community-first-solve',
      ({ batch }) => {
        batch.set(contributionRef, {
          solvedCount: increment(1),
          lastSolvedShard: shardId,
          lastSolvedIslandId: islandId,
          lastDurationMs: safeDuration,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        batch.set(receiptRef, {
          shardId,
          durationMs: safeDuration,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, 'counters', 'global', 'shards', String(shardId)), {
          solved: increment(1),
          players: increment(0),
        }, { merge: true });
        batch.set(doc(db, 'islandStats', islandId), {
          solvedCount: increment(1),
          sumDurationMs: increment(safeDuration),
        }, { merge: true });
        batch.set(doc(db, 'leaderboard', uid), leaderboardData({
          nickname,
          solvedCount,
          currentIslandId,
          activeRegionId,
        }), { merge: true });
      },
    );
    if (!result.ok) scheduleRetry(`solve:${islandId}`, async () => {
      const receipt = await getDoc(receiptRef);
      if (receipt.exists()) return { ok: true, alreadyApplied: true };
      return recordFirstSolve({
        playerPatch,
        nickname,
        solvedCount,
        currentIslandId,
        activeRegionId,
        islandId,
        durationMs: safeDuration,
      });
    });
    if (result.ok) {
      counterCache = null;
      islandCache.delete(islandId);
      leaderboardCache = null;
    }
    return result;
  }

  async function leaveNote(islandId, phraseId) {
    if (!islandIds.has(islandId) || !phraseIds.has(phraseId)) {
      return { ok: false, reason: 'invalid-note' };
    }
    const choiceRef = doc(db, 'noteChoices', uid, 'islands', islandId);
    if (noteChoiceCache.get(islandId)) return { ok: true, alreadyChosen: true };
    const existing = await getDoc(choiceRef);
    if (existing.exists()) {
      noteChoiceCache.set(islandId, existing.data().phraseId);
      return { ok: true, alreadyChosen: true };
    }
    try {
      const batch = writeBatch(db);
      batch.set(choiceRef, { phraseId, createdAt: serverTimestamp() });
      batch.set(doc(db, 'notes', islandId, 'entries', phraseId), { count: increment(1) }, { merge: true });
      await withTimeout(batch.commit(), 12_000, 'note-timeout');
      noteChoiceCache.set(islandId, phraseId);
      islandCache.delete(islandId);
      return { ok: true };
    } catch (error) {
      reportCommunityError(`note:${islandId}`, error);
      scheduleRetry(`note:${islandId}`, () => leaveNote(islandId, phraseId));
      return { ok: false, reason: error?.code || 'note-failed', error };
    }
  }

  async function getGlobalCounter() {
    if (counterCache) return counterCache;
    const snapshots = await getDocs(collection(db, 'counters', 'global', 'shards'));
    counterCache = snapshots.docs.reduce((total, snapshot) => ({
      solved: total.solved + safeInteger(snapshot.data().solved),
      players: total.players + safeInteger(snapshot.data().players),
    }), { solved: 0, players: 0 });
    return counterCache;
  }

  async function getLeaderboard({ fresh = false } = {}) {
    if (!fresh && leaderboardCache && Date.now() - leaderboardCachedAt < LEADERBOARD_CACHE_MS) {
      return leaderboardCache;
    }
    const snapshots = await getDocs(query(
      collection(db, 'leaderboard'),
      orderBy('solvedCount', 'desc'),
      limit(LEADERBOARD_LIMIT),
    ));
    leaderboardCache = snapshots.docs.map((snapshot) => ({ uid: snapshot.id, ...snapshot.data() }));
    leaderboardCachedAt = Date.now();
    return leaderboardCache;
  }

  async function getIslandCommunity(islandId) {
    if (!islandIds.has(islandId)) return emptyIslandCommunity();
    if (islandCache.has(islandId)) return islandCache.get(islandId);
    const request = Promise.all([
      getDoc(doc(db, 'islandStats', islandId)),
      getDocs(query(
        collection(db, 'notes', islandId, 'entries'),
        orderBy('count', 'desc'),
        limit(3),
      )),
    ]).then(([statsSnapshot, notesSnapshot]) => {
      const stats = statsSnapshot.exists() ? statsSnapshot.data() : {};
      const solvedCount = safeInteger(stats.solvedCount);
      return {
        solvedCount,
        averageDurationMs: solvedCount > 0
          ? Math.round(safeInteger(stats.sumDurationMs) / solvedCount)
          : 0,
        notes: notesSnapshot.docs.map((snapshot) => ({
          phraseId: snapshot.id,
          count: safeInteger(snapshot.data().count),
        })),
      };
    }).catch((error) => {
      islandCache.delete(islandId);
      reportCommunityError(`island-read:${islandId}`, error);
      return emptyIslandCommunity();
    });
    islandCache.set(islandId, request);
    return request;
  }

  async function getGhosts(regionId) {
    const cutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60_000);
    const snapshots = await getDocs(query(
      collection(db, 'leaderboard'),
      where('activeRegionId', '==', regionId),
      where('updatedAt', '>=', cutoff),
      orderBy('updatedAt', 'desc'),
      limit(GHOST_LIMIT),
    ));
    return snapshots.docs
      .filter((snapshot) => snapshot.id !== uid)
      .map((snapshot) => ({ uid: snapshot.id, ...snapshot.data() }));
  }

  function scheduleRetry(key, action) {
    if (disposed || retryTasks.has(key)) return;
    const task = { action, attempts: 0, timer: null };
    retryTasks.set(key, task);
    const run = async () => {
      if (disposed) return;
      if (!navigator.onLine) {
        task.timer = window.setTimeout(run, 30_000);
        return;
      }
      task.attempts = Math.min(MAX_RETRY_ATTEMPTS, task.attempts + 1);
      try {
        const result = await task.action();
        if (result?.ok) {
          retryTasks.delete(key);
          return;
        }
      } catch (error) {
        reportCommunityError(`retry:${key}`, error);
      }
      task.timer = window.setTimeout(run, Math.min(30_000, 2_000 * (2 ** task.attempts)));
    };
    task.timer = window.setTimeout(run, 2_000);
  }

  return {
    mode: 'firebase',
    ensureRegistration,
    savePlayerAndProfile,
    recordFirstSolve,
    leaveNote,
    getGlobalCounter,
    getLeaderboard,
    getIslandCommunity,
    getGhosts,
    get pendingRetryCount() { return retryTasks.size; },
    dispose() {
      disposed = true;
      retryTasks.forEach((task) => window.clearTimeout(task.timer));
      retryTasks.clear();
    },
  };
}

function leaderboardData({ nickname, solvedCount, currentIslandId, activeRegionId }) {
  return {
    nickname,
    solvedCount,
    currentIslandId,
    activeRegionId,
    updatedAt: serverTimestamp(),
  };
}

function createFixtureCommunity(worldData, notePhrases, qaPreset) {
  const islandIds = worldData.regions[0].islands;
  const nicknames = [
    'Cesur Baykuş', 'Meraklı Yunus', 'Mor Kaplumbağa', 'Neşeli Panda', 'Çevik Tilki',
    'Parlak Kirpi', 'Sakin Koala', 'Uyanık Sincap', 'Dost Canlısı Balina', 'Maceracı Kurbağa',
    'Yeşil Arı', 'Bilge Penguen', 'Şen Tavşan', 'Sabırlı Kunduz', 'Işıltılı Turna',
    'Kibar Lama', 'Hızlı Ceylan', 'Gülen Fok', 'Renkli Papağan', 'Sevimli Su Samuru',
  ];
  const leaderboard = nicknames.map((nickname, index) => ({
    uid: `qa-player-${index + 1}`,
    nickname,
    solvedCount: Math.max(1, 58 - index * 2),
    currentIslandId: islandIds[index % islandIds.length],
    activeRegionId: worldData.regions[0].id,
  }));
  const ghosts = leaderboard.slice(0, 12);
  return {
    mode: 'fixture',
    ensureRegistration: async () => ({ ok: true }),
    savePlayerAndProfile: async () => ({ ok: true }),
    recordFirstSolve: async () => ({ ok: true }),
    leaveNote: async () => ({ ok: true }),
    getGlobalCounter: async () => ({ solved: 1247, players: 318 }),
    getLeaderboard: async () => leaderboard,
    getIslandCommunity: async () => (qaPreset === 'island-stats' ? {
      solvedCount: 1247,
      averageDurationMs: 4 * 60_000,
      notes: notePhrases.slice(0, 3).map((phrase, index) => ({
        phraseId: phrase.id,
        count: [38, 21, 14][index],
      })),
    } : emptyIslandCommunity()),
    getGhosts: async () => (qaPreset === 'ghost-region' ? ghosts : []),
    get pendingRetryCount() { return 0; },
    dispose() {},
  };
}

function createEmptyCommunity() {
  return {
    mode: 'offline',
    ensureRegistration: async () => ({ ok: false, reason: 'offline' }),
    savePlayerAndProfile: async () => ({ ok: false, reason: 'offline' }),
    recordFirstSolve: async () => ({ ok: false, reason: 'offline' }),
    leaveNote: async () => ({ ok: false, reason: 'offline' }),
    getGlobalCounter: async () => ({ solved: 0, players: 0 }),
    getLeaderboard: async () => [],
    getIslandCommunity: async () => emptyIslandCommunity(),
    getGhosts: async () => [],
    get pendingRetryCount() { return 0; },
    dispose() {},
  };
}

function emptyIslandCommunity() {
  return { solvedCount: 0, averageDurationMs: 0, notes: [] };
}

function randomShard() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] % SHARD_COUNT;
  }
  return Math.floor(Math.random() * SHARD_COUNT);
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function reportCommunityError(operation, error) {
  console.warn(`[community] ${operation} başarısız; arka planda devam edilecek.`, {
    code: error?.code || 'unknown',
    message: error?.message || String(error),
  });
}

function withTimeout(promise, durationMs, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => {
        const error = new Error(code);
        error.code = code;
        reject(error);
      }, durationMs);
    }),
  ]).finally(() => window.clearTimeout(timer));
}
