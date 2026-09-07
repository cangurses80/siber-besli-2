export function createProgress(worldData) {
  const islandById = new Map(worldData.islands.map((island) => [island.id, island]));
  const regionById = new Map(worldData.regions.map((region) => [region.id, region]));
  const islandBridgeById = new Map(worldData.bridges.map((bridge) => [bridge.id, bridge]));
  const regionBridgeById = new Map(worldData.regionBridges.map((bridge) => [bridge.id, bridge]));
  const listeners = new Set();
  const solvedIslands = new Set();
  const openBridges = new Set(
    [...worldData.bridges, ...worldData.regionBridges]
      .filter((bridge) => bridge.state === 'open')
      .map((bridge) => bridge.id),
  );
  let activeRegionId = worldData.regions[0].id;
  let currentIslandId = worldData.regions[0].islands[0];

  function getSnapshot() {
    return Object.freeze({
      solvedIslands: new Set(solvedIslands),
      openBridges: new Set(openBridges),
      activeRegionId,
      currentIslandId,
    });
  }

  function emit(type, detail = {}) {
    const event = Object.freeze({ type, ...detail, state: getSnapshot() });
    listeners.forEach((listener) => listener(event));
  }

  function getReachableIslandIds(regionId = activeRegionId) {
    const region = regionById.get(regionId);
    if (!region) return new Set();
    const currentIsland = islandById.get(currentIslandId);
    const startId = currentIsland?.regionId === regionId ? currentIslandId : region.islands[0];
    return walkGraph(startId, worldData.bridges, openBridges, (id) => (
      islandById.get(id)?.regionId === regionId
    ));
  }

  function getReachableRegionIds() {
    return walkGraph(activeRegionId, worldData.regionBridges, openBridges, (id) => regionById.has(id));
  }

  function isIslandReachable(islandId) {
    const island = islandById.get(islandId);
    return island?.regionId === activeRegionId && getReachableIslandIds(activeRegionId).has(islandId);
  }

  function isRegionReachable(regionId) {
    return getReachableRegionIds().has(regionId);
  }

  function setCurrentIsland(islandId) {
    if (!isIslandReachable(islandId) || currentIslandId === islandId) return false;
    const previousIslandId = currentIslandId;
    currentIslandId = islandId;
    emit('current-island', { islandId, previousIslandId });
    return true;
  }

  function solveIsland(islandId) {
    const island = islandById.get(islandId);
    if (!island) return emptySolveResult(islandId);
    const reachableBefore = getReachableIslandIds(island.regionId);
    const openedBridgeIds = [];

    for (const bridge of worldData.bridges) {
      if ((bridge.from === islandId || bridge.to === islandId) && !openBridges.has(bridge.id)) {
        openBridges.add(bridge.id);
        openedBridgeIds.push(bridge.id);
      }
    }
    for (const bridge of worldData.regionBridges) {
      if (bridge.unlockedBy === islandId && !openBridges.has(bridge.id)) {
        openBridges.add(bridge.id);
        openedBridgeIds.push(bridge.id);
      }
    }

    const newlySolved = !solvedIslands.has(islandId);
    solvedIslands.add(islandId);
    const reachableAfter = getReachableIslandIds(island.regionId);
    const newlyReachableIslandIds = [...reachableAfter].filter((id) => !reachableBefore.has(id));
    const focusIslandId = firstNewUnsolvedNeighbour(
      islandId,
      newlyReachableIslandIds,
      worldData.bridges,
      solvedIslands,
    );
    const changed = newlySolved || openedBridgeIds.length > 0;
    const result = Object.freeze({
      changed,
      islandId,
      newlySolved,
      openedBridgeIds: Object.freeze(openedBridgeIds),
      newlyReachableIslandIds: Object.freeze(newlyReachableIslandIds),
      focusIslandId,
    });
    if (changed) emit('island-solved', result);
    return result;
  }

  function setBridgeState(bridgeId, state) {
    if (state !== 'open' && state !== 'closed') return false;
    if (!islandBridgeById.has(bridgeId) && !regionBridgeById.has(bridgeId)) return false;
    const wasOpen = openBridges.has(bridgeId);
    const shouldOpen = state === 'open';
    if (wasOpen === shouldOpen) return false;
    if (shouldOpen) openBridges.add(bridgeId);
    else openBridges.delete(bridgeId);
    emit('bridge-state', { bridgeId, bridgeState: state });
    return true;
  }

  function setActiveRegion(regionId) {
    const region = regionById.get(regionId);
    if (!region || !isRegionReachable(regionId)) return false;
    if (activeRegionId === regionId) return false;
    const previousRegionId = activeRegionId;
    activeRegionId = regionId;
    currentIslandId = region.islands[0];
    emit('active-region', {
      regionId,
      previousRegionId,
      currentIslandId,
    });
    return true;
  }

  function solveRegion(regionId = activeRegionId) {
    const region = regionById.get(regionId);
    if (!region) return Object.freeze({ changed: false, openedBridgeIds: Object.freeze([]) });
    const openedBridgeIds = new Set();
    let changed = false;
    for (const islandId of region.islands) {
      if (!solvedIslands.has(islandId)) {
        solvedIslands.add(islandId);
        changed = true;
      }
      for (const bridge of worldData.bridges) {
        if ((bridge.from === islandId || bridge.to === islandId) && !openBridges.has(bridge.id)) {
          openBridges.add(bridge.id);
          openedBridgeIds.add(bridge.id);
          changed = true;
        }
      }
      for (const bridge of worldData.regionBridges) {
        if (bridge.unlockedBy === islandId && !openBridges.has(bridge.id)) {
          openBridges.add(bridge.id);
          openedBridgeIds.add(bridge.id);
          changed = true;
        }
      }
    }
    const result = Object.freeze({
      changed,
      regionId,
      openedBridgeIds: Object.freeze([...openedBridgeIds]),
    });
    if (changed) emit('region-solved', result);
    return result;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener bir fonksiyon olmalı');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    get state() { return getSnapshot(); },
    getState: getSnapshot,
    getReachableIslandIds,
    getReachableRegionIds,
    isIslandReachable,
    isRegionReachable,
    setCurrentIsland,
    solveIsland,
    solveRegion,
    setBridgeState,
    setActiveRegion,
    subscribe,
  });
}

function walkGraph(startId, edges, openEdgeIds, acceptsNode) {
  if (!startId || !acceptsNode(startId)) return new Set();
  const adjacency = new Map();
  for (const edge of edges) {
    if (!openEdgeIds.has(edge.id)) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const visited = new Set();
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id) || !acceptsNode(id)) continue;
    visited.add(id);
    queue.push(...(adjacency.get(id) || []));
  }
  return visited;
}

function firstNewUnsolvedNeighbour(islandId, newlyReachableIslandIds, bridges, solvedIslands) {
  const newlyReachable = new Set(newlyReachableIslandIds);
  for (const bridge of bridges) {
    let neighbourId = null;
    if (bridge.from === islandId) neighbourId = bridge.to;
    else if (bridge.to === islandId) neighbourId = bridge.from;
    if (neighbourId && newlyReachable.has(neighbourId) && !solvedIslands.has(neighbourId)) {
      return neighbourId;
    }
  }
  return null;
}

function emptySolveResult(islandId) {
  return Object.freeze({
    changed: false,
    islandId,
    newlySolved: false,
    openedBridgeIds: Object.freeze([]),
    newlyReachableIslandIds: Object.freeze([]),
    focusIslandId: null,
  });
}
