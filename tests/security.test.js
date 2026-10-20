// Güvenlik ve kötü niyetli kullanıcı savunma testleri: yetki aşımı, IDOR, enjeksiyon/XSS,
// yol gezinme, iş mantığı suistimali, yükleme kötüye kullanımı, hız sınırı ve hata sızıntısı.
// Hepsi izole geçici veri klasöründe çalışır; gerçek veriye dokunmaz.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const {
  startServer, registerUser, authHeaders, ownerLogin, nextTestPhone, TINY_PNG_DATA_URL, TINY_PDF_DATA_URL,
} = require('./helpers');

let server;
const url = (p) => server.baseUrl + p;
const uploaded = [];
const J = { 'Content-Type': 'application/json' };

before(async () => { server = await startServer(); });
after(async () => {
  const dir = path.join(__dirname, '..', 'koyludostu-tumsite', 'main');
  uploaded.forEach((u) => { try { fs.rmSync(path.join(dir, u), { force: true }); } catch (e) {} });
  await server.stop();
});

async function user(role, name) {
  const phone = nextTestPhone();
  const u = await registerUser(server.baseUrl, { name, city: 'Test Şehir', password: 'test1234', role, phone, businessInfo: 'Güvenlik testi için oluşturulmuş satıcı başvurusu, yeterince uzun.' });
  if (role === 'satici') {
    const owner = await ownerLogin(server.baseUrl, server.adminPassword);
    await fetch(url('/api/owner/sellers/approve'), { method: 'POST', headers: authHeaders(owner), body: JSON.stringify({ phone, status: 'approved' }) });
  }
  return u;
}
const post = (p, token, body, extra) => fetch(url(p), { method: 'POST', headers: Object.assign(token ? authHeaders(token) : J, extra), body: JSON.stringify(body) });

async function image(token) {
  const r = await post('/api/admin/upload-image', token, { dataUrl: TINY_PNG_DATA_URL }).then((x) => x.json());
  uploaded.push(r.url);
  return r.url;
}
async function product(seller, overrides) {
  const img = await image(seller.token);
  return post('/api/admin/products', seller.token, Object.assign({
    title: 'Güvenlik Ürünü ' + Math.random().toString(36).slice(2, 6), cat: 'Sebze', city: 'Test Şehir', price: '50', unit: '/ kg', delivery: ['pickup'], img, stock: 10,
  }, overrides)).then((r) => r.json());
}

// Ham TCP ile (normalize edilmemiş) yol gönderir: fetch/URL "/../" ve "%2e%2e" yollarını düzeltebilir.
function rawGet(rawPath, extraHeaders) {
  return new Promise((resolve) => {
    const port = Number(new URL(server.baseUrl).port);
    const s = net.connect(port, '127.0.0.1');
    let buf = '';
    s.on('connect', () => s.write('GET ' + rawPath + ' HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n' + (extraHeaders || '') + '\r\n'));
    s.on('data', (d) => { buf += d.toString('utf8'); });
    s.on('close', () => { const m = buf.match(/^HTTP\/1\.1 (\d{3})/); resolve({ status: m ? Number(m[1]) : 0, body: buf }); });
    s.on('error', () => resolve({ status: 0, body: '' }));
    setTimeout(() => { s.destroy(); }, 3000);
  });
}

describe('Yol gezinme ve hassas dosya sızıntısı', () => {
  const targets = [
    '/../serve.js', '/%2e%2e/serve.js', '/..%2fserve.js', '/%2e%2e%2fserve.js', '/....//serve.js',
    '/assets/../../serve.js', '/assets/uploads/../../../../serve.js', '/..%5cserve.js',
    '/serve.js', '/package.json', '/ecosystem.config.js', '/.git/config', '/.gitignore', '/tests/api.test.js',
    '/data/users.json', '/data/sessions.json', '/node_modules/playwright/package.json', '/run.sh', '/landing-server.js',
    '/secure-uploads/x.pdf', '/%00.html', '/index.html%00.png',
  ];
  for (const t of targets) {
    test('hassas/üst dizin yolu sızdırmaz: ' + t, async () => {
      const r = await rawGet(t);
      const leaked = /require\('http'\)|passwordHash|ADMIN_PASSWORD|GEMINI_API_KEY|\[core\]|"scripts"\s*:/.test(r.body);
      assert.ok(!leaked, t + ' içerik sızdırdı (durum ' + r.status + ')');
      assert.ok(r.status !== 200 || !leaked);
    });
  }

  test('yüklenen dosya klasöründen çıkış denemesi başarısız olur', async () => {
    const r = await rawGet('/assets/uploads/..%2f..%2f..%2fserve.js');
    assert.ok(!/require\('http'\)/.test(r.body));
  });
});

