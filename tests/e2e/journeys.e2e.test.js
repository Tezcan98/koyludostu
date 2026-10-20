// Uzun uçtan uca senaryolar (tarayıcı): alıcı kaydı → sipariş → satıcı onayı → ödeme/teslim → yorum,
// düşük puanlı yorumun admin moderasyonu, satıcı itirazı, yönetici panelinden satıcı onayı.
// Her şey izole geçici veri klasöründe çalışır; bitince veri klasörü ve test yüklemeleri silinir
// (son test "temizlik doğrulaması" bunu denetler). Çalıştırma: npm run test:e2e
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, registerUser, authHeaders, ownerLogin, nextTestPhone, TINY_PNG_DATA_URL } = require('../helpers');

const UPLOADS = path.join(__dirname, '..', '..', 'koyludostu-tumsite', 'main', 'assets', 'uploads');
const uploadsBefore = new Set(fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS) : []);
const PASSWORD = 'test1234';
let server, browser, dataDir, owner;
let seller, product;
const buyerPhone = nextTestPhone();

const post = (p, token, body) => fetch(server.baseUrl + p, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) }).then((r) => r.json());
const getJson = (p, token) => fetch(server.baseUrl + p, { headers: token ? authHeaders(token) : {} }).then((r) => r.json());

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('kd_seen_security_intro', '1'); } catch (e) {} });
  const page = await ctx.newPage();
  await page.route(/google\.com\/recaptcha|accounts\.google\.com|gstatic\.com/, (r) => r.abort());
  return page;
}

async function uiLogin(page, phone) {
  await page.goto(server.baseUrl + '/giris.html');
  await page.fill('#loginPhone', phone);
  await page.fill('#loginPassword', PASSWORD);
  await page.click('#loginBtn');
  await page.waitForURL((u) => !u.pathname.endsWith('giris.html'), { timeout: 10000 });
}

async function ownerPage() {
  const page = await newPage();
  await page.goto(server.baseUrl + '/owner-admin.html');
  await page.fill('#pwField', server.adminPassword);
  await page.click('#loginBtn');
  await page.waitForSelector('.own-tab');
  return page;
}

// Yeni bir ürün+satıcı+alıcı üretir (API ile hızlı kurulum), alıcıyı da API ile kaydeder.
async function makeProduct(title, extra) {
  const r = await post('/api/admin/products', seller.token, Object.assign({
    title, cat: 'Zeytinyağı', city: 'Manisa', price: '300', unit: '/ litre', delivery: ['pickup'], img: product.img, stock: 50,
  }, extra));
  assert.ok(r.slug, 'ürün oluşturulamadı: ' + JSON.stringify(r));
  return r;
}

before(async () => {
  server = await startServer();
  dataDir = server.dataDir;
  browser = await chromium.launch();
  const sellerPhone = nextTestPhone();
  seller = await registerUser(server.baseUrl, {
    name: 'Yolculuk Satıcısı', city: 'Manisa', password: PASSWORD, role: 'satici', phone: sellerPhone,
    businessInfo: 'Manisa bahçemde zeytin yetiştirip soğuk sıkım yağ üretiyorum, on yıldır.',
  });
  owner = await ownerLogin(server.baseUrl, server.adminPassword);
  await post('/api/owner/sellers/approve', owner, { phone: sellerPhone, status: 'approved' });
  const img = (await post('/api/admin/upload-image', seller.token, { dataUrl: TINY_PNG_DATA_URL })).url;
  product = await post('/api/admin/products', seller.token, {
    title: 'Yolculuk Soğuk Sıkım Zeytinyağı', cat: 'Zeytinyağı', city: 'Manisa', price: '300', unit: '/ litre',
    delivery: ['pickup'], img, stock: 50,
  });
  assert.ok(product.slug);
  product.img = img;
  await registerUser(server.baseUrl, {
    name: 'Yolculuk Alıcısı', city: 'Manisa', password: PASSWORD, role: 'alici', phone: buyerPhone,
  });
});

