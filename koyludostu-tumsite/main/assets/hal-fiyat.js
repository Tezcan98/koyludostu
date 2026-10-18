// Statik demo ürün sayfaları (main/urun/*.html) sunucu tarafında render edilmiyor,
// bu yüzden serve.js'teki renderProductPage'in gömdüğü hal/borsa fiyat kutusunu
// burada istemci tarafında, /api/hal-fiyat uç noktasından tekrar üretiyoruz —
// eşleştirme mantığı (tam kelime eşleşmesi) sunucudakiyle birebir aynı.
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var titleEl = document.querySelector('.product-info h1');
    var footer = document.querySelector('.product-footer');
    if (!titleEl || !footer || !footer.parentNode) return;
    var title = titleEl.textContent.trim();
    if (!title) return;

    fetch('/api/hal-fiyat?title=' + encodeURIComponent(title))
      .then(function (r) { return r.json(); })
      .then(function (match) {
        var stats = [];
        if (match.ulusal) stats.push(['Ülke Geneli', Number(match.ulusal.ortalamaFiyat), match.ulusal.birim]);
        if (match.izmir) stats.push(['İzmir Hali', Number(match.izmir.ortalamaUcret), match.izmir.birim]);
        if (match.tobb) stats.push(['Ticaret Borsası', Number(match.tobb.ortalamaFiyat), match.tobb.birim]);
        if (!stats.length) return;

        var statsHtml = stats.map(function (s) {
          return '<div class="hal-fiyat-stat"><span class="hal-fiyat-stat-label">' + esc(s[0]) + '</span>' +
            '<span class="hal-fiyat-stat-value">' + s[1].toLocaleString('tr-TR') + '₺<small>/' + esc(s[2]) + '</small></span></div>';
        }).join('');

        var box = document.createElement('div');
        box.className = 'hal-fiyat-box';
        box.innerHTML =
          '<div class="hal-fiyat-eyebrow">Piyasa Fiyat Referansı</div>' +
          '<div class="hal-fiyat-row">' + statsHtml + '</div>' +
          '<div class="hal-fiyat-source">Ticaret Bakanlığı Hal Kayıt Sistemi, İzmir Büyükşehir Belediyesi ve TOBB Ticaret Borsaları verilerine dayanır — bilgilendirme amaçlıdır, fiyat garantisi vermez.</div>';
        footer.parentNode.insertBefore(box, footer);
      })
      .catch(function () {});
  });
})();
