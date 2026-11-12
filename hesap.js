/* Aksi hesap istemcisi. Aksi, ev paneli ve tekne paneli aynı dosyayı kullanır:
     <script src="/Aksi/hesap.js"></script>
   Üç sayfa aynı kaynakta (taylanaksongur.github.io) olduğu için oturum belirteci ortaktır, tek giriş yeter.
   Şifre hiçbir yerde saklanmaz. localStorage'da yalnızca belirteç ve son bilinen kullanıcı/ayarlar durur,
   böylece ağ yokken sayfa son bilinen durumla açılır.

   Kısa API (hepsi Promise döner):
     hesap.durum()                      → {kurulu}
     hesap.kurulum({ad, kullanici, sifre}), hesap.giris(kullanici, sifre) → kullanici
     hesap.ben()                        → {kullanici, cevrimdisi}
     hesap.cikis()
     hesap.sifreDegistir(eski, yeni)    → POST /sifre. Yanlış eski şifre (403) oturumu kapatmaz; 401 oturumu kapatır:
                                          HesapHatasi {durum, eskiYanlis: true, message: 'Mevcut şifre yanlış'}
     hesap.kisisel.oku() / yaz(veri) / ayarla({anahtar: deger}) / esitle()
       Kişisel veride "_zaman" {anahtar: ms} alanı ayrılmıştır: ayarla() her anahtara yerel zaman damgası koyar,
       çakışmada (409) sunucudaki değer daha yeniyse bekleyen eski değer atılır.
     hesap.ortak.oku(alan) / yaz(alan, veri, surum)          alan: ev | tekne | aksi
     hesap.kullanicilar.liste() / ekle(k) / duzenle(id, degisiklik) / sil(id)
   Eşzamanlı: hesap.oturumVar(), hesap.kullanici(), hesap.alanVar('ev'), hesap.koru('ev')
   Olay: window 'aksi-oturum-kapandi' (401 geldiğinde; belirteç silinmiştir, giriş ekranı gösterilmeli).
   Hata: HesapHatasi {durum, message, bekle (429'da saniye), ag (sunucuya ulaşılamadı)}. */
