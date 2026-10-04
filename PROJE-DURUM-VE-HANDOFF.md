# IG Analytics (Instagram_Analysis) — Proje Durumu ve Handoff

> **Bu belge nedir?** Projenin yaşayan durum belgesi. Yeni bir oturum (yeni chat, başka bir kişi
> ya da başka bir yapay zeka) sadece bu belgeyi okuyarak kaldığı yerden devam edebilmeli.
> İş ilerledikçe güncellenir; kopyası çıkarılmaz. Teknik ayrıntılar `PROJECT_DOCS.md` içindedir.
>
> **Dikkat:** Bu depo herkese açıktır (public). Bu belgeye kişisel veri (kullanıcı adı, e-posta,
> takipçi listesi) yazılmaz.

## Hızlı bakış

| | |
|---|---|
| **Durum** | 🟡 Kod hazır ve testleri geçiyor; gerçek Chrome + Instagram ile uçtan uca deneme bekliyor |
| **Son yapılan** | 2026-10-04 — Yerel iş repoya taşındı, 4 hata düzeltildi, eski veriyle geriye dönük takipçi farkı eklendi (PR #1 ile `main`'e birleştirildi) |
| **Sıradaki adım** | Eklentiyi Chrome'a yükle → eski veri dosyasını içe aktar → Sync'e bas (bkz. Bölüm 4) |
| **Senden beklenen karar** | Proje klasöründeki eski `session_*` dosyasını sil (bkz. Bölüm 5). |

---

## 1. Proje nedir?

Instagram hesabındaki takipçi değişimlerini izleyen bir araç: kim takipten çıktı, kim yeni
takip etti, kimi takip ediyorsun ama o seni etmiyor, hangi hesap dondurulmuş ya da silinmiş.

Sunucu yok. Veri senin tarayıcında toplanır ve senin Google Drive'ında saklanır.

## 2. Parçalar

| Parça | Klasör | Ne yapar |
|---|---|---|
| Chrome eklentisi | `chrome_extension/` | Instagram'dan takipçi/takip listelerini çeker, farkı hesaplar, Drive'a yazar |
| Web arayüzü | `web_client/` | Drive'daki veriyi okuyup tablolar ve grafik gösterir (React + Vite) |
| Testler | `tests/` | Fark ve veri dönüştürme mantığının birim testleri |

Veri biçimi "schema v3"tür: tek bir `users` listesi (güncel durum) ve bir `events` günlüğü
(kim ne zaman takip etti / çıktı). "Takipten çıkanlar" gibi listeler saklanmaz, bu ikisinden
hesaplanır. Eski biçimler (v0, v1, v2) okunurken otomatik olarak v3'e çevrilir.

Eski Python masaüstü uygulaması depodan kaldırıldı. Ondan geriye sadece veri dosyası biçimi
(v0, `<kullanıcı>_data.json`) kaldı; bu dosya artık eklentiye içe aktarılabiliyor.

## 3. Nasıl çalıştırılır?

**Testler** (kurulum gerektirmez, Node 20+):
```bash
npm test
```

**Web arayüzü:**
```bash
cd web_client
npm install
npm run build      # ya da yerelde denemek için: npm run dev
```
Çalışması için `web_client/.env` içinde `VITE_GOOGLE_CLIENT_ID` olmalı (örnek: `.env.example`).

**Chrome eklentisi:**
1. Chrome'da `chrome://extensions` adresini aç, sağ üstten "Developer mode"u aç.
2. "Load unpacked" → `chrome_extension/` klasörünü seç.
3. Bir sekmede instagram.com'a giriş yap. Sekme eklentiden önce açıldıysa yenile (F5).
4. Eklenti simgesine tıkla → **Sync**.

İlk Sync'te Google hesabı izni istenir (yalnızca uygulamaya özel gizli Drive klasörü için).

## 4. Geriye dönük takipçi farkı (eski veri dosyasıyla)

Amaç: eski masaüstü uygulamasının kaydettiği tarihten bugüne kimlerin takipten çıktığını görmek.

1. Eklenti penceresinde **⇪** düğmesine bas. Yeni bir sekme açılır.
2. Eski veri dosyasını (`<kullanıcı>_data.json`) seç. "N takipçi yüklendi" yazısını gör.
3. Eklenti penceresinden **Sync**'e bas (30 dakikalık bekleme varsa **⚡** ile atla).
4. Sync bitince **Çıkanlar** sekmesi: o tarihten bugüne takipten çıkanlar.
   **Yeni** sekmesi: o tarihten sonra takip etmeye başlayanlar.
5. Birkaç dakika sonra eklenti, çıkanların hesabı duruyor mu diye bakar; dondurulmuş ya da
   silinmiş olanlar **Donmuş** sekmesine taşınır.

Bilinmesi gerekenler:
- Eski dosyada sayısal kimlik yok, eşleştirme kullanıcı adıyla yapılır. O tarihten sonra
  kullanıcı adını değiştiren biri hem "çıkan" hem "yeni" olarak görünür.
- **Çıkanlar** sekmesi "bir önceki Sync'ten beri" olanları gösterir. Geriye dönük liste, bir
  sonraki Sync'e kadar görünür; sonrasında kayıtlar günlükte kalır ama sekmede görünmez.
  Listeyi saklamak istersen web arayüzündeki dışa aktar düğmesini o Sync'ten hemen sonra kullan.
- Dosya başka bir hesaba aitse (takipçilerin %30'undan azı eşleşiyorsa) yok sayılır.

## 5. Bilinen eksikler ve açık konular

| # | Konu | Önem | Not |
|---|---|---|---|
| 1 | Uçtan uca deneme yapılmadı | Yüksek | Mantık testlerle ve gerçek eski dosyayla yapılan simülasyonla doğrulandı; gerçek Chrome + Instagram + Drive akışı henüz denenmedi |
| 2 | Proje klasöründe eski `session_*` dosyası duruyor | Yüksek | Eski Python uygulamasının Instagram oturum çerezi. Depoya girmiyor (`.gitignore`), ama artık kullanılmıyor: sil ve Instagram ayarlarından eski oturumları kapat |
| 3 | "Çıkanlar" için tüm zamanlar görünümü yok | Orta | Sadece son Sync'ten beri olanlar listeleniyor; günlükteki eski kayıtları gösteren bir seçenek eklenebilir |
| 4 | Vite / esbuild geliştirme sunucusu uyarısı | Düşük | Sadece `npm run dev` sırasında geçerli. Düzeltmesi Vite'ı 5'ten 8'e yükseltmeyi gerektiriyor (kırıcı değişiklik) |
| 5 | Durum kontrolü başarısız olan hesaplar yeniden denenmiyor | Düşük | "Çıkanlar"da kalırlar; dondurulmuş olsalar bile ayrıştırılmaz |
| 6 | Kullanılmayan kod | Düşük | `chrome_extension/utils/storage.js` hiçbir yerden çağrılmıyor; `background.js` içindeki `reconcileLegacyUsernames` yolu artık tetiklenmiyor |
| 7 | Web arayüzünde Content-Security-Policy yok | Düşük | Yayına almadan önce eklenmeli |
| 8 | `manifest.json` sürümü 1.0.0, kod içindeki istemci sürümü 1.1.0 | Düşük | Tek bir yerden okunmalı |

Güvenlik taraması sonucu (2026-10-04): git geçmişinde oturum dosyası, kişisel veri, `.env`
ya da gizli anahtar yok. Arayüzlerde kullanıcı verisi HTML olarak basılmıyor. `manifest.json`
içindeki OAuth client ID gizli bilgi değildir (Chrome eklentilerinde uzantı kimliğine bağlıdır).

## 6. Çalışma günlüğü

### 2026-10-04 — Repo senkronu, hata düzeltmeleri, geriye dönük fark

**Ne yapıldı**
- Yerelde bekleyen schema v3 çalışması (11 değişen, 6 yeni dosya) repoya taşındı.
- Testler kişisel veri dosyasına bağımlıydı; sahte bir örnek dosyaya (`tests/fixtures/`) bağlandı.
  Böylece depoyu yeni indiren biri ya da bulut oturumu da testleri çalıştırabiliyor.
- Dört hata düzeltildi:
  1. Durum kontrolü başarısız olan hesap "dondurulmuş" sayılıyordu; gerçek takipten çıkanlar
     **Donmuş** sekmesine gizleniyordu. Artık dokunulmuyor.
  2. Uzun kontrol listeleri tarayıcının 5 dakikalık arka plan sınırını aşıp yarıda kalabiliyordu.
     Artık 40'lık gruplar halinde çalışıyor.
  3. Kontroller bitince etkileşim verisi eklenti penceresinden siliniyordu.
  4. Instagram sekmesine ulaşılamadığında Sync sessizce başlamıyor ama 30 dakikalık bekleme
     yine de başlıyordu. Artık açık bir hata mesajı veriyor.
- Eski veri dosyası eklentiye hiç ulaşamıyordu, ulaşsa da kod onu yok sayıyordu. İçe aktarma
  sayfası ve kullanıcı adına göre karşılaştırma eklendi (Bölüm 4).
- `lodash` güvenlik uyarısı kapatıldı (`npm audit fix`).

**Sonuçlar**
- Testler: 70 / 70 geçiyor (önce 56).
- Web arayüzü derleniyor; üretim bağımlılıklarında açık yok (`npm audit --omit=dev`: 0).
- Gerçek eski dosyayla simülasyon: 365 takipçilik tabandan 12 kişi çıkarılıp 7 yeni eklendiğinde
  kod tam olarak 12 "çıkan" ve 7 "yeni" buldu; taban olmadan 0 / 0 buluyordu.
- İçe aktarma sayfası tarayıcıda denendi: geçerli dosya kaydedildi, geçersiz dosyalar reddedildi.

**Nasıl tekrarlanır**
```bash
npm test
cd web_client && npm run build && npm audit --omit=dev
```

**Kalan**
- Bölüm 5'teki 1 ve 2 numaralı maddeler.
