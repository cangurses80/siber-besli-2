import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
} from 'firebase/auth';
import {
  doc,
  deleteField,
  getDoc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  DELETE_FIELD_MARKER,
  hasCompleteFirebaseConfig,
  SERVER_TIMESTAMP_MARKER,
} from './playerStore.js';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const STATUS_LABELS = Object.freeze({
  offline: 'Çevrimdışı',
  new: 'Henüz kaydedilmedi',
  saving: 'Kaydediliyor…',
  saved: 'Kaydedildi',
  pending: 'Kayıt beklemede',
});

export async function createPlayerPersistence({ forceOffline = false } = {}) {
  const listeners = new Set();
  let status = createStatus('offline');
  let pendingPatch = null;
  let hydrated = false;
  let snapshotUnsubscribe = null;
  let onlineHandler = null;

  function setStatus(kind, detail = '') {
    status = createStatus(kind, detail);
    listeners.forEach((listener) => listener(status));
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(status);
    return () => listeners.delete(listener);
  }

  if (forceOffline || !hasCompleteFirebaseConfig(firebaseConfig)) {
    return createMemoryPersistence({ forced: forceOffline, subscribe, getStatus: () => status });
  }

  try {
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    const db = createFirestore(app);
    const auth = getAuth(app);
    const authPersistence = await configureAuthPersistence(auth);
    const restoredUser = await waitForInitialAuthState(auth);
    const user = restoredUser || (await signInAnonymously(auth)).user;
    const playerId = user.uid;
    const playerRef = doc(db, 'players', playerId);
    let writeInFlight = null;
    let atomicTail = Promise.resolve();

    console.info('[firebase] Anonim kimlik hazır.', {
      uid: playerId,
      authPersistence,
    });

    async function loadPlayer() {
      try {
        const snapshot = await getDoc(playerRef);
        hydrated = true;
        console.info('[firebase] Oyuncu belgesi okundu.', {
          path: playerRef.path,
          exists: snapshot.exists(),
          fromCache: snapshot.metadata.fromCache,
        });
        if (snapshot.exists() && !snapshot.metadata.fromCache) setStatus('saved');
        else if (snapshot.exists()) setStatus('pending', 'cache-only');
        else setStatus('new');
        snapshotUnsubscribe = onSnapshot(
          playerRef,
          { includeMetadataChanges: true },
          (nextSnapshot) => {
            if (nextSnapshot.metadata.hasPendingWrites) {
              setStatus(navigator.onLine ? 'saving' : 'pending');
            } else if (nextSnapshot.exists() && !nextSnapshot.metadata.fromCache) {
              setStatus('saved');
            } else if (nextSnapshot.exists()) {
              setStatus('pending', 'cache-only');
            } else if (!nextSnapshot.metadata.fromCache) {
              setStatus('new');
            }
          },
          (error) => handleWriteError(error, setStatus),
        );
        return { ok: true, exists: snapshot.exists(), data: snapshot.exists() ? snapshot.data() : null };
      } catch (error) {
        console.error('[firebase] Oyuncu belgesi okunamadı; bellek modu korunuyor.', error);
        setStatus('pending', error?.code || 'read-failed');
        return { ok: false, exists: false, data: null, error };
      }
    }

    async function savePlayer(patch, reason = 'progress', { expectedNickname = null } = {}) {
      pendingPatch = mergeObjects(pendingPatch || {}, patch);
      if (!hydrated) {
        setStatus('pending', 'hydration-required');
        return { ok: false, reason: 'hydration-required' };
      }
      if (!writeInFlight) {
        writeInFlight = atomicTail.then(() => flushPendingWrites(reason, expectedNickname))
          .finally(() => { writeInFlight = null; });
      }
      return writeInFlight;
    }

    async function savePlayerAtomically(
      patch,
      reason,
      addBatchWrites,
      { expectedNickname = null } = {},
    ) {
      const priorWrite = writeInFlight;
      const run = async () => {
        if (!hydrated) {
          setStatus('pending', 'hydration-required');
          return { ok: false, reason: 'hydration-required' };
        }
        if (priorWrite) await priorWrite;
        setStatus(navigator.onLine ? 'saving' : 'pending', reason);
        console.info('[firebase] Atomik yazma başladı.', { path: playerRef.path, reason });
        try {
          const batch = writeBatch(db);
          batch.set(playerRef, replaceTimestampMarkers(patch), { merge: true });
          await addBatchWrites?.({ batch, db, playerId, playerRef });
          await withTimeout(batch.commit(), 12_000, 'batch-timeout');
          const confirmedSnapshot = await withTimeout(
            getDocFromServer(playerRef),
            12_000,
            'readback-timeout',
          );
          if (!confirmedSnapshot.exists()) throw createPersistenceError('document-missing');
          if (expectedNickname !== null
            && confirmedSnapshot.data().nickname !== expectedNickname) {
            throw createPersistenceError('nickname-mismatch');
          }
          console.info('[firebase] Atomik yazma sunucuda doğrulandı.', {
            path: playerRef.path,
            reason,
          });
          setStatus('saved');
          return { ok: true, data: confirmedSnapshot.data() };
        } catch (error) {
          handleWriteError(error, setStatus);
          return { ok: false, reason: error?.code || error?.message || 'batch-failed', error };
        }
      };
      const queued = atomicTail.then(run, run);
      atomicTail = queued.then(() => undefined, () => undefined);
      return queued;
    }

    async function flushPendingWrites(reason, expectedNickname) {
      let confirmedSnapshot = null;
      while (pendingPatch) {
        const write = pendingPatch;
        pendingPatch = null;
        setStatus(navigator.onLine ? 'saving' : 'pending', reason);
        console.info('[firebase] Yazma başladı.', { path: playerRef.path, reason });
        try {
          await withTimeout(
            setDoc(playerRef, replaceTimestampMarkers(write), { merge: true }),
            12_000,
            'write-timeout',
          );
          confirmedSnapshot = await withTimeout(
            getDocFromServer(playerRef),
            12_000,
            'readback-timeout',
          );
          if (!confirmedSnapshot.exists()) throw createPersistenceError('document-missing');
          if (expectedNickname !== null
            && confirmedSnapshot.data().nickname !== expectedNickname) {
            throw createPersistenceError('nickname-mismatch');
          }
          console.info('[firebase] Yazma sunucuda doğrulandı.', {
            path: playerRef.path,
            reason,
            nicknameVerified: expectedNickname !== null,
          });
          setStatus('saved');
        } catch (error) {
          pendingPatch = mergeObjects(write, pendingPatch || {});
          handleWriteError(error, setStatus);
          return { ok: false, reason: error?.code || error?.message || 'write-failed', error };
        }
      }
      return { ok: true, data: confirmedSnapshot?.data() || null };
    }

    onlineHandler = () => {
      if (pendingPatch && hydrated) void savePlayer({}, 'retry');
    };
    window.addEventListener('online', onlineHandler);

    return {
      mode: 'firebase',
      playerId,
      authPersistence,
      firestore: db,
      loadPlayer,
      savePlayer,
      savePlayerAtomically,
      subscribe,
      get status() { return status; },
      dispose() {
        snapshotUnsubscribe?.();
        if (onlineHandler) window.removeEventListener('online', onlineHandler);
        listeners.clear();
      },
    };
  } catch (error) {
    console.error('[firebase] Başlatma veya anonim giriş başarısız; bellek moduna dönüldü.', error);
    setStatus('offline', error?.code || 'startup-failed');
    return createMemoryPersistence({ forced: false, subscribe, getStatus: () => status, error });
  }
}

