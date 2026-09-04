(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var grid = document.getElementById('productGrid');
    if (!grid) return;

    var catWrap = document.getElementById('catChecks');
    var cityWrap = document.getElementById('cityChecks');
    var attrGroup = document.getElementById('attrGroup');
    var attrWrap = document.getElementById('attrChecks');
    var deliveryRadios = Array.prototype.slice.call(document.querySelectorAll('input[name="delivery"]'));
    var organicCheckbox = document.getElementById('fOrganicOnly');
    var verifiedCheckbox = document.getElementById('fVerifiedOnly');
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
      var sellerBadge = p.sellerVerified ? ' <span class="seller-badge" title="Güvenilir Satıcı">🛡️</span>' : '';
      return '<a class="pin" href="urun/' + p.slug + '.html" data-cat="' + p.cat + '" data-price="' + priceNum +
        '" data-title="' + p.title.replace(/"/g, '&quot;') + '" data-city="' + p.city + '" data-delivery="' + p.delivery.join(',') +
        '" data-created="' + p.createdAt + '" data-slug="' + p.slug + '">' +
        '<img src="' + imgSrc + '" alt="' + p.title.replace(/"/g, '&quot;') + '" loading="lazy">' +
        '<div class="pin-overlay">' +
          '<div class="pin-cat">' + p.cat + ' · ' + p.sellerName + sellerBadge + '</div>' +
          '<div class="pin-title">' + p.title + '</div>' +
          '<div class="pin-foot"><div class="pin-price">' + p.price + '<br><small>' + p.unit + '</small></div>' +
        '<button type="button" class="fav-cta pin-fav" data-id="' + p.slug + '">🤍</button></div>' +
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

      var activeCount = cats.length + cities.length + attrVals.length + (onlyOrganic ? 1 : 0) + (onlyVerified ? 1 : 0) + (delivery !== '__all__' ? 1 : 0);
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
        var okSearch = !query || [p.title, p.cat, p.city, p.sellerName, p.description]
          .join(' ').toLocaleLowerCase('tr').indexOf(query) !== -1;
        return okCat && okCity && okDelivery && okAttrs && okOrganic && okVerified && okSearch;
      });

      var sortVal = sort.value;
      visible.sort(function (a, b) {
        if (sortVal === 'price-asc') return (parseInt(String(a.price).replace(/\D/g, ''), 10) || 0) - (parseInt(String(b.price).replace(/\D/g, ''), 10) || 0);
        if (sortVal === 'price-desc') return (parseInt(String(b.price).replace(/\D/g, ''), 10) || 0) - (parseInt(String(a.price).replace(/\D/g, ''), 10) || 0);
        if (sortVal === 'name-asc') return a.title.localeCompare(b.title, 'tr');
        return defaultScore(b) - defaultScore(a);
      });

      grid.innerHTML = visible.map(pinHtml).join('');
      if (countEl) countEl.textContent = visible.length + ' ürün';
    }

    function renderChecks(wrap, values, cls) {
      wrap.innerHTML = values.map(function (v) {
        return '<label class="check-chip"><input type="checkbox" class="' + cls + '" value="' + v.replace(/"/g, '&quot;') + '"> ' + v + '</label>';
      }).join('');
      wrap.querySelectorAll('input').forEach(function (c) { c.addEventListener('change', apply); });
    }

    function onCategoryChange() { renderAttrFilters(); apply(); }

    catWrap.addEventListener('change', onCategoryChange);
    cityWrap.addEventListener('change', apply);
    attrWrap.addEventListener('change', apply);
    organicCheckbox.addEventListener('change', apply);
    verifiedCheckbox.addEventListener('change', apply);
    deliveryRadios.forEach(function (r) { r.addEventListener('change', apply); });
    sort.addEventListener('change', apply);
    searchInput.addEventListener('input', apply);

    resetBtn.addEventListener('click', function () {
      catWrap.querySelectorAll('input').forEach(function (c) { c.checked = false; });
      cityWrap.querySelectorAll('input').forEach(function (c) { c.checked = false; });
      organicCheckbox.checked = false;
      verifiedCheckbox.checked = false;
      deliveryRadios.forEach(function (r) { r.checked = r.value === '__all__'; });
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
        return '<label class="check-chip"><input type="checkbox" class="attrCheck" value="' + v.replace(/"/g, '&quot;') + '"> ' + v + '</label>';
      }).join('');
    }

    var PREFERRED_CAT_ORDER = ['Asma Yaprağı', 'Üzüm', 'Pekmez', 'İncir', 'Zeytin', 'Zeytinyağı', 'Salça', 'Tarhana',
      'Kiraz', 'Kuru Meyve', 'Kuruyemiş', 'Bal', 'Peynir', 'Sebze', 'Meyve', 'Reçel', 'Baklava'];

    Promise.all([
      fetch('/api/products').then(function (r) { return r.json(); }),
      fetch('/api/reviews/stats').then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (results) {
      allProducts = results[0].products || [];
      reviewStats = results[1] || {};

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

      apply();
    }).catch(function () {
      grid.innerHTML = '<p style="padding:20px;color:var(--muted);font-size:13px;">Ürünler yüklenemedi.</p>';
    });
  });
})();
