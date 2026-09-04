(function () {
  var REASONS = [
    { value: 'kalite', label: 'Ürün kalitesi düşük çıktı' },
    { value: 'gelmedi', label: 'Ürün hiç gelmedi' },
    { value: 'farkli', label: 'Tarif edilenden farklıydı' },
    { value: 'diger', label: 'Diğer' },
  ];

  function ensurePanel() {
    var panel = document.getElementById('complaintPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'msg-panel';
    panel.id = 'complaintPanel';
    panel.hidden = true;
    var options = REASONS.map(function (r) { return '<option value="' + r.value + '">' + r.label + '</option>'; }).join('');
    panel.innerHTML =
      '<div class="msg-sheet">' +
        '<div class="msg-sheet-head"><b id="complaintSheetTitle">Şikayet Oluştur</b><button id="complaintCloseBtn" aria-label="Kapat">×</button></div>' +
        '<div class="complaint-form">' +
          '<p class="complaint-hint">Bu üründeki siparişinle ilgili yaşadığın sorunu satıcıya ve platforma bildir.</p>' +
          '<label class="complaint-label">Sorun Türü</label>' +
          '<select id="complaintReason" class="complaint-select">' + options + '</select>' +
          '<label class="complaint-label">Açıklama</label>' +
          '<textarea id="complaintText" class="complaint-textarea" maxlength="1000" placeholder="Neler yaşadığını kısaca anlat…"></textarea>' +
          '<p class="complaint-error" id="complaintError"></p>' +
          '<button id="complaintSubmitBtn" class="complaint-submit">Şikayeti Gönder</button>' +
          '<p class="complaint-success" id="complaintSuccess" hidden>Şikayetin alındı. Satıcıya iletildi, Şikayetlerim sayfasından takip edebilirsin.</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.hidden = true; });
    document.getElementById('complaintCloseBtn').addEventListener('click', function () { panel.hidden = true; });
    return panel;
  }

  function openComplaintPanel(slug, title) {
    if (!window.KDAuth.requireLogin(location.pathname)) return;
    var panel = ensurePanel();
    document.getElementById('complaintSheetTitle').textContent = 'Şikayet — ' + title;
    document.getElementById('complaintText').value = '';
    document.getElementById('complaintReason').value = 'kalite';
    document.getElementById('complaintError').textContent = '';
    document.getElementById('complaintSuccess').hidden = true;
    var submitBtn = document.getElementById('complaintSubmitBtn');
    submitBtn.hidden = false;
    panel.hidden = false;

    submitBtn.onclick = function () {
      var reason = document.getElementById('complaintReason').value;
      var text = document.getElementById('complaintText').value.trim();
      var errorEl = document.getElementById('complaintError');
      if (!text) { errorEl.textContent = 'Lütfen açıklama yaz.'; return; }
      errorEl.textContent = '';
      submitBtn.disabled = true;
      window.KDAuth.authedFetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productSlug: slug, reason: reason, text: text }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        submitBtn.disabled = false;
        if (data.error) { errorEl.textContent = data.error; return; }
        submitBtn.hidden = true;
        document.getElementById('complaintSuccess').hidden = false;
      }).catch(function () {
        submitBtn.disabled = false;
        errorEl.textContent = 'Bağlantı hatası, tekrar deneyin.';
      });
    };
  }

  window.KDComplaints = { open: openComplaintPanel };

  document.addEventListener('DOMContentLoaded', function () {
    document.body.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.complaint-cta');
      if (btn) openComplaintPanel(btn.dataset.slug, btn.dataset.title);
    });
  });
})();