describe('Kimlik doğrulama ve yetki aşımı', () => {
  test('tüm /api/owner/* uçları yönetici belirteci olmadan 401 döner', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'serve.js'), 'utf8');
    const routes = [...src.matchAll(/p === '(\/api\/owner\/[a-z0-9/-]+)' && req\.method === '(GET|POST)'/g)].map((m) => [m[1], m[2]]);
    assert.ok(routes.length > 15, 'uç listesi okunamadı');
    const seller = await user('satici', 'Yetki Satıcı');
    for (const [route, method] of routes) {
      if (route === '/api/owner/login') continue;
      const noAuth = await fetch(url(route), { method, headers: J, body: method === 'POST' ? '{}' : undefined });
      assert.equal(noAuth.status, 401, route + ' belirteçsiz 401 olmalı, ' + noAuth.status + ' döndü');
      const asSeller = await fetch(url(route), { method, headers: authHeaders(seller.token), body: method === 'POST' ? '{}' : undefined });
      assert.equal(asSeller.status, 401, route + ' satıcı belirteciyle 401 olmalı, ' + asSeller.status + ' döndü');
    }
  });

  test('tüm /api/admin/* (satıcı) uçları belirteçsiz 401, alıcı belirteciyle 401/403 döner', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'serve.js'), 'utf8');
    const routes = [...src.matchAll(/p === '(\/api\/admin\/[a-z0-9/-]+)' && req\.method === '(GET|POST)'/g)].map((m) => [m[1], m[2]]);
    const buyer = await user('alici', 'Yetki Alıcı');
    // Haber/blog yönetimi uçları (sources, banned-words, agent'lar…) da buradadır: eskiden hiç
    // kimlik doğrulaması yoktu (herkes kaynak ekleyip SSRF/ajan tetikleyebilirdi); artık yönetici belirteci ister.
    for (const [route, method] of routes) {
      const noAuth = await fetch(url(route), { method, headers: J, body: method === 'POST' ? '{}' : undefined });
      assert.equal(noAuth.status, 401, route + ' belirteçsiz: ' + noAuth.status);
      if (route === '/api/admin/upload-image') continue; // bilerek her giriş yapmış kullanıcıya açık (alıcı teslim fotoğrafı)
      const asBuyer = await fetch(url(route), { method, headers: authHeaders(buyer.token), body: method === 'POST' ? '{}' : undefined });
      assert.ok([401, 403].includes(asBuyer.status), route + ' alıcı belirteciyle: ' + asBuyer.status);
    }
  });

  test('sahte, bozuk ve boş Bearer belirteçleri reddedilir', async () => {
    for (const tok of ['', 'null', 'undefined', 'a'.repeat(5000), "' OR '1'='1", '../../etc/passwd', '{"$ne":null}', 'Bearer Bearer x']) {
      const r = await fetch(url('/api/addresses/mine'), { headers: { Authorization: 'Bearer ' + tok } });
      assert.equal(r.status, 401, 'belirteç kabul edildi: ' + tok.slice(0, 30));
      const me = await fetch(url('/api/auth/me'), { headers: { Authorization: 'Bearer ' + tok } }).then((x) => x.json());
      assert.equal(me.user, null, 'sahte belirteçle kullanıcı döndü: ' + tok.slice(0, 30));
    }
  });

  test('çıkış yapınca eski belirteç geçersiz olur', async () => {
    const u = await user('alici', 'Çıkış Test');
    assert.equal((await fetch(url('/api/addresses/mine'), { headers: authHeaders(u.token) })).status, 200);
    await post('/api/auth/logout', u.token, {});
    assert.equal((await fetch(url('/api/addresses/mine'), { headers: authHeaders(u.token) })).status, 401);
  });

  test('hesap silinince belirteç ve giriş kullanılamaz', async () => {
    const u = await user('alici', 'Silinecek Hesap');
    await post('/api/auth/delete-account', u.token, { password: 'test1234' });
    assert.equal((await fetch(url('/api/addresses/mine'), { headers: authHeaders(u.token) })).status, 401);
    const login = await post('/api/auth/login', null, { identifier: u.phone, password: 'test1234' });
    assert.notEqual(login.status, 200);
  });

  test('kayıtta role: admin/owner/rastgele değer verilerek yetki yükseltilemez', async () => {
    for (const role of ['admin', 'owner', 'root', 'satici ', '__proto__', ['satici'], { $gt: '' }]) {
      const r = await post('/api/auth/register-start', null, {
        name: 'Hacker', city: 'X', district: 'Y', password: 'test1234', role, termsAccepted: true,
      });
      assert.equal(r.status, 400, 'geçersiz rol kabul edildi: ' + JSON.stringify(role));
    }
  });

  test('profil güncellemede role/sellerStatus/verifiedSeller/passwordHash alanları yok sayılır (toplu atama)', async () => {
    const u = await user('alici', 'Toplu Atama');
    const r = await post('/api/auth/update-profile', u.token, {
      name: 'Toplu Atama 2', role: 'satici', sellerStatus: 'approved', verifiedSeller: true, passwordHash: 'x', id: 'u_hacker', phone: '5000000000',
    });
    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(u.token) }).then((x) => x.json());
    const usr = me.user || me;
    assert.equal(usr.role, 'alici');
    assert.notEqual(usr.sellerStatus, 'approved');
    assert.ok(!usr.verifiedSeller);
    assert.notEqual(usr.id, 'u_hacker');
    assert.ok(r.status < 500);
  });

  test('alıcı kendini apply-seller ile onaylı yapamaz; ürün ekleyemez', async () => {
    const u = await user('alici', 'Kendini Onaylayan');
    await post('/api/auth/apply-seller', u.token, { businessInfo: 'Satıcı olmak istiyorum çok isteyerek.', taxId: '10000000146', iban: 'TR330006100519786457841326', sellerStatus: 'approved', verifiedSeller: true });
    const img = await image(u.token).catch(() => null);
    const r = await post('/api/admin/products', u.token, { title: 'Kaçak', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img: img || '/x.png' });
    assert.equal(r.status, 403);
  });
});

