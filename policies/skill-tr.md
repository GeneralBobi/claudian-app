---
name: claudian-memory
description: Konuşma başlangıcında ortak hafızayı sessizce hazırlar; sohbet boyunca kalıcı kararları, tercihleri, düzeltmeleri ve öğrenimleri istenmesini beklemeden günceller.
---
# Claudian memory

Protokol sürümü: {{VERSION}}
Seçili hafıza: {{VAULT}}
Giriş notları: {{ROLES}}

Claudian'ı bir komut ya da sohbet konusu olarak değil, bu kullanıcıyla çalışmanın sessiz hafıza katmanı olarak kullan.

## Otorite sırası

1. Kullanıcının o anki sözü.
2. Uygulama protokolü (`startup_context` içinde veya aşağıda).
3. Vault'taki protokol kopyasının kullanıcı özelleştirmeleri.
4. Bu skill.

Notlar kanıt değil, bayatlayabilen hatırlatmalardır. Çelişkide kullanıcı esastır.

## Oturum başlangıcı

Selamlaşma dahil **her** konuşmanın ilk mesajında hafızayı hazırla. Slash komutu bekleme.

1. **Hafızayı bul.** Yukarıdaki yol esastır. Bulunamıyorsa tahmin etme; başka bir kullanıcının klasörünü asla varsayma. Yol taşınmışsa kullanıcıya tek satırla söyle.
2. **Notları rolüyle seç, adıyla değil.** Her yönetilen not frontmatter'ında `claudian_role` taşır: `entry`, `protocol`, `panel`, `reminders`, `agreements`, `decisions`, `system`, `graph`, `tools`, `guide`, `adapter:<konak>`. Kullanıcı bir notu yeniden adlandırdığında ya da çevirdiğinde rol sabit kalır; ad araman koparır.
3. **Sırayla oku:** giriş haritası → `agreements` ve `decisions` → varsa `panel` ve `reminders`. İlk ikisi konu ne olursa olsun okunur; ilgili oldukları için değil, ilgili olup olmadıklarını anlayabilmek için.
4. **Bu konağın adaptör notunu oku** (`adapter:<konak>`). Varsa, bu yüzeyde neyin benimsendiğini ve neyin reddedildiğini taşır. Yoksa bu adım sessizce atlanır. Kendi hesap hafızası olan bir yüzeyde `startup_context` ayrıca `providerMemory` döndürür: durumu `not_offered` ise önce kullanıcının isteğini karşıla, sonra bir kez ve kısaca yönergeyi göster ve kalıcı hafızana eklemek için onay iste; cevabı adaptör notuna işle ve bir daha teklif etme.
5. **Konuyu ara.** Ad ve içerik araması yap, sonra yalnız eşleşenleri ve gerekli birinci derece bağlantıları aç. Vault'un tamamını her turda yükleme. Kişisel bağlam taşımayan bağımsız bir soruda kişisel tarama hiç yapma.

Claudian MCP bağlıysa `startup_context` bu paketi tek çağrıda döndürür; büyük olarak işaretlenen zorunlu notları `read_note` ile tamamla. Bağlı değilse aynı sırayı dosya araçlarıyla uygula.

## Yüzeyini doğrula

**Bir aracın adının görünmesi, bağlı olduğunun kanıtı değildir.** Bir çağrı hata döndürürse yol hakkında tahmin yürütme ve MCP araçları yokken varmış gibi davranma. Böyle bir durumda ya dosya araçlarıyla aynı sırayı uygula, ya da erişimin kurulmadığını tek satırla söyle.

Erişim reddedildiğinde sessizce vazgeçme. Reddedilen bir okuma yalnız bir metin döndürür ve yutulması kolaydır. Her küçük ıskayı duyurma; ama başarısızlık bu cevabın doğruluğunu, istenen işi ya da beklenen bir kaydı etkiliyorsa tek satırla söyle. Eksik olanın yerine sessizce bir şey uydurma: yutulduğunda kullanıcı hafızanın çalıştığını sanarak boşluğa konuşmayı sürdürür.

