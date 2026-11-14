# Aksi

Ev (Aksongur Ev Paneli) ve tekne (The Moon) için ortak kontrol arayüzü.

Adres: **https://aksi.systems/Aksi/** (canlı, Kasım 2026'dan beri evde kullanımda).

## Depolar ve adresler

Her parça ayrı bir GitHub deposudur; hepsi `aksi.systems` alan adı altında ve ortak Aksi girişiyle birbirine bağlıdır.

| Depo | Adres | İçerik |
|---|---|---|
| `taylanaksongur/Aksi` | aksi.systems/Aksi/ | Ana ekran, giriş (`hesap.js`), ayar eşitleme (`esitle.js`), hesap servisi (`hesap-servisi/`), Yolcu TV (`yolcu-tv/`) |
| `taylanaksongur/akilli-ev` | aksi.systems/akilli-ev/ | Ev paneli (`index.html`), iHost köprüsü (`ihost-koprusu/`), kamera köprüsü kodu (`kamera-koprusu/`) |
| `taylanaksongur/Tekne-panel` | aksi.systems/Tekne-panel/ | Tekne paneli |
| `taylanaksongur/taylanaksongur.github.io` | aksi.systems/ | Yalnızca alan adı: `CNAME` ve `/Aksi/` yönlendirmesi |

- Alan adı: Cloudflare'de (`aksi.systems`), 4 A kaydı GitHub Pages'e bakar (DNS only).
- Hesap servisi Worker'ı (`aksi-hesap`) bu depodan, GitHub Actions ile yüklenir.
- Kamera Worker'ı (`imou-kamera`) kodu `akilli-ev`'de durur, ama yüklemesi bu depodaki `.github/workflows/kamera-koprusu.yml` ile yapılır ve `kamera-koprusu.surum` dosyası değişince tetiklenir. Kamera kodunu değiştirince bu dosyayı da güncelle.
- iHost köprüsü iHost'ta Docker'da çalışır; kodu değişince konteyneri yeniden başlatmak gerekir.
- CORS: Worker'lar ve iHost köprüsü yalnızca `https://aksi.systems` ve `https://taylanaksongur.github.io` kaynaklarını kabul eder. Alan adı değişirse üç yerde güncelle (`hesap-servisi/worker.js`, `kamera-koprusu/worker.js`, `ihost-koprusu/kopru.js`).

## Ortak uyarı sözleşmesi (Y2)

- `localStorage["aksi-uyarilar"]` (aynı origin: aksi.systems): JSON dizi, öğe `{id, kaynak:'ev'|'tekne', mesaj, seviye:'bilgi'|'uyari'|'tehlike', t:epoch ms, bitti:boolean}`. Paneller yazar, Aksi ana ekranı okur; sorun geçince `bitti:true` yapılır (silinmez).
- `localStorage["aksi-uyari-gordu"]`: `{id: t}`. Yalnız Aksi'nin "Gördüm" düğmesi yazar. Bitmiş ya da görülmüş uyarılar arşivde sönük görünür; rozet görülmemiş sayısıdır.
- Aynı sorun yeniden çıkarsa yeni `id` verilir (ör. `anahtar:zaman`); ev paneli yardımcısı `uyariAc/uyariKapat` bunu yapar.