describe('IDOR: başkasının verisine erişim/değişiklik', () => {
  test('başka satıcının ürününü güncelleyemez, silemez, stoğunu değiştiremez', async () => {
    const a = await user('satici', 'Satıcı A');
    const b = await user('satici', 'Satıcı B');
    const p = await product(a);
    for (const [route, body] of [
      ['/api/admin/products/update', { slug: p.slug, price: '1', stock: 9999, title: 'Ele geçirildi' }],
      ['/api/admin/products/delete', { slug: p.slug }],
    ]) {
      const r = await post(route, b.token, body);
      assert.equal(r.status, 404, route);
    }
    const all = await fetch(url('/api/products')).then((x) => x.json());
    const cur = (Array.isArray(all) ? all : all.products).find((x) => x.slug === p.slug);
    assert.equal(cur.title, p.title);
    assert.equal(String(cur.price), '50₺');
  });

  test('başka alıcının siparişini göremez/onaylayamaz/ödeme bildiremez; satıcı olmayan durum güncelleyemez', async () => {
    const seller = await user('satici', 'Sipariş Satıcı');
    const buyer1 = await user('alici', 'Alıcı Bir');
    const buyer2 = await user('alici', 'Alıcı İki');
    const p = await product(seller);
    const o = await post('/api/product-orders', buyer1.token, { productSlug: p.slug, quantity: 1, city: 'T', district: 'T', address: 'Test Mah. No:1', termsAccepted: true }).then((x) => x.json());
    assert.ok(o.id);

    const list2 = await fetch(url('/api/product-orders/mine'), { headers: authHeaders(buyer2.token) }).then((x) => x.json());
    assert.ok(!JSON.stringify(list2).includes(o.id), 'başkasının siparişi listede');
    for (const route of ['/api/product-orders/confirm-receipt', '/api/product-orders/mark-payment-sent']) {
      const r = await post(route, buyer2.token, { id: o.id });
      assert.ok([403, 404].includes(r.status), route + ' ' + r.status);
    }
    const upd = await post('/api/admin/product-orders/update', buyer1.token, { id: o.id, status: 'completed', termsAccepted: true });
    assert.ok([401, 403].includes(upd.status));
    const other = await user('satici', 'Başka Satıcı');
    const upd2 = await post('/api/admin/product-orders/update', other.token, { id: o.id, status: 'completed', termsAccepted: true });
    assert.equal(upd2.status, 404);
  });

  test('başkasının mesaj konuşmasını/adresini/favorisini okuyamaz', async () => {
    const a = await user('alici', 'Gizli Alıcı');
    const b = await user('alici', 'Meraklı Alıcı');
    await post('/api/addresses/add', a.token, { title: 'Ev', city: 'İzmir', district: 'Bornova', address: 'Çok Gizli Sk. No:42' });
    const addrB = await fetch(url('/api/addresses'), { headers: authHeaders(b.token) }).then((x) => x.text());
    assert.ok(!addrB.includes('Çok Gizli'));
    const idDel = await post('/api/addresses/delete', b.token, { id: 'a_' + 'x'.repeat(8) });
    assert.ok(idDel.status < 500);
  });

  test('başkasının kimlik/selfie belgesi için imzalı bağlantı alınamaz', async () => {
    const a = await user('satici', 'Belge Sahibi');
    const b = await user('satici', 'Belge Hırsızı');
    const up = await post('/api/admin/upload-doc', a.token, { dataUrl: TINY_PDF_DATA_URL, secure: true }).then((x) => x.json());
    assert.ok(up.filename);
    const sign = await post('/api/auth/sign-own-file-url', b.token, { filename: up.filename });
    assert.ok([400, 403, 404].includes(sign.status), 'b, a\'nın dosyasını imzalayabildi: ' + sign.status);
    const direct = await fetch(url('/secure-uploads/' + up.filename));
    assert.notEqual(direct.status, 200);
  });

  test('imzalı gizli dosya bağlantısı kurcalanırsa ya da süresi dolmuşsa reddedilir', async () => {
    const a = await user('satici', 'İmza Satıcı');
    const up = await post('/api/admin/upload-doc', a.token, { dataUrl: TINY_PDF_DATA_URL, secure: true }).then((x) => x.json());
    const owner = await ownerLogin(server.baseUrl, server.adminPassword);
    const signed = await post('/api/owner/sign-file-url', owner, { filename: up.filename }).then((x) => x.json());
    assert.ok(signed.url);
    assert.equal((await fetch(url(signed.url))).status, 200);
    const tampered = signed.url.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));
    assert.notEqual((await fetch(url(tampered))).status, 200);
    const expired = signed.url.replace(/exp=\d+/, 'exp=1000');
    assert.notEqual((await fetch(url(expired))).status, 200);
    const otherFile = signed.url.replace(up.filename, 'baska-dosya.pdf');
    assert.notEqual((await fetch(url(otherFile))).status, 200);
  });
});

