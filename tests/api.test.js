// Köylü Dostu API testleri — node --test ile çalışır, ek bağımlılık gerekmez (Node 22).
// Her dosya kendi serve.js sürecini izole bir KD_DATA_DIR ile başlatır; gerçek
// data/*.json dosyalarına ASLA dokunulmaz (bkz. tests/helpers.js).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  startServer, registerUser, authHeaders, ownerLogin, nextTestPhone,
  TINY_PNG_DATA_URL, TINY_PDF_DATA_URL,
} = require('./helpers');

let server;
let uploadedFiles = []; // her yüklenen dosyayı testler bitince sileceğiz

before(async () => { server = await startServer(); });
after(async () => {
  for (const rel of uploadedFiles) {
    const abs = path.join(__dirname, '..', 'koyludostu-tumsite', 'main', rel);
    fs.rmSync(abs, { force: true });
  }
  await server.stop();
});

function url(p) { return server.baseUrl + p; }

async function uploadImage(token) {
  const r = await fetch(url('/api/admin/upload-image'), {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
  }).then((r) => r.json());
  uploadedFiles.push(r.url);
  return r.url;
}

// Kimlik/vergi levhası/organik belgesi gibi hassas belgeler artık statik sunucunun
// dışında (secure-uploads) saklanıyor, bu yüzden secure:true ile yükleyip bir
// dosya adı (filename) döndürüyoruz — public bir URL değil.
async function uploadDoc(token) {
  const r = await fetch(url('/api/admin/upload-doc'), {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ dataUrl: TINY_PDF_DATA_URL, secure: true }),
  }).then((r) => r.json());
  return r.filename;
}

async function newSeller(name) {
  const phone = nextTestPhone();
  const seller = await registerUser(server.baseUrl, {
    name, city: 'Test Şehir', password: 'test1234', role: 'satici', phone,
    businessInfo: 'Test amaçlı otomatik oluşturulmuş satıcı başvurusu, en az on karakter.',
  });
  // Testler satıcının ürün ekleyebildiğini varsayar; başvuru onayını burada otomatik geçiyoruz.
  const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
  await fetch(server.baseUrl + '/api/owner/sellers/approve', {
    method: 'POST', headers: authHeaders(ownerToken),
    body: JSON.stringify({ phone, status: 'approved' }),
  });
  return seller;
}
async function newBuyer(name) {
  const phone = nextTestPhone();
  return registerUser(server.baseUrl, { name, city: 'Test Şehir', password: 'test1234', role: 'alici', phone });
}

// registerUser yardımcısı sellerType göndermiyor (her zaman bireysel varsayılan) — fatura
// taslağı testleri şirket/vergi mükellefi bir satıcı gerektirdiğinden ayrı bir yardımcı.
async function newCompanySeller(name) {
  const phone = nextTestPhone();
  const base = {
    name, city: 'Test Şehir', district: 'Test İlçe', password: 'test1234',
    role: 'satici', termsAccepted: true, sellerType: 'sirket',
    businessInfo: 'Şirket olarak sebze meyve üretip satıyoruz, otomatik test kaydı.',
    taxId: '1234567890', iban: 'TR330006100519786457841326',
    idDocDataUrl: TINY_PNG_DATA_URL, idDocConsent: true,
  };
  const reg = await fetch(url('/api/auth/register-start'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base),
  }).then((r) => r.json());
  await fetch(url('/api/auth/request-code'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }),
  });
  const ver = await fetch(url('/api/auth/verify'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code: '0000', regToken: reg.regToken }),
  }).then((r) => r.json());
  const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
  await fetch(url('/api/owner/sellers/approve'), {
    method: 'POST', headers: authHeaders(ownerToken),
    body: JSON.stringify({ phone, status: 'approved' }),
  });
  return { token: ver.token, phone, user: ver.user };
}

async function createProduct(token, overrides) {
  const img = await uploadImage(token);
  const body = Object.assign({
    title: 'Test Ürünü ' + Math.random().toString(36).slice(2, 7),
    cat: 'Sebze', city: 'Test Şehir', price: '50', unit: '/ kg',
    delivery: ['pickup'], img,
  }, overrides);
  return fetch(url('/api/admin/products'), {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify(body),
  }).then((r) => r.json());
}

// Yorum bırakabilmek artık o üründen tamamlanmış bir siparişi olmayı gerektiriyor
// (bkz. /api/reviews doğrulaması) — testlerde yorum atmadan önce bunu kurmak için.
async function completePurchase(buyerToken, sellerToken, productSlug) {
  const order = await fetch(url('/api/product-orders'), {
    method: 'POST', headers: authHeaders(buyerToken),
    body: JSON.stringify({
      productSlug, quantity: 1, city: 'Test Şehir', district: 'Test İlçe', termsAccepted: true,
    }),
  }).then((r) => r.json());
  await fetch(url('/api/admin/product-orders/update'), {
    method: 'POST', headers: authHeaders(sellerToken),
    body: JSON.stringify({ id: order.id, status: 'completed', termsAccepted: true }),
  });
  return order;
}

describe('Ürün: temel CRUD, stok, pasife alma', () => {
  test('fotoğrafsız ürün oluşturma reddedilir', async () => {
    const seller = await newSeller('Seller Foto');
    const r = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ title: 'X', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'] }),
    });
    assert.equal(r.status, 400);
  });

  test('geçerli ürün oluşturulur, varsayılan alanlar doğru', async () => {
    const seller = await newSeller('Seller Create');
    const p = await createProduct(seller.token, { stock: 15 });
    assert.equal(p.active, true);
    assert.equal(p.stock, 15);
    assert.deepEqual(p.attrs, {});
    assert.equal(p.organic, false);
    assert.equal(p.organicApproved, false);
  });

  test('negatif stok reddedilir', async () => {
    const seller = await newSeller('Seller Stock');
    const img = await uploadImage(seller.token);
    const r = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ title: 'X', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img, stock: -5 }),
    });
    assert.equal(r.status, 400);
  });

  test('başka satıcı ürünü güncelleyemez/silemez', async () => {
    const seller = await newSeller('Seller Owner');
    const other = await newSeller('Seller Intruder');
    const p = await createProduct(seller.token);
    const upd = await fetch(url('/api/admin/products/update'), {
      method: 'POST', headers: authHeaders(other.token), body: JSON.stringify({ slug: p.slug, price: '999' }),
    });
    assert.equal(upd.status, 404);
    const del = await fetch(url('/api/admin/products/delete'), {
      method: 'POST', headers: authHeaders(other.token), body: JSON.stringify({ slug: p.slug }),
    });
    assert.equal(del.status, 404);
  });

  test('pasife alınan ürün genel listeden düşer, ürün sayfasında satışta değil rozeti çıkar', async () => {
    const seller = await newSeller('Seller Pause');
    const p = await createProduct(seller.token);

    let list = await fetch(url('/api/products')).then((r) => r.json());
    assert.ok(list.products.some((x) => x.slug === p.slug));

    await fetch(url('/api/admin/products/update'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ slug: p.slug, active: false }),
    });

    list = await fetch(url('/api/products')).then((r) => r.json());
    assert.ok(!list.products.some((x) => x.slug === p.slug));

    const html = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.match(html, /Şu an satışta değil/);
    assert.doesNotMatch(html, /msg-cta/);
  });
});

describe('Kategoriye özel ürün özellikleri (attrs)', () => {
  test('şemadaki geçerli değerler saklanır', async () => {
    const seller = await newSeller('Seller Attrs Ok');
    const p = await createProduct(seller.token, {
      cat: 'Zeytinyağı', attrs: { sikim: 'Soğuk Sıkım', filtre: 'Filtresiz' },
    });
    assert.deepEqual(p.attrs, { sikim: 'Soğuk Sıkım', filtre: 'Filtresiz' });
  });

  test('şema dışı / geçersiz değerler sessizce elenir', async () => {
    const seller = await newSeller('Seller Attrs Bad');
    const p = await createProduct(seller.token, {
      cat: 'Zeytinyağı', attrs: { sikim: 'Uzay Sıkımı', renk: 'Kırmızı' },
    });
    assert.deepEqual(p.attrs, {});
  });

  test('şeması olmayan kategori için attrs her zaman boş', async () => {
    const seller = await newSeller('Seller Attrs None');
    const p = await createProduct(seller.token, { cat: 'Bal', attrs: { sikim: 'Soğuk Sıkım' } });
    assert.deepEqual(p.attrs, {});
  });
});

describe('Organik iddiası ve sertifika', () => {
  test('belgesiz organik işaretleme reddedilir', async () => {
    const seller = await newSeller('Seller Organic Fail');
    const img = await uploadImage(seller.token);
    const r = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ title: 'X', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img, organic: true }),
    });
    assert.equal(r.status, 400);
  });

  test('belgeli organik ürün oluşturulur, onay admin bekler', async () => {
    const seller = await newSeller('Seller Organic Ok');
    const doc = await uploadDoc(seller.token);
    const p = await createProduct(seller.token, { organic: true, organicDocUrl: doc });
    assert.equal(p.organic, true);
    assert.equal(p.organicApproved, false);
    assert.equal(p.organicDocUrl, doc);

    const html = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.match(html, /Organik \(Onay Bekliyor\)/);
  });

  test('admin organik onayı verir, ürün sayfasında onaylı rozet çıkar', async () => {
    const seller = await newSeller('Seller Organic Approve');
    const doc = await uploadDoc(seller.token);
    const p = await createProduct(seller.token, { organic: true, organicDocUrl: doc });
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);

    const approve = await fetch(url('/api/owner/products/approve-organic'), {
      method: 'POST', headers: authHeaders(ownerToken), body: JSON.stringify({ slug: p.slug, approved: true }),
    }).then((r) => r.json());
    assert.equal(approve.organicApproved, true);

    const html = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.match(html, /organic-badge verified/);
  });

  test('belge güncellenince onay sıfırlanır', async () => {
    const seller = await newSeller('Seller Organic Reset');
    const doc1 = await uploadDoc(seller.token);
    const p = await createProduct(seller.token, { organic: true, organicDocUrl: doc1 });
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    await fetch(url('/api/owner/products/approve-organic'), {
      method: 'POST', headers: authHeaders(ownerToken), body: JSON.stringify({ slug: p.slug, approved: true }),
    });

    const doc2 = await uploadDoc(seller.token);
    const updated = await fetch(url('/api/admin/products/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ slug: p.slug, organic: true, organicDocUrl: doc2 }),
    }).then((r) => r.json());
    assert.equal(updated.organicApproved, false);
    assert.equal(updated.organicDocUrl, doc2);
  });

  test('owner endpoint yetkisiz erişime kapalı', async () => {
    const r = await fetch(url('/api/owner/products/approve-organic'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'yok', approved: true }),
    });
    assert.equal(r.status, 401);
  });
});

