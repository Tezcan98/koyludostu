(function () {
  function ensurePanel() {
    var panel = document.getElementById('msgPanel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'msg-panel';
    panel.id = 'msgPanel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="msg-sheet">' +
        '<div class="msg-sheet-head"><b id="msgSheetTitle">Satıcıya Mesaj</b><button id="msgCloseBtn" aria-label="Kapat">×</button></div>' +
        '<div class="msg-thread" id="msgThread"></div>' +
        '<div class="msg-input-row">' +
          '<input type="text" id="msgTextInput" placeholder="Mesajınızı yazın…" maxlength="500">' +
          '<button id="msgSendBtn" aria-label="Gönder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) { if (e.target === panel) panel.hidden = true; });
    document.getElementById('msgCloseBtn').addEventListener('click', function () { panel.hidden = true; });
    return panel;
  }

  function renderThread(messages) {
    var thread = document.getElementById('msgThread');
    if (!messages || !messages.length) {
      thread.innerHTML = '<p class="msg-empty">Henüz mesaj yok. İlk mesajı sen gönder!</p>';
      return;
    }
    thread.innerHTML = messages.map(function (m) {
      return '<div class="msg-bubble ' + (m.from === 'buyer' ? 'buyer' : 'seller') + '">' +
        m.text.replace(/[<>]/g, '') + '</div>';
    }).join('');
    thread.scrollTop = thread.scrollHeight;
  }

  function loadThread(slug) {
    window.KDAuth.authedFetch('/api/messages/thread?productSlug=' + encodeURIComponent(slug))
      .then(function (r) { return r.json(); }).then(function (data) {
        renderThread(data.messages || []);
      }).catch(function () {});
  }

  function openMsgPanel(slug, title) {
    if (!window.KDAuth.requireLogin(location.pathname)) return;
    var panel = ensurePanel();
    document.getElementById('msgSheetTitle').textContent = title + ' hakkında';
    panel.hidden = false;
    loadThread(slug);

    var sendBtn = document.getElementById('msgSendBtn');
    var input = document.getElementById('msgTextInput');
    input.value = '';

    var send = function () {
      var text = input.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      window.KDAuth.authedFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productSlug: slug, productTitle: title, text: text }),
      }).then(function (r) { return r.json(); }).then(function (conv) {
        input.value = '';
        sendBtn.disabled = false;
        renderThread(conv.messages || []);
      }).catch(function () { sendBtn.disabled = false; });
    };

    sendBtn.onclick = send;
    input.onkeydown = function (e) { if (e.key === 'Enter') send(); };
  }

  window.KDMessages = { open: openMsgPanel };

  document.addEventListener('DOMContentLoaded', function () {
    document.body.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.msg-cta');
      if (btn) openMsgPanel(btn.dataset.slug, btn.dataset.title);
    });
  });
})();