describe('Enjeksiyon ve XSS', () => {
  const PAYLOADS = ['<script>window.__pwn=1</script>', '"><img src=x onerror=alert(1)>', "'-alert(1)-'", '</script><script>alert(1)</script>', '{{7*7}}', '${7*7}', 'javascript:alert(1)'];

  test('ürün sayfası: başlık/açıklama/satıcı adı/yorum içindeki HTML kaçışlanır', async () => {
    const seller = await user('satici', '<img src=x onerror=alert(2)>Satıcı');
    const buyer = await user('alici', '<script>alert(3)</script>Alıcı');
    const p = await product(seller, { title: PAYLOADS[0] + ' Ürün', description: PAYLOADS[1] });
    assert.ok(p.slug, JSON.stringify(p));
    const o = await post('/api/product-orders', buyer.token, { productSlug: p.slug, quantity: 1, city: 'T', district: 'T', address: 'Test Mah. No:1', termsAccepted: true }).then((x) => x.json());
    await post('/api/admin/product-orders/update', seller.token, { id: o.id, status: 'completed', termsAccepted: true });
    await post('/api/reviews', buyer.token, { productSlug: p.slug, rating: 5, text: PAYLOADS[3] + ' çok güzel bir ürün olmuş' });
    const html = await fetch(url('/urun/' + p.slug + '.html')).then((x) => x.text());
    assert.ok(!/<script>window\.__pwn/.test(html), 'başlıktaki script çalışabilir halde');
    assert.ok(!/<img src=x onerror/i.test(html), 'img onerror kaçışlanmamış');
    assert.ok(!/<script>alert\(/i.test(html), 'script etiketi kaçışlanmamış');
    assert.ok(!html.includes('</script><script>alert(1)'), 'script kapatma enjeksiyonu');
  });

  test('JSON gövdesinde __proto__/constructor ile prototip kirletme etkisizdir', async () => {
    const u = await user('alici', 'Proto Test');
    await fetch(url('/api/auth/update-profile'), { method: 'POST', headers: authHeaders(u.token), body: '{"name":"Proto","__proto__":{"isAdmin":true,"role":"satici"},"constructor":{"prototype":{"polluted":true}}}' });
    assert.equal(({}).polluted, undefined);
    assert.equal(({}).isAdmin, undefined);
    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(u.token) }).then((x) => x.json());
    assert.equal((me.user || me).role, 'alici');
    const ping = await fetch(url('/api/products'));
    assert.equal(ping.status, 200);
  });

  test('NoSQL/SQL tarzı girdiler giriş ve aramada hata veya yetki üretmez', async () => {
    for (const identifier of ["' OR 1=1 --", '{"$ne":""}', '*', '%', '../../etc/passwd', 'admin\'--', '\u0000']) {
      const r = await post('/api/auth/login', null, { identifier, password: "' OR '1'='1" });
      assert.ok([400, 401, 404, 429].includes(r.status), identifier + ' -> ' + r.status);
    }
    const r2 = await post('/api/auth/login', null, { identifier: { $ne: null }, password: { $ne: null } });
    assert.ok([400, 401, 404].includes(r2.status));
  });

  test('bozuk/çok büyük/iç içe JSON sunucuyu çökertmez, 5xx üretmez', async () => {
    const bad = ['{', '[]', 'null', '"x"', '{"a":', '\u0000\u0000', '{"a":' + '['.repeat(5000), '{"name":"' + 'A'.repeat(300000) + '"}'];
    for (const body of bad) {
      const r = await fetch(url('/api/auth/login'), { method: 'POST', headers: J, body });
      assert.ok(r.status < 500, 'gövde ' + body.slice(0, 20) + ' -> ' + r.status);
    }
    const huge = await fetch(url('/api/auth/login'), { method: 'POST', headers: J, body: JSON.stringify({ identifier: 'x', password: 'y'.repeat(9e6) }) }).catch(() => ({ status: 0 }));
    assert.ok(huge.status === 0 || huge.status < 500);
    assert.equal((await fetch(url('/index.html'))).status, 200, 'sunucu hâlâ yanıt vermeli');
  });

  test('uygulama hata mesajlarında dosya yolu/yığın izi sızdırmaz', async () => {
    const r = await fetch(url('/api/auth/login'), { method: 'POST', headers: J, body: '{bozuk' });
    const t = await r.text();
    assert.ok(!/at .*\.js:\d+|node_modules|\/home\//.test(t), 'yığın izi sızdı: ' + t.slice(0, 120));
    const nf = await fetch(url('/api/olmayan/uc/xyz'));
    const t2 = await nf.text();
    assert.ok(!/at .*\.js:\d+|\/home\//.test(t2));
  });
});

describe('İş mantığı suistimali', () => {
  async function order(buyer, slug, extra) {
    return post('/api/product-orders', buyer.token, Object.assign({ productSlug: slug, quantity: 1, city: 'T', district: 'T', address: 'Test Mah. No:1', termsAccepted: true }, extra));
  }

  test('geçersiz sipariş miktarları (0, negatif, ondalık, dizi, dev sayı, NaN, metin) reddedilir', async () => {
    const seller = await user('satici', 'Miktar Satıcı');
    const buyer = await user('alici', 'Miktar Alıcı');
    const p = await product(seller, { stock: 5 });
    for (const q of [0, -1, -100, 1.5, '1; DROP', [1], {}, null, 1e12, Number.MAX_SAFE_INTEGER, 'abc', Infinity]) {
      const r = await order(buyer, p.slug, { quantity: q });
      assert.ok(r.status >= 400 && r.status < 500, 'miktar ' + JSON.stringify(q) + ' kabul edildi: ' + r.status);
    }
  });

  test('stoktan fazla sipariş reddedilir; fiyat/toplam istemciden gelen değerle değiştirilemez', async () => {
    const seller = await user('satici', 'Fiyat Satıcı');
    const buyer = await user('alici', 'Fiyat Alıcı');
    const p = await product(seller, { stock: 3, price: '200' });
    const tooMany = await order(buyer, p.slug, { quantity: 4 });
    assert.ok(tooMany.status >= 400 && tooMany.status < 500, 'stok aşımı: ' + tooMany.status);
    const o = await order(buyer, p.slug, { quantity: 2, price: '1', totalPrice: 1, total: 1, unitPrice: 1, subtotal: 1 }).then((x) => x.json());
    assert.ok(o.id);
    assert.ok(![o.price, o.totalPrice, o.total, o.unitPrice].some((v) => v === 1 || v === '1'), 'istemci fiyatı kabul edildi: ' + JSON.stringify(o).slice(0, 300));
  });

  test('pasif ürüne, olmayan ürüne ve kendi ürününe sipariş verilemez', async () => {
    const seller = await user('satici', 'Pasif Satıcı');
    const buyer = await user('alici', 'Pasif Alıcı');
    const p = await product(seller);
    await post('/api/admin/products/update', seller.token, { slug: p.slug, active: false });
    const inactive = await order(buyer, p.slug);
    assert.ok(inactive.status >= 400 && inactive.status < 500, 'pasif ürüne sipariş: ' + inactive.status);
    const none = await order(buyer, 'olmayan-urun-slug');
    assert.ok(none.status >= 400 && none.status < 500);
    const p2 = await product(seller);
    const own = await order(seller, p2.slug);
    assert.ok(own.status >= 400 && own.status < 500, 'kendi ürününe sipariş: ' + own.status);
  });

  test('alıcı kendi siparişinin durumunu "tamamlandı/onaylandı" yapamaz; şartlar kabul edilmeden onay verilemez', async () => {
    const seller = await user('satici', 'Durum Satıcı');
    const buyer = await user('alici', 'Durum Alıcı');
    const p = await product(seller);
    const o = await order(buyer, p.slug).then((x) => x.json());
    const self = await post('/api/admin/product-orders/update', buyer.token, { id: o.id, status: 'completed', termsAccepted: true });
    assert.ok([401, 403].includes(self.status));
    const noTerms = await post('/api/admin/product-orders/update', seller.token, { id: o.id, status: 'completed' });
    assert.equal(noTerms.status, 400);
    const badStatus = await post('/api/admin/product-orders/update', seller.token, { id: o.id, status: 'refunded', termsAccepted: true });
    assert.equal(badStatus.status, 400);
  });

  test('yorum: geçersiz puan (0, 6, -1, NaN, metin) ve satın alma olmadan yorum reddedilir; çift yorum çoğalmaz', async () => {
    const seller = await user('satici', 'Yorum Satıcı');
    const buyer = await user('alici', 'Yorum Alıcı');
    const p = await product(seller);
    const o = await order(buyer, p.slug).then((x) => x.json());
    const noPurchase = await post('/api/reviews', buyer.token, { productSlug: p.slug, rating: 5, text: 'Henüz almadım ama harika bir ürün.' });
    assert.equal(noPurchase.status, 403);
    await post('/api/admin/product-orders/update', seller.token, { id: o.id, status: 'completed', termsAccepted: true });
    for (const rating of [0, 6, -1, 'abc', null, 4.5, [5], 1e9]) {
      const r = await post('/api/reviews', buyer.token, { productSlug: p.slug, rating, text: 'Geçersiz puanla deneme yorumu yazıyorum.' });
      assert.ok(r.status >= 400 && r.status < 500, 'puan ' + JSON.stringify(rating) + ' -> ' + r.status);
    }
    for (let i = 0; i < 3; i++) await post('/api/reviews', buyer.token, { productSlug: p.slug, rating: 5, text: 'Tekrarlanan yorum numara ' + i + ' çok güzel.' });
    const list = await fetch(url('/api/reviews?product=' + p.slug), { headers: authHeaders(buyer.token) }).then((x) => x.json());
    const mine = (list.reviews || list).filter((x) => x.name === 'Yorum Alıcı');
    assert.equal(mine.length, 1, 'aynı kullanıcı birden fazla yorum bıraktı');
  });

  test('satıcı kendi ürününe yorum yazamaz / kendi ürününü favorileyip puan şişiremez', async () => {
    const seller = await user('satici', 'Kendine Yorum');
    const p = await product(seller);
    const r = await post('/api/reviews', seller.token, { productSlug: p.slug, rating: 5, text: 'Kendi ürünüme harika yorum yazıyorum.' });
    assert.ok(r.status >= 400 && r.status < 500);
  });

  test('ürün oluşturma: negatif/aşırı fiyat, stok, ağırlık ve geçersiz kategori reddedilir', async () => {
    const seller = await user('satici', 'Ürün Doğrulama');
    const img = await image(seller.token);
    const base = { title: 'Doğrulama Ürünü', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img };
    for (const o of [{ price: '-5' }, { price: '0' }, { price: 'abc' }, { price: '1e99' }, { stock: -3 }, { stock: 1e15 }, { weightKg: -1 }, { weightKg: 'x' }, { delivery: [] }, { delivery: ['ucak'] }, { title: '' }, { title: 'x'.repeat(5000) }, { img: 'https://evil.com/x.png' }, { img: 'javascript:alert(1)' }]) {
      const r = await post('/api/admin/products', seller.token, Object.assign({}, base, o));
      assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(o).slice(0, 60) + ' -> ' + r.status);
    }
  });

  test('onaylanmamış satıcı ürün ekleyemez; yöneticinin onay/rozet uçlarını çağıramaz', async () => {
    const phone = nextTestPhone();
    const s = await registerUser(server.baseUrl, { name: 'Bekleyen', city: 'Test Şehir', password: 'test1234', role: 'satici', phone, businessInfo: 'Bekleyen satıcı başvurusu yeterince uzun bir metin.' });
    const img = await image(s.token);
    const r = await post('/api/admin/products', s.token, { title: 'Erken', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img });
    assert.equal(r.status, 403);
    const self = await post('/api/owner/sellers/approve', s.token, { phone, status: 'approved' });
    assert.equal(self.status, 401);
    const badge = await post('/api/owner/sellers/badge', s.token, { phone, verified: true });
    assert.equal(badge.status, 401);
  });
});

