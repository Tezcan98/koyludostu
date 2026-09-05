const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3010;
const ROOT = __dirname;
const BASE = path.join(ROOT, 'koyludostu-tumsite');
// Testler DATA_DIR'ı geçici bir klasöre yönlendirerek gerçek data/*.json dosyalarına
// hiç dokunmadan çalışır (bkz. tests/). Normal çalışmada davranış değişmez.
const DATA_DIR = process.env.KD_DATA_DIR || path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'agent-config.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');
const REVIEWS_PATH = path.join(DATA_DIR, 'reviews.json');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');
const COMPLAINTS_PATH = path.join(DATA_DIR, 'complaints.json');
const FAVORITES_PATH = path.join(DATA_DIR, 'favorites.json');
const POSTS_PATH = path.join(DATA_DIR, 'posts.json');
const SHIPMENTS_PATH = path.join(DATA_DIR, 'shipments.json');
const NOTIFICATIONS_PATH = path.join(DATA_DIR, 'notifications.json');
const PACKAGING_PATH = path.join(DATA_DIR, 'packaging.json');
const PACKAGING_ORDERS_PATH = path.join(DATA_DIR, 'packaging_orders.json');
const NOTIFICATION_SETTINGS_PATH = path.join(DATA_DIR, 'notification-settings.json');
const POST_TTL_MS = 24 * 60 * 60 * 1000;

const SITES = {
  blog: path.join(BASE, 'blog'),
  haber: path.join(BASE, 'haber'),
  sosyal: path.join(BASE, 'sosyal'),
};
const MAIN = path.join(BASE, 'main');

const DEFAULT_LOC = { lat: 38.3524, lon: 28.5137, city: 'Alaşehir', country: 'Türkiye' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ---------- static file serving ----------

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function productImgUrl(img, width) {
  if (/^\d+$/.test(String(img || ''))) {
    return `https://images.pexels.com/photos/${img}/pexels-photo-${img}.jpeg?auto=compress&cs=tinysrgb&w=${width || 700}`;
  }
  return img;
}

const CAT_SLUG = {
  'Asma Yaprağı': 'yaprak', Üzüm: 'uzum', Pekmez: 'pekmez', İncir: 'incir', Zeytin: 'zeytin',
  Zeytinyağı: 'zeytinyagi', Salça: 'salca', Tarhana: 'tarhana', Kiraz: 'kiraz', 'Kuru Meyve': 'kuru-meyve',
  Kuruyemiş: 'kuruyemis', Bal: 'bal', Peynir: 'peynir', Sebze: 'sebze', Meyve: 'meyve', Reçel: 'recel',
  Baklava: 'baklava',
};

// Kategoriye özel ürün özellikleri: hangi kategoride hangi ek alanların (ve
// olası değerlerinin) satıcı formunda görüneceğini ve filtre panelinde
// süzülebileceğini tanımlar. Yeni bir kategori özelliği eklemek için buraya
// bir satır eklemek yeterli — form ve filtre bu listeden otomatik türer.
const CATEGORY_ATTRS = {
  Zeytinyağı: [
    { key: 'sikim', label: 'Sıkım Türü', options: ['Soğuk Sıkım', 'Sıcak Sıkım'] },
    { key: 'filtre', label: 'Filtreleme', options: ['Filtreli', 'Filtresiz'] },
  ],
  Üzüm: [
    { key: 'cekirdek', label: 'Çekirdek', options: ['Çekirdekli', 'Çekirdeksiz'] },
  ],
  Bal: [
    { key: 'baltur', label: 'Bal Türü', options: ['Çiçek Balı', 'Çam Balı', 'Kestane Balı', 'Ayçiçek Balı'] },
    { key: 'islenis', label: 'İşleniş', options: ['Süzme', 'Petekli'] },
  ],
  Peynir: [
    { key: 'peynirtur', label: 'Peynir Türü', options: ['Beyaz Peynir', 'Tulum', 'Kaşar', 'Lor', 'Ezine Tulum'] },
    { key: 'yagorani', label: 'Yağ Oranı', options: ['Tam Yağlı', 'Yarım Yağlı', 'Light'] },
  ],
  Zeytin: [
    { key: 'renk', label: 'Zeytin Rengi', options: ['Yeşil Zeytin', 'Siyah Zeytin'] },
    { key: 'islenis', label: 'İşleniş', options: ['Salamura', 'Sele', 'Kırma'] },
  ],
  Salça: [
    { key: 'salcatur', label: 'Salça Türü', options: ['Domates Salçası', 'Biber Salçası'] },
    { key: 'acilik', label: 'Acılık', options: ['Acı', 'Tatlı'] },
  ],
  Kuruyemiş: [
    { key: 'kavrulma', label: 'Kavrulma', options: ['Çiğ', 'Kavrulmuş'] },
    { key: 'tuz', label: 'Tuz', options: ['Tuzlu', 'Tuzsuz'] },
  ],
  Pekmez: [
    { key: 'anamadde', label: 'Ana Madde', options: ['Üzüm Pekmezi', 'Dut Pekmezi', 'Keçiboynuzu Pekmezi'] },
  ],
  Baklava: [
    { key: 'ictur', label: 'İç Malzeme', options: ['Fıstıklı', 'Cevizli', 'Kaymaklı'] },
  ],
};

function cleanAttrs(cat, rawAttrs) {
  const schema = CATEGORY_ATTRS[cat];
  if (!schema || !rawAttrs || typeof rawAttrs !== 'object') return {};
  const out = {};
  for (const field of schema) {
    const v = rawAttrs[field.key];
    if (v && field.options.includes(v)) out[field.key] = v;
  }
  return out;
}

function esc(s) {
  return String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

// Satıcının /admin-urunlerim.html üzerinden eklediği, statik bir HTML dosyası
// bulunmayan ürünler için sunucu tarafında üretilen ürün sayfası. Mevcut 25 ürünün
// statik dosyaları öncelikli kalır (bkz. aşağıdaki yönlendirme), bu sadece yeni
// ilanlar için bir "eksiksiz çalışsın" alt yapısıdır.
function renderProductPage(product, allProducts) {
  const sellerLookup = findUserById(product.sellerId);
  const sellerVerified = !!(sellerLookup && sellerLookup.user.verifiedSeller);
  const catSlug = CAT_SLUG[product.cat];
  const catLink = catSlug ? `<a href="../kategori/${catSlug}.html">${esc(product.cat)}</a>` : esc(product.cat);
  const related = Object.values(allProducts)
    .filter((p) => p.slug !== product.slug && p.cat === product.cat)[0];
  const relatedHtml = related ? `<div class="related"><h3>Benzer Ürünler</h3><div class="related-grid"><a href="${related.slug}.html"><img src="${esc(productImgUrl(related.img))}" alt="${esc(related.title)}"><div class="rt-title">${esc(related.title)}</div></a></div></div>` : '';
  const unitWord = esc(product.unit).replace(/^\/\s*/, '');
  const qtyLine = product.minQty && product.maxQty
    ? `<div class="qty-range">Tedarik miktarı: ${product.minQty} ${unitWord} – ${product.maxQty} ${unitWord}</div>` : '';
  const storageLine = product.storageConditions
    ? `<div class="storage-box"><b>Saklama Koşulları:</b> ${esc(product.storageConditions)}</div>` : '';
  const stockLine = product.stock === null || product.stock === undefined
    ? ''
    : product.stock > 0
      ? `<div class="stock-badge in-stock">Stokta: ${product.stock} ${unitWord}</div>`
      : `<div class="stock-badge out-stock">Stok tükendi</div>`;
  const isActive = product.active !== false;
  const inactiveLine = isActive ? '' : `<div class="stock-badge out-stock">Şu an satışta değil</div>`;
  const organicLine = !product.organic ? '' : product.organicApproved
    ? `<div class="organic-badge verified">🌱 Organik</div>`
    : `<div class="organic-badge pending">🌱 Organik (Onay Bekliyor)</div>`;
  const certLine = product.certificateUrl
    ? `<a class="cert-link" href="${esc(product.certificateUrl)}" target="_blank">📄 Sertifikayı Görüntüle</a>` : '';
  const attrSchema = CATEGORY_ATTRS[product.cat] || [];
  const attrPairs = attrSchema
    .filter((f) => product.attrs && product.attrs[f.key])
    .map((f) => `${esc(f.label)}: ${esc(product.attrs[f.key])}`);
  const attrsLine = attrPairs.length ? `<div class="qty-range">${attrPairs.join(' · ')}</div>` : '';
  const perishableLine = product.perishable
    ? `<div class="perishable-badge">❄️ Çabuk bozulur — kargoda gecikme riskine dikkat</div>` : '';
  const weightLine = product.weightKg
    ? `<div class="qty-range">Birim ağırlık: ~${product.weightKg} kg</div>` : '';
  const galleryPhotos = [product.img].concat(Array.isArray(product.images) ? product.images : []);
  const thumbsHtml = galleryPhotos.length > 1
    ? `<div class="product-thumbs">${galleryPhotos.map((src) => `<img src="${esc(productImgUrl(src, 150))}" alt="" onclick="document.getElementById('mainProductImg').src=this.src.replace('w=150','w=900')">`).join('')}</div>`
    : '';
  const footerCtas = isActive
    ? `<button class="fav-cta" data-id="${esc(product.slug)}">🤍</button>
      <button class="msg-cta" data-slug="${esc(product.slug)}" data-title="${esc(product.title)}">💬 Satıcıya Mesaj Yaz</button>`
    : `<button class="fav-cta" data-id="${esc(product.slug)}">🤍</button>`;

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#4E6B3A">
<link rel="apple-touch-icon" href="/assets/logo-icon.jpg">
<title>${esc(product.title)} — ${esc(product.sellerName)} | Köylü Dostu</title>
<meta name="description" content="${esc(product.title)}: ${esc(product.description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/style.css">
</head>
<body>
<div class="topbar">
  <button class="hamburger-btn" onclick="document.getElementById('kdDrawer').classList.add('open');document.getElementById('kdOverlay').classList.add('open');" aria-label="Menü">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
  </button>
  <a href="/index.html" class="avatar-ring">
    <div class="avatar"><img src="/assets/logo-icon.jpg" alt="Köylü Dostu" style="width:92%;height:92%;object-fit:contain;"></div>
  </a>
  <a href="/index.html" class="brand-info" style="text-decoration:none;">
    <h1>köylüdostu</h1>
    <p>Tarladan şehre güvenli alışveriş</p>
  </a>
  <div id="authSlot"></div>
</div>
<div class="drawer-overlay" id="kdOverlay" onclick="document.getElementById('kdDrawer').classList.remove('open');this.classList.remove('open');"></div>
<div class="drawer" id="kdDrawer">
  <div class="drawer-head">
    <div class="avatar-ring" style="width:40px;height:40px;">
      <div class="avatar"><img src="/assets/logo-icon.jpg" alt="Köylü Dostu" style="width:92%;height:92%;object-fit:contain;"></div>
    </div>
    <div class="brand-info"><h1>köylüdostu</h1></div>
    <button class="drawer-close" onclick="document.getElementById('kdDrawer').classList.remove('open');document.getElementById('kdOverlay').classList.remove('open');" aria-label="Kapat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
  <nav class="drawer-nav">
    <a href="/index.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>Anasayfa</a>
    <a href="/vitrin.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>Vitrin</a>
    <div class="drawer-section-label">Hesabım</div>
    <a href="/favorilerim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>Favori İlanlarım</a>
    <a href="/favori-saticilarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>Favori Satıcılarım</a>
    <a href="/mesajlarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Mesajlar</a>
    <a href="/yorumlarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>Yorumlarım</a>
    <a href="/hesap-ayarlarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>Hesap Ayarları</a>
    <div class="drawer-section-label">Diğer</div>
    <a href="/hakkimizda.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>Hakkımızda</a>
    <a href="/gizlilik.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>Gizlilik</a>
    <a href="/kullanim-sartlari.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h6"/></svg>Kullanım Şartları</a>
    <a href="/kvkk.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>KVKK Aydınlatma Metni</a>
  </nav>
</div>
<div class="breadcrumb"><a href="../index.html">Köylü Dostu</a><span>›</span>${catLink}<span>›</span>${esc(product.title)}</div><div class="product-page">
  <div class="product-grid">
    <div class="product-photo-col">
      <img id="mainProductImg" src="${esc(productImgUrl(product.img))}" alt="${esc(product.title)}">
      ${thumbsHtml}
    </div>
    <div class="product-info">
      <div class="product-cat">${esc(product.cat)}</div>
      <h1>${esc(product.title)}</h1>
      <div class="producer-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
        <div>
          <div class="producer-name"><a href="../satici/${esc(product.sellerId)}.html">${esc(product.sellerName)}</a>${sellerVerified ? ' <span class="seller-badge" title="Güvenilir Satıcı">🛡️</span>' : ''}</div>
          <div class="producer-loc">${esc(product.city)}</div>
        </div>
      </div>
      <button class="fav-seller-cta" data-id="${esc(product.sellerId)}">☆ Satıcıyı Takip Et</button>
      <p class="product-desc">${esc(product.description)}</p>
      ${organicLine}
      ${inactiveLine}
      ${stockLine}
      ${perishableLine}
      ${attrsLine}
      ${weightLine}
      ${qtyLine}
      ${storageLine}
      ${certLine}
      <div class="product-footer">
        <div class="product-price">${esc(product.price)} <small>${esc(product.unit)}</small></div>
        ${footerCtas}
</div>
    </div>
  </div>

  <div class="reviews-section" data-slug="${esc(product.slug)}" data-title="${esc(product.title)}">
    <h3>Değerlendirmeler</h3>
    <div id="avgRating" class="avg-rating"></div>
    <div id="reviewFormWrap"></div>
    <div id="reviewList"></div>
  </div>
${relatedHtml}</div><footer class="site-footer">
  <b>Köylü Dostu</b> · Üreticilerden doğrudan alışveriş
</footer>

<script src="../assets/auth.js"></script>
<script src="../assets/messages.js"></script>
<script src="../assets/reviews.js"></script>
<script src="../assets/favorites.js"></script>
<script src="../assets/protect.js"></script>
<script>if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}</script>
</body>
</html>
`;
}

// Satıcı profil sayfası: /satici/<id>.html — ürün sayfasındaki satıcı adına tıklayınca açılır.
function renderSellerPage(seller, sellerId, products) {
  const own = Object.values(products).filter((p) => p.sellerId === sellerId && p.active !== false);
  const reviewsStore = readJson(REVIEWS_PATH, {});
  const ownSlugs = new Set(own.map((p) => p.slug));
  let sum = 0, count = 0;
  Object.keys(reviewsStore).forEach((slug) => {
    if (!ownSlugs.has(slug)) return;
    (reviewsStore[slug] || []).forEach((r) => {
      if (r.status === 'pending' || r.status === 'rejected') return;
      sum += r.rating; count++;
    });
  });
  const avg = count ? (sum / count).toFixed(1) : null;
  const badge = seller.verifiedSeller ? '<span class="seller-badge" title="Güvenilir Satıcı">🛡️</span>' : '';
  const ratingLine = avg
    ? `<div class="seller-rating">★ ${avg} / 5 <span>· ${count} değerlendirme</span></div>`
    : `<div class="seller-rating"><span>Henüz değerlendirme yok</span></div>`;
  const businessLine = seller.businessInfo
    ? `<p class="seller-bio">${esc(seller.businessInfo)}</p>` : '';
  const joinDate = new Date(seller.createdAt).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long' });

  const gridHtml = own.length
    ? own.map((p) => {
        const imgSrc = esc(productImgUrl(p.img));
        return `<a class="pin" href="../urun/${p.slug}.html">
  <img src="${imgSrc}" alt="${esc(p.title)}" loading="lazy">
  <div class="pin-overlay">
    <div class="pin-cat">${esc(p.cat)}</div>
    <div class="pin-title">${esc(p.title)}</div>
    <div class="pin-foot"><div class="pin-price">${esc(p.price)}<br><small>${esc(p.unit)}</small></div>
    <button type="button" class="fav-cta pin-fav" data-id="${esc(p.slug)}">🤍</button></div>
  </div>
</a>`;
      }).join('')
    : '<div class="seller-empty">Bu satıcının şu an satışta ürünü yok.</div>';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#4E6B3A">
<link rel="apple-touch-icon" href="/assets/logo-icon.jpg">
<title>${esc(seller.name)} — Köylü Dostu</title>
<meta name="description" content="${esc(seller.name)}: ${esc(seller.city || '')} · Köylü Dostu satıcı profili.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/style.css">
</head>
<body>
<div class="topbar">
  <button class="hamburger-btn" onclick="document.getElementById('kdDrawer').classList.add('open');document.getElementById('kdOverlay').classList.add('open');" aria-label="Menü">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
  </button>
  <a href="/index.html" class="avatar-ring">
    <div class="avatar"><img src="/assets/logo-icon.jpg" alt="Köylü Dostu" style="width:92%;height:92%;object-fit:contain;"></div>
  </a>
  <a href="/index.html" class="brand-info" style="text-decoration:none;">
    <h1>köylüdostu</h1>
    <p>Satıcı Profili</p>
  </a>
  <div id="authSlot"></div>
</div>
<div class="drawer-overlay" id="kdOverlay" onclick="document.getElementById('kdDrawer').classList.remove('open');this.classList.remove('open');"></div>
<div class="drawer" id="kdDrawer">
  <div class="drawer-head">
    <div class="avatar-ring" style="width:40px;height:40px;">
      <div class="avatar"><img src="/assets/logo-icon.jpg" alt="Köylü Dostu" style="width:92%;height:92%;object-fit:contain;"></div>
    </div>
    <div class="brand-info"><h1>köylüdostu</h1></div>
    <button class="drawer-close" onclick="document.getElementById('kdDrawer').classList.remove('open');document.getElementById('kdOverlay').classList.remove('open');" aria-label="Kapat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
  <nav class="drawer-nav">
    <a href="/index.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>Anasayfa</a>
    <a href="/vitrin.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-14 9V3z"/></svg>Vitrin</a>
    <div class="drawer-section-label">Hesabım</div>
    <a href="/favorilerim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>Favori İlanlarım</a>
    <a href="/favori-saticilarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>Favori Satıcılarım</a>
    <a href="/mesajlarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Mesajlar</a>
    <a href="/yorumlarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>Yorumlarım</a>
    <a href="/hesap-ayarlarim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>Hesap Ayarları</a>
    <div class="drawer-section-label">Diğer</div>
    <a href="/hakkimizda.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>Hakkımızda</a>
    <a href="/gizlilik.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>Gizlilik</a>
    <a href="/kullanim-sartlari.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h6"/></svg>Kullanım Şartları</a>
    <a href="/kvkk.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M9 12l2 2 4-4"/></svg>KVKK Aydınlatma Metni</a>
  </nav>
</div>
<div class="breadcrumb"><a href="../index.html">Köylü Dostu</a><span>›</span>${esc(seller.name)}</div>
<div class="seller-page">
  <div class="seller-hero">
    <div class="seller-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>
    <div>
      <h1>${esc(seller.name)} ${badge}</h1>
      <div class="seller-loc">${esc(seller.city || '')}${seller.district ? ' · ' + esc(seller.district) : ''}</div>
      ${ratingLine}
      <div class="seller-since">Köylü Dostu'nda ${esc(joinDate)}'den beri</div>
    </div>
  </div>
  ${businessLine}
  <button class="fav-seller-cta" data-id="${esc(sellerId)}">☆ Satıcıyı Takip Et</button>

  <h2 class="seller-products-title">Ürünleri (${own.length})</h2>
  <div class="grid">${gridHtml}</div>
</div>
<footer class="site-footer">
  <b>Köylü Dostu</b> · Üreticilerden doğrudan alışveriş
</footer>

<script src="../assets/auth.js"></script>
<script src="../assets/favorites.js"></script>
<script src="../assets/protect.js"></script>
<script>if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}</script>
</body>
</html>
`;
}

function serveStatic(res, root, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.join(root, rel);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + rel);
      return;
    }
    sendFile(res, stats.isDirectory() ? path.join(filePath, 'index.html') : filePath);
  });
}

