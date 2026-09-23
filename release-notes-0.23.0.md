# Claudian 0.23.0

Yüzük artık dinliyor: konuşulandan not, konuşma sürerken, doğrudan Obsidian'a.

- **Canlı dinle.** Yüzük sekmesinde mikrofonu seç ve başlat. Söylenen her kısım bu bilgisayarda yazıya dökülür (Whisper large-v3-turbo); eğitilmiş Laya modeli her cümleyi kendisinden önceki altı cümleyle birlikte okur ve dört karardan birini verir: kaydet, devamını bekle, at ya da mahrem. "Bekle", bir şey duyurulup asıl bilgi henüz gelmediğinde ("iki şey var…") cümleleri biriktirir ve bilgi gelince tek madde olarak yazar.
- **Onay adımı yok.** Tutmaya değer olan, oturumun notuna (“Yüzük · tarih saat Canlı dinleme”) saatiyle birlikte hemen yazılır; konu değişince yeni başlık açılır, tarih duyulursa Hatırlatıcılar’a eklenir, notta adı geçen hafıza notlarına bağlantı verilir. Her yazma mevcut makbuzlu yazma katmanından geçer.
- **Mahrem olan yazılmaz.** Modelin “mahrem” kararına ek olarak bağımsız bir kural katmanı: “kaydetme”, “aramızda kalsın” gibi bir itirazdan sonra iki dakika hiçbir şey yazılmaz; kimlik, kart, şifre gibi numaralar ve başka birinin sağlık, aile, para bilgisi yazılmaz. Mahrem cümlelerin metni ekranda da gösterilmez. Ses hiçbir yerde saklanmaz.
- Ekranda: ses seviyesi, konuşulurken ara metin, her cümlenin kararı ve hafızaya yazılanlar.
- İsteğe bağlı: mahrem olmayan cümlelerin metni, bir sonraki model eğitimi için yalnız bu bilgisayarda saklanabilir.
- Kayıt işleme (0.22) aynen duruyor: bir ses dosyası taslağa dönüşür ve onayla yazılır.

Motor uygulamayla gelmez; Yüzük motor klasörünün güncel sürümü (canli.py, laya-yuzuk-v3) gerekir. Motor canlı dinlemeyi desteklemiyorsa kart görünmez.

Doğrulama: 336 birim testi (canlı yazma, bağlantı eşleşmesi, arayüz betiklerinin sunulması dahil) ve gerçek Electron penceresinde, yalıtılmış test profiliyle uçtan uca canlı dinleme: dosya canlı akış olarak verildi, kararlar ekranda göründü, maddeler test hafızasındaki oturum notuna yazıldı. Protokol 2.9.0.

Sınırlar: Model iki gerçek konuşmacı ve sentetik veriyle eğitildi; yeni ortamlarda gereksiz cümle yazabilir ve bazılarını kaçırabilir. Mahremiyet kuralları yeni kalıpları kaçırabilir — çevrendekilere not aldığını söylemek yine gereklidir. Türkçe saat ifadeleri tarihe çevrilmiyor. “Nasıl çalışır” animasyonu henüz yok. Windows yükleyicisi dijital imzalı değildir.
