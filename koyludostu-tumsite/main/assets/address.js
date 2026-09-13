// İl/ilçe seçimi: /assets/il-ilce.json'daki 81 il + ilçe listesinden birbirine
// bağlı (il seçilince ilçeler filtrelenen) iki <select> oluşturur.
window.KDAddress = (function () {
  var data = null;
  var loadingPromise = null;

  function load() {
    if (data) return Promise.resolve(data);
    if (loadingPromise) return loadingPromise;
    loadingPromise = fetch('/assets/il-ilce.json').then(function (r) { return r.json(); }).then(function (d) {
      data = d;
      return d;
    });
    return loadingPromise;
  }

  function ilList() {
    return Object.keys(data || {}).sort(function (a, b) { return a.localeCompare(b, 'tr'); });
  }

  function ilceList(il) {
    return ((data || {})[il] || []).slice().sort(function (a, b) { return a.localeCompare(b, 'tr'); });
  }

  function opt(value, label, selected) {
    return '<option value="' + value + '"' + (selected ? ' selected' : '') + '>' + label + '</option>';
  }

  // ilSelect + ilceSelect elementlerini birbirine bağlar. selectedIl/selectedIlce
  // verilirse (profil düzenleme gibi mevcut bir değeri göstermek için) o seçili gelir;
  // eski serbest-metin bir değer listede yoksa sessizce "seç" durumunda kalır.
  function bindCascade(ilSelect, ilceSelect, selectedIl, selectedIlce) {
    return load().then(function () {
      ilSelect.innerHTML = opt('', 'İl seç', !selectedIl) +
        ilList().map(function (il) { return opt(il, il, il === selectedIl); }).join('');

      function fillIlce(il, preselect) {
        var ilceler = ilceList(il);
        ilceSelect.innerHTML = ilceler.length
          ? opt('', 'İlçe seç', !preselect) + ilceler.map(function (x) { return opt(x, x, x === preselect); }).join('')
          : opt('', 'Önce il seç', true);
        ilceSelect.disabled = !ilceler.length;
      }

      fillIlce(selectedIl || '', selectedIlce || '');
      ilSelect.addEventListener('change', function () { fillIlce(ilSelect.value, ''); });
    });
  }

  // Tek başına bir il dropdown'ı doldurur (ilçe gerekmeyen yerler için, örn. ürün şehri).
  function fillIlSelect(ilSelect, selectedIl) {
    return load().then(function () {
      ilSelect.innerHTML = opt('', 'İl seç', !selectedIl) +
        ilList().map(function (il) { return opt(il, il, il === selectedIl); }).join('');
    });
  }

  return { load: load, ilList: ilList, ilceList: ilceList, bindCascade: bindCascade, fillIlSelect: fillIlSelect };
})();
