import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
]);

const packageJson = JSON.parse(packageText);
assert.match(packageJson.dependencies.three, /^0\.179\./, 'Three.js r179 kullanılmalı');
assert.ok(packageJson.devDependencies.playwright, 'Playwright görsel QA bağımlılığı olmalı');
assert.equal(packageJson.scripts.shot, 'node scripts/shot.mjs', 'npm run shot komutu tanımlanmalı');
assert.match(packageJson.scripts.verify, /verify-progress\.mjs/, 'Progress doğrulaması verify zincirinde olmalı');
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

assert.match(shotScript, /width: 390, height: 844/, 'QA çekimi 390×844 viewport kullanmalı');
assert.match(shotScript, /use-angle=swiftshader/, 'QA çekimi SwiftShader WebGL seçeneğini kullanmalı');
assert.match(shotScript, /01-gate-top\.png[\s\S]*07-region-2\.png/, 'Yedi sabit QA görüntüsü üretilmeli');
for (const preset of ['puzzle-room', 'solved-bridge', 'region-2']) {
  assert.match(main, new RegExp(`'${preset}'`), `${preset} QA preset'i kayıtlı olmalı`);
}

console.log('Proje sözleşmesi doğrulandı');
console.log(`  Three.js: ${packageJson.dependencies.three}`);
console.log('  Progress, puzzle overlay, dinamik bölge yaşam döngüsü ve QA kontrolleri: tamam');
