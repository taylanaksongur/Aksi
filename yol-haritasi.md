# Aksi yol haritası

Taylan'ın onayladığı işler. Koordinatör buradan sırayla uzmanlara dağıtır; biten işin satırı "Bitti" olur.

## Sıradaki işler

| No | İş | Kim | Durum | Not |
|---|---|---|---|---|
| Y1 | Demir alarmı (haritada yarıçap, iz, çemberden çıkınca sesli alarm ve kırmızı ekran) | tekne-uzmani | Sırada | Telefon/tablet GPS'iyle, sayfa açıkken çalışır. Uzaktan izleme Y6 ile gelir. |
| Y2 | Ortak uyarı merkezi (ev + tekne uyarıları saatli tek listede, "Gördüm") | arayuz-tasarimci | Sırada | Önce küçük sürüm: mevcut uyarı çipleri listeye bağlanır. |
| Y3 | Tablet sabit ekran modu (ekran açık kalsın, gece kısık, büyük saat ve özet) | arayuz-tasarimci | Sırada | iOS 18.4+ Wake Lock. Sürekli değil, gerektiğinde açılır. |
| Y4 | Akü, tank, sıcaklık geçmiş grafiği (24 saat, dokununca 7 gün) | tekne-uzmani | Sırada | Okumalar bağlıyken saklanır; Y6 gelince sunucuda tutulur. |
| Y6 | Uzaktan izleme ve kilit ekranına bildirim | tekne-uzmani + altyapi-uzmani | Donanım bekleniyor | Aşağıdaki ağ geçidi kartı ile. |
| Y7 | Ev enerji özeti (anlık W, günlük kWh) | ev-uzmani | Ön kontrol | Önce evde güç ölçen priz (SONOFF S31/POW vb.) var mı bakılacak. |
| H1 | Kullanıcı hesapları ve cihazlar arası ayarlar | altyapi-uzmani | Bitti (2026-11-12) — paneller `esitle.js` ile bağlandı; şifreler eşitlenmez | Roller: yonetici / aile (ev, tekne alan seçimi). Cloudflare `aksi-hesap`. |
| H2 | Köprüler (iHost, Imou kamera) hesap belirtecini denetlesin; aile üyesi alan izni cihaz komutlarında da geçerli olsun | altyapi-uzmani | Kodda bitti (2026-11-14); deploy bekliyor | Şu an izin yalnız hesap servisindeki verileri koruyor. |
| E8 | Ev panelinde oda görünümleri (odaya dokununca yakınlaşma) | ev-uzmani | Bitti (2026-11-12) | Taylan'ın fikri. |

Reddedilen: Y5 (ev + tekne ikili senaryo) → `yenilik-gecmisi.md`.

## Tekne ağ geçidi kartı (Y6 için)

**Karar (2026-11-12):** Tablet sürekli açık kalmayacak (akü tüketimi, ısınma, ekran yıpranması). Bunun yerine teknede küçük, ekransız bir ağ geçidi kartı kullanılacak.

- **Önerilen kart:** SIM'li ESP32, ör. LILYGO T-SIM7600 (4G + Bluetooth). Yaklaşık 1 W.
- **Bağlantı:** Teknenin 12 V hattına (12 V → 5 V dönüştürücü ile), su almayan bir kutuda.
- **Ne yapar:** xRoute'a Bluetooth'tan bağlanır (FFE0/FFE1, `InitNextion`), akü/tank/sıcaklık/GPS okumalarını 4G ile `aksi-hesap` servisine gönderir; servis eşik aşılınca telefona bildirim atar. Aynı yoldan uzaktan ışık/komut gönderilebilir.
- **Gereken:** kart, veri hatlı SIM, 12 V → 5 V dönüştürücü, kutu. Yazılımı tekne-uzmani yazar.
- **Dikkat:** xRoute aynı anda tek Bluetooth bağlantısı kabul ediyorsa kart bağlıyken telefon/tablet doğrudan bağlanamaz; o durumda panel de komutları kart üzerinden gönderir. Kart gelince ilk iş bunu denemek.
- **Durum:** Kartın alınması bekleniyor. Tablet yalnızca demir nöbeti gibi geçici durumlarda kullanılacak.
