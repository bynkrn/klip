# Ember 0.7.0 — İzleme, Kurtarma Ve Editör

Bu sürüm, V1 dış editöre aktarımı koruyarak beş geliştirmeyi ekler. Yerel kontrol derlemesi `dist/Ember-0.7.0-preview/Ember-win32-x64` altındadır. Yeni setup veya GitHub Release hazırlanmadı; önceki dağıtım dosyaları korunur.

## Kullanım

- Normal izleyicide tam ekran düğmesi, videoya çift tıklama veya **F** kullanılır. **Escape** çıkar; önceki pencere boyutu korunur. Sarma, oynatma ve ses kontrolleri tam ekranda da erişilebilirdir. Başka sayfaya geçmek tam ekranı kapatır.
- **Ayarlar → Kayıt → Kayıt Sağlığı → Kayıt Sağlığını Göster** varsayılan kapalıdır; tampon durmadan değişir. Küçük başlık göstergesi ayrıntılar sayfasını açar. Kodlanan kare hızı, kaynaktan kare gelişi, görüntü işleme gecikmeleri ve kurtarma noktası bilgisi mevcut ölçümlerden alınır. Güncellenmeyen ölçüm yeşil kalmaz. Quake paylaşımlı bellek teslimi izlenebilir; WGC/paylaşımlı doku için kaynak görüntüsünün güncelliği doğrulanamadığı açıkça belirtilir. Sabit menü, piksel değişmediği için hata sayılmaz.
- Disk tamponu yaklaşık iki saniyede bir tamamlanmış GOP’ları ve o aralığın ayrı uygulama ses günlüklerini atomik kurtarma manifestine bağlar. Yeniden açılışta mevcut **Kurtar** akışı bunları klibe çevirir. İsimler ve ses zamanlaması korunur; klip doğrulanmadan manifest/paketler temizlenmez. Tekrarlanan başarısızlık ve yeniden başlatma aynı veriyi korur. Kaynak PCM kuyruğunun sonu bozulmuşsa kullanılabilir geçmiş ve açık uyarı saklanır.
- **Hızlı** dışa aktarma anahtar karelere hizalanmış gerçek aralığı gösterir ve videoyu kopyalar. **Hassas** kesim NVENC p5/CQP12 kullanır. Tüm süre seçildiğinde her iki seçenek videoyu kopyalar; yalnız ses değişiklikleri görüntüyü yeniden kodlamaz. Seçili sesler AAC 256 kbps olarak düzeyleriyle yazılır; kapalı izler çıkarılır. Normal oynatıcı karışımı ile seçili ayrı izler korunur. Kaynağı değişmiş veya onayı eskimiş bir istek reddedilir. Yeni dosya doğrulanarak yayımlanır; kaynak ve aynı adlı mevcut çıktılar ezilmez.
- Sağ ses panelindeki seçimler uygulama adına göre varsayılan olarak saklanır. **Yalnız Bu Klip** bağımsız ayar oluşturur. İsimli karışımlar kaydedilip uygulanabilir. Ayarlar yüklenmeden veya karışım işlemi tamamlanmadan dışa aktarma onayı hazırlanmaz. **Dalga Kaynağı** seçili özgün izin dalgasını gösterir; dalgaya tıklama ve ok/Home/End tuşları konum değiştirir. Dalga ses düzeyinden bağımsızdır.

## Veri Ve Kaynak Sınırları

Ses tercihleri `%APPDATA%/Ember/editor-audio-mixes.json` içindedir. Bozuk tercih dosyasının üzerine yazılmaz. Sınırlar 50 isimli karışım, 500 klibe özel ayar ve 512 uygulama kimliğidir. İzler değişken sıra numarasına göre eşleştirilmez.

Dalga çözümlemesi yalnız gerektiğinde, tek arka plan çözücüsüyle yapılır. Çıktı en çok 1200 örnek sütunu ve 256 önbellek kaydıdır. Kanal zıtlığı ve yüksek frekanslı sesler mono ortalamayla kaybolmaz. Başka klibe/ize geçiş bekleyen eski işleri iptal eder; bitmekte olan eski iş arayüze uygulanmaz. Önizleme için oluşturulan ses kopyaları video zaman çizelgesindeki başlangıç sessizliğini korur. Özgün medya değişmez.

Disk kurtarması son tamamlanmamış GOP/kontrol aralığını içermez; normal koşullarda yaklaşık son üç saniye eksik kalabilir. Fiziksel elektrik kesintisi sınanmadı; güvence diskin Windows flush isteğini yerine getirmesine bağlıdır. RAM videosu ani süreç kapanışından kurtarılamaz. Dört bekleyen disk oturumu veya okunamayan manifest varsa mevcut veriyi silmek yerine yeni disk kaydı durdurulur. Ayrıntılar: [Native Günlük Tasarımı](../tools/native-capture/replay-journal.md).

## Doğrulama — 6 Kasım 2026

- Toplu davranış testleri ve gerçek süreç sonlandırma fikstürü: **348 geçti, 0 hata, 0 atlama**.
- Paketlenen native motorla ek kontroller: **9 geçti**. Disk/RAM kod çözme, disk ve RAM kapasite sınırları, zorla kapatma/yeniden açma, başarısız yayın sonrasında ikinci yeniden açılış, ayrı ses kurtarma ve doğrulamadan sonra temizlik içerir.
- Gerçek FFmpeg video paket özetleri: ses değişikliklerinde ve hızlı kesimde özgün video paketleri aynı. Hassas kesim gerçek NVENC ile doğrulandı; gecikmeli ses, kapalı iz ve ses düzeyleri sınandı.
- Gerçek Electron arayüzünde 1280×800 ve 850×650: tam ekran/çıkış, pencere boyutu, varsayılan kapalı sağlık, kalıcı karışımlar, gecikmeli yanıtlar, filmstrip/dalga yerleşimi ve V1 aktarım akışı doğrulandı.
- Paket kaynakları gerçek main/preload ile ayrı geçici profilde açıldı; yeni IPC işlemleri, varsayılan kapalı sağlık ayarı ve ayarın kaydı sınandı. Kullanıcının profili, başlangıç kaydı veya etkin tamponu değiştirilmedi.
- Paketlenen 40 kaynak dosyası ve native motor derleme çıktısıyla eşleşti. Önceki setup ile iki mevcut uygulama kopyasından alınan beş dosya SHA256 özeti değişmedi.

Tekrar çalıştırma komutları: `node --test --test-concurrency=1 tests/*.test.js tools/native-capture/adapter.test.js tools/native-capture/durable-recovery.test.js`; native testler için `EMBER_NATIVE_REPLAY_TEST=1` ve `EMBER_NATIVE_RUNTIME` ile paket motorunun kökü seçilir. İzole açılış kontrolü `node tests/playback-package-smoke.js <paketin resources/app klasörü>` ile çalışır.
