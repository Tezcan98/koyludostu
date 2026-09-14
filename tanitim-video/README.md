# Tanıtım Videosu

`final/koyludostu-tanitim.mp4` — ~68 saniyelik, gerçek uygulama ekranlarından
Playwright ile kaydedilmiş bir tanıtım videosu. Sahte mockup değil; izole bir
demo sunucusunda (`video-seed.js` ile doldurulmuş, production data'ya dokunmadan)
gerçek bir kullanıcı akışı kaydedildi:

1. **Marka kartı** — "köylüdostu"
2. **Alıcı yolculuğu** — anasayfa + filtreler, ürün sayfası (satıcı kartı,
   fiyat, değerlendirmeler), satıcıya mesaj yazma, sipariş talebi (miktar
   sayacı + canlı tutar), Vitrin (Keşfet) — otomatik ilerleyen ürün akışı
3. **Satıcı paneli** — Panelim (istatistikler), Gelen Siparişler, Ürünlerim
4. **Kapanış kartı**

Yeniden üretmek için (repo kökünden, sırayla):
```
KD_DATA_DIR=$(mktemp -d) PORT=8093 ADMIN_PASSWORD=video-demo-pw node serve.js &
node video-seed.js      # demo satıcı/ürün/yorum verisi oluşturur
node video-record.js    # tanitim-video/raw/ altına iki ham .webm kaydeder
```
Sonra `final/` altındaki ffmpeg komutlarıyla (webm → mp4 dönüşüm + concat)
birleştirilir — bkz. sohbet geçmişi ya da elle:
```
ffmpeg -i raw/<buyer>.webm -c:v libx264 -pix_fmt yuv420p -r 30 final/scene1-buyer.mp4
ffmpeg -i raw/<seller>.webm -c:v libx264 -pix_fmt yuv420p -r 30 final/scene2-seller.mp4
# title-card.mp4 / closing-card.mp4 zaten final/ içinde, tekrar üretmeye gerek yok
ffmpeg -f concat -safe 0 -i final/concat-list.txt -c copy final/koyludostu-tanitim.mp4
```
