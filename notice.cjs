'use strict';
/**
 * Fark etme katmanı.
 *
 * Bir Markdown klasörünü okur ve dikkat etmeye değer olabilecek şeyleri adaylandırır.
 * Model çağrısı yok, ağ isteği yok, veritabanı yok: hepsi dosyalardan hesaplanır.
 *
 * Üreticiler `lib/core/monitors.ts`'ten taşındı (eşikler ve formüller dahil) ya da
 * protokolün kendi işlemlerinden türetildi; her aday hangisinden geldiğini taşır.
 *
 * ── Ölçümden gelen üç düzeltme ────────────────────────────────────────────
 *
 * Bu katmanın ilk hâli sentetik bir vault üzerinde koşturuldu ve üç kusuru görüldü.
 * Hiçbiri kavrayış eksiği değildi, üçü de tasarım eksiğiydi — ve düzeltilmeden
 * taşınsalardı ürettikleri şey gürültü olurdu:
 *
 *   1. Markdown'da kalemin kendi yaşı yok. Bir nottaki bütün kalemler notun tarihini
 *      paylaşıyordu, o yüzden üç ayrı taahhüt aynı "24 gündür açık" ve aynı 0.90
 *      aciliyetle çıkıyordu. Çözüm vault'a yazılmaz: uygulamanın kendi tuttuğu bir
 *      ilk-görülme defteri. Bu makine durumudur, not değildir.
 *
 *   2. Tekilleştirme yoktu. Tek bir kalem hem taahhüt hem düşen dayanak olarak iki
 *      aday üretiyordu: tek iş, iki dürtme.
 *
 *   3. Sıralama düzdü. "Komşuya kopya anahtar ver", bir projeyi tıkayan işle aynı
 *      aciliyetteydi. Yaş önem değildir; bağlılık da hesaba katılır.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY = 86400000;
const AYLAR = ['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

const NOTICE_NOTE = { tr: 'Claudian Fark ettikleri.md', en: 'Claudian Noticed.md' };

const key = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
const escapeForRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bir notun frontmatter'ı ve gövdesi. Hiçbir çıkarım yok, yalnız biçim değiştirme. */
function parse(name, raw) {
  const matched = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const head = matched ? matched[1] : '';
  const field = label => (new RegExp(`^${label}:\\s*(.+)$`, 'm').exec(head) || [])[1]?.trim() || '';
  return {
    name: name.replace(/\.md$/, ''),
    kind: field('tür') || field('type'),
    declared: field('güncellenme') || field('updated'),
    tags: ((/^tags:\s*\[([^\]]*)\]/m.exec(head) || [])[1] || '').split(',').map(t => t.trim()).filter(Boolean),
    body: matched ? raw.slice(matched[0].length) : raw,
  };
}

/**
 * Kendi alanında ilan edilmiş tarih bir yükümlülüktür; cümle içinde geçen tarih bir atıftır.
 * Bu ayrım `lib/core/reminders.ts`'te bir kez pahalıya öğrenildi: [[Kontrol Paneli]]'ndeki
 * "3 Eylül yenilemesi … 799 TL" cümlesinden olmayan bir borç kalemi üretilmişti.
 */
function readDate(text) {
  const declared = /·\s*\*\*(~?)\s*(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})\*\*/.exec(text);
  if (!declared) return null;
  const approximate = declared[1] === '~';
  const month = AYLAR.indexOf(declared[3].toLocaleLowerCase('tr'));
  const english = MONTHS.indexOf(declared[3].toLowerCase());
  const index = month >= 0 ? month : english;
  if (index < 0) return null;
  return { at: Date.UTC(Number(declared[4]), index, Number(declared[2]), 12), approximate };
}

/** Satirin kendi ilan ettigi acilis tarihi: `· açıldı: 2026-08-18` / `· opened: …`. */
function opened(rest) {
  const found = /(?:açıldı|acildi|opened)\s*:\s*(\d{4})-(\d{2})-(\d{2})/i.exec(rest || '');
  if (!found) return null;
  const at = Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]), 12);
  return Number.isFinite(at) ? at : null;
}

