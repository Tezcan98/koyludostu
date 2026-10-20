// Satıcı kayıt/başvurusunda canlılık (liveness) doğrulaması — tek bir statik
// fotoğraf yüklemek yerine kamerayı canlı açıp sırayla "düz bak", "sağa çevir",
// "sola çevir" dedirtip 3 kare yakalıyoruz. Bu, çalıntı/bulunmuş bir fotoğrafla
// ya da ekran görüntüsüyle kayıt olmayı zorlaştırır (bot/sahte hesap caydırıcısı) —
// kimliğin gerçekten o kişiye ait olduğunu KANITLAMAZ, sadece kayıt anında canlı
// bir insanın kamera karşısında olduğunu gösterir. Admin, onay sırasında bu 3
// kareyi kimlik belgesiyle karşılaştırarak kendi kararını verir.
window.KDSelfie = (function () {
  var STEPS = [
    { key: 'center', label: 'Kameraya düz bak' },
    { key: 'right', label: 'Başını SAĞA çevir' },
    { key: 'left', label: 'Başını SOLA çevir' },
  ];

  function start(container, onComplete) {
    var stream = null;
    var stepIndex = 0;
    var shots = {};

    container.innerHTML =
      '<div class="selfie-box">' +
        '<video class="selfie-video" autoplay playsinline muted></video>' +
        '<div class="selfie-instruction"></div>' +
        '<div class="selfie-thumbs"></div>' +
        '<div class="selfie-msg"></div>' +
        '<button type="button" class="selfie-capture-btn">Çek</button>' +
      '</div>';

    var video = container.querySelector('.selfie-video');
    var instructionEl = container.querySelector('.selfie-instruction');
    var thumbsEl = container.querySelector('.selfie-thumbs');
    var msgEl = container.querySelector('.selfie-msg');
    var captureBtn = container.querySelector('.selfie-capture-btn');

    function stopStream() {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    }

    function showStep() {
      if (stepIndex >= STEPS.length) {
        stopStream();
        video.style.display = 'none';
        captureBtn.style.display = 'none';
        instructionEl.textContent = 'Doğrulama fotoğrafları alındı.';
        onComplete([shots.center, shots.right, shots.left]);
        return;
      }
      instructionEl.textContent = STEPS[stepIndex].label + ' ve "Çek"e bas.';
    }

    captureBtn.addEventListener('click', function () {
      if (!stream) return;
      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      var ctx = canvas.getContext('2d');
      ctx.translate(canvas.width, 0); ctx.scale(-1, 1); // ayna görüntüsünü düzelt
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      var key = STEPS[stepIndex].key;
      shots[key] = dataUrl;

      var thumb = document.createElement('img');
      thumb.src = dataUrl;
      thumb.className = 'selfie-thumb';
      thumbsEl.appendChild(thumb);

      stepIndex += 1;
      showStep();
    });

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        showStep();
      })
      .catch(function () {
        msgEl.textContent = 'Kameraya erişilemedi — tarayıcı izinlerini kontrol et. Kamera olmadan selfie doğrulaması tamamlanamaz.';
        captureBtn.style.display = 'none';
      });

    return { stop: stopStream };
  }

  return { start: start };
})();
