(function () {
  // "Sipariş Talebi" — gerçek bir ödeme/sepet akışı DEĞİL, sadece durumu takip
  // edilebilen hafif bir kayıt (/api/product-orders). Onay/ödeme/teslimat satıcı
  // ile alıcı arasında platform dışında görüşülür; durumu "Siparişlerim" sayfasından
  // takip edilir.

  function ensureOrderTermsModal() {
    var modal = document.getElementById('orderTermsModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'terms-modal';
    modal.id = 'orderTermsModal';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="terms-box">' +
        '<div class="terms-box-head"><b>Sipariş Şartları</b><button id="orderTermsModalClose" aria-label="Kapat">×</button></div>' +
        '<div class="terms-box-body">' +
          '<h3>1. Bu bir sipariş onayı değildir</h3>' +
          '<p>Gönderdiğin talep, ürünü satan satıcıya iletilen bir istek mesajıdır. Satıcı uygun görürse seninle iletişime geçer; bağlayıcı satış sözleşmesi platform ile değil, doğrudan seninle satıcı arasında kurulur.</p>' +
          '<h3>2. Fiyat ve ödeme</h3>' +
          '<p>Talep ekranında gördüğün tutar tahminidir, satıcı onayına tabidir. Köylü Dostu ödemeye aracılık etmez; ödeme satıcıyla doğrudan (IBAN üzerinden) kararlaştırılır.</p>' +
          '<h3>3. Teslimat</h3>' +
          '<p>Teslimat yöntemi (kendin al, otobüs, kargo) ürünün saklama koşuluna göre değişir; kargoya uygun olmayan (soğuk zincir gerektiren/çabuk bozulan) ürünler kargoyla gönderilemez. Kesin teslimat şekli satıcıyla mesaj üzerinden netleştirilir.</p>' +
          '<h3>4. Cayma hakkı</h3>' +
          '<p>Mesafeli Sözleşmeler Yönetmeliği\'ndeki 14 günlük cayma hakkı, çabuk bozulabilen/kısa raf ömürlü gıda ürünlerinde genellikle uygulanmaz. Detaylar için <a href="/iade-politikasi.html" target="_blank">İade ve Cayma Hakkı</a> sayfasına bakabilirsin.</p>' +
          '<h3>5. Sorun yaşarsan</h3>' +
          '<p>Ürün tarif edilenden farklı ya da hiç gelmezse, uygulama üzerinden şikayet açabilirsin — Köylü Dostu süreci takip eder ve gerekirse hukuki destek yönlendirmesi yapar.</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('orderTermsModalClose').addEventListener('click', function () { modal.hidden = true; });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.hidden = true; });
    return modal;
  }

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
            '<div class="order-field" id="orderSavedAddressWrap" hidden><label>Kayıtlı Adreslerim</label>' +
              '<select id="orderSavedAddress"><option value="">Yeni adres gir…</option></select></div>' +
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
          '<label class="order-terms-row"><input type="checkbox" id="orderTermsCheck"> <span><a href="javascript:;" id="orderTermsLink" class="order-terms-link">Sipariş Şartları\'nı</a> okudum, kabul ediyorum.</span></label>' +
          '<label class="order-terms-row"><input type="checkbox" id="orderNotifyCheck"> <span>Bu ürün/satıcıyla ilgili bildirimleri almak istiyorum.</span></label>' +
          '<p class="order-msg" id="orderMsg"></p>' +
          '<button id="orderSendBtn">Talebi Gönder</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.hidden = true; });
    document.getElementById('orderCloseBtn').addEventListener('click', function () { panel.hidden = true; });

    var termsModal = ensureOrderTermsModal();
    document.getElementById('orderTermsLink').addEventListener('click', function () { termsModal.hidden = false; });

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
    document.getElementById('orderNotifyCheck').checked = false;
    var msgEl = document.getElementById('orderMsg');
    msgEl.textContent = '';

    // Kayıtlı adreslerim varsa seçim kutusunu doldur — seçilince il/ilçe/adres
    // otomatik dolar, elle tekrar yazmaya gerek kalmaz (bkz. /adreslerim.html).
    var savedWrap = document.getElementById('orderSavedAddressWrap');
    var savedSelect = document.getElementById('orderSavedAddress');
    savedWrap.hidden = true;
    savedSelect.innerHTML = '<option value="">Yeni adres gir…</option>';
    if (window.KDAuth.isLoggedIn()) {
      window.KDAuth.authedFetch('/api/addresses/mine').then(function (r) { return r.json(); }).then(function (data) {
        var addresses = data.addresses || [];
        if (!addresses.length) return;
        savedWrap.hidden = false;
        addresses.forEach(function (a) {
          var opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = a.label + ' — ' + a.district + '/' + a.city;
          savedSelect.appendChild(opt);
        });
        savedSelect.onchange = function () {
          var picked = addresses.filter(function (a) { return a.id === savedSelect.value; })[0];
          if (!picked) return;
          var cityEl = document.getElementById('orderCity');
          var districtEl = document.getElementById('orderDistrict');
          cityEl.value = picked.city;
          cityEl.dispatchEvent(new Event('change'));
          districtEl.value = picked.district;
          var fullAddress = (picked.neighborhood ? picked.neighborhood + ', ' : '') + picked.address;
          document.getElementById('orderAddress').value = fullAddress;
        };
      }).catch(function () {});
    }

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
          notifyOptIn: document.getElementById('orderNotifyCheck').checked,
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