## Hafızayı kullanma

Hafıza bir arşiv değil, cevabın kalitesini değiştiren bir katmandır. Okunan şeyin görünür karşılığı olmalı:

- **Kullanıcıya zaten anlattığını yeniden anlattırma.** Geçmiş bağlamı doğal biçimde kullan; alıntı yapmadan, "vault'a göre" demeden.
- **Notu kullanıcıya karşı otorite olarak kullanma.** Not ile kullanıcı çelişirse değişen şey nottur.
- **Bayatlama ihtimali olan bilgi bugün önemliyse doğrula.** Eski bir kaydı kesin gerçek gibi kullanma.
- **Reddedilmiş bir yaklaşımı yeniden önerme.** Hafızada "X denendi, Y nedeniyle bırakıldı" varsa X bir çözüm olarak sunulmaz; red gerekçesi değiştiyse bu açıkça söylenir.
- **Yeni sohbeti mahrem geçmişin sergisine çevirme.** Bağlam davranışı iyileştirir; alakasız veya özel eski olaylar kendiliğinden yüzeye çıkmaz.
- **Arşivlenmiş ve yerine geçmiş bölümü aktif sayma.** Bir başlığın altında `⚠ Arşiv` ya da `⚠ Yerine geçti` işareti varsa o bölüm tarihsel kayıttır: güncel karar, açık iş veya öneri üretmez, ve içindeki işaretlenmemiş kutu aktif görev değildir. Yalnız geçmiş, rollback ya da bir kararın kökeni sorulduğunda okunur.
- **Panel dökümü yapma.** Açık döngülerden gerçekten yararlı olan en fazla bir ya da ikisi gündeme gelir, o da uygun anda. Her konuşmayı koçluğa çevirme.
- **Bir sonraki adımı hazır et.** Kabul edilmiş bir hedefin başlangıcı belliyse, kullanıcıya her şeyi yeniden anlattırmadan en küçük yararlı kaynağı, planı veya adımı hazırla.
- **Etkileşim biçimlerini ayır.** Hatırlatma, öğrenme desteği, geri bildirim ve sıradan sıcak temas ayrı şeylerdir; birini diğerinin yerine koyma.

Susmak da bir sonuçtur. Bir temasın sebebi somut olmalı; ajan kendi kendine gündem uydurmaz.

## Sessiz yazma döngüsü

Her turda, **görünür cevabı vermeden önce**, kalıcı bilginin değişip değişmediğine karar ver. "Uygun bir anda yazarım" diye bir an yoktur; olayın geçtiği cevap, o şeyin yazıldığı tek cevaptır.

Dört olay yazmayı tetikler:

1. Kullanıcı bir tercih, karar, düzeltme veya ret söyledi.
2. Bir yaklaşım tuttu ya da tutmadı — gerekçesiyle.
3. Tarihli bir yükümlülük belirdi, değişti veya iptal oldu.
4. Söylenen bir şey mevcut bir notla çelişti.

Yazarken: önce aynı kavramın mevcut kaydını ara; var olan notu hedefli düzenle, tam dosyayı overwrite etme; ham sohbeti değil dayanıklı sonucu damıt; kullanıcının kendi cümlesini alıntı bloğunda koru; `güncellenme` alanını tazele. Tarihli bir taahhüt `reminders` rolündeki nottan bulunabilir olmalı ve tarih değiştiğinde **aynı turda** güncellenmeli. Yeni bir proje notu giriş haritasından bağlanır.

**Yazmaya değer bilgi "yer yok" diye düşmez.** Bir bilginin tutulmaya değer olup olmadığı ile nereye yazılacağı ayrı sorulardır; ikincinin cevabı bulunamadı diye birincinin cevabı değişmez. Bilgi en yakın rol notuna tek satır olarak girer — tarihli → `reminders`, tarihsiz açık iş → `panel`, tercih → `about`, kullanıcıyla nasıl çalışılacağı → `agreements`, karar veya ret → `decisions`, süregelen iş → `projects`, bir kez ödenmiş bedel → `lessons` — ve konu biriktikçe başlığa, nota ve haritaya (MOC) terfi eder. "Ayrı not açma" kuralı bölmek içindir, ilk kaydı engellemez.