describe('Yorum onay akışı', () => {
  test('4-5 yıldız doğrudan yayınlanır ve herkese görünür', async () => {
    const seller = await newSeller('Seller Rev High');
    const buyer = await newBuyer('Buyer Rev High');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);

    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Harika ürün' }),
    }).then((r) => r.json());
    assert.equal(posted.reviews[0].status, 'approved');

    const publicList = await fetch(url('/api/reviews?product=' + p.slug)).then((r) => r.json());
    assert.equal(publicList.reviews.length, 1);
  });

  test('1-3 yıldız onay bekler, sadece yazan görür, istatistiğe girmez', async () => {
    const seller = await newSeller('Seller Rev Low');
    const buyer = await newBuyer('Buyer Rev Low');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);

    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 2, text: 'İdare eder' }),
    }).then((r) => r.json());
    assert.equal(posted.reviews[0].status, 'pending');

    const anon = await fetch(url('/api/reviews?product=' + p.slug)).then((r) => r.json());
    assert.equal(anon.reviews.length, 0);

    const asAuthor = await fetch(url('/api/reviews?product=' + p.slug), {
      headers: authHeaders(buyer.token),
    }).then((r) => r.json());
    assert.equal(asAuthor.reviews.length, 1);

    const stats = await fetch(url('/api/reviews/stats')).then((r) => r.json());
    assert.equal(stats[p.slug], undefined);
  });

  test('admin bekleyen yorumu görür, onaylar; onaylı yoruma satıcı yanıt verebilir', async () => {
    const seller = await newSeller('Seller Rev Mod');
    const buyer = await newBuyer('Buyer Rev Mod');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);

    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 1, text: 'Kötüydü' }),
    }).then((r) => r.json());
    const reviewId = posted.reviews[0].id;

    const queue = await fetch(url('/api/owner/reviews'), { headers: authHeaders(ownerToken) }).then((r) => r.json());
    assert.ok(queue.reviews.some((r) => r.id === reviewId && r.status === 'pending'));

    const replyBeforeApproval = await fetch(url('/api/admin/reviews/reply'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Yanıt' }),
    });
    assert.equal(replyBeforeApproval.status, 400);

    await fetch(url('/api/owner/reviews/moderate'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ productSlug: p.slug, reviewId, status: 'approved' }),
    });

    const reply = await fetch(url('/api/admin/reviews/reply'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Geri dönüşün için teşekkürler' }),
    }).then((r) => r.json());
    assert.equal(reply.sellerReply.text, 'Geri dönüşün için teşekkürler');

    const publicList = await fetch(url('/api/reviews?product=' + p.slug)).then((r) => r.json());
    assert.equal(publicList.reviews[0].sellerReply.text, 'Geri dönüşün için teşekkürler');
  });

  test('ürünün sahibi olmayan satıcı yorum yanıtlayamaz', async () => {
    const seller = await newSeller('Seller Rev Owner');
    const intruder = await newSeller('Seller Rev Intruder');
    const buyer = await newBuyer('Buyer Rev Owner');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);
    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Süper' }),
    }).then((r) => r.json());

    const r = await fetch(url('/api/admin/reviews/reply'), {
      method: 'POST', headers: authHeaders(intruder.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId: posted.reviews[0].id, text: 'Ele geçirme girişimi' }),
    });
    assert.equal(r.status, 404);
  });
});

describe('Kargo Takip', () => {
  test('satıcı kendi ürünü için kargo talebi oluşturur', async () => {
    const seller = await newSeller('Seller Ship');
    const p = await createProduct(seller.token);
    const sh = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, buyerName: 'Alıcı Adı', buyerPhone: nextTestPhone(), address: 'Test Mah. No:1' }),
    }).then((r) => r.json());
    assert.equal(sh.status, 'requested');
    assert.equal(sh.productSlug, p.slug);
  });

  test('başkasının ürünü için kargo talebi oluşturulamaz', async () => {
    const seller = await newSeller('Seller Ship Owner');
    const intruder = await newSeller('Seller Ship Intruder');
    const p = await createProduct(seller.token);
    const r = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(intruder.token),
      body: JSON.stringify({ productSlug: p.slug, buyerName: 'X', buyerPhone: nextTestPhone(), address: 'Adres' }),
    });
    assert.equal(r.status, 404);
  });

  test('zorunlu alan eksikse reddedilir', async () => {
    const seller = await newSeller('Seller Ship Fields');
    const p = await createProduct(seller.token);
    const r = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, buyerName: '', buyerPhone: nextTestPhone(), address: 'Adres' }),
    });
    assert.equal(r.status, 400);
  });

  test('admin durumu ve takip numarasını günceller, satıcı görür', async () => {
    const seller = await newSeller('Seller Ship Update');
    const p = await createProduct(seller.token);
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const sh = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, buyerName: 'Alıcı', buyerPhone: nextTestPhone(), address: 'Adres' }),
    }).then((r) => r.json());

    const badStatus = await fetch(url('/api/owner/shipments/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ id: sh.id, status: 'ucti-gitti' }),
    });
    assert.equal(badStatus.status, 400);

    const updated = await fetch(url('/api/owner/shipments/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ id: sh.id, status: 'shipped', trackingNo: 'TRK-1' }),
    }).then((r) => r.json());
    assert.equal(updated.status, 'shipped');
    assert.equal(updated.trackingNo, 'TRK-1');

    const mine = await fetch(url('/api/admin/shipments/mine'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.equal(mine.shipments[0].status, 'shipped');
  });

  test('toplam ağırlık = birim ağırlık × miktar, bozulabilirlik talepte donduruluyor', async () => {
    const seller = await newSeller('Seller Ship Weight');
    const p = await createProduct(seller.token, { weightKg: 2, perishable: true });
    const sh = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, quantity: 3, buyerName: 'Alıcı', buyerPhone: nextTestPhone(), address: 'Adres' }),
    }).then((r) => r.json());
    assert.equal(sh.quantity, 3);
    assert.equal(sh.totalWeightKg, 6);
    assert.equal(sh.perishable, true);
  });

  test('miktar belirtilmezse varsayılan 1 kabul edilir', async () => {
    const seller = await newSeller('Seller Ship DefaultQty');
    const p = await createProduct(seller.token, { weightKg: 1.5 });
    const sh = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, buyerName: 'Alıcı', buyerPhone: nextTestPhone(), address: 'Adres' }),
    }).then((r) => r.json());
    assert.equal(sh.quantity, 1);
    assert.equal(sh.totalWeightKg, 1.5);
  });
});

describe('Ürün ağırlığı ve bozulabilirlik', () => {
  test('geçersiz birim ağırlık reddedilir', async () => {
    const seller = await newSeller('Seller Weight Invalid');
    const img = await uploadImage(seller.token);
    const r = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ title: 'X', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img, weightKg: -1 }),
    });
    assert.equal(r.status, 400);
  });

  test('perishable ve weightKg doğru saklanır ve ürün sayfasında uyarı çıkar', async () => {
    const seller = await newSeller('Seller Weight Ok');
    const p = await createProduct(seller.token, { weightKg: 0.75, perishable: true });
    assert.equal(p.weightKg, 0.75);
    assert.equal(p.perishable, true);
    const html = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.match(html, /Çabuk bozulur/);
    assert.match(html, /0\.75 kg/);
  });
});

describe('Ambalaj (satıcılara ambalaj satışı)', () => {
  test('katalog sadece admin tarafından oluşturulabilir', async () => {
    const r = await fetch(url('/api/owner/packaging'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kutu', unit: '/ adet', price: 10 }),
    });
    assert.equal(r.status, 401);
  });

  test('admin ürün ekler, satıcı sadece aktif ürünleri görür', async () => {
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const seller = await newSeller('Seller Packaging Browse');

    const item = await fetch(url('/api/owner/packaging'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ name: 'Test Kutusu', unit: '/ adet', price: 15, description: 'Test açıklama' }),
    }).then((r) => r.json());
    assert.equal(item.name, 'Test Kutusu');

    const passive = await fetch(url('/api/owner/packaging'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ name: 'Pasif Kutu', unit: '/ adet', price: 20 }),
    }).then((r) => r.json());
    await fetch(url('/api/owner/packaging/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ id: passive.id, active: false }),
    });

    const catalog = await fetch(url('/api/packaging'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.ok(catalog.items.some((x) => x.id === item.id));
    assert.ok(!catalog.items.some((x) => x.id === passive.id));
  });

  test('satıcı talep oluşturur, admin görür ve durumunu günceller, satıcıya bildirim gider', async () => {
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const seller = await newSeller('Seller Packaging Order');
    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: 'Seller Packaging Order', city: 'Test Şehir', email: 'pkseller@test.local' }),
    });
    await fetch(url('/api/auth/notify-prefs'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ sms: true, email: true }),
    });

    const item = await fetch(url('/api/owner/packaging'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ name: 'Sipariş Kutusu', unit: '/ adet', price: 12 }),
    }).then((r) => r.json());

    const order = await fetch(url('/api/admin/packaging/order'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ itemId: item.id, quantity: 5, note: 'Acele' }),
    }).then((r) => r.json());
    assert.equal(order.quantity, 5);
    assert.equal(order.status, 'requested');

    const mine = await fetch(url('/api/admin/packaging/orders/mine'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.ok(mine.orders.some((o) => o.id === order.id));

    const allOrders = await fetch(url('/api/owner/packaging/orders'), { headers: authHeaders(ownerToken) }).then((r) => r.json());
    assert.ok(allOrders.orders.some((o) => o.id === order.id));

    const updated = await fetch(url('/api/owner/packaging/orders/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ id: order.id, status: 'confirmed' }),
    }).then((r) => r.json());
    assert.equal(updated.status, 'confirmed');

    const notifPath = path.join(server.dataDir, 'notifications.json');
    const log = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    assert.ok(Object.values(log).some((n) => n.phone === seller.phone && n.event === 'packaging_order_update'));
  });

  test('pasif veya var olmayan ambalaj için talep reddedilir', async () => {
    const seller = await newSeller('Seller Packaging Bad Order');
    const r = await fetch(url('/api/admin/packaging/order'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ itemId: 'pk_yok', quantity: 1 }),
    });
    assert.equal(r.status, 404);
  });
});

describe('Bildirim tercihleri (SMS/E-posta)', () => {
  test('tercih kapalıyken bildirim gitmez', async () => {
    const seller = await newSeller('Seller Notify Off');
    const buyer = await newBuyer('Buyer Notify Off');
    const p = await createProduct(seller.token);

    await fetch(url('/api/messages/send'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, productTitle: p.title, text: 'Merhaba' }),
    });

    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    // notifyUser tercih yokken hiçbir şey yazmaz; dolaylı olarak notify-prefs
    // ayarlanmamış bir kullanıcının outbox'ta hiç kaydı olmadığını doğruluyoruz.
    const overview = await fetch(url('/api/owner/overview'), { headers: authHeaders(ownerToken) }).then((r) => r.json());
    assert.ok(overview.products.some((x) => x.slug === p.slug));
  });

  test('SMS+e-posta açıkken yeni mesaj ve yorum bildirim üretir', async () => {
    const seller = await newSeller('Seller Notify On');
    const buyer = await newBuyer('Buyer Notify On');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);

    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: 'Seller Notify On', city: 'Test Şehir', email: 'seller@test.local' }),
    });
    await fetch(url('/api/auth/notify-prefs'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ sms: true, email: true }),
    });

    await fetch(url('/api/messages/send'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, productTitle: p.title, text: 'Stok var mı?' }),
    });
    await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Çok iyi' }),
    });

    const notifPath = path.join(server.dataDir, 'notifications.json');
    const log = JSON.parse(fs.readFileSync(notifPath, 'utf8'));
    const entries = Object.values(log).filter((n) => n.phone === seller.phone);
    assert.equal(entries.filter((n) => n.channel === 'sms').length, 2);
    assert.equal(entries.filter((n) => n.channel === 'email').length, 2);
    assert.ok(entries.every((n) => n.channel !== 'email' || n.target === 'seller@test.local'));
  });
});

describe('Yetki kontrolleri', () => {
  test('alıcı rolü satıcıya özel uçları kullanamaz', async () => {
    const buyer = await newBuyer('Buyer Guard');
    const r = await fetch(url('/api/admin/products/mine'), { headers: authHeaders(buyer.token) });
    assert.equal(r.status, 403);
  });

  test('owner uçları geçersiz şifreyle açılmaz', async () => {
    const r = await fetch(url('/api/owner/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'yanlis-sifre' }),
    });
    assert.equal(r.status, 401);
  });
});

