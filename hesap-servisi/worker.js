// Aksi hesap servisi (aksi-hesap.<alt-alan>.workers.dev)
// Aile kullanıcıları, roller (yonetici | aile), alan yetkileri (ev | tekne), kişisel ve ortak ayarlar.
// Tüm veri tek bir SQLite tabanlı Durable Object'te ("aksi") durur. Şifreler PBKDF2-SHA256 ile,
// oturum belirteçleri yalnızca SHA-256 özetiyle saklanır. Düz metin şifre/belirteç günlüğe yazılmaz.
import { DurableObject } from 'cloudflare:workers';

const KAYNAK = 'https://taylanaksongur.github.io';
const ALANLAR = ['ev', 'tekne'];          // yetki verilebilen alanlar
const ORTAK_ALANLAR = ['ev', 'tekne', 'aksi']; // ortak ayar alanları (aksi: giriş yapan herkes okur)
const ROLLER = ['yonetici', 'aile'];
const TUR = 100000;                        // Workers'ta PBKDF2 üst sınırı 100 000
const OTURUM_MS = 180 * 86400000;          // 180 gün, her kullanımda kayar
const UZATMA_ARALIGI_MS = 86400000;        // kayan süre en çok günde bir yazılır (yazma kotası için)
const DENEME_PENCERE_MS = 15 * 60000;
const DENEME_KULLANICI = 5;                // kullanıcı+IP başına 15 dk'da hatalı deneme
const DENEME_IP = 20;                      // IP başına 15 dk'da hatalı deneme (tüm kullanıcı adları)
const DENEME_AD = 20;                      // kullanıcı adı başına 15 dk'da hatalı deneme (tüm IP'ler; olmayan adlar da sayılır)
const KISISEL_SINIR = 64 * 1024;
const ORTAK_SINIR = 512 * 1024;
const GOVDE_SINIR = 600 * 1024;

// ---------- giriş noktası: CORS + Durable Object'e yönlendirme ----------
function corsBasliklari(origin) {
  const h = { 'Vary': 'Origin' };
  if (origin === KAYNAK) Object.assign(h, {
    'Access-Control-Allow-Origin': KAYNAK,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  return h;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsBasliklari(origin);
    if (origin && origin !== KAYNAK) return yanit(403, { hata: 'Bu kaynağa izin yok' }, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let r;
    try {
      const stub = env.HESAP.get(env.HESAP.idFromName('aksi'));
      r = await stub.fetch(request);
    } catch (e) {
      return yanit(503, { hata: 'Servis geçici olarak kullanılamıyor' }, cors);
    }
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(r.body, { status: r.status, headers: h });
  },
};

// ---------- yardımcılar ----------
function yanit(durum, veri, ek = {}) {
  return new Response(JSON.stringify(veri), {
    status: durum,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...ek },
  });
}
class Hata extends Error { constructor(durum, mesaj, ek) { super(mesaj); this.durum = durum; this.ek = ek; } }
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array(s.match(/../g).map(x => parseInt(x, 16)));
const b64url = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rastgele = n => crypto.getRandomValues(new Uint8Array(n));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function pbkdf2(sifre, tuz, tur) {
  const k = await crypto.subtle.importKey('raw', enc.encode(sifre), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: tuz, iterations: tur }, k, 256));
}
function sabitZamanliEsit(a, b) {
  if (a.length !== b.length) return false;
  let f = 0;
  for (let i = 0; i < a.length; i++) f |= a[i] ^ b[i];
  return f === 0;
}

function adDogrula(ad) {
  if (typeof ad !== 'string' || !ad.trim() || ad.trim().length > 60) throw new Hata(400, 'Ad 1-60 karakter olmalı');
  return ad.trim();
}
function kullaniciDogrula(k) {
  if (typeof k !== 'string') throw new Hata(400, 'Kullanıcı adı gerekli');
  k = k.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(k)) throw new Hata(400, 'Kullanıcı adı 3-32 karakter; harf, rakam, . _ - olabilir');
  return k;
}
function sifreDogrula(s) {
  if (typeof s !== 'string' || s.length < 8 || s.length > 200) throw new Hata(400, 'Şifre en az 8 karakter olmalı');
  return s;
}
function rolDogrula(r) {
  if (!ROLLER.includes(r)) throw new Hata(400, 'Rol yonetici ya da aile olmalı');
  return r;
}
function alanlarDogrula(a) {
  if (!Array.isArray(a) || a.some(x => !ALANLAR.includes(x))) throw new Hata(400, 'Alanlar yalnızca ev ve tekne olabilir');
  return [...new Set(a)];
}

