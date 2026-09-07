import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDialogueController,
  DIALOGUE_TRIGGERS,
  interpolateDialogueLine,
  selectDialogue,
  validateDialogueRecords,
} from '../src/dialogue/index.js';

const world = JSON.parse(await readFile(new URL('../src/world.json', import.meta.url), 'utf8'));
const records = JSON.parse(await readFile(new URL('../src/dialogue/mimar.json', import.meta.url), 'utf8'));
const validation = validateDialogueRecords(records, world);

assert.equal(validation.ids.size, records.length);
assert.ok(validation.knownFlags.size > 0 && validation.knownFlags.size <= 64);
assert.ok(DIALOGUE_TRIGGERS.every((trigger) => records.some((record) => record.trigger === trigger)),
  'Her trigger için en az bir placeholder kayıt bulunmalı');

const priorityRecords = [
  makeRecord({ id: 'low', priority: 1 }),
  makeRecord({ id: 'high', priority: 9 }),
  makeRecord({ id: 'same-priority-later', priority: 9 }),
];
assert.equal(selectDialogue(priorityRecords, 'puzzle_solved', { solvedCount: 0 }, new Set()).id, 'high');
assert.equal(interpolateDialogueLine('[PH] {nickname} · {islandName}', {
  nickname: 'Cesur Baykuş', islandName: 'Güneş Kapısı',
}), '[PH] Cesur Baykuş · Güneş Kapısı');

assertInvalid((copy) => { copy[0].trigger = 'unknown-trigger'; }, /bilinmeyen trigger/);
assertInvalid((copy) => { copy[0].when.regionId = 'unknown-region'; }, /geçersiz regionId/);
assertInvalid((copy) => { copy[0].when.islandId = 'unknown-island'; }, /geçersiz islandId/);
assertInvalid((copy) => { copy[0].when.unexpected = true; }, /bilinmeyen alan/);
assertInvalid((copy) => { copy[0].lines = []; }, /lines boş olamaz/);
assertInvalid((copy) => { copy[0].lines = ['[PH] {unknownToken}']; }, /bilinmeyen token/);
assertInvalid((copy) => { copy[0].setFlags = []; }, /once diyalog/);

const flags = new Set();
const shown = [];
const chainController = createDialogueController({
  records,
  getContext: () => ({ nickname: 'Cesur Baykuş', solvedCount: 0, regionId: 'helios', islandId: 'helios-01' }),
  getFlags: () => flags,
  setFlags: async (nextFlags) => nextFlags.forEach((flag) => flags.add(flag)),
  present: async (record) => { shown.push(record.id); return true; },
});
await chainController.trigger('first_launch');
await chainController.trigger('first_launch');
await chainController.trigger('first_launch');
assert.deepEqual(shown, ['welcome', 'transparency'], 'Karşılama → şeffaflık zinciri once flag’leriyle çalışmalı');

const queueShown = [];
let releaseFirst;
const queueController = createDialogueController({
  records: [
    makeRecord({ id: 'queue-first', trigger: 'bridge_opened', setFlags: ['mimar.queue_first'] }),
    makeRecord({ id: 'queue-second', trigger: 'note_left', setFlags: ['mimar.queue_second'] }),
  ],
  getContext: () => ({}),
  getFlags: () => new Set(),
  setFlags: async () => {},
  present: (record) => {
    queueShown.push(record.id);
    if (record.id === 'queue-first') return new Promise((resolve) => { releaseFirst = resolve; });
    return Promise.resolve(true);
  },
});
const firstQueued = queueController.trigger('bridge_opened');
const secondQueued = queueController.trigger('note_left');
await Promise.resolve();
assert.deepEqual(queueShown, ['queue-first']);
releaseFirst(true);
await Promise.all([firstQueued, secondQueued]);
assert.deepEqual(queueShown, ['queue-first', 'queue-second'], 'Trigger kuyruğu FIFO sırasını korumalı');

console.log('Mimar diyalog sistemi doğrulandı');
console.log(`  Kayıtlar: ${records.length}, trigger’lar: ${DIALOGUE_TRIGGERS.length}, flag’ler: ${validation.knownFlags.size}`);
console.log('  Şema, priority, FIFO kuyruk, once ve karşılama zinciri: tamam');

function assertInvalid(mutate, pattern) {
  const copy = structuredClone(records);
  mutate(copy);
  assert.throws(() => validateDialogueRecords(copy, world), pattern);
}

function makeRecord(overrides = {}) {
  return {
    id: 'record',
    trigger: 'puzzle_solved',
    when: {},
    lines: ['[PH] Deneme.'],
    setFlags: ['mimar.record'],
    once: true,
    priority: 1,
    ...overrides,
  };
}