describe('Satıcı başvurusu ve onay süreci', () => {
  test('işletme açıklaması olmadan satıcı kaydı reddedilir', async () => {
    const r = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test İsim', city: 'Test Şehir', district: 'Test İlçe', password: 'test1234', role: 'satici', termsAccepted: true }),
    });
    assert.equal(r.status, 400);
  });

  test('ilçe olmadan kayıt reddedilir', async () => {
    const r = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test İsim', city: 'Test Şehir', password: 'test1234', role: 'alici', termsAccepted: true }),
    });
    assert.equal(r.status, 400);
  });

  test('zayıf parolayla kayıt reddedilir (en az 8 karakter, harf+rakam şart)', async () => {
    const base = { name: 'Test İsim', city: 'Test Şehir', district: 'Test İlçe', role: 'alici', termsAccepted: true };
    const tooShort = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, password: 'ab12345' }),
    });
    assert.equal(tooShort.status, 400);

    const onlyLetters = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, password: 'abcdefgh' }),
    });
    assert.equal(onlyLetters.status, 400);

    const onlyDigits = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, password: '12345678' }),
    });
    assert.equal(onlyDigits.status, 400);

    const ok = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, password: 'abcd1234' }),
    });
    assert.equal(ok.status, 200);
  });

  test('satıcı kaydında T.C. Kimlik/Vergi No zorunlu ve formatı doğrulanır', async () => {
    const phone = nextTestPhone();
    const base = {
      name: 'TaxId Test', city: 'Test Şehir', district: 'Test İlçe', password: 'test1234',
      role: 'satici', termsAccepted: true,
      businessInfo: 'Bahçemden zeytin ve zeytinyağı üretip satıyorum, on yıldır bu işteyim.',
    };
    const missing = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base),
    });
    assert.equal(missing.status, 400);

    const tooShort = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, taxId: '123' }),
    });
    assert.equal(tooShort.status, 400);

    const reg = await registerUser(server.baseUrl, {
      name: base.name, city: base.city, district: base.district, password: base.password,
      role: 'satici', phone, businessInfo: base.businessInfo, taxId: '12345678901',
    });
    assert.equal(reg.user.sellerStatus, 'pending');
    assert.equal(reg.user.taxId, '12345678901');
  });

  test('onaylanmamış satıcı ürün ekleyemez, onaylanınca ekleyebilir', async () => {
    const phone = nextTestPhone();
    const reg = await registerUser(server.baseUrl, {
      name: 'Pending Seller', city: 'Test Şehir', password: 'test1234', role: 'satici', phone,
      businessInfo: 'Bahçemden zeytin ve zeytinyağı üretip satıyorum, on yıldır bu işteyim.',
    });
    assert.equal(reg.user.sellerStatus, 'pending');

    const img = await uploadImage(reg.token);
    const blocked = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(reg.token),
      body: JSON.stringify({ title: 'X', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img }),
    });
    assert.equal(blocked.status, 403);

    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const approved = await fetch(url('/api/owner/sellers/approve'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone, status: 'approved' }),
    }).then((r) => r.json());
    assert.equal(approved.user.sellerStatus, 'approved');

    const created = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(reg.token),
      body: JSON.stringify({ title: 'Onaylı Ürün', cat: 'Sebze', city: 'Test Şehir', price: '10', unit: '/ kg', delivery: ['pickup'], img }),
    });
    assert.equal(created.status, 200);
  });

  test('reddedilen satıcı ürün ekleyemeye devam eder engelli kalır', async () => {
    const phone = nextTestPhone();
    const reg = await registerUser(server.baseUrl, {
      name: 'Rejected Seller', city: 'Test Şehir', password: 'test1234', role: 'satici', phone,
      businessInfo: 'Kısa süreliğine sebze satmak istiyorum, deneme amaçlı başvuru metni.',
    });
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    await fetch(url('/api/owner/sellers/approve'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone, status: 'rejected' }),
    });
    const img = await uploadImage(reg.token);
    const r = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(reg.token),
      body: JSON.stringify({ title: 'X', cat: 'Sebze', city: 'X', price: '10', unit: '/ kg', delivery: ['pickup'], img }),
    });
    assert.equal(r.status, 403);
  });

  test('başvuru belgesi yüklenip admin panelinde görünür', async () => {
    const phone = nextTestPhone();
    const reg = await registerUser(server.baseUrl, {
      name: 'Doc Seller', city: 'Test Şehir', password: 'test1234', role: 'satici', phone,
      businessInfo: 'Kendi tarlamda üretilen ürünleri satmak için başvuruyorum, uzun açıklama.',
    });
    const doc = await uploadDoc(reg.token);
    const updated = await fetch(url('/api/auth/seller-application/doc'), {
      method: 'POST', headers: authHeaders(reg.token),
      body: JSON.stringify({ docUrl: doc }),
    }).then((r) => r.json());
    assert.equal(updated.user.sellerDocUrl, doc);

    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const sellers = await fetch(url('/api/owner/sellers'), { headers: authHeaders(ownerToken) }).then((r) => r.json());
    const found = sellers.sellers.find((s) => s.phone === phone);
    assert.equal(found.sellerDocUrl, doc);
    assert.equal(found.sellerStatus, 'pending');
  });
});

describe('Çoklu ürün fotoğrafı', () => {
  test('ek fotoğraflar saklanır ve ürün sayfasında galeri çıkar', async () => {
    const seller = await newSeller('Seller Gallery');
    const extra1 = await uploadImage(seller.token);
    const extra2 = await uploadImage(seller.token);
    const p = await createProduct(seller.token, { images: [extra1, extra2] });
    assert.deepEqual(p.images, [extra1, extra2]);

    const html = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.match(html, /product-thumbs/);
  });

  test('geçersiz ek fotoğraf URL\'leri sessizce elenir', async () => {
    const seller = await newSeller('Seller Gallery Bad');
    const extra1 = await uploadImage(seller.token);
    const p = await createProduct(seller.token, { images: [extra1, 'javascript:alert(1)', '/etc/passwd'] });
    assert.deepEqual(p.images, [extra1]);
  });

  test('en fazla 5 ek fotoğraf kabul edilir', async () => {
    const seller = await newSeller('Seller Gallery Max');
    const urls = [];
    for (let i = 0; i < 7; i++) urls.push(await uploadImage(seller.token));
    const p = await createProduct(seller.token, { images: urls });
    assert.equal(p.images.length, 5);
  });

  test('tek fotoğraflı ürün sayfasında galeri şeridi çıkmaz', async () => {
    const seller = await newSeller('Seller Gallery None');
    const p = await createProduct(seller.token);
    const html = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.doesNotMatch(html, /product-thumbs/);
  });
});

describe('Yapay zeka ile fotoğraf düzenleme (yakında)', () => {
  test('onaylı satıcı kendi ürünü için "yakında" yanıtı alır', async () => {
    const seller = await newSeller('Seller AI Enhance');
    const p = await createProduct(seller.token);
    const r = await fetch(url('/api/admin/products/ai-enhance-photos'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ slug: p.slug }),
    }).then((r) => r.json());
    assert.equal(r.available, false);
    assert.match(r.message, /yakında/i);
  });

  test('başkasının ürünü için çağrılamaz', async () => {
    const seller = await newSeller('Seller AI Owner');
    const intruder = await newSeller('Seller AI Intruder');
    const p = await createProduct(seller.token);
    const r = await fetch(url('/api/admin/products/ai-enhance-photos'), {
      method: 'POST', headers: authHeaders(intruder.token),
      body: JSON.stringify({ slug: p.slug }),
    });
    assert.equal(r.status, 404);
  });

  test('onaylanmamış satıcı çağıramaz', async () => {
    const phone = nextTestPhone();
    const reg = await registerUser(server.baseUrl, {
      name: 'Pending AI Seller', city: 'Test Şehir', password: 'test1234', role: 'satici', phone,
      businessInfo: 'Yeni başvuru, henüz onay bekliyor, deneme metni burada uzuyor.',
    });
    const r = await fetch(url('/api/admin/products/ai-enhance-photos'), {
      method: 'POST', headers: authHeaders(reg.token),
      body: JSON.stringify({ slug: 'yok-boyle-bir-urun' }),
    });
    assert.equal(r.status, 403);
  });
});

describe('Kullanıcı senaryosu: yeni satıcının uçtan uca yolculuğu', () => {
  test('başvuru → onay → ürün → mesaj → yorum → kargo, hepsi zincirlenir', async () => {
    const sellerPhone = nextTestPhone();
    const buyerPhone = nextTestPhone();

    // 1) Satıcı başvurur, henüz onaylı değil.
    const seller = await registerUser(server.baseUrl, {
      name: 'Yolculuk Satıcı', city: 'Manisa', password: 'test1234', role: 'satici', phone: sellerPhone,
      businessInfo: 'Manisada 8 yıldır kendi bahçemde zeytin ve zeytinyağı üretiyorum.',
    });
    assert.equal(seller.user.sellerStatus, 'pending');

    // 2) Onaylanmadan ürün ekleyemez.
    const img = await uploadImage(seller.token);
    const blocked = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ title: 'Erken Ürün Denemesi', cat: 'Zeytinyağı', city: 'Manisa', price: '300', unit: '/ litre', delivery: ['kargo'], img }),
    });
    assert.equal(blocked.status, 403);

    // 3) Destekleyici belge yükler.
    const doc = await uploadDoc(seller.token);
    await fetch(url('/api/auth/seller-application/doc'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ docUrl: doc }),
    });

    // 4) Admin, bekleyen başvuruyu belgesiyle birlikte görüp onaylar.
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const sellerList = await fetch(url('/api/owner/sellers'), { headers: authHeaders(ownerToken) }).then((r) => r.json());
    const found = sellerList.sellers.find((s) => s.phone === sellerPhone);
    assert.equal(found.sellerDocUrl, doc);
    assert.equal(found.sellerStatus, 'pending');
    await fetch(url('/api/owner/sellers/approve'), {
      method: 'POST', headers: authHeaders(ownerToken), body: JSON.stringify({ phone: sellerPhone, status: 'approved' }),
    });

    // 5) Satıcı artık organik iddialı, ağırlığı belli bir ürün açabiliyor.
    const organicDoc = await uploadDoc(seller.token);
    const product = await fetch(url('/api/admin/products'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({
        title: 'Yolculuk Zeytinyağı', cat: 'Zeytinyağı', city: 'Manisa', price: '300', unit: '/ litre',
        delivery: ['kargo'], img, weightKg: 1, organic: true, organicDocUrl: organicDoc,
        attrs: { sikim: 'Soğuk Sıkım', filtre: 'Filtresiz' },
      }),
    }).then((r) => r.json());
    assert.equal(product.organicApproved, false);

    // 6) Ürün herkese açık listede görünüyor (arama/filtre buradan besleniyor).
    const publicList = await fetch(url('/api/products')).then((r) => r.json());
    assert.ok(publicList.products.some((x) => x.slug === product.slug));

    // 7) Alıcı ürünü sorup mesaj gönderiyor, satıcı yanıtlıyor.
    const buyer = await newBuyer('Yolculuk Alıcı');
    await fetch(url('/api/messages/send'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, productTitle: product.title, text: 'Kargoyla ne zaman gönderirsiniz?' }),
    });
    const convId = sellerPhone; // sadece okunabilirlik için, asıl kimlik conversationId
    const convos = await fetch(url('/api/admin/messages'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    const convo = convos.conversations[0];
    assert.equal(convo.productSlug, product.slug);
    await fetch(url('/api/admin/messages/reply'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ conversationId: convo.id, text: 'Yarın kargoya veriyorum.' }),
    });
    const thread = await fetch(url('/api/messages/thread?productSlug=' + product.slug), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.equal(thread.messages[thread.messages.length - 1].from, 'seller');

    // 8) Alıcı 5 yıldız veriyor, satıcı yanıtlıyor (yorum için önce tamamlanmış bir sipariş gerekir).
    await completePurchase(buyer.token, seller.token, product.slug);
    const review = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, rating: 5, text: 'Harika, tam zamanında geldi.' }),
    }).then((r) => r.json());
    assert.equal(review.reviews[0].status, 'approved');
    await fetch(url('/api/admin/reviews/reply'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: product.slug, reviewId: review.reviews[0].id, text: 'Teşekkürler!' }),
    });

    // 9) Satıcı, anlaştığı satış için kargo talebi açıyor.
    const shipment = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 2, buyerName: buyer.user.name, buyerPhone: buyerPhone, address: 'Yolculuk Mah. No:1' }),
    }).then((r) => r.json());
    assert.equal(shipment.totalWeightKg, 2);

    // 10) Admin organik iddiayı onaylıyor, kargo durumunu güncelliyor.
    await fetch(url('/api/owner/products/approve-organic'), {
      method: 'POST', headers: authHeaders(ownerToken), body: JSON.stringify({ slug: product.slug, approved: true }),
    });
    const updatedShipment = await fetch(url('/api/owner/shipments/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ id: shipment.id, status: 'shipped', trackingNo: 'YOL-1' }),
    }).then((r) => r.json());
    assert.equal(updatedShipment.status, 'shipped');

    // 11) Son durum: ürün sayfasında organik onaylı rozet ve tüm parçalar tutarlı.
    const finalProduct = await fetch(url('/api/products')).then((r) => r.json())
      .then((d) => d.products.find((x) => x.slug === product.slug));
    assert.equal(finalProduct.organicApproved, true);
    const html = await fetch(url('/urun/' + product.slug + '.html')).then((r) => r.text());
    assert.match(html, /organic-badge verified/);
    // Yorum ve satıcı yanıtı sayfada değil, reviews.js'in çektiği API'de yaşar.
    const finalReviews = await fetch(url('/api/reviews?product=' + product.slug)).then((r) => r.json());
    assert.equal(finalReviews.reviews[0].sellerReply.text, 'Teşekkürler!');
  });
});

