(function () {
  // "Sipariş Talebi" — gerçek bir sipariş/ödeme akışı DEĞİL, satıcıya gönderilen
  // yapılandırılmış bir mesajdır. Mevcut mesajlaşma API'sini (/api/messages/send)
  // kullanır, ayrı bir "order" veri modeli yoktur — onay/ödeme satıcı ile alıcı
  // arasında platform dışında görüşülür.

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
          '<label>Teslimat şehri</label>' +
          '<input type="text" id="orderCity" placeholder="Örn. İzmir" maxlength="60">' +
          '<label>Adres / teslimat notu (opsiyonel)</label>' +
          '<textarea id="orderAddress" placeholder="Açık adres ya da nasıl teslim almak istediğin" maxlength="300"></textarea>' +
          '<label>Ne zamana kadar istiyorsun? (opsiyonel)</label>' +
          '<input type="text" id="orderDeadline" placeholder="Örn. bu hafta içinde, acil değil" maxlength="80">' +
          '<label>Özel isteğin var mı? (opsiyonel)</label>' +
          '<textarea id="orderNote" placeholder="Örn. az şekerli olsun, hediyelik paketlensin" maxlength="300"></textarea>' +
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
    document.getElementById('orderCity').value = '';
    document.getElementById('orderAddress').value = '';
    document.getElementById('orderDeadline').value = '';
    document.getElementById('orderNote').value = '';
    var msgEl = document.getElementById('orderMsg');
    msgEl.textContent = '';

    var sendBtn = document.getElementById('orderSendBtn');
    sendBtn.disabled = false;
    sendBtn.onclick = function () {
      var qty = parseInt(document.getElementById('orderQty').value, 10) || 0;
      var city = document.getElementById('orderCity').value.trim();
      var address = document.getElementById('orderAddress').value.trim();
      var deadline = document.getElementById('orderDeadline').value.trim();
      var note = document.getElementById('orderNote').value.trim();

      if (qty < 1) { msgEl.textContent = 'Geçerli bir adet gir.'; return; }
      if (!city) { msgEl.textContent = 'Teslimat şehri gerekli.'; return; }

      var lines = [
        '📦 Sipariş Talebi — ' + title,
        'Adet: ' + qty,
        'Teslimat Şehri: ' + city,
      ];
      if (address) lines.push('Adres/Not: ' + address);
      if (deadline) lines.push('Aciliyet: ' + deadline);
      if (note) lines.push('Özel İstek: ' + note);
      var text = lines.join('\n');

      msgEl.textContent = '';
      sendBtn.disabled = true;
      window.KDAuth.authedFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productSlug: slug, productTitle: title, text: text }),
      }).then(function (r) { return r.json(); }).then(function () {
        sendBtn.disabled = false;
        panel.hidden = true;
        if (window.KDMessages) window.KDMessages.open(slug, title);
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
