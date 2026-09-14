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
        '<div class="order-head">' +
          '<img class="order-head-img" id="orderHeadImg" alt="" hidden>' +
          '<div class="order-head-info"><span class="order-head-eyebrow">Sipariş Talebi</span><b id="orderSheetTitle"></b></div>' +
          '<button id="orderCloseBtn" aria-label="Kapat">×</button>' +
        '</div>' +
        '<div class="order-form">' +
          '<div class="order-note"><span class="order-note-icon">ℹ️</span><span>Bu bir sipariş onayı değildir — satıcıya gönderilen detaylı bir talep mesajıdır. Satıcı uygun görürse seninle iletişime geçer; ödeme ve teslimat detayları doğrudan aranızda görüşülür.</span></div>' +

          '<div class="order-section">' +
            '<div class="order-section-title">Miktar</div>' +
            '<div class="qty-stepper">' +
              '<button type="button" id="orderQtyMinus" aria-label="Azalt">−</button>' +
              '<input type="number" id="orderQty" min="1" value="1" inputmode="numeric">' +
              '<button type="button" id="orderQtyPlus" aria-label="Artır">+</button>' +
              '<span class="qty-unit" id="orderQtyUnit"></span>' +
            '</div>' +
            '<div class="order-subtotal" id="orderSubtotal" hidden>Tahmini tutar <b id="orderSubtotalVal"></b></div>' +
          '</div>' +

          '<div class="order-section">' +
            '<div class="order-section-title">Teslimat Bilgileri</div>' +
            '<div class="order-field-row">' +
              '<div class="order-field"><label>İl</label><select id="orderCity"><option value="">Yükleniyor…</option></select></div>' +
              '<div class="order-field"><label>İlçe</label><select id="orderDistrict" disabled><option value="">Önce il seç</option></select></div>' +
            '</div>' +
            '<div class="order-field"><label>Adres / teslimat notu</label>' +
              '<textarea id="orderAddress" placeholder="Açık adres ya da nasıl teslim almak istediğin" maxlength="300"></textarea></div>' +
          '</div>' +

          '<div class="order-section">' +
            '<div class="order-section-title">Ek Bilgiler <span class="order-opt">(opsiyonel)</span></div>' +
            '<div class="order-field"><label>Ne zamana kadar istiyorsun?</label>' +
              '<input type="text" id="orderDeadline" placeholder="Örn. bu hafta içinde, acil değil" maxlength="80"></div>' +
            '<div class="order-field"><label>Özel isteğin var mı?</label>' +
              '<textarea id="orderNote" placeholder="Örn. az şekerli olsun, hediyelik paketlensin" maxlength="300"></textarea></div>' +
          '</div>' +
        '</div>' +
        '<div class="order-footer">' +
          '<label class="order-terms-row"><input type="checkbox" id="orderTermsCheck"> <span><a href="javascript:;" class="order-terms-link">Sipariş Şartları\'nı</a> okudum, kabul ediyorum.</span></label>' +
          '<p class="order-msg" id="orderMsg"></p>' +
          '<button id="orderSendBtn">Talebi Gönder</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.hidden = true; });
    document.getElementById('orderCloseBtn').addEventListener('click', function () { panel.hidden = true; });

    var qtyInput = document.getElementById('orderQty');
    document.getElementById('orderQtyMinus').addEventListener('click', function () {
      qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
      qtyInput.dispatchEvent(new Event('input'));
    });
    document.getElementById('orderQtyPlus').addEventListener('click', function () {
      qtyInput.value = (parseInt(qtyInput.value, 10) || 0) + 1;
      qtyInput.dispatchEvent(new Event('input'));
    });
    return panel;
  }

  // Ürünün fiyat/birim/fotoğrafını, sayfada zaten render edilmiş olan ortak
  // öğelerden okur (hem sunucuda üretilen hem de main/urun/*.html altındaki 25
  // statik demo sayfasında aynı .product-grid img / .product-price yapısı var) —
  // ayrıca bir API çağrısına gerek kalmadan panel açılır açılmaz tutar hesaplanabilir.
  function readProductContext() {
    var priceEl = document.querySelector('.product-price');
    var imgEl = document.querySelector('.product-grid img');
    var unitPrice = null;
    var unitLabel = '';
    if (priceEl) {
      var priceText = priceEl.childNodes[0] ? priceEl.childNodes[0].textContent : priceEl.textContent;
      var digits = String(priceText || '').replace(/\D/g, '');
      unitPrice = digits ? parseInt(digits, 10) : null;
      var smallEl = priceEl.querySelector('small');
      unitLabel = smallEl ? smallEl.textContent.trim() : '';
    }
    return { unitPrice: unitPrice, unitLabel: unitLabel, imgSrc: imgEl ? imgEl.src : '' };
  }

  function openOrderPanel(slug, title) {
    if (!window.KDAuth.requireLogin(location.pathname)) return;
    var panel = ensureOrderPanel();
    document.getElementById('orderSheetTitle').textContent = title;
    panel.hidden = false;

    var ctx = readProductContext();
    var headImg = document.getElementById('orderHeadImg');
    if (ctx.imgSrc) { headImg.src = ctx.imgSrc; headImg.hidden = false; } else { headImg.hidden = true; }
    document.getElementById('orderQtyUnit').textContent = ctx.unitLabel;

    var subtotalEl = document.getElementById('orderSubtotal');
    var subtotalVal = document.getElementById('orderSubtotalVal');
    function updateSubtotal() {
      if (!ctx.unitPrice) { subtotalEl.hidden = true; return; }
      var qty = parseInt(document.getElementById('orderQty').value, 10) || 0;
      subtotalEl.hidden = false;
      subtotalVal.textContent = (ctx.unitPrice * qty).toLocaleString('tr-TR') + '₺';
    }

    var qtyInput = document.getElementById('orderQty');
    qtyInput.value = 1;
    qtyInput.oninput = updateSubtotal;
    updateSubtotal();

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
      if (!address) { msgEl.textContent = 'Açık adres ya da teslimat notu gerekli.'; return; }
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