/** `- [ ] **Başlık** · …` biçiminde ilan edilmiş açık kalemler. Kapalı olanlar girmez. */
function items(notes) {
  const found = [];
  for (const note of notes) {
    for (const line of note.body.split('\n')) {
      const matched = /^- \[( |x)\] \*\*(.+?)\*\*(.*)$/.exec(line.trim());
      if (!matched || matched[1] !== ' ') continue;
      const noteTime = Date.parse(note.declared + 'T12:00:00Z');
      found.push({
        note: note.name,
        title: matched[2],
        rest: matched[3],
        due: readDate(matched[3]),   // {at, approximate} ya da null
        // Kalemin yasi once KENDI ilan ettigi acilis tarihinden alinir.
        //
        // Olculdu 12.09.2026: yalnizca notun degistirilme tarihine bakiliyordu. Panele tek
        // bir satir eklemek, icindeki butun kalemleri "bugun acilmis" yapiyor ve hem
        // taahhut hem dusen dayanak susuyordu -- yani paneli kullanmak, panelin fark etme
        // yetenegini siliyordu. Satirda "acildi: 2026-08-18" yaziyorsa dogru olan odur.
        existedBy: opened(matched[3]) ?? (Number.isFinite(noteTime) ? noteTime : null),
        topic: key('item', note.name, matched[2]),
      });
    }
  }
  return found;
}

/** `## Konu` altındaki `- **Aktif:**` ve `- **Reddedilen:**` satırları. */
function decisions(notes) {
  const active = [], rejected = [];
  for (const note of notes) {
    let heading = null;
    for (const line of note.body.split('\n')) {
      const isHeading = /^##\s+(.+)$/.exec(line);
      if (isHeading) { heading = isHeading[1].trim(); continue; }
      if (!heading) continue;
      const trimmed = line.trim();
      const act = /^-\s*\*\*(?:Aktif|Active):\*\*\s*(.+)$/.exec(trimmed);
      if (act) active.push({ note: note.name, topic: heading, value: act[1].trim() });
      const rej = /^-\s*\*\*(?:Reddedilen|Rejected):\*\*\s*(.+?)(?:\s+[—-]\s+(.+))?$/.exec(trimmed);
      if (rej) rejected.push({ note: note.name, topic: heading, value: rej[1].trim(), reason: rej[2] || null });
    }
  }
  return { active, rejected };
}

/**
 * Ledger: bir kalemi ilk ne zaman gördüğümüz ve en son ne zaman gündeme getirdiğimiz.
 *
 * Vault'a yazılmaz. [[Vault Protokolü]] ham log ve sürüm günlüğünü yasaklar; temas kaydı
 * da o kategoriye girer — aynı gerekçeyle `contact-log.jsonl` da vault dışında tutulmuştu.
 */
async function readLedger(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return {}; }
}

/**
 * Klasörü okur ve adayları döndürür. Hiçbir şey yazmaz — yazma kararı çağırana aittir.
 *
 * @param {object} input
 * @param {string} input.vault      not klasörü
 * @param {string} input.ledgerFile ilk-görülme defteri (vault dışında)
 * @param {number} [input.now]      ölçüm için sabitlenebilir
 */
