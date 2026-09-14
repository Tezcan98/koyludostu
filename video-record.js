// Köylü Dostu tanıtım videosu — izole demo sunucusuna (PORT=8093, video-seed.js ile
// dolduruldu) karşı gerçek bir kullanım akışını Playwright ile kaydeder. İki sahne
// (alıcı yolculuğu + satıcı paneli) ayrı video olarak kaydedilip ffmpeg ile
// birleştirilir (bkz. video-stitch.sh).
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = 'http://localhost:8093';
const OUT_DIR = path.join(__dirname, 'tanitim-video', 'raw');
const VW = 480, VH = 960;

const CURSOR_INIT = `
(function(){
  if (document.getElementById('__demo_cursor')) return;
  var c = document.createElement('div');
  c.id = '__demo_cursor';
  c.style.cssText = 'position:fixed;width:22px;height:22px;border-radius:50%;background:rgba(78,107,58,.85);' +
    'border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;z-index:999999;' +
    'left:' + (window.innerWidth/2) + 'px;top:' + (window.innerHeight/2) + 'px;' +
    'transform:translate(-50%,-50%);transition:left .5s cubic-bezier(.4,0,.2,1),top .5s cubic-bezier(.4,0,.2,1),transform .15s;';
  document.body.appendChild(c);
})();
`;

async function ensureCursor(page) {
  await page.evaluate(CURSOR_INIT);
}

async function moveCursor(page, x, y) {
  await page.evaluate(({ x, y }) => {
    var c = document.getElementById('__demo_cursor');
    if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
  }, { x, y });
  await page.waitForTimeout(520);
}

async function tapCursor(page) {
  await page.evaluate(() => {
    var c = document.getElementById('__demo_cursor');
    if (c) { c.style.transform = 'translate(-50%,-50%) scale(.7)'; setTimeout(function () { c.style.transform = 'translate(-50%,-50%) scale(1)'; }, 150); }
  });
  await page.waitForTimeout(180);
}

// Bir öğeye (gerçekçi bir imleç hareketiyle) gidip tıklar.
async function clickLike(page, selector, opts) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await el.boundingBox();
  if (!box) throw new Error('not found: ' + selector);
  await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
  await tapCursor(page);
  await el.click(opts);
}

async function typeLike(page, selector, text) {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box) await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
  await el.click();
  await page.waitForTimeout(150);
  await el.pressSequentially(text, { delay: 38 });
}

async function smoothScroll(page, totalY, step = 90, pause = 55) {
  let done = 0;
  const dir = totalY > 0 ? 1 : -1;
  while (Math.abs(done) < Math.abs(totalY)) {
    await page.mouse.wheel(0, dir * step);
    done += dir * step;
    await page.waitForTimeout(pause);
  }
}