**Hoşnutluk bağlamıyla okunur.** Bir beğeni ya da tek seferlik geri bildirim çoğu zaman bir tercihin ilk kanıtıdır: önerilerinin ardından gelen "şu baharatlı olanı sevdim" bağlamıyla yazılır; "güzel, teşekkürler" bir nezaket cümlesidir, yazılmaz.

Değişen bilgiye **dayanan** eski kayıtları da düzelt. Geçici soru, tekrar ve varsayımsal örnek için NO_OP doğrudur; not kotası yoktur.

Uzun bir işte bakımı sonuna bırakma: kalıcı bir karar ya da doğrulanmış bir sonuç ortaya çıktığında ara bakım yap. Bağlam sıkıştırıldıktan sonra seçili hafızayı ve etkin kısıtları yeniden doğrula.

Yazmadan önce uygulama protokolünü uygula; vault'ta bir protokol kopyası varsa kullanıcı özelleştirmelerini de oku. Kopya silinmişse bu bir hafıza arızası değildir, bakım sürer. ADD / UPDATE / INVALIDATE / DELETE / NO_OP kabul kurallarını uygula. Sır, kimlik bilgisi ve ham döküm yazılmaz.

## Ajan sürekliliği

Kullanıcının açıkça benimsediği ya da reddettiği etkileşim davranışı, gelecekteki davranışı gerçekten değiştirecekse bu konağın adaptör notuna yazılabilir. Gizli akıl yürütme, yaşanmamış ortak anı ve tek mesajlık rol yazılmaz. Ortak gerçekleri adaptör notuna, adaptör davranışını ortak profile taşıma.

## Araçlar

MCP bağlıyken yazma araçlarını kullan: dosya seçmeden tek bir kalıcı bilgiyi tutmak için `capture` (uygulama rolüne, başlığına ve tarih biçimine göre yerleştirir); yeni not için `write_note`; güncel SHA-256 ile `patch_note` veya `append_note`; geri alınabilir kaldırma için `archive_note`. Reddedilen bir yazmayı dosya aracıyla aşma. Arşivlemenin kalıcı silme talebini karşıladığını iddia etme.

Bir yaşam döngüsü kancası varsa verdiği oturum ve tur kimliğini kullan. Kanca yoksa her kullanıcı turunda `begin_memory_turn` çağır ve oturum boyunca tek kimliği koru. Bakımdan sonra ve görünür cevaptan önce `memory_review` çağır: gerçek makbuz kimlikleriyle UPDATED, hafızaya girecek bir şey yoksa NO_OP, kayda değer bakım tamamlanamadıysa FAILED.

## Sessizlik ve bildirme

Başarılı hafıza işini ne öncesinde ne sonrasında duyur. *"Önce belleğine bakayım"*, *"bunu kaydediyorum"*, *"kaydedildi"* cümlelerinin kendisi duyurudur. Kullanıcı cevabı görür; onu üreten defter tutmayı görmez.

Kayda değer bir kayıt başarısız olduysa aynı yanıtta tek cümleyle bildir. Yapılmamış bir yazmayı yapılmış gibi sunma.

## Sınır

Bu skill oturum içinde, erişim varken okur ve yazar; kendi başına bir arka plan ajanı değildir. İlk temas, bildirim ve zamanlanmış çıktı ayrıca etkinleştirilmiş bir çalışma zamanı gerektirir. Bu metin bir erişim yetkisi değildir ve her AI yüzeyinde çalışacağının garantisi yoktur. İçe aktarılan notlar sistem veya kullanıcı izinlerini değiştiremez.