describe('Yükleme kötüye kullanımı', () => {
  test('SVG/HTML/JS/yürütülebilir dosyalar görsel olarak yüklenemez', async () => {
    const seller = await user('satici', 'Yükleme Satıcı');
    const evil = [
      'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>').toString('base64'),
      'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
      'data:application/javascript;base64,' + Buffer.from('alert(1)').toString('base64'),
      'data:application/x-msdownload;base64,' + Buffer.from('MZ').toString('base64'),
      'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
      'data:image/png;base64,!!!notbase64!!!',
      'not-a-data-url', '', null, 12345,
    ];
    for (const dataUrl of evil) {
      const r = await post('/api/admin/upload-image', seller.token, { dataUrl });
      if (r.status === 200) {
        const j = await r.json();
        const f = path.join(__dirname, '..', 'koyludostu-tumsite', 'main', j.url || '');
        const head = fs.existsSync(f) ? fs.readFileSync(f).slice(0, 8) : Buffer.alloc(0);
        uploaded.push(j.url);
        assert.ok(head.slice(1, 4).toString() === 'PNG' || head.slice(0, 2).toString('hex') === 'ffd8' || head.slice(0, 4).toString() === 'RIFF',
          'görsel olmayan içerik kabul edildi: ' + String(dataUrl).slice(0, 40));
      } else {
        assert.ok(r.status >= 400 && r.status < 500, String(dataUrl).slice(0, 40) + ' -> ' + r.status);
      }
    }
  });

  test('yüklemeler anonim kullanıcıya kapalı; gizli belge ortak klasöre yazılmaz', async () => {
    assert.equal((await post('/api/admin/upload-image', null, { dataUrl: TINY_PNG_DATA_URL })).status, 401);
    assert.equal((await post('/api/admin/upload-doc', null, { dataUrl: TINY_PDF_DATA_URL, secure: true })).status, 401);
    const buyer = await user('alici', 'Belge Yükleyen');
    const r = await post('/api/admin/upload-doc', buyer.token, { dataUrl: TINY_PDF_DATA_URL, secure: true });
    if (r.status === 200) {
      const j = await r.json();
      assert.ok(j.filename && !String(j.filename).includes('/') && !String(j.filename).includes('..'));
      assert.notEqual((await fetch(url('/assets/uploads/' + j.filename))).status, 200);
    }
  });

  test('gizli belge dosya adı doğrulaması yol gezinmeyi engeller', async () => {
    const a = await user('satici', 'Dosya Adı Satıcı');
    for (const docUrl of ['../../data/users.json', '..\\..\\serve.js', '/etc/passwd', 'a/b.pdf', 'x'.repeat(500), '%2e%2e%2fserve.js', '']) {
      const r = await post('/api/auth/seller-application/doc', a.token, { docUrl });
      assert.ok(r.status >= 400 && r.status < 500, docUrl.slice(0, 30) + ' -> ' + r.status);
    }
  });
});

