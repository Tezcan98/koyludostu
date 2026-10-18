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
        var parts = [];
        if (match.ulusal) parts.push('Ülke geneli ort.: <b>' + Number(match.ulusal.ortalamaFiyat).toLocaleString('tr-TR') + '₺/' + esc(match.ulusal.birim) + '</b>');
        if (match.izmir) parts.push('İzmir hali: <b>' + Number(match.izmir.ortalamaUcret).toLocaleString('tr-TR') + '₺/' + esc(match.izmir.birim) + '</b>');
        if (match.tobb) parts.push('Ticaret borsası (hububat): <b>' + Number(match.tobb.ortalamaFiyat).toLocaleString('tr-TR') + '₺/' + esc(match.tobb.birim) + '</b>');
        if (!parts.length) return;

        var box = document.createElement('div');
        box.className = 'hal-fiyat-box';
        box.innerHTML =
          '<span class="hal-fiyat-title">📊 Güncel Hal/Borsa Fiyatı Referansı</span>' +
          '<div class="hal-fiyat-vals">' + parts.join(' · ') + '</div>' +
          '<small>Kaynak: Ticaret Bakanlığı Hal Kayıt Sistemi / İzmir Büyükşehir Belediyesi / TOBB Ticaret Borsaları — fiyat garantisi değildir, sadece piyasa referansıdır.</small>';
        footer.parentNode.insertBefore(box, footer);
      })
      .catch(function () {});
  });
})();
