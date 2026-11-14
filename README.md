# Aksi

Ev (Aksongur Ev Paneli) ve tekne (The Moon) için ortak kontrol arayüzü.

Şu an örnek veriyle çalışıyor; ileride iHost (ev) ve xRoute BLE (tekne) bağlantıları eklenecek.

## Ortak uyarı sözleşmesi (Y2)

- `localStorage["aksi-uyarilar"]` (aynı origin: taylanaksongur.github.io): JSON dizi, öğe `{id, kaynak:'ev'|'tekne', mesaj, seviye:'bilgi'|'uyari'|'tehlike', t:epoch ms, bitti:boolean}`. Paneller yazar, Aksi ana ekranı okur; sorun geçince `bitti:true` yapılır (silinmez).
- `localStorage["aksi-uyari-gordu"]`: `{id: t}`. Yalnız Aksi'nin "Gördüm" düğmesi yazar. Bitmiş ya da görülmüş uyarılar arşivde sönük görünür; rozet görülmemiş sayısıdır.
- Aynı sorun yeniden çıkarsa yeni `id` verilir (ör. `anahtar:zaman`); ev paneli yardımcısı `uyariAc/uyariKapat` bunu yapar.