async function look({ vault, ledgerFile, now = Date.now(), staleDays = 14, graceDays = 3, leadDays = 7, bulkDates = 4 }) {
  let names;
  // Katmanin kendi yazdigi not girdisine girmez: girse kendi kalemlerini bir sonraki
  // turda yeniden fark eder ve her turda buyuyen bir yanki uretirdi.
  const own = new Set(Object.values(NOTICE_NOTE));
  try { names = (await fs.readdir(vault)).filter(n => n.endsWith('.md') && !own.has(n)); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { missing: true, candidates: [], quiet: [], ledger: {} };
    throw error;
  }

  const notes = [];
  for (const name of names) notes.push(parse(name, await fs.readFile(path.join(vault, name), 'utf8')));

  const ledger = await readLedger(ledgerFile);
  const seenNow = {};
  const candidates = [], quiet = [];
  const add = (item) => candidates.push(item);
  const days = ms => Math.round((now - ms) / DAY);

  // Bir tarihi kaç not paylaşıyor. Paylaşan çoksa o tarih bir toplu işlemdir ve
  // ondan durgunluk hesaplanamaz -- ölçüldü: tek bir toplu düzenleme dört ayrı
  // "26 gündür sessiz" adayı üretiyordu.
  const shared = {};
  for (const note of notes) if (note.declared) shared[note.declared] = (shared[note.declared] || 0) + 1;

  // Kaç yerden anılıyor: önem için tek deterministik ölçü. Yaş önem değildir.
  const mentions = name => notes.filter(n => n.name !== name)
    .reduce((sum, n) => sum + (n.body.match(new RegExp(`\\[\\[${escapeForRegExp(name)}(\\||\\]\\])`, 'g')) || []).length, 0);

  const { active, rejected } = decisions(notes);

  // ── 1 · Durgunluk (monitors.ts > durgunProje) ────────────────────────────
  for (const note of notes.filter(n => /^(proje|project)$/i.test(n.kind))) {
    const modified = Date.parse(note.declared + 'T12:00:00Z');
    if (!Number.isFinite(modified)) { quiet.push(`durgunluk · ${note.name}: tarih okunamadı`); continue; }
    const idle = days(modified), linked = mentions(note.name);
    if (idle <= staleDays) { quiet.push(`durgunluk · ${note.name}: ${idle} gün, eşik ${staleDays}`); continue; }
    if (shared[note.declared] >= bulkDates) {
      quiet.push(`durgunluk · ${note.name}: ${note.declared} tarihini ${shared[note.declared]} not paylaşıyor — toplu düzenleme, durgunluk ölçülemez`);
      continue;
    }
    // Bir kez konuşulmuş ve bir daha geçmemiş varlık proje değildir.
    if (linked < 3) { quiet.push(`durgunluk · ${note.name}: ${idle} gün sessiz ama yalnız ${linked} yerden anılıyor`); continue; }
    add({ producer: 'durgunluk', origin: 'monitors.ts', hypothesis: true,
      topic: key('stale', note.name), subject: note.name,
      title: `${note.name} — ${idle} gündür sessiz`,
      why: `${idle} gün sinyal yok · ${linked} yerden anılıyor`,
      evidence: [`${note.name}.md · ${note.declared}`],
      urgency: 0.35, weight: linked });
  }

  // ── 2 · Taahhüt (monitors.ts > askidakiTaahhut) ──────────────────────────
  //
  // Yaş artık notun değil kalemin kendisinin: ilk görüldüğü an defterden okunur.
  for (const item of items(notes).filter(i => !i.due)) {
    // En erken kanit kazanir: defterdeki kayit, yoksa notun kendi tarihi, o da yoksa simdi.
    const firstSeen = Math.min(ledger[item.topic]?.firstSeen ?? now, item.existedBy ?? now);
    seenNow[item.topic] = { firstSeen, title: item.title, note: item.note };
    const age = days(firstSeen);
    if (age < graceDays) { quiet.push(`taahhüt · "${item.title}": ${age} günlük, tolerans ${graceDays}`); continue; }
    add({ producer: 'taahhüt', origin: 'monitors.ts',
      topic: item.topic, subject: item.title,
      title: `Kapanmamış taahhüt: ${item.title}`,
      why: `${age} gündür açık`,
      evidence: [`${item.note}.md · - [ ] **${item.title}**`],
      item: item.topic,
      urgency: Math.min(0.9, 0.3 + age / 30), weight: mentions(item.note) });
  }

  // ── 3 · Zaman (monitors.ts > yaklasanVade) ───────────────────────────────
  for (const item of items(notes).filter(i => i.due)) {
    seenNow[item.topic] = { firstSeen: Math.min(ledger[item.topic]?.firstSeen ?? now, item.existedBy ?? now), title: item.title, note: item.note };
    const left = Math.round((item.due.at - now) / DAY);
    if (left > leadDays) { quiet.push(`zaman · "${item.title}": ${left} gün var, pencere ${leadDays}`); continue; }
    // "~14 Eylül" yaklaşık demektir. Kesin bir vade gibi davranmaz: geçmiş sayılmaz ve
    // aciliyeti tavana çıkmaz, çünkü uydurulmuş bir kesinlik telefonu boşuna titretir.
    const soft = item.due.approximate;
    const late = left < 0 && !soft;
    add({ producer: 'zaman', origin: 'monitors.ts', hypothesis: soft,
      topic: item.topic, subject: item.title,
      title: late ? `Vadesi geçti: ${item.title}`
        : soft ? `${item.title} — yaklaşık tarih ${left < 0 ? `${-left} gün geride` : `${left} gün sonra`}`
        : `${left} gün kaldı: ${item.title}`,
      why: late ? `${-left} gün önce doldu` : soft ? 'tarih yaklaşık olarak yazılmış (~)' : 'ilan edilmiş tarih',
      evidence: [`${item.note}.md · - [ ] **${item.title}** · **…**`],
      urgency: late ? 1 : Math.max(0, 0.5 + 0.5 * (1 - left / Math.max(1, leadDays))) * (soft ? 0.6 : 1),
      item: item.topic,
      weight: mentions(item.note) });
  }

  // ── 4 · Reddedilmiş yaklaşım (protokol · RT-1) ve çelişki ────────────────
  const byTopic = {};
  for (const decision of active) (byTopic[decision.topic] ||= []).push(decision);
  for (const [topic, list] of Object.entries(byTopic)) {
    const back = list.find(d => rejected.some(r => r.topic === topic && r.value === d.value));
    if (back) {
      const record = rejected.find(r => r.topic === topic && r.value === back.value);
      add({ producer: 'reddedilmiş yaklaşım', origin: 'protokol · RT-1',
        topic: key('rt1', topic, back.value), subject: topic,
        title: `"${back.value}" daha önce bırakılmıştı, yine aktif`,
        why: record.reason ? `bırakılma gerekçesi: ${record.reason}` : 'kayıtlı bir red, gerekçesi notta',
        evidence: [`${back.note}.md · **Aktif:** ${back.value}`, `${record.note}.md · **Reddedilen:** ${record.value}`],
        urgency: 0.85, weight: list.length + 1 });
      continue;
    }
    const distinct = [...new Set(list.map(d => d.value))];
    if (distinct.length < 2) continue;
    add({ producer: 'çelişki', origin: 'protokol',
      topic: key('conflict', topic), subject: topic,
      title: `"${topic}" için iki aktif karar var`,
      why: `${distinct.map(v => `"${v}"`).join(' ↔ ')} — ikisi de aktif işaretli`,
      evidence: list.map(d => `${d.note}.md · **Aktif:** ${d.value}`),
      urgency: 0.6, weight: list.length });
  }

  // ── 5 · Düşen dayanak (protokolden türetildi) ───────────────────────────
  for (const item of items(notes)) {
    const firstSeen = Math.min(ledger[item.topic]?.firstSeen ?? now, item.existedBy ?? now);
    for (const decision of active) {
      // Kalem, kararın konusunu kendi metninde anıyor mu.
      const named = `${item.title} ${item.rest}`.toLocaleLowerCase('tr');
      if (!named.includes(decision.topic.toLocaleLowerCase('tr'))) continue;
      const note = notes.find(n => n.name === decision.note);
      const recorded = Date.parse((note?.declared || '') + 'T12:00:00Z');
      if (!Number.isFinite(recorded) || recorded <= firstSeen) {
        quiet.push(`dayanak · "${item.title}": "${decision.topic}" kalemden sonra değişmemiş`);
        continue;
      }
      add({ producer: 'düşen dayanak', origin: 'protokol',
        topic: key('basis', item.topic, decision.topic), subject: item.title,
        title: `"${item.title}" — dayanağı değişmiş olabilir`,
        why: `"${decision.topic}" kararı ${days(recorded) === 0 ? 'bugün' : days(recorded) + ' gün önce'} "${decision.value}" oldu; kalem ondan eski`,
        evidence: [`${item.note}.md · - [ ] **${item.title}**`, `${decision.note}.md · **Aktif:** ${decision.value}`],
        item: item.topic,
        urgency: 0.7, weight: mentions(item.note) });
    }
  }

  // ── Tekilleştirme ────────────────────────────────────────────────────────
  //
  // Tek bir kalem hem taahhüt hem başka bir şey olarak çıkabilir. Konu başına en güçlü
  // aday kalır; ötekiler elenir ve neden elendikleri yazılır.
  const strongest = new Map();

  for (const candidate of candidates) {
    // Ayni kalem hakkindaki adaylar tek grupta toplanir; konu anahtari bunu yapamiyordu.
    const group = candidate.item || candidate.topic;
    const rank = informative(candidate);
    const held = strongest.get(group);
    if (!held || rank > score(held)) {
      if (held) quiet.push(`tekil · "${held.subject}": ${held.producer} yerine ${candidate.producer} seçildi`);
      strongest.set(group, candidate);
    } else quiet.push(`tekil · "${candidate.subject}": ${candidate.producer}, ${held.producer} ile aynı kalem`);
  }

  const ranked = [...strongest.values()].sort((a, b) => score(b) - score(a));
  return { missing: false, candidates: ranked, quiet, ledger: seenNow };
}