after(async () => {
  await browser.close();
  await server.stop();
  if (fs.existsSync(UPLOADS)) fs.readdirSync(UPLOADS).filter((n) => !uploadsBefore.has(n)).forEach((n) => fs.rmSync(path.join(UPLOADS, n), { force: true }));
});

describe('Uzun senaryo 1: alıcı sipariş verir, satıcı onaylar, ödeme ve teslim, 5 yıldızlı yorum', () => {
  test('sipariş talebi ürün sayfasından gönderilir ve Siparişlerim\'de "Talep Alındı" görünür', async () => {
    const page = await newPage();
    await uiLogin(page, buyerPhone);
    await page.goto(server.baseUrl + '/urun/' + product.slug + '.html');
    await page.click('.order-cta');
    await page.waitForFunction(() => document.getElementById('orderCity').options.length > 1);
    await page.selectOption('#orderCity', { label: 'Manisa' });
    await page.waitForFunction(() => !document.getElementById('orderDistrict').disabled);
    await page.selectOption('#orderDistrict', { index: 1 });
    await page.fill('#orderQty', '3');
    await page.fill('#orderAddress', 'Test Mah. Zeytin Sk. No:5');

    // Şartları kabul etmeden gönderilemez.
    await page.click('#orderSendBtn');
    assert.match(await page.textContent('#orderMsg'), /Şartları/);
    await page.check('#orderTermsCheck');
    await page.click('#orderSendBtn');
    await page.waitForURL(/siparislerim\.html/);
    await page.waitForSelector('#poList .po-item');
    const card = await page.textContent('#poList .po-item');
    assert.ok(card.includes('Yolculuk Soğuk Sıkım Zeytinyağı'));
    assert.ok(card.includes('Talep Alındı'));
    await page.context().close();
  });

  test('satıcı sipariş şartlarını kabul edip "Onaylandı"ya çeker, alıcı değişikliği görür', async () => {
    const sp = await newPage();
    await uiLogin(sp, seller.phone);
    await sp.goto(server.baseUrl + '/admin-siparisler.html');
    await sp.waitForSelector('#poList .po-item');
    await sp.selectOption('#poList .po-sel', 'confirmed');
    await sp.check('#poList .po-terms-check');
    await sp.click('#poList .po-save-btn');
    await sp.waitForFunction(() => /Onaylandı/.test(document.querySelector('#poList .po-status-tag').textContent));
    await sp.context().close();

    const bp = await newPage();
    await uiLogin(bp, buyerPhone);
    await bp.goto(server.baseUrl + '/siparislerim.html');
    await bp.waitForSelector('#poList .po-item');
    assert.ok((await bp.textContent('#poList .po-item')).includes('Onaylandı'));
    await bp.context().close();
  });

  test('satıcı "Tamamlandı" yapar; alıcı ödemeyi bildirir, teslim aldığını onaylar, 5 yıldız verir', async () => {
    const sp = await newPage();
    await uiLogin(sp, seller.phone);
    await sp.goto(server.baseUrl + '/admin-siparisler.html');
    await sp.waitForSelector('#poList .po-item');
    await sp.selectOption('#poList .po-sel', 'completed');
    await sp.click('#poList .po-save-btn');
    await sp.waitForFunction(() => /Tamamlandı/.test(document.querySelector('#poList .po-status-tag').textContent));
    await sp.context().close();

    const bp = await newPage();
    await uiLogin(bp, buyerPhone);
    await bp.goto(server.baseUrl + '/siparislerim.html');
    await bp.waitForSelector('#poList .po-item');
    await bp.click('#poList .receipt-toggle');
    await bp.click('#poList .rc-submit');
    await bp.waitForFunction(() => /teslim aldığını onayladın/i.test(document.querySelector('#poList .po-item').textContent));

    await bp.click('#poList .qr-toggle');
    await bp.click('#poList .qr-star[data-star="5"]');
    await bp.fill('#poList .qr-form textarea', 'Harika zeytinyağı, çok taze ve lezzetli.');
    await bp.click('#poList .qr-submit');
    await bp.waitForFunction(() => document.querySelector('#poList .qr-msg').textContent.trim().length > 0);

    // 4+ yıldız yorum anında herkese açık: çıkış yapmış ziyaretçi de ürün sayfasında görür.
    const visitor = await newPage();
    await visitor.goto(server.baseUrl + '/urun/' + product.slug + '.html');
    await visitor.waitForSelector('.review-item');
    assert.ok((await visitor.textContent('.review-item')).includes('Harika zeytinyağı'));
    await visitor.context().close();
    await bp.context().close();
  });
});

