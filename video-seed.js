// Tanıtım videosu için izole bir demo sunucusuna gerçekçi ürün/satıcı/yorum verisi
// eker — production data'ya hiç dokunmaz (ayrı KD_DATA_DIR ile PORT=8093'te çalışan
// sunucuya karşı çalışır).
const BASE = 'http://localhost:8093';
const ADMIN_PASSWORD = 'video-demo-pw';

let phoneSeq = 5100000;
function nextPhone() { phoneSeq += 1; return '5' + String(phoneSeq).padStart(9, '0').slice(0, 9); }

async function api(pathname, opts) {
  const r = await fetch(BASE + pathname, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  return r.json();
}

async function registerSeller(name) {
  const phone = nextPhone();
  const reg = await api('/api/auth/register-start', {
    method: 'POST',
    body: JSON.stringify({
      name, city: 'Manisa', district: 'Şehzadeler', password: 'test1234', role: 'satici', termsAccepted: true,
      businessInfo: 'Manisa\'da kendi bahçemde/işletmemde uzun yıllardır üretim yapıyorum.',
      taxId: '12345678901', iban: 'TR330006100519786457841326', sellerType: 'bireysel',
    }),
  });
  await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ phone }) });
  const ver = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: '0000', regToken: reg.regToken }) });
  return { phone, token: ver.token, user: ver.user };
}

async function registerBuyer(name) {
  const phone = nextPhone();
  const reg = await api('/api/auth/register-start', {
    method: 'POST',
    body: JSON.stringify({ name, city: 'İzmir', district: 'Konak', password: 'test1234', role: 'alici', termsAccepted: true }),
  });
  await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ phone }) });
  const ver = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code: '0000', regToken: reg.regToken }) });
  return { phone, token: ver.token, user: ver.user };
}

async function createProduct(sellerToken, p) {
  const r = await api('/api/admin/products', {
    method: 'POST', headers: { Authorization: 'Bearer ' + sellerToken },
    body: JSON.stringify({
      title: p.title, cat: p.cat, city: 'Manisa', price: p.price, unit: p.unit,
      delivery: ['kargo', 'pickup'], img: p.img, description: p.desc,
    }),
  });
  return r;
}

async function purchaseAndReview(buyerToken, sellerToken, slug, rating, text) {
  const order = await api('/api/product-orders', {
    method: 'POST', headers: { Authorization: 'Bearer ' + buyerToken },
    body: JSON.stringify({ productSlug: slug, quantity: 1, city: 'İzmir', district: 'Konak', termsAccepted: true }),
  });
  await api('/api/admin/product-orders/update', {
    method: 'POST', headers: { Authorization: 'Bearer ' + sellerToken },
    body: JSON.stringify({ id: order.id, status: 'completed', termsAccepted: true }),
  });
  await api('/api/reviews', {
    method: 'POST', headers: { Authorization: 'Bearer ' + buyerToken },
    body: JSON.stringify({ productSlug: slug, rating, text }),
  });
}

