# Aksi hesap servisi

Aksi, ev paneli ve tekne paneli için ortak kullanıcı hesapları. Bir Cloudflare Worker (`aksi-hesap`) ve içinde tek bir SQLite tabanlı Durable Object (`HesapDeposu`, örnek adı `aksi`) olarak çalışır. Önceden veritabanı ya da KV oluşturmak gerekmez, ilk yüklemede kendi kurulur. Workers ücretsiz planında çalışır: ücretsiz planda yalnızca SQLite tabanlı Durable Object açık. Günlük sınırlar 100 000 istek, 5 milyon satır okuma, 100 000 satır yazma ve toplam 5 GB.

Adres: `https://aksi-hesap.<alt-alan>.workers.dev`. Buradaki `<alt-alan>`, Cloudflare hesabının workers.dev alt alanıdır. Kamera köprüsü `imou-kamera.aksongur.workers.dev` adresinde çalıştığı için bu servisin adresi büyük olasılıkla `https://aksi-hesap.aksongur.workers.dev` olur.

## Roller

- **yonetici**: her alana erişir, ortak ayarları değiştirir, kullanıcıları yönetir.
- **aile**: yalnızca yöneticinin seçtiği alanları (`ev`, `tekne`) görür. Ortak ayarları okuyabilir ama değiştiremez.

Yetki her istekte sunucuda denetlenir.

## API

Tüm istekler ve yanıtlar JSON biçimindedir. Oturum gereken isteklerde `Authorization: Bearer <token>` başlığı gönderilir. CORS yalnızca `https://taylanaksongur.github.io` kaynağına açıktır. Hata yanıtı `{hata: "..."}` biçimindedir.

| İstek | Kim | Ne yapar |
|---|---|---|
| `GET /durum` | herkes | `{kurulu}`: hiç kullanıcı yoksa `false` |
| `POST /kurulum` `{ad, kullanici, sifre}` | herkes, yalnızca ilk kez | İlk yöneticiyi oluşturur, `{token, kullanici}` döner |
| `POST /giris` `{kullanici, sifre}` | herkes | `{token, kullanici:{id, ad, kullanici, rol, alanlar}}` |
| `POST /cikis` | oturum | Bu oturumu kapatır |
| `GET /ben` | oturum | `{kullanici}` |
| `POST /sifre` `{eski, yeni}` | oturum (her rol) | Kendi şifresini değiştirir. Eski şifre girişle aynı hız sınırıyla doğrulanır, yanlışsa `403`. Yeni şifre en az 8 karakter. Başarıda bu kullanıcının diğer oturumları kapanır, mevcut oturum açık kalır |
| `GET /ayarlar/kisisel` | oturum | `{veri, surum, guncelleme}` (hiç yazılmamışsa `veri: null, surum: 0`) |
| `PUT /ayarlar/kisisel` `{veri, surum?}` | oturum | Kişisel ayarı yazar, en çok 64 KB, `{surum, guncelleme}` döner |
| `GET /ayarlar/ortak/{ev\|tekne\|aksi}` | o alana erişimi olan (`aksi`: herkes) | `{veri, surum, guncelleme}` |
| `PUT /ayarlar/ortak/{alan}` `{veri, surum?}` | yonetici | En çok 512 KB |
| `GET /kullanicilar` | yonetici | Kullanıcı listesi |
| `POST /kullanicilar` `{ad, kullanici, sifre, rol, alanlar}` | yonetici | Yeni kullanıcı oluşturur |
| `PATCH /kullanicilar/{id}` `{ad?, rol?, alanlar?, sifre?}` | yonetici | Kullanıcıyı düzenler. Şifre sıfırlanınca o kullanıcının oturumları kapanır |
| `DELETE /kullanicilar/{id}` | yonetici | Kullanıcıyı siler. Son yönetici silinemez ve aile rolüne düşürülemez (409) |

**Sürüm denetimi:** `PUT` gövdesinde `surum` gönderilirse, değer en son okunan sürüm olmalıdır. Aradan başka bir cihaz yazmışsa yanıt `409` olur ve güncel `{surum, veri}` geri döner. `surum` gönderilmezse yazılan değer var olanın üzerine yazılır.

**Kurallar:**
- Kullanıcı adı 3-32 karakter uzunluğundadır; küçük harf, rakam ve `. _ -` içerebilir. Büyük-küçük harf farkı gözetilmez.
- Şifre en az 8 karakterdir.
- Hatalı giriş ve hatalı eski şifre (`/sifre`) denemeleri sayılır. 15 dakika içinde aynı kullanıcı adı ve IP için 5, aynı IP için (tüm kullanıcı adları) 20 ya da aynı kullanıcı adı için (tüm IP'ler) 20 deneme aşılırsa yanıt `429` olur ve `bekle` alanı saniye cinsinden döner. Var olmayan kullanıcı adları da aynı şekilde sayılır. Sayaç şifre denetiminden önce artırılır, böylece paralel istekler sınırı aşamaz. Başarılı girişte kullanıcı adı+IP sayacı silinir.

**Güvenlik:**
- Şifreler PBKDF2-SHA256 ile 100 000 turla özetlenir. Her şifrenin 16 baytlık rastgele bir tuzu vardır, karşılaştırma sabit zamanlıdır. 100 000, Workers'ın üst sınırıdır; tur sayısı her kullanıcı için ayrıca saklanır, böylece ileride artırılabilir.
- Belirteç 32 bayt rastgele değerdir. Sunucuda yalnızca SHA-256 özeti tutulur. Süresi 180 gündür ve kullanıldıkça uzar. Yazma kotasını korumak için uzatma en çok günde bir kez kaydedilir.

## Taylan'ın yapacakları

1. **Sırları ekle.** GitHub'da `taylanaksongur/Aksi` deposunu aç ve **Settings → Secrets and variables → Actions → New repository secret** yoluyla iki sır ekle: `CLOUDFLARE_API_TOKEN` ve `CLOUDFLARE_ACCOUNT_ID`. Değerler `akilli-ev` deposundakilerle aynı olabilir. Belirteçte *Workers Scripts: Edit* izni olmalı; kamera köprüsünü yükleyen belirteçte bu izin zaten var. Sırlar eklenmezse yükleme adımı atlanır, iş akışı hata vermez.
2. **İlk yüklemeyi yap.** Bu klasör `main` dalına gönderilince `.github/workflows/hesap-servisi.yml` servisi kendiliğinden yükler. Sırları sonradan eklediysen **Actions → "Hesap servisini Cloudflare'e yükle" → Run workflow** ile elle başlat.
3. **Adresi bul.** Yükleme günlüğünün sonunda adres yazar: `https://aksi-hesap.<alt-alan>.workers.dev`. Tarayıcıda `…/durum` açıldığında `{"kurulu":false}` görünmelidir.
4. **İlk yöneticiyi oluştur.** Bunu Aksi giriş ekranının kurulum adımından yap. Kurulum yalnızca bir kez yapılabilir, bu yüzden yükledikten sonra geciktirme: ilk kurulumu yapan kişi yönetici olur.