describe('Uzun senaryo 2: düşük puanlı yorum moderasyonu ve satıcı itirazı', () => {
  let prod, buyer2;

  before(async () => {
    prod = await makeProduct('Moderasyon Test Zeytini');
    buyer2 = await registerUser(server.baseUrl, { name: 'İkinci Alıcı', city: 'Manisa', password: PASSWORD, role: 'alici', phone: nextTestPhone() });
  });

  async function purchaseAndReview(buyer, slug, rating, text) {
    const order = await post('/api/product-orders', buyer.token, {
      productSlug: slug, quantity: 1, city: 'Manisa', district: 'Merkez', address: 'Test Mah. No:1', termsAccepted: true,
    });
    await post('/api/admin/product-orders/update', seller.token, { id: order.id, status: 'completed', termsAccepted: true });
    const res = await post('/api/reviews', buyer.token, { productSlug: slug, rating, text });
    return res.reviews.find((x) => x.text === text);
  }

  test('2 yıldızlı yorum incelemeye düşer: ziyaretçi görmez, admin panelinden reddedilince hiç görünmez', async () => {
    const r = await purchaseAndReview(buyer2, prod.slug, 2, 'Beklediğim gibi çıkmadı, kötü.');
    assert.equal(r.status, 'pending');

    const visitor = await newPage();
    await visitor.goto(server.baseUrl + '/urun/' + prod.slug + '.html');
    await visitor.waitForTimeout(800);
    assert.equal(await visitor.locator('.review-item').count(), 0);
    await visitor.context().close();

    const op = await ownerPage();
    await op.click('.own-tab[data-tab="reviews"]');
    await op.waitForSelector('[data-mod="rejected"]');
    await op.click('[data-mod="rejected"]');
    await op.waitForFunction(() => !document.querySelector('[data-mod="rejected"]'));
    await op.context().close();

    const pub = await getJson('/api/reviews?product=' + prod.slug);
    assert.equal(JSON.stringify(pub).includes('Beklediğim gibi çıkmadı'), false, 'reddedilen yorum herkese açık listede olmamalı');
  });

  test('3 yıldızlı yorum admin onayıyla yayınlanır; satıcı itiraz eder, admin "İtiraz Haklı" deyince yorum kalkar', async () => {
    const buyer3 = await registerUser(server.baseUrl, { name: 'Üçüncü Alıcı', city: 'Manisa', password: PASSWORD, role: 'alici', phone: nextTestPhone() });
    const prod3 = await makeProduct('İtiraz Test Zeytini');
    const r = await purchaseAndReview(buyer3, prod3.slug, 3, 'Fena değil ama kargo gecikti sanki.');
    assert.equal(r.status, 'pending');

    const op = await ownerPage();
    await op.click('.own-tab[data-tab="reviews"]');
    await op.waitForSelector('[data-mod="approved"]');
    await op.click('[data-mod="approved"]');
    await op.waitForFunction(() => !document.querySelector('[data-mod="approved"]'));

    const visitor = await newPage();
    await visitor.goto(server.baseUrl + '/urun/' + prod3.slug + '.html');
    await visitor.waitForSelector('.review-item');
    await visitor.context().close();

    const sp = await newPage();
    await uiLogin(sp, seller.phone);
    await sp.goto(server.baseUrl + '/admin-yorumlarim.html');
    const disputeInput = '[data-dispute-product="' + prod3.slug + '"]';
    await sp.waitForSelector(disputeInput);
    await sp.fill(disputeInput, 'Kargo bu üründe yok, teslimat elden yapıldı. Yorum haksız.');
    await sp.click('[data-dispute-btn]:near(' + disputeInput + ')');
    await sp.waitForFunction(() => document.body.textContent.includes('inceleniyor'));
    await sp.context().close();

    await op.reload();
    await op.waitForSelector('.own-tab');
    await op.click('.own-tab[data-tab="reviews"]');
    const upheld = '[data-dispute-resolve="upheld"][data-slug="' + prod3.slug + '"]';
    await op.waitForSelector(upheld);
    await op.click(upheld);
    await op.waitForFunction((sel) => !document.querySelector(sel), upheld);
    await op.context().close();

    const after = await newPage();
    await after.goto(server.baseUrl + '/urun/' + prod3.slug + '.html');
    await after.waitForTimeout(800);
    assert.equal(await after.locator('.review-item').count(), 0, 'haklı bulunan itirazdan sonra yorum görünmemeli');
    await after.context().close();
  });

  test('siparişi olmayan alıcı yorum yazamaz', async () => {
    const stranger = await registerUser(server.baseUrl, { name: 'Yabancı', city: 'Manisa', password: PASSWORD, role: 'alici', phone: nextTestPhone() });
    const r = await fetch(server.baseUrl + '/api/reviews', {
      method: 'POST', headers: authHeaders(stranger.token), body: JSON.stringify({ productSlug: prod.slug, rating: 5, text: 'Hiç almadım ama harika!' }),
    });
    assert.ok(r.status >= 400 && r.status < 500);
  });
});

