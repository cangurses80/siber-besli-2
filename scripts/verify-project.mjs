import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NICKNAME_ADJECTIVES, NICKNAME_ANIMALS } from '../src/nicknames.js';
import { NOTE_PHRASES } from '../src/notePhrases.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const [
  packageText,
  rootHtml,
  gameHtml,
  netlify,
  main,
  progress,
  puzzleIndex,
  placeholderPuzzle,
  gameCss,
  worldScene,
  renderConfig,
  shotScript,
  verifyWorld,
  firebaseSource,
  playerStore,
  nicknameSource,
  firestoreRules,
  envExample,
  firebaseRc,
  firebaseJson,
  gitignore,
  livePersistenceScript,
  rulesGenerator,
  communitySource,
  notePhrasesSource,
  firestoreIndexes,
  viteConfig,
  chunkVerifier,
] = await Promise.all([
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../oyna/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/progress.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/puzzles/index.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/puzzles/placeholder.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/game.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/scene/worldScene.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/render/config.js', import.meta.url), 'utf8'),
  readFile(new URL('./shot.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./verify-world.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/firebase.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/playerStore.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/nicknames.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  readFile(new URL('../.firebaserc', import.meta.url), 'utf8'),
  readFile(new URL('../firebase.json', import.meta.url), 'utf8'),
  readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
  readFile(new URL('./verify-live-persistence.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./gen-rules.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/community.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/notePhrases.js', import.meta.url), 'utf8'),
  readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'),
  readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
  readFile(new URL('./verify-chunks.mjs', import.meta.url), 'utf8'),
]);

const packageJson = JSON.parse(packageText);
assert.match(packageJson.dependencies.three, /^0\.179\./, 'Three.js r179 kullanılmalı');
assert.ok(packageJson.dependencies.firebase, 'Firebase modular Web SDK bağımlılığı olmalı');
assert.ok(packageJson.devDependencies.playwright, 'Playwright görsel QA bağımlılığı olmalı');
assert.equal(packageJson.scripts.shot, 'node scripts/shot.mjs', 'npm run shot komutu tanımlanmalı');
assert.equal(packageJson.scripts['gen:rules'], 'node scripts/gen-rules.mjs', 'Rules üretim komutu tanımlanmalı');
assert.equal(packageJson.scripts['verify:live'], 'node scripts/verify-live-persistence.mjs', 'Canlı reload testi kayıtlı olmalı');
assert.match(packageJson.scripts.verify, /verify-progress\.mjs/, 'Progress doğrulaması verify zincirinde olmalı');
assert.match(packageJson.scripts.verify, /verify-persistence\.mjs/, 'Persistence doğrulaması verify zincirinde olmalı');
assert.match(packageJson.scripts.verify, /verify:rules/, 'Rules emulator doğrulaması verify zincirinde olmalı');
assert.match(packageJson.scripts.verify, /verify-chunks\.mjs/, 'Chunk bütçesi verify zincirinde olmalı');
assert.match(rootHtml, /name="robots" content="noindex, nofollow"/, 'Root noindex meta içermeli');
assert.match(gameHtml, /name="robots" content="noindex, nofollow"/, '/oyna noindex meta içermeli');
assert.match(netlify, /X-Robots-Tag = "noindex, nofollow"/, 'Netlify noindex header içermeli');

assert.match(progress, /export function createProgress/, 'createProgress dışa aktarılmalı');
for (const api of [
  'getReachableIslandIds',
  'getReachableRegionIds',
  'isIslandReachable',
  'isRegionReachable',
  'setCurrentIsland',
  'solveIsland',
  'setBridgeState',
  'setActiveRegion',
  'subscribe',
]) {
  assert.match(progress, new RegExp(api), `Progress kontratında ${api} bulunmalı`);
}
assert.match(progress, /solvedIslands: new Set/, 'Snapshot çözülmüş adaları Set olarak vermeli');
assert.match(progress, /openBridges: new Set/, 'Snapshot açık köprüleri Set olarak vermeli');
assert.match(verifyWorld, /bridge\.unlockedBy/, 'unlockedBy doğrulaması mevcut olmalı');

assert.match(puzzleIndex, /export function registerPuzzle/, 'registerPuzzle dışa aktarılmalı');
assert.match(puzzleIndex, /export function getPuzzle/, 'getPuzzle dışa aktarılmalı');
assert.match(puzzleIndex, /registerPuzzle\('placeholder'/, 'Placeholder puzzle kayıtlı olmalı');
assert.match(placeholderPuzzle, /generate\(seed, difficulty\)/, 'Placeholder generate kontratını uygulamalı');
assert.match(placeholderPuzzle, /mount\(container, spec/, 'Placeholder mount kontratını uygulamalı');
assert.match(placeholderPuzzle, /unmount\(\)/, 'Placeholder unmount kontratını uygulamalı');
assert.match(gameHtml, /id="puzzle-room"/, 'Puzzle overlay HTML içinde olmalı');
assert.match(gameCss, /transition: opacity 400ms ease/, 'Puzzle fade 400 ms olmalı');
assert.match(main, /pipeline\.renderer\.setAnimationLoop\(null\)/, 'Puzzle açılınca render durmalı');
assert.match(main, /pipeline\.renderer\.setAnimationLoop\(renderFrame\)/, 'Puzzle kapanırken render devam etmeli');
assert.match(main, /createPuzzleSeed\(playerId, island\.id\)/, 'Puzzle seed anonim UID kullanmalı');
assert.match(main, /recordPuzzleAttempt/, 'Puzzle girişi attempts ölçmeli');
assert.match(main, /recordPuzzleSolve/, 'Puzzle çözümü duration ölçmeli');
assert.match(main, /debug-reset-progress/, 'Debug ilerleme reset kontrolü bağlanmalı');
assert.match(gameHtml, /id="sync-badge"/, 'Senkronizasyon rozeti mevcut olmalı');
assert.match(gameHtml, /id="nickname-room"/, 'Takma ad onay katmanı mevcut olmalı');
assert.match(gameHtml, /id="nickname-error"/, 'Takma ad yazma hatası katmanda gösterilmeli');
assert.match(gameHtml, /id="world-community"/, 'Dünya sayacı ve liderlik paneli bulunmalı');
assert.match(gameHtml, /id="island-community"/, 'Ada istatistik/not alanı bulunmalı');
assert.match(gameHtml, /id="note-room"/, 'Çözüm sonrası not katmanı bulunmalı');
assert.match(gameHtml, /id="note-more"[^>]*>Başkalarını göster</, 'Not katmanı yeni altılıyı gösterebilmeli');
assert.match(gameHtml, /id="note-skip"[^>]*>Not bırakmadan geç</, 'Notu atlama eylemi en altta açıkça bulunmalı');
assert.match(gameHtml, /id="ghost-labels"/, 'Hayalet takma ad etiket katmanı bulunmalı');

assert.match(main, /duration: 0\.8/, 'Kamera geçişi 800 ms olmalı');
assert.match(main, /OrbitControls/, 'Gezinti modunda OrbitControls kullanılmalı');
assert.match(main, /OrthographicCamera/g, 'Harita modlarında ortografik kamera kullanılmalı');
assert.match(main, /get\('debug'\) === '1'/, 'Debug modu ?debug=1 ile açılmalı');
assert.match(main, /searchParams\.get\('cam'\)/, 'Sabit QA kamera preset parametresi bulunmalı');
assert.match(main, /\[debug-hit\]/, 'Debug tıklaması mesh adını konsola yazmalı');
assert.match(main, /Seçili adayı çöz|debugSolveIsland/, 'Ada çözme debug kontrolü olmalı');
assert.match(main, /Bölgeyi tamamen çöz|debugSolveRegion/, 'Bölge çözme debug kontrolü olmalı');

assert.match(worldScene, /new THREE\.InstancedMesh/g, 'Ada parçaları InstancedMesh kullanmalı');
assert.match(worldScene, /\$\{namePrefix\} \$\{type\} landmarks \(instanced\)/, 'Landmark türleri InstancedMesh kullanmalı');
assert.match(worldScene, /createIslandBodyGeometry/, 'Ortak kaya geometrisi kullanılmalı');
assert.match(worldScene, /geometry\.normalizeNormals\(\)/, 'Displacement sonrası normaller normalize edilmeli');
assert.match(worldScene, /new THREE\.RingGeometry\(STONE_BAND_INNER_RADIUS, 1,/, 'Taş üst yüzeyi halka geometrisi olmalı');
assert.match(worldScene, /new THREE\.CircleGeometry\(GRASS_DISC_RADIUS,/, 'Çimen ayrı iç disk geometrisi kullanmalı');
assert.match(worldScene, /function getIslandTopY/, 'Ada bileşenleri ortak islandTopY hesabı kullanmalı');
assert.match(worldScene, /function getIslandRimRadiusInDirection/, 'Köprü uçları yön bazlı elips yarıçapı kullanmalı');
assert.match(worldScene, /sampleCount: 32/, 'Ada köprüleri en az 32 noktada hacim kontrolünden geçmeli');
assert.match(worldScene, /updateEndpointMotion/, 'Ada köprüsü uçları yalpalamayı takip etmeli');
assert.match(worldScene, /function createDetailedRegion/, 'Aktif bölge için açık yükleme yaşam döngüsü olmalı');
assert.match(worldScene, /function disposeDetailedRegion/, 'Aktif bölge için açık boşaltma yaşam döngüsü olmalı');
assert.match(worldScene, /animateOpen/, 'Köprü açılma animasyonu bulunmalı');
assert.match(worldScene, /openMaterial\.clone\(\)/, 'Köprü animasyonu bağımsız material clone kullanmalı');
assert.match(worldScene, /DirectionalLight\(0xffffff, 0\.5\)/, 'Kameraya bağlı dolgu ışığı bulunmalı');
assert.match(worldScene, /const closedRadius = radius \* 0\.7/, 'Kapalı köprü yarıçapı yüzde 70 olmalı');
assert.match(renderConfig, /exposure: 1\.0/, 'Tur 2 exposure değeri 1.0 olmalı');
assert.match(renderConfig, /threshold: 1\.25[\s\S]*strength: 0\.34[\s\S]*radius: 0\.22/, 'Onaylanan bloom değerleri korunmalı');
assert.match(worldScene, /createCharacter\('Zeynep'/, 'Zeynep createCharacter ile oluşturulmalı');
assert.match(worldScene, /setPose\(moving \? 'back' : 'front'\)/, 'Zeynep hareket sırasında poz değiştirmeli');
assert.match(worldScene, /new THREE\.Sprite\(ghostMaterial\)/, 'Hayaletler paylaşılan sprite materyali kullanmalı');
assert.match(worldScene, /slice\(0, 12\)/, 'Hayalet sayısı 12 ile sınırlanmalı');
assert.match(main, /const GHOST_REFRESH_MS = 180_000/, 'Hayalet yenileme aralığı 180 saniye olmalı');
assert.match(main, /modeId === 'explore' \|\| modeId === 'region'/, 'Hayalet sorgusu yalnız Gezinti/Bölge modlarında çalışmalı');
assert.match(main, /!document\.hidden[\s\S]*!puzzleOpen/, 'Hayalet sorgusu arka plan ve puzzle sırasında durmalı');
assert.match(main, /ghostNewestIds\.slice\(0, 4\)/, 'Bölge haritasında en yeni dört hayalet etiketlenmeli');
assert.match(main, /distanceToSquared\(activeCamera\.position\)[\s\S]*\.slice\(0, 3\)/, 'Gezintide kameraya en yakın üç hayalet etiketlenmeli');
assert.match(main, /const NOTE_BATCH_SIZE = 6/, 'Not ekranı altışarlı seçenek göstermeli');
assert.match(main, /showMoreNotePhrases/, 'Not ekranında başka altılı gösterme davranışı olmalı');
assert.match(gameCss, /\.note-room[\s\S]*overflow: hidden/, 'Mobil not katmanı kaydırmasız kalmalı');

assert.match(shotScript, /width: 390, height: 844/, 'QA çekimi 390×844 viewport kullanmalı');
assert.match(shotScript, /use-angle=swiftshader/, 'QA çekimi SwiftShader WebGL seçeneğini kullanmalı');
assert.match(shotScript, /01-gate-top\.png[\s\S]*11-ghost-region\.png/, 'On bir sabit QA görüntüsü üretilmeli');
assert.match(shotScript, /firebase', 'off'/, 'QA gerçek Firebase ağını kapatmalı');
for (const preset of ['puzzle-room', 'solved-bridge', 'region-2', 'nickname']) {
  assert.match(main, new RegExp(`'${preset}'`), `${preset} QA preset'i kayıtlı olmalı`);
}
for (const preset of ['world-counter', 'island-stats', 'ghost-region']) {
  assert.match(main, new RegExp(`'${preset}'`), `${preset} topluluk QA preset'i kayıtlı olmalı`);
}

assert.match(firebaseSource, /from 'firebase\/app'/, 'Firebase app modular import kullanılmalı');
assert.match(firebaseSource, /from 'firebase\/auth'/, 'Firebase auth modular import kullanılmalı');
assert.match(firebaseSource, /from 'firebase\/firestore'/, 'Firestore modular import kullanılmalı');
assert.match(firebaseSource, /signInAnonymously/, 'Anonim giriş uygulanmalı');
assert.match(firebaseSource, /onAuthStateChanged/, 'İlk Auth durumu beklenmeli');
assert.match(firebaseSource, /indexedDBLocalPersistence/, 'Auth için IndexedDB persistence denenmeli');
assert.match(firebaseSource, /browserLocalPersistence/, 'Auth için localStorage fallback bulunmalı');
assert.match(firebaseSource, /getDocFromServer/, 'İlk takma ad yazması sunucudan tekrar okunarak doğrulanmalı');
assert.match(firebaseSource, /initializeFirestore/, 'Firestore açıkça başlatılmalı');
assert.match(firebaseSource, /persistentLocalCache/, 'Firestore kalıcı yerel cache kullanmalı');
assert.doesNotMatch(main, /from '\.\/firebase\.js'/, 'Firebase ana chunkta statik import edilmemeli');
assert.match(main, /import\('\.\/firebase\.js'\)/, 'Firebase dünya kurulduktan sonra dinamik yüklenmeli');
assert.match(firebaseSource, /permission|Kayıt başarısız/, 'Yazma hataları oyun akışını durdurmadan yakalanmalı');
assert.match(playerStore, /hydratePlayerDocument/, 'Oyuncu hydration katmanı bulunmalı');
assert.match(playerStore, /serializePlayerState/, 'Oyuncu serialization katmanı bulunmalı');
assert.equal(NICKNAME_ADJECTIVES.length >= 40, true, 'En az 40 sıfat olmalı');
assert.equal(NICKNAME_ANIMALS.length >= 40, true, 'En az 40 hayvan olmalı');
assert.equal(new Set(NICKNAME_ADJECTIVES).size, NICKNAME_ADJECTIVES.length, 'Sıfatlar benzersiz olmalı');
assert.equal(new Set(NICKNAME_ANIMALS).size, NICKNAME_ANIMALS.length, 'Hayvanlar benzersiz olmalı');
assert.match(nicknameSource, /generateNickname/, 'Takma ad üreticisi bulunmalı');
assert.equal(NOTE_PHRASES.length >= 24, true, 'En az 24 kalıp not cümlesi olmalı');
assert.equal(new Set(NOTE_PHRASES.map(({ id }) => id)).size, NOTE_PHRASES.length, 'Not phrase ID’leri benzersiz olmalı');
assert.match(notePhrasesSource, /NOTE_PHRASES/, 'Not cümlesi kaynağı bulunmalı');
const schoolLanguage = /\b(soru|sınav|ders|ödev|oku|cevap)\b/i;
NOTE_PHRASES.forEach(({ text }) => assert.doesNotMatch(text, schoolLanguage, `Not cümlesi okul dili içermemeli: ${text}`));
assert.match(communitySource, /aggregateContributions/, 'Replay korumalı katkı kaydı kullanılmalı');
assert.match(communitySource, /islandStats/, 'Ada istatistik yazma/okuma katmanı bulunmalı');
assert.match(communitySource, /noteChoices/, 'Tek not seçimi receipt’i bulunmalı');
assert.match(communitySource, /where\('updatedAt', '>=', cutoff\)/, 'Hayalet sorgusu son 24 saatle sınırlanmalı');
assert.match(communitySource, /limit\(GHOST_LIMIT\)/, 'Hayalet sorgusu 12 kayıtla sınırlanmalı');

const exampleLines = envExample.trim().split('\n');
assert.equal(exampleLines.length, 6, '.env.example altı Firebase alanı içermeli');
exampleLines.forEach((line) => assert.match(line, /^VITE_FIREBASE_[A-Z_]+=$/, '.env.example gerçek değer içermemeli'));
assert.match(gitignore, /^\.env\.local$/m, '.env.local gitignore kapsamında olmalı');
assert.match(gitignore, /^\.env\.\*\.local$/m, '.env.*.local gitignore kapsamında olmalı');
const trackedEnv = execFileSync('git', ['ls-files', '--', '.env.local'], { cwd: projectRoot, encoding: 'utf8' }).trim();
assert.equal(trackedEnv, '', '.env.local Git tarafından takip edilmemeli');

const rc = JSON.parse(firebaseRc);
assert.equal(rc.projects?.default, 'siber-besli-2', '.firebaserc yalnız yeni projeyi hedeflemeli');
const firebaseConfig = JSON.parse(firebaseJson);
assert.equal(firebaseConfig.firestore?.rules, 'firestore.rules');
assert.equal(firebaseConfig.firestore?.indexes, 'firestore.indexes.json');
const indexes = JSON.parse(firestoreIndexes);
assert.ok(indexes.indexes.some((index) => index.collectionGroup === 'leaderboard'), 'Hayalet sorgusu composite index içermeli');
assert.equal('hosting' in firebaseConfig, false, 'Firebase Hosting yapılandırılmamalı');
assert.match(firestoreRules, /match \/players\/\{uid\}/, 'Kurallar players/{uid} yolunu korumalı');
assert.match(firestoreRules, /request\.auth\.uid == uid/, 'Oyuncu yalnız kendi belgesine erişebilmeli');
assert.match(firestoreRules, /validSolvedUpdate/, 'Yalnız değişen solved kaydı doğrulanmalı');
for (const rulePath of ['aggregateContributions', 'counters/global/shards', 'islandStats', 'leaderboard', 'noteChoices', 'notes']) {
  assert.ok(firestoreRules.includes(rulePath), `Kurallarda ${rulePath} koruması bulunmalı`);
}
assert.match(firestoreRules, /match \/\{document=\*\*\}/, 'Diğer koleksiyonlar kapalı olmalı');
assert.match(rulesGenerator, /Rules ifade tahmini/, 'Rules generator ifade maliyetini raporlamalı');
assert.match(rulesGenerator, /warningAt: 750/, 'Rules generator sınıra yaklaşma eşiği içermeli');
assert.match(rulesGenerator, /NOTE_PHRASES/, 'Rules generator not ID’lerini kaynak dosyadan almalı');
assert.match(viteConfig, /manifest: true/, 'Chunk doğrulaması için Vite manifest üretmeli');
assert.match(chunkVerifier, /700_000/, 'İlk chunk 700 kB sınırı otomatik doğrulanmalı');
assert.match(livePersistenceScript, /page\.reload/, 'Canlı Playwright testi sayfayı yenilemeli');
assert.match(livePersistenceScript, /Takma ad ekranı yeniden açılmamalı/, 'Canlı test tekrar takma ad sorulmadığını doğrulamalı');

let forbiddenReferences = '';
const forbiddenProjectName = ['math', 'game', 'hub'].join('');
try {
  forbiddenReferences = execFileSync('git', ['grep', '-n', forbiddenProjectName], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
} catch (error) {
  if (error.status !== 1) throw error;
}
assert.equal(forbiddenReferences.trim(), '', 'Repoda önceki Firebase projesine referans bulunmamalı');

const generatedRulesCheck = execFileSync(process.execPath, ['scripts/gen-rules.mjs', '--check'], {
  cwd: projectRoot,
  encoding: 'utf8',
});
assert.match(generatedRulesCheck, /birebir güncel/, 'Üretilen ve commit edilecek firestore.rules aynı olmalı');

console.log('Proje sözleşmesi doğrulandı');
console.log(`  Three.js: ${packageJson.dependencies.three}`);
console.log('  Progress, Firebase/topluluk kalıcılığı, güvenlik sınırları ve 11 QA kontrolü: tamam');
