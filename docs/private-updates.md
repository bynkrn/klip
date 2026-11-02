# GitHub Güncellemeleri

Depo: [bynkrn/klip](https://github.com/bynkrn/klip) — **public**. Arkadaşların güncellemeleri denetlemek ve indirmek için GitHub hesabı veya depo daveti kullanması gerekmez.

Uygulama açılışta, açıkken 15 dakikada bir ve Ayarlar → Güncellemeler üzerinden elle kontrol yapar. Açılışta yeni sürüm varsa Şimdi Güncelle / Daha Sonra penceresi sunulur; arka plan keşfi yalnız simgeyi gösterir. Ertelemede simge kalır ve bekleyen indirme sonradan kendiliğinden kurulum başlatamaz. Elle indirme uygulamayı kapatmaz; Uygula Ve Yeniden Başlat ayrıca seçilir. Önce etkin replay tamponu MP4 olarak korunur.

Varsayılan `src/update-config.json` içindeki `mode: "public"` ayarı, GitHub API'sine doğrudan HTTPS üzerinden oturumsuz bağlanır. Token, Windows'taki GitHub oturumu veya GitHub CLI gerekmez. HTTPS yönlendirmeleri yalnız GitHub API ve yayın dosyası sunucularına kabul edilir; yanıt ve indirme boyutları sınırlıdır. Bağlantı hatası kayıt/izlemeyi durdurmaz; daha önce indirilip doğrulanmış güncelleme çevrimdışı kontrolde korunur.

Gelecekte özel depo kullanılacaksa `mode: "private"` ile mevcut resmî GitHub CLI yolu seçilebilir. Bu isteğe bağlı yol kullanıcının kendi oturumunu kullanır; uygulamaya token gömülmez.

## Kaynak Kodunu Güncelleme

`main` dalına gönderilen kaynak değişiklikleri Windows üzerinde derleme ve test kontrolü çalıştırır. Dal gönderimi **kurulum/ZIP üretmez ve Release yayımlamaz**. Güncelleme dağıtımı için ayrıca imzalı bir Release gerekir. Aşağıdaki yayın akışı bu çalışma sırasında çalıştırılmadı:

1. `package.json` sürümünü yükseltin, lock dosyasını güncelleyin ve kontrolleri çalıştırın.
2. Değişiklikleri gönderin.
3. Eşleşen açık bir sürüm etiketi gönderin; örneğin `v0.4.1`.

Etiket iş akışı Windows paketini oluşturur, Ed25519 ile sürüm bilgisini imzalar ve ZIP + `ember-update.json` + `ember-update.sig` dosyalarını aynı **herkese açık** GitHub Release’e yükler. Uygulama salt kaynak kodu commit’ine göre güncelleme kurmaz; doğrulanmış Release arar. Depo erişilebilirken henüz Release yoksa “Henüz yayımlanmış bir güncelleme yok” gösterilir; oturum istenmez.

**Bu çalışma sırasında sürüm etiketi veya dağıtım Release’i oluşturulmadı.** Yerel `dist` klasörü mevcut kişisel uygulama içindir; kaynak depoya eklenmez.

## Güvenilir Güncelleme

Uygulama Ed25519 genel anahtarını taşır. İmzalama anahtarı proje dışında ve GitHub Actions secret’ında tutulur; kaynak koduna veya ZIP’e girmez. İmza, platform/mimari, sürüm, dosya boyutu ve SHA256 doğrulanır. Eski sürüme geçiş reddedilir.

Haricî kurulum yardımcısı kendi güvenli önbelleğinden çalışır; ebeveyn uygulamanın kapanmasını bekler, ZIP yollarını denetler, uygulamayla aynı diskte hazırlar ve eski klasörü koruyarak değiştirir. Yeni uygulama doğrulanmış açılış işareti göndermezse önceki klasöre döner. Video kütüphanesi ve kullanıcı ayarları uygulama dizini dışında kalır. Kütüphanesi uygulama klasörünün içinde olan kurulumlarda güncelleme, konum düzeltilene kadar engellenir.