/**
 * Sıralama ölçüsü.
 *
 * Yalnız aciliyete bakmak düz bir liste üretiyordu: "komşuya kopya anahtar ver", bir projeyi
 * tıkayan işle aynı yerde duruyordu. Bağlılık — kaç yerden anıldığı — ikinci terim olarak
 * girer, ama küçük bir ağırlıkla: bağlılık önemi gösterir, aciliyetin yerine geçmez.
 */
/**
 * Ayni kalem hakkinda iki aday varken hangisi kalir.
 *
 * Aciliyet degil: olculdu ki aciliyete gore secmek "24 gundur acik" adayini tutup
 * "dayanagi degismis olabilir" adayini eliyordu. Birincisi kullanicinin panelinde zaten
 * gorunuyor; ikincisi iki ayri notu birlestirmeden gorulemez -- yani katmanin var olma
 * sebebi. Birden fazla kanit satiri tasimak, "tek bir yerde gorunmeyen" seyin deterministik
 * karsiligi.
 */
function informative(candidate) {
  const crossesNotes = (candidate.evidence || []).length > 1 ? 1 : 0;
  return crossesNotes * 2 + score(candidate);
}

function score(candidate) {
  const connected = Math.min(1, (candidate.weight || 0) / 5);
  return candidate.urgency * 0.8 + connected * 0.2;
}

