import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../qa/', import.meta.url));
const preferredBaseUrl = process.env.QA_BASE_URL || getLanDevServerUrl() || 'http://127.0.0.1:5173/oyna/';
const probePoints = parseProbePoints(process.argv.find((argument) => argument.startsWith('--probe=')));
const presets = [
  ['gate-top', '01-gate-top.png'],
  ['zeynep-side', '02-zeynep-side.png'],
  ['region', '03-region-map.png'],
  ['world', '04-world-map.png'],
  ['puzzle-room', '05-puzzle-room.png'],
  ['solved-bridge', '06-solved-bridge.png'],
  ['region-2', '07-region-2.png'],
  ['nickname', '08-nickname.png'],
  ['world-counter', '09-world-counter.png'],
  ['island-stats', '10-island-stats.png'],
  ['ghost-region', '11-ghost-region.png'],
  ['mimar-idle', '12-mimar-idle.png'],
  ['mimar-transparency', '13-mimar-transparency.png'],
  ['mimar-glitch', '14-mimar-glitch.png'],
];

let serverProcess;
let browser;

try {
  const baseUrl = await resolveBaseUrl();
  await mkdir(outputDirectory, { recursive: true });
  browser = await launchChromium();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const browserErrors = [];
  const browserFailures = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning' || message.text().startsWith('[debug-hit]')) {
      browserErrors.push(`[console:${message.type()}] ${message.text()}`);
    }
    if (message.type() === 'error') browserFailures.push(`[console:error] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserErrors.push(`[pageerror] ${error.message}`);
    browserFailures.push(`[pageerror] ${error.message}`);
  });

  for (const [preset, filename] of presets) {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('cam', preset);
    url.searchParams.set('firebase', 'off');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (expectedPreset) => window.__WORLD_READY__ === true
        && window.__CAMERA_PRESET_READY__ === expectedPreset
        && window.__QA_STATE_READY__ === expectedPreset
        && window.__QA_FRAME_COUNT__ >= 3,
      preset,
      { timeout: 30_000 },
    );
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loading')).opacity === '0');
    await assertPresetState(page, preset);
    await page.getByText('Çevrimdışı', { exact: true }).waitFor({ state: 'visible' });
    await page.screenshot({
      path: `${outputDirectory}/${filename}`,
      type: 'png',
      fullPage: false,
    });
    if (preset === 'gate-top') {
      for (const point of probePoints) {
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(80);
      }
      await runPuzzlePauseSmoke(page);
      await runNoteSmoke(page);
    }
    if (preset === 'mimar-transparency') await runMimarDialogueSmoke(page);
    console.log(`qa/${filename} ← ${url.href}`);
  }

  const diagnostics = await page.evaluate(() => window.__WORLD_DIAGNOSTICS__);
  console.log(`WebGL renderer: ${diagnostics.renderer}`);
  console.log(`Ada geometri/materyal: ${JSON.stringify(diagnostics.islandGeometry)}`);
  console.log(`Köprü hacim kontrolleri: ${JSON.stringify(diagnostics.bridgeGeometryChecks)}`);
  if (browserErrors.length > 0) {
    console.log('Tarayıcı uyarıları:');
    browserErrors.forEach((message) => console.log(`  ${message}`));
  }
  if (browserFailures.length > 0) {
    throw new Error(`Tarayıcı çalışma hataları bulundu:\n${browserFailures.join('\n')}`);
  }
} finally {
  await browser?.close();
  serverProcess?.kill('SIGTERM');
}

async function resolveBaseUrl() {
  if (await isReachable(preferredBaseUrl)) return preferredBaseUrl;
  const fallbackUrl = 'http://127.0.0.1:4173/oyna/';
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  serverProcess = spawn(process.execPath, [
    viteBin,
    '--host', '127.0.0.1',
    '--port', '4173',
    '--strictPort',
  ], {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isReachable(fallbackUrl)) return fallbackUrl;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite sunucusuna ulaşılamadı: ${preferredBaseUrl} veya ${fallbackUrl}`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function launchChromium() {
  const common = {
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  };
  try {
    return await chromium.launch(common);
  } catch (error) {
    console.warn(`ANGLE/SwiftShader başlatılamadı, Chromium varsayılanına dönülüyor: ${error.message}`);
    return chromium.launch({ headless: true });
  }
}

function getLanDevServerUrl() {
  const interfaces = networkInterfaces();
  const names = ['en0', ...Object.keys(interfaces).filter((name) => name !== 'en0')];
  for (const name of names) {
    if (/^(utun|bridge|docker|vbox|awdl|llw)/i.test(name)) continue;
    const addresses = interfaces[name];
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal && !isVirtualAddress(address.address)) {
        return `http://${address.address}:5173/oyna/`;
      }
    }
  }
  return null;
}