(async () => {
  const ownerToken = (await api('/api/owner/login', { method: 'POST', body: JSON.stringify({ password: ADMIN_PASSWORD }) })).token;

  const sellers = {};
  const sellerNames = ['Osman Çelik', 'Ayşe Güneş', 'Mustafa Demirel', 'Kemal Öztürk', 'Songül Aydın', 'İbrahim Şahin', 'Mehmet Arslan', 'Hasan Yıldız'];
  for (const name of sellerNames) {
    const s = await registerSeller(name);
    await api('/api/owner/sellers/approve', { method: 'POST', headers: { Authorization: 'Bearer ' + ownerToken }, body: JSON.stringify({ phone: s.phone, status: 'approved' }) });
    sellers[name] = s;
  }
  // İki satıcıya "Güvenilir Satıcı" rozeti
  for (const name of ['Osman Çelik', 'Ayşe Güneş']) {
    await api('/api/owner/sellers/badge', { method: 'POST', headers: { Authorization: 'Bearer ' + ownerToken }, body: JSON.stringify({ phone: sellers[name].phone, verified: true }) });
  }

  const catalog = [
    { seller: 'Osman Çelik', title: 'Erken Hasat Zeytinyağı', cat: 'Zeytinyağı', price: '420', unit: '/ litre', img: '3737656', desc: 'Kendi zeytinliğimizden, erken hasat, birinci soğuk sıkım, katkısız zeytinyağı.' },
    { seller: 'Ayşe Güneş', title: 'Mağarada Olgunlaşmış Tulum Peyniri', cat: 'Peynir', price: '350', unit: '/ kg', img: '6660248', desc: 'Koyun ve keçi sütünden, geleneksel yöntemle mağarada olgunlaştırılmış tulum peyniri.' },
    { seller: 'Mustafa Demirel', title: 'Yöresel Süzme Çiçek Balı', cat: 'Bal', price: '380', unit: '/ kg', img: '315420', desc: 'Kendi arılıklarımızdan süzülen, ısıtılmamış, katkısız çiçek balı.' },
    { seller: 'Kemal Öztürk', title: 'Taze Manisa Kirazı', cat: 'Kiraz', price: '220', unit: '/ kg', img: '3614942', desc: 'Haziran ayında dalından günlük toplanan, iri taneli Manisa kirazı.' },
    { seller: 'Songül Aydın', title: 'Ev Yapımı Karadut Reçeli', cat: 'Reçel', price: '150', unit: '/ kavanoz', img: '15209691', desc: 'Şeker oranı düşük tutularak geleneksel yöntemle kaynatılmış ev yapımı karadut reçeli.' },
    { seller: 'İbrahim Şahin', title: 'Bahçeden Taze Domates', cat: 'Sebze', price: '45', unit: '/ kg', img: '4022083', desc: 'Tarladan günlük toplanan, ilaçsız, doğal olgunlaşmış salkım domates.' },
    { seller: 'Mehmet Arslan', title: 'Naturel Kuru İncir', cat: 'İncir', price: '260', unit: '/ kg', img: '4499221', desc: 'Güneşte doğal kurutulmuş, kükürtsüz, geleneksel yöntemle kurutulmuş incir.' },
    { seller: 'Hasan Yıldız', title: 'Bağdan Taze Kara Üzüm', cat: 'Üzüm', price: '90', unit: '/ kg', img: '5455081', desc: 'Bağdan toplanan yöresel kara üzüm, ilaçsız, geleneksel bağcılık.' },
    { seller: 'Kemal Öztürk', title: 'Doğal Kuru Kayısı', cat: 'Kuru Meyve', price: '240', unit: '/ kg', img: '10111994', desc: 'Güneşte doğal kurutulmuş, kükürtsüz kuru kayısı.' },
  ];

  const products = {};
  for (const item of catalog) {
    const p = await createProduct(sellers[item.seller].token, item);
    products[item.title] = p;
    console.log('ürün oluşturuldu:', p.slug);
  }

  const buyerNames = ['Elif Korkmaz', 'Zehra Şahin', 'Fatma Yıldırım', 'Hüseyin Kaya'];
  const buyers = {};
  for (const name of buyerNames) buyers[name] = await registerBuyer(name);

  const reviews = [
    { title: 'Erken Hasat Zeytinyağı', buyer: 'Elif Korkmaz', rating: 5, text: 'Tam tarif edildiği gibi geldi, gerçekten soğuk sıkım ve tazeydi. Kesinlikle tekrar alırım.' },
    { title: 'Mağarada Olgunlaşmış Tulum Peyniri', buyer: 'Zehra Şahin', rating: 5, text: 'Lezzeti harika, tam kararında tuzlu ve olgun. Ailece çok beğendik.' },
    { title: 'Yöresel Süzme Çiçek Balı', buyer: 'Fatma Yıldırım', rating: 5, text: 'Kıvamı ve tadı gerçekten doğal, katkısız olduğu belli oluyor.' },
    { title: 'Taze Manisa Kirazı', buyer: 'Hüseyin Kaya', rating: 4, text: 'Tazeydi ve lezzetliydi, kargo biraz gecikti ama ürün gayet iyiydi.' },
    { title: 'Naturel Kuru İncir', buyer: 'Elif Korkmaz', rating: 5, text: 'Yumuşacık ve tatlı, tam istediğim gibi. Teşekkürler!' },
  ];
  for (const rv of reviews) {
    const p = products[rv.title];
    const sellerName = catalog.find((c) => c.title === rv.title).seller;
    await purchaseAndReview(buyers[rv.buyer].token, sellers[sellerName].token, p.slug, rv.rating, rv.text);
    console.log('yorum eklendi:', rv.title, rv.rating + '★');
  }

  const fs = require('fs');
  const seedOut = {
    sellerPhone: sellers['Osman Çelik'].phone,
    sellerToken: sellers['Osman Çelik'].token,
    sellerUser: Object.assign({}, sellers['Osman Çelik'].user, { sellerStatus: 'approved' }),
    buyerPhone: buyers['Elif Korkmaz'].phone,
    buyerToken: buyers['Elif Korkmaz'].token,
    buyerUser: buyers['Elif Korkmaz'].user,
    heroSlug: products['Erken Hasat Zeytinyağı'].slug,
  };
  fs.writeFileSync('/tmp/kd_video_seed_out.json', JSON.stringify(seedOut, null, 2));
  console.log('\nHazır, seed dosyası yazıldı: /tmp/kd_video_seed_out.json');
})().catch((e) => { console.error(e); process.exit(1); });
