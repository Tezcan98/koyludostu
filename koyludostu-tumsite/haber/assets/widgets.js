(function () {
  var CONSENT_KEY = 'kd_cerez_onay';

  var PRAYER_ORDER = ['Imsak', 'Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  var PRAYER_LABEL = {
    Imsak: 'İmsak', Fajr: 'Sabah', Sunrise: 'Güneş', Dhuhr: 'Öğle',
    Asr: 'İkindi', Maghrib: 'Akşam', Isha: 'Yatsı',
  };

  var PIYASA_ITEMS = [
    ['bist100', 'BIST 100', ''],
    ['usdtry', 'DOLAR', '₺'],
    ['eurtry', 'EURO', '₺'],
    ['gbptry', 'STERLİN', '₺'],
    ['gramaltin', 'ALTIN', '₺'],
    ['ceyrekaltin', 'ÇEYREK ALTIN', '₺'],
    ['onsaltin', 'ONS ALTIN', '$'],
    ['gumus', 'GÜMÜŞ', '₺'],
    ['platin', 'PLATİN', '$'],
    ['bakir', 'BAKIR', '$'],
    ['petrol', 'PETROL', '$'],
    ['bitcoin', 'BİTCOİN', '₺'],
    ['ethereum', 'ETHEREUM', '$'],
  ];

  // ---------------- Piyasa (BIST/döviz/altın/emtia/kripto) ticker ----------------

  function fmtNum(n) {
    return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function changeMarkup(pct) {
    var dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    var arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
    return '<span class="di-change ' + dir + '">' + arrow + ' %' + Math.abs(pct).toFixed(2) + '</span>';
  }

  function renderPiyasa(el, data) {
    el.innerHTML = PIYASA_ITEMS.map(function (it) {
      var key = it[0], label = it[1], prefix = it[2];
      var d = data[key];
      if (!d) return '';
      var valueStr = prefix === '₺' ? '₺' + fmtNum(d.value) : prefix === '$' ? '$' + fmtNum(d.value) : fmtNum(d.value);
      return '<div class="doviz-item"><span class="di-label">' + label + '</span>' +
        '<span class="di-value">' + valueStr + '</span>' + changeMarkup(d.changePct) + '</div>';
    }).join('');
  }

  function initPiyasa() {
    var el = document.getElementById('dovizTicker');
    if (!el) return;
    function load() {
      fetch('/api/piyasa').then(function (r) { return r.json(); })
        .then(function (data) { renderPiyasa(el, data); })
        .catch(function () { el.innerHTML = '<div class="doviz-item"><span class="di-label">Piyasa verisi şu an alınamıyor</span></div>'; });
    }
    load();
    setInterval(load, 3 * 60 * 1000);
  }

  // ---------------- Namaz vakti geri sayımı (IP'den şehir) ----------------

  function parseTimeToday(hhmm) {
    var parts = hhmm.split(':').map(Number);
    var d = new Date();
    d.setHours(parts[0], parts[1], 0, 0);
    return d;
  }

  function findNext(timings) {
    var now = new Date();
    for (var i = 0; i < PRAYER_ORDER.length; i++) {
      var key = PRAYER_ORDER[i];
      var t = parseTimeToday(timings[key]);
      if (t > now) return { key: key, time: t };
    }
    var tomorrowImsak = parseTimeToday(timings.Imsak);
    tomorrowImsak.setDate(tomorrowImsak.getDate() + 1);
    return { key: 'Imsak', time: tomorrowImsak };
  }

  function fmtCountdown(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = String(Math.floor(s / 3600)).padStart(2, '0');
    var m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    var sec = String(s % 60).padStart(2, '0');
    return h + ':' + m + ':' + sec;
  }

  function startCountdown(el, timings) {
    var next = findNext(timings);
    function tick() {
      var now = new Date();
      var diff = next.time - now;
      if (diff <= 0) { next = findNext(timings); diff = next.time - now; }
      el.innerHTML = '<b>' + PRAYER_LABEL[next.key] + " vaktine kalan:</b> " +
        '<span class="nw-countdown">' + fmtCountdown(diff) + '</span>';
    }
    tick();
    setInterval(tick, 1000);
  }

  function initNamaz() {
    var el = document.getElementById('namazWidget');
    var locEl = document.getElementById('namazLoc');
    if (!el) return;
    fetch('/api/namaz')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (locEl) locEl.textContent = data.city ? data.city : 'Türkiye';
        startCountdown(el, data.timings);
      })
      .catch(function () { el.textContent = 'Namaz vakti verisi şu an alınamıyor.'; });
  }

  // ---------------- Hava durumu ----------------

  function initHava() {
    var el = document.getElementById('havaWidget');
    if (!el) return;
    fetch('/api/hava').then(function (r) { return r.json(); })
      .then(function (d) {
        el.innerHTML = '<span class="hv-icon">' + d.icon + '</span>' +
          '<span class="hv-temp">' + d.tempC + '°C</span>' +
          '<span class="hv-city">' + (d.city || '') + '</span>';
      })
      .catch(function () { el.textContent = ''; });
  }

  // ---------------- Son Dakika şeridi (Tarım Gündemi + blog) ----------------

  var TICKER_ITEMS = [
    { t: "Tarımda 2026'da Rekor Hasat Bekleniyor", h: 'tarimda-2026-rekor-hasat-bekleniyor.html' },
    { t: "Karadeniz'de Buğday Fiyatları Yükseliyor", h: 'karadenizde-bugday-fiyatlari-yukseliyor.html' },
    { t: "Aydın'da İncir Hasadı Başladı", h: 'aydinda-incir-hasadi-basladi.html' },
    { t: 'Gıda Enflasyonu Tahmini Yüzde 26,3\'e Yükseltildi', h: 'gida-enflasyonu-tahmini-yukseltildi.html' },
    { t: 'İncirin Faydaları: Bilim Ne Diyor?', h: 'incirin-faydalari-bilimsel-bakis.html' },
    { t: 'Küçük Üretici İçin Doğrudan Satışın Önemi', h: '/blog/kucuk-uretici-icin-dogrudan-satisin-onemi.html' },
    { t: 'Bağcılıkta Hasat Dönemi: Nelere Dikkat Edilir?', h: '/blog/bagcilikta-hasat-donemi-nelere-dikkat-edilir.html' },
    { t: 'Organik ve Doğal Gıdaya Talep Neden Artıyor?', h: '/blog/organik-gidaya-talep-neden-artiyor.html' },
    { t: 'Yerel Üretimden Alışverişin Toplumsal Faydaları', h: '/blog/yerel-uretimden-alisverisin-toplumsal-faydalari.html' },
    { t: 'Damla Sulama Sistemleri Nasıl Çalışır?', h: '/blog/damla-sulama-sistemleri-nasil-calisir.html' },
    { t: 'Akıllı Tarım: Sensörlerle Verim Takibi', h: '/blog/akilli-tarim-sensorlerle-verim-takibi.html' },
    { t: 'Pekmez Nasıl Yapılır? Geleneksel Üretim Süreci', h: '/blog/pekmez-nasil-yapilir.html' },
    { t: 'Asma Yaprağı Nasıl Saklanır?', h: '/blog/asma-yapragi-nasil-saklanir.html' },
  ];
  var TICKER_PX_PER_SEC = 70;

  function initTicker() {
    var track = document.getElementById('tickerTrack');
    if (!track) return;
    var itemsHtml = TICKER_ITEMS.map(function (it) {
      return '<span><a href="' + it.h + '">' + it.t + '</a></span>';
    }).join('');
    track.innerHTML = itemsHtml + itemsHtml;
    var oneCopyWidth = track.scrollWidth / 2;
    var duration = Math.max(20, oneCopyWidth / TICKER_PX_PER_SEC);
    track.style.animationDuration = duration + 's';
  }

  // ---------------- Manşet carousel ----------------

  function initHeroCarousel() {
    var container = document.getElementById('heroCarousel');
    var dotsEl = document.getElementById('heroDots');
    if (!container) return;
    var slides = Array.prototype.slice.call(container.querySelectorAll('.hero-slide'));
    if (slides.length < 2) return;
    var idx = 0;

    if (dotsEl) {
      dotsEl.innerHTML = slides.map(function (_, i) {
        return '<button data-i="' + i + '"' + (i === 0 ? ' class="active"' : '') + '></button>';
      }).join('');
    }

    function show(i) {
      idx = (i + slides.length) % slides.length;
      slides.forEach(function (s, si) { s.classList.toggle('active', si === idx); });
      if (dotsEl) {
        Array.prototype.forEach.call(dotsEl.children, function (b, bi) {
          b.classList.toggle('active', bi === idx);
        });
      }
    }

    if (dotsEl) {
      Array.prototype.forEach.call(dotsEl.children, function (b) {
        b.addEventListener('click', function () { show(Number(b.dataset.i)); resetTimer(); });
      });
    }

    var timer = setInterval(function () { show(idx + 1); }, 5000);
    function resetTimer() { clearInterval(timer); timer = setInterval(function () { show(idx + 1); }, 5000); }
  }

  // ---------------- Çerez bildirimi ----------------

  function initConsent() {
    var banner = document.getElementById('cerezBanner');
    var stored = localStorage.getItem(CONSENT_KEY);
    if (stored) { if (banner) banner.remove(); return; }
    if (!banner) return;

    banner.hidden = false;
    var acceptBtn = document.getElementById('cerezKabul');
    var rejectBtn = document.getElementById('cerezRed');
    [acceptBtn, rejectBtn].forEach(function (btn, i) {
      if (!btn) return;
      btn.addEventListener('click', function () {
        localStorage.setItem(CONSENT_KEY, i === 0 ? 'kabul' : 'red');
        banner.remove();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initPiyasa();
    initNamaz();
    initHava();
    initHeroCarousel();
    initTicker();
    initConsent();
  });
})();
