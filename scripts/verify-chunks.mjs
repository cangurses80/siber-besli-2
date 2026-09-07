import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8'));
const gameEntry = manifest['oyna/index.html'];
assert.ok(gameEntry?.isEntry, 'Vite manifest içinde oyun entry bulunmalı');
const mainBytes = (await stat(new URL(`../dist/${gameEntry.file}`, import.meta.url))).size;
assert.ok(mainBytes < 700_000, `İlk oyun chunkı 700 kB altında olmalı; ölçülen ${mainBytes} byte`);

const dynamicKeys = gameEntry.dynamicImports || [];
const dynamicEntries = dynamicKeys.map((key) => manifest[key]).filter(Boolean);
assert.ok(dynamicEntries.length >= 2, 'Firebase ve topluluk katmanı dinamik import olmalı');
const firebaseFiles = new Set();
for (const entry of dynamicEntries) {
  firebaseFiles.add(entry.file);
  for (const importedKey of entry.imports || []) {
    const imported = manifest[importedKey];
    if (imported?.file) firebaseFiles.add(imported.file);
  }
}
assert.ok(
  [...firebaseFiles].some((file) => /firebase|index\.esm/i.test(file)),
  'Firebase SDK ayrı asenkron chunklarda bulunmalı',
);

const sizes = Object.fromEntries(await Promise.all([...firebaseFiles].map(async (file) => [
  file,
  (await stat(new URL(`../dist/${file}`, import.meta.url))).size,
])));
delete sizes[gameEntry.file];
console.log(`Chunk bütçesi doğrulandı: ilk oyun ${formatKb(mainBytes)} (<700 kB)`);
console.log(`  Asenkron Firebase/topluluk chunkları: ${Object.entries(sizes).map(([file, bytes]) => `${file} ${formatKb(bytes)}`).join(', ')}`);

function formatKb(bytes) {
  return `${(bytes / 1000).toFixed(2)} kB`;
}