function isVirtualAddress(address) {
  return address.startsWith('169.254.')
    || address.startsWith('100.')
    || address.startsWith('172.16.')
    || address.startsWith('198.18.');
}

function parseProbePoints(argument) {
  if (!argument) return [];
  return argument.slice('--probe='.length).split(';').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Geçersiz probe noktası: ${pair}`);
    return { x, y };
  });
}

async function assertPresetState(page, preset) {
  if (preset === 'puzzle-room') {
    await page.locator('#puzzle-room.is-open').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Çöz' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Geri' }).waitFor({ state: 'visible' });
  }
  if (preset === 'solved-bridge') {
    await page.waitForFunction(() => document.querySelector('#island-status')?.textContent.includes('Çözüldü'));
  }
  if (preset === 'region-2') {
    await page.waitForFunction(() => document.querySelector('#region-name')?.textContent === 'Khepri Yelkenleri');
  }
  if (preset === 'nickname') {
    await page.locator('#nickname-room.is-open').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Yeniden üret' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Bu olsun' }).waitFor({ state: 'visible' });
  }
  if (preset === 'world-counter') {
    await page.waitForFunction(() => document.querySelector('#global-solved-count')?.textContent === '1.247');
    await page.locator('#leaderboard-list li').nth(19).waitFor({ state: 'attached' });
  }
  if (preset === 'island-stats') {
    await page.getByText(/Bu adayı 1\.247 okur çözdü · ortalama 4 dk/).waitFor({ state: 'visible' });
    await page.locator('#island-note-list li').nth(2).waitFor({ state: 'visible' });
  }
  if (preset === 'ghost-region') {
    await page.waitForFunction(() => {
      const labels = [...document.querySelectorAll('.ghost-label')];
      return labels.length === 12
        && labels.filter((label) => getComputedStyle(label).display !== 'none').length === 4;
    });
  }
  if (preset === 'mimar-idle') {
    await page.waitForFunction(() => window.__WORLD_DIAGNOSTICS__?.mimar?.visible === true);
    await assertMimarPlacement(page);
  }
  if (preset === 'mimar-transparency') {
    await page.locator('#mimar-dialogue.is-open').waitFor({ state: 'visible' });
    await page.getByText('[PH] Sana neyi sakladığımızı açıkça anlatayım.', { exact: true })
      .waitFor({ state: 'visible' });
    if (await page.locator('#mimar-skip').isVisible()) {
      throw new Error('Şeffaflık diyaloğunda Geç butonu görünmemeli');
    }
    await assertMimarPlacement(page);
    await page.locator('#island-card.is-mimar-compact').waitFor({ state: 'visible' });
    if (await page.locator('#island-card.is-mimar-compact #card-action').isVisible()) {
      throw new Error('Mimar konuşurken ada eylem butonu görünmemeli');
    }
  }
  if (preset === 'mimar-glitch') {
    await page.waitForFunction(() => window.__WORLD_DIAGNOSTICS__?.mimar?.forcedGlitch === true);
    await assertMimarPlacement(page);
  }
}

async function assertMimarPlacement(page) {
  const metrics = await page.evaluate(() => window.__WORLD_DIAGNOSTICS__?.mimar);
  if (!metrics) throw new Error('Mimar yerleşim tanıları bulunamadı');
  const heightRatio = metrics.visibleHeight / metrics.islandRadius;
  const offsetRatio = metrics.horizontalCharacterOffset / metrics.islandRadius;
  if (Math.abs(heightRatio - 0.5) > 0.025) {
    throw new Error(`Mimar yükseklik oranı 0.50 değil: ${heightRatio}`);
  }
  if (Math.abs(metrics.centerHeight - 10) > 0.05) {
    throw new Error(`Mimar yüzey yüksekliği 10 değil: ${metrics.centerHeight}`);
  }
  if (Math.abs(offsetRatio - 0.4) > 0.01) {
    throw new Error(`Mimar/Zeynep yatay ofset oranı 0.40 değil: ${offsetRatio}`);
  }
}

async function runPuzzlePauseSmoke(page) {
  const frameCount = await page.evaluate(() => window.__QA_FRAME_COUNT__);
  await page.getByRole('button', { name: 'Gir' }).click();
  await page.waitForFunction(() => window.__RENDER_PAUSED__ === true);
  await page.getByRole('button', { name: 'Geri' }).click();
  await page.waitForFunction(
    (previousFrameCount) => window.__RENDER_PAUSED__ === false
      && document.querySelector('#puzzle-room').hidden
      && window.__QA_FRAME_COUNT__ > previousFrameCount,
    frameCount,
  );
}

async function runNoteSmoke(page) {
  await page.getByRole('button', { name: 'Gir' }).click();
  await page.waitForFunction(() => window.__RENDER_PAUSED__ === true);
  await page.getByRole('button', { name: 'Çöz' }).click();
  await page.locator('#note-room.is-open').waitFor({ state: 'visible' });
  const firstPhraseIds = await page.locator('.note-phrase').evaluateAll(
    (buttons) => buttons.map((button) => button.dataset.phraseId),
  );
  if (firstPhraseIds.length !== 6) throw new Error(`Not ekranında 6 yerine ${firstPhraseIds.length} cümle var`);
  await page.getByRole('button', { name: 'Başkalarını göster' }).click();
  const secondPhraseIds = await page.locator('.note-phrase').evaluateAll(
    (buttons) => buttons.map((button) => button.dataset.phraseId),
  );
  if (secondPhraseIds.length !== 6 || secondPhraseIds.some((id) => firstPhraseIds.includes(id))) {
    throw new Error('Başkalarını göster yeni ve benzersiz 6 cümle üretmedi');
  }
  const fitsViewport = await page.evaluate(() => {
    const room = document.querySelector('#note-room');
    const card = document.querySelector('.note-card');
    const skip = document.querySelector('#note-skip');
    const bounds = skip.getBoundingClientRect();
    return room.scrollHeight <= room.clientHeight
      && card.scrollHeight <= card.clientHeight
      && bounds.top >= 0
      && bounds.bottom <= window.innerHeight;
  });
  if (!fitsViewport) throw new Error('Not ekranı 390×844 viewport içine kaydırmasız sığmıyor');
  await page.getByRole('button', { name: 'Not bırakmadan geç' }).click();
  await page.waitForFunction(() => document.querySelector('#note-room').hidden === true);
}

async function runMimarDialogueSmoke(page) {
  const expectedLines = [
    '[PH] Takma adını, çözdüğün adaları ve çözüm sürelerini saklarız.',
    '[PH] Seçip bıraktığın kalıp notları da sayaçlar ve liderlik için kullanırız.',
    '[PH] E-posta, gerçek isim veya yaş istemeyiz.',
    '[PH] Bunların dışında hiçbir şey toplamayız.',
  ];
  const dialogue = page.locator('#mimar-dialogue');
  for (const line of expectedLines) {
    await dialogue.click();
    await dialogue.click();
    await page.getByText(line, { exact: true }).waitFor({ state: 'visible' });
  }
  await dialogue.click();
  await dialogue.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('#island-card').classList.contains('is-mimar-compact'));
}