describe('Kullanıcı senaryosu: alıcı düşük puan verir, admin reddeder', () => {
  test('reddedilen yorum onaylandıktan sonra bile herkese görünmez', async () => {
    const seller = await newSeller('Seller Reject Flow');
    const buyer = await newBuyer('Buyer Reject Flow');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);

    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 1, text: 'Çok kötüydü, tavsiye etmiyorum.' }),
    }).then((r) => r.json());
    const reviewId = posted.reviews[0].id;

    await fetch(url('/api/owner/reviews/moderate'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ productSlug: p.slug, reviewId, status: 'rejected' }),
    });

    const publicList = await fetch(url('/api/reviews?product=' + p.slug)).then((r) => r.json());
    assert.equal(publicList.reviews.length, 0);

    const stats = await fetch(url('/api/reviews/stats')).then((r) => r.json());
    assert.equal(stats[p.slug], undefined);

    // Reddedilen yoruma satıcı yanıt veremez (sadece onaylıya izin var).
    const replyAttempt = await fetch(url('/api/admin/reviews/reply'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Yanıt' }),
    });
    assert.equal(replyAttempt.status, 400);
  });
});

describe('Kullanıcı senaryosu: stok tükenmesi ile pasife almanın farkı', () => {
  test('stok sıfırlanınca ürün listede kalır, pasife alınca kalkar', async () => {
    const seller = await newSeller('Seller Stock Vs Pause');
    const p = await createProduct(seller.token, { stock: 3 });

    await fetch(url('/api/admin/products/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ slug: p.slug, stock: 0 }),
    });
    let list = await fetch(url('/api/products')).then((r) => r.json());
    assert.ok(list.products.some((x) => x.slug === p.slug), 'stok tükenince ürün hâlâ listede olmalı');
    const soldOutHtml = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.match(soldOutHtml, /Stok tükendi/);
    assert.match(soldOutHtml, /msg-cta/); // hâlâ mesaj atılabiliyor, sadece stok bilgisi değişti

    await fetch(url('/api/admin/products/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ slug: p.slug, active: false }),
    });
    list = await fetch(url('/api/products')).then((r) => r.json());
    assert.ok(!list.products.some((x) => x.slug === p.slug), 'pasife alınca ürün listeden kalkmalı');
  });
});

describe('Kullanıcı senaryosu: kargo ve ambalaj talebi birlikte', () => {
  test('çabuk bozulan bir satış için hem kargo hem soğuk zincir ambalajı talep edilir', async () => {
    const seller = await newSeller('Seller Combo');
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const p = await createProduct(seller.token, { weightKg: 1.2, perishable: true, cat: 'Meyve' });

    const shipment = await fetch(url('/api/admin/shipments'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, quantity: 4, buyerName: 'Kombo Alıcı', buyerPhone: nextTestPhone(), address: 'Kombo Mah.' }),
    }).then((r) => r.json());
    assert.equal(shipment.perishable, true);
    assert.equal(shipment.totalWeightKg, 4.8);

    const coldBox = await fetch(url('/api/owner/packaging'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ name: 'Soğuk Zincir Kutusu (test)', unit: '/ adet', price: 40 }),
    }).then((r) => r.json());
    const order = await fetch(url('/api/admin/packaging/order'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ itemId: coldBox.id, quantity: 4, note: 'Çabuk bozulan ürün için' }),
    }).then((r) => r.json());

    await fetch(url('/api/owner/shipments/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ id: shipment.id, status: 'delivered' }),
    });
    await fetch(url('/api/owner/packaging/orders/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ id: order.id, status: 'delivered' }),
    });

    const mineShipments = await fetch(url('/api/admin/shipments/mine'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    const mineOrders = await fetch(url('/api/admin/packaging/orders/mine'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.equal(mineShipments.shipments.find((s) => s.id === shipment.id).status, 'delivered');
    assert.equal(mineOrders.orders.find((o) => o.id === order.id).status, 'delivered');
  });
});

describe('Kullanıcı senaryosu: kısmi bildirim tercihi', () => {
  test('sadece SMS açıkken e-posta gitmez', async () => {
    const seller = await newSeller('Seller Partial Notify');
    const buyer = await newBuyer('Buyer Partial Notify');
    const p = await createProduct(seller.token);

    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: 'Seller Partial Notify', city: 'Test Şehir', email: 'partial@test.local' }),
    });
    await fetch(url('/api/auth/notify-prefs'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ sms: true, email: false }),
    });
    await fetch(url('/api/messages/send'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, productTitle: p.title, text: 'Fiyat pazarlığı olur mu?' }),
    });

    const log = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'notifications.json'), 'utf8'));
    const entries = Object.values(log).filter((n) => n.phone === seller.phone);
    assert.equal(entries.filter((n) => n.channel === 'sms').length, 1);
    assert.equal(entries.filter((n) => n.channel === 'email').length, 0);
  });
});

describe('Kullanıcı senaryosu: satıcı token\'ıyla yönetici uçlarına erişim denemesi', () => {
  test('onaylı bir satıcı hiçbir owner uç noktasını kullanamaz', async () => {
    const seller = await newSeller('Seller As Intruder');
    const endpoints = [
      ['/api/owner/sellers/approve', { phone: '5550000000', status: 'approved' }],
      ['/api/owner/packaging', { name: 'X', unit: '/ adet', price: 10 }],
      ['/api/owner/reviews/moderate', { productSlug: 'x', reviewId: 'x', status: 'approved' }],
      ['/api/owner/shipments/update', { id: 'x', status: 'shipped' }],
      ['/api/owner/products/approve-organic', { slug: 'x', approved: true }],
    ];
    for (const [endpoint, body] of endpoints) {
      const r = await fetch(url(endpoint), { method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify(body) });
      assert.equal(r.status, 401, endpoint + ' 401 dönmeli');
    }
  });
});

describe('Kayıt: telefon numarası zaten kayıtlıysa erken hata', () => {
  test('SMS kodu gönderilmeden önce telefonun zaten kayıtlı olduğu bildirilir', async () => {
    const existing = await newBuyer('Zaten Kayıtlı');
    const r = await fetch(url('/api/auth/request-code'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: existing.phone }),
    });
    const data = await r.json();
    assert.equal(r.status, 400);
    assert.match(data.error, /zaten kayıtlı/);
  });

  test('kayıtlı olmayan bir telefon için kod normal şekilde gönderilir', async () => {
    const phone = nextTestPhone();
    const r = await fetch(url('/api/auth/request-code'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    assert.equal(r.status, 200);
  });
});

describe('Kayıt: il/ilçe/mahalle', () => {
  test('kayıt sırasında ilçe ve mahalle saklanır', async () => {
    const buyer = await newBuyer('Adres Testi');
    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.equal(me.user.district, 'Test İlçe');
    assert.equal(me.user.city, 'Test Şehir');
  });

  test('hesap ayarlarından ilçe/mahalle güncellenebilir', async () => {
    const buyer = await newBuyer('Adres Güncelleme');
    const updated = await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ name: 'Adres Güncelleme', city: 'İzmir', district: 'Karşıyaka', neighborhood: 'Bostanlı Mah.' }),
    }).then((r) => r.json());
    assert.equal(updated.user.district, 'Karşıyaka');
    assert.equal(updated.user.neighborhood, 'Bostanlı Mah.');
  });

  test('ilçe tek karakterle güncellenemez', async () => {
    const buyer = await newBuyer('Adres Kısa İlçe');
    const r = await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ name: 'X', city: 'İzmir', district: 'K' }),
    });
    assert.equal(r.status, 400);
  });
});

describe('Bildirim sınıfları ve yönetici kontrolü', () => {
  test('kanal listesi simüle olarak işaretlenir, varsayılan olarak ikisi de açık', async () => {
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const r = await fetch(url('/api/owner/notification-settings'), { headers: authHeaders(ownerToken) }).then((r) => r.json());
    assert.equal(r.settings.smsEnabled, true);
    assert.equal(r.settings.emailEnabled, true);
    const keys = r.channels.map((c) => c.key).sort();
    assert.deepEqual(keys, ['email', 'sms']);
    const byKey = Object.fromEntries(r.channels.map((c) => [c.key, c.configured]));
    assert.equal(byKey.sms, false);
    assert.equal(byKey.email, true);
  });

  test('admin SMS kanalını global kapatınca kullanıcı tercihi açık olsa da SMS gitmez', async () => {
    const seller = await newSeller('Seller Global Toggle');
    const buyer = await newBuyer('Buyer Global Toggle');
    const p = await createProduct(seller.token);
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);

    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: 'Seller Global Toggle', city: 'Test Şehir', email: 'global@test.local' }),
    });
    await fetch(url('/api/auth/notify-prefs'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ sms: true, email: true }),
    });
    await fetch(url('/api/owner/notification-settings'), {
      method: 'POST', headers: authHeaders(ownerToken), body: JSON.stringify({ smsEnabled: false }),
    });

    await fetch(url('/api/messages/send'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, productTitle: p.title, text: 'Global toggle testi' }),
    });

    const log = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'notifications.json'), 'utf8'));
    const entries = Object.values(log).filter((n) => n.phone === seller.phone);
    assert.equal(entries.filter((n) => n.channel === 'sms').length, 0);
    assert.equal(entries.filter((n) => n.channel === 'email').length, 1);

    // Sonraki testleri etkilememesi için global anahtarı geri aç.
    await fetch(url('/api/owner/notification-settings'), {
      method: 'POST', headers: authHeaders(ownerToken), body: JSON.stringify({ smsEnabled: true }),
    });
  });

  test('gönderilen bildirimler owner panelinde görünür', async () => {
    const seller = await newSeller('Seller Notif List');
    const buyer = await newBuyer('Buyer Notif List');
    const p = await createProduct(seller.token);
    await fetch(url('/api/auth/notify-prefs'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ sms: true, email: false }),
    });
    await fetch(url('/api/messages/send'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, productTitle: p.title, text: 'Listede görünecek mesaj' }),
    });
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const r = await fetch(url('/api/owner/notifications'), { headers: authHeaders(ownerToken) }).then((r) => r.json());
    assert.ok(r.notifications.some((n) => n.phone === seller.phone && n.event === 'new_message'));
  });

  test('bildirim uçları yetkisiz erişime kapalı', async () => {
    const r1 = await fetch(url('/api/owner/notification-settings'));
    assert.equal(r1.status, 401);
    const r2 = await fetch(url('/api/owner/notifications'));
    assert.equal(r2.status, 401);
  });
});

