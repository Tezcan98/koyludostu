// Sipariş Şartları — genel Kullanım Şartları'ndan (kayıt anında bir kere kabul
// edilir) farklı olarak, her siparişte alıcı ve satıcı ayrı ayrı kabul eder
// (bkz. order.js ve admin-siparisler.html). Metin burada tek yerde tutulur.
(function () {
  var TERMS_HTML =
    '<h3>1. Taraflar</h3>' +
    '<p>Bu sipariş talebi, alıcı ile satıcı arasındaki bir alım satıma ilişkindir. Köylü Dostu bu işleme aracılık eder, tarafı olmaz; sözleşme doğrudan alıcı ve satıcı arasında kurulur.</p>' +
    '<h3>2. Ödeme</h3>' +
    '<p>Ödeme, alıcı tarafından doğrudan satıcının bildirdiği IBAN\'a gönderilir. Platform bu ödemeyi işlemez, saklamaz, garanti etmez veya iade edemez. "Ödemeyi Gönderdim" işareti sadece alıcının kendi beyanıdır, gerçek transferi doğrulamaz.</p>' +
    '<h3>3. Satıcının Yükümlülüğü</h3>' +
    '<p>Satıcı, ürünü ilanda tarif edildiği şekilde, kararlaştırılan miktar ve sürede teslim etmekle yükümlüdür.</p>' +
    '<h3>4. Alıcının Yükümlülüğü</h3>' +
    '<p>Alıcı, doğru teslimat bilgisi vermekle ve kararlaştırılan ödemeyi zamanında göndermekle yükümlüdür.</p>' +
    '<h3>5. Anlaşmazlık</h3>' +
    '<p>Sorun yaşanması hâlinde taraflar önce mesajlaşarak çözüm aramalı; çözülmezse alıcı Şikayet ekranından platforma bildirebilir. Platform tarafları uzlaştırmaya çalışır, ancak taraflar arasındaki ticari uyuşmazlıklarda hukuki sorumluluk üstlenmez.</p>';

  function ensureModal() {
    var modal = document.getElementById('orderTermsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'terms-modal';
    modal.id = 'orderTermsModal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="terms-box">' +
        '<div class="terms-box-head"><b>Sipariş Şartları</b><button id="orderTermsCloseBtn" aria-label="Kapat">×</button></div>' +
        '<div class="terms-box-body">' + TERMS_HTML + '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });
    document.getElementById('orderTermsCloseBtn').addEventListener('click', function () { modal.hidden = true; });
    return modal;
  }

  function openOrderTerms() { ensureModal().hidden = false; }

  window.KDOrderTerms = { open: openOrderTerms };

  document.addEventListener('DOMContentLoaded', function () {
    document.body.addEventListener('click', function (e) {
      var link = e.target.closest && e.target.closest('.order-terms-link');
      if (link) { e.preventDefault(); openOrderTerms(); }
    });
  });
})();
