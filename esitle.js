/* Aksi ayar eşitleme. Panellerin kendi kayıt koduna dokunmadan, seçili localStorage anahtarlarını
   hesap servisindeki ortak alana (ev | tekne) yansıtır. hesap.js'ten SONRA, panel betiklerinden ÖNCE yüklenir:
     <script src="/Aksi/hesap.js"></script>
     <script src="/Aksi/esitle.js"></script>
     <script>aksiEsitle({alan:'ev', anahtarlar:{'aksongur-aksesuarlar':{}, 'aksongur-kamera-v3':{gizli:['pass']}}})</script>

   - Yerelde setItem yapılan izli anahtar 1,5 sn sonra sunucuya gönderilir (anahtar başına zaman damgası).
   - Açılışta ve sekme öne gelince sunucudan çekilir; başka cihazın daha yeni değeri varsa yerele yazılır
     ve sayfa bir kez yenilenir (form açıkken beklenir).
   - "gizli" alanlar (şifreler) sunucuya gitmez, yereldeki değer korunur.
   - Ortak alana yalnız yönetici yazabilir; aile üyesi yalnız okur. */
(function () {
  const ham = Storage.prototype.setItem;
  const oku = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const yaz = (k, v) => { try { ham.call(localStorage, k, v); } catch { } };
  const DURUM = 'aksi-esitle-';

  window.aksiEsitle = function ({ alan, anahtarlar }) {
    const h = window.hesap;
    if (!h) return;
    const izli = Object.keys(anahtarlar);
    const dk = DURUM + alan;   // {zaman:{anahtar:ms}, bekleyen:[...], surum}
    const durum = () => { try { return JSON.parse(oku(dk) || '{}'); } catch { return {}; } };
    const durumYaz = d => yaz(dk, JSON.stringify(d));
    const yetkili = () => h.oturumVar() && h.alanVar(alan);
    const yazabilir = () => yetkili() && (h.kullanici() || {}).rol === 'yonetici';

    const temizle = (k, deger) => {
      const g = anahtarlar[k].gizli;
      if (!g || deger == null) return deger;
      try { const o = JSON.parse(deger); if (o && typeof o === 'object') { g.forEach(a => delete o[a]); return JSON.stringify(o); } } catch { }
      return deger;
    };
    const birlestir = (k, sunucu) => {   // sunucudan gelen değere yereldeki gizli alanları geri koy
      const g = anahtarlar[k].gizli;
      if (!g || sunucu == null) return sunucu;
      try {
        const o = JSON.parse(sunucu), y = JSON.parse(oku(k) || 'null');
        if (o && y) g.forEach(a => { if (a in y) o[a] = y[a]; });
        return JSON.stringify(o);
      } catch { return sunucu; }
    };

    // ---- yerel değişikliği yakala
    let zamanlayici = null;
    Storage.prototype.setItem = function (k, v) {
      ham.call(this, k, v);
      if (this === localStorage && izli.includes(k)) {
        const d = durum();
        d.zaman = Object.assign({}, d.zaman, { [k]: Date.now() });
        d.bekleyen = [...new Set([...(d.bekleyen || []), k])];
        durumYaz(d);
        clearTimeout(zamanlayici);
        zamanlayici = setTimeout(gonder, 1500);
      }
    };

    // ---- gönder
    let gonderiyor = false;
    async function gonder() {
      if (gonderiyor || !yazabilir()) return;
      gonderiyor = true;
      try {
        for (let deneme = 0; deneme < 3; deneme++) {
          const d = durum();
          if (!(d.bekleyen || []).length) return;
          let s;
          try { s = await h.ortak.oku(alan); } catch (e) { if (e.durum !== 404) return; s = { veri: null, surum: 0 }; }
          if (s.cevrimdisi) return;
          const veri = Object.assign({}, (s.veri && s.veri.ayarlar) || {});
          for (const k of d.bekleyen) {
            const z = (d.zaman || {})[k] || 0;
            if (veri[k] && veri[k].zaman > z) continue;     // sunucudaki daha yeni
            veri[k] = { deger: temizle(k, oku(k)), zaman: z };
          }
          try {
            const a = await h.ortak.yaz(alan, Object.assign({}, s.veri, { ayarlar: veri }), s.surum);
            const son = durum();
            son.bekleyen = (son.bekleyen || []).filter(k => (son.zaman || {})[k] !== (d.zaman || {})[k]);
            son.surum = a.surum;
            durumYaz(son);
            return;
          } catch (e) { if (e.durum !== 409) return; }
        }
      } finally { gonderiyor = false; }
    }

    // ---- çek
    let yenilemeBekliyor = false;
    async function cek() {
      if (!yetkili()) return;
      let s;
      try { s = await h.ortak.oku(alan); } catch { return; }
      if (s.cevrimdisi) return gonder();
      const sAyar = (s.veri && s.veri.ayarlar) || {};
      const d = durum(); let degisti = false;
      for (const [k, kayit] of Object.entries(sAyar)) {
        if (!izli.includes(k) || !kayit) continue;
        const yerelZ = (d.zaman || {})[k] || 0;
        if (kayit.zaman <= yerelZ) continue;
        if ((d.bekleyen || []).includes(k)) continue;           // yerelde gönderilmemiş daha yeni değişiklik
        const yeni = birlestir(k, kayit.deger);
        if (yeni !== oku(k)) { yaz(k, yeni); degisti = true; }
        d.zaman = Object.assign({}, d.zaman, { [k]: kayit.zaman });
      }
      // Sunucuda hiç olmayan yerel anahtarları ilk kez yükle (bu cihaz ilk kaynak olur)
      for (const k of izli) if (!(k in sAyar) && oku(k) != null && !(d.bekleyen || []).includes(k)) {
        d.zaman = Object.assign({}, d.zaman, { [k]: (d.zaman || {})[k] || 1 });
        d.bekleyen = [...(d.bekleyen || []), k];
      }
      d.surum = s.surum; durumYaz(d);
      if (degisti) yenile();
      gonder();
    }
    function yenile() {
      const etkin = document.activeElement;
      const formda = etkin && /INPUT|TEXTAREA|SELECT/.test(etkin.tagName);
      if (formda || document.hidden) {
        if (!yenilemeBekliyor) {
          yenilemeBekliyor = true;
          const dene = () => { if (!document.hidden && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) location.reload(); };
          document.addEventListener('visibilitychange', dene);
          document.addEventListener('focusout', () => setTimeout(dene, 300));
        }
        return;
      }
      location.reload();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cek); else cek();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cek(); else gonder(); });
    window.addEventListener('online', cek);
    window.addEventListener('pagehide', () => { if ((durum().bekleyen || []).length) gonder(); });
  };
})();