describe('Rozetli satıcı sistemi ve profil sayfası', () => {
  test('varsayılan olarak satıcı rozetsizdir, /api/products bunu yansıtır', async () => {
    const seller = await newSeller('Seller Badge Default');
    const p = await createProduct(seller.token);
    const list = await fetch(url('/api/products')).then((r) => r.json());
    const found = list.products.find((x) => x.slug === p.slug);
    assert.equal(found.sellerVerified, false);
  });

  test('admin rozet verir, ürün listesine ve satıcı profiline yansır', async () => {
    const seller = await newSeller('Seller Badge On');
    const p = await createProduct(seller.token);
    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);

    const badged = await fetch(url('/api/owner/sellers/badge'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone: seller.phone, verified: true }),
    }).then((r) => r.json());
    assert.equal(badged.user.verifiedSeller, true);

    const list = await fetch(url('/api/products')).then((r) => r.json());
    assert.equal(list.products.find((x) => x.slug === p.slug).sellerVerified, true);

    const html = await fetch(url('/urun/' + p.slug + '.html')).then((r) => r.text());
    assert.match(html, /seller-badge/);

    const profileHtml = await fetch(url('/satici/' + me.user.id + '.html')).then((r) => r.text());
    assert.match(profileHtml, /seller-badge/);
    assert.match(profileHtml, new RegExp(p.title));

    // Rozeti kaldırınca da doğru yansımalı.
    const unbadged = await fetch(url('/api/owner/sellers/badge'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone: seller.phone, verified: false }),
    }).then((r) => r.json());
    assert.equal(unbadged.user.verifiedSeller, false);
  });

  test('rozet uç noktası yetkisiz erişime kapalı', async () => {
    const r = await fetch(url('/api/owner/sellers/badge'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5900000001', verified: true }),
    });
    assert.equal(r.status, 401);
  });

  test('satıcı profil sayfası ürünlerini ve değerlendirme ortalamasını gösterir', async () => {
    const seller = await newSeller('Seller Profile Page');
    const buyer = await newBuyer('Buyer Profile Page');
    const p = await createProduct(seller.token, { cat: 'Kuruyemiş' });
    await completePurchase(buyer.token, seller.token, p.slug);
    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(seller.token) }).then((r) => r.json());

    await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Harika' }),
    });

    const html = await fetch(url('/satici/' + me.user.id + '.html')).then((r) => r.text());
    assert.match(html, new RegExp(p.title));
    assert.match(html, /5\.0 \/ 5/);
  });

  test('olmayan veya satıcı olmayan id için satıcı profili 404 döner', async () => {
    const r1 = await fetch(url('/satici/u_yokbovle.html'));
    assert.equal(r1.status, 404);

    const buyer = await newBuyer('Buyer Not Seller Profile');
    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    const r2 = await fetch(url('/satici/' + me.user.id + '.html'));
    assert.equal(r2.status, 404);
  });
});

describe('Admin: satıcı IBAN/tür düzenleme', () => {
  test('admin bir satıcının IBAN\'ını ve türünü değiştirebilir', async () => {
    const seller = await newSeller('IBAN Düzenle');
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const updated = await fetch(url('/api/owner/sellers/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone: seller.phone, iban: 'TR330006100519786457841326', sellerType: 'sirket' }),
    }).then((r) => r.json());
    assert.equal(updated.user.iban, 'TR330006100519786457841326');
    assert.equal(updated.user.sellerType, 'sirket');

    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.equal(me.user.iban, 'TR330006100519786457841326');
    assert.equal(me.user.sellerType, 'sirket');
  });

  test('geçersiz IBAN reddedilir', async () => {
    const seller = await newSeller('IBAN Geçersiz');
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const r = await fetch(url('/api/owner/sellers/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone: seller.phone, iban: 'gecersiz-iban' }),
    });
    assert.equal(r.status, 400);
  });

  test('yetkisiz erişime kapalı', async () => {
    const r = await fetch(url('/api/owner/sellers/update'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '5900000001', sellerType: 'sirket' }),
    });
    assert.equal(r.status, 401);
  });

  test('siparişte satıcının güncel IBAN\'ı görünür (mark-payment-sent akışı için)', async () => {
    const seller = await newSeller('IBAN Sipariş Akışı');
    const buyer = await newBuyer('IBAN Sipariş Alıcı');
    const product = await createProduct(seller.token, {});
    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Test Şehir', district: 'Test İlçe', termsAccepted: true }),
    }).then((r) => r.json());

    // newSeller() varsayılan olarak sabit bir test IBAN'ı ile kayıt olur (satıcı kaydında
    // IBAN artık zorunlu) — burada admin'in IBAN'ı DEĞİŞTİRMESİNİN siparişe hemen
    // yansıdığını doğruluyoruz (satıcının IBAN'ı siparişte sabitlenmez, her okumada
    // güncel halinden katılır, bkz. /api/product-orders/mine).
    const beforeIban = await fetch(url('/api/product-orders/mine'), { headers: authHeaders(buyer.token) })
      .then((r) => r.json()).then((d) => d.orders.find((o) => o.id === order.id).sellerIban);
    assert.equal(beforeIban, 'TR330006100519786457841326');

    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    await fetch(url('/api/owner/sellers/update'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone: seller.phone, iban: 'TR640001200945897069872637' }),
    });

    const afterIban = await fetch(url('/api/product-orders/mine'), { headers: authHeaders(buyer.token) })
      .then((r) => r.json()).then((d) => d.orders.find((o) => o.id === order.id).sellerIban);
    assert.equal(afterIban, 'TR640001200945897069872637');
  });
});

describe('Kategoriye özel filtre: Baklava kategorisi backend desteği', () => {
  test('Baklava kategorisinde İç Malzeme özelliği kabul edilir', async () => {
    const seller = await newSeller('Seller Baklava');
    const p = await createProduct(seller.token, { cat: 'Baklava', attrs: { ictur: 'Fıstıklı' } });
    assert.deepEqual(p.attrs, { ictur: 'Fıstıklı' });
  });
});

describe('Var olan alıcı hesabının kendi isteğiyle satıcıya geçmesi', () => {
  test('alıcı yeterli iş açıklamasıyla başvurunca satıcıya dönüşür ve onay bekler', async () => {
    const buyer = await newBuyer('Buyer Becomes Seller');
    const badReq = await fetch(url('/api/auth/apply-seller'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ businessInfo: 'kısa' }),
    });
    assert.equal(badReq.status, 400);

    const r = await fetch(url('/api/auth/apply-seller'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ businessInfo: 'Kendi bahçemde zeytin ve zeytinyağı üretiyorum.', taxId: '12345678901', iban: 'TR330006100519786457841326' }),
    });
    const data = await r.json();
    assert.equal(r.status, 200);
    assert.equal(data.user.role, 'satici');
    assert.equal(data.user.sellerStatus, 'pending');

    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(buyer.token) }).then((res) => res.json());
    assert.equal(me.user.role, 'satici');

    const again = await fetch(url('/api/auth/apply-seller'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ businessInfo: 'Kendi bahçemde zeytin ve zeytinyağı üretiyorum.' }),
    });
    assert.equal(again.status, 400);

    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);
    const approved = await fetch(url('/api/owner/sellers/approve'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ phone: buyer.phone, status: 'approved' }),
    }).then((res) => res.json());
    assert.equal(approved.user.sellerStatus, 'approved');
  });

  test('girişsiz istek 401 döner', async () => {
    const r = await fetch(url('/api/auth/apply-seller'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessInfo: 'Kendi bahçemde zeytin üretiyorum.' }),
    });
    assert.equal(r.status, 401);
  });
});

describe('Ürün siparişleri (Siparişlerim): oluşturma, takip, durum güncelleme', () => {
  test('alıcı sipariş talebi oluşturur, kendi listesinde ve satıcının gelen kutusunda görür', async () => {
    const seller = await newSeller('Sipariş Satıcı');
    const product = await createProduct(seller.token, { title: 'Sipariş Testi Ürünü' });
    const buyer = await newBuyer('Sipariş Alıcı');

    const missingCity = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 2, district: 'Konak' }),
    });
    assert.equal(missingCity.status, 400);

    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({
        productSlug: product.slug, quantity: 3, city: 'İzmir', district: 'Konak',
        address: 'Test mahallesi', deadline: 'Bu hafta içinde', note: 'Az şekerli olsun', termsAccepted: true,
      }),
    }).then((r) => r.json());
    assert.equal(order.status, 'requested');
    assert.equal(order.quantity, 3);
    assert.equal(order.sellerId, seller.user.id);

    const mine = await fetch(url('/api/product-orders/mine'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.equal(mine.orders.length, 1);
    assert.equal(mine.orders[0].id, order.id);

    const incoming = await fetch(url('/api/admin/product-orders/mine'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.equal(incoming.orders.length, 1);
    assert.equal(incoming.orders[0].buyerName, 'Sipariş Alıcı');
  });

  test('satıcı sipariş durumunu günceller, başka satıcı güncelleyemez', async () => {
    const seller = await newSeller('Durum Satıcı');
    const otherSeller = await newSeller('Başka Satıcı');
    const product = await createProduct(seller.token, { title: 'Durum Testi Ürünü' });
    const buyer = await newBuyer('Durum Alıcı');

    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Manisa', district: 'Şehzadeler', termsAccepted: true }),
    }).then((r) => r.json());

    const wrongSeller = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(otherSeller.token),
      body: JSON.stringify({ id: order.id, status: 'confirmed' }),
    });
    assert.equal(wrongSeller.status, 404);

    const badStatus = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'gecersiz' }),
    });
    assert.equal(badStatus.status, 400);

    const updated = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'confirmed', termsAccepted: true }),
    }).then((r) => r.json());
    assert.equal(updated.status, 'confirmed');

    const mine = await fetch(url('/api/product-orders/mine'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.equal(mine.orders[0].status, 'confirmed');
  });

  test('girişsiz istekler 401 döner', async () => {
    const r1 = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productSlug: 'x', quantity: 1, city: 'X', district: 'Y' }),
    });
    assert.equal(r1.status, 401);
    const r2 = await fetch(url('/api/product-orders/mine'));
    assert.equal(r2.status, 401);
  });
});

describe('Sipariş fotoğraf doğrulaması (opsiyonel): gönderim ve teslim alma fotoğrafı', () => {
  test('satıcı durum güncellerken opsiyonel gönderim fotoğrafı ekleyebilir', async () => {
    const seller = await newSeller('Fotoğraflı Satıcı');
    const product = await createProduct(seller.token, { title: 'Fotoğraf Testi Ürünü' });
    const buyer = await newBuyer('Fotoğraflı Alıcı');

    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Bursa', district: 'Nilüfer', termsAccepted: true }),
    }).then((r) => r.json());

    // fotoğrafsız güncelleme hâlâ çalışmalı (opsiyonel olduğu için zorunlu değil)
    const noPhoto = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'confirmed', termsAccepted: true }),
    }).then((r) => r.json());
    assert.equal(noPhoto.sellerProofPhotoUrl, null);

    const img = await uploadImage(seller.token);
    const withPhoto = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'completed', proofPhotoUrl: img }),
    }).then((r) => r.json());
    assert.equal(withPhoto.sellerProofPhotoUrl, img);

    const mine = await fetch(url('/api/product-orders/mine'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.equal(mine.orders[0].sellerProofPhotoUrl, img);
  });

  test('alıcı teslim aldığını fotoğrafsız ya da fotoğrafla onaylayabilir, başkasının siparişini onaylayamaz', async () => {
    const seller = await newSeller('Teslim Satıcı');
    const product = await createProduct(seller.token, { title: 'Teslim Testi Ürünü' });
    const buyer = await newBuyer('Teslim Alıcı');
    const otherBuyer = await newBuyer('Başka Alıcı');

    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Konya', district: 'Selçuklu', termsAccepted: true }),
    }).then((r) => r.json());

    const wrongBuyer = await fetch(url('/api/product-orders/confirm-receipt'), {
      method: 'POST', headers: authHeaders(otherBuyer.token),
      body: JSON.stringify({ id: order.id }),
    });
    assert.equal(wrongBuyer.status, 404);

    const img = await uploadImage(buyer.token);
    const confirmed = await fetch(url('/api/product-orders/confirm-receipt'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ id: order.id, proofPhotoUrl: img }),
    }).then((r) => r.json());
    assert.ok(confirmed.buyerConfirmedAt);
    assert.equal(confirmed.buyerProofPhotoUrl, img);

    const incoming = await fetch(url('/api/admin/product-orders/mine'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.equal(incoming.orders[0].buyerProofPhotoUrl, img);
  });

  test('geçersiz fotoğraf url\'i reddedilir', async () => {
    const seller = await newSeller('Geçersiz Foto Satıcı');
    const product = await createProduct(seller.token, { title: 'Geçersiz Foto Ürünü' });
    const buyer = await newBuyer('Geçersiz Foto Alıcı');
    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Trabzon', district: 'Ortahisar', termsAccepted: true }),
    }).then((r) => r.json());

    const bad = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'confirmed', proofPhotoUrl: 'https://evil.example/x.png' }),
    });
    assert.equal(bad.status, 400);
  });
});

