// Tarayıcıda (gerçek kullanıcı gibi) satıcı yolculuğu: kayıt → onay → giriş → ürün ekle/düzenle/pasife al.
// Çalıştırma: node --test tests/e2e/   (Playwright + Chromium gerekir; sahte kamera kullanılır)
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, authHeaders, ownerLogin, nextTestPhone } = require('../helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

let server, browser, imgPath;
const sellerPhone = nextTestPhone();
const PASSWORD = 'test1234';
const PRODUCT = 'E2E Soğuk Sıkım Zeytinyağı';

async function newPage() {
  const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('kd_security_seen', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  await page.route(/google\.com\/recaptcha|accounts\.google\.com|gstatic\.com/, (r) => r.abort());
  return page;
}

async function login(page, phone) {
  await page.goto(server.baseUrl + '/giris.html');
  await page.fill('#loginPhone', phone);
  await page.fill('#loginPassword', PASSWORD);
  await page.click('#loginBtn');
  await page.waitForURL((u) => !u.pathname.endsWith('giris.html'), { timeout: 10000 });
}

before(async () => {
  server = await startServer();
  browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  imgPath = path.join(os.tmpdir(), 'kd-e2e-photo.png');
  fs.writeFileSync(imgPath, PNG);
});

after(async () => {
  await browser.close();
  await server.stop();
  fs.rmSync(imgPath, { force: true });
});

describe('Satıcı yolculuğu (tarayıcı)', () => {
  test('1) Satıcı formu doldurup selfie çekerek kayıt olur', async () => {
    const page = await newPage();
    await page.goto(server.baseUrl + '/giris.html');
    await page.click('#tabRegisterBtn');
    await page.fill('#nameInput', 'E2E Satıcı');
    await page.selectOption('#cityInput', { label: 'Manisa' });
    await page.waitForFunction(() => document.getElementById('districtInput').options.length > 1);
    await page.selectOption('#districtInput', { index: 1 });
    await page.fill('#passInput', PASSWORD);
    await page.fill('#passInput2', PASSWORD);
    await page.click('#roleRow [data-role="satici"]');
    await page.fill('#taxIdInput', '10000000146');
    await page.fill('#businessInfoInput', 'Manisa bahçemde on yıldır zeytin yetiştirip soğuk sıkım yağ üretiyorum.');
    await page.fill('#ibanInput', 'TR330006100519786457841326');

    // Selfie olmadan ilerlenemez.
    await page.check('#termsCheck');
    await page.click('#infoNextBtn');
    assert.match(await page.textContent('#infoError'), /selfie/i);

    await page.click('#selfieStartBtn');
    await page.waitForFunction(() => { const v = document.querySelector('.selfie-video'); return v && v.readyState >= 2; });
    for (let i = 1; i <= 3; i++) {
      await page.click('.selfie-capture-btn');
      await page.waitForFunction((n) => document.querySelectorAll('.selfie-thumb').length >= n, i);
    }
    await page.waitForFunction(() => /3\/3/.test(document.getElementById('selfieStatus').textContent));

    await page.click('#infoNextBtn');
    await page.fill('#phoneInput', sellerPhone);
    await page.click('#sendCodeBtn');
    const digits = page.locator('.digit');
    for (let i = 0; i < 4; i++) await digits.nth(i).fill('0');
    await page.click('#verifyBtn');
    await page.waitForURL((u) => !u.pathname.endsWith('giris.html'), { timeout: 10000 });
    await page.context().close();
  });

  test('2) Onaylanmamış satıcı ürün ekleyemez', async () => {
    const page = await newPage();
    await login(page, sellerPhone);
    const token = await page.evaluate(() => localStorage.getItem('kd_token') || JSON.stringify(Object.assign({}, localStorage)));
    const r = await page.evaluate(async (base) => {
      const t = Object.keys(localStorage).map((k) => localStorage.getItem(k)).find((v) => v && v.length > 20 && !v.startsWith('{') && !v.startsWith('['));
      const res = await fetch(base + '/api/admin/products', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: '{}' });
      return res.status;
    }, server.baseUrl);
    assert.ok([401, 403].includes(r), 'beklenen 401/403, gelen ' + r + ' ' + String(token).slice(0, 0));
    await page.context().close();
  });

  test('3) Admin onaylar, satıcı giriş yapıp ürün ekler ve listede görür', async () => {
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const ap = await fetch(server.baseUrl + '/api/owner/sellers/approve', {
      method: 'POST', headers: authHeaders(ownerToken), body: JSON.stringify({ phone: sellerPhone, status: 'approved' }),
    });
    assert.equal(ap.status, 200);

    const page = await newPage();
    await login(page, sellerPhone);
    await page.goto(server.baseUrl + '/admin-urunlerim.html');
    await page.waitForSelector('#fTitle');
    await page.fill('#fTitle', PRODUCT);
    await page.selectOption('#fCat', { label: 'Zeytinyağı' });
    await page.waitForFunction(() => document.getElementById('fCity').options.length > 1);
    await page.selectOption('#fCity', { label: 'Manisa' });
    await page.fill('#fPrice', '320');
    await page.selectOption('#fUnit', '/ litre');
    await page.fill('#fStock', '25');
    await page.fill('#fWeight', '1');
    await page.fill('#fDesc', 'Soğuk sıkım, filtrelenmemiş, kendi bahçemden.');
    await page.check('#fDeliveryKargo');
    await page.setInputFiles('#fPhoto', imgPath);
    await page.waitForSelector('#photoPreview img, #photoPreview[src], #photoPreview:not([hidden])');
    await page.click('#submitBtn');
    await page.waitForFunction((t) => document.getElementById('prodList').textContent.includes(t) || document.getElementById('formMsg').textContent.trim().length > 0, PRODUCT, { timeout: 10000 });
    const msg = (await page.textContent('#formMsg')).trim();
    const listed = (await page.textContent('#prodList')).includes(PRODUCT);
    assert.ok(listed, 'ürün listede yok; form mesajı: ' + msg);
    await page.context().close();
  });

  test('4) Eklenen ürün anasayfada ve ürün sayfasında görünür', async () => {
    const page = await newPage();
    await page.goto(server.baseUrl + '/index.html');
    await page.waitForFunction((t) => document.body.textContent.includes(t), PRODUCT, { timeout: 10000 });
    const prods = await fetch(server.baseUrl + '/api/products').then((r) => r.json());
    const list = Array.isArray(prods) ? prods : prods.products;
    const p = list.find((x) => x.title === PRODUCT);
    assert.ok(p, 'ürün API listesinde olmalı');
    const res = await page.goto(server.baseUrl + '/urun/' + p.slug + '.html');
    assert.equal(res.status(), 200);
    assert.ok((await page.textContent('body')).includes(PRODUCT));
    await page.context().close();
  });

  test('5) Yanlış parola ile giriş reddedilir', async () => {
    const page = await newPage();
    await page.goto(server.baseUrl + '/giris.html');
    await page.fill('#loginPhone', sellerPhone);
    await page.fill('#loginPassword', 'yanlis1234');
    await page.click('#loginBtn');
    await page.waitForFunction(() => document.getElementById('loginError').textContent.trim().length > 0);
    assert.ok(page.url().endsWith('giris.html'));
    await page.context().close();
  });

  test('6) Satıcı ürünü düzenleyip stoğu günceller, sonra pasife alır; ürün anasayfadan kalkar', async () => {
    const page = await newPage();
    await login(page, sellerPhone);
    await page.goto(server.baseUrl + '/admin-urunlerim.html');
    await page.waitForFunction((t) => document.getElementById('prodList').textContent.includes(t), PRODUCT);
    await page.click('#prodList button[data-edit]');
    await page.fill('#fStock', '7');
    await page.click('#submitBtn');
    await page.waitForFunction(() => document.getElementById('submitBtn').textContent.includes('Yayınla'));
    const list = await fetch(server.baseUrl + '/api/products').then((r) => r.json());
    const p = (Array.isArray(list) ? list : list.products).find((x) => x.title === PRODUCT);
    assert.equal(Number(p.stock), 7);

    await page.click('#prodList button[data-pause]');
    await page.waitForFunction(() => /Aktifleştir/.test(document.getElementById('prodList').textContent));
    const after = await fetch(server.baseUrl + '/api/products').then((r) => r.json());
    assert.ok(!(Array.isArray(after) ? after : after.products).some((x) => x.title === PRODUCT), 'pasif ürün herkese açık listede olmamalı');
    await page.context().close();
  });
});
