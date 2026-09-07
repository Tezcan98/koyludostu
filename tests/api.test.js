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

async function uploadDoc(token) {
  const r = await fetch(url('/api/admin/upload-doc'), {
    method: 'POST', headers: authHeaders(token), body: JSON.stringify({ dataUrl: TINY_PDF_DATA_URL }),
  }).then((r) => r.json());
  uploadedFiles.push(r.url);
  return r.url;
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

    // 8) Alıcı 5 yıldız veriyor, satıcı yanıtlıyor.
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
    assert.ok(r.channels.every((c) => c.configured === false));
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
      body: JSON.stringify({ businessInfo: 'Kendi bahçemde zeytin ve zeytinyağı üretiyorum.' }),
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