describe('Satıcı IBAN\'ı ve "ödemeyi gönderdim" öz-bildirimi', () => {
  test('geçersiz IBAN ile satıcı kaydı reddedilir, geçerliyle kabul edilir', async () => {
    const phone = nextTestPhone();
    const base = {
      name: 'IBAN Test', city: 'Test Şehir', district: 'Test İlçe', password: 'test1234',
      role: 'satici', termsAccepted: true,
      businessInfo: 'Bahçemden zeytin ve zeytinyağı üretip satıyorum, on yıldır bu işteyim.',
      taxId: '12345678901',
    };
    const missing = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base),
    });
    assert.equal(missing.status, 400);

    const badFormat = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, iban: 'DE89370400440532013000' }),
    });
    assert.equal(badFormat.status, 400);

    const reg = await registerUser(server.baseUrl, {
      name: base.name, city: base.city, district: base.district, password: base.password,
      role: 'satici', phone, businessInfo: base.businessInfo, taxId: base.taxId,
      iban: 'tr33 0006 1005 1978 6457 8413 26',
    });
    assert.equal(reg.user.iban, 'TR330006100519786457841326');
  });

  test('alıcı, siparişinde satıcının güncel IBAN\'ını görür ve ödemeyi gönderdiğini işaretleyebilir', async () => {
    const seller = await newSeller('IBAN Akış Satıcı');
    const product = await createProduct(seller.token, { title: 'IBAN Akış Ürünü' });
    const buyer = await newBuyer('IBAN Akış Alıcı');
    const otherBuyer = await newBuyer('IBAN Akış Başka Alıcı');

    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Ankara', district: 'Çankaya', termsAccepted: true }),
    }).then((r) => r.json());

    const mineBefore = await fetch(url('/api/product-orders/mine'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.equal(mineBefore.orders[0].sellerIban, 'TR330006100519786457841326');
    assert.equal(mineBefore.orders[0].paymentSentAt, null);

    const wrongBuyer = await fetch(url('/api/product-orders/mark-payment-sent'), {
      method: 'POST', headers: authHeaders(otherBuyer.token),
      body: JSON.stringify({ id: order.id }),
    });
    assert.equal(wrongBuyer.status, 404);

    const marked = await fetch(url('/api/product-orders/mark-payment-sent'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ id: order.id }),
    }).then((r) => r.json());
    assert.ok(marked.paymentSentAt);

    const incoming = await fetch(url('/api/admin/product-orders/mine'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.ok(incoming.orders[0].paymentSentAt);
  });
});

describe('Sipariş Şartları: her iki taraf da kendi adımında kabul etmek zorunda', () => {
  test('alıcı Sipariş Şartları\'nı kabul etmeden talep oluşturamaz', async () => {
    const seller = await newSeller('Şart Satıcı');
    const product = await createProduct(seller.token, { title: 'Şart Testi Ürünü' });
    const buyer = await newBuyer('Şart Alıcı');

    const noTerms = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'İzmir', district: 'Konak' }),
    });
    assert.equal(noTerms.status, 400);

    const withTerms = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'İzmir', district: 'Konak', termsAccepted: true }),
    }).then((r) => r.json());
    assert.ok(withTerms.buyerTermsAcceptedAt);
    assert.equal(withTerms.sellerTermsAcceptedAt, null);
  });

  test('satıcı ilk onayda/tamamlamada Sipariş Şartları\'nı kabul etmek zorunda, sonrasında tekrar istenmez', async () => {
    const seller = await newSeller('Şart Satıcı 2');
    const product = await createProduct(seller.token, { title: 'Şart Testi Ürünü 2' });
    const buyer = await newBuyer('Şart Alıcı 2');
    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Bursa', district: 'Nilüfer', termsAccepted: true }),
    }).then((r) => r.json());

    const noTerms = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'confirmed' }),
    });
    assert.equal(noTerms.status, 400);

    const confirmed = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'confirmed', termsAccepted: true }),
    }).then((r) => r.json());
    assert.ok(confirmed.sellerTermsAcceptedAt);

    // Bir kere kabul edince, sonraki durum değişikliklerinde tekrar istenmiyor.
    const completedWithoutTerms = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'completed' }),
    }).then((r) => r.json());
    assert.equal(completedWithoutTerms.status, 'completed');
  });

  test('satıcı şartları kabul etmeden siparişi reddedebilir (red için şart aranmaz)', async () => {
    const seller = await newSeller('Şart Satıcı 3');
    const product = await createProduct(seller.token, { title: 'Şart Testi Ürünü 3' });
    const buyer = await newBuyer('Şart Alıcı 3');
    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Konya', district: 'Selçuklu', termsAccepted: true }),
    }).then((r) => r.json());

    const rejected = await fetch(url('/api/admin/product-orders/update'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ id: order.id, status: 'rejected' }),
    }).then((r) => r.json());
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.sellerTermsAcceptedAt, null);
  });
});

describe('Kimlik belgesi (opsiyonel, KVKK açık rıza gerekli)', () => {
  test('kayıt sırasında kimlik belgesi rıza olmadan gönderilemez, rızayla kaydedilir', async () => {
    const phone = nextTestPhone();
    const base = {
      name: 'Kimlik Test', city: 'Test Şehir', district: 'Test İlçe', password: 'test1234',
      role: 'satici', termsAccepted: true,
      businessInfo: 'Bahçemden zeytin ve zeytinyağı üretip satıyorum, on yıldır bu işteyim.',
      taxId: '12345678901', iban: 'TR330006100519786457841326',
    };

    const noConsent = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, idDocDataUrl: TINY_PNG_DATA_URL }),
    });
    assert.equal(noConsent.status, 400);

    const badFile = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, idDocDataUrl: 'data:text/plain;base64,aGk=', idDocConsent: true }),
    });
    assert.equal(badFile.status, 400);

    const reg = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, idDocDataUrl: TINY_PNG_DATA_URL, idDocConsent: true }),
    }).then((r) => r.json());
    await fetch(url('/api/auth/request-code'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }),
    });
    const ver = await fetch(url('/api/auth/verify'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code: '0000', regToken: reg.regToken }),
    }).then((r) => r.json());
    assert.ok(ver.user.idDocUrl);
    assert.ok(ver.user.idDocConsentAt);
  });

  test('kaydolduktan sonra da kimlik belgesi rıza olmadan eklenemez', async () => {
    const seller = await newSeller('Sonradan Kimlik Satıcı');
    const doc = await uploadDoc(seller.token);

    const noConsent = await fetch(url('/api/auth/seller-application/id-doc'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ docUrl: doc }),
    });
    assert.equal(noConsent.status, 400);

    const withConsent = await fetch(url('/api/auth/seller-application/id-doc'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ docUrl: doc, idDocConsent: true }),
    }).then((r) => r.json());
    assert.equal(withConsent.user.idDocUrl, doc);
    assert.ok(withConsent.user.idDocConsentAt);
  });

  test('kimlik belgesi olmadan kayıt normal şekilde çalışmaya devam eder', async () => {
    const buyer = await newBuyer('İdDocsuz Test');
    assert.equal(buyer.user.idDocUrl, undefined);
  });
});

describe('Şirket/Bireysel satıcı türü', () => {
  test('bireysel satıcı 11 haneli TC Kimlik No, şirket satıcı 10 haneli Vergi No ister', async () => {
    const base = {
      name: 'Tip Test', city: 'Test Şehir', district: 'Test İlçe', password: 'test1234',
      role: 'satici', termsAccepted: true,
      businessInfo: 'Bahçemden zeytin ve zeytinyağı üretip satıyorum, on yıldır bu işteyim.',
      iban: 'TR330006100519786457841326',
    };

    const bireyselTooShort = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, sellerType: 'bireysel', taxId: '1234567890' }),
    });
    assert.equal(bireyselTooShort.status, 400);

    const bireyselOk = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, sellerType: 'bireysel', taxId: '12345678901' }),
    });
    assert.equal(bireyselOk.status, 200);

    const sirketElevenDigits = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, sellerType: 'sirket', taxId: '12345678901', idDocDataUrl: TINY_PNG_DATA_URL, idDocConsent: true }),
    });
    assert.equal(sirketElevenDigits.status, 400);

    const sirketOk = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, sellerType: 'sirket', taxId: '1234567890', idDocDataUrl: TINY_PNG_DATA_URL, idDocConsent: true }),
    });
    assert.equal(sirketOk.status, 200);
  });

  test('şirket satıcı vergi levhası yüklemeden kayıt olamaz', async () => {
    const base = {
      name: 'Belgesiz Şirket', city: 'Test Şehir', district: 'Test İlçe', password: 'test1234',
      role: 'satici', termsAccepted: true, sellerType: 'sirket',
      businessInfo: 'Şirket olarak sebze meyve üretip satıyoruz.',
      taxId: '1234567890', iban: 'TR330006100519786457841326',
    };
    const noDoc = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base),
    });
    assert.equal(noDoc.status, 400);
  });

  test('satıcı türü belirtilmezse bireysel kabul edilir (geriye dönük uyum)', async () => {
    const seller = await newSeller('Tip Belirtilmemis');
    assert.equal(seller.user.sellerType, 'bireysel');
  });

  test('OCR ile okunan numara beyan edilenle uyuşmuyorsa admin karşılaştırması için saklanır', async () => {
    const phone = nextTestPhone();
    const base = {
      name: 'OCR Test', city: 'Test Şehir', district: 'Test İlçe', password: 'test1234',
      role: 'satici', termsAccepted: true, sellerType: 'bireysel',
      businessInfo: 'Bahçemden zeytin ve zeytinyağı üretip satıyorum, on yıldır bu işteyim.',
      taxId: '12345678901', iban: 'TR330006100519786457841326',
      idDocDataUrl: TINY_PNG_DATA_URL, idDocConsent: true, idDocOcrTaxId: '99999999999',
    };
    const reg = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base),
    }).then((r) => r.json());
    await fetch(url('/api/auth/request-code'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }),
    });
    const ver = await fetch(url('/api/auth/verify'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code: '0000', regToken: reg.regToken }),
    }).then((r) => r.json());
    assert.equal(ver.user.idDocOcrTaxId, '99999999999');
    assert.notEqual(ver.user.idDocOcrTaxId, ver.user.taxId);
  });
});

