import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [packageText, rootHtml, gameHtml, netlify, main, worldScene, renderConfig] = await Promise.all([
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../oyna/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/scene/worldScene.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/render/config.js', import.meta.url), 'utf8'),
]);

const packageJson = JSON.parse(packageText);
assert.match(packageJson.dependencies.three, /^0\.179\./, 'Three.js r179 kullanılmalı');
assert.match(rootHtml, /name="robots" content="noindex, nofollow"/, 'Root noindex meta içermeli');
assert.match(gameHtml, /name="robots" content="noindex, nofollow"/, '/oyna noindex meta içermeli');
assert.match(netlify, /X-Robots-Tag = "noindex, nofollow"/, 'Netlify noindex header içermeli');
assert.match(main, /duration: 0\.8/, 'Kamera geçişi 800 ms olmalı');
assert.match(main, /OrbitControls/, 'Gezinti modunda OrbitControls kullanılmalı');
assert.match(main, /OrthographicCamera/g, 'Harita modlarında ortografik kamera kullanılmalı');
assert.match(main, /get\('debug'\) === '1'/, 'Debug modu ?debug=1 ile açılmalı');
assert.match(worldScene, /new THREE\.InstancedMesh/g, 'Ada parçaları InstancedMesh kullanmalı');
assert.match(worldScene, /Tutorial \$\{type\} landmarks \(instanced\)/, 'Landmark türleri InstancedMesh kullanmalı');
assert.match(worldScene, /createIslandBodyGeometry/, 'Ortak kaya geometrisi kullanılmalı');
assert.match(worldScene, /geometry\.normalizeNormals\(\)/, 'Displacement sonrası normaller normalize edilmeli');
assert.match(worldScene, /DirectionalLight\(0xffffff, 0\.5\)/, 'Kameraya bağlı dolgu ışığı bulunmalı');
assert.match(worldScene, /const closedRadius = radius \* 0\.7/, 'Kapalı köprü yarıçapı yüzde 70 olmalı');
assert.match(renderConfig, /exposure: 1\.0/, 'Tur 2 exposure değeri 1.0 olmalı');
assert.match(renderConfig, /threshold: 1\.25[\s\S]*strength: 0\.34[\s\S]*radius: 0\.22/, 'Onaylanan bloom değerleri korunmalı');
assert.match(worldScene, /new THREE\.CatmullRomCurve3/g, 'Köprüler CatmullRomCurve3 kullanmalı');
assert.match(worldScene, /createCharacter\('Zeynep'/, 'Zeynep createCharacter ile oluşturulmalı');
assert.match(worldScene, /UnrealBloomPass|toneMapped: false/, 'Emissive elemanlar bloom hattına uygun olmalı');

console.log('Proje sözleşmesi doğrulandı');
console.log(`  Three.js: ${packageJson.dependencies.three}`);
console.log('  Route/meta, kamera, debug, instancing, köprü ve karakter kontrolleri: tamam');
