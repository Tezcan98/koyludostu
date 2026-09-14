const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const PORT = process.env.PORT || 3010;
const HOST = process.env.HOST || '0.0.0.0';
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
const PRODUCT_ORDERS_PATH = path.join(DATA_DIR, 'product_orders.json');
// Şirket satıcıların sipariş başına kestiği fatura taslaklarının sıra numarası — satıcı
// başına, hiç geriye sarmadan artar; aynı sipariş için tekrar istenirse aynı numara döner.
const INVOICE_COUNTERS_PATH = path.join(DATA_DIR, 'invoice_counters.json');
// Kimlik/vergi levhası/destekleyici belge gibi hassas dosyalar, ürün fotoğrafı ve
// sertifika gibi kasıtlı olarak herkese açık dosyalardan farklı olarak, statik
// sunucunun (koyludostu-tumsite/) DIŞINDA, imzalı URL olmadan hiç erişilemeyen ayrı
// bir klasörde tutulur — bkz. saveSecureDoc / signFileToken / GET /secure-uploads.
const SECURE_UPLOADS_DIR = path.join(DATA_DIR, 'secure-uploads');
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

// Satıcı avatarı: gerçek bir fotoğrafımız yok, bunun yerine adından türetilen
// baş harf + markanın kendi paletinden (isme göre sabit, her seferinde aynı)
// bir arka plan rengiyle "kişiselleştirilmiş" bir rozet gösteriyoruz — düz gri
// bir kişi ikonu yerine sayfayı daha canlı ve ürün ürün ayırt edilebilir kılıyor.
const AVATAR_PALETTE = ['#4E6B3A', '#C08A2E', '#8E3B46', '#2E6EC0', '#6B4E9E', '#3F8C7A'];
function sellerAvatarColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function sellerInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toLocaleUpperCase('tr') : '?';
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
    ? (product.minQty === product.maxQty
      ? `<div class="qty-range">Tedarik miktarı: ${product.minQty} ${unitWord}</div>`
      : `<div class="qty-range">Tedarik miktarı: ${product.minQty} ${unitWord} – ${product.maxQty} ${unitWord}</div>`)
    : '';
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
  const orderCtaIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`;
  const productActions = isActive
    ? `<div class="product-actions">
        <button class="msg-cta" data-slug="${esc(product.slug)}" data-title="${esc(product.title)}">💬 Satıcıya Mesaj Yaz</button>
        <button class="order-cta" data-slug="${esc(product.slug)}" data-title="${esc(product.title)}">${orderCtaIcon}Sipariş Talebi Gönder</button>
      </div>`
    : '';

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
    <a href="/siparislerim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h9.2a2 2 0 0 0 2-1.6L22 6H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/></svg>Siparişlerim</a>
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
      <div class="seller-card">
        <div class="seller-card-avatar" style="background:${sellerAvatarColor(product.sellerName)}">${esc(sellerInitial(product.sellerName))}</div>
        <div class="seller-card-info">
          <div class="producer-name"><a href="../satici/${esc(product.sellerId)}.html">${esc(product.sellerName)}</a>${sellerVerified ? ' <span class="seller-badge" title="Güvenilir Satıcı">✅</span>' : ''}</div>
          <div class="producer-loc">${esc(product.city)}</div>
        </div>
        <button class="fav-seller-cta" data-id="${esc(product.sellerId)}">☆ Takip Et</button>
      </div>
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
        <div class="price-row">
          <div class="product-price">${esc(product.price)} <small>${esc(product.unit)}</small></div>
          <button class="fav-cta" data-id="${esc(product.slug)}">🤍</button>
        </div>
        ${productActions}
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
<script src="../assets/address.js"></script>
<script src="../assets/order-terms.js"></script>
<script src="../assets/order.js"></script>
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
  const badge = seller.verifiedSeller ? '<span class="seller-badge" title="Güvenilir Satıcı">✅</span>' : '';
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
    <a href="/siparislerim.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h9.2a2 2 0 0 0 2-1.6L22 6H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/></svg>Siparişlerim</a>
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
  <div class="seller-cta-row">
    <button class="fav-seller-cta" data-id="${esc(sellerId)}">☆ Satıcıyı Takip Et</button>
    ${own.length ? `<button class="msg-cta" data-slug="${esc(own[0].slug)}" data-title="${esc(own[0].title)}">💬 Satıcıya Mesaj Yaz</button>` : ''}
  </div>

  <h2 class="seller-products-title">Ürünleri (${own.length})</h2>
  <div class="grid">${gridHtml}</div>
</div>
<footer class="site-footer">
  <b>Köylü Dostu</b> · Üreticilerden doğrudan alışveriş
</footer>

<script src="../assets/auth.js"></script>
<script src="../assets/favorites.js"></script>
<script src="../assets/messages.js"></script>
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

// Oturum/admin/kayıt token'ları ve dosya adları burada üretilir — Math.random()
// kriptografik olarak güvenli değildir (tahmin edilebilir iç durumu vardır), bu yüzden
// crypto.randomBytes kullanıyoruz. Hex çıktısı eski base36 formatıyla aynı karakter
// kümesine (0-9a-f ⊂ [A-Za-z0-9]) uyduğundan mevcut dosya adı/ID regex'leriyle uyumlu.
function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw);
}

const VALID_SELLER_TYPES = ['bireysel', 'sirket'];
// Bireysel satıcı: T.C. Kimlik No (11 hane). Şirket: Vergi Numarası (10 hane).
function isValidTaxIdForType(id, sellerType) {
  const digits = String(id || '').trim();
  if (sellerType === 'sirket') return /^\d{10}$/.test(digits);
  return /^\d{11}$/.test(digits);
}

// Satıcı başına artan, hiç geriye sarmayan fatura sıra numarası üretir — ör. "2026/000007".
// Aynı yıl içinde satıcı başına sıfırlanmaz (basit ve çakışmasız kalsın diye), sadece
// görüntülenen numaranın başındaki yıl, numaranın ilk üretildiği yılı gösterir.
function nextInvoiceNo(sellerId) {
  const counters = readJson(INVOICE_COUNTERS_PATH, {});
  const next = (counters[sellerId] || 0) + 1;
  counters[sellerId] = next;
  writeJson(INVOICE_COUNTERS_PATH, counters);
  const year = new Date().getFullYear();
  return `${year}/${String(next).padStart(6, '0')}`;
}

// ---------- Nilvera e-Arşiv Fatura entegrasyonu ----------
// Trendyol/Hepsiburada gibi pazaryerleri faturayı kendileri kesmez — hukuken faturayı
// düzenleyen satıcıdır; pazaryeri sadece satıcının zaten sahip olduğu bir e-Fatura/
// e-Arşiv "özel entegratörü"nün (Paraşüt, Logo, KolayBi, Foriba, Nilvera...) API'sine
// otomatik istek atan bir köprü kurar. Burada REST/JSON tabanlı olduğu için ek bir
// XML/SOAP paketi gerektirmeyen Nilvera ile başlıyoruz (bkz. proje kuralı: bağımlılıksız
// backend). NOT: Nilvera'nın tam istek şeması (Swagger) JS ile render edildiğinden bu
// oturumda doğrulanamadı — satıcı gerçek bir test API anahtarı bağladığında dönen hataya
// göre alan adları tek bir yerden (bu fonksiyon) düzeltilebilir; bağlanmamış satıcılar
// için mevcut yazdırılabilir taslak akışı hiç etkilenmeden çalışmaya devam eder.
function nilveraBaseUrl(env) {
  return env === 'live' ? 'https://api.nilvera.com' : 'https://apitest.nilvera.com';
}

async function cutNilveraArchiveInvoice({ apiKey, env, invoiceNo, issueDate, seller, buyer, item }) {
  const vatRate = Number(item.vatRate) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
  const vatAmount = Math.round(lineTotal * (vatRate / 100) * 100) / 100;
  const body = {
    InvoiceInfo: {
      InvoiceSerieOrNumber: invoiceNo,
      IssueDate: issueDate,
      CurrencyCode: 'TRY',
    },
    CompanyInfo: {
      TaxOrIdentityNumber: seller.taxId,
      Name: seller.legalName,
      TaxOffice: seller.taxOffice,
      Address: seller.address,
    },
    CustomerInfo: {
      Name: buyer.name,
      Address: buyer.address,
      Phone: buyer.phone,
    },
    InvoiceLines: [{
      Name: item.title,
      Quantity: item.quantity,
      UnitType: item.unit || 'C62',
      UnitPrice: unitPrice,
      VatRate: vatRate,
      VatAmount: vatAmount,
      LineTotal: lineTotal,
    }],
  };

  let r;
  try {
    r = await fetch(`${nilveraBaseUrl(env)}/einvoice/Archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: 'Nilvera\'ya bağlanılamadı: ' + e.message };
  }
  let data = null;
  try { data = await r.json(); } catch { /* boş/JSON olmayan yanıt olabilir */ }
  if (!r.ok) {
    const msg = (data && (data.Message || data.message || data.title)) || `Nilvera hatası (HTTP ${r.status})`;
    return { ok: false, error: msg, raw: data };
  }
  return {
    ok: true,
    providerInvoiceNo: (data && (data.UUID || data.InvoiceNumber || data.InvoiceSerieOrNumber)) || invoiceNo,
    pdfUrl: (data && (data.PDFUrl || data.PdfUrl)) || null,
    raw: data,
  };
}

