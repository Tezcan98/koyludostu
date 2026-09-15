(function () {
  // Ürün başlığı/kategori/şehir/birim/satıcı adı gibi alanlar satıcının kendi girdiği
  // serbest metin — bir script etiketiyle gönderilirse bunu okuyan HER ziyaretçinin
  // (giriş yapmamış olsa bile) tarayıcısında çalışır. KDAuth henüz yüklenmemiş
  // olabileceğinden (bazı sayfalarda script sırası garanti değil) burada bağımsız
  // bir kaçışlama fonksiyonu tanımlıyoruz.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.getElementById('productGrid');
    if (!grid) return;

    var catWrap = document.getElementById('catChecks');
    var cityWrap = document.getElementById('cityChecks');
    var attrGroup = document.getElementById('attrGroup');
    var attrWrap = document.getElementById('attrChecks');
    var deliveryRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="delivery"]'));
    var sellerTypeRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="sellerType"]'));
    var organicCheckbox = document.getElementById('fOrganicOnly');
    var verifiedCheckbox = document.getElementById('fVerifiedOnly');
    var minSellerRatingSelect = document.getElementById('fMinSellerRating');
    var minSellerSalesSelect = document.getElementById('fMinSellerSales');
    var searchInput = document.getElementById('fSearch');
    var sort = document.getElementById('fSort');
    var resetBtn = document.getElementById('fReset');
    var countEl = document.getElementById('urunCount');
    var toggleBtn = document.getElementById('filterToggle');
    var panel = document.getElementById('filterPanel');
    var badge = document.getElementById('filterBadge');

    toggleBtn.addEventListener('click', function () { panel.hidden = !panel.hidden; });

    var allProducts = [];
    var reviewStats = {};
    var sellerStats = {}; // sellerId -> { avgRating, reviewCount, salesCount } — bkz. GET /api/sellers/stats

    // ---------- "Öne Çıkanlar" (varsayılan) sıralama algoritması ----------
    // Varsayılan sıralama şu sinyalleri birleştiren bir puana göre yapılır:
    //   1) Ortalama değerlendirme puanı   -> gerçek alıcı memnuniyeti (en ağırlıklı sinyal)
    //   2) Yorum sayısı                   -> güven/popülerlik, 15'te tavanlanır
    //   3) Tazelik bonusu                 -> yeni eklenen ürünler ilk 14 gün görünürlük kazanır
    //   4) Günlük adil rotasyon           -> ürün+gün bazlı deterministik küçük rastgelelik
    //   5) Öne çıkarma bonusu             -> owner-admin panelinden manuel olarak işaretlenirse sabit bir puan eklenir
    function hashToUnit(str) {
      var h = 5381;
      for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
      return (h >>> 0) / 4294967295;
    }

    function defaultScore(p) {
      var stat = reviewStats[p.slug] || { avg: 0, count: 0 };
      var listedDaysAgo = (Date.now() - new Date(p.createdAt).getTime()) / 86400000;
      var ratingScore = stat.avg * 20;
      var trustScore = Math.min(stat.count, 15) * 3;
      var freshnessScore = Math.max(0, 14 - listedDaysAgo) * 2;
      var today = new Date().toISOString().slice(0, 10);
      var rotationJitter = hashToUnit(p.slug + today) * 6;
      var featuredBonus = p.featured ? 40 : 0;
      return ratingScore + trustScore + freshnessScore + rotationJitter + featuredBonus;
    }

    function pinHtml(p) {
      var priceNum = parseInt(String(p.price).replace(/\D/g, ''), 10) || 0;
      var imgSrc = /^\d+$/.test(String(p.img)) ?
        'https://images.pexels.com/photos/' + p.img + '/pexels-photo-' + p.img + '.jpeg?auto=compress&cs=tinysrgb&w=700' : p.img;
      var sellerBadge = p.sellerVerified ? ' <span class="seller-badge" title="Güvenilir Satıcı">✅</span>' : '';
      var titleAttr = esc(p.title);
      return '<a class="pin" href="urun/' + encodeURIComponent(p.slug) + '.html" data-cat="' + esc(p.cat) + '" data-price="' + priceNum +
        '" data-title="' + titleAttr + '" data-city="' + esc(p.city) + '" data-delivery="' + esc(p.delivery.join(',')) +
        '" data-created="' + esc(p.createdAt) + '" data-slug="' + esc(p.slug) + '">' +
        '<img src="' + imgSrc + '" alt="' + titleAttr + '" loading="lazy">' +
        '<div class="pin-overlay">' +
          '<div class="pin-cat">' + esc(p.cat) + ' · ' + esc(p.sellerName) + sellerBadge + '</div>' +
          '<div class="pin-title">' + titleAttr + '</div>' +
          '<div class="pin-foot"><div class="pin-price">' + esc(p.price) + '<br><small>' + esc(p.unit) + '</small></div>' +
        '<button type="button" class="fav-cta pin-fav" data-id="' + esc(p.slug) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></button></div>' +
        '</div>' +
      '</a>';
    }

    function checkedValues(list) {
      return list.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    }

    function apply() {
      var cats = checkedValues(Array.prototype.slice.call(catWrap.querySelectorAll('input')));
      var cities = checkedValues(Array.prototype.slice.call(cityWrap.querySelectorAll('input')));
      var attrVals = checkedValues(Array.prototype.slice.call(attrWrap.querySelectorAll('.attrCheck')));
      var onlyOrganic = organicCheckbox.checked;
      var onlyVerified = verifiedCheckbox.checked;
      var deliveryEl = deliveryRadios.filter(function (r) { return r.checked; })[0];
      var delivery = deliveryEl ? deliveryEl.value : '__all__';
      var sellerTypeEl = sellerTypeRadios.filter(function (r) { return r.checked; })[0];
      var sellerType = sellerTypeEl ? sellerTypeEl.value : '__all__';
      var minSellerRating = parseFloat(minSellerRatingSelect.value) || 0;
      var minSellerSales = parseInt(minSellerSalesSelect.value, 10) || 0;

      var activeCount = cats.length + cities.length + attrVals.length + (onlyOrganic ? 1 : 0) + (onlyVerified ? 1 : 0) +
        (delivery !== '__all__' ? 1 : 0) + (sellerType !== '__all__' ? 1 : 0) + (minSellerRating > 0 ? 1 : 0) + (minSellerSales > 0 ? 1 : 0);
      badge.hidden = activeCount === 0;
      badge.textContent = activeCount;

      var query = searchInput.value.trim().toLocaleLowerCase('tr');

      var visible = allProducts.filter(function (p) {
        var okCat = cats.length === 0 || cats.indexOf(p.cat) !== -1;
        var okCity = cities.length === 0 || cities.indexOf(p.city) !== -1;
        var okDelivery = delivery === '__all__' || p.delivery.indexOf(delivery) !== -1;
        var pAttrVals = p.attrs ? Object.keys(p.attrs).map(function (k) { return p.attrs[k]; }) : [];
        var okAttrs = attrVals.every(function (v) { return pAttrVals.indexOf(v) !== -1; });
        var okOrganic = !onlyOrganic || (p.organic && p.organicApproved);
        var okVerified = !onlyVerified || p.sellerVerified;
        var okSellerType = sellerType === '__all__' || p.sellerType === sellerType;
        var sStat = sellerStats[p.sellerId] || { avgRating: null, salesCount: 0 };
        var okSellerRating = minSellerRating <= 0 || (sStat.avgRating !== null && sStat.avgRating >= minSellerRating);
        var okSellerSales = minSellerSales <= 0 || sStat.salesCount >= minSellerSales;
        var okSearch = !query || [p.title, p.cat, p.city, p.sellerName, p.description]
          .join(' ').toLocaleLowerCase('tr').indexOf(query) !== -1;
        return okCat && okCity && okDelivery && okAttrs && okOrganic && okVerified && okSellerType && okSellerRating && okSellerSales && okSearch;
      });

      var sortVal = sort.value;
      visible.sort(function (a, b) {
        if (sortVal === 'price-asc') return (parseInt(String(a.price).replace(/\D/g, ''), 10) || 0) - (parseInt(String(b.price).replace(/\D/g, ''), 10) || 0);
        if (sortVal === 'price-desc') return (parseInt(String(b.price).replace(/\D/g, ''), 10) || 0) - (parseInt(String(a.price).replace(/\D/g, ''), 10) || 0);
        if (sortVal === 'name-asc') return a.title.localeCompare(b.title, 'tr');
        if (sortVal === 'seller-rating-desc') {
          var ra = (sellerStats[a.sellerId] || {}).avgRating || 0;
          var rb = (sellerStats[b.sellerId] || {}).avgRating || 0;
          return rb - ra;
        }
        return defaultScore(b) - defaultScore(a);
      });

      grid.innerHTML = visible.map(pinHtml).join('');
      if (countEl) countEl.textContent = visible.length + ' ürün';
    }

    function renderChecks(wrap, values, cls) {
      wrap.innerHTML = values.map(function (v) {
        var vEsc = esc(v);
        return '<label class="check-chip"><input type="checkbox" class="' + cls + '" value="' + vEsc + '"> ' + vEsc + '</label>';
      }).join('');
      wrap.querySelectorAll('input').forEach(function (c) { c.addEventListener('change', apply); });
    }

    function onCategoryChange() { renderAttrFilters(); apply(); }

    catWrap.addEventListener('change', onCategoryChange);
    cityWrap.addEventListener('change', apply);
    attrWrap.addEventListener('change', apply);
    organicCheckbox.addEventListener('change', apply);
    verifiedCheckbox.addEventListener('change', apply);
    minSellerRatingSelect.addEventListener('change', apply);
    minSellerSalesSelect.addEventListener('change', apply);
    deliveryRadios.forEach(function (r) { r.addEventListener('change', apply); });
    sellerTypeRadios.forEach(function (r) { r.addEventListener('change', apply); });
    sort.addEventListener('change', apply);
    searchInput.addEventListener('input', apply);

    resetBtn.addEventListener('click', function () {
      catWrap.querySelectorAll('input').forEach(function (c) { c.checked = false; });
      cityWrap.querySelectorAll('input').forEach(function (c) { c.checked = false; });
      organicCheckbox.checked = false;
      verifiedCheckbox.checked = false;
      minSellerRatingSelect.value = '0';
      minSellerSalesSelect.value = '0';
      deliveryRadios.forEach(function (r) { r.checked = r.value === '__all__'; });
      sellerTypeRadios.forEach(function (r) { r.checked = r.value === '__all__'; });
      sort.value = 'default';
      searchInput.value = '';
      renderAttrFilters();
      apply();
    });

    // Kategoriye özel özellikler (ör. zeytinyağında sıkım türü, üzümde çekirdek) — hiçbir
    // kategori seçili değilken gizli kalır, bir kategori işaretlenince SADECE o kategori(ler)de
    // görülen değerler listelenir. "Organik" bundan ayrı, her zaman görünen kendi filtresinde
    // (bkz. #fOrganicOnly) — çünkü tek bir kategoriye bağlı değil.
    function renderAttrFilters() {
      var cats = checkedValues(Array.prototype.slice.call(catWrap.querySelectorAll('input')));
      if (!cats.length) { attrGroup.hidden = true; attrWrap.innerHTML = ''; return; }

      var values = [];
      allProducts.forEach(function (p) {
        if (cats.indexOf(p.cat) === -1 || !p.attrs) return;
        Object.keys(p.attrs).forEach(function (k) {
          if (values.indexOf(p.attrs[k]) === -1) values.push(p.attrs[k]);
        });
      });
      if (!values.length) { attrGroup.hidden = true; attrWrap.innerHTML = ''; return; }
      attrGroup.hidden = false;
      attrWrap.innerHTML = values.map(function (v) {
        var vEsc = esc(v);
        return '<label class="check-chip"><input type="checkbox" class="attrCheck" value="' + vEsc + '"> ' + vEsc + '</label>';
      }).join('');
    }

    var PREFERRED_CAT_ORDER = ['Asma Yaprağı', 'Üzüm', 'Pekmez', 'İncir', 'Zeytin', 'Zeytinyağı', 'Salça', 'Tarhana',
      'Kiraz', 'Kuru Meyve', 'Kuruyemiş', 'Bal', 'Peynir', 'Sebze', 'Meyve', 'Reçel', 'Baklava'];

    // ---------- Keşif şeritleri: anasayfa grid'inin üstünde, aynı ürün verisinden
    // (ekstra bir API çağrısı gerekmeden) türetilen yatay kaydırmalı bloklar. ----------
    function renderDiscoverRow(title, products) {
      if (!products.length) return '';
      return '<div class="discover-section"><div class="discover-title">' + esc(title) + '</div>' +
        '<div class="discover-scroll">' + products.map(pinHtml).join('') + '</div></div>';
    }

    function renderDiscoverSections() {
      var container = document.getElementById('discoverSections');
      if (!container || !allProducts.length) return;

      var newArrivals = allProducts.slice()
        .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); })
        .slice(0, 12);
      var trending = allProducts.slice()
        .sort(function (a, b) { return defaultScore(b) - defaultScore(a); })
        .slice(0, 12);

      container.innerHTML =
        renderDiscoverRow('🆕 Yeni Eklenenler', newArrivals) +
        renderDiscoverRow('🔥 Bu Hafta Trend', trending);
      if (window.KDFavorites) window.KDFavorites.refresh();

      // "Senin Şehrinden" — giriş yapmışsa kendi kayıtlı iline göre, ekstra bir
      // konum izni istemeden (hesabındaki il zaten var).
      if (window.KDAuth && window.KDAuth.isLoggedIn()) {
        window.KDAuth.authedFetch('/api/auth/me').then(function (r) { return r.json(); }).then(function (data) {
          var city = data.user && data.user.city;
          if (!city) return;
          var fromCity = allProducts.filter(function (p) { return p.city === city; })
            .sort(function (a, b) { return defaultScore(b) - defaultScore(a); })
            .slice(0, 12);
          if (!fromCity.length) return;
          container.innerHTML += renderDiscoverRow('📍 ' + city + "'dan", fromCity);
          if (window.KDFavorites) window.KDFavorites.refresh();
        }).catch(function () {});
      }
    }

    Promise.all([
      fetch('/api/products').then(function (r) { return r.json(); }),
      fetch('/api/reviews/stats').then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetch('/api/sellers/stats').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (results) {
      allProducts = results[0].products || [];
      reviewStats = results[1] || {};
      sellerStats = results[2] || {};

      var cats = [];
      allProducts.forEach(function (p) { if (cats.indexOf(p.cat) === -1) cats.push(p.cat); });
      cats.sort(function (a, b) {
        var ia = PREFERRED_CAT_ORDER.indexOf(a), ib = PREFERRED_CAT_ORDER.indexOf(b);
        if (ia === -1) ia = 999; if (ib === -1) ib = 999;
        return ia - ib;
      });
      renderChecks(catWrap, cats, 'catCheck');

      var cities = [];
      allProducts.forEach(function (p) { if (cities.indexOf(p.city) === -1) cities.push(p.city); });
      cities.sort(function (a, b) { return a.localeCompare(b, 'tr'); });
      renderChecks(cityWrap, cities, 'cityCheck');

      renderAttrFilters();
      renderDiscoverSections();

      apply();
    }).catch(function () {
      grid.innerHTML = '<p style="padding:20px;color:var(--muted);font-size:13px;">Ürünler yüklenemedi.</p>';
    });
  });
})();
