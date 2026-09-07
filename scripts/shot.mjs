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
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning' || message.text().startsWith('[debug-hit]')) {
      browserErrors.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => browserErrors.push(`[pageerror] ${error.message}`));

  for (const [preset, filename] of presets) {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('cam', preset);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (expectedPreset) => window.__WORLD_READY__ === true
        && window.__CAMERA_PRESET_READY__ === expectedPreset
        && window.__QA_FRAME_COUNT__ >= 3,
      preset,
      { timeout: 30_000 },
    );
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loading')).opacity === '0');
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
    }
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