// ---------- Durable Object ----------
export class HesapDeposu extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kullanicilar (
        id TEXT PRIMARY KEY, ad TEXT NOT NULL, kullanici TEXT NOT NULL UNIQUE,
        rol TEXT NOT NULL, alanlar TEXT NOT NULL, tuz TEXT NOT NULL, ozet TEXT NOT NULL, tur INTEGER NOT NULL,
        olusturma INTEGER NOT NULL, son_giris INTEGER);
      CREATE TABLE IF NOT EXISTS oturumlar (
        ozet TEXT PRIMARY KEY, kullanici_id TEXT NOT NULL, bitis INTEGER NOT NULL, uzatma INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS oturum_kullanici ON oturumlar(kullanici_id);
      CREATE TABLE IF NOT EXISTS kisisel (
        kullanici_id TEXT PRIMARY KEY, veri TEXT NOT NULL, surum INTEGER NOT NULL, guncelleme INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ortak (
        alan TEXT PRIMARY KEY, veri TEXT NOT NULL, surum INTEGER NOT NULL, guncelleme INTEGER NOT NULL, guncelleyen TEXT);
      CREATE TABLE IF NOT EXISTS kopruler (
        ad TEXT PRIMARY KEY, url TEXT NOT NULL, anahtar_ozet TEXT NOT NULL, guncelleme INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS denemeler (
        anahtar TEXT PRIMARY KEY, sayi INTEGER NOT NULL, baslangic INTEGER NOT NULL);
    `);
    this.sahte = null; // olmayan kullanıcıda da aynı süreyi harcamak için
  }

  async fetch(request) {
    try {
      return await this.yonlendir(request);
    } catch (e) {
      if (e instanceof Hata) return yanit(e.durum, { hata: e.message, ...(e.ek || {}) });
      console.error('beklenmeyen hata', e && e.name); // ayrıntı (gövde, belirteç) günlüğe yazılmaz
      return yanit(500, { hata: 'Sunucu hatası' });
    }
  }

  async kopruKayit(b) {
    const ad = String(b.ad || ''), adres = String(b.url || '').replace(/\/+$/, ''), anahtar = String(b.anahtar || '');
    if (!/^[a-z0-9-]{1,30}$/.test(ad)) throw new Hata(400, 'Geçersiz köprü adı');
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(adres)) throw new Hata(400, 'Geçersiz adres');
    if (anahtar.length < 16 || anahtar.length > 200) throw new Hata(400, 'Anahtar 16-200 karakter olmalı');
    const ozet = hex(await crypto.subtle.digest('SHA-256', enc.encode('kopru:' + anahtar)));
    const var_ = this.sql.exec('SELECT anahtar_ozet FROM kopruler WHERE ad = ?', ad).toArray()[0];
    if (var_ && var_.anahtar_ozet !== ozet) throw new Hata(403, 'Köprü anahtarı uyuşmuyor');
    this.sql.exec(`INSERT INTO kopruler (ad, url, anahtar_ozet, guncelleme) VALUES (?,?,?,?)
      ON CONFLICT(ad) DO UPDATE SET url = excluded.url, guncelleme = excluded.guncelleme`, ad, adres, ozet, Date.now());
    return yanit(200, { tamam: true });
  }

  async kopruIlet(request, ad, alt, ben, m) {
    if (ad === 'ihost' && !this.alanlari(ben).includes('ev')) throw new Hata(403, 'Ev alanına erişimin yok');
    if (alt === '/' && m === 'DELETE') {   // yönetici köprü kaydını sıfırlar (yeni anahtar için)
      if (ben.rol !== 'yonetici') throw new Hata(403, 'Yalnız yönetici');
      this.sql.exec('DELETE FROM kopruler WHERE ad = ?', ad);
      return yanit(200, { tamam: true });
    }
    const k = this.sql.exec('SELECT url, guncelleme FROM kopruler WHERE ad = ?', ad).toArray()[0];
    if (!k) throw new Hata(404, 'Köprü henüz kendini bildirmedi');
    if (alt === '/adres' && m === 'GET') return yanit(200, { url: k.url, guncelleme: k.guncelleme });
    let r;
    try {
      r = await fetch(k.url + alt, {
        method: m,
        headers: { 'Authorization': request.headers.get('Authorization') || '', 'Content-Type': 'application/json' },
        body: m === 'GET' || m === 'HEAD' ? undefined : await request.text(),
      });
    } catch (e) { throw new Hata(502, 'Köprüye ulaşılamadı (iHost kapalı ya da tünel değişti)'); }
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  async yonlendir(request) {
    const url = new URL(request.url);
    const yol = url.pathname.replace(/\/+$/, '') || '/';
    const m = request.method;
    const ip = request.headers.get('CF-Connecting-IP') || 'yerel';

    if (yol === '/durum' && m === 'GET') return yanit(200, { kurulu: this.kullaniciSayisi() > 0 });
    if (yol === '/kurulum' && m === 'POST') return this.kurulum(await this.govde(request));
    if (yol === '/giris' && m === 'POST') return this.giris(await this.govde(request), ip);

    // Ev köprüsü (iHost) kendi tünel adresini bildirir. İlk kayıt anahtarı sabitler; sonrakiler aynı anahtarla gelmeli.
    if (yol === '/kopru/kayit' && m === 'POST') return this.kopruKayit(await this.govde(request));

    const oturum = await this.oturumAl(request);
    const ben = oturum.kullanici;

    // Panel → hesap servisi → köprü. Panel köprü adresini bilmek zorunda kalmaz; adres değişse de bu yol aynı kalır.
    const kp = yol.match(/^\/kopru\/([a-z0-9-]+)(\/.*)?$/);
    if (kp) return this.kopruIlet(request, kp[1], kp[2] || '/', ben, m);

    if (yol === '/cikis' && m === 'POST') {
      this.sql.exec('DELETE FROM oturumlar WHERE ozet = ?', oturum.ozet);
      return yanit(200, { tamam: true });
    }
    if (yol === '/ben' && m === 'GET') return yanit(200, { kullanici: this.disaVer(ben) });
    if (yol === '/sifre' && m === 'POST') return this.sifreDegistir(await this.govde(request), oturum, ip);

    if (yol === '/ayarlar/kisisel') {
      if (m === 'GET') return yanit(200, this.ayarOku('kisisel', 'kullanici_id', ben.id));
      if (m === 'PUT') return yanit(200, this.ayarYaz('kisisel', 'kullanici_id', ben.id, await this.govde(request), KISISEL_SINIR));
    }

    const o = yol.match(/^\/ayarlar\/ortak\/([a-z]+)$/);
    if (o) {
      const alan = o[1];
      if (!ORTAK_ALANLAR.includes(alan)) throw new Hata(404, 'Böyle bir alan yok');
      if (alan !== 'aksi' && !this.alanlari(ben).includes(alan)) throw new Hata(403, 'Bu alana erişimin yok');
      if (m === 'GET') return yanit(200, this.ayarOku('ortak', 'alan', alan));
      if (m === 'PUT') {
        if (ben.rol !== 'yonetici') throw new Hata(403, 'Ortak ayarları yalnızca yönetici değiştirebilir');
        return yanit(200, this.ayarYaz('ortak', 'alan', alan, await this.govde(request), ORTAK_SINIR, ben.id));
      }
    }

    if (yol === '/kullanicilar' || yol.startsWith('/kullanicilar/')) {
      if (ben.rol !== 'yonetici') throw new Hata(403, 'Bu işlem yalnızca yönetici içindir');
      if (yol === '/kullanicilar') {
        if (m === 'GET') return yanit(200, { kullanicilar: this.sql.exec('SELECT * FROM kullanicilar ORDER BY olusturma').toArray().map(k => this.disaVer(k, true)) });
        if (m === 'POST') return this.kullaniciEkle(await this.govde(request));
      }
      const id = decodeURIComponent(yol.slice('/kullanicilar/'.length));
      if (m === 'PATCH') return this.kullaniciDuzenle(id, await this.govde(request), oturum);
      if (m === 'DELETE') return this.kullaniciSil(id);
    }

    throw new Hata(404, 'Bulunamadı');
  }

  // ---------- gövde ----------
  async govde(request) {
    const metin = await request.text();
    if (enc.encode(metin).length > GOVDE_SINIR) throw new Hata(413, 'İstek çok büyük');
    let j;
    try { j = JSON.parse(metin || '{}'); } catch { throw new Hata(400, 'Geçersiz JSON'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Hata(400, 'Geçersiz istek');
    return j;
  }

  // ---------- kullanıcı ----------
  kullaniciSayisi() { return this.sql.exec('SELECT COUNT(*) AS n FROM kullanicilar').one().n; }
  yoneticiSayisi() { return this.sql.exec("SELECT COUNT(*) AS n FROM kullanicilar WHERE rol = 'yonetici'").one().n; }
  kullaniciBul(alan, deger) { return this.sql.exec(`SELECT * FROM kullanicilar WHERE ${alan} = ?`, deger).toArray()[0] || null; }
  alanlari(k) { return k.rol === 'yonetici' ? [...ALANLAR] : JSON.parse(k.alanlar); }
  disaVer(k, ayrinti = false) {
    const d = { id: k.id, ad: k.ad, kullanici: k.kullanici, rol: k.rol, alanlar: this.alanlari(k) };
    if (ayrinti) Object.assign(d, { olusturma: k.olusturma, sonGiris: k.son_giris });
    return d;
  }
  async sifreOzeti(sifre) {
    const tuz = rastgele(16);
    return { tuz: hex(tuz), ozet: hex(await pbkdf2(sifre, tuz, TUR)), tur: TUR };
  }

  async kurulum(b) {
    const ad = adDogrula(b.ad), kullanici = kullaniciDogrula(b.kullanici), sifre = sifreDogrula(b.sifre);
    if (this.kullaniciSayisi() > 0) throw new Hata(409, 'Kurulum zaten yapılmış');
    const s = await this.sifreOzeti(sifre);
    // Özet hesaplanırken başka bir kurulum araya girmiş olabilir: denetim ve ekleme arasında await yok.
    if (this.kullaniciSayisi() > 0) throw new Hata(409, 'Kurulum zaten yapılmış');
    const id = hex(rastgele(8));
    this.sql.exec('INSERT INTO kullanicilar (id, ad, kullanici, rol, alanlar, tuz, ozet, tur, olusturma) VALUES (?,?,?,?,?,?,?,?,?)',
      id, ad, kullanici, 'yonetici', JSON.stringify(ALANLAR), s.tuz, s.ozet, s.tur, Date.now());
    return yanit(201, await this.oturumAc(this.kullaniciBul('id', id)));
  }

  async giris(b, ip) {
    if (typeof b.kullanici !== 'string' || typeof b.sifre !== 'string' || !b.kullanici || !b.sifre)
      throw new Hata(400, 'Kullanıcı adı ve şifre gerekli');
    const kullanici = b.kullanici.trim().toLowerCase();
    const anahtarlar = await this.denemeAnahtarlari(kullanici, ip);
    // Sayaç PBKDF2'den ÖNCE artırılır: Durable Object özet beklerken başka istekleri alır,
    // denetim ve artış aynı senkron adımda olmazsa paralel istekler sınırı aşar.
    this.denemeAyir(anahtarlar);

    const k = this.kullaniciBul('kullanici', kullanici);
    let dogru = false;
    if (k) {
      dogru = await this.sifreDogruMu(k, b.sifre);
    } else {
      // Kullanıcı yoksa da aynı işi yap: süre farkından kullanıcı adı anlaşılmasın.
      if (!this.sahte) this.sahte = { tuz: rastgele(16), ozet: rastgele(32) };
      sabitZamanliEsit(await pbkdf2(b.sifre, this.sahte.tuz, TUR), this.sahte.ozet);
    }

    if (!dogru) throw new Hata(401, 'Kullanıcı adı ya da şifre hatalı');
    // Kullanıcı yeniden okunur: özet beklenirken silinmiş ya da şifresi değişmiş olabilir.
    const guncel = this.kullaniciBul('id', k.id);
    if (!guncel || guncel.ozet !== k.ozet) throw new Hata(401, 'Kullanıcı adı ya da şifre hatalı');
    this.denemeBasarili(anahtarlar);
    this.sql.exec('UPDATE kullanicilar SET son_giris = ? WHERE id = ?', Date.now(), k.id);
    return yanit(200, await this.oturumAc(guncel));
  }

  // ---------- hız sınırı ----------
  // k: kullanıcı+IP (5), i: IP (20), a: kullanıcı adı, IP'den bağımsız (20). Anahtarlar özetlenmiş saklanır.
  async denemeAnahtarlari(kullanici, ip) {
    return [
      ['k:' + await sha256(kullanici + '|' + ip), DENEME_KULLANICI],
      ['i:' + await sha256(ip), DENEME_IP],
      ['a:' + await sha256(kullanici), DENEME_AD],
    ];
  }
  // Senkron: süresi dolanları sil, sınırı denetle, hepsini artır. Arada await yok.
  denemeAyir(anahtarlar) {
    const simdi = Date.now();
    this.sql.exec('DELETE FROM denemeler WHERE baslangic < ?', simdi - DENEME_PENCERE_MS);
    let bekle = 0;
    for (const [a, sinir] of anahtarlar) {
      const d = this.sql.exec('SELECT * FROM denemeler WHERE anahtar = ?', a).toArray()[0];
      if (d && d.sayi >= sinir) bekle = Math.max(bekle, d.baslangic + DENEME_PENCERE_MS - simdi);
    }
    if (bekle > 0) {
      const dk = Math.max(1, Math.ceil(bekle / 60000));
      throw new Hata(429, `Çok fazla hatalı deneme. ${dk} dk sonra tekrar dene`, { bekle: dk * 60 });
    }
    for (const [a] of anahtarlar)
      this.sql.exec(`INSERT INTO denemeler (anahtar, sayi, baslangic) VALUES (?, 1, ?)
                     ON CONFLICT(anahtar) DO UPDATE SET sayi = sayi + 1`, a, simdi);
  }
  // Başarılı denemede: kullanıcı+IP sayacı silinir; IP ve kullanıcı adı sayaçlarından yalnızca bu deneme geri alınır
  // (gerçek kullanıcının girişi, başka yerden süren bir saldırının sayacını sıfırlamasın).
  denemeBasarili(anahtarlar) {
    const [[aK], ...digerleri] = anahtarlar;
    this.sql.exec('DELETE FROM denemeler WHERE anahtar = ?', aK);
    for (const [a] of digerleri)
      this.sql.exec('UPDATE denemeler SET sayi = MAX(sayi - 1, 0) WHERE anahtar = ?', a);
  }
  async sifreDogruMu(k, sifre) {
    return sabitZamanliEsit(await pbkdf2(sifre, unhex(k.tuz), k.tur), unhex(k.ozet));
  }

  // Her rol kendi şifresini değiştirir. Eski şifre girişle aynı hız sınırıyla doğrulanır.
  // Yanlış eski şifre 403 döner (401 istemcide oturumu kapatır).
  async sifreDegistir(b, oturum, ip) {
    if (typeof b.eski !== 'string' || !b.eski) throw new Hata(400, 'Eski şifre gerekli');
    const yeni = sifreDogrula(b.yeni);
    const ben = oturum.kullanici;
    const anahtarlar = await this.denemeAnahtarlari(ben.kullanici, ip);
    this.denemeAyir(anahtarlar);
    if (!(await this.sifreDogruMu(ben, b.eski))) throw new Hata(403, 'Eski şifre hatalı');
    const s = await this.sifreOzeti(yeni);
    // Beklemeler sırasında hesap silinmiş ya da şifre başka yerden değişmiş olabilir: yazmayla aynı adımda denetle.
    const guncel = this.kullaniciBul('id', ben.id);
    if (!guncel) throw new Hata(401, 'Hesap bulunamadı');
    if (guncel.ozet !== ben.ozet) throw new Hata(409, 'Şifre bu sırada başka yerden değişti, yeniden dene');
    this.denemeBasarili(anahtarlar);
    this.sql.exec('UPDATE kullanicilar SET tuz = ?, ozet = ?, tur = ? WHERE id = ?', s.tuz, s.ozet, s.tur, ben.id);
    // Bu kullanıcının diğer oturumları kapanır, bu oturum kalır.
    this.sql.exec('DELETE FROM oturumlar WHERE kullanici_id = ? AND ozet != ?', ben.id, oturum.ozet);
    return yanit(200, { tamam: true });
  }

  async oturumAc(k) {
    const simdi = Date.now();
    this.sql.exec('DELETE FROM oturumlar WHERE bitis < ?', simdi);
    const token = b64url(rastgele(32));
    this.sql.exec('INSERT INTO oturumlar (ozet, kullanici_id, bitis, uzatma) VALUES (?,?,?,?)',
      await sha256(token), k.id, simdi + OTURUM_MS, simdi);
    return { token, kullanici: this.disaVer(k) };
  }

  async oturumAl(request) {
    const a = request.headers.get('Authorization') || '';
    const t = a.match(/^Bearer\s+([A-Za-z0-9_-]{20,100})$/);
    if (!t) throw new Hata(401, 'Giriş gerekli');
    const ozet = await sha256(t[1]);
    const o = this.sql.exec('SELECT * FROM oturumlar WHERE ozet = ?', ozet).toArray()[0];
    const simdi = Date.now();
    if (!o || o.bitis < simdi) {
      if (o) this.sql.exec('DELETE FROM oturumlar WHERE ozet = ?', ozet);
      throw new Hata(401, 'Oturum süresi doldu, yeniden giriş yap');
    }
    const k = this.kullaniciBul('id', o.kullanici_id);
    if (!k) { this.sql.exec('DELETE FROM oturumlar WHERE ozet = ?', ozet); throw new Hata(401, 'Hesap bulunamadı'); }
    if (simdi - o.uzatma > UZATMA_ARALIGI_MS)
      this.sql.exec('UPDATE oturumlar SET bitis = ?, uzatma = ? WHERE ozet = ?', simdi + OTURUM_MS, simdi, ozet);
    return { ozet, kullanici: k };
  }

  async kullaniciEkle(b) {
    const ad = adDogrula(b.ad), kullanici = kullaniciDogrula(b.kullanici), sifre = sifreDogrula(b.sifre);
    const rol = rolDogrula(b.rol || 'aile');
    const alanlar = rol === 'yonetici' ? [...ALANLAR] : alanlarDogrula(b.alanlar || []);
    if (this.kullaniciBul('kullanici', kullanici)) throw new Hata(409, 'Bu kullanıcı adı alınmış');
    const s = await this.sifreOzeti(sifre);
    if (this.kullaniciBul('kullanici', kullanici)) throw new Hata(409, 'Bu kullanıcı adı alınmış');
    const id = hex(rastgele(8));
    this.sql.exec('INSERT INTO kullanicilar (id, ad, kullanici, rol, alanlar, tuz, ozet, tur, olusturma) VALUES (?,?,?,?,?,?,?,?,?)',
      id, ad, kullanici, rol, JSON.stringify(alanlar), s.tuz, s.ozet, s.tur, Date.now());
    return yanit(201, { kullanici: this.disaVer(this.kullaniciBul('id', id), true) });
  }

  async kullaniciDuzenle(id, b, oturum) {
    const k = this.kullaniciBul('id', id);
    if (!k) throw new Hata(404, 'Kullanıcı bulunamadı');
    const ad = b.ad !== undefined ? adDogrula(b.ad) : k.ad;
    const rol = b.rol !== undefined ? rolDogrula(b.rol) : k.rol;
    let alanlar = b.alanlar !== undefined ? alanlarDogrula(b.alanlar) : JSON.parse(k.alanlar);
    if (rol === 'yonetici') alanlar = [...ALANLAR];
    const s = b.sifre !== undefined ? await this.sifreOzeti(sifreDogrula(b.sifre)) : null;
    // Son yönetici denetimi await'ten sonra, yazmayla aynı adımda.
    const guncel = this.kullaniciBul('id', id);
    if (!guncel) throw new Hata(404, 'Kullanıcı bulunamadı');
    if (guncel.rol === 'yonetici' && rol !== 'yonetici' && this.yoneticiSayisi() <= 1)
      throw new Hata(409, 'Son yönetici aile rolüne düşürülemez');
    this.sql.exec('UPDATE kullanicilar SET ad = ?, rol = ?, alanlar = ? WHERE id = ?', ad, rol, JSON.stringify(alanlar), id);
    if (s) {
      this.sql.exec('UPDATE kullanicilar SET tuz = ?, ozet = ?, tur = ? WHERE id = ?', s.tuz, s.ozet, s.tur, id);
      // Şifre sıfırlanınca o kullanıcının diğer oturumları kapanır (yönetici kendini sıfırlıyorsa bu oturum kalır).
      this.sql.exec('DELETE FROM oturumlar WHERE kullanici_id = ? AND ozet != ?', id, oturum.ozet);
    }
    return yanit(200, { kullanici: this.disaVer(this.kullaniciBul('id', id), true) });
  }

  kullaniciSil(id) {
    const k = this.kullaniciBul('id', id);
    if (!k) throw new Hata(404, 'Kullanıcı bulunamadı');
    if (k.rol === 'yonetici' && this.yoneticiSayisi() <= 1) throw new Hata(409, 'Son yönetici silinemez');
    this.sql.exec('DELETE FROM oturumlar WHERE kullanici_id = ?', id);
    this.sql.exec('DELETE FROM kisisel WHERE kullanici_id = ?', id);
    this.sql.exec('DELETE FROM kullanicilar WHERE id = ?', id);
    return yanit(200, { tamam: true });
  }

  // ---------- ayarlar ----------
  // Gövde: { veri: <herhangi bir JSON>, surum?: <son okunan sürüm> }. surum verilir ve güncel değilse 409.
  ayarOku(tablo, anahtarAd, anahtar) {
    const r = this.sql.exec(`SELECT veri, surum, guncelleme FROM ${tablo} WHERE ${anahtarAd} = ?`, anahtar).toArray()[0];
    return r ? { veri: JSON.parse(r.veri), surum: r.surum, guncelleme: r.guncelleme } : { veri: null, surum: 0, guncelleme: null };
  }
  ayarYaz(tablo, anahtarAd, anahtar, b, sinir, guncelleyen) {
    if (!('veri' in b)) throw new Hata(400, 'veri alanı gerekli');
    const metin = JSON.stringify(b.veri);
    if (enc.encode(metin).length > sinir) throw new Hata(413, `Ayar çok büyük (en çok ${sinir / 1024} KB)`);
    const mevcut = this.ayarOku(tablo, anahtarAd, anahtar);
    if (b.surum !== undefined && b.surum !== null) {
      if (!Number.isInteger(b.surum)) throw new Hata(400, 'surum tam sayı olmalı');
      if (b.surum !== mevcut.surum)
        throw new Hata(409, 'Ayar başka bir cihazda değişti, yeniden yükle', { surum: mevcut.surum, veri: mevcut.veri });
    }
    const surum = mevcut.surum + 1, simdi = Date.now();
    if (tablo === 'ortak')
      this.sql.exec(`INSERT INTO ortak (alan, veri, surum, guncelleme, guncelleyen) VALUES (?,?,?,?,?)
        ON CONFLICT(alan) DO UPDATE SET veri = excluded.veri, surum = excluded.surum, guncelleme = excluded.guncelleme, guncelleyen = excluded.guncelleyen`,
        anahtar, metin, surum, simdi, guncelleyen);
    else
      this.sql.exec(`INSERT INTO kisisel (kullanici_id, veri, surum, guncelleme) VALUES (?,?,?,?)
        ON CONFLICT(kullanici_id) DO UPDATE SET veri = excluded.veri, surum = excluded.surum, guncelleme = excluded.guncelleme`,
        anahtar, metin, surum, simdi);
    return { surum, guncelleme: simdi };
  }
}