// Türkiye IBAN'ı: TR + 24 hane (toplam 26 karakter). Gerçek IBAN checksum
// doğrulaması yapmıyoruz, sadece format kontrolü — banka zaten geçersiz bir
// IBAN'a transferi kabul etmeyecektir.
function normalizeIban(iban) {
  return String(iban || '').replace(/\s+/g, '').toUpperCase();
}
function isValidIban(iban) {
  return /^TR\d{24}$/.test(normalizeIban(iban));
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

const pendingCodes = new Map(); // phone -> { code, at, attempts }
const pendingRegs = new Map(); // regToken -> { name, city, passwordHash, role, at }
const CODE_TTL = 5 * 60 * 1000;
const REGISTER_TTL = 15 * 60 * 1000;
const DEV_CODE = '0000';
const MAX_CODE_ATTEMPTS = 5;
// Gerçek bir SMS sağlayıcısı (Netgsm, Twilio vb.) henüz bağlı değil. Testler (KD_DATA_DIR
// her zaman ayarlı) hâlâ sabit '0000' kodunu kullanır; ama üretimde/manuel çalıştırmada
// gerçek rastgele bir kod üretilir ve SADECE sunucu konsoluna yazılır — ASLA API
// yanıtında istemciye dönülmez. Aksi halde (eski davranış) telefon doğrulaması hiçbir
// şeyi doğrulamamış olurdu: kod her zaman '0000' olduğu ve bu public repo'da görülebildiği
// için biri kendisine ait olmayan bir telefon numarasıyla hesap açabilir/doğrulayabilirdi.
const IS_TEST_ENV = !!process.env.KD_DATA_DIR;
// GEÇİCİ: Henüz gerçek bir SMS sağlayıcısı (Netgsm, Twilio vb.) bağlanmadığı için üretimde
// de sabit '0000' kullanılması istendi — aksi halde kimse kayıt/giriş yapamaz çünkü kodu
// hiçbir yere alamıyor. SMS_NOT_CONNECTED=1 KALDIRILMADIĞI SÜRECE telefon doğrulaması
// GÜVENLİK SAĞLAMAZ (herkes başkasının numarasıyla hesap açabilir/giriş yapabilir) — bir
// SMS sağlayıcısı bağlanır bağlanmaz bu env değişkeni sunucudan kaldırılmalı.
const SMS_NOT_CONNECTED = !!process.env.SMS_NOT_CONNECTED;
function generateSmsCode() {
  return (IS_TEST_ENV || SMS_NOT_CONNECTED) ? DEV_CODE : String(crypto.randomInt(0, 10000)).padStart(4, '0');
}
const VALID_ROLES = ['alici', 'satici'];

// Kullanıcı nesnesini istemciye dönmeden önce sırları temizler — parola hash'i hiç
// gitmez; e-Fatura entegratör API anahtarı da aynı şekilde asla client'a dönülmez
// (biri bu anahtarı ele geçirirse satıcı adına fatura kesebilir/geçmiş faturalarını
// görebilirdi). Sadece "bağlı mı" bilgisini (einvoiceConnected) dönüyoruz.
function redactUser(user) {
  if (!user) return user;
  const { passwordHash, einvoiceApiKey, ...safe } = user;
  return { ...safe, einvoiceConnected: !!einvoiceApiKey };
}

function findUserById(id) {
  const users = readJson(USERS_PATH, {});
  for (const phone of Object.keys(users)) {
    if (users[phone].id === id) return { phone, user: users[phone] };
  }
  return null;
}

function findUserByEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  const users = readJson(USERS_PATH, {});
  for (const phone of Object.keys(users)) {
    if ((users[phone].email || '').toLowerCase() === clean) return { phone, user: users[phone] };
  }
  return null;
}

// Giriş ve "şifremi unuttum" ekranları tek bir kutuya telefon ya da e-posta kabul
// eder — '@' varsa e-posta, yoksa telefon numarası olarak yorumlanır.
function findUserByIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return findUserByEmail(raw);
  const norm = normalizePhone(raw);
  const users = readJson(USERS_PATH, {});
  const user = users[norm];
  return user ? { phone: norm, user } : null;
}

// ---------- Google ile giriş: ID token'ı Google'ın açık anahtarlarına (JWKS) karşı
// doğrular. Ek bir npm paketi kurmamak için (bkz. proje kuralı: bağımlılıksız backend)
// bunu doğrudan Node'un crypto modülüyle yapıyoruz — bu, OpenID Connect'in standart,
// dokümante edilmiş bir deseni (RS256 imza doğrulama + aud/iss/exp kontrolü),
// uydurma ya da gözlemlenmemiş bir API değil. ----------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
let googleJwksCache = { keys: [], at: 0 };
const GOOGLE_JWKS_TTL_MS = 60 * 60 * 1000;

function base64urlDecode(str) {
  return Buffer.from(String(str || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function getGoogleJwks() {
  if (googleJwksCache.keys.length && Date.now() - googleJwksCache.at < GOOGLE_JWKS_TTL_MS) {
    return googleJwksCache.keys;
  }
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const data = await r.json();
  googleJwksCache = { keys: data.keys || [], at: Date.now() };
  return googleJwksCache.keys;
}

async function verifyGoogleIdToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Geçersiz token biçimi.');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
  const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('Desteklenmeyen imza algoritması.');

  const keys = await getGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Doğrulama anahtarı bulunamadı.');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signingInput = Buffer.from(headerB64 + '.' + payloadB64);
  const signatureOk = crypto.verify('RSA-SHA256', signingInput, publicKey, base64urlDecode(sigB64));
  if (!signatureOk) throw new Error('İmza doğrulanamadı.');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error('Token süresi dolmuş.');
  if (!GOOGLE_CLIENT_ID || payload.aud !== GOOGLE_CLIENT_ID) throw new Error('Bu uygulamaya ait olmayan bir token.');
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('Geçersiz token kaynağı.');
  }
  if (!payload.email_verified) throw new Error('E-posta Google tarafından doğrulanmamış.');
  return payload; // { email, name, sub, email_verified, ... }
}

// Ürün nesneleri satıcı bilgisini (ad/telefon) o an kaydedildiği haliyle taşır ama "rozetli
// satıcı" durumu sonradan değişebildiği için canlı users.json'dan katılır — id -> boolean.
function sellerInfoMap() {
  const users = readJson(USERS_PATH, {});
  const map = {};
  Object.values(users).forEach((u) => {
    if (u.role === 'satici') map[u.id] = { verified: !!u.verifiedSeller, sellerType: u.sellerType || 'bireysel' };
  });
  return map;
}

function withSellerBadge(product, infoMap) {
  const info = infoMap[product.sellerId] || {};
  return Object.assign({}, product, { sellerVerified: !!info.verified, sellerType: info.sellerType || 'bireysel' });
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
  const safeUser = redactUser(user);
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

// Sunucudaki yerel postfix'e (mynetworks: 127.0.0.1, kimlik doğrulama gerekmez)
// ham SMTP ile bağlanıp mail gönderir — te-robotik.com.tr için SPF/DKIM zaten
// yapılandırılı olduğundan postfix imzalayıp gönderiyor. Sadece o sunucuda
// çalışır; yerel geliştirmede/testte 25. port kapalı olduğundan bağlantı
// hemen reddedilir ve notifyUser bunu sessizce yutar (bkz. çağıran taraf).
const SMTP_HOST = process.env.SMTP_HOST || '127.0.0.1';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 25;
const MAIL_FROM = process.env.MAIL_FROM || 'koyludostu@te-robotik.com.tr';

function sendMailViaLocalRelay({ to, subject, text }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: SMTP_HOST, port: SMTP_PORT });
    socket.setTimeout(8000);
    let buf = '';
    let resolveReply = null;

    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!buf.endsWith('\r\n')) return;
      const lines = buf.trim().split('\r\n');
      const last = lines[lines.length - 1];
      if (/^\d{3} /.test(last)) {
        const reply = buf;
        buf = '';
        if (resolveReply) { const r = resolveReply; resolveReply = null; r(reply); }
      }
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP zaman aşımı')); });
    socket.on('error', reject);

    function waitReply() {
      return new Promise((res) => { resolveReply = res; });
    }

    async function run() {
      await waitReply(); // 220 karşılama
      socket.write('EHLO te-robotik.com.tr\r\n');
      await waitReply();
      socket.write(`MAIL FROM:<${MAIL_FROM}>\r\n`);
      const mailResp = await waitReply();
      if (!mailResp.startsWith('250')) throw new Error('MAIL FROM reddedildi: ' + mailResp);
      socket.write(`RCPT TO:<${to}>\r\n`);
      const rcptResp = await waitReply();
      if (!rcptResp.startsWith('250')) throw new Error('RCPT TO reddedildi: ' + rcptResp);
      socket.write('DATA\r\n');
      const dataResp = await waitReply();
      if (!dataResp.startsWith('354')) throw new Error('DATA reddedildi: ' + dataResp);
      const escapedBody = text.split('\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
      const message =
        `From: Köylü Dostu <${MAIL_FROM}>\r\n` +
        `To: <${to}>\r\n` +
        `Subject: ${subject}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: text/plain; charset=UTF-8\r\n` +
        `\r\n${escapedBody}\r\n.\r\n`;
      socket.write(message);
      const sentResp = await waitReply();
      if (!sentResp.startsWith('250')) throw new Error('Mesaj kabul edilmedi: ' + sentResp);
      socket.write('QUIT\r\n');
      socket.end();
    }

    run().then(() => resolve({ ok: true })).catch((err) => { socket.destroy(); reject(err); });
  });
}

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
  isConfigured() { return true; }
  formatTarget(user) { return user.email || null; }
  async send(target, message) {
    try {
      await sendMailViaLocalRelay({ to: target, subject: 'Köylü Dostu bildirimi', text: message });
      return { ok: true };
    } catch (e) {
      // Yerel geliştirme/testte 25. port kapalı olacağından burası sık düşer —
      // notifyUser çağıranı zaten hatayı yutuyor, sadece görünürlük için logluyoruz.
      console.log(`[EMAIL-FAIL] ${target}: ${e.message}`);
      throw e;
    }
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
// ÖNEMLİ: sabit bir varsayılan parola ASLA kaynak koduna gömülmemeli — bu repo public
// (github.com/Tezcan98/koyludostu), gömülü bir varsayılan orada herkese açık olur.
// ADMIN_PASSWORD ortam değişkeni ayarlanmamışsa, her süreç başlangıcında rastgele
// bir parola üretilip SADECE sunucu konsoluna (pm2 logs ile görülür) yazılır.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (() => {
  const generated = crypto.randomBytes(9).toString('base64url');
  console.warn('\n⚠️  ADMIN_PASSWORD ortam değişkeni ayarlanmamış! Bu çalıştırma için geçici bir parola üretildi:');
  console.warn('    ' + generated);
  console.warn('    Kalıcı olması için ADMIN_PASSWORD ortam değişkenini ayarlayıp süreci yeniden başlatın.\n');
  return generated;
})();
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