module.exports = { look, score, informative, parse, items, decisions, readDate };

/**
 * Fark edilenlerin yazıldığı not.
 *
 * Kullanıcının kendi panelinin içine yazılmıyor. Sebebi tek cümle: bu notun içindeki her
 * satırı uygulama koydu, ve bir gün silmek istediğinde silmesi gereken tek şey bu dosya
 * olmalı. Kullanıcının kendi kalemleriyle karışırsa bu ayrım kaybolur.
 */

/**
 * Adayları vault'a yazar — ve yalnız içerik gerçekten değiştiyse.
 *
 * Dosyaya her turda dokunmak iki şeyi birden bozar: Obsidian'ın dosya kurtarma geçmişini
 * gereksiz sürümlerle doldurur, ve `güncellenme` tarihini her gün tazeleyerek durgunluk
 * ölçüsünü anlamsızlaştırır -- yani katman kendi ölçtüğü sinyali kirletir.
 */
async function deliver({ vault, language = 'en', candidates, now = Date.now() }) {
  const name = NOTICE_NOTE[language] || NOTICE_NOTE.en;
  const target = path.join(vault, name);
  const tr = language === 'tr';
  const day = new Date(now).toISOString().slice(0, 10);

  const head = `---\ntags: [claudian, ${tr ? 'panel' : 'panel'}]\n${tr ? 'tür' : 'type'}: ${tr ? 'ajanda' : 'agenda'}\n${tr ? 'güncellenme' : 'updated'}: ${day}\n---\n\n`;
  const title = tr ? '# Claudian ne fark etti\n\n' : '# What Claudian noticed\n\n';
  const intro = tr
    ? 'Bu notu Claudian yazar; sen yazmazsın. Her satır neden orada olduğunu taşır. Gereksizse silmen yeterli — bir sonraki turda yeniden doğarsa gerekçesi hâlâ geçerli demektir.\n\n'
    : 'Claudian writes this note; you do not. Every line carries why it is there. Delete it if it is not useful — if it comes back on the next pass, the reason still holds.\n\n';

  const body = candidates.length
    ? candidates.map(c =>
        `## ${c.title}${c.hypothesis ? (tr ? ' — hipotez' : ' — hypothesis') : ''}\n\n` +
        `- ${tr ? 'Neden' : 'Why'}: ${c.why}\n` +
        c.evidence.map(e => `- ${tr ? 'Kanıt' : 'Evidence'}: ${e}\n`).join('') +
        `- ${tr ? 'Üretici' : 'Producer'}: ${c.producer} · ${c.origin}\n`
      ).join('\n')
    : (tr ? 'Şu an fark edilen bir şey yok.\n' : 'Nothing noticed right now.\n');

  const wanted = head + title + intro + body;
  const current = await fs.readFile(target, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

  // Bos bir vault'a "fark edilen bir sey yok" diyen bir dosya koymak gereksiz: her oturumda
  // okunup hicbir sey soyluyor. Ama dosya varken icini bosaltmamak daha kotu -- kullanici
  // bayat bir listeye bakar. O yuzden: yoksa olusturma, varsa guncelle.
  if (!candidates.length && current === null) return { note: name, changed: false, empty: true };

  // Tarih satırı her gün değişir; onu saymadan karşılaştır, yoksa içerik aynıyken bile
  // dosya her gün yeniden yazılır.
  const withoutDate = text => (text || '').replace(/^(güncellenme|updated): .*$/m, '');
  if (current !== null && withoutDate(current) === withoutDate(wanted)) return { note: name, changed: false };

  const first = current === null;
  await fs.writeFile(target, wanted);

  // Giris haritasi bu nottan haberdar degilse model onu hic acmiyor.
  //
  // Olculdu: not diskte duruyordu, skill onu giris okumasinda sayiyordu, ve uc ayri oturumun
  // hicbiri acmadi. Sebep -- model once Home'u okuyor ve "Acik uclar" altindaki baglantilari
  // izliyor; Home'un hic anmadigi bir dosyayi aramiyor.
  //
  // Baglanti YALNIZ not ilk kez olusturulurken ekleniyor. Her turda eklemek, kullanicinin
  // sildigi bir satiri geri koymak olurdu; bir kez sunmak ve kararina birakmak dogrusu.
  if (first) await linkFromHome(vault, language, name).catch(() => {});
  return { note: name, changed: true, count: candidates.length, linked: first };
}

/** Giriş haritasının "Açık uçlar" bölümüne tek bir bağlantı ekler; varsa dokunmaz. */
async function linkFromHome(vault, language, name) {
  const home = path.join(vault, 'Claudian Home.md');
  const text = await fs.readFile(home, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (text === null) return false;
  const link = `[[${name.replace(/\.md$/, '')}]]`;
  if (text.includes(link)) return false;

  const heading = /^##\s+(Açık uçlar|Open ends)\s*$/m.exec(text);
  if (!heading) return false;
  const at = heading.index + heading[0].length;
  const label = language === 'tr' ? 'Claudian ne fark etti' : 'What Claudian noticed';
  // Başlıktan sonra zaten bir boş satır var; kendi satırını eklemek ikinci bir boşluk
  // üretiyordu. Bağlantı var olan satırın başına, aynı ayraçla giriyor.
  const NL = String.fromCharCode(10);
  const rest = text.slice(at).replace(/^\s*\n/, NL + NL);
  const updated = text.slice(0, at) + rest.replace(NL + NL, NL + NL + `${link.slice(0, -2)}|${label}]] · `);
  await fs.writeFile(home, updated);
  return true;
}

module.exports.deliver = deliver;
module.exports.NOTICE_NOTE = NOTICE_NOTE;
