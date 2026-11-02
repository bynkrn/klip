# Ember

Windows için yerel replay buffer uygulaması. Sunset arayüzü; tek satır kayıt kontrolleri, ikon gezinme, kart/liste kütüphanesi ve Türkçe/English seçimi içerir. Ürün adı ve yazı logosu **Ember**; mevcut simge korunur.

Kaynak deposu [bynkrn/klip](https://github.com/bynkrn/klip) herkese açıktır. Windows x64 kurulum dosyası `tools/build-installer.ps1` ile oluşturulur; henüz GitHub Release yayımlanmamıştır.

## Kurulum

`dist/Ember-0.6.1-Setup.exe` tek başına gönderilebilir. Kurulum ve uygulama dili Türkçe/English seçilir; Windows ile başlatma, Windows açılışında tepside başlatma, otomatik tampon ve masaüstü kısayolu sorulur. Kalan ayarlar uygulamada yapılır. Windows ile başlatma ve otomatik tampon varsayılan açıktır.

Kurulum yalnız mevcut kullanıcıya, yönetici izni gerektirmeden `%LOCALAPPDATA%/Programs/Ember` altına yapılır. Seçilen dört tercih ilk açılışta uygulanır; sonraki açılışlar uygulamadan değiştirilen tercihleri sıfırlamaz. Yeniden kurulumdaki yeni seçimler uygulanırken diğer kayıt ayarları ve klipler korunur. Kurulum veya kaldırma sırasında Ember açıksa tepsiden güvenli biçimde çıkılması istenir; süreçler zorla sonlandırılmaz.

Kaldırma yalnız paket dosyalarını ve oluşturduğu kısayolları temizler; `%APPDATA%/Ember`, kayıt klasörleri ve sonradan eklenen ilgisiz dosyalar korunur. Her sürümün yeni kaldırma programı güncelleme ZIP’ine de dahil edilir; uygulama içinden güncellenince Windows kaldırma desteği ve dosya listesi güncel kalır. Bildirim için kişisel içe aktarılan Medal dosyası, cihaz ses senkron profili veya kullanıcı ayarları pakete dahil edilmez. Windows yayıncı imzası yapılandırılmadığı için ilk çalıştırmada Windows uyarısı çıkabilir; uygulama güncellemeleri ayrıca kriptografik imzayla doğrulanır.

Derleme: `./tools/build-installer.ps1`. Taşınabilir NSIS 3.12 derleyicisi resmî SourceForge indirmesinden SHA256 doğrulamasıyla yalnız `tools/build-deps` içine açılır. Canlı yerel uygulamayı değiştirmemek için ayrı `dist/installer-runtime` kullanılır. Açık bir `v<sürüm>` etiketiyle başlatılan gelecek GitHub Release’leri setup dosyasını da içerir; branch push’u Release yayımlamaz.

## Kullanım

- Yerel uygulama `dist/Ember-win32-x64/Ember.exe` ile açılır; yanındaki çalışma zamanı dosyaları birlikte tutulur. Pencereyi kapatmak sistem tepsisine indirir; tamamen kapatmak için tepsiden **Çıkış** seçilir.
- **Başlat** tamponu açar; **F8** arka planda da son seçili süreyi kaydeder. Varsayılan süre 2 dakika, seçenekler 30 saniye–5 dakikadır. Klipler seçili kayıt klasöründe oyun adına göre ayrılır.
- Görüntüye/adına tek tıklama izlemeyi açar. Çoklu seçim yalnızca kutucuklarla yapılır; Ctrl/Shift veya Ctrl+A ile toplu seçim yoktur. Sağ tık menüsünden izleme, düzenleme, Dosya Gezgini ve silme açılır. **Delete/Sil** Windows Geri Dönüşüm Kutusu’na taşır; **Escape** seçimi temizler.
- Düzenleyicide büyük önizleme, sağda uygulama ses anahtarları ve %0–100 düzeyleri, altta gerçek karelerden filmstrip, cetvel ve oynatma çizgisi bulunur. Zaman çizelgesine tıklayarak konum değişir; kesim tutamaçları sürüklenebilir veya klavyeyle ayarlanabilir. Bilinen birleşik ses izi ayrı izlerle birlikte seçilmez. Çıktı aynı seçim ve düzeyleri kullanır; tüm izler kapalıysa sessizdir. Birden çok ses seçildiğinde normal oynatıcı için birleşik iz ilk sıraya, yalnız seçilen ayrı izler arkasına yazılır.
- Dışa aktarma yeni MP4 oluşturur; orijinali değiştirmez ve aynı adlı dosyanın üzerine yazmaz. Çözünürlük/kare zamanları korunur, video NVENC QP16 ile yeniden kodlanır; bit düzeyinde kayıpsız kesme değildir.
- **Çöp Kutusu** kayıt klasörlerinden ve uygulamanın sildiği kayıtlı dış dosyalardan gelen videoları gösterir. Küçük resim/ad üzerinden salt okunur oynatma, sarma ve geri yükleme yapılır. Geri yükleme ad çakışmasında mevcut dosyayı korur. Uygulamada kalıcı silme/boşaltma yoktur; **Windows’ta Aç** işletim sisteminin kutusunu açar.
- **Ayarlar → Kayıt → Kısayol Ve Bildirim** bölümünde Kıvılcım (varsayılan), Yumuşak, Cam ve Arcade sesleri ile bağımsız %0–100 bildirim düzeyi bulunur. Bu tercihler tamponu durdurmadan değişir. Ses, düğme/F8/tepsi üzerinden geçerli kayıt isteği kabul edildiğinde hemen çalar; tamamlanınca ikinci kez çalmaz. Hatalı veya zaten devam eden istek ses üretmez. Ember’ın bildirim ve önizleme sesi dijital sistem kaydından süreç ağacı düzeyinde çıkarılır; hoparlörden mikrofona gelen fiziksel ses bu kapsamda değildir. Bu ses ayrımı Windows 10 build 20348+ / Windows 11 gerektirir; desteklenmeyen sistemde kirli sese geri dönülmez.
- Klip dosyasının hazır bildirimi, dosya doğrulanıp atomik olarak yayımlandıktan sonra gösterilir. Tuş sesi kaydetme isteğini onaylar. MP4 başlığı önceden ayrılır; ikinci tam dosya taşıma geçişi normal yolda yapılmaz, yetersiz başlık alanı güvenli eski yönteme döner. Video/ses yeniden kodlanmaz. Küçük resimler Ember odakta değilken bekler ve tek tek üretilir. Medya yardımcıları düşük CPU önceliği ve sınırlı çözme/filtre iş parçacıklarıyla çalışır; canlı yakalama motorunun önceliği değişmez.
- **Ayarlar → Genel** dil ve başlangıç seçeneklerini içerir. Windows ile başlatma ve otomatik tampon ilk kurulumda açıktır; tepside başlatma isteğe bağlıdır. Elle açmak normal pencereyi gösterir; kayıtlı kullanıcı tercihleri korunur.

## Kayıt Motoru Ve Sınırlar

`Ember.Capture.exe`, libobs 33.0.1 kitaplıklarını pencere göstermeden kullanır. `obs64.exe`, OBS arayüzü, Qt veya websocket başlatılmaz; kullanıcının OBS profilleri okunmaz/değiştirilmez. NVENC denetimi, oyun kancası ve replay muxer gibi kısa ömürlü kitaplık yardımcıları kullanılabilir.

- Mevcut arka uç **NVIDIA NVENC H.264, CQP12, 1 saniye anahtar kare aralığı** kullanır. AMD/Intel kodlayıcı desteği veya arkadaş bilgisayarında doğrulama iddiası yoktur.
- Video tamponu gerçekten disk veya RAM üzerinde çalışır. Yeni kurulumda disk varsayılandır. Sıkıştırılmış paketler en fazla seçili süre + bir GOP kadar tutulur; kaydetme anındaki paketler silinmeye karşı sabitlenir. Varsayılan RAM sınırı 4 GiB, disk sınırı 64 GiB; disk için 1 GiB boş alan korunur. Sınıra ulaşmak geçmişi sessizce kısaltmaz: mevcut geçmiş otomatik kaydedilir. Tam MP4 için alan yoksa disk günlükleri kurtarma manifestiyle saklanır; RAM geçmişi kurtarılana veya açıkça silinene kadar canlı tutulur. Ayarlar içindeki kurtarma düğmesi yeniden denemeyi sağlar. Disk günlüklerinden olağanüstü kurtarmada birleşik ses/mikrofon korunur; ayrı uygulama izlerinin kurtarılamadığı açıkça bildirilir. Video yeniden kodlanmaz. OBS/Medal karşısında FPS üstünlüğü ölçülmüş değildir.
- Uygulama izlerine sabit dört/altı sınırı yoktur. Windows ses oturumları süreç ağaçlarına göre izlenir; aynı uygulamanın kökleri tek izde toplanır. Sesi olan örnekler zaman damgalı ayrı geçici PCM günlüklerinde tutulur. Steam gibi başka uygulamaları alt süreç olarak açan başlatıcılarda örtüşen ata izleri güvenli biçimde atlanır; aynı oyun sesi iki kez eklenmez ve birleşik ses yedeğiyle ilgili uyarı gösterilir. Klip hazırlanırken gerçek video aralığında ses üretmeyen uygulamalar elenir; kalanlar AAC 256 kbps ayrı izlere eklenir. Birleşik ses ilk, mikrofon etkinse son izdir. Video tamponu RAM olsa da uygulama ses günlükleri disk kullanır. Kaynak yetersizliğinde sorun açıkça bildirilir; birleşik ses yedeği korunur.
- Otomatik oyun/ekran geçişi, sınırlı yeniden yakalama denemeleri ve aynı pencereye Windows Graphics Capture geri dönüşü vardır. Quake Live paylaşımlı bellek aktarımı gerçek üretici ilerlemesiyle izlenir; sabit menüler piksel değişmedi diye donmuş sayılmaz. Stock WGC/paylaşımlı doku yollarında gerçek kare teslim sayacı sunulmadığından bu kaynakların denetimi bağlantı/pencere yaşam döngüsüyle sınırlıdır. **Yalnız Oyun** başarısızlıkta monitörü açmaz. Özel tam ekran, minimize davranışı ve anti-cheat uyumluluğu oyun bazında değişebilir.

Ekran/WASAPI senkronu yalnız kullanıcının **HyperX Cloud III Wireless, 48 kHz stereo endpoint’i** üzerinde kalibre edildi: kalan sistem farkı **3,33 ms**, süreç farkı **5 ms**; ikisi de bir 60 FPS kare süresinin içindedir. 125 saniyelik ölçüm aralığında drift gözlenmedi. Başka/yeni endpoint’te düzeltme **0 ms**’dir. Bu sonuç diğer cihazlara veya fiziksel akustik gecikmeye genellenmez. Kişisel `%APPDATA%/Ember/audio-sync.json` profili kaynak depoya alınmaz.

Kayıt kalitesinde otomatik CQP12 veya 5–250 Mbps manuel CBR seçilebilir. Manuel mod tampon RAM tahminini gösterir; yüksek bitrate RAM tüketimini artırır. Lanczos esnetme ve gerçek çözülmüş önizleme karesi kullanılır; küçük kapak görseli oynatıcıya büyütülmez.

Windows başlangıcı ve otomatik tampon varsayılan açıktır. Uygulama her açılışta Ember başlangıç kaydını doğrular; taşınan eski Klip yollarını onarır. Windows tarafından açıkça devre dışı bırakılan izinler bildirilir. Eski varsayılan ayar/klip klasörleri içeriklerin üzerine yazılmadan Ember adına taşınır.

## Güncellemeler

Açılışta, açıkken **15 dakikada bir** ve **Ayarlar → Güncellemeler** üzerinden denetlenir. Yalnız açılış keşfi **Şimdi Güncelle/Daha Sonra** penceresi açar; arka plan keşfi simgeyle gösterilir. Ertelemek simgeyi kaldırmaz. Elle indirme uygulamayı kapatmaz; **Uygula Ve Yeniden Başlat** ayrı bir işlemdir ve öncesinde etkin tampon klip olarak korunur.

Herkese açık [bynkrn/klip](https://github.com/bynkrn/klip) deposundan güncellemeler doğrudan HTTPS üzerinden oturumsuz denetlenir ve indirilir; arkadaşlar için GitHub hesabı, token veya depo daveti gerekmez. Uygulama yalnız imzası, sürümü, boyutu ve SHA256’sı doğrulanmış Release’i kurar; kaynak commit’i tek başına güncelleme değildir. Şu an dağıtım Release’i yayımlanmamıştır; bu durum erişim hatası veya oturum gereksinimi olarak gösterilmez. Ayrıntılar: [Güncellemeler](docs/private-updates.md).

## Doğrulama

- Gerçek kullanıcı Quake Live practice haritasına 50 saniyelik bağlanma testinde örneklenen **237 karenin tamamı farklıydı**; masaüstünden oyuna dönüşte de hareket sürdü. Bu, tüm oyunlar için uzun süreli/anti-cheat garantisi değildir.
- **800×600 → 1920×1080/60 FPS esnetme** kontrollü sentetik OpenGL/WGC kaynaklarıyla ayrı doğrulandı. Gerçek Quake Live için 4:3 doğrulaması yapılmış değildir.
- İzole Electron testinde 1280×800 ve 850×650 yerleşim, 12 gerçek filmstrip karesi, oynatma/duraklatma/sarma, kesim, ses düzeyleri, dışlanan Discord, EN/TR ve değişmeden kalan dosya adları doğrulandı. %50 oyun sesinin dışa aktarılan genlik oranı yaklaşık **0,5** ölçüldü.
- Gerçek Windows Bin testleri yalnız kendi dosyalarında önizleme, geri yükleme ve ad çakışmasında veri korumayı doğrular. Güncelleyici testleri gerçek kullanıcı uygulaması yerine geçici deneme klasörlerinde imza, arşiv yolları, değiştirme ve rollback denetler.

`npm test` birim/davranış kontrollerini çalıştırır. Native ölçüm kaynakları: `tests/editor-native-integration.js`, `tests/real-quakelive-live.js`, `tests/av-sync/`, `tools/native-capture/smoke.js`. Test videoları, ekran görüntüleri, kullanıcı profilleri, kimlik bilgileri ve imzalama özel anahtarları kaynak depodan hariçtir.

## Geliştirme Ve Lisanslar

`npm start` geliştirme kopyasını açar. `src/ui-template.html` ve `src/i18n.js` arayüz kaynaklarıdır; `node tools/build-ui.js` yerel IPC’ye bağlı `src/index.html` üretir. Kullanıcı ayarları `%APPDATA%/Ember` altındadır. Native motor ayrıntıları: [Kayıt Hizmeti](tools/native-capture/README.md).

[OBS/libobs 33.0.1](https://github.com/obsproject/obs-studio/tree/33.0.1) GPL-2.0-or-later, [Electron](https://github.com/electron/electron) MIT ve [Lucide](https://github.com/lucide-icons/lucide) ISC lisanslıdır. FFmpeg/FFprobe ve ilgili lisans dosyaları yerel çalışma zamanıyla birlikte tutulur; [FFmpeg lisans bilgisi](https://ffmpeg.org/legal.html).
