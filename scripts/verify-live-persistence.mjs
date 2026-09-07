import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.SB2_QA_BASE_URL || 'http://127.0.0.1:5173/oyna/';
const url = new URL(baseUrl);
url.searchParams.set('debug', '1');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const pageErrors = [];
const firebaseErrors = [];

page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  const value = message.text();
  if (message.type() === 'error' && value.includes('[firebase]')) firebaseErrors.push(value);
});

try {
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await waitForWorld(page);
  await page.locator('#nickname-room.is-open').waitFor({ state: 'visible' });

  const nickname = (await page.locator('#nickname-value').textContent()).trim();
  const before = await readIdentity(page);
  assert.notEqual(before.uid, '', 'İlk anonim UID görünmeli');
  assert.equal(before.nickname, 'onay bekliyor');
  assert.notEqual(
    await page.locator('#sync-badge').getAttribute('data-status'),
    'saved',
    'Belge oluşmadan Kaydedildi gösterilmemeli',
  );

  await page.getByRole('button', { name: 'Bu olsun' }).click();
  await page.locator('#nickname-room').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector('#sync-badge')?.dataset.status === 'saved',
    null,
    { timeout: 30_000 },
  );
  const afterConfirm = await readIdentity(page);
  assert.equal(afterConfirm.uid, before.uid, 'Onay sırasında UID değişmemeli');
  assert.equal(afterConfirm.nickname, nickname, 'Onaylanan takma ad UI state’ine geçmeli');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorld(page);
  await page.waitForTimeout(1_000);
  const afterReload = await readIdentity(page);
  assert.equal(afterReload.uid, before.uid, 'Yenilemeden sonra anonim UID korunmalı');
  assert.equal(afterReload.nickname, nickname, 'Takma ad Firestore’dan hydrate edilmeli');
  assert.equal(await page.locator('#nickname-room').isHidden(), true, 'Takma ad ekranı yeniden açılmamalı');

  await page.getByRole('button', { name: 'Gir', exact: true }).click();
  await page.locator('#puzzle-room.is-open').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector('#sync-badge')?.dataset.status === 'saved',
    null,
    { timeout: 30_000 },
  );
  const solveWriteStarted = page.waitForFunction(
    () => ['saving', 'pending'].includes(document.querySelector('#sync-badge')?.dataset.status),
    null,
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Çöz', exact: true }).click();
  await solveWriteStarted;
  await page.waitForFunction(
    () => document.querySelector('#sync-badge')?.dataset.status === 'saved',
    null,
    { timeout: 30_000 },
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForWorld(page);
  await page.waitForTimeout(1_000);
  assert.equal(await page.locator('#nickname-room').isHidden(), true, 'Çözüm yenilemesinde takma ad ekranı açılmamalı');
  assert.match(await page.locator('#island-status').textContent(), /Çözüldü/, 'Ada çözümü hydrate edilmeli');
  assert.equal(await page.getByRole('button', { name: 'Tekrar oyna', exact: true }).isVisible(), true);
  assert.equal(pageErrors.length, 0, `Page error olmamalı: ${pageErrors.join(' | ')}`);
  assert.equal(firebaseErrors.length, 0, `Firebase console error olmamalı: ${firebaseErrors.join(' | ')}`);

  console.log('Canlı kalıcılık akışı doğrulandı');
  console.log(`  UID: ${before.uid}`);
  console.log(`  Takma ad: ${nickname}`);
  console.log('  Seç → sunucu doğrulaması → yenile → puzzle çöz → yenile: tamam');
} finally {
  await browser.close();
}

async function waitForWorld(page) {
  await page.waitForFunction(() => window.__WORLD_READY__ === true, null, { timeout: 45_000 });
}

async function readIdentity(page) {
  return page.locator('#debug-identity').evaluate((element) => {
    const lines = element.textContent.split('\n');
    const valueFor = (label) => lines.find((line) => line.startsWith(`${label}: `))?.slice(label.length + 2) || '';
    return {
      mode: valueFor('Mod'),
      authPersistence: valueFor('Auth saklama'),
      uid: valueFor('UID'),
      nickname: valueFor('Takma ad'),
      status: valueFor('Durum'),
    };
  });
}