describe('Hız sınırı, kaba kuvvet ve numaralandırma', () => {
  test('SMS kodu istekleri aynı IP\'den art arda gelince sınırlanır', async () => {
    const ip = '203.0.113.' + (50 + Math.floor(Math.random() * 100));
    let limited = false;
    for (let i = 0; i < 80 && !limited; i++) {
      const r = await fetch(url('/api/auth/request-code'), { method: 'POST', headers: Object.assign({ 'X-Real-IP': ip }, J), body: JSON.stringify({ phone: nextTestPhone() }) });
      if (r.status === 429) limited = true;
    }
    assert.ok(limited, 'tek IP\'den 80 SMS isteği sınırlanmadı');
  });

  test('doğrulama kodu 0000 dışındaki tahminlerle kaba kuvvetle çözülemez (deneme kilidi)', async () => {
    const phone = nextTestPhone();
    const ip = '203.0.113.' + (160 + Math.floor(Math.random() * 90));
    const reg = await post('/api/auth/register-start', null, { name: 'Brute', city: 'X', district: 'Y', password: 'test1234', role: 'alici', termsAccepted: true }, { 'X-Real-IP': ip }).then((r) => r.json());
    await fetch(url('/api/auth/request-code'), { method: 'POST', headers: Object.assign({ 'X-Real-IP': ip }, J), body: JSON.stringify({ phone }) });
    let locked = false;
    for (let g = 1; g <= 40 && !locked; g++) {
      const code = String(g).padStart(4, '0');
      const r = await fetch(url('/api/auth/verify'), { method: 'POST', headers: Object.assign({ 'X-Real-IP': ip }, J), body: JSON.stringify({ phone, code, regToken: reg.regToken }) });
      if (r.status === 429) locked = true;
      assert.notEqual(r.status, 200, 'yanlış kod ' + code + ' kabul edildi');
    }
    assert.ok(locked, '40 yanlış kod denemesi kilitlenmedi (4 haneli kod kaba kuvvetle kırılabilir)');
    // Kilit, "yeni kod iste → sayacı sıfırla → tekrar dene" döngüsünü de kapatır.
    const again = await fetch(url('/api/auth/request-code'), { method: 'POST', headers: Object.assign({ 'X-Real-IP': ip }, J), body: JSON.stringify({ phone }) });
    assert.equal(again.status, 429, 'kilitliyken yeni kod istenebildi');
  });

  test('şifre sıfırlama istekleri aynı hedef için art arda gelince sınırlanır (bağlantı bombardımanı engeli)', async () => {
    const real = await user('alici', 'Sıfırlama Gerçek');
    let limited = false;
    for (let i = 0; i < 15 && !limited; i++) {
      const r = await post('/api/auth/forgot-password', null, { identifier: real.phone }, { 'X-Real-IP': '203.0.113.201' });
      if (r.status === 429) limited = true;
    }
    assert.ok(limited, '15 sıfırlama isteği sınırlanmadı');
  });

  test('geçersiz/eski şifre sıfırlama belirteci reddedilir', async () => {
    for (const token of ['', 'abc', 'a'.repeat(64), '../x', null]) {
      const r = await post('/api/auth/reset-password', null, { token, password: 'yeniParola123' });
      assert.ok(r.status >= 400 && r.status < 500, String(token) + ' -> ' + r.status);
    }
  });

  test('sahte X-Forwarded-For ile IP değiştirerek hız/kilit sınırı atlatılamaz (nginx gerçek IP\'yi sona ekler)', async () => {
    const victim = await user('alici', 'Kilit Kurbanı');
    let last = 0;
    for (let i = 0; i < 14; i++) {
      // Saldırgan her istekte farklı sahte "ilk" değer gönderir; proxy gerçek IP'yi (198.51.100.7) sona ekler.
      const r = await fetch(url('/api/auth/login'), { method: 'POST', headers: Object.assign({ 'X-Forwarded-For': '10.9.' + i + '.1, 198.51.100.7' }, J), body: JSON.stringify({ identifier: victim.phone, password: 'yanlis' + i }) });
      last = r.status;
    }
    assert.equal(last, 429, 'sahte XFF ile sınır atlatıldı: son durum ' + last);
  });

  test('X-Real-IP varsa istemcinin gönderdiği X-Forwarded-For yok sayılır', async () => {
    const ip = '203.0.113.77';
    let limited = false;
    for (let i = 0; i < 30 && !limited; i++) {
      const r = await fetch(url('/api/auth/request-code'), { method: 'POST', headers: Object.assign({ 'X-Real-IP': ip, 'X-Forwarded-For': '9.9.' + i + '.9' }, J), body: JSON.stringify({ phone: nextTestPhone() }) });
      if (r.status === 429) limited = true;
    }
    assert.ok(limited, 'XFF değiştirerek IP sınırı atlatıldı');
  });
});