// ---------- /api/piyasa : BIST/döviz/altın/emtia/kripto, 3 dk cache ----------
// Tek kaynak: Yahoo Finance'in herkese açık (kimliksiz) chart uç noktası.

const YF_SYMBOLS = {
  bist100: 'XU100.IS',
  usdtry: 'TRY=X',
  eurtry: 'EURTRY=X',
  gbptry: 'GBPTRY=X',
  onsaltin: 'GC=F',
  gumusons: 'SI=F',
  platin: 'PL=F',
  bakir: 'HG=F',
  petrol: 'CL=F',
  bitcoin: 'BTC-USD',
  ethereum: 'ETH-USD',
};

async function yfQuote(symbol) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const json = await r.json();
  const meta = json.chart.result[0].meta;
  return { price: meta.regularMarketPrice, changePct: meta.regularMarketChangePercent || 0 };
}

let piyasaCache = { data: null, at: 0 };
const PIYASA_TTL = 3 * 60 * 1000;
const GOLD_COIN_MULTIPLIER = 1.623; // çeyrek altın ~ gram altın * (ağırlık + darphane farkı)

async function getPiyasa() {
  const now = Date.now();
  if (piyasaCache.data && now - piyasaCache.at < PIYASA_TTL) return piyasaCache.data;

  const entries = Object.entries(YF_SYMBOLS);
  const results = await Promise.all(entries.map(([, sym]) => yfQuote(sym)));
  const q = {};
  entries.forEach(([key], i) => { q[key] = results[i]; });

  const gramaltin = (q.onsaltin.price / 31.1034768) * q.usdtry.price;
  const gumusgram = (q.gumusons.price / 31.1034768) * q.usdtry.price;
  const bitcointry = q.bitcoin.price * q.usdtry.price;

  const data = {
    bist100: { value: round(q.bist100.price, 2), changePct: round(q.bist100.changePct, 2), unit: 'puan' },
    usdtry: { value: round(q.usdtry.price, 4), changePct: round(q.usdtry.changePct, 2), unit: '₺' },
    eurtry: { value: round(q.eurtry.price, 4), changePct: round(q.eurtry.changePct, 2), unit: '₺' },
    gbptry: { value: round(q.gbptry.price, 4), changePct: round(q.gbptry.changePct, 2), unit: '₺' },
    gramaltin: { value: round(gramaltin, 2), changePct: round(q.onsaltin.changePct, 2), unit: '₺' },
    ceyrekaltin: { value: round(gramaltin * GOLD_COIN_MULTIPLIER, 2), changePct: round(q.onsaltin.changePct, 2), unit: '₺' },
    onsaltin: { value: round(q.onsaltin.price, 2), changePct: round(q.onsaltin.changePct, 2), unit: '$' },
    gumus: { value: round(gumusgram, 2), changePct: round(q.gumusons.changePct, 2), unit: '₺' },
    platin: { value: round(q.platin.price, 2), changePct: round(q.platin.changePct, 2), unit: '$' },
    bakir: { value: round(q.bakir.price, 3), changePct: round(q.bakir.changePct, 2), unit: '$' },
    petrol: { value: round(q.petrol.price, 2), changePct: round(q.petrol.changePct, 2), unit: '$' },
    bitcoin: { value: round(bitcointry, 0), changePct: round(q.bitcoin.changePct, 2), unit: '₺' },
    ethereum: { value: round(q.ethereum.price, 2), changePct: round(q.ethereum.changePct, 2), unit: '$' },
    updatedAt: new Date().toISOString(),
  };

  piyasaCache = { data, at: now };
  return data;
}