describe('Siber güvenlik sertleştirmeleri', () => {
  test('SMS doğrulama kodu API yanıtında asla dönülmez (sadece konsola yazılır)', async () => {
    const phone = nextTestPhone();
    const r = await fetch(url('/api/auth/request-code'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }),
    }).then((res) => res.json());
    assert.deepEqual(Object.keys(r).sort(), ['ok']);
    assert.equal(r.dev, undefined);
    assert.equal(r.hint, undefined);
    assert.equal(r.code, undefined);
  });

  test('yönetici parolası çok sayıda hatalı denemeden sonra kilitlenir', async () => {
    // Kilitleme IP bazlı — burada X-Forwarded-For ile kendine özgü sahte bir IP
    // kullanıyoruz (sunucu loopback'ten gelen bu başlığa güveniyor, bkz. getClientIp),
    // yoksa bu testin tükettiği deneme hakkı, dosyadaki diğer tüm testlerin kullandığı
    // paylaşılan 127.0.0.1 anahtarını da kilitleyip sonraki ownerLogin() çağrılarını bozardı.
    const fakeIp = '203.0.113.' + (1 + Math.floor(Math.random() * 254));
    for (let i = 0; i < 10; i++) {
      const r = await fetch(url('/api/owner/login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fakeIp },
        body: JSON.stringify({ password: 'yanlis-parola-' + i }),
      });
      assert.equal(r.status, 401);
    }
    const lockedOut = await fetch(url('/api/owner/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fakeIp },
      body: JSON.stringify({ password: server.adminPassword }),
    });
    assert.equal(lockedOut.status, 429);
  });

  test('kullanıcı parolası tek bir telefon için çok sayıda hatalı denemeden sonra kilitlenir', async () => {
    const buyer = await newBuyer('Kilitlenme Testi');
    for (let i = 0; i < 10; i++) {
      const r = await fetch(url('/api/auth/login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: buyer.phone, password: 'yanlis-parola-' + i }),
      });
      assert.equal(r.status, 401);
    }
    const lockedOut = await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: buyer.phone, password: 'test1234' }),
    });
    assert.equal(lockedOut.status, 429);
  });

  test('yanıtlar temel güvenlik başlıklarını içerir', async () => {
    const r = await fetch(url('/api/piyasa'));
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  });
});

describe('Satın alma doğrulaması olmadan yorum yapılamaz', () => {
  test('ürünü satın almamış bir alıcı yorum yapamaz', async () => {
    const seller = await newSeller('Seller No Purchase');
    const buyer = await newBuyer('Buyer No Purchase');
    const p = await createProduct(seller.token);

    const r = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Hiç almadım ama yorum yapmaya çalışıyorum' }),
    });
    assert.equal(r.status, 403);
  });

  test('sadece "requested" durumundaki (henüz tamamlanmamış) sipariş yorum yapmaya yetmez', async () => {
    const seller = await newSeller('Seller Requested Only');
    const buyer = await newBuyer('Buyer Requested Only');
    const p = await createProduct(seller.token);
    await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, quantity: 1, city: 'Test Şehir', district: 'Test İlçe', termsAccepted: true }),
    });
    const r = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Sipariş henüz tamamlanmadı' }),
    });
    assert.equal(r.status, 403);
  });

  test('alıcının teslim aldığını onaylaması da (satıcı "completed" işaretlemese dahi) yorum hakkı verir', async () => {
    const seller = await newSeller('Seller Receipt Confirmed');
    const buyer = await newBuyer('Buyer Receipt Confirmed');
    const p = await createProduct(seller.token);
    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, quantity: 1, city: 'Test Şehir', district: 'Test İlçe', termsAccepted: true }),
    }).then((r) => r.json());
    await fetch(url('/api/product-orders/confirm-receipt'), {
      method: 'POST', headers: authHeaders(buyer.token), body: JSON.stringify({ id: order.id }),
    });
    const r = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Teslim aldım, çok iyiydi' }),
    });
    assert.equal(r.status, 200);
  });

  test('satıcı kendi ürününe sipariş açamaz, kendi ürününe yorum yapamaz', async () => {
    const seller = await newSeller('Seller Self Buy');
    const p = await createProduct(seller.token);

    const orderAttempt = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, quantity: 1, city: 'Test Şehir', district: 'Test İlçe', termsAccepted: true }),
    });
    assert.equal(orderAttempt.status, 400);

    const reviewAttempt = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Kendi ürünüme sahte yorum' }),
    });
    assert.equal(reviewAttempt.status, 400);
  });
});

describe('Satıcı yorum itirazı', () => {
  test('itiraz haklı bulunursa yorum yayından kalkar', async () => {
    const seller = await newSeller('Seller Dispute Upheld');
    const buyer = await newBuyer('Buyer Dispute Upheld');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);

    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Hakaret içeren sahte bir yorum gibi davranalım' }),
    }).then((r) => r.json());
    const reviewId = posted.reviews[0].id;

    const dispute = await fetch(url('/api/admin/reviews/dispute'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Bu kişi ürünümü hiç almadı, itiraz ediyorum.' }),
    }).then((r) => r.json());
    assert.equal(dispute.dispute.status, 'pending');

    // İkinci bir itiraz, ilki sonuçlanmadan açılamaz.
    const secondDispute = await fetch(url('/api/admin/reviews/dispute'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Tekrar itiraz' }),
    });
    assert.equal(secondDispute.status, 400);

    const resolved = await fetch(url('/api/owner/reviews/dispute/resolve'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ productSlug: p.slug, reviewId, status: 'upheld', adminNote: 'Sipariş kaydı yok.' }),
    }).then((r) => r.json());
    assert.equal(resolved.status, 'rejected'); // itiraz haklı -> yorum "rejected" sayılır, yayından kalkar
    assert.equal(resolved.dispute.status, 'upheld');

    const publicList = await fetch(url('/api/reviews?product=' + p.slug)).then((r) => r.json());
    assert.equal(publicList.reviews.length, 0);

    const stats = await fetch(url('/api/reviews/stats')).then((r) => r.json());
    assert.equal(stats[p.slug], undefined);
  });

  test('itiraz haksız bulunursa yorum yayında kalır', async () => {
    const seller = await newSeller('Seller Dispute Rejected');
    const buyer = await newBuyer('Buyer Dispute Rejected');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);
    const ownerToken = await ownerLogin(server.baseUrl, server.adminPassword);

    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 4, text: 'Ürün gerçekten geç geldi.' }),
    }).then((r) => r.json());
    const reviewId = posted.reviews[0].id;

    await fetch(url('/api/admin/reviews/dispute'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Zamanında gönderdim, haksız.' }),
    });
    const resolved = await fetch(url('/api/owner/reviews/dispute/resolve'), {
      method: 'POST', headers: authHeaders(ownerToken),
      body: JSON.stringify({ productSlug: p.slug, reviewId, status: 'rejected', adminNote: 'Kargo takip kaydı zamanında gönderildiğini gösteriyor.' }),
    }).then((r) => r.json());
    assert.equal(resolved.status, 'approved'); // itiraz haksız -> yorum olduğu gibi kalır
    assert.equal(resolved.dispute.status, 'rejected');

    const publicList = await fetch(url('/api/reviews?product=' + p.slug)).then((r) => r.json());
    assert.equal(publicList.reviews.length, 1);
  });

  test('ürünün sahibi olmayan satıcı itiraz açamaz, onay bekleyen yoruma itiraz edilemez', async () => {
    const seller = await newSeller('Seller Dispute Owner');
    const intruder = await newSeller('Seller Dispute Intruder');
    const buyer = await newBuyer('Buyer Dispute Owner');
    const p = await createProduct(seller.token);
    await completePurchase(buyer.token, seller.token, p.slug);

    const posted = await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 1, text: 'Kötü' }),
    }).then((r) => r.json());
    const reviewId = posted.reviews[0].id;

    const intruderAttempt = await fetch(url('/api/admin/reviews/dispute'), {
      method: 'POST', headers: authHeaders(intruder.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Ele geçirme girişimi' }),
    });
    assert.equal(intruderAttempt.status, 404);

    // 1 yıldız -> "pending" (henüz onaylı değil), onaylı olmayan yoruma itiraz edilemez.
    const pendingDisputeAttempt = await fetch(url('/api/admin/reviews/dispute'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ productSlug: p.slug, reviewId, text: 'Onaylanmamış yoruma itiraz' }),
    });
    assert.equal(pendingDisputeAttempt.status, 400);
  });
});

describe('Satıcı bazlı istatistikler (anasayfa sıralama/filtre için)', () => {
  test('/api/sellers/stats ortalama puanı ve tamamlanmış satış sayısını doğru hesaplar', async () => {
    const seller = await newSeller('Seller Stats');
    const buyerA = await newBuyer('Buyer Stats A');
    const buyerB = await newBuyer('Buyer Stats B');
    const p = await createProduct(seller.token);

    await completePurchase(buyerA.token, seller.token, p.slug);
    await completePurchase(buyerB.token, seller.token, p.slug);
    // İkisi de 4-5 yıldız: doğrudan yayınlanır, istatistiğe hemen girer (1-3 yıldız admin
    // onayı bekleyeceğinden buradaki ortalama hesaplamasını karmaşıklaştırmamak için).
    await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyerA.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 5, text: 'Mükemmel' }),
    });
    await fetch(url('/api/reviews'), {
      method: 'POST', headers: authHeaders(buyerB.token),
      body: JSON.stringify({ productSlug: p.slug, rating: 4, text: 'İyiydi' }),
    });

    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    const stats = await fetch(url('/api/sellers/stats')).then((r) => r.json());
    const mine = stats[me.user.id];
    assert.ok(mine);
    assert.equal(mine.avgRating, 4.5); // (5+4)/2
    assert.equal(mine.salesCount, 2);
  });
});

describe('Telefon/e-posta ile giriş ve şifremi unuttum', () => {
  test('e-posta ekleyen bir kullanıcı telefonla da e-postayla da giriş yapabilir', async () => {
    const buyer = await newBuyer('Login Test Buyer');
    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ name: 'Login Test Buyer', city: 'Test Şehir', email: 'login-test@example.com' }),
    });

    const byPhone = await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: buyer.phone, password: 'test1234' }),
    }).then((r) => r.json());
    assert.ok(byPhone.token);

    const byEmail = await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'login-test@example.com', password: 'test1234' }),
    }).then((r) => r.json());
    assert.ok(byEmail.token);
    assert.equal(byEmail.user.phone, buyer.phone);
  });

  test('eski "phone" alanı geriye dönük uyumlu çalışmaya devam eder', async () => {
    const buyer = await newBuyer('Legacy Phone Field');
    const r = await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: buyer.phone, password: 'test1234' }),
    }).then((r) => r.json());
    assert.ok(r.token);
  });

  test('bir e-posta iki farklı hesapta kullanılamaz', async () => {
    const buyerA = await newBuyer('Email Owner A');
    const buyerB = await newBuyer('Email Owner B');
    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(buyerA.token),
      body: JSON.stringify({ name: 'Email Owner A', city: 'Test Şehir', email: 'shared@example.com' }),
    });
    const attempt = await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(buyerB.token),
      body: JSON.stringify({ name: 'Email Owner B', city: 'Test Şehir', email: 'shared@example.com' }),
    });
    assert.equal(attempt.status, 400);
  });

  test('şifremi unuttum: var olmayan hesap için de aynı genel mesaj döner (numara sızdırılmaz)', async () => {
    const r = await fetch(url('/api/auth/forgot-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: '5559999999' }),
    }).then((r) => r.json());
    assert.equal(r.ok, true);
    assert.ok(r.message);
    assert.equal(r.devToken, undefined); // hesap yok, token da yok
  });

  test('şifremi unuttum → sıfırlama bağlantısı → yeni parolayla giriş, eski parola artık çalışmaz', async () => {
    const buyer = await newBuyer('Reset Flow Buyer');
    const forgot = await fetch(url('/api/auth/forgot-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: buyer.phone }),
    }).then((r) => r.json());
    assert.ok(forgot.devToken); // test ortamında yanıtta dönüyor

    const reset = await fetch(url('/api/auth/reset-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgot.devToken, password: 'yenisifre1' }),
    });
    assert.equal(reset.status, 200);

    const oldPassLogin = await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: buyer.phone, password: 'test1234' }),
    });
    assert.equal(oldPassLogin.status, 401);

    const newPassLogin = await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: buyer.phone, password: 'yenisifre1' }),
    });
    assert.equal(newPassLogin.status, 200);
  });

  test('sıfırlama tokenı bir kere kullanılabilir, ikinci kullanımda reddedilir', async () => {
    const buyer = await newBuyer('Reset Once Buyer');
    const forgot = await fetch(url('/api/auth/forgot-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: buyer.phone }),
    }).then((r) => r.json());

    const first = await fetch(url('/api/auth/reset-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgot.devToken, password: 'birinciyeni1' }),
    });
    assert.equal(first.status, 200);

    const second = await fetch(url('/api/auth/reset-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgot.devToken, password: 'ikinciyeni1' }),
    });
    assert.equal(second.status, 400);
  });

  test('geçersiz/uydurma tokenla sıfırlama denemesi reddedilir', async () => {
    const r = await fetch(url('/api/auth/reset-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'uydurma-token-123', password: 'birsifre1' }),
    });
    assert.equal(r.status, 400);
  });

  test('parola sıfırlanınca hesabın açık oturumları kapanır', async () => {
    const buyer = await newBuyer('Session Invalidate Buyer');
    // Sıfırlama öncesi eldeki token geçerli olmalı.
    const beforeMe = await fetch(url('/api/auth/me'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.ok(beforeMe.user);

    const forgot = await fetch(url('/api/auth/forgot-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: buyer.phone }),
    }).then((r) => r.json());
    await fetch(url('/api/auth/reset-password'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: forgot.devToken, password: 'yenisifre2' }),
    });

    const afterMe = await fetch(url('/api/auth/me'), { headers: authHeaders(buyer.token) }).then((r) => r.json());
    assert.equal(afterMe.user, null); // eski token artık geçersiz
  });
});