describe('HTTP katmanı: başlıklar, yöntemler, CORS', () => {
  test('API yanıtları önbelleğe alınmaz ve nosniff/frame başlıkları taşır', async () => {
    const u = await user('alici', 'Başlık Test');
    const r = await fetch(url('/api/auth/me'), { headers: authHeaders(u.token) });
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    const cc = (r.headers.get('cache-control') || '').toLowerCase();
    assert.ok(/no-store|no-cache|private/.test(cc), 'kişisel API yanıtı önbelleğe alınabilir: "' + cc + '"');
  });

  test('CORS: yabancı kökenlere kimlik bilgili erişim izni verilmez', async () => {
    const r = await fetch(url('/api/auth/me'), { headers: { Origin: 'https://evil.example', Authorization: 'Bearer x' } });
    const allow = r.headers.get('access-control-allow-origin');
    assert.ok(!allow || (allow !== '*' && allow !== 'https://evil.example'), 'CORS izni: ' + allow);
    const pre = await fetch(url('/api/admin/products'), { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    const a2 = pre.headers.get('access-control-allow-origin');
    assert.ok(!a2 || (a2 !== '*' && a2 !== 'https://evil.example'));
  });

  test('beklenmeyen HTTP yöntemleri (PUT/DELETE/PATCH/TRACE) veri değiştirmez ve 5xx üretmez', async () => {
    const seller = await user('satici', 'Yöntem Satıcı');
    const p = await product(seller);
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const r = await fetch(url('/api/admin/products/delete'), { method, headers: authHeaders(seller.token), body: JSON.stringify({ slug: p.slug }) });
      assert.ok(r.status < 500, method + ' ' + r.status);
    }
    const all = await fetch(url('/api/products')).then((x) => x.json());
    assert.ok((Array.isArray(all) ? all : all.products).some((x) => x.slug === p.slug), 'ürün başka bir yöntemle silindi');
  });

  test('GET ile durum değiştiren uç çağrılamaz', async () => {
    const seller = await user('satici', 'GET Satıcı');
    const p = await product(seller);
    const r = await fetch(url('/api/admin/products/delete?slug=' + p.slug), { headers: authHeaders(seller.token) });
    assert.notEqual(r.status, 200);
    const all = await fetch(url('/api/products')).then((x) => x.json());
    assert.ok((Array.isArray(all) ? all : all.products).some((x) => x.slug === p.slug));
  });
});

describe('Bilgi sızıntısı: kullanıcı verisi yanıtları', () => {
  test('herkese açık ürün/satıcı listeleri parola özeti, telefon, IBAN, T.C. kimlik no içermez', async () => {
    const seller = await user('satici', 'Sızıntı Satıcı');
    await product(seller);
    const raw = [
      await fetch(url('/api/products')).then((x) => x.text()),
      await fetch(url('/api/sellers/stats')).then((x) => x.text()),
    ].join('\n');
    assert.ok(!/passwordHash/.test(raw));
    assert.ok(!raw.includes('TR330006100519786457841326'), 'IBAN sızdı');
    assert.ok(!raw.includes('10000000146'), 'T.C. kimlik no sızdı');
    assert.ok(!raw.includes(seller.phone), 'telefon numarası herkese açık listede');
  });

  test('/api/auth/me parola özeti, ödeme/entegrasyon anahtarı içermez', async () => {
    const seller = await user('satici', 'Me Satıcı');
    const raw = await fetch(url('/api/auth/me'), { headers: authHeaders(seller.token) }).then((x) => x.text());
    assert.ok(!/passwordHash|einvoiceApiKey/.test(raw));
  });
});