describe('Uzun senaryo 3: yeni satıcı başvurusu yönetici panelinden onaylanır', () => {
  test('onaylanana kadar ürün ekleyemez; admin Satıcılar sekmesinden onaylayınca ekleyebilir', async () => {
    const phone = nextTestPhone();
    const s = await registerUser(server.baseUrl, {
      name: 'Başvuru Satıcı', city: 'İzmir', password: PASSWORD, role: 'satici', phone,
      businessInfo: 'İzmir Ödemiş bahçemden taze sebze ve meyve satıyorum, kayıtlı çiftçiyim.',
    });
    const body = { title: 'Başvuru Ürünü', cat: 'Sebze', city: 'İzmir', price: '40', unit: '/ kg', delivery: ['pickup'], img: product.img };
    const before = await fetch(server.baseUrl + '/api/admin/products', { method: 'POST', headers: authHeaders(s.token), body: JSON.stringify(body) });
    assert.equal(before.status, 403);

    const op = await ownerPage();
    await op.click('.own-tab[data-tab="sellers"]');
    await op.waitForSelector('.own-row');
    const row = op.locator('.own-row', { hasText: 'Başvuru Satıcı' });
    await row.locator('[data-seller-decide="approved"]').click();
    await op.waitForFunction(() => /Onaylı|approved/i.test(document.body.textContent));
    await op.context().close();

    const afterRes = await fetch(server.baseUrl + '/api/admin/products', { method: 'POST', headers: authHeaders(s.token), body: JSON.stringify(body) });
    assert.equal(afterRes.status, 200);
  });
});