(function () {
  'use strict';
  const SUNUCU = 'https://aksi-hesap.aksongur.workers.dev'; // hesap servisinin tek adresi
  const AKSI = '/Aksi/';
  const ANAHTAR_OTURUM = 'aksi-oturum';
  const ANAHTAR_ONBELLEK = 'aksi-hesap';
  const ZAMAN_ASIMI = 10000;
  const ALANLAR = ['ev', 'tekne'];

  class HesapHatasi extends Error {
    constructor(durum, mesaj, ek) {
      super(mesaj);
      this.name = 'HesapHatasi';
      this.durum = durum;
      Object.assign(this, ek || {});
    }
  }

  // ---------- yerel depo ----------
  const ls = {
    al(k) { try { return localStorage.getItem(k); } catch { return null; } },
    koy(k, v) { try { localStorage.setItem(k, v); } catch { /* özel sekme / dolu */ } },
    sil(k) { try { localStorage.removeItem(k); } catch { } },
  };
  const token = () => ls.al(ANAHTAR_OTURUM);
  function onbellek() {
    try { return JSON.parse(ls.al(ANAHTAR_ONBELLEK)) || {}; } catch { return {}; }
  }
  function onbellegeYaz(degisen) {
    ls.koy(ANAHTAR_ONBELLEK, JSON.stringify(Object.assign(onbellek(), degisen)));
  }
  function oturumuTemizle() {
    ls.sil(ANAHTAR_OTURUM);
    ls.sil(ANAHTAR_ONBELLEK);
  }
  function oturumAc(yanit) {
    ls.koy(ANAHTAR_OTURUM, yanit.token);
    // Önceki kullanıcının önbelleği yeni kullanıcıya geçmesin.
    ls.koy(ANAHTAR_ONBELLEK, JSON.stringify({ kullanici: yanit.kullanici }));
    return yanit.kullanici;
  }

  // ---------- istek ----------
  async function istek(yontem, yol, govde, secenek = {}) {
    const basliklar = {};
    const t = token();
    if (t) basliklar.Authorization = 'Bearer ' + t;
    if (govde !== undefined) basliklar['Content-Type'] = 'application/json';
    const iptal = new AbortController();
    const sayac = setTimeout(() => iptal.abort(), ZAMAN_ASIMI);
    let r;
    try {
      r = await fetch(SUNUCU + yol, {
        method: yontem,
        headers: basliklar,
        body: govde === undefined ? undefined : JSON.stringify(govde),
        signal: iptal.signal,
        keepalive: !!secenek.keepalive,
        cache: 'no-store',
      });
    } catch (e) {
      throw new HesapHatasi(0, 'Hesap sunucusuna ulaşılamadı', { ag: true });
    } finally {
      clearTimeout(sayac);
    }
    let veri = null;
    try { veri = await r.json(); } catch { veri = null; }
    if (r.ok) return veri || {};
    const mesaj = (veri && veri.hata) || 'Sunucu hatası (' + r.status + ')';
    if (r.status === 401 && t && !secenek.girisIstegi) {
      oturumuTemizle();
      window.dispatchEvent(new CustomEvent('aksi-oturum-kapandi', { detail: { mesaj } }));
    }
    throw new HesapHatasi(r.status, mesaj, veri || {});
  }

  // ---------- oturum ----------
  const hesap = {
    SUNUCU,
    HesapHatasi,
    oturumVar: () => !!token(),
    kullanici: () => onbellek().kullanici || null,
    alanVar(alan) {
      const k = hesap.kullanici();
      if (!k) return false;
      return k.rol === 'yonetici' || (k.alanlar || []).includes(alan);
    },
    /* Paneller için: oturum yoksa ya da bu alana yetki yoksa Aksi ana ekranına döner. */
    koru(alan) {
      if (!hesap.oturumVar() || (hesap.kullanici() && !hesap.alanVar(alan))) {
        location.replace(AKSI);
        return false;
      }
      return true;
    },

    durum: () => istek('GET', '/durum'),

    async kurulum({ ad, kullanici, sifre }) {
      return oturumAc(await istek('POST', '/kurulum', { ad, kullanici, sifre }, { girisIstegi: true }));
    },
    async giris(kullanici, sifre) {
      return oturumAc(await istek('POST', '/giris', { kullanici, sifre }, { girisIstegi: true }));
    },

    /* Sunucudan güncel kullanıcıyı alır. Ağ yoksa son bilinen kullanıcıyla döner. */
    async ben() {
      if (!token()) throw new HesapHatasi(401, 'Giriş gerekli');
      try {
        const { kullanici } = await istek('GET', '/ben');
        onbellegeYaz({ kullanici });
        return { kullanici, cevrimdisi: false };
      } catch (e) {
        const k = hesap.kullanici();
        if (e.ag && k) return { kullanici: k, cevrimdisi: true };
        throw e;
      }
    },

    /* Kendi şifresini değiştirir. /sifre ucunda 403 "yanlış eski şifre" demektir (oturum düşmez); 401 oturumun geçersiz olduğunu gösterir ve normal oturum kapanma akışına girer. */
    async sifreDegistir(eski, yeni) {
      if (!token()) throw new HesapHatasi(401, 'Giriş gerekli');
      let a;
      try {
        a = await istek('POST', '/sifre', { eski, yeni });
      } catch (e) {
        if (e.durum === 403) { e.eskiYanlis = true; e.message = 'Mevcut şifre yanlış'; }
        throw e;
      }
      // Sunucu diğer oturumları kapatıp yeni belirteç verirse bu cihaz açık kalsın.
      if (a && a.token) ls.koy(ANAHTAR_OTURUM, a.token);
      if (a && a.kullanici) onbellegeYaz({ kullanici: a.kullanici });
      return a;
    },

    async cikis() {
      try { if (token()) await istek('POST', '/cikis', {}); } catch { /* ağ yoksa da yerelde kapat */ }
      oturumuTemizle();
    },

    // ---------- kişisel ayarlar ----------
    kisisel: {
      onbellek: () => onbellek().kisisel || { veri: null, surum: 0 },
      async oku() {
        try {
          const a = await istek('GET', '/ayarlar/kisisel');
          onbellegeYaz({ kisisel: a });
          return Object.assign({ cevrimdisi: false }, a);
        } catch (e) {
          if (e.ag) return Object.assign({ cevrimdisi: true }, hesap.kisisel.onbellek());
          throw e;
        }
      },
      /* Tüm kişisel ayarı yazar. Başka cihaz araya girdiyse 409 hatası fırlar (e.veri, e.surum güncel değerdir). */
      async yaz(veri, secenek = {}) {
        const surum = hesap.kisisel.onbellek().surum;
        const a = await istek('PUT', '/ayarlar/kisisel', { veri, surum }, secenek);
        onbellegeYaz({ kisisel: { veri, surum: a.surum, guncelleme: a.guncelleme } });
        return a;
      },
      /* Birkaç anahtarı değiştirir. Önce yerelde kaydeder; ağ yoksa ya da sayfa kapanırsa
         değişiklik "bekleyen" olarak kalır ve bir sonraki esitle()'de gönderilir. */
      async ayarla(degisen, secenek = {}) {
        const o = onbellek();
        const zaman = Date.now();
        const bekleyen = Object.assign({}, o.bekleyen, degisen);
        const bekleyenZaman = Object.assign({}, o.bekleyenZaman);
        for (const a of Object.keys(degisen)) bekleyenZaman[a] = zaman;
        const k = o.kisisel || { veri: null, surum: 0 };
        k.veri = damgala(Object.assign({}, k.veri, degisen), bekleyenZaman, Object.keys(degisen));
        onbellegeYaz({ kisisel: k, bekleyen, bekleyenZaman });
        return hesap.kisisel.esitle(secenek);
      },
      /* Bekleyen değişiklik varsa gönderir, yoksa sunucudan okur. Çakışmada (409) her bekleyen anahtar için
         damgalar karşılaştırılır: sunucudaki daha yeniyse bekleyen eski değer atılır (gönderilmez),
         değilse sunucunun güncel verisinin üstüne yalnızca o anahtar yazılır. */
      async esitle(secenek = {}) {
        if (!token()) return hesap.kisisel.onbellek();
        if (!onbellek().bekleyen) return hesap.kisisel.oku();
        for (let deneme = 0; deneme < 3; deneme++) {
          const o = onbellek();
          const bekleyen = o.bekleyen, bz = o.bekleyenZaman || {};
          const k = hesap.kisisel.onbellek();
          if (!bekleyen || !Object.keys(bekleyen).length) {
            onbellegeYaz({ bekleyen: null, bekleyenZaman: null });
            return Object.assign({ cevrimdisi: false }, k);
          }
          const veri = damgala(Object.assign({}, k.veri, bekleyen), bz, Object.keys(bekleyen));
          try {
            const a = await istek('PUT', '/ayarlar/kisisel', { veri, surum: k.surum }, secenek);
            // İstek sürerken yeni ayarla() geldiyse onun değişikliği bekleyende kalsın.
            const kalan = kalanBekleyen(bekleyen, bz);
            onbellegeYaz(Object.assign({ kisisel: { veri: Object.assign({}, veri, kalan.bekleyen), surum: a.surum, guncelleme: a.guncelleme } }, kalan));
            return { veri, surum: a.surum, guncelleme: a.guncelleme, cevrimdisi: false };
          } catch (e) {
            if (e.durum === 409) { cakismaCoz(e); continue; }
            if (e.ag) return Object.assign({ cevrimdisi: true }, hesap.kisisel.onbellek());
            throw e;
          }
        }
        return hesap.kisisel.oku();
      },
    },

    // ---------- ortak ayarlar (ev | tekne | aksi) ----------
    ortak: {
      async oku(alan) {
        try {
          const a = await istek('GET', '/ayarlar/ortak/' + encodeURIComponent(alan));
          const ortak = Object.assign({}, onbellek().ortak, { [alan]: a });
          onbellegeYaz({ ortak });
          return Object.assign({ cevrimdisi: false }, a);
        } catch (e) {
          const o = (onbellek().ortak || {})[alan];
          if (e.ag && o) return Object.assign({ cevrimdisi: true }, o);
          throw e;
        }
      },
      /* Yalnız yönetici. surum verilirse çakışmada 409 (e.veri, e.surum güncel değer). */
      async yaz(alan, veri, surum) {
        const a = await istek('PUT', '/ayarlar/ortak/' + encodeURIComponent(alan), { veri, surum });
        const ortak = Object.assign({}, onbellek().ortak, { [alan]: { veri, surum: a.surum, guncelleme: a.guncelleme } });
        onbellegeYaz({ ortak });
        return a;
      },
    },

    // ---------- kullanıcılar (yalnız yönetici) ----------
    kullanicilar: {
      liste: async () => (await istek('GET', '/kullanicilar')).kullanicilar || [],
      ekle: async k => (await istek('POST', '/kullanicilar', k)).kullanici,
      duzenle: async (id, d) => (await istek('PATCH', '/kullanicilar/' + encodeURIComponent(id), d)).kullanici,
      sil: id => istek('DELETE', '/kullanicilar/' + encodeURIComponent(id)),
    },

    ALANLAR,
  };

  // ---------- kişisel ayar zaman damgaları ----------
  const zamanAl = (veri, a) => {
    if (!veri) return 0;
    const z = veri._zaman && veri._zaman[a];
    if (typeof z === 'number') return z;
    const d = veri[a];     // eski kayıtlar: değerin kendi zamanı (ör. sonPanel.zaman)
    return d && typeof d === 'object' && typeof d.zaman === 'number' ? d.zaman : 0;
  };
  function damgala(veri, bz, anahtarlar) {
    const z = Object.assign({}, veri._zaman);
    for (const a of anahtarlar) if (typeof bz[a] === 'number') z[a] = bz[a];
    veri._zaman = z;
    return veri;
  }
  /* Gönderilen bekleyenlerden sonra eklenen/yenilenen anahtarlar */
  function kalanBekleyen(gonderilen, gz) {
    const o = onbellek();
    const b = {}, z = {};
    for (const [a, d] of Object.entries(o.bekleyen || {})) {
      const t = (o.bekleyenZaman || {})[a];
      if (a in gonderilen && t === gz[a]) continue;
      b[a] = d; if (t !== undefined) z[a] = t;
    }
    return Object.keys(b).length ? { bekleyen: b, bekleyenZaman: z } : { bekleyen: null, bekleyenZaman: null };
  }
  /* 409: sunucudaki güncel veriyi al, sunucu tarafı daha yeni olan bekleyenleri at. */
  function cakismaCoz(e) {
    const o = onbellek();
    const sunucu = e.veri || null;
    const b = Object.assign({}, o.bekleyen), bz = Object.assign({}, o.bekleyenZaman);
    for (const a of Object.keys(b)) {
      const yerel = typeof bz[a] === 'number' ? bz[a] : zamanAl(b, a);   // damgasız eski bekleyen
      if (zamanAl(sunucu, a) > yerel) { delete b[a]; delete bz[a]; }
    }
    const bos = !Object.keys(b).length;
    onbellegeYaz({
      kisisel: { veri: sunucu, surum: e.surum, guncelleme: e.guncelleme },
      bekleyen: bos ? null : b,
      bekleyenZaman: bos ? null : bz,
    });
  }

  // Başka bir sekmede / panelde çıkış yapılırsa bu sayfa da haber alsın.
  window.addEventListener('storage', e => {
    if (e.key === ANAHTAR_OTURUM && !e.newValue)
      window.dispatchEvent(new CustomEvent('aksi-oturum-kapandi', { detail: { mesaj: 'Oturum kapatıldı' } }));
  });

  window.hesap = hesap;
})();
