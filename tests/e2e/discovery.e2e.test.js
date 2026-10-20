// Alıcı keşif akışı (tarayıcı): Toptan Satışlar / Kuru Gıdalar şeritleri, yeni filtreler ve
// her ziyarette değişen "keşfet" sıralaması. Çalıştırma: npm run test:e2e
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, registerUser, authHeaders, ownerLogin, nextTestPhone, TINY_PNG_DATA_URL } = require('../helpers');

const UPLOADS = path.join(__dirname, '..', '..', 'koyludostu-tumsite', 'main', 'assets', 'uploads');
const uploadsBefore = new Set(fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : []);
let server, browser;
const made = {}; // anahtar -> ürün başlığı

async function api(path, token, body) {
  return fetch(server.baseUrl + path, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }).then((r) => r.json());
}

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
  const phone = nextTestPhone();
  const seller = await registerUser(server.baseUrl, {
    name: 'Keşif Satıcı', city: 'Manisa', password: 'test1234', role: 'satici', phone,
    businessInfo: 'Manisa bahçemde yetiştirdiğim ürünleri kurutup paketleyerek satıyorum.',
  });
  const owner = await ownerLogin(server.baseUrl, server.adminPassword);
  await api('/api/owner/sellers/approve', owner, { phone, status: 'approved' });
  const img = (await api('/api/admin/upload-image', seller.token, { dataUrl: TINY_PNG_DATA_URL })).url;

  const defs = [
    ['toptanZeytin',  { title: 'Toptan Zeytin Çuvalı', cat: 'Zeytin', wholesale: true }],
    ['toptanKuruz',   { title: 'Toptan Kuru Üzüm Kolisi', cat: 'Kuru Meyve', wholesale: true }],
    ['toptanSalca',   { title: 'Toptan Domates Salçası', cat: 'Salça', wholesale: true }],
    ['kuruIncir',     { title: 'Kuru İncir Paketi', cat: 'Kuru Meyve' }],
    ['kuruyemis',     { title: 'Çiğ Badem İçi', cat: 'Kuruyemiş' }],
    ['tarhana',       { title: 'Ev Yapımı Tarhana', cat: 'Tarhana' }],
    ['taze1',         { title: 'Taze Domates', cat: 'Sebze' }],
    ['taze2',         { title: 'Taze Biber', cat: 'Sebze' }],
    ['taze3',         { title: 'Taze Salatalık', cat: 'Sebze' }],
    ['taze4',         { title: 'Taze Patlıcan', cat: 'Sebze' }],
  ];
  for (const [key, d] of defs) {
    const r = await api('/api/admin/products', seller.token, Object.assign({
      city: 'Manisa', price: '100', unit: '/ kg', delivery: ['pickup'], img, stock: 20,
    }, d));
    assert.ok(r.slug, key + ' oluşturulamadı: ' + JSON.stringify(r));
    made[key] = d.title;
  }
});

after(async () => {
  if (fs.existsSync(UPLOADS)) fs.readdirSync(UPLOADS).filter((n) => !uploadsBefore.has(n)).forEach((n) => fs.rmSync(path.join(UPLOADS, n), { force: true }));
  await browser.close();
  await server.stop();
});

async function openHome() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('kd_seen_security_intro', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto(server.baseUrl + '/index.html');
  await page.waitForSelector('#productGrid .pin');
  return page;
}

const gridTitles = (page) => page.$$eval('#productGrid .pin', (els) => els.map((e) => e.dataset.title));
const rowTitles = (page, heading) => page.evaluate((h) => {
  const sec = Array.from(document.querySelectorAll('.discover-section')).find((s) => s.querySelector('.discover-title').textContent.trim() === h);
  return sec ? Array.from(sec.querySelectorAll('.pin')).map((e) => e.dataset.title) : null;
}, heading);