// data: URL'sini diske yazan ortak yardımcı — hem oturum açmış satıcının
// /api/admin/upload-doc çağrısında hem de kayıt sırasında (henüz oturum yokken,
// verify() adımında) kimlik belgesi kaydederken kullanılır. Hata durumunda
// mesajıyla birlikte fırlatır, çağıran taraf 400'e çevirir.
function saveUploadedDoc(dataUrl) {
  const m = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Geçersiz dosya. PNG, JPEG, WEBP ya da PDF yükle.');
  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const ext = extMap[m[1]];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('Dosya çok büyük (max 8MB).');
  const uploadsDir = path.join(MAIN, 'assets', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const fname = 'd_' + randomToken().slice(0, 12) + '.' + ext;
  fs.writeFileSync(path.join(uploadsDir, fname), buf);
  return { url: '/assets/uploads/' + fname };
}

// Kimlik/vergi levhası/organik belgesi gibi hassas belgeleri, statik sunucunun
// hiç dokunmadığı SECURE_UPLOADS_DIR'a yazar. Dönen değer bir URL değil, sadece
// dosya adıdır — görüntülemek için mutlaka signFileToken ile imzalı bir bağlantı
// üretilmesi gerekir (bkz. GET /secure-uploads/:filename).
function saveSecureDoc(dataUrl) {
  const m = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Geçersiz dosya. PNG, JPEG, WEBP ya da PDF yükle.');
  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
  const ext = extMap[m[1]];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('Dosya çok büyük (max 8MB).');
  fs.mkdirSync(SECURE_UPLOADS_DIR, { recursive: true });
  const fname = 's_' + randomToken().slice(0, 12) + '.' + ext;
  fs.writeFileSync(path.join(SECURE_UPLOADS_DIR, fname), buf);
  return { filename: fname };
}

function isValidSecureFilename(name) {
  return /^s_[A-Za-z0-9]+\.[a-z]+$/.test(String(name || ''));
}

// Hassas belgeler için kısa ömürlü, imzalı erişim bağlantıları. Sunucu her
// başladığında yeni bir gizli anahtar üretilir — bir restart'ta eldeki linklerin
// geçersiz kalması sorun değildir, admin panelden tekrar "Görüntüle"ye basmak
// yeterlidir (bkz. POST /api/owner/sign-file-url).
const FILE_TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
const FILE_TOKEN_TTL_MS = 5 * 60 * 1000;

function signFileToken(filename) {
  const exp = Date.now() + FILE_TOKEN_TTL_MS;
  const sig = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(filename + '.' + exp).digest('hex');
  return { exp, sig };
}

function isValidFileToken(filename, exp, sig) {
  const expNum = Number(exp);
  if (!expNum || Date.now() > expNum) return false;
  const expected = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(filename + '.' + expNum).digest('hex');
  const sigStr = String(sig || '');
  if (expected.length !== sigStr.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigStr));
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

// nginx gibi bir ters proxy'nin arkasındaysak socket IP'si her zaman loopback olur;
// bu durumda gerçek istemci IP'sini nginx'in eklediği X-Forwarded-For'dan alıyoruz.
// Sadece loopback'ten gelen istekte bu başlığa güveniyoruz (yoksa dışarıdan biri
// başlığı sahteleyip hız sınırlamasını atlatabilirdi).
function getClientIp(req) {
  const remote = req.socket.remoteAddress || '';
  if (isLoopback(remote)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return remote;
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

// ---------- parola denemesi sınırlama (admin/kullanıcı girişinde kaba kuvvete karşı) ----------
// Genel hız sınırlaması (yukarıda) dakikada 300 istek gibi geniş bir eşik — bir parola
// tahmin saldırısını caydırmaya yetmez. Burada başarısız girişleri ayrıca sayıyoruz.

const loginAttemptMap = new Map(); // key -> { count, windowStart }
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_MAX = 10;

function isLoginRateLimited(key) {
  const entry = loginAttemptMap.get(key);
  if (!entry || Date.now() - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) return false;
  return entry.count >= LOGIN_ATTEMPT_MAX;
}
function recordFailedLogin(key) {
  const now = Date.now();
  const entry = loginAttemptMap.get(key);
  if (!entry || now - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttemptMap.set(key, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}
function clearLoginAttempts(key) {
  loginAttemptMap.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, entry] of loginAttemptMap) {
    if (now - entry.windowStart > LOGIN_ATTEMPT_WINDOW_MS) loginAttemptMap.delete(k);
  }
}, 5 * 60 * 1000).unref();

// ---------- şifremi unuttum: token -> { phone, at } ----------
// Kayıt SMS kodları gibi belleğe tutulur (sunucu yeniden başlarsa bekleyen
// sıfırlama bağlantıları geçersiz kalır) — kısa ömürlü olduklarından kabul edilebilir.
const passwordResetTokens = new Map();
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of passwordResetTokens) {
    if (now - entry.at > RESET_TOKEN_TTL_MS) passwordResetTokens.delete(token);
  }
}, 5 * 60 * 1000).unref();

