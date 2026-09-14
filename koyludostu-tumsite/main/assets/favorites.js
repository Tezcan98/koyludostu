(function () {
  var mineCache = null;

  // Emoji kalp (🤍/❤️) yerine, sitenin geri kalanındaki çizgi-ikon dilini kullanan
  // bir SVG kalp — dolgu/anahat durumu emoji yerine CSS (.active) ile değişir,
  // farklı işletim sistemlerinde farklı (ve "resim gibi duran") emoji görünümü yerine.
  var HEART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';

  function loadMine() {
    if (mineCache) return Promise.resolve(mineCache);
    if (!window.KDAuth.isLoggedIn()) return Promise.resolve({ products: [], sellers: [] });
    return window.KDAuth.authedFetch('/api/favorites/mine')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        mineCache = { products: (data.products || []).map(function (p) { return p.slug; }), sellers: (data.sellers || []).map(function (s) { return s.id; }) };
        return mineCache;
      })
      .catch(function () { return { products: [], sellers: [] }; });
  }

  function markButtons() {
    loadMine().then(function (mine) {
      document.querySelectorAll('.fav-cta').forEach(function (btn) {
        var active = mine.products.indexOf(btn.dataset.id) !== -1;
        setState(btn, active);
      });
      document.querySelectorAll('.fav-seller-cta').forEach(function (btn) {
        var active = mine.sellers.indexOf(btn.dataset.id) !== -1;
        setState(btn, active);
      });
    });
  }

  function setState(btn, active) {
    btn.classList.toggle('active', active);
    var isSeller = btn.classList.contains('fav-seller-cta');
    if (isSeller) {
      btn.textContent = active ? '★ Takip Ediliyor' : '☆ Satıcıyı Takip Et';
    } else if (!btn.querySelector('svg')) {
      // İlk render'da hâlâ eski emoji ya da boşsa (statik urun/*.html sayfaları,
      // sunucu şablonları) SVG'yi bir kere yerleştir — sonrası sadece .active
      // class'ıyla (yukarıdaki CSS) renk/dolgu değişir, DOM'a tekrar dokunmaz.
      btn.innerHTML = HEART_SVG;
    }
  }

  function toggle(type, id, btn) {
    if (!window.KDAuth.requireLogin(location.pathname)) return;
    window.KDAuth.authedFetch('/api/favorites/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, id: id }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) return;
      if (mineCache) {
        var listKey = type === 'product' ? 'products' : 'sellers';
        var idx = mineCache[listKey].indexOf(id);
        if (data.active && idx === -1) mineCache[listKey].push(id);
        if (!data.active && idx !== -1) mineCache[listKey].splice(idx, 1);
      }
      if (btn) setState(btn, data.active);
    }).catch(function () {});
  }

  window.KDFavorites = { toggle: toggle, refresh: function () { mineCache = null; return markButtons(); } };

  document.addEventListener('DOMContentLoaded', function () {
    markButtons();

    document.body.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.fav-cta, .fav-seller-cta');
      if (!btn) return;
      // Ürün kartlarında kalp butonu bir <a class="pin"> linkinin içinde yaşar —
      // tıklamanın ürün sayfasına yönlendirmesini engelle, sadece favoriyi değiştir.
      e.preventDefault();
      var type = btn.classList.contains('fav-seller-cta') ? 'seller' : 'product';
      toggle(type, btn.dataset.id, btn);
    });
  });
})();