describe('Alıcı keşif akışı (tarayıcı)', () => {
  test('1) "Toptan Satışlar" şeridinde yalnızca toptan ürünler çıkar, pinlerde Toptan etiketi var', async () => {
    const page = await openHome();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.discover-title')).some((e) => e.textContent.trim() === 'Toptan Satışlar'));
    const titles = await rowTitles(page, 'Toptan Satışlar');
    assert.deepEqual(titles.sort(), [made.toptanZeytin, made.toptanKuruz, made.toptanSalca].sort());
    const cats = await page.$$eval('.discover-section .pin-cat', (els) => els.filter((e) => /Toptan/.test(e.textContent)).length);
    assert.ok(cats >= 3);
    await page.context().close();
  });

  test('2) "Kuru Gıdalar" şeridi kuru kategorileri ve adında "kuru" geçenleri toplar, taze ürünleri almaz', async () => {
    const page = await openHome();
    const titles = await rowTitles(page, 'Kuru Gıdalar');
    for (const k of ['kuruIncir', 'kuruyemis', 'tarhana', 'toptanKuruz']) assert.ok(titles.includes(made[k]), k + ' şeritte olmalı');
    for (const k of ['taze1', 'taze2', 'toptanZeytin']) assert.ok(!titles.includes(made[k]), k + ' şeritte olmamalı');
    await page.context().close();
  });

  test('3) Yeni Eklenenler, Toptan, Kuru ve Trend şeritleri bu sırayla görünür', async () => {
    const page = await openHome();
    const order = await page.$$eval('.discover-title', (els) => els.map((e) => e.textContent.trim()).filter((t) => /Yeni|Toptan|Kuru|Trend/.test(t)));
    assert.deepEqual(order, ['Yeni Eklenenler', 'Toptan Satışlar', 'Kuru Gıdalar', 'Bu Hafta Trend']);
    await page.context().close();
  });

  test('4) "Toptan Satış" filtresi ızgarayı yalnızca toptan ürünlere indirir, rozet sayısı 1 olur', async () => {
    const page = await openHome();
    assert.equal((await gridTitles(page)).length, 10);
    await page.click('#filterToggle');
    await page.check('#fWholesaleOnly');
    const titles = await gridTitles(page);
    assert.deepEqual(titles.sort(), [made.toptanZeytin, made.toptanKuruz, made.toptanSalca].sort());
    assert.equal((await page.textContent('#filterBadge')).trim(), '1');
    await page.context().close();
  });

  test('5) "Kuru Gıdalar" filtresi çalışır; ikisi birlikte kesişimi (toptan kuru üzüm) verir; sıfırlayınca hepsi döner', async () => {
    const page = await openHome();
    await page.click('#filterToggle');
    await page.check('#fDryOnly');
    const dry = await gridTitles(page);
    assert.equal(dry.length, 4);
    assert.ok(!dry.includes(made.taze1));

    await page.check('#fWholesaleOnly');
    assert.deepEqual(await gridTitles(page), [made.toptanKuruz]);
    assert.equal((await page.textContent('#filterBadge')).trim(), '2');

    await page.click('#fReset');
    assert.equal((await gridTitles(page)).length, 10);
    await page.context().close();
  });

  test('6) Filtre + kategori birlikte: Kuru Gıdalar işaretliyken "Tarhana" kategorisi tek ürün bırakır', async () => {
    const page = await openHome();
    await page.click('#filterToggle');
    await page.check('#fDryOnly');
    await page.check('#catChecks input[value="Tarhana"]');
    assert.deepEqual(await gridTitles(page), [made.tarhana]);
    await page.context().close();
  });

  test('7) Keşfet sıralaması: her ziyarette ızgara sırası değişir (6 ziyarette en az 2 farklı sıra)', async () => {
    const orders = new Set();
    for (let i = 0; i < 6; i++) {
      const page = await openHome();
      orders.add((await gridTitles(page)).join('|'));
      await page.context().close();
    }
    assert.ok(orders.size >= 2, 'sıra hiç değişmedi: ' + orders.size + ' farklı sıra');
  });

  test('8) Aynı ziyaret içinde filtre açıp kapatmak sırayı yeniden karıştırmaz', async () => {
    const page = await openHome();
    const before = await gridTitles(page);
    await page.click('#filterToggle');
    await page.check('#fWholesaleOnly');
    await page.uncheck('#fWholesaleOnly');
    assert.deepEqual(await gridTitles(page), before);
    await page.context().close();
  });

  test('9) Arama kutusu toptan ürünü bulur ve şerit/ızgara tutarlı kalır', async () => {
    const page = await openHome();
    await page.fill('#fSearch', 'salça');
    await page.waitForFunction(() => document.querySelectorAll('#productGrid .pin').length === 1);
    assert.deepEqual(await gridTitles(page), [made.toptanSalca]);
    await page.context().close();
  });
});