function round(n, d) {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

// ---------- /api/namaz : IP'den şehir bulup namaz vakti (Diyanet metodu) ----------

const geoCache = new Map();
const GEO_TTL = 12 * 60 * 60 * 1000;
const namazCache = new Map();
const NAMAZ_TTL = 6 * 60 * 60 * 1000;

function isPrivateIp(ip) {
  if (!ip) return true;
  const v = ip.replace('::ffff:', '');
  return (
    v === '::1' || v === '127.0.0.1' || v.startsWith('10.') ||
    v.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(v) ||
    v.startsWith('fc') || v.startsWith('fe80')
  );
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress;
}

async function geoLocate(ip) {
  if (isPrivateIp(ip)) return DEFAULT_LOC;

  const hit = geoCache.get(ip);
  const now = Date.now();
  if (hit && now - hit.at < GEO_TTL) return hit.data;

  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,city,country,lat,lon`);
    const json = await r.json();
    if (json.status !== 'success') return DEFAULT_LOC;
    const data = { lat: json.lat, lon: json.lon, city: json.city, country: json.country };
    geoCache.set(ip, { data, at: now });
    return data;
  } catch {
    return DEFAULT_LOC;
  }
}

async function getNamazTimings(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const now = Date.now();
  const hit = namazCache.get(key);
  if (hit && now - hit.at < NAMAZ_TTL) return hit.data;

  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dateStr = `${dd}-${mm}-${d.getFullYear()}`;

  const r = await fetch(
    `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lon}&method=13`
  );
  const json = await r.json();
  const data = {
    timings: json.data.timings,
    date: json.data.date.readable,
    timezone: json.data.meta.timezone,
  };
  namazCache.set(key, { data, at: now });
  return data;
}

async function getNamazForRequest(req) {
  const ip = clientIp(req);
  const loc = await geoLocate(ip);
  const timings = await getNamazTimings(loc.lat, loc.lon);
  return { city: loc.city, country: loc.country, ...timings };
}

// ---------- /api/hava : IP'den şehir bulup güncel hava durumu ----------

const WMO_ICON = {
  0: ['☀️', 'Açık'], 1: ['🌤️', 'Az Bulutlu'], 2: ['⛅', 'Parçalı Bulutlu'], 3: ['☁️', 'Kapalı'],
  45: ['🌫️', 'Sisli'], 48: ['🌫️', 'Sisli'],
  51: ['🌦️', 'Çisenti'], 53: ['🌦️', 'Çisenti'], 55: ['🌦️', 'Çisenti'],
  61: ['🌧️', 'Yağmurlu'], 63: ['🌧️', 'Yağmurlu'], 65: ['🌧️', 'Yağmurlu'],
  71: ['🌨️', 'Karlı'], 73: ['🌨️', 'Karlı'], 75: ['🌨️', 'Karlı'],
  80: ['🌧️', 'Sağanak'], 81: ['🌧️', 'Sağanak'], 82: ['⛈️', 'Sağanak'],
  95: ['⛈️', 'Fırtınalı'], 96: ['⛈️', 'Fırtınalı'], 99: ['⛈️', 'Fırtınalı'],
};

const havaCache = new Map();
const HAVA_TTL = 30 * 60 * 1000;

async function getHava(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const now = Date.now();
  const hit = havaCache.get(key);
  if (hit && now - hit.at < HAVA_TTL) return hit.data;

  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
  );
  const json = await r.json();
  const code = json.current.weather_code;
  const [icon, label] = WMO_ICON[code] || ['🌡️', 'Bilinmiyor'];
  const data = { tempC: Math.round(json.current.temperature_2m), icon, label };
  havaCache.set(key, { data, at: now });
  return data;
}

async function getHavaForRequest(req) {
  const ip = clientIp(req);
  const loc = await geoLocate(ip);
  const hava = await getHava(loc.lat, loc.lon);
  return { city: loc.city, ...hava };
}

// ---------- /api/admin/config : ajan ayarları (kaynak linkler, yasaklı kelimeler) ----------

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { sources: [], bannedWords: [], dedupeEnabled: true, healthAgent: { enabled: true, persona: '' }, globalAgent: { enabled: true, persona: '' }, blogAgent: { enabled: true, persona: '', topics: {} } };
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---------- basit JSON dosya deposu (users / sessions / messages) ----------

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  // 05xxxxxxxxx -> 5xxxxxxxxx (10 hane) formatına indir
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('90')) return digits.slice(2);
  return digits;
}

function randomToken() {
  return [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = crypto.scryptSync(password, salt, 64);
  return hashBuf.length === testBuf.length && crypto.timingSafeEqual(hashBuf, testBuf);
}

// ---------- /api/auth : önce üyelik bilgileri (ad+şehir+parola), sonra telefon SMS onayı ----------
// Akış (yeni üye): 1) register-start (ad, şehir, parola, rol) -> regToken
//                  2) request-code (telefon) -> SMS kodu (şimdilik hep 0000)
//                  3) verify (telefon, kod, regToken) -> hesap oluşturulur, oturum açılır
// Akış (dönen üye): login (telefon + parola) -> doğrudan oturum açılır, SMS gerekmez.

const pendingCodes = new Map(); // phone -> { code, at }
const pendingRegs = new Map(); // regToken -> { name, city, passwordHash, role, at }
const CODE_TTL = 5 * 60 * 1000;
const REGISTER_TTL = 15 * 60 * 1000;
const DEV_CODE = '0000';
const VALID_ROLES = ['alici', 'satici'];

function findUserById(id) {
  const users = readJson(USERS_PATH, {});
  for (const phone of Object.keys(users)) {
    if (users[phone].id === id) return { phone, user: users[phone] };
  }
  return null;
}

// Ürün nesneleri satıcı bilgisini (ad/telefon) o an kaydedildiği haliyle taşır ama "rozetli
// satıcı" durumu sonradan değişebildiği için canlı users.json'dan katılır — id -> boolean.
function sellerVerifiedMap() {
  const users = readJson(USERS_PATH, {});
  const map = {};
  Object.values(users).forEach((u) => { if (u.role === 'satici') map[u.id] = !!u.verifiedSeller; });
  return map;
}

function withSellerBadge(product, verifiedMap) {
  return Object.assign({}, product, { sellerVerified: !!verifiedMap[product.sellerId] });
}

function getSession(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const sessions = readJson(SESSIONS_PATH, {});
  const s = sessions[token];
  if (!s) return null;
  const users = readJson(USERS_PATH, {});
  const user = users[s.phone];
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return { token, phone: s.phone, user: safeUser };
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    jsonResponse(res, 401, { error: 'Giriş gerekli' });
    return null;
  }
  return session;
}

function requireRole(req, res, role) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.user.role !== role) {
    jsonResponse(res, 403, { error: 'Bu işlem için yetkiniz yok' });
    return null;
  }
  return session;
}

// Ürün yayınlamak — satıcı hesabının admin onayından geçmiş olmasını gerektirir
// (bkz. satıcı başvurusu akışı). Diğer satıcı uçları (mesaj, kargo, ambalaj) bilerek
// buraya bağlı değil: onaysız bir satıcının zaten ürünü olmadığı için o ekranlar boş kalır.
function requireApprovedSeller(req, res) {
  const session = requireRole(req, res, 'satici');
  if (!session) return null;
  if (session.user.sellerStatus !== 'approved') {
    jsonResponse(res, 403, { error: 'Satıcı başvurun henüz onaylanmadı. Başvuru durumunu /satici-basvurum.html üzerinden takip edebilirsin.' });
    return null;
  }
  return session;
}

function createSession(phone) {
  const token = randomToken();
  const sessions = readJson(SESSIONS_PATH, {});
  sessions[token] = { phone, createdAt: new Date().toISOString() };
  writeJson(SESSIONS_PATH, sessions);
  return token;
}

// ---------- Bildirimler: yeni mesaj/yorum geldiğinde kullanıcı tercihine göre SMS/e-posta ----------
// NOT: Gerçek bir SMS/e-posta sağlayıcısı (Twilio, SendGrid vb.) bağlı değil — bu geliştirme
// ortamında "gönderilmiş gibi" konsola yazılıp bir kayıt (outbox) olarak saklanır. Gerçek
// gönderim için ileride bir sağlayıcı API anahtarı eklenmesi gerekir.
// ---------- Bildirim kanalları: SMS ve E-posta ayrı sınıflar olarak modellenir ----------
// Her ikisi de aynı arayüzü (formatTarget + send) uygular. Gerçek bir sağlayıcı (Netgsm,
// Twilio, SendGrid, Postmark vb.) bağlanacağı zaman sadece ilgili sınıfın send() metodunun
// içi değişir — notifyUser(), owner uçları ve tercih sistemi olduğu gibi kalır.

class NotificationChannel {
  constructor(key, label) {
    this.key = key;
    this.label = label;
  }
  // Gerçek bir sağlayıcı bağlanınca bu true dönecek şekilde güncellenir.
  isConfigured() {
    return false;
  }
  formatTarget(_user) {
    throw new Error(this.key + ' formatTarget uygulanmadı');
  }
  async send(_target, _message) {
    throw new Error(this.key + ' send uygulanmadı');
  }
}

class SmsChannel extends NotificationChannel {
  constructor() { super('sms', 'SMS'); }
  formatTarget(user) { return '+90' + user.phone; }
  async send(target, message) {
    // DEV: gerçek bir SMS sağlayıcısı henüz bağlı değil, gönderim konsola simüle edilir.
    console.log(`[SMS-DEV] ${target}: ${message}`);
    return { ok: true, simulated: true };
  }
}

class EmailChannel extends NotificationChannel {
  constructor() { super('email', 'E-posta'); }
  formatTarget(user) { return user.email || null; }
  async send(target, message) {
    // DEV: gerçek bir e-posta sağlayıcısı henüz bağlı değil, gönderim konsola simüle edilir.
    console.log(`[EMAIL-DEV] ${target}: ${message}`);
    return { ok: true, simulated: true };
  }
}

const NOTIFICATION_CHANNELS = {
  sms: new SmsChannel(),
  email: new EmailChannel(),
};

function readNotificationSettings() {
  return readJson(NOTIFICATION_SETTINGS_PATH, { smsEnabled: true, emailEnabled: true });
}

function notifyUser(phone, event, message) {
  const users = readJson(USERS_PATH, {});
  const user = users[phone];
  if (!user) return;
  const prefs = user.notifyPrefs || {};
  const settings = readNotificationSettings();
  const log = readJson(NOTIFICATIONS_PATH, {});

  Object.values(NOTIFICATION_CHANNELS).forEach((channel) => {
    const userWantsIt = channel.key === 'sms' ? !!prefs.sms : !!prefs.email;
    const globallyEnabled = channel.key === 'sms' ? settings.smsEnabled !== false : settings.emailEnabled !== false;
    if (!userWantsIt || !globallyEnabled) return;
    const target = channel.formatTarget(user);
    if (!target) return;
    channel.send(target, message).catch(() => {});
    const id = 'n_' + randomToken().slice(0, 10);
    log[id] = { id, phone, channel: channel.key, event, message, target, at: new Date().toISOString() };
  });
  writeJson(NOTIFICATIONS_PATH, log);
}

// ---------- Platform yönetici paneli: telefon hesaplarından bağımsız, tek parolalı erişim ----------
// Gerçek e-Devlet/kimlik doğrulaması eklenemediği için (bkz. run.sh), site sahibinin
// tüm ürün/kullanıcı/şikayet/post verilerini görebildiği ayrı bir "owner" oturumu.
// Geliştirme parolası: env ADMIN_PASSWORD, verilmezse aşağıdaki varsayılan kullanılır.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'koylu-admin-2026';
const adminTokens = new Map(); // token -> { at }
const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000;

function requireAdmin(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const entry = token && adminTokens.get(token);
  if (!entry || Date.now() - entry.at > ADMIN_SESSION_TTL) {
    jsonResponse(res, 401, { error: 'Yönetici girişi gerekli' });
    return false;
  }
  return true;
}

function slugify(text) {
  const trMap = { ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' };
  let s = String(text || '').split('').map((ch) => trMap[ch] || ch).join('');
  s = s.toLocaleLowerCase('en').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'urun';
}

// Ürün görseli ya bizim /api/admin/upload-image ile ürettiğimiz bir dosya yolu,
// ya da (demo ürünleri için) saf sayısal bir Pexels foto id'si olmalı. Başka hiçbir
// şey kabul edilmez — aksi halde ürün sayfasında saklı XSS'e açık bir alan olurdu.
function isValidProductImg(img) {
  return /^\d+$/.test(img) || /^\/assets\/uploads\/[A-Za-z0-9_.-]+$/.test(img);
}

// Organik belgesi / sertifika gibi bizim ürettiğimiz dosyalar için aynı kısıtlama —
// Pexels foto id'sine burada gerek yok, sadece bizim /api/admin/upload-doc çıktısı kabul edilir.
function isValidUploadedFile(url) {
  return /^\/assets\/uploads\/[A-Za-z0-9_.-]+$/.test(String(url || ''));
}

function uniqueSlug(base, products) {
  let slug = base;
  let n = 2;
  while (products[slug]) {
    slug = base + '-' + n;
    n++;
  }
  return slug;
}

// ---------- /api/messages : ürün bazlı alıcı-satıcı sohbeti ----------
// Not: Sitede üreticilerin kendi hesabı yok; "satıcı" tarafı şimdilik platform
// (Köylü Dostu) tarafından, hangi üretici/ürünle ilgili olduğu etiketlenerek karşılanıyor.

function conversationId(phone, productSlug) {
  return `${phone}__${productSlug}`;
}

// ---------- basit hız sınırlama (toplu scraping'e karşı caydırıcı) ----------
// Not: Gerçek bir bot/CAPTCHA koruması değildir; tek IP'den kısa sürede gelen
// anormal sayıda isteği keser. Yerel (loopback) istekler test/geliştirme
// amaçlı muaf tutulur.

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 300;
const rateLimitMap = new Map();

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isRateLimited(ip) {
  if (isLoopback(ip)) return false;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  const clientIp = req.socket.remoteAddress || '';
  if (isRateLimited(clientIp)) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Çok fazla istek gönderildi, lütfen biraz sonra tekrar dene.' }));
    return;
  }

  try {
    if (p === '/api/piyasa') {
      return jsonResponse(res, 200, await getPiyasa());
    }

    if (p === '/api/namaz') {
      return jsonResponse(res, 200, await getNamazForRequest(req));
    }

    if (p === '/api/hava') {
      return jsonResponse(res, 200, await getHavaForRequest(req));
    }

    if (p === '/api/admin/config' && req.method === 'GET') {
      return jsonResponse(res, 200, readConfig());
    }

    if (p === '/api/admin/sources' && req.method === 'POST') {
      const { url: srcUrl, region } = await readBody(req);
      if (!srcUrl || !/^https?:\/\//i.test(srcUrl)) return jsonResponse(res, 400, { error: 'Geçerli bir URL girin' });
      const cfg = readConfig();
      if (!cfg.sources.some((s) => s.url === srcUrl)) {
        cfg.sources.push({ url: srcUrl, region: region === 'global' ? 'global' : 'yerel', addedAt: new Date().toISOString() });
        writeConfig(cfg);
      }
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/sources' && req.method === 'DELETE') {
      const srcUrl = url.searchParams.get('url');
      const cfg = readConfig();
      cfg.sources = cfg.sources.filter((s) => s.url !== srcUrl);
      writeConfig(cfg);
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/banned-words' && req.method === 'POST') {
      const { word } = await readBody(req);
      const w = (word || '').trim().toLocaleLowerCase('tr');
      if (!w) return jsonResponse(res, 400, { error: 'Kelime boş olamaz' });
      const cfg = readConfig();
      if (!cfg.bannedWords.includes(w)) {
        cfg.bannedWords.push(w);
        writeConfig(cfg);
      }
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/banned-words' && req.method === 'DELETE') {
      const w = (url.searchParams.get('word') || '').trim().toLocaleLowerCase('tr');
      const cfg = readConfig();
      cfg.bannedWords = cfg.bannedWords.filter((x) => x !== w);
      writeConfig(cfg);
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/dedupe' && req.method === 'POST') {
      const { enabled } = await readBody(req);
      const cfg = readConfig();
      cfg.dedupeEnabled = !!enabled;
      writeConfig(cfg);
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/health-agent' && req.method === 'POST') {
      const { persona, enabled } = await readBody(req);
      const cfg = readConfig();
      cfg.healthAgent = cfg.healthAgent || {};
      if (typeof persona === 'string') cfg.healthAgent.persona = persona;
      if (typeof enabled === 'boolean') cfg.healthAgent.enabled = enabled;
      writeConfig(cfg);
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/global-agent' && req.method === 'POST') {
      const { persona, enabled } = await readBody(req);
      const cfg = readConfig();
      cfg.globalAgent = cfg.globalAgent || {};
      if (typeof persona === 'string') cfg.globalAgent.persona = persona;
      if (typeof enabled === 'boolean') cfg.globalAgent.enabled = enabled;
      writeConfig(cfg);
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/blog-agent' && req.method === 'POST') {
      const { persona, enabled, topics } = await readBody(req);
      const cfg = readConfig();
      cfg.blogAgent = cfg.blogAgent || { topics: {} };
      if (typeof persona === 'string') cfg.blogAgent.persona = persona;
      if (typeof enabled === 'boolean') cfg.blogAgent.enabled = enabled;
      if (topics && typeof topics === 'object') {
        cfg.blogAgent.topics = Object.assign({}, cfg.blogAgent.topics, topics);
      }
      writeConfig(cfg);
      return jsonResponse(res, 200, cfg);
    }

    if (p === '/api/admin/news-topics' && req.method === 'POST') {
      const { topics } = await readBody(req);
      const cfg = readConfig();
      if (topics && typeof topics === 'object') {
        cfg.newsTopics = Object.assign({}, cfg.newsTopics, topics);
      }
      writeConfig(cfg);
      return jsonResponse(res, 200, cfg);
    }

    // ---------- Auth: önce üyelik bilgileri (ad+şehir+parola), sonra telefon SMS onayı ----------

    if (p === '/api/auth/register-start' && req.method === 'POST') {
      const { name, city, district, neighborhood, password, role, termsAccepted, businessInfo } = await readBody(req);
      const cleanName = String(name || '').trim().slice(0, 60);
      const cleanCity = String(city || '').trim().slice(0, 60);
      const cleanDistrict = String(district || '').trim().slice(0, 60);
      const cleanNeighborhood = String(neighborhood || '').trim().slice(0, 80);
      const pass = String(password || '');
      if (cleanName.length < 2) return jsonResponse(res, 400, { error: 'Lütfen adını gir.' });
      if (cleanCity.length < 2) return jsonResponse(res, 400, { error: 'Lütfen şehrini gir.' });
      if (cleanDistrict.length < 2) return jsonResponse(res, 400, { error: 'Lütfen ilçeni gir.' });
      if (pass.length < 4) return jsonResponse(res, 400, { error: 'Parola en az 4 karakter olmalı.' });
      if (!VALID_ROLES.includes(role)) return jsonResponse(res, 400, { error: 'Hesap türünü seç.' });
      if (!termsAccepted) return jsonResponse(res, 400, { error: 'Devam etmek için şartnameyi kabul etmelisin.' });

      const cleanBusinessInfo = String(businessInfo || '').trim().slice(0, 500);
      if (role === 'satici' && cleanBusinessInfo.length < 10) {
        return jsonResponse(res, 400, { error: 'Satıcı başvurusu için ne/nasıl üretim yaptığını en az birkaç cümleyle anlat.' });
      }

      const regToken = randomToken();
      pendingRegs.set(regToken, {
        name: cleanName, city: cleanCity, district: cleanDistrict, neighborhood: cleanNeighborhood,
        passwordHash: hashPassword(pass), role,
        businessInfo: cleanBusinessInfo,
        termsAcceptedAt: new Date().toISOString(), at: Date.now(),
      });
      return jsonResponse(res, 200, { regToken });
    }

    if (p === '/api/auth/request-code' && req.method === 'POST') {
      const { phone } = await readBody(req);
      const norm = normalizePhone(phone);
      if (norm.length !== 10) return jsonResponse(res, 400, { error: 'Geçerli bir telefon numarası girin (5XX XXX XX XX)' });
      pendingCodes.set(norm, { code: DEV_CODE, at: Date.now() });
      // NOT: Gerçek SMS entegrasyonu yok; geliştirme aşamasında kod her zaman 0000.
      console.log(`[SMS-DEV] +90${norm} için onay kodu: ${DEV_CODE}`);
      return jsonResponse(res, 200, { ok: true, dev: true, hint: 'Geliştirme modunda onay kodu her zaman 0000.' });
    }

    if (p === '/api/auth/verify' && req.method === 'POST') {
      const { phone, code, regToken } = await readBody(req);
      const norm = normalizePhone(phone);
      const pendingCode = pendingCodes.get(norm);
      const now = Date.now();
      const codeOk = pendingCode && pendingCode.code === String(code).trim() && now - pendingCode.at < CODE_TTL;
      if (!codeOk) return jsonResponse(res, 400, { error: 'Kod hatalı veya süresi doldu' });
      pendingCodes.delete(norm);

      const users = readJson(USERS_PATH, {});
      if (users[norm]) {
        return jsonResponse(res, 400, { error: 'Bu telefon numarası zaten kayıtlı. Giriş Yap sekmesinden devam et.' });
      }

      const pendingReg = pendingRegs.get(regToken);
      if (!pendingReg || now - pendingReg.at > REGISTER_TTL) {
        return jsonResponse(res, 400, { error: 'Kayıt bilgilerinin süresi doldu. Lütfen baştan başla.' });
      }

      users[norm] = {
        id: 'u_' + randomToken().slice(0, 10), phone: norm,
        name: pendingReg.name, city: pendingReg.city, district: pendingReg.district,
        neighborhood: pendingReg.neighborhood || '', passwordHash: pendingReg.passwordHash, role: pendingReg.role,
        termsAcceptedAt: pendingReg.termsAcceptedAt,
        createdAt: new Date().toISOString(),
        // Satıcı hesapları admin onayından geçmeden ürün ekleyemez (bkz. requireApprovedSeller).
        ...(pendingReg.role === 'satici'
          ? { sellerStatus: 'pending', businessInfo: pendingReg.businessInfo || '', sellerDocUrl: null, verifiedSeller: false }
          : {}),
      };
      writeJson(USERS_PATH, users);
      pendingRegs.delete(regToken);

      const token = createSession(norm);
      const { passwordHash, ...safeUser } = users[norm];
      return jsonResponse(res, 200, { token, user: safeUser, isNew: true });
    }

    if (p === '/api/auth/login' && req.method === 'POST') {
      const { phone, password } = await readBody(req);
      const norm = normalizePhone(phone);
      const users = readJson(USERS_PATH, {});
      const user = users[norm];
      if (!user) return jsonResponse(res, 404, { error: 'Bu numara kayıtlı değil. Önce üye ol.' });
      if (!verifyPassword(String(password || ''), user.passwordHash)) {
        return jsonResponse(res, 401, { error: 'Telefon veya parola hatalı.' });
      }
      const token = createSession(norm);
      const { passwordHash, ...safeUser } = user;
      return jsonResponse(res, 200, { token, user: safeUser });
    }

    if (p === '/api/auth/me' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return jsonResponse(res, 200, { user: null });
      return jsonResponse(res, 200, { user: session.user });
    }

    if (p === '/api/auth/logout' && req.method === 'POST') {
      const session = getSession(req);
      if (session) {
        const sessions = readJson(SESSIONS_PATH, {});
        delete sessions[session.token];
        writeJson(SESSIONS_PATH, sessions);
      }
      return jsonResponse(res, 200, { ok: true });
    }

    // ---------- Mesajlaşma: alıcı <-> satıcı (ürün bazlı) ----------

    if (p === '/api/messages/send' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { productSlug, productTitle, text } = await readBody(req);
      const clean = String(text || '').trim().slice(0, 2000);
      if (!clean || !productSlug) return jsonResponse(res, 400, { error: 'Mesaj ve ürün bilgisi gerekli' });

      const store = readJson(MESSAGES_PATH, { conversations: {} });
      const cid = conversationId(session.phone, productSlug);
      if (!store.conversations[cid]) {
        store.conversations[cid] = {
          id: cid, buyerPhone: session.phone, productSlug,
          productTitle: productTitle || productSlug, messages: [],
          updatedAt: new Date().toISOString(),
        };
      }
      store.conversations[cid].messages.push({ from: 'buyer', text: clean, at: new Date().toISOString() });
      store.conversations[cid].updatedAt = new Date().toISOString();
      writeJson(MESSAGES_PATH, store);

      const product = readJson(PRODUCTS_PATH, {})[productSlug];
      if (product) {
        notifyUser(product.sellerPhone, 'new_message',
          `"${product.title}" hakkında yeni bir mesajın var: "${clean.slice(0, 80)}"`);
      }

      return jsonResponse(res, 200, store.conversations[cid]);
    }

    if (p === '/api/messages/conversations' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      const store = readJson(MESSAGES_PATH, { conversations: {} });
      const mine = Object.values(store.conversations)
        .filter((c) => c.buyerPhone === session.phone)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return jsonResponse(res, 200, { conversations: mine });
    }

    if (p === '/api/messages/thread' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      const productSlug = url.searchParams.get('productSlug');
      const store = readJson(MESSAGES_PATH, { conversations: {} });
      const cid = conversationId(session.phone, productSlug);
      return jsonResponse(res, 200, store.conversations[cid] || { id: cid, messages: [] });
    }

    // ---------- Satıcı tarafı: kendi ürünlerinin sohbetleri + yanıt (satıcı hesabı girişi gerekir) ----------
    // Her ürün data/products.json içinde tek bir sellerId'ye bağlı; bir satıcı sadece
    // kendi ürünleriyle ilgili sohbetleri görür ve yanıtlayabilir.

    if (p === '/api/admin/messages' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const products = readJson(PRODUCTS_PATH, {});
      const store = readJson(MESSAGES_PATH, { conversations: {} });
      const mine = Object.values(store.conversations)
        .filter((c) => products[c.productSlug] && products[c.productSlug].sellerId === session.user.id)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return jsonResponse(res, 200, { conversations: mine });
    }

    if (p === '/api/admin/messages/reply' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { conversationId: cid, text } = await readBody(req);
      const clean = String(text || '').trim().slice(0, 2000);
      if (!clean || !cid) return jsonResponse(res, 400, { error: 'Mesaj ve sohbet id gerekli' });
      const store = readJson(MESSAGES_PATH, { conversations: {} });
      const convo = store.conversations[cid];
      if (!convo) return jsonResponse(res, 404, { error: 'Sohbet bulunamadı' });
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[convo.productSlug];
      if (!product || product.sellerId !== session.user.id) {
        return jsonResponse(res, 403, { error: 'Bu sohbet senin ürününle ilgili değil.' });
      }
      convo.messages.push({ from: 'seller', text: clean, at: new Date().toISOString() });
      convo.updatedAt = new Date().toISOString();
      writeJson(MESSAGES_PATH, store);
      return jsonResponse(res, 200, convo);
    }

    // ---------- Değerlendirmeler: yalnızca giriş yapmış gerçek hesaplar yorum yazabilir ----------

    if (p === '/api/reviews' && req.method === 'GET') {
      const slug = url.searchParams.get('product');
      if (!slug) return jsonResponse(res, 400, { error: 'Ürün belirtilmedi' });
      const session = getSession(req);
      const store = readJson(REVIEWS_PATH, {});
      const list = (store[slug] || [])
        .filter((rv) => (rv.status !== 'pending' && rv.status !== 'rejected') || (session && rv.userId === session.user.id))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { reviews: list });
    }

    // Sıralama algoritması için: tüm ürünlerin puan ortalaması + yorum sayısı (bkz. main/assets/filter.js)
    // Sadece onaylı yorumlar sayılır — onay bekleyen bir yorum henüz halka açık değildir.
    if (p === '/api/reviews/stats' && req.method === 'GET') {
      const store = readJson(REVIEWS_PATH, {});
      const stats = {};
      for (const slug of Object.keys(store)) {
        const list = (store[slug] || []).filter((rv) => rv.status !== 'pending' && rv.status !== 'rejected');
        if (!list.length) continue;
        const avg = list.reduce((sum, r) => sum + r.rating, 0) / list.length;
        stats[slug] = { avg, count: list.length };
      }
      return jsonResponse(res, 200, stats);
    }

    // Yorum onay kuralı: 4-5 yıldız (olumlu) doğrudan yayınlanır; 1-3 yıldız admin onayına düşer.
    if (p === '/api/reviews' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { productSlug, rating, text } = await readBody(req);
      const r = Number(rating);
      const clean = String(text || '').trim().slice(0, 1000);
      if (!productSlug || !r || r < 1 || r > 5 || !clean) {
        return jsonResponse(res, 400, { error: 'Ürün, puan (1-5) ve yorum metni gerekli' });
      }
      const store = readJson(REVIEWS_PATH, {});
      store[productSlug] = store[productSlug] || [];
      const status = r >= 4 ? 'approved' : 'pending';
      const mine = store[productSlug].find((rv) => rv.userId === session.user.id);
      if (mine) {
        mine.rating = r; mine.text = clean; mine.createdAt = new Date().toISOString(); mine.status = status;
        mine.sellerReply = null;
      } else {
        store[productSlug].push({
          id: 'r_' + randomToken().slice(0, 10), userId: session.user.id, name: session.user.name,
          role: session.user.role, rating: r, text: clean, createdAt: new Date().toISOString(),
          status, sellerReply: null,
        });
      }
      writeJson(REVIEWS_PATH, store);

      const product = readJson(PRODUCTS_PATH, {})[productSlug];
      if (product) {
        notifyUser(product.sellerPhone, 'new_review', status === 'approved'
          ? `"${product.title}" için yeni bir yorum aldın (${r}/5).`
          : `"${product.title}" için yeni bir yorum aldın (${r}/5) — admin onayı bekliyor.`);
      }

      return jsonResponse(res, 200, { reviews: store[productSlug] });
    }

    // Satıcının kendi ürününe gelen onaylı bir yoruma yanıt yazması.
    if (p === '/api/admin/reviews/reply' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { productSlug, reviewId, text } = await readBody(req);
      const clean = String(text || '').trim().slice(0, 500);
      if (!clean) return jsonResponse(res, 400, { error: 'Yanıt metni gerekli.' });
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[productSlug];
      if (!product || product.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      const store = readJson(REVIEWS_PATH, {});
      const review = (store[productSlug] || []).find((rv) => rv.id === reviewId);
      if (!review) return jsonResponse(res, 404, { error: 'Yorum bulunamadı' });
      if (review.status !== 'approved') return jsonResponse(res, 400, { error: 'Sadece onaylı yorumlara yanıt yazılabilir.' });
      review.sellerReply = { text: clean, at: new Date().toISOString() };
      writeJson(REVIEWS_PATH, store);
      return jsonResponse(res, 200, review);
    }

    // ---------- Şikayetler: mesajlaşarak verilen sipariş kaliteli çıkmazsa alıcı şikayet açabilir ----------

    const COMPLAINT_REASONS = ['kalite', 'gelmedi', 'farkli', 'diger'];

    if (p === '/api/complaints' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { productSlug, reason, text } = await readBody(req);
      const clean = String(text || '').trim().slice(0, 1000);
      if (!productSlug || !COMPLAINT_REASONS.includes(reason) || !clean) {
        return jsonResponse(res, 400, { error: 'Ürün, şikayet nedeni ve açıklama gerekli' });
      }
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[productSlug];
      if (!product) return jsonResponse(res, 400, { error: 'Ürün bulunamadı' });

      const complaints = readJson(COMPLAINTS_PATH, {});
      const id = 'c_' + randomToken().slice(0, 10);
      complaints[id] = {
        id, productSlug, productTitle: product.title,
        buyerId: session.user.id, buyerName: session.user.name,
        sellerId: product.sellerId, sellerName: product.sellerName,
        reason, text: clean, status: 'open',
        sellerResponse: '', createdAt: new Date().toISOString(), resolvedAt: null,
      };
      writeJson(COMPLAINTS_PATH, complaints);
      return jsonResponse(res, 200, complaints[id]);
    }

    if (p === '/api/complaints/mine' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      const complaints = readJson(COMPLAINTS_PATH, {});
      const mine = Object.values(complaints)
        .filter((c) => c.buyerId === session.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { complaints: mine });
    }

    if (p === '/api/admin/complaints' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const complaints = readJson(COMPLAINTS_PATH, {});
      const mine = Object.values(complaints)
        .filter((c) => c.sellerId === session.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { complaints: mine });
    }

    if (p === '/api/admin/complaints/resolve' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { id, response } = await readBody(req);
      const complaints = readJson(COMPLAINTS_PATH, {});
      const c = complaints[id];
      if (!c || c.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Şikayet bulunamadı' });
      c.status = 'resolved';
      c.sellerResponse = String(response || '').trim().slice(0, 1000);
      c.resolvedAt = new Date().toISOString();
      writeJson(COMPLAINTS_PATH, complaints);
      return jsonResponse(res, 200, c);
    }

    // ---------- Profil: ad/şehir güncelleme + parola değiştirme ----------

    if (p === '/api/auth/update-profile' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { name, city, district, neighborhood, email } = await readBody(req);
      const cleanName = String(name || '').trim().slice(0, 60);
      const cleanCity = String(city || '').trim().slice(0, 60);
      if (cleanName.length < 2) return jsonResponse(res, 400, { error: 'Lütfen adını gir.' });
      if (cleanCity.length < 2) return jsonResponse(res, 400, { error: 'Lütfen şehrini gir.' });
      if (district !== undefined && String(district).trim().length < 2) {
        return jsonResponse(res, 400, { error: 'Lütfen ilçeni gir.' });
      }
      if (email !== undefined) {
        const cleanEmail = String(email || '').trim().slice(0, 120);
        if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          return jsonResponse(res, 400, { error: 'Geçerli bir e-posta adresi gir.' });
        }
      }
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      user.name = cleanName;
      user.city = cleanCity;
      if (district !== undefined) user.district = String(district).trim().slice(0, 60);
      if (neighborhood !== undefined) user.neighborhood = String(neighborhood).trim().slice(0, 80);
      if (email !== undefined) user.email = String(email || '').trim().slice(0, 120);
      writeJson(USERS_PATH, users);
      const { passwordHash, ...safeUser } = user;
      return jsonResponse(res, 200, { user: safeUser });
    }

    // Bildirim tercihleri: yeni mesaj/yorum geldiğinde SMS ve/veya e-posta almak isteyip
    // istemediğini kullanıcı burada seçer (bkz. notifyUser).
    if (p === '/api/auth/notify-prefs' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { sms, email } = await readBody(req);
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      user.notifyPrefs = { sms: !!sms, email: !!email };
      writeJson(USERS_PATH, users);
      const { passwordHash, ...safeUser } = user;
      return jsonResponse(res, 200, { user: safeUser });
    }

    // Satıcı başvurusuna destekleyici belge (kimlik, vergi levhası, çiftçi kayıt belgesi vb.) ekleme.
    // Onay durumunu değiştirmez — sadece admin'in inceleyeceği belgeyi ekler.
    if (p === '/api/auth/seller-application/doc' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { docUrl } = await readBody(req);
      const clean = String(docUrl || '').trim();
      if (!isValidUploadedFile(clean)) return jsonResponse(res, 400, { error: 'Geçersiz belge. Önce /api/admin/upload-doc ile yükle.' });
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      user.sellerDocUrl = clean;
      writeJson(USERS_PATH, users);
      const { passwordHash, ...safeUser } = user;
      return jsonResponse(res, 200, { user: safeUser });
    }

    if (p === '/api/auth/change-password' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { currentPassword, newPassword } = await readBody(req);
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      if (!verifyPassword(String(currentPassword || ''), user.passwordHash)) {
        return jsonResponse(res, 401, { error: 'Mevcut parola hatalı.' });
      }
      const next = String(newPassword || '');
      if (next.length < 4) return jsonResponse(res, 400, { error: 'Yeni parola en az 4 karakter olmalı.' });
      user.passwordHash = hashPassword(next);
      writeJson(USERS_PATH, users);
      return jsonResponse(res, 200, { ok: true });
    }

    // ---------- Yorumlarım: bir kullanıcının tüm ürünlerdeki değerlendirmeleri ----------

    if (p === '/api/reviews/mine' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      const store = readJson(REVIEWS_PATH, {});
      const products = readJson(PRODUCTS_PATH, {});
      const mine = [];
      for (const slug of Object.keys(store)) {
        const found = (store[slug] || []).find((rv) => rv.userId === session.user.id);
        if (found) mine.push(Object.assign({ productSlug: slug, productTitle: (products[slug] || {}).title || slug }, found));
      }
      mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { reviews: mine });
    }

    // ---------- Favoriler: favori ilanlar + favori satıcılar ----------

    if (p === '/api/favorites/toggle' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { type, id } = await readBody(req);
      if (type !== 'product' && type !== 'seller') return jsonResponse(res, 400, { error: 'Geçersiz favori türü' });
      const key = type === 'product' ? 'products' : 'sellers';
      const store = readJson(FAVORITES_PATH, {});
      store[session.user.id] = store[session.user.id] || { products: [], sellers: [] };
      const list = store[session.user.id][key];
      const idx = list.indexOf(id);
      let active;
      if (idx === -1) { list.push(id); active = true; } else { list.splice(idx, 1); active = false; }
      writeJson(FAVORITES_PATH, store);
      return jsonResponse(res, 200, { active });
    }

    if (p === '/api/favorites/mine' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      const store = readJson(FAVORITES_PATH, {});
      const mine = store[session.user.id] || { products: [], sellers: [] };
      const products = readJson(PRODUCTS_PATH, {});
      const favProducts = mine.products
        .map((slug) => products[slug])
        .filter(Boolean);
      const favSellers = mine.sellers
        .map((id) => {
          const found = findUserById(id);
          if (!found) return null;
          return { id, name: found.user.name, city: found.user.city, verified: !!found.user.verifiedSeller };
        })
        .filter(Boolean);
      return jsonResponse(res, 200, { products: favProducts, sellers: favSellers });
    }

    // ---------- Postlar: story baloncukları — son 24 saatte paylaşılan veya satıcının reklam olarak işaretlediği ----------

    if (p === '/api/admin/products/mine' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const products = readJson(PRODUCTS_PATH, {});
      const mine = Object.values(products).filter((prod) => prod.sellerId === session.user.id);
      return jsonResponse(res, 200, { products: mine });
    }

    // ---------- Satıcı: kendi ürünlerine yapılan yorumları görüntüleme ----------

    if (p === '/api/admin/reviews/mine' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const products = readJson(PRODUCTS_PATH, {});
      const mySlugs = new Set(
        Object.values(products).filter((prod) => prod.sellerId === session.user.id).map((prod) => prod.slug)
      );
      const store = readJson(REVIEWS_PATH, {});
      const out = [];
      for (const slug of Object.keys(store)) {
        if (!mySlugs.has(slug)) continue;
        const title = (products[slug] || {}).title || slug;
        for (const rv of store[slug] || []) {
          out.push(Object.assign({ productSlug: slug, productTitle: title }, rv));
        }
      }
      out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { reviews: out });
    }

    // ---------- Kargo Takip: satıcı parayı doğrudan alıyor, kargolama için platforma başvuruyor ----------
    // Ödeme havuzu yok — bu sadece satıcının "bu ürünü şu alıcıya kargolamam lazım" talebini
    // platforma bildirdiği ve durumunu (kargoya verildi / yolda / teslim edildi) takip ettiği bir ekran.

    const SHIPMENT_STATUSES = ['requested', 'shipped', 'in_transit', 'delivered', 'cancelled'];

    if (p === '/api/admin/shipments' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const body = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[body.productSlug];
      if (!product || product.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      const buyerName = String(body.buyerName || '').trim().slice(0, 80);
      const buyerPhone = normalizePhone(body.buyerPhone);
      const address = String(body.address || '').trim().slice(0, 400);
      const note = String(body.note || '').trim().slice(0, 300);
      if (!buyerName) return jsonResponse(res, 400, { error: 'Alıcı adı gerekli.' });
      if (buyerPhone.length !== 10) return jsonResponse(res, 400, { error: 'Geçerli bir alıcı telefonu gir.' });
      if (!address) return jsonResponse(res, 400, { error: 'Teslimat adresi gerekli.' });

      const quantity = Math.max(1, Math.floor(Number(body.quantity)) || 1);
      // Ürünün kilosu ve bozulabilirliği kargo/otobüs firmasıyla anlaşmak için gerekli —
      // ürün sonradan değişse de bu kargo talebindeki değer sabit kalsın diye burada "donduruyoruz".
      const totalWeightKg = product.weightKg ? Math.round(product.weightKg * quantity * 100) / 100 : null;

      const store = readJson(SHIPMENTS_PATH, {});
      const id = 'sh_' + randomToken().slice(0, 10);
      store[id] = {
        id, productSlug: product.slug, productTitle: product.title,
        sellerId: session.user.id, sellerName: session.user.name, sellerPhone: session.phone,
        buyerName, buyerPhone, address, note,
        quantity, totalWeightKg, perishable: !!product.perishable,
        status: 'requested', trackingNo: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      writeJson(SHIPMENTS_PATH, store);
      return jsonResponse(res, 200, store[id]);
    }

    if (p === '/api/admin/shipments/mine' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const store = readJson(SHIPMENTS_PATH, {});
      const mine = Object.values(store)
        .filter((s) => s.sellerId === session.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { shipments: mine });
    }

    if (p === '/api/owner/shipments' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const store = readJson(SHIPMENTS_PATH, {});
      const all = Object.values(store).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { shipments: all });
    }

    if (p === '/api/owner/shipments/update' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { id, status, trackingNo } = await readBody(req);
      const store = readJson(SHIPMENTS_PATH, {});
      const shipment = store[id];
      if (!shipment) return jsonResponse(res, 404, { error: 'Kargo talebi bulunamadı' });
      if (status !== undefined) {
        if (!SHIPMENT_STATUSES.includes(status)) return jsonResponse(res, 400, { error: 'Geçersiz durum.' });
        shipment.status = status;
      }
      if (trackingNo !== undefined) shipment.trackingNo = String(trackingNo || '').trim().slice(0, 60) || null;
      shipment.updatedAt = new Date().toISOString();
      writeJson(SHIPMENTS_PATH, store);

      const STATUS_LABELS = {
        requested: 'Talep alındı', shipped: 'Kargoya verildi', in_transit: 'Yolda',
        delivered: 'Teslim edildi', cancelled: 'İptal edildi',
      };
      notifyUser(shipment.sellerPhone, 'shipment_update',
        `"${shipment.productTitle}" kargo talebinin durumu güncellendi: ${STATUS_LABELS[shipment.status]}.`);

      return jsonResponse(res, 200, shipment);
    }

    // ---------- Ambalaj: admin satıcılara ambalaj malzemesi (kutu, kavanoz, streç vb.) satar ----------
    // Ödeme burada da havuzdan geçmiyor — satıcı talep açar, admin fiyat/miktarı görüp
    // teslimatı/faturayı kendisi (dışarıda) düzenler. Katalog admin'in, talepler satıcının.

    const PACKAGING_ORDER_STATUSES = ['requested', 'confirmed', 'delivered', 'cancelled'];

    if (p === '/api/packaging' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const store = readJson(PACKAGING_PATH, {});
      const active = Object.values(store).filter((item) => item.active !== false);
      return jsonResponse(res, 200, { items: active });
    }

    if (p === '/api/owner/packaging' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const store = readJson(PACKAGING_PATH, {});
      return jsonResponse(res, 200, { items: Object.values(store) });
    }

    if (p === '/api/owner/packaging' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 80);
      const description = String(body.description || '').trim().slice(0, 300);
      const priceNum = Number(body.price);
      const unit = String(body.unit || '').trim().slice(0, 20);
      if (name.length < 2) return jsonResponse(res, 400, { error: 'Ambalaj adı gerekli.' });
      if (!priceNum || priceNum <= 0) return jsonResponse(res, 400, { error: 'Geçerli bir fiyat gir.' });
      if (!unit) return jsonResponse(res, 400, { error: 'Birim gerekli (ör. / adet).' });

      const store = readJson(PACKAGING_PATH, {});
      const id = 'pk_' + randomToken().slice(0, 10);
      store[id] = { id, name, description, price: priceNum + '₺', unit, active: true, createdAt: new Date().toISOString() };
      writeJson(PACKAGING_PATH, store);
      return jsonResponse(res, 200, store[id]);
    }

    if (p === '/api/owner/packaging/update' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const store = readJson(PACKAGING_PATH, {});
      const item = store[body.id];
      if (!item) return jsonResponse(res, 404, { error: 'Ambalaj bulunamadı' });
      if (body.name) item.name = String(body.name).trim().slice(0, 80);
      if (typeof body.description === 'string') item.description = body.description.trim().slice(0, 300);
      if (body.price) item.price = Number(body.price) + '₺';
      if (body.unit) item.unit = String(body.unit).trim().slice(0, 20);
      if (typeof body.active === 'boolean') item.active = body.active;
      writeJson(PACKAGING_PATH, store);
      return jsonResponse(res, 200, item);
    }

    if (p === '/api/owner/packaging/delete' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { id } = await readBody(req);
      const store = readJson(PACKAGING_PATH, {});
      if (!store[id]) return jsonResponse(res, 404, { error: 'Ambalaj bulunamadı' });
      delete store[id];
      writeJson(PACKAGING_PATH, store);
      return jsonResponse(res, 200, { ok: true });
    }

    if (p === '/api/admin/packaging/order' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { itemId, quantity, note } = await readBody(req);
      const catalog = readJson(PACKAGING_PATH, {});
      const item = catalog[itemId];
      if (!item || item.active === false) return jsonResponse(res, 404, { error: 'Ambalaj bulunamadı' });
      const qty = Math.max(1, Math.floor(Number(quantity)) || 1);

      const store = readJson(PACKAGING_ORDERS_PATH, {});
      const id = 'po_' + randomToken().slice(0, 10);
      store[id] = {
        id, itemId, itemName: item.name, itemPrice: item.price, itemUnit: item.unit,
        quantity: qty, note: String(note || '').trim().slice(0, 300),
        sellerId: session.user.id, sellerName: session.user.name, sellerPhone: session.phone,
        status: 'requested', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      writeJson(PACKAGING_ORDERS_PATH, store);
      return jsonResponse(res, 200, store[id]);
    }

    if (p === '/api/admin/packaging/orders/mine' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const store = readJson(PACKAGING_ORDERS_PATH, {});
      const mine = Object.values(store)
        .filter((o) => o.sellerId === session.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { orders: mine });
    }

    if (p === '/api/owner/packaging/orders' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const store = readJson(PACKAGING_ORDERS_PATH, {});
      const all = Object.values(store).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { orders: all });
    }

    if (p === '/api/owner/packaging/orders/update' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { id, status } = await readBody(req);
      if (!PACKAGING_ORDER_STATUSES.includes(status)) return jsonResponse(res, 400, { error: 'Geçersiz durum.' });
      const store = readJson(PACKAGING_ORDERS_PATH, {});
      const order = store[id];
      if (!order) return jsonResponse(res, 404, { error: 'Talep bulunamadı' });
      order.status = status;
      order.updatedAt = new Date().toISOString();
      writeJson(PACKAGING_ORDERS_PATH, store);

      const STATUS_LABELS = { requested: 'Talep alındı', confirmed: 'Onaylandı', delivered: 'Teslim edildi', cancelled: 'İptal edildi' };
      notifyUser(order.sellerPhone, 'packaging_order_update',
        `"${order.itemName}" ambalaj talebinin durumu güncellendi: ${STATUS_LABELS[order.status]}.`);

      return jsonResponse(res, 200, order);
    }

    if (p === '/api/posts' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { productSlug, caption, isAd } = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[productSlug];
      if (!product || product.sellerId !== session.user.id) {
        return jsonResponse(res, 400, { error: 'Sadece kendi ürünlerin için post paylaşabilirsin.' });
      }
      const clean = String(caption || '').trim().slice(0, 200);
      const posts = readJson(POSTS_PATH, {});
      const id = 'p_' + randomToken().slice(0, 10);
      const now = new Date();
      posts[id] = {
        id, productSlug, productTitle: product.title, img: product.img,
        sellerId: session.user.id, sellerName: session.user.name,
        caption: clean, isAd: !!isAd,
        createdAt: now.toISOString(),
        expiresAt: isAd ? null : new Date(now.getTime() + POST_TTL_MS).toISOString(),
      };
      writeJson(POSTS_PATH, posts);
      return jsonResponse(res, 200, posts[id]);
    }

    if (p === '/api/posts/active' && req.method === 'GET') {
      const posts = readJson(POSTS_PATH, {});
      const now = Date.now();
      const active = Object.values(posts)
        .filter((post) => post.isAd || new Date(post.expiresAt).getTime() > now)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { posts: active });
    }

    if (p === '/api/admin/posts/mine' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const posts = readJson(POSTS_PATH, {});
      const mine = Object.values(posts)
        .filter((post) => post.sellerId === session.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { posts: mine });
    }

    if (p === '/api/admin/posts/delete' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { id } = await readBody(req);
      const posts = readJson(POSTS_PATH, {});
      const post = posts[id];
      if (!post || post.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Post bulunamadı' });
      delete posts[id];
      writeJson(POSTS_PATH, posts);
      return jsonResponse(res, 200, { ok: true });
    }

    // ---------- Ürün fotoğrafı yükleme: base64 data URL -> statik dosya ----------

    if (p === '/api/admin/upload-image' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { dataUrl } = await readBody(req);
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(dataUrl || ''));
      if (!m) return jsonResponse(res, 400, { error: 'Geçersiz görsel. PNG, JPEG ya da WEBP yükle.' });
      const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 6 * 1024 * 1024) return jsonResponse(res, 400, { error: 'Görsel çok büyük (max 6MB).' });
      const uploadsDir = path.join(MAIN, 'assets', 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });
      const fname = 'u_' + randomToken().slice(0, 12) + '.' + (ext === 'jpeg' ? 'jpg' : ext);
      fs.writeFileSync(path.join(uploadsDir, fname), buf);
      return jsonResponse(res, 200, { url: '/assets/uploads/' + fname });
    }

    // Organik belgesi / sertifika yükleme: fotoğraftan farklı olarak PDF de kabul eder.
    if (p === '/api/admin/upload-doc' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { dataUrl } = await readBody(req);
      const m = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(String(dataUrl || ''));
      if (!m) return jsonResponse(res, 400, { error: 'Geçersiz dosya. PNG, JPEG, WEBP ya da PDF yükle.' });
      const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
      const ext = extMap[m[1]];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 8 * 1024 * 1024) return jsonResponse(res, 400, { error: 'Dosya çok büyük (max 8MB).' });
      const uploadsDir = path.join(MAIN, 'assets', 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });
      const fname = 'd_' + randomToken().slice(0, 12) + '.' + ext;
      fs.writeFileSync(path.join(uploadsDir, fname), buf);
      return jsonResponse(res, 200, { url: '/assets/uploads/' + fname });
    }

    // ---------- Ürünler: satıcılar kendi ilanlarını ekler/düzenler/kaldırır ----------

    if (p === '/api/products' && req.method === 'GET') {
      const products = readJson(PRODUCTS_PATH, {});
      const verifiedMap = sellerVerifiedMap();
      const list = Object.values(products).filter((prod) => prod.active !== false).map((prod) => withSellerBadge(prod, verifiedMap));
      return jsonResponse(res, 200, { products: list });
    }

    if (p === '/api/admin/products' && req.method === 'POST') {
      const session = requireApprovedSeller(req, res);
      if (!session) return;
      const body = await readBody(req);
      const title = String(body.title || '').trim().slice(0, 80);
      const cat = String(body.cat || '').trim().slice(0, 40);
      const city = String(body.city || '').trim().slice(0, 40);
      const priceNum = Number(body.price);
      const unit = String(body.unit || '').trim().slice(0, 20);
      const minQty = Number(body.minQty) || 1;
      const maxQty = Number(body.maxQty) || minQty;
      const storageConditions = String(body.storageConditions || '').trim().slice(0, 300);
      const description = String(body.description || '').trim().slice(0, 1000);
      const img = String(body.img || '').trim();
      const delivery = Array.isArray(body.delivery) ? body.delivery.filter((d) => ['pickup', 'bus', 'kargo'].includes(d)) : [];

      if (title.length < 2) return jsonResponse(res, 400, { error: 'Ürün başlığı gerekli.' });
      if (!cat) return jsonResponse(res, 400, { error: 'Kategori seç.' });
      if (city.length < 2) return jsonResponse(res, 400, { error: 'Şehir gerekli.' });
      if (!priceNum || priceNum <= 0) return jsonResponse(res, 400, { error: 'Geçerli bir fiyat gir.' });
      if (!unit) return jsonResponse(res, 400, { error: 'Ambalaj/birim gerekli (ör. / kg).' });
      if (!delivery.length) return jsonResponse(res, 400, { error: 'En az bir nakliye yöntemi seç.' });
      if (!img) return jsonResponse(res, 400, { error: 'Bir fotoğraf yükle.' });
      if (!isValidProductImg(img)) return jsonResponse(res, 400, { error: 'Geçersiz görsel. Önce /api/admin/upload-image ile yükle.' });

      let stock = null;
      if (body.stock !== undefined && body.stock !== null && body.stock !== '') {
        stock = Math.floor(Number(body.stock));
        if (!Number.isFinite(stock) || stock < 0) return jsonResponse(res, 400, { error: 'Geçerli bir stok miktarı gir.' });
      }

      const organic = !!body.organic;
      const organicDocUrl = organic ? String(body.organicDocUrl || '').trim() : '';
      if (organic && !isValidUploadedFile(organicDocUrl)) {
        return jsonResponse(res, 400, { error: 'Organik işaretlemek için önce bir organik belgesi yükle.' });
      }
      const certificateUrl = String(body.certificateUrl || '').trim();
      if (certificateUrl && !isValidUploadedFile(certificateUrl)) {
        return jsonResponse(res, 400, { error: 'Geçersiz sertifika dosyası.' });
      }
      const attrs = cleanAttrs(cat, body.attrs);

      let weightKg = null;
      if (body.weightKg !== undefined && body.weightKg !== null && body.weightKg !== '') {
        weightKg = Number(body.weightKg);
        if (!Number.isFinite(weightKg) || weightKg <= 0) return jsonResponse(res, 400, { error: 'Geçerli bir birim ağırlık gir (kg).' });
      }
      const perishable = !!body.perishable;

      // Kapak fotoğrafı (img) hâlâ zorunlu tek alan; ek fotoğraflar (images) opsiyonel bir
      // galeri oluşturur — her biri /api/admin/upload-image ile önceden yüklenmiş olmalı.
      const images = Array.isArray(body.images)
        ? body.images.map((u) => String(u || '').trim()).filter((u) => u && isValidProductImg(u)).slice(0, 5)
        : [];

      const products = readJson(PRODUCTS_PATH, {});
      const slug = uniqueSlug(slugify(title), products);
      products[slug] = {
        slug, title, cat, price: priceNum + '₺', unit, img, images, city, delivery,
        sellerId: session.user.id, sellerName: session.user.name, sellerPhone: session.phone,
        createdAt: new Date().toISOString(), description, minQty, maxQty, storageConditions, stock,
        active: true, attrs, weightKg, perishable,
        organic, organicDocUrl: organicDocUrl || null, organicApproved: false,
        certificateUrl: certificateUrl || null,
        // Yakında: yapay zeka ile otomatik fotoğraf düzenleme (bkz. /api/admin/products/ai-enhance-photos).
        // Şu an her zaman false — gerçek işleme bağlanınca bu alan güncellenmeye başlar.
        photosEnhanced: false,
      };
      writeJson(PRODUCTS_PATH, products);
      return jsonResponse(res, 200, products[slug]);
    }

    if (p === '/api/admin/products/update' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const body = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const prod = products[body.slug];
      if (!prod || prod.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });

      if (body.title) prod.title = String(body.title).trim().slice(0, 80);
      if (body.cat) prod.cat = String(body.cat).trim().slice(0, 40);
      if (body.city) prod.city = String(body.city).trim().slice(0, 40);
      if (body.price) prod.price = Number(body.price) + '₺';
      if (body.unit) prod.unit = String(body.unit).trim().slice(0, 20);
      if (body.minQty) prod.minQty = Number(body.minQty);
      if (body.maxQty) prod.maxQty = Number(body.maxQty);
      if (typeof body.storageConditions === 'string') prod.storageConditions = body.storageConditions.trim().slice(0, 300);
      if (typeof body.description === 'string') prod.description = body.description.trim().slice(0, 1000);
      if (body.stock !== undefined) {
        if (body.stock === null || body.stock === '') {
          prod.stock = null;
        } else {
          const stock = Math.floor(Number(body.stock));
          if (!Number.isFinite(stock) || stock < 0) return jsonResponse(res, 400, { error: 'Geçerli bir stok miktarı gir.' });
          prod.stock = stock;
        }
      }
      if (typeof body.active === 'boolean') prod.active = body.active;
      if (body.img) {
        const nextImg = String(body.img).trim();
        if (!isValidProductImg(nextImg)) return jsonResponse(res, 400, { error: 'Geçersiz görsel.' });
        prod.img = nextImg;
      }
      if (Array.isArray(body.images)) {
        prod.images = body.images.map((u) => String(u || '').trim()).filter((u) => u && isValidProductImg(u)).slice(0, 5);
      }
      if (Array.isArray(body.delivery)) prod.delivery = body.delivery.filter((d) => ['pickup', 'bus', 'kargo'].includes(d));
      if (body.attrs) prod.attrs = cleanAttrs(prod.cat, body.attrs);
      if (body.weightKg !== undefined) {
        if (body.weightKg === null || body.weightKg === '') {
          prod.weightKg = null;
        } else {
          const weightKg = Number(body.weightKg);
          if (!Number.isFinite(weightKg) || weightKg <= 0) return jsonResponse(res, 400, { error: 'Geçerli bir birim ağırlık gir (kg).' });
          prod.weightKg = weightKg;
        }
      }
      if (typeof body.perishable === 'boolean') prod.perishable = body.perishable;

      if (body.organic !== undefined) {
        const organic = !!body.organic;
        const organicDocUrl = organic ? String(body.organicDocUrl || prod.organicDocUrl || '').trim() : '';
        if (organic && !isValidUploadedFile(organicDocUrl)) {
          return jsonResponse(res, 400, { error: 'Organik işaretlemek için önce bir organik belgesi yükle.' });
        }
        prod.organic = organic;
        prod.organicDocUrl = organicDocUrl || null;
        prod.organicApproved = false; // belge/iddia her değiştiğinde admin onayı yeniden gerekir
      }
      if (body.certificateUrl !== undefined) {
        const certificateUrl = String(body.certificateUrl || '').trim();
        if (certificateUrl && !isValidUploadedFile(certificateUrl)) return jsonResponse(res, 400, { error: 'Geçersiz sertifika dosyası.' });
        prod.certificateUrl = certificateUrl || null;
      }

      writeJson(PRODUCTS_PATH, products);
      return jsonResponse(res, 200, prod);
    }

    // Yapay zeka ile otomatik fotoğraf düzenleme — ürün ve yetki kontrolü gerçek, işlemin
    // kendisi henüz yok (gerçek bir görsel-AI sağlayıcısı bağlanınca burası doldurulacak).
    // Uç nokta bilerek "başarısız" değil "henüz yok" (available:false) döner ki arayüz
    // butonu şimdiden buraya bağlanabilsin; sağlayıcı eklenince sadece bu bloğun içi değişir.
    if (p === '/api/admin/products/ai-enhance-photos' && req.method === 'POST') {
      const session = requireApprovedSeller(req, res);
      if (!session) return;
      const { slug } = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const prod = products[slug];
      if (!prod || prod.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      return jsonResponse(res, 200, {
        available: false,
        message: 'Fotoğrafları yapay zeka ile otomatik düzenleme özelliği yakında geliyor. Şimdilik yüklediğin fotoğraflar olduğu gibi yayınlanır.',
      });
    }

    if (p === '/api/admin/products/delete' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { slug } = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const prod = products[slug];
      if (!prod || prod.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      delete products[slug];
      writeJson(PRODUCTS_PATH, products);
      return jsonResponse(res, 200, { ok: true });
    }

    // ---------- Platform yönetici paneli ----------

    if (p === '/api/owner/login' && req.method === 'POST') {
      const { password } = await readBody(req);
      if (String(password || '') !== ADMIN_PASSWORD) {
        return jsonResponse(res, 401, { error: 'Parola hatalı.' });
      }
      const token = randomToken();
      adminTokens.set(token, { at: Date.now() });
      return jsonResponse(res, 200, { token });
    }

    if (p === '/api/owner/overview' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const products = readJson(PRODUCTS_PATH, {});
      const users = readJson(USERS_PATH, {});
      const complaints = readJson(COMPLAINTS_PATH, {});
      const posts = readJson(POSTS_PATH, {});
      const safeUsers = Object.values(users).map(({ passwordHash, ...u }) => u);
      return jsonResponse(res, 200, {
        products: Object.values(products),
        users: safeUsers,
        complaints: Object.values(complaints),
        posts: Object.values(posts),
      });
    }

    if (p === '/api/owner/products/delete' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { slug } = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      if (!products[slug]) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      delete products[slug];
      writeJson(PRODUCTS_PATH, products);
      return jsonResponse(res, 200, { ok: true });
    }

    if (p === '/api/owner/users/delete' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { phone } = await readBody(req);
      const users = readJson(USERS_PATH, {});
      if (!users[phone]) return jsonResponse(res, 404, { error: 'Kullanıcı bulunamadı' });
      delete users[phone];
      writeJson(USERS_PATH, users);
      const sessions = readJson(SESSIONS_PATH, {});
      for (const t of Object.keys(sessions)) if (sessions[t].phone === phone) delete sessions[t];
      writeJson(SESSIONS_PATH, sessions);
      return jsonResponse(res, 200, { ok: true });
    }

    if (p === '/api/owner/complaints/delete' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { id } = await readBody(req);
      const complaints = readJson(COMPLAINTS_PATH, {});
      if (!complaints[id]) return jsonResponse(res, 404, { error: 'Şikayet bulunamadı' });
      delete complaints[id];
      writeJson(COMPLAINTS_PATH, complaints);
      return jsonResponse(res, 200, { ok: true });
    }

    if (p === '/api/owner/posts/delete' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { id } = await readBody(req);
      const posts = readJson(POSTS_PATH, {});
      if (!posts[id]) return jsonResponse(res, 404, { error: 'Post bulunamadı' });
      delete posts[id];
      writeJson(POSTS_PATH, posts);
      return jsonResponse(res, 200, { ok: true });
    }

    // Reklam verme ayarları: owner herhangi bir postu reklam yapabilir/reklamdan indirebilir.
    // Reklam olarak işaretlenince süresizleşir (expiresAt: null); geri alınınca yeni bir 24 saatlik pencere açılır.
    if (p === '/api/owner/posts/toggle-ad' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { id } = await readBody(req);
      const posts = readJson(POSTS_PATH, {});
      const post = posts[id];
      if (!post) return jsonResponse(res, 404, { error: 'Post bulunamadı' });
      post.isAd = !post.isAd;
      post.expiresAt = post.isAd ? null : new Date(Date.now() + POST_TTL_MS).toISOString();
      writeJson(POSTS_PATH, posts);
      return jsonResponse(res, 200, post);
    }

    // Ürünü "öne çıkanlar" sıralamasında sabit puan bonusuyla yukarı çeker (bkz. main/assets/filter.js).
    if (p === '/api/owner/products/feature' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { slug, featured } = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const prod = products[slug];
      if (!prod) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      prod.featured = !!featured;
      writeJson(PRODUCTS_PATH, products);
      return jsonResponse(res, 200, prod);
    }

    // "Organik" iddiasını satıcının yüklediği belgeye bakarak admin onaylar/reddeder —
    // onaylanmadan ürün sayfasında yalnızca "Onay Bekliyor" olarak görünür.
    if (p === '/api/owner/products/approve-organic' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { slug, approved } = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const prod = products[slug];
      if (!prod) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      prod.organicApproved = !!approved;
      writeJson(PRODUCTS_PATH, products);
      return jsonResponse(res, 200, prod);
    }

    // Yorum onay kuyruğu: 1-3 yıldızlı yorumlar buraya düşer, admin onaylar/reddeder.
    if (p === '/api/owner/reviews' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const products = readJson(PRODUCTS_PATH, {});
      const store = readJson(REVIEWS_PATH, {});
      const out = [];
      for (const slug of Object.keys(store)) {
        const title = (products[slug] || {}).title || slug;
        for (const rv of store[slug] || []) out.push(Object.assign({ productSlug: slug, productTitle: title }, rv));
      }
      out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { reviews: out });
    }

    if (p === '/api/owner/reviews/moderate' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { productSlug, reviewId, status } = await readBody(req);
      if (!['approved', 'rejected'].includes(status)) return jsonResponse(res, 400, { error: 'Geçersiz durum.' });
      const store = readJson(REVIEWS_PATH, {});
      const review = (store[productSlug] || []).find((rv) => rv.id === reviewId);
      if (!review) return jsonResponse(res, 404, { error: 'Yorum bulunamadı' });
      review.status = status;
      writeJson(REVIEWS_PATH, store);
      return jsonResponse(res, 200, review);
    }

    // Satıcılar sekmesi: her satıcının ürün/mesaj/şikayet sayılarıyla birlikte özet görünümü.
    if (p === '/api/owner/sellers' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const users = readJson(USERS_PATH, {});
      const products = readJson(PRODUCTS_PATH, {});
      const complaints = readJson(COMPLAINTS_PATH, {});
      const messages = readJson(MESSAGES_PATH, { conversations: {} });
      const productList = Object.values(products);
      const complaintList = Object.values(complaints);
      const convoList = Object.values(messages.conversations);
      const productBySlug = products;

      const sellers = Object.values(users)
        .filter((u) => u.role === 'satici')
        .map((u) => {
          const own = productList.filter((p) => p.sellerId === u.id);
          const ownSlugs = own.map((p) => p.slug);
          const openComplaints = complaintList.filter((c) => c.sellerId === u.id && c.status === 'open').length;
          const convoCount = convoList.filter((c) => ownSlugs.indexOf(c.productSlug) !== -1).length;
          const { passwordHash, ...safeUser } = u;
          return Object.assign({}, safeUser, {
            productCount: own.length, openComplaints, convoCount,
          });
        });
      return jsonResponse(res, 200, { sellers });
    }

    // Satıcı başvurusunu onaylar/reddeder — onaylanmadan ürün yayınlanamaz (bkz. requireApprovedSeller).
    if (p === '/api/owner/sellers/approve' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { phone, status } = await readBody(req);
      if (!['approved', 'rejected', 'pending'].includes(status)) return jsonResponse(res, 400, { error: 'Geçersiz durum.' });
      const users = readJson(USERS_PATH, {});
      const user = users[phone];
      if (!user || user.role !== 'satici') return jsonResponse(res, 404, { error: 'Satıcı bulunamadı' });
      user.sellerStatus = status;
      writeJson(USERS_PATH, users);

      const STATUS_MESSAGES = {
        approved: 'Satıcı başvurun onaylandı! Artık ürün ekleyebilirsin.',
        rejected: 'Satıcı başvurun reddedildi. Detay için bize ulaşabilirsin.',
        pending: 'Satıcı başvurun yeniden incelemeye alındı.',
      };
      notifyUser(phone, 'seller_application', STATUS_MESSAGES[status]);

      const { passwordHash, ...safeUser } = user;
      return jsonResponse(res, 200, { user: safeUser });
    }

    // Rozetli satıcı: admin'in elle verdiği bir güven işareti — başvuru onayından (sellerStatus)
    // ayrı bir kavram. Ürün listelerinde ve satıcı profilinde rozet olarak görünür, filtrelenebilir.
    if (p === '/api/owner/sellers/badge' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { phone, verified } = await readBody(req);
      const users = readJson(USERS_PATH, {});
      const user = users[phone];
      if (!user || user.role !== 'satici') return jsonResponse(res, 404, { error: 'Satıcı bulunamadı' });
      user.verifiedSeller = !!verified;
      writeJson(USERS_PATH, users);
      notifyUser(phone, 'seller_badge', user.verifiedSeller
        ? 'Tebrikler! Artık "Güvenilir Satıcı" rozetine sahipsin.'
        : 'Güvenilir Satıcı rozetin kaldırıldı.');
      const { passwordHash, ...safeUser } = user;
      return jsonResponse(res, 200, { user: safeUser });
    }

    // Bildirimler: kanal başına genel açma/kapama anahtarı (kullanıcı tercihinden ayrı,
    // "sistem geneli SMS'i tamamen kapat" gibi bir acil durum anahtarı) ve gönderim geçmişi.
    if (p === '/api/owner/notification-settings' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const settings = readNotificationSettings();
      const channels = Object.values(NOTIFICATION_CHANNELS).map((ch) => ({
        key: ch.key, label: ch.label, configured: ch.isConfigured(),
      }));
      return jsonResponse(res, 200, { settings, channels });
    }

    if (p === '/api/owner/notification-settings' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const settings = readNotificationSettings();
      if (typeof body.smsEnabled === 'boolean') settings.smsEnabled = body.smsEnabled;
      if (typeof body.emailEnabled === 'boolean') settings.emailEnabled = body.emailEnabled;
      writeJson(NOTIFICATION_SETTINGS_PATH, settings);
      return jsonResponse(res, 200, { settings });
    }

    if (p === '/api/owner/notifications' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const log = readJson(NOTIFICATIONS_PATH, {});
      const all = Object.values(log).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 200);
      return jsonResponse(res, 200, { notifications: all });
    }

    // Mesajlar sekmesi: platformdaki tüm sohbetler (salt okunur gözetim).
    if (p === '/api/owner/messages' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const store = readJson(MESSAGES_PATH, { conversations: {} });
      const all = Object.values(store.conversations).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return jsonResponse(res, 200, { conversations: all });
    }
  } catch (e) {
    return jsonResponse(res, 502, { error: 'Veri alınamadı', detail: String(e) });
  }

  for (const [prefix, root] of Object.entries(SITES)) {
    if (p === `/${prefix}` || p.startsWith(`/${prefix}/`)) {
      const rest = p.slice(prefix.length + 1) || '/';
      return serveStatic(res, root, rest);
    }
  }

  // Statik dosyası olmayan (satıcı tarafından sonradan eklenmiş) ürünler için
  // sunucu tarafında üretilen ürün sayfası.
  const urunMatch = p.match(/^\/urun\/([a-z0-9-]+)\.html$/);
  if (urunMatch) {
    const staticPath = path.join(MAIN, 'urun', urunMatch[1] + '.html');
    if (!fs.existsSync(staticPath)) {
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[urunMatch[1]];
      if (product) return sendHtml(res, renderProductPage(product, products));
    }
  }

  // Satıcı profil sayfası, tamamen dinamik üretilir (statik dosyası yok).
  const saticiMatch = p.match(/^\/satici\/(u_[a-z0-9]+)\.html$/);
  if (saticiMatch) {
    const found = findUserById(saticiMatch[1]);
    if (found && found.user.role === 'satici') {
      const products = readJson(PRODUCTS_PATH, {});
      return sendHtml(res, renderSellerPage(found.user, saticiMatch[1], products));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Satıcı bulunamadı');
    return;
  }

  return serveStatic(res, MAIN, p);
});

server.listen(PORT, () => {
  console.log(`köylüdostu  http://localhost:${PORT}         (main)`);
  console.log(`            http://localhost:${PORT}/blog     (blog)`);
  console.log(`            http://localhost:${PORT}/haber    (haber)`);
  console.log(`            http://localhost:${PORT}/haber/admin  (ajan ayarları)`);
  console.log(`            http://localhost:${PORT}/sosyal   (sosyal)`);
});
