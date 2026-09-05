(function () {
  // Ürün fotoğraflarını sağ tık / sürükle-bırak ile indirmeyi zorlaştırır.
  // Not: Bu sadece caydırıcıdır — DevTools, ekran görüntüsü veya doğrudan
  // ağ isteğiyle indirmeyi teknik olarak engellemez.
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest('img')) e.preventDefault();
  });
  document.addEventListener('dragstart', function (e) {
    if (e.target.tagName === 'IMG') e.preventDefault();
  });
})();
