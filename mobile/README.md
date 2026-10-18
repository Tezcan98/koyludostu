# Köylü Dostu — Mobil (Capacitor WebView)

Native bir kod tabanı değil — `beta.koyludostu.com`'u bir WebView kabuğunda açan
ince bir Capacitor sarmalayıcı. Siteye yapılan her değişiklik (serve.js deploy'u)
otomatik olarak uygulamaya da yansır, ayrı bir mobil güncelleme/store review
gerekmez.

- `capacitor.config.json` → `server.url` gerçek siteyi gösterir.
- `assets/` → ikon/splash kaynakları (`koyludostu-tumsite/main/assets/logo-icon.jpg`'den üretildi).
- `android/` → `npx cap add android` ile oluşturulan native proje (build çıktıları git'e girmez).

## Kurulum (yeni bir makinede)

```bash
cd mobile
npm install
npx cap sync android
```

## Debug APK üretmek

```bash
cd mobile/android
./gradlew assembleDebug
# çıktı: app/build/outputs/apk/debug/app-debug.apk
```

Gerekli: JDK 17 + Android SDK (`ANDROID_HOME`/`local.properties` ayarlı olmalı,
`local.properties` git'e girmez, makineye özel).

## İkon/splash'ı güncellemek

`assets/icon.png` ve `assets/splash.png` dosyalarını değiştirip:

```bash
npx capacitor-assets generate --android
```

## Play Store için (henüz yapılmadı)

- İmzalama anahtarı (keystore) oluşturulmalı — **güvenli bir yerde saklanmalı,
  kaybedilirse uygulama bir daha güncellenemez.**
- `./gradlew bundleRelease` ile `.aab` üretilip Play Console'a yüklenir.
- Store listesi (açıklama, ekran görüntüleri, gizlilik politikası linki —
  zaten `kvkk.html`/`gizlilik.html` var) hazırlanmalı.
