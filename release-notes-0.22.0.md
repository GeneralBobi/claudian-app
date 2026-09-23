# Claudian 0.22.0

Yüzük: ses kaydından not çıkarma, tamamen bu bilgisayarda.

- Yeni **Yüzük** sekmesi. Ders, toplantı ya da sesli not kaydını seç; yerel Whisper konuşmayı yazıya döker, eğitilmiş Laya modeli her cümle için tutmaya değer mi diye karar verir, tarihler ayıklanır. İlerleme gerçek aşamalarla gösterilir; bitince bildirim gelir.
- Taslak onay ekranı: tutulan cümleleri düzelt, atılanlardan kurtar (denetim modu), hatırlatıcı tarihlerini onayla. Onay bu kayıt için bir hafıza notu açar ve tarihleri Hatırlatıcılar'a ekler; yazmalar mevcut makbuzlu yazma katmanından geçer. Onaylanmayan hiçbir şey hafızaya yazılmaz.
- Düzeltmeler bir sonraki model eğitimi için motor klasöründe saklanır.
- Diğer cihazlar: telefon aynı Wi-Fi'deyken kodlu yerel adres üzerinden kayıt gönderebilir; başka bir Windows bilgisayar için kurulum paketi (motor + modeller + kur.bat) hazırlanabilir.

Motor uygulamayla birlikte gelmez: yaklaşık 3 GB model içeren ayrı bir Python klasörüdür ve bir kez kur.bat ile kurulur. Motor yoksa sekme kurulum durumunu gösterir.

Doğrulama: 334 birim testi (5’i yeni: taslak kimliği sınırı, not içeriği, onayda not + hatırlatıcı + makbuz, boş onayın reddi, arayüz betiklerinin uygulama protokolünde sunulması) ve gerçek Electron penceresinde Yüzük sekmesi, taslak açma ve onay ekranı kontrol edildi. Protokol 2.9.0.

Sınırlar: Laya modeli iki gerçek kayıt ve sentetik veriyle eğitildi; yeni konuşmacılarda gereksiz cümle tutabilir. Türkçe saat ifadeleri ("saat yedide") ve yazıyla söylenen gün sayıları henüz tarihe çevrilmiyor. "Nasıl çalışır" animasyonu yok; LottieFiles bağlantısı kurulunca eklenecek. Windows yükleyicisi dijital imzalı değildir.
