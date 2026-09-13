(function () {
  // "Sipariş Talebi" — gerçek bir ödeme/sepet akışı DEĞİL, sadece durumu takip
  // edilebilen hafif bir kayıt (/api/product-orders). Onay/ödeme/teslimat satıcı
  // ile alıcı arasında platform dışında görüşülür; durumu "Siparişlerim" sayfasından
  // takip edilir.

  function ensureOrderPanel() {
    var panel = document.getElementById('orderPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'msg-panel';
    panel.id = 'orderPanel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="msg-sheet order-sheet">' +
        '<div class="msg-sheet-head"><b id="orderSheetTitle">Sipariş Talebi</b><button id="orderCloseBtn" aria-label="Kapat">×</button></div>' +
        '<div class="order-form">' +
          '<p class="order-note">Bu bir sipariş onayı değildir — satıcıya gönderilen detaylı bir talep mesajıdır. Satıcı uygun görürse seninle iletişime geçer; ödeme ve teslimat detayları doğrudan aranızda görüşülür.</p>' +
          '<label>Kaç adet/parça istiyorsun?</label>' +
          '<input type="number" id="orderQty" min="1" value="1">' +
          '<label>Teslimat İli</label>' +
          '<select id="orderCity"><option value="">Yükleniyor…</option></select>' +
          '<label>Teslimat İlçesi</label>' +
          '<select id="orderDistrict" disabled><option value="">Önce il seç</option></select>' +
          '<label>Adres / teslimat notu (opsiyonel)</label>' +
          '<textarea id="orderAddress" placeholder="Açık adres ya da nasıl teslim almak istediğin" maxlength="300"></textarea>' +
          '<label>Ne zamana kadar istiyorsun? (opsiyonel)</label>' +
          '<input type="text" id="orderDeadline" placeholder="Örn. bu hafta içinde, acil değil" maxlength="80">' +
          '<label>Özel isteğin var mı? (opsiyonel)</label>' +
          '<textarea id="orderNote" placeholder="Örn. az şekerli olsun, hediyelik paketlensin" maxlength="300"></textarea>' +
          '<label class="order-terms-row"><input type="checkbox" id="orderTermsCheck"> <span><a href="javascript:;" class="order-terms-link">Sipariş Şartları\'nı</a> okudum, kabul ediyorum.</span></label>' +
          '<button id="orderSendBtn">Talebi Gönder</button>' +
          '<p class="order-msg" id="orderMsg"></p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.hidden = true; });
    document.getElementById('orderCloseBtn').addEventListener('click', function () { panel.hidden = true; });
    return panel;
  }

  function openOrderPanel(slug, title) {
    if (!window.KDAuth.requireLogin(location.pathname)) return;
    var panel = ensureOrderPanel();
    document.getElementById('orderSheetTitle').textContent = title + ' — Sipariş Talebi';
    panel.hidden = false;
    document.getElementById('orderQty').value = 1;
    window.KDAddress.bindCascade(document.getElementById('orderCity'), document.getElementById('orderDistrict'));
    document.getElementById('orderAddress').value = '';
    document.getElementById('orderDeadline').value = '';
    document.getElementById('orderNote').value = '';
    document.getElementById('orderTermsCheck').checked = false;
    var msgEl = document.getElementById('orderMsg');
    msgEl.textContent = '';

    var sendBtn = document.getElementById('orderSendBtn');
    sendBtn.disabled = false;
    sendBtn.onclick = function () {
      var qty = parseInt(document.getElementById('orderQty').value, 10) || 0;
      var city = document.getElementById('orderCity').value.trim();
      var district = document.getElementById('orderDistrict').value.trim();
      var address = document.getElementById('orderAddress').value.trim();
      var deadline = document.getElementById('orderDeadline').value.trim();
      var note = document.getElementById('orderNote').value.trim();

      if (qty < 1) { msgEl.textContent = 'Geçerli bir adet gir.'; return; }
      if (!city) { msgEl.textContent = 'Teslimat ili gerekli.'; return; }
      if (!district) { msgEl.textContent = 'Teslimat ilçesi gerekli.'; return; }
      if (!document.getElementById('orderTermsCheck').checked) { msgEl.textContent = 'Sipariş Şartları\'nı kabul etmelisin.'; return; }

      msgEl.textContent = '';
      sendBtn.disabled = true;
      window.KDAuth.authedFetch('/api/product-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productSlug: slug, quantity: qty, city: city, district: district,
          address: address, deadline: deadline, note: note, termsAccepted: true,
        }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        sendBtn.disabled = false;
        if (data.error) { msgEl.textContent = data.error; return; }
        panel.hidden = true;
        window.location.href = '/siparislerim.html';
      }).catch(function () {
        sendBtn.disabled = false;
        msgEl.textContent = 'Bir şeyler ters gitti, tekrar dene.';
      });
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.body.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.order-cta');
      if (btn) openOrderPanel(btn.dataset.slug, btn.dataset.title);
    });
  });
})();
