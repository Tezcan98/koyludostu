# Satıcı tarafından uçtan uca gerçek bir satış — canlı sitede

Bu klasördeki ekran görüntüleri, canlı Köylü Dostu sitesinde (koyludostu app,
`31.58.245.116:8010` / `beta.koyludostu.com`) gerçek bir demo alıcı ve mevcut
demo şirket satıcısı ("Köylü Dostu Tedarik") arasında uçtan uca yapılan bir
satışı gösteriyor — özel bir test ortamı değil, gerçek dağıtılmış uygulama.

## Akış

1. **01** — Alıcı (Ahmet Yılmaz) "Taze Asma Yaprağı" ürün sayfasında.
2. **02** — Sipariş Talebi formu dolduruluyor (miktar, il/ilçe, açık adres —
   artık zorunlu, aciliyet, özel istek).
3. **03** — Talep gönderildi, Siparişlerim'e yönlendirildi.
4. **04** — Satıcı, Gelen Siparişler'de yeni talebi görüyor.
5. **05** — Satıcı Sipariş Şartları'nı kabul edip talebi onaylıyor.
6. **06** — Satıcı siparişi tamamlandı olarak işaretliyor.
7. **07** — Satıcı şirket/vergi mükellefi olduğundan "Fatura Oluştur" ile KDV
   dahil bir fatura taslağı üretiyor (Nilvera bağlı değilse otomatik taslağa
   düşer — burada da öyle oldu, taslak akışı sorunsuz çalıştı).
8. **08** — Alıcı, Siparişlerim'de satıcının IBAN'ını görüyor ve ödeme
   kutusunu kullanabiliyor (bu akış önceden satıcı IBAN eklemediğinde
   sessizce kayboluyordu — düzeltildi).
9. **09** — Alıcı "Ödemeyi Gönderdim" diyor.
10. **10** — Alıcı "Teslim Aldım" ile teslimatı onaylıyor.
11. **11** — Alıcı 5 yıldız + yorum bırakıyor.
12. **12** — Satıcının Panelim sayfası: güncel ürün/puan/sipariş istatistikleri.
13. **13** — Ürün sayfası, yeni yorumla birlikte.

## Notlar

- Alıcı hesabı bu test için otomatik oluşturuldu (SMS_NOT_CONNECTED=1 ile sabit
  "0000" doğrulama koduyla); satıcı ("Köylü Dostu Tedarik", 5900000015) zaten
  var olan bir demo/seed hesabı.
- Bu, gerçek bir kullanıcı verisine dokunmadı — tüm hesaplar kuruluşun kendi
  demo hesapları.
