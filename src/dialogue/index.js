export const DIALOGUE_TRIGGERS = Object.freeze([
  'first_launch',
  'island_reachable',
  'puzzle_enter',
  'puzzle_solved',
  'bridge_opened',
  'region_bridge_opened',
  'region_entered',
  'note_left',
  'idle_60s',
  'leaderboard_opened',
  'world_map_opened',
]);

export const DIALOGUE_TOKENS = Object.freeze([
  'regionName',
  'islandName',
  'nickname',
  'solvedCount',
]);

const WHEN_FIELDS = new Set(['flagsAll', 'flagsNone', 'solvedMin', 'regionId', 'islandId']);
const RECORD_FIELDS = new Set(['id', 'trigger', 'when', 'lines', 'setFlags', 'once', 'priority']);
const FLAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const TOKEN_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function validateDialogueRecords(records, worldData) {
  if (!Array.isArray(records)) throw new Error('Mimar diyalog verisi bir liste olmalı');
  const regionIds = new Set(worldData.regions.map(({ id }) => id));
  const islandIds = new Set(worldData.islands.map(({ id }) => id));
  const triggerIds = new Set(DIALOGUE_TRIGGERS);
  const allowedTokens = new Set(DIALOGUE_TOKENS);
  const ids = new Set();
  const knownFlags = new Set();

  records.forEach((record, index) => {
    const label = `mimar.json[${index}]`;
    if (!isPlainObject(record)) throw new Error(`${label} nesne olmalı`);
    assertOnlyKeys(record, RECORD_FIELDS, label);
    if (!isSafeId(record.id)) throw new Error(`${label}.id geçersiz`);
    if (ids.has(record.id)) throw new Error(`Tekrarlanan diyalog ID: ${record.id}`);
    ids.add(record.id);
    if (!triggerIds.has(record.trigger)) throw new Error(`${record.id}: bilinmeyen trigger ${record.trigger}`);
    if (!isPlainObject(record.when)) throw new Error(`${record.id}.when nesne olmalı`);
    assertOnlyKeys(record.when, WHEN_FIELDS, `${record.id}.when`);
    validateStringList(record.when.flagsAll, `${record.id}.when.flagsAll`, { optional: true, flag: true });
    validateStringList(record.when.flagsNone, `${record.id}.when.flagsNone`, { optional: true, flag: true });
    if (record.when.solvedMin !== undefined
      && (!Number.isInteger(record.when.solvedMin) || record.when.solvedMin < 0 || record.when.solvedMin > 60)) {
      throw new Error(`${record.id}.when.solvedMin 0–60 integer olmalı`);
    }
    if (record.when.regionId !== undefined && !regionIds.has(record.when.regionId)) {
      throw new Error(`${record.id}: geçersiz regionId ${record.when.regionId}`);
    }
    if (record.when.islandId !== undefined && !islandIds.has(record.when.islandId)) {
      throw new Error(`${record.id}: geçersiz islandId ${record.when.islandId}`);
    }
    validateStringList(record.lines, `${record.id}.lines`);
    if (record.lines.length === 0) throw new Error(`${record.id}.lines boş olamaz`);
    record.lines.forEach((line) => {
      if (!line.startsWith('[PH]')) throw new Error(`${record.id}: bütün satırlar [PH] ile başlamalı`);
      for (const [, token] of line.matchAll(TOKEN_PATTERN)) {
        if (!allowedTokens.has(token)) throw new Error(`${record.id}: bilinmeyen token {${token}}`);
      }
    });
    validateStringList(record.setFlags, `${record.id}.setFlags`, { flag: true });
    record.setFlags.forEach((flag) => knownFlags.add(flag));
    if (record.once === true && record.setFlags.length === 0) {
      throw new Error(`${record.id}: once diyalog en az bir flag koymalı`);
    }
    if (typeof record.once !== 'boolean') throw new Error(`${record.id}.once boolean olmalı`);
    if (!Number.isInteger(record.priority)) throw new Error(`${record.id}.priority integer olmalı`);
  });

  if (knownFlags.size > 64) throw new Error(`Mimar flag sayısı 64 sınırını aşıyor: ${knownFlags.size}`);
  return { records, ids, knownFlags };
}