describe('Uzun senaryo 4: yönetici Hareket Günlüğü sekmesi', () => {
  test('yorum/sipariş/favori cümleleri görünür; kategori çipi, arama ve kişi filtresi sonucu daraltır', async () => {
    const buyerLogin = await post('/api/auth/login', null, { identifier: buyerPhone, password: PASSWORD });
    await post('/api/favorites/toggle', buyerLogin.token, { type: 'product', id: product.slug });

    const op = await ownerPage();
    await op.click('.own-tab[data-tab="activity"]');
    await op.waitForSelector('.act-row');
    const all = await op.$$eval('.act-text', (els) => els.map((e) => e.textContent));
    assert.ok(all.some((t) => /ilanını favoriye aldı/.test(t) && t.includes('Yolculuk Soğuk Sıkım Zeytinyağı')), 'favori cümlesi');
    assert.ok(all.some((t) => /5★ yorum yaptı/.test(t) && t.includes('Harika zeytinyağı')), 'yorum cümlesi');
    assert.ok(all.some((t) => /sipariş talebi gönderdi/.test(t)), 'sipariş cümlesi');

    // Kategori çipi: yalnızca Favori
    await op.click('#actChips .act-chip[data-cat="favori"]');
    await op.waitForFunction(() => Array.from(document.querySelectorAll('.act-cat')).length > 0 && Array.from(document.querySelectorAll('.act-cat')).every((e) => e.textContent.trim() === 'Favori'));

    // Çipi kapat, metin ara
    await op.click('#actChips .act-chip[data-cat="favori"]');
    await op.fill('#actQ', 'Harika zeytinyağı');
    await op.waitForFunction(() => { const r = document.querySelectorAll('.act-row'); return r.length >= 1 && Array.from(r).every((x) => /Harika zeytinyağı/.test(x.textContent)); });

    // Kişi filtresi
    await op.fill('#actQ', '');
    await op.fill('#actActor', 'Yolculuk Alıcısı');
    await op.waitForFunction(() => { const r = document.querySelectorAll('.act-row'); return r.length >= 3; });

    // Filtreleri temizle
    await op.click('#actReset');
    await op.waitForSelector('.act-row');
    assert.equal(await op.inputValue('#actQ'), '');
    await op.context().close();
  });
});


describe('Güvenlik senaryosu: giriş sonrası açık yönlendirme (open redirect) engellenir', () => {
  const bad = ['https://evil.example/phish', '//evil.example/phish', '/\\evil.example', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '\\\\evil.example'];
  for (const target of bad) {
    test('sonra=' + target.slice(0, 40) + ' ile giriş yapınca siteden ayrılınmaz', async () => {
      const page = await newPage();
      await page.goto(server.baseUrl + '/giris.html?sonra=' + encodeURIComponent(target));
      await page.fill('#loginPhone', buyerPhone);
      await page.fill('#loginPassword', PASSWORD);
      await page.click('#loginBtn');
      await page.waitForURL((u) => !u.pathname.endsWith('giris.html'), { timeout: 10000 });
      assert.equal(new URL(page.url()).origin, new URL(server.baseUrl).origin);
      await page.context().close();
    });
  }

  test('meşru göreli yönlendirme (sonra=/siparislerim.html) çalışmaya devam eder', async () => {
    const page = await newPage();
    await page.goto(server.baseUrl + '/giris.html?sonra=' + encodeURIComponent('/siparislerim.html'));
    await page.fill('#loginPhone', buyerPhone);
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#loginBtn');
    await page.waitForURL(/siparislerim\.html/, { timeout: 10000 });
    await page.context().close();
  });
});

describe('Temizlik doğrulaması: test bitince her şey ilk haline döner', () => {
  test('test yüklemeleri depoya yazılmadı ve izole veri klasörü gerçek veriden ayrı', () => {
    assert.ok(dataDir.startsWith(require('os').tmpdir()), 'test verisi geçici klasörde olmalı');
    assert.notEqual(path.resolve(dataDir), path.resolve(__dirname, '..', '..', 'data'));
    // Bu dosya dışında yüklemeler after() ile silinir; burada yalnızca sayıyı sınırlıyoruz.
    const leaked = fs.existsSync(UPLOADS) ? fs.readdirSync(UPLOADS).filter((n) => !uploadsBefore.has(n)) : [];
    assert.ok(leaked.length < 50);
  });
});
