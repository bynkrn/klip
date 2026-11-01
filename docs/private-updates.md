# Özel GitHub Güncellemeleri

Depo: [bynkrn/klip](https://github.com/bynkrn/klip) — **private**.

Uygulama açılışta, açıkken 15 dakikada bir ve Ayarlar → Güncellemeler üzerinden elle kontrol yapar. Açılışta yeni sürüm varsa Şimdi Güncelle / Daha Sonra penceresi sunulur; arka plan keşfi yalnız simgeyi gösterir. Ertelemede simge kalır ve bekleyen indirme sonradan kendiliğinden kurulum başlatamaz. Elle indirme uygulamayı kapatmaz; Uygula Ve Yeniden Başlat ayrıca seçilir. Önce etkin replay tamponu MP4 olarak korunur.

Özel depoya erişim için kullanıcıya ait bir GitHub oturumu gerekir. Taşınabilir resmî GitHub CLI kullanılır; uygulamanın içine token yerleştirilmez. Erişim yoksa kayıt/izleme çalışmaya devam eder, GitHub bağlantısı Güncellemeler ayarlarından kurulabilir. Gelecekte başka kullanıcılar için özel depoya erişim ayrıca verilmelidir; henüz davet veya arkadaşlara gönderilecek paket hazırlanmadı.

## Kaynak Kodunu Güncelleme

`main` dalına gönderilen kaynak değişiklikleri Windows üzerinde derleme ve test kontrolü çalıştırır. Dal gönderimi **kurulum/ZIP üretmez ve Release yayımlamaz**. Mevcut kapsam yalnız yerel kişisel uygulama ve özel kaynak kodudur. Aşağıdaki yayın akışı bu çalışma sırasında çalıştırılmadı; gelecekte ayrıca istenen bir dağıtım içindir:

1. `package.json` sürümünü yükseltin, lock dosyasını güncelleyin ve kontrolleri çalıştırın.
2. Değişiklikleri gönderin.
3. Eşleşen açık bir sürüm etiketi gönderin; örneğin `v0.4.1`.

Etiket iş akışı Windows paketini oluşturur, Ed25519 ile sürüm bilgisini imzalar ve ZIP + `klip-update.json` + `klip-update.sig` dosyalarını aynı **özel** GitHub Release’e yükler. Uygulama salt kaynak kodu commit’ine göre güncelleme kurmaz; doğrulanmış Release arar.

**Bu çalışma sırasında sürüm etiketi veya dağıtım Release’i oluşturulmadı.** Yerel `dist` klasörü mevcut kişisel uygulama içindir; kaynak depoya eklenmez.

## Güvenilir Güncelleme

Uygulama Ed25519 genel anahtarını taşır. İmzalama anahtarı proje dışında ve GitHub Actions secret’ında tutulur; kaynak koduna veya ZIP’e girmez. İmza, platform/mimari, sürüm, dosya boyutu ve SHA256 doğrulanır. Eski sürüme geçiş reddedilir.

Haricî kurulum yardımcısı kendi güvenli önbelleğinden çalışır; ebeveyn uygulamanın kapanmasını bekler, ZIP yollarını denetler, uygulamayla aynı diskte hazırlar ve eski klasörü koruyarak değiştirir. Yeni uygulama doğrulanmış açılış işareti göndermezse önceki klasöre döner. Video kütüphanesi ve kullanıcı ayarları uygulama dizini dışında kalır. Kütüphanesi uygulama klasörünün içinde olan kurulumlarda güncelleme, konum düzeltilene kadar engellenir.
