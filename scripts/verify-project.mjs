import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [packageText, rootHtml, gameHtml, netlify, main, worldScene, renderConfig, shotScript] = await Promise.all([
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../oyna/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/scene/worldScene.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/render/config.js', import.meta.url), 'utf8'),
  readFile(new URL('./shot.mjs', import.meta.url), 'utf8'),
]);

const packageJson = JSON.parse(packageText);
assert.match(packageJson.dependencies.three, /^0\.179\./, 'Three.js r179 kullanılmalı');
assert.ok(packageJson.devDependencies.playwright, 'Playwright görsel QA bağımlılığı olmalı');
assert.equal(packageJson.scripts.shot, 'node scripts/shot.mjs', 'npm run shot komutu tanımlanmalı');
assert.match(rootHtml, /name="robots" content="noindex, nofollow"/, 'Root noindex meta içermeli');
assert.match(gameHtml, /name="robots" content="noindex, nofollow"/, '/oyna noindex meta içermeli');
assert.match(netlify, /X-Robots-Tag = "noindex, nofollow"/, 'Netlify noindex header içermeli');
assert.match(main, /duration: 0\.8/, 'Kamera geçişi 800 ms olmalı');
assert.match(main, /OrbitControls/, 'Gezinti modunda OrbitControls kullanılmalı');
assert.match(main, /OrthographicCamera/g, 'Harita modlarında ortografik kamera kullanılmalı');
assert.match(main, /get\('debug'\) === '1'/, 'Debug modu ?debug=1 ile açılmalı');
assert.match(main, /searchParams\.get\('cam'\)/, 'Sabit QA kamera preset parametresi bulunmalı');
assert.match(main, /\[debug-hit\]/, 'Debug tıklaması mesh adını konsola yazmalı');
assert.match(worldScene, /new THREE\.InstancedMesh/g, 'Ada parçaları InstancedMesh kullanmalı');
assert.match(worldScene, /Tutorial \$\{type\} landmarks \(instanced\)/, 'Landmark türleri InstancedMesh kullanmalı');
assert.match(worldScene, /createIslandBodyGeometry/, 'Ortak kaya geometrisi kullanılmalı');
assert.match(worldScene, /geometry\.normalizeNormals\(\)/, 'Displacement sonrası normaller normalize edilmeli');
assert.match(worldScene, /new THREE\.RingGeometry\(STONE_BAND_INNER_RADIUS, 1,/, 'Taş üst yüzeyi dolu disk değil halka geometrisi olmalı');
assert.match(worldScene, /new THREE\.CircleGeometry\(GRASS_DISC_RADIUS,/, 'Çimen ayrı iç disk geometrisi kullanmalı');
assert.match(worldScene, /const grassTopMaterial = new THREE\.MeshStandardMaterial\(\{[\s\S]*?color: palette\.grass,/, 'Çimen ana materyali doğrudan bölge yeşilini kullanmalı');
assert.match(worldScene, /function getIslandTopY/, 'Ada bileşenleri ortak islandTopY hesabı kullanmalı');
assert.match(worldScene, /function getIslandRimRadiusInDirection/, 'Köprü uçları yön bazlı elips yarıçapı kullanmalı');
assert.match(worldScene, /const BRIDGE_CONTROL_OFFSET = 4/, 'Ada köprüsü dış kontrol noktaları 4 birim olmalı');
assert.match(worldScene, /sampleCount: 32/, 'Ada köprüleri en az 32 noktada hacim kontrolünden geçmeli');
assert.match(worldScene, /updateEndpointMotion/, 'Ada köprüsü uçları yalpalamayı takip etmeli');
assert.match(worldScene, /regionBridgeVisuals\.forEach\(\(visual\) => visual\.setOpacity\(worldBlend\)\)/, 'Bölge köprüleri yalnızca Dünya Haritasında görünmeli');
assert.match(worldScene, /DirectionalLight\(0xffffff, 0\.5\)/, 'Kameraya bağlı dolgu ışığı bulunmalı');
assert.match(worldScene, /const closedRadius = radius \* 0\.7/, 'Kapalı köprü yarıçapı yüzde 70 olmalı');
assert.match(renderConfig, /exposure: 1\.0/, 'Tur 2 exposure değeri 1.0 olmalı');
assert.match(renderConfig, /threshold: 1\.25[\s\S]*strength: 0\.34[\s\S]*radius: 0\.22/, 'Onaylanan bloom değerleri korunmalı');
assert.match(worldScene, /new THREE\.CatmullRomCurve3/g, 'Köprüler CatmullRomCurve3 kullanmalı');
assert.match(worldScene, /createCharacter\('Zeynep'/, 'Zeynep createCharacter ile oluşturulmalı');
assert.match(worldScene, /UnrealBloomPass|toneMapped: false/, 'Emissive elemanlar bloom hattına uygun olmalı');
assert.match(shotScript, /width: 390, height: 844/, 'QA çekimi 390×844 viewport kullanmalı');
assert.match(shotScript, /use-angle=swiftshader/, 'QA çekimi SwiftShader WebGL seçeneğini kullanmalı');
assert.match(shotScript, /01-gate-top\.png[\s\S]*04-world-map\.png/, 'Dört sabit QA görüntüsü üretilmeli');

console.log('Proje sözleşmesi doğrulandı');
console.log(`  Three.js: ${packageJson.dependencies.three}`);
console.log('  Route/meta, kamera, debug, instancing, köprü ve karakter kontrolleri: tamam');
