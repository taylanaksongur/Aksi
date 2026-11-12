# Aksi proje ekibi

Aksi, Taylan'ın akıllı ev ve akıllı tekne projelerini birleştiren ana ekrandır. Üç ayrı GitHub deposundan oluşur, hepsi GitHub Pages'te yayında:

| Depo | Adres | İçerik |
|---|---|---|
| `taylanaksongur/Aksi` | taylanaksongur.github.io/Aksi/ | Ana ekran: ev ve tekne kartları, açık ışık butonları |
| `taylanaksongur/akilli-ev` | taylanaksongur.github.io/akilli-ev/ | Aksongur Ev Paneli (3 katlı ev, 3B sahne, iHost, Meross, Imou kameralar) |
| `taylanaksongur/Tekne-panel` | taylanaksongur.github.io/Tekne-panel/ | The Moon Tekne Paneli (xRoute BLE, harita, kameralar) |

## Ekip

Ana oturum (koordinatör) işi böler ve ilgili uzmana verir:

- **ev-uzmani** – akilli-ev deposu, iHost / Meross / Homebridge / Cosa termostat
- **tekne-uzmani** – Tekne-panel deposu, xRoute BLE protokolü
- **arayuz-tasarimci** – ortak görünüm, telefon düzeni, ana ekran uygulaması (PWA)
- **test-kontrol** – her değişikliği yayına almadan önce kontrol eder
- **ergonomi-degerlendirici** – her güncellemeden sonra sayfayı kullanım açısından değerlendirir, öneri raporu hazırlar

## Güncelleme akışı

1. İlgili uzman değişikliği yapar.
2. **test-kontrol** inceler; sorun varsa uzman düzeltir, sonra GitHub'a gönderilir.
3. **ergonomi-degerlendirici** güncellenen sayfayı değerlendirir ve numaralı öneri raporu hazırlar.
4. Koordinatör raporu Taylan'a sunar: her öneri numarası, önceliği ve kısa açıklamasıyla. Hiçbir öneri onaysız uygulanmaz.
5. Taylan onayladığı numaraları söyler (ör. "1 ve 3'ü yap"). Yalnızca onaylananlar ilgili uzmana verilir; uygulandıktan sonra akış 2. adımdan devam eder.
6. Reddedilen öneriler `degerlendirme-gecmisi.md` dosyasına not edilir ki aynı öneri tekrar sunulmasın.

## Ortak kurallar

- Arayüz dili Türkçe.
- Üç sayfa aynı görsel dili kullanır: lacivert zemin `#0f1430`, paneller `#181f45` / `#20295a`, çizgi `#2c3670`, vurgu `#4a63ff`, açık ışık `#ffbf5e`, iyi `#36d39a`, açık mavi `#4fc3ff`, tehlike `#ff6b81`. Yazı tipleri Sora (başlık), IBM Plex Sans (metin), IBM Plex Mono (sayı).
- Sayfalar iPhone'da masaüstüne eklenmiş tam ekran uygulama olarak kullanılır. Aksi'nin `manifest.webmanifest` kapsamı `/` olduğu için üç sayfa aynı pencerede açılır. Panellerdeki **‹ Aksi** düğmesi (`/Aksi/`) korunmalı; tam ekranda başka geri dönüş yolu yok.
- Bağlantılar depo adlarının büyük-küçük harfine uyar (`/Aksi/`, `/akilli-ev/`, `/Tekne-panel/`).
- Şifre, API anahtarı, hesap bilgisi depoya yazılmaz; bunlar yalnızca cihazda (localStorage) ya da köprü servisinin kendi ayarında durur.
- Commit'ler küçük ve açıklamalı olur, mesajlar Türkçe.