export function createDialogueController({ records, getContext, getFlags, setFlags, present }) {
  const listeners = new Set();
  const queue = [];
  const pendingKeys = new Set();
  let active = null;
  let draining = false;

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  }

  function trigger(triggerName, context = {}) {
    return enqueue({ triggerName, context, forcedId: null });
  }

  function runById(dialogueId, context = {}) {
    return enqueue({ triggerName: null, context, forcedId: dialogueId });
  }

  function enqueue(event) {
    const key = event.forcedId
      ? `id:${event.forcedId}`
      : `${event.triggerName}:${event.context.regionId || ''}:${event.context.islandId || ''}`;
    if (pendingKeys.has(key)) return Promise.resolve(false);
    return new Promise((resolve) => {
      pendingKeys.add(key);
      queue.push({ ...event, key, resolve });
      void drain();
    });
  }

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const event = queue.shift();
      const context = { ...getContext(), ...event.context };
      const record = event.forcedId
        ? records.find(({ id }) => id === event.forcedId)
        : selectDialogue(records, event.triggerName, context, getFlags());
      if (!record) {
        pendingKeys.delete(event.key);
        event.resolve(false);
        continue;
      }
      active = record;
      emit();
      const lines = record.lines.map((line) => interpolateDialogueLine(line, context));
      const outcome = await present(record, lines, context);
      if (outcome !== false && record.setFlags.length > 0) await setFlags(record.setFlags, record);
      active = null;
      pendingKeys.delete(event.key);
      event.resolve(outcome !== false);
      emit();
    }
    draining = false;
  }

  function snapshot() {
    return Object.freeze({ activeId: active?.id || null, speaking: Boolean(active), queued: queue.length });
  }

  function emit() {
    const state = snapshot();
    listeners.forEach((listener) => listener(state));
  }

  return {
    trigger,
    runById,
    subscribe,
    get state() { return snapshot(); },
  };
}

export function selectDialogue(records, triggerName, context, flags) {
  const flagSet = flags instanceof Set ? flags : new Set(flags || []);
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.trigger === triggerName
      && !(record.once && record.setFlags.some((flag) => flagSet.has(flag)))
      && matchesWhen(record.when, context, flagSet))
    .sort((left, right) => right.record.priority - left.record.priority || left.index - right.index)[0]?.record || null;
}

export function interpolateDialogueLine(line, context) {
  return line.replace(TOKEN_PATTERN, (_, token) => String(context[token] ?? ''));
}

function matchesWhen(when, context, flags) {
  if ((when.flagsAll || []).some((flag) => !flags.has(flag))) return false;
  if ((when.flagsNone || []).some((flag) => flags.has(flag))) return false;
  if (when.solvedMin !== undefined && Number(context.solvedCount || 0) < when.solvedMin) return false;
  if (when.regionId !== undefined && context.regionId !== when.regionId) return false;
  if (when.islandId !== undefined && context.islandId !== when.islandId) return false;
  return true;
}

function validateStringList(value, label, { optional = false, flag = false } = {}) {
  if (optional && value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${label} liste olmalı`);
  if (new Set(value).size !== value.length) throw new Error(`${label} tekrarlı değer içeriyor`);
  value.forEach((item) => {
    if (typeof item !== 'string' || item.length === 0) throw new Error(`${label} boş olmayan string içermeli`);
    if (flag && !FLAG_PATTERN.test(item)) throw new Error(`${label} geçersiz flag içeriyor: ${item}`);
  });
}

function assertOnlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} bilinmeyen alan içeriyor: ${unknown.join(', ')}`);
}

function isSafeId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
