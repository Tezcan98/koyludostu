(function () {
  function starsHtml(n) {
    var s = '';
    for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆';
    return s;
  }

  function timeAgo(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    var day = Math.floor(diff / 86400000);
    if (day < 1) return 'bugün';
    if (day === 1) return 'dün';
    if (day < 30) return day + ' gün önce';
    return Math.floor(day / 30) + ' ay önce';
  }

  function isPublic(r) { return r.status !== 'pending' && r.status !== 'rejected'; }

  function renderAvg(root, reviews) {
    var el = root.querySelector('#avgRating');
    var pub = reviews.filter(isPublic);
    if (!pub.length) { el.innerHTML = '<span class="count">Henüz yorum yok — ilk yorumu sen yaz.</span>'; return; }
    var avg = (pub.reduce(function (a, r) { return a + r.rating; }, 0) / pub.length).toFixed(1);
    el.innerHTML = '<span class="stars">' + starsHtml(Math.round(avg)) + '</span>' +
      '<span class="count">' + avg + ' / 5 · ' + pub.length + ' değerlendirme</span>';
  }

  function renderList(root, reviews, myUserId) {
    var el = root.querySelector('#reviewList');
    var visible = reviews.filter(function (r) { return isPublic(r) || r.userId === myUserId; });
    if (!visible.length) { el.innerHTML = '<p class="review-empty">Bu ürün için henüz yorum yapılmamış.</p>'; return; }
    el.innerHTML = visible.map(function (r) {
      var badge = r.role === 'satici' ? ' <span style="font-size:10px;font-weight:800;color:var(--ring1);">SATICI</span>' : '';
      var pendingNote = r.status === 'pending' ? ' <span style="font-size:10px;font-weight:800;color:var(--ring2);">ONAY BEKLİYOR (sadece sen görüyorsun)</span>' : '';
      var reply = r.sellerReply ? '<div class="rreply"><b>Satıcı yanıtı:</b> ' + r.sellerReply.text.replace(/[<>]/g, '') + '</div>' : '';
      return '<div class="review-item">' +
        '<div class="rname">' + r.name.replace(/[<>]/g, '') + badge + pendingNote + '</div>' +
        '<div class="rstars">' + starsHtml(r.rating) + ' <span style="color:var(--muted);font-weight:400;font-size:11px;">' + timeAgo(r.createdAt) + '</span></div>' +
        '<div class="rtext">' + r.text.replace(/[<>]/g, '') + '</div>' +
        reply +
      '</div>';
    }).join('');
  }

  function renderForm(root, slug, reviews) {
    var wrap = root.querySelector('#reviewFormWrap');
    if (!window.KDAuth.isLoggedIn()) {
      wrap.innerHTML = '<p class="review-empty" style="margin-bottom:18px;"><a href="/giris.html?sonra=' +
        encodeURIComponent(location.pathname) + '" style="color:var(--ring1);font-weight:700;">Giriş yap</a> ve bu ürünü değerlendir.</p>';
      return;
    }
    var mine = reviews.find(function (r) { return r.userId === window.KDAuth.userId(); });
    var rating = mine ? mine.rating : 0;
    wrap.innerHTML =
      '<div class="review-form">' +
        '<label>Puanın</label>' +
        '<div class="star-picker" id="starPicker"></div>' +
        '<label>Yorumun</label>' +
        '<textarea id="rText" rows="3" placeholder="Bu ürün hakkında ne düşünüyorsun?">' + (mine ? mine.text.replace(/</g, '&lt;') : '') + '</textarea>' +
        '<button type="button" id="submitReviewBtn">' + (mine ? 'Yorumu Güncelle' : 'Yorumu Gönder') + '</button>' +
      '</div>';

    var picker = wrap.querySelector('#starPicker');
    for (var i = 1; i <= 5; i++) {
      var span = document.createElement('span');
      span.textContent = '★';
      span.dataset.v = i;
      if (i <= rating) span.classList.add('filled');
      picker.appendChild(span);
    }
    picker.querySelectorAll('span').forEach(function (s) {
      s.addEventListener('click', function () {
        rating = Number(s.dataset.v);
        picker.querySelectorAll('span').forEach(function (x) {
          x.classList.toggle('filled', Number(x.dataset.v) <= rating);
        });
      });
    });

    wrap.querySelector('#submitReviewBtn').addEventListener('click', function () {
      var text = wrap.querySelector('#rText').value.trim();
      if (!rating || !text) { alert('Lütfen puan ver ve yorumunu yaz.'); return; }
      window.KDAuth.authedFetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productSlug: slug, rating: rating, text: text }),
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (data.error) { alert(data.error); return; }
        load(root, slug, data.reviews);
      }).catch(function () {});
    });
  }

  function load(root, slug, preloaded) {
    if (preloaded) { paint(preloaded); return; }
    fetch('/api/reviews?product=' + encodeURIComponent(slug)).then(function (r) { return r.json(); }).then(function (data) {
      paint(data.reviews || []);
    });
    function paint(reviews) {
      renderAvg(root, reviews);
      renderForm(root, slug, reviews);
      renderList(root, reviews, window.KDAuth.isLoggedIn() ? window.KDAuth.userId() : null);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.reviews-section[data-slug]').forEach(function (root) {
      load(root, root.dataset.slug);
    });
  });
})();
