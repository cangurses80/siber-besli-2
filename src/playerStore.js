export const PLAYER_SCHEMA_VERSION = 1;
export const SERVER_TIMESTAMP_MARKER = '__server_timestamp__';
export const DELETE_FIELD_MARKER = '__delete_field__';

export function hasCompleteFirebaseConfig(config) {
  return config !== null
    && typeof config === 'object'
    && Object.values(config).length >= 6
    && Object.values(config).every((value) => typeof value === 'string' && value.trim().length > 0);
}

export function createInitialProgressState(worldData) {
  return {
    solvedIslands: new Set(),
    openBridges: new Set(
      [...worldData.bridges, ...worldData.regionBridges]
        .filter((bridge) => bridge.state === 'open')
        .map((bridge) => bridge.id),
    ),
    activeRegionId: worldData.regions[0].id,
    currentIslandId: worldData.regions[0].islands[0],
  };
}

export function hydratePlayerDocument(worldData, source = {}) {
  const initial = createInitialProgressState(worldData);
  const validIslandIds = new Set(worldData.islands.map((island) => island.id));
  const validIslandBridgeIds = new Set(worldData.bridges.map((bridge) => bridge.id));
  const validRegionBridgeIds = new Set(worldData.regionBridges.map((bridge) => bridge.id));
  const validRegionIds = new Set(worldData.regions.map((region) => region.id));
  const islandById = new Map(worldData.islands.map((island) => [island.id, island]));
  const puzzleRecords = {};

  if (isPlainObject(source.solved)) {
    for (const [islandId, record] of Object.entries(source.solved)) {
      if (!validIslandIds.has(islandId) || !isPlainObject(record)) continue;
      const normalized = normalizePuzzleRecord(record);
      if (normalized) puzzleRecords[islandId] = normalized;
    }
  }

  const openIslandBridges = validIds(source.openBridges, validIslandBridgeIds);
  const openRegionBridges = validIds(source.openRegionBridges, validRegionBridgeIds);
  const openBridges = new Set(initial.openBridges);
  openIslandBridges.forEach((id) => openBridges.add(id));
  openRegionBridges.forEach((id) => openBridges.add(id));
  const reachableRegions = walkRegions(worldData, worldData.regions[0].id, openBridges);
  const requestedRegionId = validRegionIds.has(source.activeRegionId)
    && reachableRegions.has(source.activeRegionId)
    ? source.activeRegionId
    : initial.activeRegionId;
  const requestedIsland = islandById.get(source.currentIslandId);
  const currentIslandId = requestedIsland?.regionId === requestedRegionId
    ? requestedIsland.id
    : worldData.regions.find((region) => region.id === requestedRegionId).islands[0];

  return {
    nickname: typeof source.nickname === 'string' ? source.nickname.trim().slice(0, 40) : '',
    puzzleRecords,
    progressState: {
      solvedIslands: new Set(
        Object.entries(puzzleRecords)
          .filter(([, record]) => record.solvedAt != null)
          .map(([islandId]) => islandId),
      ),
      openBridges,
      activeRegionId: requestedRegionId,
      currentIslandId,
    },
  };
}

export function serializePlayerState(worldData, progressState, puzzleRecords = {}) {
  const islandBridgeIds = new Set(worldData.bridges.map((bridge) => bridge.id));
  const regionBridgeIds = new Set(worldData.regionBridges.map((bridge) => bridge.id));
  const validIslandIds = new Set(worldData.islands.map((island) => island.id));
  const solved = {};
  for (const [islandId, record] of Object.entries(puzzleRecords)) {
    if (!validIslandIds.has(islandId)) continue;
    const normalized = normalizePuzzleRecord(record);
    if (normalized) solved[islandId] = normalized;
  }
  const openIds = progressState?.openBridges instanceof Set
    ? [...progressState.openBridges]
    : Array.isArray(progressState?.openBridges) ? progressState.openBridges : [];
  return {
    activeRegionId: progressState.activeRegionId,
    currentIslandId: progressState.currentIslandId,
    solvedCount: progressState.solvedIslands instanceof Set ? progressState.solvedIslands.size : 0,
    solved,
    openBridges: [...new Set(openIds.filter((id) => islandBridgeIds.has(id)))],
    openRegionBridges: [...new Set(openIds.filter((id) => regionBridgeIds.has(id)))],
    schemaVersion: PLAYER_SCHEMA_VERSION,
  };
}

export function createNewPlayerDocument(worldData, nickname) {
  const initial = createInitialProgressState(worldData);
  return {
    nickname: nickname.trim(),
    createdAt: SERVER_TIMESTAMP_MARKER,
    lastSeenAt: SERVER_TIMESTAMP_MARKER,
    ...serializePlayerState(worldData, initial, {}),
  };
}

export function recordPuzzleAttempt(puzzleRecords, islandId) {
  const previous = normalizePuzzleRecord(puzzleRecords[islandId]) || {
    solvedAt: null,
    durationMs: 0,
    attempts: 0,
  };
  return {
    ...puzzleRecords,
    [islandId]: {
      ...previous,
      attempts: previous.attempts + 1,
    },
  };
}

export function recordPuzzleSolve(puzzleRecords, islandId, durationMs) {
  const previous = normalizePuzzleRecord(puzzleRecords[islandId]) || {
    solvedAt: null,
    durationMs: 0,
    attempts: 1,
  };
  const alreadySolved = previous.solvedAt != null;
  return {
    ...puzzleRecords,
    [islandId]: {
      solvedAt: alreadySolved ? previous.solvedAt : SERVER_TIMESTAMP_MARKER,
      durationMs: alreadySolved ? previous.durationMs : normalizeDuration(durationMs),
      attempts: Math.max(1, previous.attempts),
    },
  };
}

export function resetPlayerProgress(worldData) {
  return {
    puzzleRecords: {},
    progressState: createInitialProgressState(worldData),
  };
}

function normalizePuzzleRecord(record) {
  if (!isPlainObject(record)) return null;
  const attempts = Number(record.attempts);
  const durationMs = Number(record.durationMs);
  if (!Number.isFinite(attempts) || attempts < 1 || !Number.isInteger(attempts)) return null;
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  return {
    solvedAt: record.solvedAt ?? null,
    durationMs: normalizeDuration(durationMs),
    attempts,
  };
}

function normalizeDuration(value) {
  return Math.max(0, Math.round(Number.isFinite(Number(value)) ? Number(value) : 0));
}

function validIds(value, validSet) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && validSet.has(id)))];
}

function walkRegions(worldData, startRegionId, openBridgeIds) {
  const visited = new Set();
  const queue = [startRegionId];
  while (queue.length) {
    const regionId = queue.shift();
    if (visited.has(regionId)) continue;
    visited.add(regionId);
    for (const bridge of worldData.regionBridges) {
      if (!openBridgeIds.has(bridge.id)) continue;
      if (bridge.from === regionId) queue.push(bridge.to);
      if (bridge.to === regionId) queue.push(bridge.from);
    }
  }
  return visited;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
