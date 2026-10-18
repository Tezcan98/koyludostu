// Ürün sayfası görüntülenme sayacı — ilan sahibinin admin-urunlerim.html'de
// görebileceği "görülme" metriği. Sunucu-render edilen VE statik demo ürün
// sayfalarının ikisinde de aynı şekilde çalışır (ikisinde de .msg-cta[data-slug]
// her zaman mevcut). Sessizce, sonucu beklemeden gönderilir.
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.msg-cta[data-slug]');
    if (!btn) return;
    fetch('/api/products/track', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: btn.dataset.slug, event: 'view' }),
    }).catch(function () {});
  });
})();
