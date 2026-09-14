# Kullanım Senaryosu Ekran Görüntüleri

Bu klasördeki görseller reklam/tanıtım amaçlı üretildi; gerçek kullanıcı verisi
içermez (tüm hesaplar, ürünler ve yorumlar `usecase-gen.js` tarafından izole bir
test sunucusunda oluşturuldu). Dört senaryo, her birinde bir satıcı ürün açıyor,
bir alıcı soru sorup sipariş veriyor ve satış tamamlanıyor; senaryolar buradan
ayrışıyor:

- **senaryo-1-itiraz-hakli** — alıcı düşük puan verir, admin onaylar, satıcı
  itiraz eder, admin itirazı haklı bulur ve yorum yayından kalkar.
- **senaryo-2-itiraz-haksiz** — aynı akış, ama admin itirazı haksız bulur ve
  yorum yayında kalır.
- **senaryo-3-basarili-iyi-puan** — satış sorunsuz tamamlanır, alıcı 5 yıldız
  verir (4-5 yıldız doğrudan yayınlanır).
- **senaryo-4-basarili-kotu-puan** — satış tamamlanır ama alıcı düşük puan
  verir; admin onayından geçtikten sonra yayınlanır, itiraz yok.

`security-pentest-report.md`, bu görüntüler üretilirken aynı oturumda yapılan
bir dizi saldırı denemesinin (XSS, IDOR, yetkisiz erişim, prototype pollution,
kaba kuvvet, enjeksiyon denemeleri) sonucunu listeler. Aynı doğrulamaların kalıcı
hali `tests/api.test.js` içindedir.

Yeniden üretmek için: `node usecase-gen.js` (repo kökünden, `KD_DATA_DIR` ile
izole, `PORT=8096` üzerinde ayrı bir `serve.js` süreci çalışıyor olmalı —
betiğin başındaki `BASE`/`ADMIN_PASSWORD` sabitlerine bakın).