async function sendPasswordResetLink(user, phone, link) {
  const message = `Köylü Dostu: Şifreni sıfırlamak için bu bağlantıya git (30 dakika geçerli): ${link}\n\nBu isteği sen yapmadıysan yok sayabilirsin.`;
  // Şifre sıfırlama kullanıcının kendi başlattığı, güvenlik açısından kritik bir işlem
  // olduğundan notifyUser()'ın aksine kullanıcının bildirim tercihlerine bakılmaksızın
  // her zaman gönderilir — SMS her zaman (telefon zaten zorunlu), e-posta varsa ayrıca.
  const smsTarget = NOTIFICATION_CHANNELS.sms.formatTarget(user);
  NOTIFICATION_CHANNELS.sms.send(smsTarget, message).catch(() => {});
  if (user.email) {
    sendMailViaLocalRelay({ to: user.email, subject: 'Köylü Dostu — Şifre Sıfırlama', text: message }).catch(() => {});
  }
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Temel güvenlik başlıkları — sayfa her yerde çok sayıda satır içi <script> kullandığından
  // sıkı bir Content-Security-Policy şu an eklenemiyor (o, ayrı ve daha büyük bir iş);
  // ama bu üçü hiçbir şeyi bozmadan ücretsiz gelir.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const clientIp = getClientIp(req);
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
      const { name, email, city, district, neighborhood, password, role, termsAccepted, businessInfo, taxId, iban, idDocDataUrl, idDocConsent, sellerType, idDocOcrTaxId } = await readBody(req);
      const cleanName = String(name || '').trim().slice(0, 60);
      const cleanEmail = String(email || '').trim().slice(0, 120);
      const cleanCity = String(city || '').trim().slice(0, 60);
      const cleanDistrict = String(district || '').trim().slice(0, 60);
      const cleanNeighborhood = String(neighborhood || '').trim().slice(0, 80);
      const pass = String(password || '');
      if (cleanName.length < 2) return jsonResponse(res, 400, { error: 'Lütfen adını gir.' });
      // E-posta tamamen opsiyoneldir (SMS zaten kimlik doğrulaması için zorunlu) — ama
      // eklenmek isteniyorsa hem doğru formatlı hem de tekil olmalı, çünkü e-postayla da
      // giriş yapılabiliyor (bkz. /api/auth/login) ve iki hesap aynı e-postayı paylaşamaz.
      if (cleanEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          return jsonResponse(res, 400, { error: 'Geçerli bir e-posta adresi gir ya da boş bırak.' });
        }
        if (findUserByEmail(cleanEmail)) {
          return jsonResponse(res, 400, { error: 'Bu e-posta adresi başka bir hesapta kayıtlı.' });
        }
      }
      if (cleanCity.length < 2) return jsonResponse(res, 400, { error: 'Lütfen şehrini gir.' });
      if (cleanDistrict.length < 2) return jsonResponse(res, 400, { error: 'Lütfen ilçeni gir.' });
      if (!isValidPassword(pass)) return jsonResponse(res, 400, { error: 'Parola en az 8 karakter olmalı, en az bir harf ve bir rakam içermeli.' });
      if (!VALID_ROLES.includes(role)) return jsonResponse(res, 400, { error: 'Hesap türünü seç.' });
      if (!termsAccepted) return jsonResponse(res, 400, { error: 'Devam etmek için şartnameyi kabul etmelisin.' });

      const cleanBusinessInfo = String(businessInfo || '').trim().slice(0, 500);
      const cleanTaxId = String(taxId || '').trim();
      const cleanIban = normalizeIban(iban);
      // Bireysel üretici (T.C. Kimlik No) mı, şirket/vergi mükellefi (Vergi No) mı —
      // belirtilmemişse geriye dönük uyumluluk için bireysel kabul edilir.
      const cleanSellerType = VALID_SELLER_TYPES.includes(sellerType) ? sellerType : 'bireysel';
      if (role === 'satici' && cleanBusinessInfo.length < 10) {
        return jsonResponse(res, 400, { error: 'Satıcı başvurusu için ne/nasıl üretim yaptığını en az birkaç cümleyle anlat.' });
      }
      if (role === 'satici' && !isValidTaxIdForType(cleanTaxId, cleanSellerType)) {
        return jsonResponse(res, 400, {
          error: cleanSellerType === 'sirket'
            ? 'Geçerli bir Vergi Numarası gir (10 hane).'
            : 'Geçerli bir T.C. Kimlik No gir (11 hane).',
        });
      }
      if (role === 'satici' && !isValidIban(cleanIban)) {
        return jsonResponse(res, 400, { error: 'Geçerli bir IBAN gir (TR ile başlayan 26 karakter).' });
      }

      // Kimlik/vergi levhası belgesi bireysel satıcı için opsiyoneldir (başvuruyu
      // hızlandırmak için önerilir) — ama şirket/vergi mükellefi için vergi levhası
      // olmadan kişisel kimlik yeterli sayılmaz, bu yüzden zorunludur. Belge
      // verilmişse KVKK kapsamında ayrı ve açık bir rıza şart; genel "Kullanım
      // Şartları" onayı bunun yerine geçmez.
      const cleanIdDocDataUrl = String(idDocDataUrl || '').trim();
      if (role === 'satici' && cleanSellerType === 'sirket' && !cleanIdDocDataUrl) {
        return jsonResponse(res, 400, { error: 'Şirket/vergi mükellefi olarak başvurmak için vergi levhanı yükle.' });
      }
      if (cleanIdDocDataUrl) {
        if (!idDocConsent) {
          return jsonResponse(res, 400, { error: 'Belgeni yüklemek için ayrıca açık rıza vermelisin (ya da belgeyi kaldırıp devam et).' });
        }
        if (!/^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,/.test(cleanIdDocDataUrl)) {
          return jsonResponse(res, 400, { error: 'Geçersiz belge. PNG, JPEG, WEBP ya da PDF yükle.' });
        }
      }

      // Tarayıcı-içi OCR ile belgeden okunan T.C. Kimlik/Vergi No (varsa) — kimliğin
      // gerçekten doğrulanması değil, admin'e "yazılan" ile "belgeden okunan" numarayı
      // yan yana gösterip başkasının belgesinin yüklenmesi ihtimaline karşı bir
      // çapraz kontrol imkânı sağlar. Sadece bilgi amaçlıdır, formatı uymuyorsa yok sayılır.
      const cleanOcrTaxId = /^\d{10,11}$/.test(String(idDocOcrTaxId || '').trim()) ? String(idDocOcrTaxId).trim() : '';

      const regToken = randomToken();
      pendingRegs.set(regToken, {
        name: cleanName, email: cleanEmail, city: cleanCity, district: cleanDistrict, neighborhood: cleanNeighborhood,
        passwordHash: hashPassword(pass), role,
        businessInfo: cleanBusinessInfo, taxId: role === 'satici' ? cleanTaxId : '',
        sellerType: role === 'satici' ? cleanSellerType : '',
        iban: role === 'satici' ? cleanIban : '',
        idDocDataUrl: role === 'satici' ? cleanIdDocDataUrl : '',
        idDocConsent: role === 'satici' ? !!idDocConsent : false,
        idDocOcrTaxId: role === 'satici' ? cleanOcrTaxId : '',
        termsAcceptedAt: new Date().toISOString(), at: Date.now(),
      });
      return jsonResponse(res, 200, { regToken });
    }

    if (p === '/api/auth/request-code' && req.method === 'POST') {
      const { phone } = await readBody(req);
      const norm = normalizePhone(phone);
      if (norm.length !== 10) return jsonResponse(res, 400, { error: 'Geçerli bir telefon numarası girin (5XX XXX XX XX)' });
      // Kayıt akışında kullanılıyor (bkz. çağıranlar) — telefon zaten kayıtlıysa SMS
      // göndermeden en baştan reddet; aksi halde kullanıcı kodu girene kadar (bkz.
      // /api/auth/verify) bunu öğrenemezdi, boşuna bir SMS kodu almış/girmiş olurdu.
      const existingUsers = readJson(USERS_PATH, {});
      if (existingUsers[norm]) {
        return jsonResponse(res, 400, { error: 'Bu telefon numarası zaten kayıtlı. Giriş Yap sekmesinden devam et.' });
      }
      const code = generateSmsCode();
      pendingCodes.set(norm, { code, at: Date.now(), attempts: 0 });
      // Kod ASLA API yanıtında istemciye dönülmez — sadece konsola yazılır (gerçek bir
      // SMS sağlayıcısı bağlanana kadar bu, sunucuya erişimi olan birinin görebileceği
      // tek yerdir).
      console.log(`[SMS] +90${norm} için onay kodu: ${code}`);
      return jsonResponse(res, 200, { ok: true });
    }

    if (p === '/api/auth/verify' && req.method === 'POST') {
      const { phone, code, regToken } = await readBody(req);
      const norm = normalizePhone(phone);
      const pendingCode = pendingCodes.get(norm);
      const now = Date.now();
      // 4 haneli kodun sadece 10.000 ihtimali olduğundan, deneme sayısını sınırlamazsak
      // biri CODE_TTL süresi içinde kodu deneyerek bulabilir (bkz. genel hız sınırlaması
      // da var ama bu ayrıca ve daha sıkı bir koruma).
      if (pendingCode && now - pendingCode.at < CODE_TTL && pendingCode.attempts >= MAX_CODE_ATTEMPTS) {
        pendingCodes.delete(norm);
        return jsonResponse(res, 400, { error: 'Çok fazla hatalı deneme. Lütfen yeni bir kod iste.' });
      }
      const codeOk = pendingCode && pendingCode.code === String(code).trim() && now - pendingCode.at < CODE_TTL;
      if (!codeOk) {
        if (pendingCode) pendingCode.attempts = (pendingCode.attempts || 0) + 1;
        return jsonResponse(res, 400, { error: 'Kod hatalı veya süresi doldu' });
      }
      pendingCodes.delete(norm);

      const users = readJson(USERS_PATH, {});
      if (users[norm]) {
        return jsonResponse(res, 400, { error: 'Bu telefon numarası zaten kayıtlı. Giriş Yap sekmesinden devam et.' });
      }

      const pendingReg = pendingRegs.get(regToken);
      if (!pendingReg || now - pendingReg.at > REGISTER_TTL) {
        return jsonResponse(res, 400, { error: 'Kayıt bilgilerinin süresi doldu. Lütfen baştan başla.' });
      }
      // register-start ile verify arasındaki (en fazla REGISTER_TTL kadar) sürede başka
      // biri aynı e-postayla kayıt olmuş olabilir — burada tekrar kontrol ediyoruz.
      if (pendingReg.email && findUserByEmail(pendingReg.email)) {
        return jsonResponse(res, 400, { error: 'Bu e-posta adresi başka bir hesapta kayıtlı. Lütfen baştan başla.' });
      }

      // Kimlik belgesi varsa hesap oluşturulurken diske yazılır (kayıt sırasında henüz
      // oturum yoktu, dosya register-start'tan beri sadece bellekte bekliyordu).
      let idDocUrl = null;
      let idDocConsentAt = null;
      if (pendingReg.role === 'satici' && pendingReg.idDocDataUrl) {
        try {
          idDocUrl = saveSecureDoc(pendingReg.idDocDataUrl).filename;
          idDocConsentAt = new Date().toISOString();
        } catch (e) {
          return jsonResponse(res, 400, { error: e.message });
        }
      }

      users[norm] = {
        id: 'u_' + randomToken().slice(0, 10), phone: norm,
        name: pendingReg.name, email: pendingReg.email || '', city: pendingReg.city, district: pendingReg.district,
        neighborhood: pendingReg.neighborhood || '', passwordHash: pendingReg.passwordHash, role: pendingReg.role,
        termsAcceptedAt: pendingReg.termsAcceptedAt,
        createdAt: new Date().toISOString(),
        // Satıcı hesapları admin onayından geçmeden ürün ekleyemez (bkz. requireApprovedSeller).
        ...(pendingReg.role === 'satici'
          ? {
              sellerStatus: 'pending', businessInfo: pendingReg.businessInfo || '', taxId: pendingReg.taxId || '', iban: pendingReg.iban || '',
              sellerType: pendingReg.sellerType || 'bireysel',
              sellerDocUrl: null, verifiedSeller: false,
              // Kimlik belgesi: KVKK md.5 kapsamında açık rıza ile işlenir, sadece
              // satıcı doğrulama amaçlıdır, sadece admin görebilir (bkz. owner-admin.html).
              idDocUrl, idDocConsentAt,
              // Admin'in yazılan T.C./Vergi No ile belgeden OCR ile okunan numarayı
              // karşılaştırabilmesi için (bkz. isValidTaxIdForType çağrısındaki not).
              idDocOcrTaxId: pendingReg.idDocOcrTaxId || '',
            }
          : {}),
      };
      writeJson(USERS_PATH, users);
      pendingRegs.delete(regToken);

      const token = createSession(norm);
      const safeUser = redactUser(users[norm]);
      return jsonResponse(res, 200, { token, user: safeUser, isNew: true });
    }

    if (p === '/api/auth/login' && req.method === 'POST') {
      const { identifier, phone, password } = await readBody(req);
      // "identifier" telefon ya da e-posta olabilir (bkz. findUserByIdentifier);
      // eski "phone" alanı geriye dönük uyumluluk için hâlâ kabul edilir.
      const rawIdentifier = String(identifier || phone || '').trim();
      // Kilit anahtarını normalize ediyoruz ki aynı telefon "0555...", "555...",
      // "+90555..." gibi farklı yazımlarla denenerek kaba kuvvet kilidi atlatılamasın.
      const normalizedKey = rawIdentifier.includes('@') ? rawIdentifier.toLowerCase() : normalizePhone(rawIdentifier);
      const loginKey = 'user:' + clientIp + ':' + normalizedKey;
      if (isLoginRateLimited(loginKey)) {
        return jsonResponse(res, 429, { error: 'Çok fazla hatalı deneme. Lütfen biraz sonra tekrar dene.' });
      }
      const found = findUserByIdentifier(rawIdentifier);
      if (!found) return jsonResponse(res, 404, { error: 'Bu telefon numarası ya da e-posta kayıtlı değil. Önce üye ol.' });
      const { phone: norm, user } = found;
      if (!verifyPassword(String(password || ''), user.passwordHash)) {
        recordFailedLogin(loginKey);
        return jsonResponse(res, 401, { error: 'Telefon/e-posta ya da parola hatalı.' });
      }
      clearLoginAttempts(loginKey);
      const token = createSession(norm);
      const safeUser = redactUser(user);
      return jsonResponse(res, 200, { token, user: safeUser });
    }

    // Sayfanın Google butonunu gösterip göstermeyeceğine karar vermesi için —
    // GOOGLE_CLIENT_ID ayarlanmadıysa buton hiç render edilmez.
    if (p === '/api/auth/config' && req.method === 'GET') {
      return jsonResponse(res, 200, { googleClientId: GOOGLE_CLIENT_ID || null });
    }

    // Google ile giriş — sadece Google'ın doğruladığı e-postayla eşleşen VAR OLAN bir
    // hesaba giriş yaptırır (telefon/parola gerektirmez). Google kaydı kendi başına
    // yeni bir hesap AÇMAZ, çünkü sistemdeki her hesap zaten SMS ile doğrulanmış bir
    // telefon numarasına bağlı — Google'dan telefon numarası gelmez.
    if (p === '/api/auth/google-login' && req.method === 'POST') {
      if (!GOOGLE_CLIENT_ID) return jsonResponse(res, 501, { error: 'Google ile giriş henüz yapılandırılmadı.' });
      const { credential } = await readBody(req);
      let payload;
      try {
        payload = await verifyGoogleIdToken(credential);
      } catch (e) {
        return jsonResponse(res, 400, { error: 'Google doğrulaması başarısız: ' + e.message });
      }
      const found = findUserByEmail(payload.email);
      if (!found) {
        return jsonResponse(res, 404, {
          error: `Bu Google hesabıyla (${payload.email}) eşleşen bir üyelik bulunamadı. Önce normal şekilde üye ol, sonra Hesap Ayarları'ndan bu e-postayı hesabına ekle.`,
        });
      }
      const token = createSession(found.phone);
      const safeUser = redactUser(found.user);
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

    // Var olan bir alıcı hesabının kendi isteğiyle satıcıya geçmesi — kayıt anındaki
    // satıcı başvurusuyla aynı onay akışına (sellerStatus: 'pending') girer, admin onaylar.
    if (p === '/api/auth/apply-seller' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      if (session.user.role === 'satici') {
        return jsonResponse(res, 400, { error: 'Zaten satıcı hesabısın.' });
      }
      const body = await readBody(req);
      const cleanBusinessInfo = String(body.businessInfo || '').trim().slice(0, 500);
      const cleanTaxId = String(body.taxId || '').trim();
      const cleanIban = normalizeIban(body.iban);
      const cleanSellerType = VALID_SELLER_TYPES.includes(body.sellerType) ? body.sellerType : 'bireysel';
      if (cleanBusinessInfo.length < 10) {
        return jsonResponse(res, 400, { error: 'Ne/nasıl üretim yaptığını en az birkaç cümleyle anlat.' });
      }
      if (!isValidTaxIdForType(cleanTaxId, cleanSellerType)) {
        return jsonResponse(res, 400, {
          error: cleanSellerType === 'sirket'
            ? 'Geçerli bir Vergi Numarası gir (10 hane).'
            : 'Geçerli bir T.C. Kimlik No gir (11 hane).',
        });
      }
      if (!isValidIban(cleanIban)) {
        return jsonResponse(res, 400, { error: 'Geçerli bir IBAN gir (TR ile başlayan 26 karakter).' });
      }
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      user.role = 'satici';
      user.sellerStatus = 'pending';
      user.businessInfo = cleanBusinessInfo;
      user.taxId = cleanTaxId;
      user.sellerType = cleanSellerType;
      user.iban = cleanIban;
      user.sellerDocUrl = user.sellerDocUrl || null;
      user.verifiedSeller = false;
      writeJson(USERS_PATH, users);

      const safeUser = redactUser(user);
      return jsonResponse(res, 200, { user: safeUser });
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

    // ---------- Ürün Siparişleri: alıcının "Sipariş Talebi Gönder" ile açtığı, durumu takip
    // edilebilen hafif bir kayıt. Gerçek bir ödeme/sepet sistemi değil — sadece alıcının kendi
    // "Siparişlerim" ekranından durumu görmesini ve satıcının onaylayıp/reddedip ilerletmesini
    // sağlar (bkz. Kargo Takip / Ambalaj ile aynı desen). Yorum ve şikayet zaten productSlug
    // bazlı olduğundan bu kayıt sadece takip amaçlıdır, ayrıca bir bağlantı gerektirmez.

    const PRODUCT_ORDER_STATUSES = ['requested', 'confirmed', 'rejected', 'completed'];

    if (p === '/api/product-orders' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const body = await readBody(req);
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[body.productSlug];
      if (!product) return jsonResponse(res, 400, { error: 'Ürün bulunamadı' });
      // Bir satıcı kendi ürününe sipariş açıp "tamamlandı" işaretleyerek satın alma
      // şartı arayan yorum sistemini (bkz. /api/reviews) kendi ürününe sahte, doğrulanmış
      // görünen bir yorum eklemek için kullanamasın diye burada da engelliyoruz.
      if (product.sellerId === session.user.id) {
        return jsonResponse(res, 400, { error: 'Kendi ürününe sipariş talebi oluşturamazsın.' });
      }

      const quantity = Math.max(1, Math.floor(Number(body.quantity)) || 1);
      const city = String(body.city || '').trim().slice(0, 60);
      const district = String(body.district || '').trim().slice(0, 60);
      const address = String(body.address || '').trim().slice(0, 300);
      const deadline = String(body.deadline || '').trim().slice(0, 80);
      const note = String(body.note || '').trim().slice(0, 300);
      if (!city) return jsonResponse(res, 400, { error: 'Teslimat ili gerekli.' });
      if (!district) return jsonResponse(res, 400, { error: 'Teslimat ilçesi gerekli.' });
      if (!address) return jsonResponse(res, 400, { error: 'Açık adres ya da teslimat notu gerekli.' });
      if (!body.termsAccepted) return jsonResponse(res, 400, { error: 'Sipariş Şartları\'nı kabul etmelisin.' });

      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const id = 'po_' + randomToken().slice(0, 10);
      const now = new Date().toISOString();
      orders[id] = {
        id, productSlug: product.slug, productTitle: product.title,
        buyerId: session.user.id, buyerName: session.user.name, buyerPhone: session.phone,
        sellerId: product.sellerId, sellerName: product.sellerName, sellerPhone: product.sellerPhone,
        quantity, city, district, address, deadline, note,
        status: 'requested', createdAt: now, updatedAt: now,
        // Fotoğraf doğrulaması opsiyoneldir — ne satıcı gönderirken ne alıcı teslim
        // alırken fotoğraf eklemek zorunda değildir, isteyen ekler.
        sellerProofPhotoUrl: null, buyerProofPhotoUrl: null, buyerConfirmedAt: null,
        // Ödeme platform üzerinden geçmiyor (IBAN'a doğrudan havale) — bu sadece
        // alıcının "gönderdim" dediği bir öz-bildirim, gerçek transferi doğrulamaz.
        paymentSentAt: null,
        // Sipariş Şartları'nı her iki taraf da ayrı ayrı, bu sipariş özelinde kabul
        // eder — genel Kullanım Şartları'ndan (kayıt anında, bir kere) farklı olarak
        // burada her siparişte tazelenir.
        buyerTermsAcceptedAt: now, sellerTermsAcceptedAt: null,
      };
      writeJson(PRODUCT_ORDERS_PATH, orders);
      notifyUser(product.sellerPhone, 'new_product_order',
        `"${product.title}" için yeni bir sipariş talebin var (${quantity} adet, ${district}/${city}).`);
      return jsonResponse(res, 200, orders[id]);
    }

    if (p === '/api/product-orders/mine' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const mine = Object.values(orders)
        .filter((o) => o.buyerId === session.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        // Satıcının IBAN'ı siparişte sabit tutulmaz, her okumada güncel halinden
        // katılır — satıcı sonradan değiştirirse alıcı hep güncelini görsün diye.
        .map((o) => {
          const found = findUserById(o.sellerId);
          return { ...o, sellerIban: (found && found.user.iban) || null };
        });
      return jsonResponse(res, 200, { orders: mine });
    }

    if (p === '/api/admin/product-orders/mine' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const mine = Object.values(orders)
        .filter((o) => o.sellerId === session.user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return jsonResponse(res, 200, { orders: mine });
    }

    if (p === '/api/admin/product-orders/update' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { id, status, proofPhotoUrl, termsAccepted } = await readBody(req);
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const order = orders[id];
      if (!order || order.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Sipariş bulunamadı' });
      if (!PRODUCT_ORDER_STATUSES.includes(status)) return jsonResponse(res, 400, { error: 'Geçersiz durum.' });
      // Satıcı siparişi ilk kez üstlenirken (onaylarken ya da doğrudan tamamlanmış
      // işaretlerken) Sipariş Şartları'nı da kabul etmiş sayılır — reddetmek için
      // gerekmez, daha önce kabul etmişse tekrar istenmez.
      if ((status === 'confirmed' || status === 'completed') && !order.sellerTermsAcceptedAt) {
        if (!termsAccepted) return jsonResponse(res, 400, { error: 'Onaylamak için Sipariş Şartları\'nı kabul etmelisin.' });
        order.sellerTermsAcceptedAt = new Date().toISOString();
      }
      order.status = status;
      // Satıcının ürünü gönderirken/teslim ederken eklediği fotoğraf — opsiyonel.
      if (proofPhotoUrl !== undefined) {
        const clean = String(proofPhotoUrl || '').trim();
        if (clean) {
          if (!isValidProductImg(clean)) return jsonResponse(res, 400, { error: 'Geçersiz fotoğraf. Önce /api/admin/upload-image ile yükle.' });
          order.sellerProofPhotoUrl = clean;
        }
      }
      order.updatedAt = new Date().toISOString();
      writeJson(PRODUCT_ORDERS_PATH, orders);

      const STATUS_LABELS = {
        requested: 'Talep Alındı', confirmed: 'Onaylandı', rejected: 'Reddedildi', completed: 'Tamamlandı',
      };
      notifyUser(order.buyerPhone, 'product_order_update',
        `"${order.productTitle}" siparişinin durumu güncellendi: ${STATUS_LABELS[order.status]}.`);
      return jsonResponse(res, 200, order);
    }

    // Şirket/vergi mükellefi satıcının bir sipariş için fatura taslağı üretmesi. Gerçek
    // bir e-Fatura/e-Arşiv entegrasyonu değildir (GİB entegratörü gerektirir) — satıcının
    // kendi e-Fatura sistemine girerken kullanabileceği, satıcı/alıcı/kalem bilgileri hazır
    // doldurulmuş, yazdırılabilir bir taslak sunar. Aynı sipariş için tekrar çağrılırsa
    // daha önce atanmış fatura numarasını değiştirmeden aynı taslağı döner (idempotent).
    if (p === '/api/admin/product-orders/invoice' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      if (session.user.sellerType !== 'sirket') {
        return jsonResponse(res, 403, { error: 'Fatura taslağı sadece şirket/vergi mükellefi satıcılar için sunulur.' });
      }
      const { id, vatRate } = await readBody(req);
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const order = orders[id];
      if (!order || order.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Sipariş bulunamadı' });
      if (order.status !== 'confirmed' && order.status !== 'completed') {
        return jsonResponse(res, 400, { error: 'Fatura, onaylanmış ya da tamamlanmış siparişler için oluşturulabilir.' });
      }
      if (!order.invoiceNo) {
        order.invoiceNo = nextInvoiceNo(session.user.id);
        order.invoicedAt = new Date().toISOString();
        writeJson(PRODUCT_ORDERS_PATH, orders);
      }

      const products = readJson(PRODUCTS_PATH, {});
      const product = products[order.productSlug] || null;
      const unitPrice = product ? Number(String(product.price).replace(/[^\d.,]/g, '').replace(',', '.')) || 0 : null;
      const unit = product ? product.unit : '';

      const sellerInfo = {
        legalName: session.user.companyLegalName || session.user.businessInfo || session.user.name,
        taxOffice: session.user.taxOffice || '',
        taxId: session.user.taxId || '',
        address: session.user.invoiceAddress || [session.user.neighborhood, session.user.district, session.user.city].filter(Boolean).join(' / '),
        iban: session.user.iban || '',
        phone: session.phone,
      };
      const buyerInfo = {
        name: order.buyerName,
        phone: order.buyerPhone,
        address: order.address || [order.district, order.city].filter(Boolean).join(' / '),
      };
      const vatRateNum = [0, 1, 10, 20].includes(Number(vatRate)) ? Number(vatRate) : 10;
      const lineTotal = unitPrice !== null ? Math.round(unitPrice * order.quantity * 100) / 100 : null;
      const vatAmount = lineTotal !== null ? Math.round(lineTotal * (vatRateNum / 100) * 100) / 100 : null;
      const itemInfo = {
        title: order.productTitle,
        quantity: order.quantity,
        unit: unit || '',
        unitPrice,
        vatRate: vatRateNum,
        lineTotal,
        vatAmount,
        grandTotal: lineTotal !== null ? Math.round((lineTotal + vatAmount) * 100) / 100 : null,
      };

      // Satıcı Hesap Ayarları'ndan bir e-Fatura entegratörü (şu an: Nilvera) bağladıysa,
      // taslak yerine gerçek bir e-Arşiv fatura kesmeyi dener; başarısız olursa (ya da
      // hiç bağlı değilse) mevcut yazdırılabilir taslak akışı sorunsuz devam eder —
      // otomatik kesim "şart değil, kolaylık" (bkz. ilgili konuşma).
      const rawUser = readJson(USERS_PATH, {})[session.phone];
      let einvoiceError = null;
      if (!order.providerInvoiceNo && rawUser && rawUser.einvoiceApiKey) {
        const cutArgs = {
          apiKey: rawUser.einvoiceApiKey, env: rawUser.einvoiceEnv || 'test',
          invoiceNo: order.invoiceNo, issueDate: order.invoicedAt,
          seller: sellerInfo, buyer: buyerInfo,
          item: itemInfo,
        };
        // Testlerde gerçek Nilvera API'sine ağ isteği atmıyoruz (bkz. IS_TEST_ENV deseni,
        // SMS OTP'de olduğu gibi) — sahte bir anahtarla deterministik olarak simüle ederiz.
        const result = IS_TEST_ENV
          ? (rawUser.einvoiceApiKey === 'FAIL_TEST_KEY'
            ? { ok: false, error: 'Test: geçersiz API anahtarı.' }
            : { ok: true, providerInvoiceNo: 'TEST-' + order.invoiceNo, pdfUrl: null })
          : await cutNilveraArchiveInvoice(cutArgs);
        if (result.ok) {
          order.einvoiceProvider = 'nilvera';
          order.providerInvoiceNo = result.providerInvoiceNo;
          order.providerPdfUrl = result.pdfUrl;
          order.einvoiceCutAt = new Date().toISOString();
          writeJson(PRODUCT_ORDERS_PATH, orders);
        } else {
          einvoiceError = result.error;
        }
      }

      return jsonResponse(res, 200, {
        invoiceNo: order.invoiceNo,
        issuedAt: order.invoicedAt,
        seller: sellerInfo,
        buyer: buyerInfo,
        item: itemInfo,
        einvoice: order.providerInvoiceNo
          ? { provider: order.einvoiceProvider, providerInvoiceNo: order.providerInvoiceNo, pdfUrl: order.providerPdfUrl || null }
          : null,
        einvoiceError,
      });
    }

    // Alıcının "teslim aldım" onayı — durum makinesinden bağımsız, opsiyonel bir
    // fotoğrafla birlikte kaydedilir. Satıcının durumu ne olursa olsun alıcı istediği
    // an teslim aldığını işaretleyebilir (isteyen ekler, zorunlu değil).
    if (p === '/api/product-orders/confirm-receipt' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { id, proofPhotoUrl } = await readBody(req);
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const order = orders[id];
      if (!order || order.buyerId !== session.user.id) return jsonResponse(res, 404, { error: 'Sipariş bulunamadı' });
      const clean = String(proofPhotoUrl || '').trim();
      if (clean) {
        if (!isValidProductImg(clean)) return jsonResponse(res, 400, { error: 'Geçersiz fotoğraf. Önce /api/admin/upload-image ile yükle.' });
        order.buyerProofPhotoUrl = clean;
      }
      order.buyerConfirmedAt = new Date().toISOString();
      order.updatedAt = order.buyerConfirmedAt;
      writeJson(PRODUCT_ORDERS_PATH, orders);
      notifyUser(order.sellerPhone, 'product_order_receipt_confirmed',
        `"${order.productTitle}" siparişini alıcı teslim aldığını onayladı.`);
      return jsonResponse(res, 200, order);
    }

    // Alıcının "IBAN'a ödemeyi gönderdim" öz-bildirimi — platform ödemeyi işlemez,
    // bu sadece satıcıya "artık kontrol edebilirsin" bildirimi göndermek içindir.
    if (p === '/api/product-orders/mark-payment-sent' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { id } = await readBody(req);
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const order = orders[id];
      if (!order || order.buyerId !== session.user.id) return jsonResponse(res, 404, { error: 'Sipariş bulunamadı' });
      order.paymentSentAt = new Date().toISOString();
      order.updatedAt = order.paymentSentAt;
      writeJson(PRODUCT_ORDERS_PATH, orders);
      notifyUser(order.sellerPhone, 'product_order_payment_sent',
        `"${order.productTitle}" siparişi için alıcı ödemeyi IBAN'a gönderdiğini bildirdi. Hesabını kontrol et.`);
      return jsonResponse(res, 200, order);
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

    // Satıcı bazında ortalama puan + tamamlanmış satış sayısı — anasayfada "satıcı
    // puanına göre sırala" ve "en az N satış yapmış, puanı Y üzeri satıcılar" gibi
    // filtreler için (bkz. main/assets/filter.js). Ürün bazlı /api/reviews/stats'tan
    // farklı olarak buradaki puan, satıcının TÜM ürünlerindeki onaylı yorumların ortalamasıdır.
    if (p === '/api/sellers/stats' && req.method === 'GET') {
      const products = readJson(PRODUCTS_PATH, {});
      const reviewStore = readJson(REVIEWS_PATH, {});
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const slugToSeller = {};
      Object.values(products).forEach((prod) => { slugToSeller[prod.slug] = prod.sellerId; });

      const ratingBySeller = {}; // sellerId -> { sum, count }
      for (const slug of Object.keys(reviewStore)) {
        const sellerId = slugToSeller[slug];
        if (!sellerId) continue;
        const list = (reviewStore[slug] || []).filter((rv) => rv.status !== 'pending' && rv.status !== 'rejected');
        if (!list.length) continue;
        const entry = ratingBySeller[sellerId] || { sum: 0, count: 0 };
        list.forEach((rv) => { entry.sum += rv.rating; entry.count += 1; });
        ratingBySeller[sellerId] = entry;
      }

      const salesBySeller = {};
      Object.values(orders).forEach((o) => {
        if (o.status !== 'completed') return;
        salesBySeller[o.sellerId] = (salesBySeller[o.sellerId] || 0) + 1;
      });

      const sellerIds = new Set([...Object.keys(ratingBySeller), ...Object.keys(salesBySeller)]);
      const stats = {};
      sellerIds.forEach((sellerId) => {
        const r = ratingBySeller[sellerId];
        stats[sellerId] = {
          avgRating: r ? r.sum / r.count : null,
          reviewCount: r ? r.count : 0,
          salesCount: salesBySeller[sellerId] || 0,
        };
      });
      return jsonResponse(res, 200, stats);
    }

    // Yorum onay kuralı: 4-5 yıldız (olumlu) doğrudan yayınlanır; 1-3 yıldız admin onayına düşer.
    // Sadece bu üründen tamamlanmış (ya da alıcının teslim aldığını onayladığı) bir
    // siparişi olan hesaplar yorum yapabilir — aksi halde hiç almadığın bir ürüne
    // yorum yazabilirdin, bu da hem sahte olumlu hem kötü niyetli olumsuz yorumlara açık kapı olurdu.
    if (p === '/api/reviews' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { productSlug, rating, text } = await readBody(req);
      const r = Number(rating);
      const clean = String(text || '').trim().slice(0, 1000);
      if (!productSlug || !r || r < 1 || r > 5 || !clean) {
        return jsonResponse(res, 400, { error: 'Ürün, puan (1-5) ve yorum metni gerekli' });
      }
      const product = readJson(PRODUCTS_PATH, {})[productSlug];
      if (!product) return jsonResponse(res, 400, { error: 'Ürün bulunamadı' });
      if (product.sellerId === session.user.id) {
        return jsonResponse(res, 400, { error: 'Kendi ürününe yorum yapamazsın.' });
      }
      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const hasPurchase = Object.values(orders).some((o) => (
        o.buyerId === session.user.id && o.productSlug === productSlug &&
        (o.status === 'completed' || !!o.buyerConfirmedAt)
      ));
      if (!hasPurchase) {
        return jsonResponse(res, 403, { error: 'Bu ürünü satın almadan yorum yapamazsın. Sipariş tamamlandıktan sonra değerlendirebilirsin.' });
      }
      const store = readJson(REVIEWS_PATH, {});
      store[productSlug] = store[productSlug] || [];
      const status = r >= 4 ? 'approved' : 'pending';
      const mine = store[productSlug].find((rv) => rv.userId === session.user.id);
      if (mine) {
        mine.rating = r; mine.text = clean; mine.createdAt = new Date().toISOString(); mine.status = status;
        mine.sellerReply = null;
        mine.dispute = null;
      } else {
        store[productSlug].push({
          id: 'r_' + randomToken().slice(0, 10), userId: session.user.id, name: session.user.name,
          role: session.user.role, rating: r, text: clean, createdAt: new Date().toISOString(),
          status, sellerReply: null, dispute: null,
        });
      }
      writeJson(REVIEWS_PATH, store);

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

    // Satıcının kendi ürününe gelen (yayında olan) haksız/kötü niyetli bulduğu bir yoruma
    // itiraz etmesi — bir yanıt yazmaktan farklı: burada admin'den yorumu incelemesini ve
    // gerekirse kaldırmasını istiyor. Bir yoruma aynı anda sadece bir açık itiraz olabilir.
    if (p === '/api/admin/reviews/dispute' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { productSlug, reviewId, text } = await readBody(req);
      const clean = String(text || '').trim().slice(0, 1000);
      if (!clean) return jsonResponse(res, 400, { error: 'İtiraz gerekçeni yaz.' });
      const products = readJson(PRODUCTS_PATH, {});
      const product = products[productSlug];
      if (!product || product.sellerId !== session.user.id) return jsonResponse(res, 404, { error: 'Ürün bulunamadı' });
      const store = readJson(REVIEWS_PATH, {});
      const review = (store[productSlug] || []).find((rv) => rv.id === reviewId);
      if (!review) return jsonResponse(res, 404, { error: 'Yorum bulunamadı' });
      if (review.status !== 'approved') return jsonResponse(res, 400, { error: 'Sadece yayındaki yorumlara itiraz edilebilir.' });
      if (review.dispute && review.dispute.status === 'pending') {
        return jsonResponse(res, 400, { error: 'Bu yorum için zaten incelemesi süren bir itirazın var.' });
      }
      review.dispute = { text: clean, createdAt: new Date().toISOString(), status: 'pending', resolvedAt: null, adminNote: '' };
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
      const {
        name, city, district, neighborhood, email, iban, companyLegalName, taxOffice, invoiceAddress,
        einvoiceApiKey, einvoiceEnv, einvoiceDisconnect,
      } = await readBody(req);
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
        // E-posta ile de giriş yapılabildiğinden (bkz. /api/auth/login) tekil olmalı —
        // aksi halde hangi hesaba girileceği belirsizleşirdi.
        if (cleanEmail) {
          const owner = findUserByEmail(cleanEmail);
          if (owner && owner.phone !== session.phone) {
            return jsonResponse(res, 400, { error: 'Bu e-posta adresi başka bir hesapta kayıtlı.' });
          }
        }
      }
      if (iban !== undefined && normalizeIban(iban) && !isValidIban(iban)) {
        return jsonResponse(res, 400, { error: 'Geçerli bir IBAN gir (TR ile başlayan 26 karakter).' });
      }
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      user.name = cleanName;
      user.city = cleanCity;
      if (district !== undefined) user.district = String(district).trim().slice(0, 60);
      if (neighborhood !== undefined) user.neighborhood = String(neighborhood).trim().slice(0, 80);
      if (email !== undefined) user.email = String(email || '').trim().slice(0, 120);
      if (iban !== undefined) user.iban = normalizeIban(iban);
      // Fatura taslağında kullanılan, "İşletme/Üretim Açıklaması"ndan ayrı, resmi
      // şirket bilgileri — sadece şirket/vergi mükellefi satıcılar için anlamlı.
      if (companyLegalName !== undefined) user.companyLegalName = String(companyLegalName || '').trim().slice(0, 150);
      if (taxOffice !== undefined) user.taxOffice = String(taxOffice || '').trim().slice(0, 100);
      if (invoiceAddress !== undefined) user.invoiceAddress = String(invoiceAddress || '').trim().slice(0, 300);
      // Otomatik e-Fatura entegratör bağlantısı (Nilvera) — anahtar alanı maskeli
      // gösterildiğinden (bkz. redactUser) boş gönderilmesi "değiştirme" anlamına gelir;
      // gerçekten kaldırmak için ayrı bir einvoiceDisconnect bayrağı gerekir.
      if (einvoiceDisconnect) {
        delete user.einvoiceApiKey;
        delete user.einvoiceProvider;
        delete user.einvoiceEnv;
      } else {
        if (einvoiceApiKey !== undefined && String(einvoiceApiKey).trim()) {
          user.einvoiceApiKey = String(einvoiceApiKey).trim().slice(0, 300);
          user.einvoiceProvider = 'nilvera';
        }
        if (einvoiceEnv !== undefined && ['test', 'live'].includes(einvoiceEnv)) {
          user.einvoiceEnv = einvoiceEnv;
        }
      }
      writeJson(USERS_PATH, users);
      const safeUser = redactUser(user);
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
      const safeUser = redactUser(user);
      return jsonResponse(res, 200, { user: safeUser });
    }

    // Satıcı başvurusuna destekleyici belge (kimlik, vergi levhası, çiftçi kayıt belgesi vb.) ekleme.
    // Onay durumunu değiştirmez — sadece admin'in inceleyeceği belgeyi ekler.
    if (p === '/api/auth/seller-application/doc' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { docUrl } = await readBody(req);
      const clean = String(docUrl || '').trim();
      if (!isValidSecureFilename(clean)) return jsonResponse(res, 400, { error: 'Geçersiz belge. Önce /api/admin/upload-doc ile (secure:true) yükle.' });
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      user.sellerDocUrl = clean;
      writeJson(USERS_PATH, users);
      const safeUser = redactUser(user);
      return jsonResponse(res, 200, { user: safeUser });
    }

    // Kimlik belgesi — "Destekleyici Belge"den ayrı, bilerek: KVKK md.5 kapsamında
    // ayrı ve açık rıza gerektirir (idDocConsent olmadan kaydedilmez). Sadece admin
    // görebilir (bkz. owner-admin.html Satıcılar sekmesi), satıcı doğrulama dışında
    // bir amaçla kullanılmaz.
    if (p === '/api/auth/seller-application/id-doc' && req.method === 'POST') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const { docUrl, idDocConsent } = await readBody(req);
      const clean = String(docUrl || '').trim();
      if (!isValidSecureFilename(clean)) return jsonResponse(res, 400, { error: 'Geçersiz belge. Önce /api/admin/upload-doc ile (secure:true) yükle.' });
      if (!idDocConsent) return jsonResponse(res, 400, { error: 'Kimlik belgeni kaydetmek için açık rıza vermelisin.' });
      const users = readJson(USERS_PATH, {});
      const user = users[session.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      user.idDocUrl = clean;
      user.idDocConsentAt = new Date().toISOString();
      writeJson(USERS_PATH, users);
      const safeUser = redactUser(user);
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
      if (!isValidPassword(next)) return jsonResponse(res, 400, { error: 'Yeni parola en az 8 karakter olmalı, en az bir harf ve bir rakam içermeli.' });
      user.passwordHash = hashPassword(next);
      writeJson(USERS_PATH, users);
      return jsonResponse(res, 200, { ok: true });
    }

    // Şifremi unuttum — telefon ya da e-posta ile bir sıfırlama bağlantısı ister.
    // Hesabın var olup olmadığını sızdırmamak için sonuç her zaman aynı genel
    // mesajla döner; bağlantı sadece eşleşen bir hesap bulunursa gerçekten gönderilir.
    if (p === '/api/auth/forgot-password' && req.method === 'POST') {
      const { identifier } = await readBody(req);
      const rawIdentifier = String(identifier || '').trim();
      const rateKey = 'forgot:' + clientIp + ':' + (rawIdentifier.includes('@') ? rawIdentifier.toLowerCase() : normalizePhone(rawIdentifier));
      if (isLoginRateLimited(rateKey)) {
        return jsonResponse(res, 429, { error: 'Çok fazla deneme. Lütfen biraz sonra tekrar dene.' });
      }
      recordFailedLogin(rateKey); // her deneme sayılır (başarılı olsa da) — bağlantı isteği tekrar tekrar tetiklenemesin diye
      // NOT: Bu uç nokta bilerek hesabın var olup olmadığını netçe söylüyor (kullanıcı
      // isteği üzerine — "bulunamadı" demesi gerekiyor) — çoğu sitenin tercih ettiği
      // "varsa gönderildi" belirsiz mesajı burada KASITLI olarak kullanılmıyor. Bunun
      // bedeli: biri rastgele telefon/e-posta deneyerek hangilerinin kayıtlı olduğunu
      // öğrenebilir (hesap numaralandırma). Zaten var olan genel hız sınırlaması
      // (isLoginRateLimited) bunu tamamen engellemez, sadece yavaşlatır.
      if (!rawIdentifier) return jsonResponse(res, 400, { error: 'Telefon numaranı ya da e-postanı gir.' });
      const found = findUserByIdentifier(rawIdentifier);
      if (!found) return jsonResponse(res, 404, { error: 'Bu bilgilerle kayıtlı bir hesap bulunamadı.' });
      const token = randomToken();
      passwordResetTokens.set(token, { phone: found.phone, at: Date.now() });
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const link = `${proto}://${req.headers.host}/sifremi-sifirla.html?token=${token}`;
      sendPasswordResetLink(found.user, found.phone, link).catch(() => {});
      const okMsg = { ok: true, message: 'Şifre sıfırlama bağlantısı gönderildi.' };
      // Testler gerçek bir SMS/e-posta alamayacağından (bkz. IS_TEST_ENV), token'ı
      // sadece izole test ortamında yanıta da ekliyoruz — production'da asla.
      if (IS_TEST_ENV) okMsg.devToken = token;
      return jsonResponse(res, 200, okMsg);
    }

    if (p === '/api/auth/reset-password' && req.method === 'POST') {
      const { token, password } = await readBody(req);
      const entry = passwordResetTokens.get(String(token || ''));
      if (!entry || Date.now() - entry.at > RESET_TOKEN_TTL_MS) {
        return jsonResponse(res, 400, { error: 'Bağlantının süresi dolmuş ya da geçersiz. Şifremi unuttum\'u yeniden dene.' });
      }
      const next = String(password || '');
      if (!isValidPassword(next)) {
        return jsonResponse(res, 400, { error: 'Yeni parola en az 8 karakter olmalı, en az bir harf ve bir rakam içermeli.' });
      }
      const users = readJson(USERS_PATH, {});
      const user = users[entry.phone];
      if (!user) return jsonResponse(res, 404, { error: 'Hesap bulunamadı' });
      user.passwordHash = hashPassword(next);
      writeJson(USERS_PATH, users);
      passwordResetTokens.delete(String(token));

      // Şifre sıfırlanınca, hesabı ele geçirmiş biri varsa onu da çıkarmak için
      // bu hesabın tüm açık oturumlarını kapatıyoruz — yeniden giriş yapman gerekecek.
      const sessions = readJson(SESSIONS_PATH, {});
      for (const t of Object.keys(sessions)) {
        if (sessions[t].phone === entry.phone) delete sessions[t];
      }
      writeJson(SESSIONS_PATH, sessions);

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

    // ---------- Satıcı özet paneli: ürün/sipariş/yorum/şikayet sayılarının tek bakışta özeti ----------

    if (p === '/api/admin/dashboard' && req.method === 'GET') {
      const session = requireRole(req, res, 'satici');
      if (!session) return;
      const products = readJson(PRODUCTS_PATH, {});
      const myProducts = Object.values(products).filter((prod) => prod.sellerId === session.user.id);
      const mySlugs = new Set(myProducts.map((p) => p.slug));

      const reviewsStore = readJson(REVIEWS_PATH, {});
      let ratingSum = 0, ratingCount = 0;
      mySlugs.forEach((slug) => {
        (reviewsStore[slug] || []).forEach((r) => {
          if (r.status === 'pending' || r.status === 'rejected') return;
          ratingSum += r.rating; ratingCount++;
        });
      });

      const orders = readJson(PRODUCT_ORDERS_PATH, {});
      const myOrders = Object.values(orders).filter((o) => o.sellerId === session.user.id);
      const ordersByStatus = { requested: 0, confirmed: 0, rejected: 0, completed: 0 };
      myOrders.forEach((o) => { if (ordersByStatus[o.status] !== undefined) ordersByStatus[o.status]++; });
      const recentOrders = myOrders
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        .map((o) => ({ id: o.id, productTitle: o.productTitle, buyerName: o.buyerName, status: o.status, createdAt: o.createdAt }));

      const complaints = readJson(COMPLAINTS_PATH, {});
      const openComplaints = Object.values(complaints).filter((c) => c.sellerId === session.user.id && c.status !== 'resolved').length;

      return jsonResponse(res, 200, {
        productCount: myProducts.length,
        activeProductCount: myProducts.filter((p) => p.active !== false).length,
        avgRating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
        reviewCount: ratingCount,
        ordersByStatus,
        totalOrders: myOrders.length,
        openComplaints,
        recentOrders,
      });
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
      // Not: sadece satıcı ürün/organik belgesi değil, alıcı da sipariş teslim alma
      // fotoğrafı (bkz. /api/product-orders/confirm-receipt) için bunu kullanır —
      // bu yüzden herhangi bir giriş yapmış kullanıcıya açık, sadece satıcıya değil.
      const session = requireAuth(req, res);
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
      const { dataUrl, secure } = await readBody(req);
      try {
        // Kimlik/vergi levhası/organik belgesi gibi hassas dosyalar secure:true ile
        // gönderilir — statik sunucunun dışında saklanır, sadece imzalı bağlantıyla
        // görüntülenir (bkz. saveSecureDoc). Sertifika gibi kasıtlı herkese açık
        // dosyalar için secure gönderilmez, eskisi gibi genel /assets/uploads'a yazılır.
        return jsonResponse(res, 200, secure ? saveSecureDoc(dataUrl) : saveUploadedDoc(dataUrl));
      } catch (e) {
        return jsonResponse(res, 400, { error: e.message });
      }
    }

    // ---------- Ürünler: satıcılar kendi ilanlarını ekler/düzenler/kaldırır ----------

    if (p === '/api/products' && req.method === 'GET') {
      const products = readJson(PRODUCTS_PATH, {});
      const infoMap = sellerInfoMap();
      const list = Object.values(products).filter((prod) => prod.active !== false).map((prod) => withSellerBadge(prod, infoMap));
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
      if (organic && !isValidSecureFilename(organicDocUrl)) {
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
        if (organic && !isValidSecureFilename(organicDocUrl)) {
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
      const loginKey = 'owner:' + clientIp;
      if (isLoginRateLimited(loginKey)) {
        return jsonResponse(res, 429, { error: 'Çok fazla hatalı deneme. Lütfen biraz sonra tekrar dene.' });
      }
      const { password } = await readBody(req);
      const attempt = Buffer.from(String(password || ''));
      const expected = Buffer.from(ADMIN_PASSWORD);
      const passwordOk = attempt.length === expected.length && crypto.timingSafeEqual(attempt, expected);
      if (!passwordOk) {
        recordFailedLogin(loginKey);
        return jsonResponse(res, 401, { error: 'Parola hatalı.' });
      }
      clearLoginAttempts(loginKey);
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
      const safeUsers = Object.values(users).map(redactUser);
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

    // Satıcının bir yoruma açtığı itirazı admin sonuçlandırır: "haklı" bulunursa yorum
    // yayından kaldırılır (rejected — bkz. GET /api/reviews filtresi, artık halka açık
    // görünmez ve istatistiklere girmez); "haksız" bulunursa yorum olduğu gibi kalır.
    if (p === '/api/owner/reviews/dispute/resolve' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { productSlug, reviewId, status, adminNote } = await readBody(req);
      if (!['upheld', 'rejected'].includes(status)) return jsonResponse(res, 400, { error: 'Geçersiz durum.' });
      const store = readJson(REVIEWS_PATH, {});
      const review = (store[productSlug] || []).find((rv) => rv.id === reviewId);
      if (!review) return jsonResponse(res, 404, { error: 'Yorum bulunamadı' });
      if (!review.dispute || review.dispute.status !== 'pending') {
        return jsonResponse(res, 400, { error: 'Bu yorum için bekleyen bir itiraz yok.' });
      }
      review.dispute.status = status;
      review.dispute.resolvedAt = new Date().toISOString();
      review.dispute.adminNote = String(adminNote || '').trim().slice(0, 500);
      if (status === 'upheld') review.status = 'rejected';
      writeJson(REVIEWS_PATH, store);

      const products = readJson(PRODUCTS_PATH, {});
      const product = products[productSlug];
      if (product) {
        notifyUser(product.sellerPhone, 'review_dispute_resolved', status === 'upheld'
          ? `"${product.title}" ürünündeki yoruma itirazın haklı bulundu, yorum kaldırıldı.`
          : `"${product.title}" ürünündeki yoruma itirazın incelendi, yorum yayında kalmaya devam ediyor.`);
      }
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
          const safeUser = redactUser(u);
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

      const safeUser = redactUser(user);
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
      const safeUser = redactUser(user);
      return jsonResponse(res, 200, { user: safeUser });
    }

    // Admin'in bir satıcının IBAN'ını ve satıcı türünü (bireysel/şirket) elle
    // düzenlemesi — ör. satıcı kendi ayarlamadıysa ya da bir hata düzeltilecekse.
    // Satıcının kendi update-profile'ından farklı olarak burada owner yetkisi gerekir
    // ve satıcı onayı beklenmez; IBAN yanlış girilirse gerçek paranın yanlış hesaba
    // gitmesine yol açacağından format sıkı doğrulanır.
    if (p === '/api/owner/sellers/update' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { phone, iban, sellerType } = await readBody(req);
      const users = readJson(USERS_PATH, {});
      const user = users[phone];
      if (!user || user.role !== 'satici') return jsonResponse(res, 404, { error: 'Satıcı bulunamadı' });
      if (iban !== undefined) {
        const cleanIban = normalizeIban(iban);
        if (cleanIban && !isValidIban(cleanIban)) {
          return jsonResponse(res, 400, { error: 'Geçerli bir IBAN gir (TR ile başlayan 26 karakter) ya da boş bırak.' });
        }
        user.iban = cleanIban;
      }
      if (sellerType !== undefined) {
        if (!VALID_SELLER_TYPES.includes(sellerType)) return jsonResponse(res, 400, { error: 'Geçersiz satıcı türü.' });
        user.sellerType = sellerType;
      }
      writeJson(USERS_PATH, users);
      const safeUser = redactUser(user);
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

    // Hassas belgeler (kimlik, vergi levhası, organik belgesi) doğrudan bir URL
    // olarak saklanmaz — admin görüntülemek istediğinde burada 5 dakika geçerli,
    // tek dosyaya özel imzalı bir bağlantı üretilir (bkz. GET /secure-uploads).
    if (p === '/api/owner/sign-file-url' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const { filename } = await readBody(req);
      if (!isValidSecureFilename(filename)) return jsonResponse(res, 400, { error: 'Geçersiz dosya.' });
      const { exp, sig } = signFileToken(filename);
      return jsonResponse(res, 200, { url: `/secure-uploads/${filename}?exp=${exp}&sig=${sig}` });
    }

    // Kullanıcının kendi yüklediği kimlik/destekleyici belgeyi geri görüntülemesi —
    // sadece kendi hesabına ait dosya için, admin yetkisi gerekmez.
    if (p === '/api/auth/sign-own-file-url' && req.method === 'POST') {
      const session = requireAuth(req, res);
      if (!session) return;
      const { filename } = await readBody(req);
      if (!isValidSecureFilename(filename)) return jsonResponse(res, 400, { error: 'Geçersiz dosya.' });
      if (session.user.idDocUrl !== filename && session.user.sellerDocUrl !== filename) {
        return jsonResponse(res, 403, { error: 'Bu dosya sana ait değil.' });
      }
      const { exp, sig } = signFileToken(filename);
      return jsonResponse(res, 200, { url: `/secure-uploads/${filename}?exp=${exp}&sig=${sig}` });
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

  // Hassas belgeler: sadece geçerli, süresi geçmemiş imzalı bir bağlantıyla
  // servis edilir (bkz. /api/owner/sign-file-url, /api/auth/sign-own-file-url).
  // Klasör statik sunucunun (koyludostu-tumsite/) dışında olduğundan buradan
  // geçmeyen hiçbir istek bu dosyalara erişemez.
  const secureMatch = p.match(/^\/secure-uploads\/([A-Za-z0-9_.-]+)$/);
  if (secureMatch) {
    const filename = secureMatch[1];
    const exp = url.searchParams.get('exp');
    const sig = url.searchParams.get('sig');
    if (!isValidSecureFilename(filename) || !isValidFileToken(filename, exp, sig)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Bağlantının süresi dolmuş ya da geçersiz.');
      return;
    }
    const filePath = path.join(SECURE_UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Dosya bulunamadı');
      return;
    }
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };
    const mime = mimeMap[path.extname(filename).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, no-store' });
    res.end(fs.readFileSync(filePath));
    return;
  }

  return serveStatic(res, MAIN, p);
});

server.listen(PORT, HOST, () => {
  console.log(`köylüdostu  http://localhost:${PORT}         (main)`);
  console.log(`            http://localhost:${PORT}/blog     (blog)`);
  console.log(`            http://localhost:${PORT}/haber    (haber)`);
  console.log(`            http://localhost:${PORT}/haber/admin  (ajan ayarları)`);
  console.log(`            http://localhost:${PORT}/sosyal   (sosyal)`);
});