async function api(pathname, opts) {
  const r = await fetch(BASE + pathname, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  return r.json();
}

async function injectSession(context, u, extra) {
  const page = await context.newPage();
  await page.goto(BASE + '/index.html');
  await page.evaluate((data) => {
    localStorage.setItem('kd_auth_token', data.token);
    localStorage.setItem('kd_auth_phone', data.phone);
    localStorage.setItem('kd_auth_userid', data.user.id);
    localStorage.setItem('kd_auth_name', data.user.name);
    localStorage.setItem('kd_auth_role', data.user.role);
    if (data.sellerStatus) localStorage.setItem('kd_auth_seller_status', data.sellerStatus);
  }, Object.assign({}, u, extra || {}));
  return page;
}

async function recordBuyerScene(browser, heroSlug, buyer) {
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: OUT_DIR, size: { width: VW, height: VH } },
  });
  const page = await injectSession(context, buyer);

  // 1) Anasayfa (ilk ziyarette çıkan güvenlik tanıtım ekranını göster + kapat —
  // güven inşa eden bir an, videoya değer katıyor)
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await ensureCursor(page);
  await page.waitForTimeout(1600);
  const securityModal = page.locator('#securityModalOk');
  if (await securityModal.count()) {
    await clickLike(page, '#securityModalOk');
    await page.waitForTimeout(500);
  }
  await smoothScroll(page, 900, 70, 45);
  await page.waitForTimeout(500);
  await smoothScroll(page, -900, 120, 25);
  await page.waitForTimeout(600);

  // 2) Filtre panelini göster
  await clickLike(page, '#filterToggle');
  await page.waitForTimeout(700);
  const verifiedChk = page.locator('#fVerifiedOnly');
  await clickLike(page, '#fVerifiedOnly');
  await page.waitForTimeout(900);
  await clickLike(page, '#fVerifiedOnly'); // geri kapat (demo amaçlı aç/kapa)
  await page.waitForTimeout(500);
  await clickLike(page, '#filterToggle');
  await page.waitForTimeout(500);

  // 3) Ürün sayfasına git
  await page.goto(BASE + '/urun/' + heroSlug + '.html', { waitUntil: 'networkidle' });
  await ensureCursor(page);
  await page.waitForTimeout(1200);
  await smoothScroll(page, 420, 60, 40);
  await page.waitForTimeout(1400);

  // 4) Satıcıya mesaj
  await clickLike(page, '.msg-cta');
  await page.waitForTimeout(600);
  await typeLike(page, '#msgTextInput', 'Merhaba, bu ürün gerçekten soğuk sıkım mı?');
  await page.waitForTimeout(400);
  await clickLike(page, '#msgSendBtn');
  await page.waitForTimeout(1400);
  await clickLike(page, '#msgCloseBtn');
  await page.waitForTimeout(500);

  // 5) Sipariş talebi
  await clickLike(page, '.order-cta');
  await page.waitForTimeout(700);
  await clickLike(page, '#orderQtyPlus');
  await page.waitForTimeout(250);
  await clickLike(page, '#orderQtyPlus');
  await page.waitForTimeout(700);
  await page.waitForFunction(() => document.querySelectorAll('#orderCity option').length > 1);
  await page.selectOption('#orderCity', { label: 'Manisa' });
  await page.waitForFunction(() => document.querySelectorAll('#orderDistrict option').length > 1);
  await page.selectOption('#orderDistrict', { index: 1 });
  await page.waitForTimeout(500);
  await typeLike(page, '#orderAddress', 'Kültür Mahallesi, Gül Sokak No:7');
  await page.waitForTimeout(400);
  await clickLike(page, '#orderTermsCheck');
  await page.waitForTimeout(700);
  await clickLike(page, '#orderSendBtn');
  await page.waitForTimeout(2000);

  // 6) Siparişlerim ekranı
  await ensureCursor(page);
  await page.waitForTimeout(1200);
  await smoothScroll(page, 200, 60, 40);
  await page.waitForTimeout(1500);

  // 7) Vitrin / Keşfet
  await page.goto(BASE + '/vitrin.html', { waitUntil: 'networkidle' });
  await ensureCursor(page);
  await page.waitForTimeout(2200);
  // otomatik ilerlemeyi göstermek için biraz bekle
  await page.waitForTimeout(3500);
  // sonra bir dokunuşla manuel ileri al
  await moveCursor(page, VW * 0.8, VH * 0.5);
  await tapCursor(page);
  await page.mouse.click(VW * 0.8, VH * 0.5);
  await page.waitForTimeout(1800);

  await context.close();
  return page.video().path();
}

async function recordSellerScene(browser, seller) {
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: OUT_DIR, size: { width: VW, height: VH } },
  });
  const page = await injectSession(context, seller, { sellerStatus: 'approved' });

  await page.goto(BASE + '/admin-panelim.html', { waitUntil: 'networkidle' });
  await ensureCursor(page);
  await page.waitForTimeout(1600);
  await smoothScroll(page, 350, 60, 45);
  await page.waitForTimeout(1600);

  await page.goto(BASE + '/admin-siparisler.html', { waitUntil: 'networkidle' });
  await ensureCursor(page);
  await page.waitForTimeout(1400);
  await smoothScroll(page, 250, 60, 45);
  await page.waitForTimeout(1800);

  await page.goto(BASE + '/admin-urunlerim.html', { waitUntil: 'networkidle' });
  await ensureCursor(page);
  await page.waitForTimeout(1400);
  await smoothScroll(page, 300, 60, 45);
  await page.waitForTimeout(1800);

  await context.close();
  return page.video().path();
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const seedRaw = fs.readFileSync('/tmp/kd_video_seed_out.json', 'utf8');
  const seed = JSON.parse(seedRaw);

  const browser = await chromium.launch();

  const buyerVideo = await recordBuyerScene(browser, seed.heroSlug, {
    token: seed.buyerToken, phone: seed.buyerPhone, user: seed.buyerUser,
  });
  console.log('buyer scene:', buyerVideo);

  const sellerVideo = await recordSellerScene(browser, {
    token: seed.sellerToken, phone: seed.sellerPhone, user: seed.sellerUser,
  });
  console.log('seller scene:', sellerVideo);

  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({ buyerVideo, sellerVideo }, null, 2));
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