function createFirestore(app) {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (error) {
    if (error?.code === 'failed-precondition') {
      console.warn('[firebase] Mevcut Firestore instance yeniden kullanılıyor.', error);
      return getFirestore(app);
    }
    console.warn('[firebase] Kalıcı cache kullanılamadı; bellek cache ile devam ediliyor.', error);
    try {
      return initializeFirestore(app, { localCache: memoryLocalCache() });
    } catch (fallbackError) {
      if (fallbackError?.code === 'failed-precondition') return getFirestore(app);
      throw fallbackError;
    }
  }
}

function createMemoryPersistence({ forced, subscribe, getStatus, error = null }) {
  return {
    mode: 'memory',
    playerId: 'local',
    authPersistence: 'none',
    firestore: null,
    forcedOffline: forced,
    startupError: error,
    async loadPlayer() { return { ok: true, exists: false, data: null }; },
    async savePlayer() { return { ok: false, reason: 'offline' }; },
    async savePlayerAtomically() { return { ok: false, reason: 'offline' }; },
    subscribe,
    get status() { return getStatus(); },
    dispose() {},
  };
}

async function configureAuthPersistence(auth) {
  const candidates = [
    ['indexeddb', indexedDBLocalPersistence],
    ['local-storage', browserLocalPersistence],
    ['memory', inMemoryPersistence],
  ];
  let lastError = null;
  for (const [name, persistence] of candidates) {
    try {
      await setPersistence(auth, persistence);
      return name;
    } catch (error) {
      lastError = error;
      console.warn(`[firebase] Auth persistence kullanılamadı (${name}).`, {
        code: error?.code || 'unknown',
      });
    }
  }
  throw lastError || createPersistenceError('auth-persistence-unavailable');
}

function waitForInitialAuthState(auth) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

function withTimeout(promise, durationMs, code) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(createPersistenceError(code)), durationMs);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

function createPersistenceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function replaceTimestampMarkers(value) {
  if (value === SERVER_TIMESTAMP_MARKER) return serverTimestamp();
  if (value === DELETE_FIELD_MARKER) return deleteField();
  if (Array.isArray(value)) return value.map(replaceTimestampMarkers);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, replaceTimestampMarkers(child)]),
  );
}

function mergeObjects(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? mergeObjects(result[key], value)
      : value;
  }
  return result;
}

function handleWriteError(error, setStatus) {
  const code = error?.code || 'unknown';
  console.error(`[firebase] Kayıt başarısız (${code}); oyun bellekte devam ediyor.`, error);
  setStatus('pending', code);
}

function createStatus(kind, detail = '') {
  return Object.freeze({ kind, label: STATUS_LABELS[kind], detail });
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
