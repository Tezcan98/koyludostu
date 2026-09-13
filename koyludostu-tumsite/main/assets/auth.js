(function () {
  window.KDAuth = {
    token: function () { return localStorage.getItem('kd_auth_token'); },
    phone: function () { return localStorage.getItem('kd_auth_phone'); },
    userId: function () { return localStorage.getItem('kd_auth_userid') || ''; },
    name: function () { return localStorage.getItem('kd_auth_name') || ''; },
    role: function () { return localStorage.getItem('kd_auth_role') || 'alici'; },
    sellerStatus: function () { return localStorage.getItem('kd_auth_seller_status') || ''; },
    isLoggedIn: function () { return !!this.token(); },
    isSeller: function () { return this.isLoggedIn() && this.role() === 'satici'; },
    isApprovedSeller: function () { return this.isSeller() && this.sellerStatus() === 'approved'; },
    logout: function () {
      var t = this.token();
      localStorage.removeItem('kd_auth_token');
      localStorage.removeItem('kd_auth_phone');
      localStorage.removeItem('kd_auth_userid');
      localStorage.removeItem('kd_auth_name');
      localStorage.removeItem('kd_auth_role');
      localStorage.removeItem('kd_auth_seller_status');
      if (t) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }).catch(function () {});
    },
    requireLogin: function (redirectTo) {
      if (this.isLoggedIn()) return true;
      location.href = '/giris.html?sonra=' + encodeURIComponent(redirectTo || location.pathname);
      return false;
    },
    requireSeller: function (redirectTo) {
      if (this.isSeller()) return true;
      if (this.isLoggedIn()) {
        alert('Bu ekrana yalnızca satıcı hesapları girebilir.');
        location.href = '/index.html';
      } else {
        location.href = '/giris.html?sonra=' + encodeURIComponent(redirectTo || location.pathname);
      }
      return false;
    },
    // Satıcı paneli sayfaları (admin-*.html) için: hesap onaylanmamışsa (pending/rejected)
    // panele almak yerine başvuru durumunu gösteren sayfaya yönlendirir.
    requireApprovedSeller: function (redirectTo) {
      if (this.isApprovedSeller()) return true;
      if (this.isSeller()) {
        location.href = '/satici-basvurum.html';
        return false;
      }
      return this.requireSeller(redirectTo);
    },
    fmtPhone: function (p) {
      if (!p || p.length !== 10) return p || '';
      return '0' + p.slice(0, 3) + ' ' + p.slice(3, 6) + ' ' + p.slice(6, 8) + ' ' + p.slice(8);
    },
    // Başka bir kullanıcının yazdığı metni (mesaj, yorum, şikayet, ürün başlığı vb.)
    // innerHTML içine gömmeden önce kaçışlamak için — aksi halde biri <script> ya da
    // onerror= içeren bir metin gönderip bunu okuyan kişinin oturumunu (localStorage'daki
    // token) çalabilir. Her zaman esc(kullanıcıdan gelen metin) şeklinde kullanılmalı.
    esc: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    // Oturumun sunucu tarafında geçersiz olduğu (ör. token silindi) ama tarayıcıda hâlâ
    // kayıtlı görünen durumları sessizce görmezden gelmek yerine, 401 aldığında yerel
    // girişi temizleyip kullanıcıyı tekrar giriş yapmaya yönlendirir.
    authedFetch: function (url, options) {
      options = options || {};
      options.headers = Object.assign({}, options.headers, { Authorization: 'Bearer ' + this.token() });
      var self = this;
      return fetch(url, options).then(function (r) {
        if (r.status === 401) {
          self.logout();
          location.href = '/giris.html?sonra=' + encodeURIComponent(location.pathname);
          return Promise.reject(new Error('oturum sona erdi'));
        }
        return r;
      });
    },
  };

  function renderAuthSlot() {
    var slot = document.getElementById('authSlot');
    if (!slot) return;
    if (window.KDAuth.isLoggedIn()) {
      var inboxHref = window.KDAuth.isSeller() ? '/admin-mesajlar.html' : '/mesajlarim.html';
      var firstName = (window.KDAuth.name() || '').split(' ')[0];
      slot.innerHTML =
        '<a href="' + inboxHref + '" class="auth-slot-link">' + (firstName || window.KDAuth.fmtPhone(window.KDAuth.phone())) + '</a>' +
        '<a href="javascript:;" id="authLogoutBtn" class="auth-slot-link auth-slot-logout">Çıkış</a>';
      var btn = document.getElementById('authLogoutBtn');
      if (btn) btn.addEventListener('click', function () { window.KDAuth.logout(); location.reload(); });
    } else {
      slot.innerHTML = '<a href="/giris.html?sonra=' + encodeURIComponent(location.pathname) + '" class="auth-slot-link auth-slot-login">Giriş Yap</a>';
    }
  }

  // Satıcı hesapları için sol menüde (kdDrawer) "Satıcı Panelim" bağlantısı ekler —
  // satıcı sayfaları (admin-*.html) ayrı bir akışta yaşadığından, oraya dönüş yolu
  // olmadan bir satıcı kendi ürün/kargo/mesaj panelini bulamıyordu.
  function injectSellerNavLink() {
    if (!window.KDAuth.isSeller()) return;
    if (/^\/admin-/.test(location.pathname)) return;
    var nav = document.querySelector('.drawer-nav');
    if (!nav || nav.querySelector('.seller-panel-link')) return;
    var label = nav.querySelector('.drawer-section-label');
    if (!label) return;
    // Onaylanmamış (pending/rejected) satıcı için panele değil, başvuru durumuna götürür.
    var link = window.KDAuth.isApprovedSeller()
      ? '<a href="/admin-panelim.html" class="seller-panel-link">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>Satıcı Panelim' +
        '</a>'
      : '<a href="/satici-basvurum.html" class="seller-panel-link">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>Satıcı Başvurum' +
        '</a>';
    label.insertAdjacentHTML('afterend', link);
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderAuthSlot();
    injectSellerNavLink();
  });
})();