describe('Kayıt sırasında opsiyonel e-posta', () => {
  test('kayıt sırasında e-posta eklenirse hesapta saklanır ve o e-postayla giriş yapılabilir', async () => {
    const phone = nextTestPhone();
    const reg = await registerUser(server.baseUrl, {
      name: 'Kayıtta Email Veren', email: 'kayitta-email@example.com', city: 'Test Şehir', password: 'test1234', role: 'alici', phone,
    });
    assert.equal(reg.user.email, 'kayitta-email@example.com');

    const byEmail = await fetch(url('/api/auth/login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'kayitta-email@example.com', password: 'test1234' }),
    }).then((r) => r.json());
    assert.ok(byEmail.token);
  });

  test('kayıt sırasında e-posta boş bırakılabilir', async () => {
    const buyer = await newBuyer('Emailsiz Kayit');
    assert.equal(buyer.user.email, '');
  });

  test('kayıt sırasında geçersiz formatlı e-posta reddedilir', async () => {
    const phone = nextTestPhone();
    const r = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bozuk Email', email: 'gecersiz-email', city: 'Test Şehir', district: 'Test İlçe',
        password: 'test1234', role: 'alici', termsAccepted: true,
      }),
    });
    assert.equal(r.status, 400);
  });

  test('kayıt sırasında başka bir hesapta kayıtlı e-posta reddedilir', async () => {
    await registerUser(server.baseUrl, {
      name: 'İlk Sahip', email: 'cakisan@example.com', city: 'Test Şehir', password: 'test1234', role: 'alici', phone: nextTestPhone(),
    });
    const r = await fetch(url('/api/auth/register-start'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'İkinci Deneme', email: 'cakisan@example.com', city: 'Test Şehir', district: 'Test İlçe',
        password: 'test1234', role: 'alici', termsAccepted: true,
      }),
    });
    assert.equal(r.status, 400);
  });
});

describe('Google ile giriş', () => {
  test('GOOGLE_CLIENT_ID ayarlanmadıysa /api/auth/config bunu bildirir ve giriş uç noktası 501 döner', async () => {
    const cfg = await fetch(url('/api/auth/config')).then((r) => r.json());
    assert.equal(cfg.googleClientId, null);

    const r = await fetch(url('/api/auth/google-login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: 'her-neyse' }),
    });
    assert.equal(r.status, 501);
  });

  test('GOOGLE_CLIENT_ID ayarlıyken bozuk/uydurma bir credential imza doğrulamasında reddedilir', async () => {
    const googleServer = await startServer({ GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com' });
    try {
      const cfg = await fetch(googleServer.baseUrl + '/api/auth/config').then((r) => r.json());
      assert.equal(cfg.googleClientId, 'test-client-id.apps.googleusercontent.com');

      const notThreeParts = await fetch(googleServer.baseUrl + '/api/auth/google-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'sadece-bir-parca' }),
      });
      assert.equal(notThreeParts.status, 400);

      // Gerçek bir JWT şekli (3 parça) ama Google'ın imzalamadığı, uydurma bir token.
      const fakeHeader = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'uydurma-kid' })).toString('base64url');
      const fakePayload = Buffer.from(JSON.stringify({
        aud: 'test-client-id.apps.googleusercontent.com', iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1000) + 3600, email: 'sahte@example.com', email_verified: true,
      })).toString('base64url');
      const fakeToken = fakeHeader + '.' + fakePayload + '.uydurma-imza';
      const badSig = await fetch(googleServer.baseUrl + '/api/auth/google-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: fakeToken }),
      });
      assert.equal(badSig.status, 400);
    } finally {
      await googleServer.stop();
    }
  });
});

describe('Ürün listesinde satıcı türü (köylü/işletme filtresi için)', () => {
  test('bireysel ve şirket satıcıların ürünleri kendi sellerType\'ıyla döner', async () => {
    const bireysel = await newSeller('Filtre Köylü');
    const sirket = await newCompanySeller('Filtre İşletme');
    const p1 = await createProduct(bireysel.token, {});
    const p2 = await createProduct(sirket.token, {});

    const list = await fetch(url('/api/products')).then((r) => r.json());
    const found1 = list.products.find((p) => p.slug === p1.slug);
    const found2 = list.products.find((p) => p.slug === p2.slug);
    assert.equal(found1.sellerType, 'bireysel');
    assert.equal(found2.sellerType, 'sirket');
  });
});

describe('Şirket satıcı için fatura taslağı', () => {
  test('bireysel satıcı fatura taslağı isteyemez (403)', async () => {
    const seller = await newSeller('Fatura Bireysel');
    const buyer = await newBuyer('Fatura Alıcı 1');
    const product = await createProduct(seller.token, {});
    const order = await completePurchase(buyer.token, seller.token, product.slug);

    const r = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ id: order.id }),
    });
    assert.equal(r.status, 403);
  });

  test('henüz onaylanmamış (requested) sipariş için fatura oluşturulamaz', async () => {
    const seller = await newCompanySeller('Fatura Şirket Erken');
    const buyer = await newBuyer('Fatura Alıcı 2');
    const product = await createProduct(seller.token, {});
    const order = await fetch(url('/api/product-orders'), {
      method: 'POST', headers: authHeaders(buyer.token),
      body: JSON.stringify({ productSlug: product.slug, quantity: 1, city: 'Test Şehir', district: 'Test İlçe', termsAccepted: true }),
    }).then((r) => r.json());

    const r = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ id: order.id }),
    });
    assert.equal(r.status, 400);
  });

  test('tamamlanmış sipariş için doğru bilgilerle bir fatura taslağı üretilir ve tekrar istenince aynı numarayı döner', async () => {
    const seller = await newCompanySeller('Fatura Şirket Tam');
    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({
        name: seller.user.name, city: 'Test Şehir',
        companyLegalName: 'Örnek Tarım Ltd. Şti.', taxOffice: 'Test Vergi Dairesi', invoiceAddress: 'Test Mah. Test Sk. No:1',
      }),
    });
    const buyer = await newBuyer('Fatura Alıcı 3');
    const product = await createProduct(seller.token, { price: '100', unit: '/ kg' });
    const order = await completePurchase(buyer.token, seller.token, product.slug);

    const first = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ id: order.id }),
    }).then((r) => r.json());
    assert.match(first.invoiceNo, /^\d{4}\/\d{6}$/);
    assert.equal(first.seller.legalName, 'Örnek Tarım Ltd. Şti.');
    assert.equal(first.seller.taxOffice, 'Test Vergi Dairesi');
    assert.equal(first.buyer.name, buyer.user.name);
    assert.equal(first.item.unitPrice, 100);
    assert.equal(first.item.lineTotal, 100);
    assert.equal(first.einvoice, null);
    assert.equal(first.einvoiceError, null);

    const second = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ id: order.id }),
    }).then((r) => r.json());
    assert.equal(second.invoiceNo, first.invoiceNo);
  });

  test('başka bir satıcının siparişi için fatura istenemez', async () => {
    const seller = await newCompanySeller('Fatura Şirket Sahip');
    const otherSeller = await newCompanySeller('Fatura Şirket Başkası');
    const buyer = await newBuyer('Fatura Alıcı 4');
    const product = await createProduct(seller.token, {});
    const order = await completePurchase(buyer.token, seller.token, product.slug);

    const r = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(otherSeller.token), body: JSON.stringify({ id: order.id }),
    });
    assert.equal(r.status, 404);
  });
});

describe('Nilvera e-Fatura entegratör bağlantısı', () => {
  test('bağlanan API anahtarı hiçbir zaman istemciye dönmez, sadece einvoiceConnected görünür', async () => {
    const seller = await newCompanySeller('Nilvera Gizlilik');
    const saved = await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: seller.user.name, city: 'Test Şehir', einvoiceApiKey: 'gizli-api-anahtari', einvoiceEnv: 'test' }),
    }).then((r) => r.json());
    assert.equal(saved.user.einvoiceConnected, true);
    assert.equal(saved.user.einvoiceApiKey, undefined);

    const me = await fetch(url('/api/auth/me'), { headers: authHeaders(seller.token) }).then((r) => r.json());
    assert.equal(me.user.einvoiceConnected, true);
    assert.equal(me.user.einvoiceApiKey, undefined);
  });

  test('einvoiceDisconnect bağlantıyı kaldırır', async () => {
    const seller = await newCompanySeller('Nilvera Disconnect');
    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: seller.user.name, city: 'Test Şehir', einvoiceApiKey: 'gizli-api-anahtari' }),
    });
    const after = await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: seller.user.name, city: 'Test Şehir', einvoiceDisconnect: true }),
    }).then((r) => r.json());
    assert.equal(after.user.einvoiceConnected, false);
  });

  test('bağlı satıcı için fatura kesimi otomatik olarak Nilvera üzerinden denenir (test ortamında simüle edilir)', async () => {
    const seller = await newCompanySeller('Nilvera Bağlı');
    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: seller.user.name, city: 'Test Şehir', einvoiceApiKey: 'sahte-gecerli-anahtar', einvoiceEnv: 'test' }),
    });
    const buyer = await newBuyer('Nilvera Alıcı 1');
    const product = await createProduct(seller.token, { price: '50', unit: '/ kg' });
    const order = await completePurchase(buyer.token, seller.token, product.slug);

    const first = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ id: order.id, vatRate: 10 }),
    }).then((r) => r.json());
    assert.equal(first.einvoiceError, null);
    assert.equal(first.einvoice.provider, 'nilvera');
    assert.match(first.einvoice.providerInvoiceNo, /^TEST-/);

    // Aynı sipariş için tekrar istenince tekrar Nilvera'ya gitmez, kaydedileni döner.
    const second = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ id: order.id }),
    }).then((r) => r.json());
    assert.equal(second.einvoice.providerInvoiceNo, first.einvoice.providerInvoiceNo);
  });

  test('Nilvera bağlantısı başarısız olursa taslak akışı bozulmadan devam eder', async () => {
    const seller = await newCompanySeller('Nilvera Başarısız');
    await fetch(url('/api/auth/update-profile'), {
      method: 'POST', headers: authHeaders(seller.token),
      body: JSON.stringify({ name: seller.user.name, city: 'Test Şehir', einvoiceApiKey: 'FAIL_TEST_KEY', einvoiceEnv: 'test' }),
    });
    const buyer = await newBuyer('Nilvera Alıcı 2');
    const product = await createProduct(seller.token, { price: '50', unit: '/ kg' });
    const order = await completePurchase(buyer.token, seller.token, product.slug);

    const r = await fetch(url('/api/admin/product-orders/invoice'), {
      method: 'POST', headers: authHeaders(seller.token), body: JSON.stringify({ id: order.id }),
    }).then((r) => r.json());
    assert.equal(r.einvoice, null);
    assert.ok(r.einvoiceError);
    assert.match(r.invoiceNo, /^\d{4}\/\d{6}$/);
  });
});
