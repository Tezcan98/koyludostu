(function () {
  window.KDAuth = {
    token: function () { return localStorage.getItem('kd_auth_token'); },
    phone: function () { return localStorage.getItem('kd_auth_phone'); },
    userId: function () { return localStorage.getItem('kd_auth_userid') || ''; },
    name: function () { return localStorage.getItem('kd_auth_name') || ''; },
    role: function () { return localStorage.getItem('kd_auth_role') || 'alici'; },
    isLoggedIn: function () { return !!this.token(); },
    isSeller: function () { return this.isLoggedIn() && this.role() === 'satici'; },
    logout: function () {
      var t = this.token();
      localStorage.removeItem('kd_auth_token');
      localStorage.removeItem('kd_auth_phone');
      localStorage.removeItem('kd_auth_userid');
      localStorage.removeItem('kd_auth_name');
      localStorage.removeItem('kd_auth_role');
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
    fmtPhone: function (p) {
      if (!p || p.length !== 10) return p || '';
      return '0' + p.slice(0, 3) + ' ' + p.slice(3, 6) + ' ' + p.slice(6, 8) + ' ' + p.slice(8);
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

  document.addEventListener('DOMContentLoaded', renderAuthSlot);
})();
