'use strict';
// Fark etme katmanı. Her test, sentetik bir vault üzerinde ölçülmüş bir kusurun şeklidir.
//
// Ölçümün yarısı SUSTUKLARI: her müdahaleyi ödüllendiren bir ölçüt sistemi geveze yapar,
// ve dispatch'te bir kez bunun bedeli ödendi.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {look, score} = require('../notice.cjs');

const NOW = Date.parse('2026-09-11T12:00:00Z');
const DAY = 86400000;
const day = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);

async function vault(t, notes) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-notice-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const folder = path.join(root, 'vault');
  await fs.mkdir(folder);
  for (const [name, body] of Object.entries(notes)) await fs.writeFile(path.join(folder, name), body);
  return {folder, ledgerFile: path.join(root, 'ledger.json')};
}

const note = (kind, updated, body) => `---\ntags: [claudian]\ntür: ${kind}\ngüncellenme: ${updated}\n---\n\n${body}\n`;
const run = (place, extra = {}) => look({vault: place.folder, ledgerFile: place.ledgerFile, now: NOW, ...extra});

// ── Kalemin kendi yaşı ─────────────────────────────────────────────────────
//
// İlk ölçümde bir nottaki üç ayrı taahhüt aynı "24 gündür açık" ve aynı 0.90 aciliyetle
// çıkıyordu: yaş kalemin değil notun tarihinden geliyordu. Markdown'da kalem başına tarih
// yok, o yüzden uygulama kendi defterini tutar -- ve defter vault'a yazılmaz.
test('an item is only as old as the app has actually seen it', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(0), '- [ ] **Yeni bir iş** · bugün konuşuldu'),
  });

  const first = await run(place);
  assert.equal(first.candidates.length, 0, 'ilk görüşte bir şeyin eski olduğu iddia edilemez');
  assert.match(first.quiet.join(' '), /tolerans/, 've neden susulduğu yazılır');

  // Defter, kalemi on gün önce gördüğümüzü söylüyor.
  const topic = Object.keys(first.ledger)[0];
  await fs.writeFile(place.ledgerFile, JSON.stringify({[topic]: {firstSeen: NOW - 10 * DAY}}));

  const later = await run(place);
  assert.equal(later.candidates.length, 1);
  assert.match(later.candidates[0].why, /10 gündür açık/);
});

test('items in one note no longer share a single age', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(0), '- [ ] **Eski iş**\n- [ ] **Dünkü iş**'),
  });
  const seed = await run(place);
  const topics = Object.entries(seed.ledger);
  const ages = {[topics[0][0]]: {firstSeen: NOW - 40 * DAY}, [topics[1][0]]: {firstSeen: NOW - 1 * DAY}};
  await fs.writeFile(place.ledgerFile, JSON.stringify(ages));

  const out = await run(place);
  assert.equal(out.candidates.length, 1, 'yalnız gerçekten eski olan çıkar');
  assert.match(out.candidates[0].title, /Eski iş/);
});

// ── Tekilleştirme ──────────────────────────────────────────────────────────
test('one item never produces two nudges', async t => {
  const place = await vault(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Garanti başvurusu** · **13 Eylül 2026** · kutusu duruyor'),
  });
  const out = await run(place);
  const topics = out.candidates.map(c => c.topic);
  assert.equal(new Set(topics).size, topics.length, 'konu başına en fazla bir aday');
});

// ── Sıralama: yaş önem değildir ────────────────────────────────────────────
//
// "Komşuya kopya anahtar ver", bir projeyi tıkayan işle aynı aciliyette duruyordu.
test('connection breaks the tie between two equally old commitments', () => {
  const lonely = {urgency: 0.6, weight: 0};
  const connected = {urgency: 0.6, weight: 6};
  assert.ok(score(connected) > score(lonely), 'bağlı olan önce gelir');
  // Ama bağlılık aciliyetin yerine geçmez.
  const urgentAndLonely = {urgency: 0.95, weight: 0};
  assert.ok(score(urgentAndLonely) > score(connected), 'bağlılık aciliyeti ezmez');
});

// ── Susma vakaları ─────────────────────────────────────────────────────────
test('a date written in prose is not an obligation', async t => {
  const place = await vault(t, {
    'Reminders.md': note('ajanda', day(30), '13 Eylül 2026 tarihinde bir konser var, ama bu bir cümle.'),
  });
  const out = await run(place);
  assert.equal(out.candidates.length, 0, 'kendi alanında ilan edilmeyen tarih kalem değildir');
});

test('a closed item is not raised', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(30), '- [x] **Bitti** · **13 Eylül 2026**'),
  });
  assert.equal((await run(place)).candidates.length, 0);
});

test('a thing mentioned once is not a stale project', async t => {
  const place = await vault(t, {
    'Kısa Film.md': note('proje', day(120), 'Bir kez aklıma geldi.'),
    'Claudian Home.md': note('giriş', day(1), '[[Kısa Film]]'),
  });
  const out = await run(place);
  assert.equal(out.candidates.length, 0);
  assert.match(out.quiet.join(' '), /yalnız 1 yerden anılıyor/);
});

test('a project that is linked and untouched is raised, as a hypothesis', async t => {
  const place = await vault(t, {
    'Sera.md': note('proje', day(41), 'Kablolama yarım.'),
    'Claudian Home.md': note('giriş', day(1), '[[Sera]]'),
    'Control Panel.md': note('ajanda', day(1), 'Bak: [[Sera]]'),
    'Claudian Lessons.md': note('nöron', day(1), 'Ders: [[Sera]]'),
  });
  const out = await run(place);
  assert.equal(out.candidates.length, 1);
  assert.equal(out.candidates[0].producer, 'durgunluk');
  assert.equal(out.candidates[0].hypothesis, true, 'durgunluk bir bilgi değil bir sorudur');
});

// ── RT-1 ───────────────────────────────────────────────────────────────────
//
// Kayıtlı bir red tavsiye olarak geri dönmemeli. Burada ölçülen şey modelin davranışı
// değil, katmanın bu şekli görüp görmediği.
test('an approach recorded as rejected, now active again, is raised with its reason', async t => {
  const place = await vault(t, {
    'Claudian Decisions.md': note('nöron', day(30),
      '## Sulama yöntemi\n\n- **Aktif:** damla sulama\n- **Reddedilen:** yağmurlama — yaprakları küflendirdi'),
    'Atölye.md': note('nöron', day(6), '## Sulama yöntemi\n\n- **Aktif:** yağmurlama'),
  });
  const out = await run(place);
  const rt1 = out.candidates.find(c => c.producer === 'reddedilmiş yaklaşım');
  assert.ok(rt1, 'geri dönen red görülmeli: ' + out.candidates.map(c => c.producer).join(', '));
  assert.match(rt1.why, /küflendirdi/, 'gerekçe notta yazıyordu, aday onu taşımalı');
  assert.equal(out.candidates.find(c => c.producer === 'çelişki'), undefined,
    'bu bir çelişki değil, RT-1 -- iki kez bildirilmez');
});

test('two active decisions on one topic are raised as a conflict', async t => {
  const place = await vault(t, {
    'Claudian Decisions.md': note('nöron', day(30), '## Editör\n\n- **Aktif:** Vim'),
    'Notlar.md': note('nöron', day(6), '## Editör\n\n- **Aktif:** VS Code'),
  });
  const out = await run(place);
  assert.equal(out.candidates[0].producer, 'çelişki');
  assert.match(out.candidates[0].why, /Vim.*VS Code|VS Code.*Vim/);
});

// ── Klasör yoksa ───────────────────────────────────────────────────────────
test('a missing folder is reported, not thrown', async t => {
  const place = await vault(t, {});
  await fs.rm(place.folder, {recursive: true, force: true});
  const out = await run(place);
  assert.equal(out.missing, true);
  assert.deepEqual(out.candidates, []);
});

// ── Bedel ──────────────────────────────────────────────────────────────────
test('looking costs nothing but reading files', async t => {
  const place = await vault(t, {'Claudian Home.md': note('giriş', day(1), 'Boş.')});
  const before = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const out = await run(place);
    assert.equal(out.missing, false, 'anahtar olmadan da çalışır');
  } finally { if (before !== undefined) process.env.ANTHROPIC_API_KEY = before; }
});

// Regression scenario using synthetic data.
test('a date many notes share is a bulk edit, not a signal', async t => {
  const stamp = day(40);
  const notes = {'Claudian Home.md': note('giriş', day(1), '')};
  // Dört proje aynı tarihi taşıyor ve hepsi bolca anılıyor.
  for (const name of ['Bir', 'İki', 'Üç', 'Dört']) {
    notes[`${name}.md`] = note('proje', stamp, 'İçerik.');
    notes['Claudian Home.md'] = note('giriş', day(1),
      Object.keys(notes).filter(n => n !== 'Claudian Home.md').map(n => `[[${n.replace('.md', '')}]] [[${n.replace('.md', '')}]] [[${n.replace('.md', '')}]]`).join('\n'));
  }
  const place = await vault(t, notes);
  const out = await run(place);
  assert.equal(out.candidates.length, 0, 'dört ayrı aday tek bir toplu düzenlemeden üretilmez');
  assert.match(out.quiet.join(' '), /toplu düzenleme/);
});

test('a lone old date is still a signal', async t => {
  const place = await vault(t, {
    'Yalnız.md': note('proje', day(99), 'İçerik.'),
    'Claudian Home.md': note('giriş', day(1), '[[Yalnız]] [[Yalnız]] [[Yalnız]]'),
  });
  const out = await run(place);
  assert.equal(out.candidates.length, 1, 'kendi başına duran eski bir tarih hâlâ ölçülebilir');
  assert.equal(out.candidates[0].producer, 'durgunluk');
});

// Regression scenario using synthetic data.
test('an approximate date is read, but never treated as a hard due date', async t => {
  const place = await vault(t, {
    'Reminders.md': note('ajanda', day(30),
      '- [ ] **Kesin iş** · **13 Eylül 2026**\n- [ ] **Yaklaşık iş** · **~13 Eylül 2026**'),
  });
  const out = await run(place);
  const hard = out.candidates.find(c => /Kesin iş/.test(c.title));
  const soft = out.candidates.find(c => /Yaklaşık iş/.test(c.title));
  assert.ok(hard && soft, 'ikisi de görülmeli: ' + out.candidates.map(c => c.title).join(' | '));
  assert.equal(soft.hypothesis, true, 'yaklaşık olan bir hipotezdir');
  assert.ok(soft.urgency < hard.urgency, 'uydurulmuş bir kesinlik telefonu boşuna titretir');
  assert.match(soft.why, /yaklaşık/);
});

test('an approximate date that has passed is not called overdue', async t => {
  const place = await vault(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Geçmiş yaklaşık** · **~5 Eylül 2026**'),
  });
  const out = await run(place);
  assert.equal(out.candidates.length, 1);
  assert.doesNotMatch(out.candidates[0].title, /Vadesi geçti/, '~ ile yazılmış tarih geçmiş sayılmaz');
  assert.ok(out.candidates[0].urgency < 1);
});

// ── Düşen dayanak ──────────────────────────────────────────────────────────
//
// Ölçümde hâlâ düşen tek vaka buydu: model "sunum taslağını göndereyim mi?" sorusunda
// kararlar notunu OKUDU — sunum aracının dokuz gün önce değiştiği oradaydı — ve yine
// "Evet, gönder" dedi. Erişim düzelmişti, kullanım düzelmemişti. Bu bağlantı deterministik
// olarak kurulabilir; yani modelin kör noktası tam olarak motorun görebildiği yer.
test('an item standing on a decision that changed after it is raised', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(24), '- [ ] **Sunum aracı taslağını gönder**'),
    'Claudian Decisions.md': note('nöron', day(9),
      '## Sunum aracı\n\n- **Aktif:** kaydırak yerine tek sayfa PDF'),
  });
  const out = await run(place);
  const fallen = out.candidates.find(c => c.producer === 'düşen dayanak');
  assert.ok(fallen, 'görülmeli: ' + out.candidates.map(c => c.producer).join(', '));
  assert.match(fallen.why, /9 gün önce/);
  assert.match(fallen.why, /tek sayfa PDF/, 'yeni değer gerekçede geçmeli');
  assert.equal(fallen.evidence.length, 2, 'iki taraf da kanıt olarak taşınır');
});

test('a decision older than the item it supports is not a fallen basis', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(5), '- [ ] **Sunum aracı taslağını gönder**'),
    'Claudian Decisions.md': note('nöron', day(40), '## Sunum aracı\n\n- **Aktif:** tek sayfa PDF'),
  });
  const out = await run(place);
  assert.equal(out.candidates.find(c => c.producer === 'düşen dayanak'), undefined);
  assert.match(out.quiet.join(' '), /kalemden sonra değişmemiş/);
});

test('an item that does not name the decision is left alone', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(24), '- [ ] **Komşuya kopya anahtar ver**'),
    'Claudian Decisions.md': note('nöron', day(9), '## Sunum aracı\n\n- **Aktif:** tek sayfa PDF'),
  });
  const out = await run(place);
  assert.equal(out.candidates.find(c => c.producer === 'düşen dayanak'), undefined,
    'ilgisiz bir kalem, değişen her kararla eşleştirilmez');
});

// ── Teslim: vault'a yazma ──────────────────────────────────────────────────
//
// Kullanıcının kendi paneline değil, ayrı bir nota yazılır. Sebebi tek cümle: o notun
// içindeki her satırı uygulama koydu, ve bir gün silmek istediğinde silmesi gereken tek
// şey o dosya olmalı.
test('candidates are written to a note of their own, never into the user panel', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(30), '- [ ] **Kullanıcının kendi kalemi**'),
  });
  const before = await fs.readFile(path.join(place.folder, 'Control Panel.md'), 'utf8');
  const out = await run(place, {});
  await look({vault: place.folder, ledgerFile: place.ledgerFile, now: NOW});
  const {deliver} = require('../notice.cjs');
  const written = await deliver({vault: place.folder, language: 'tr', candidates: out.candidates, now: NOW});

  assert.equal(written.note, 'Claudian Fark ettikleri.md');
  assert.equal(await fs.readFile(path.join(place.folder, 'Control Panel.md'), 'utf8'), before,
    'kullanıcının kendi notu değişmez');
});

test('the note it writes is not read back as input', async t => {
  const {deliver} = require('../notice.cjs');
  const place = await vault(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Gerçek kalem** · **13 Eylül 2026**'),
  });
  const first = await run(place);
  await deliver({vault: place.folder, language: 'tr', candidates: first.candidates, now: NOW});

  // Yazdığı not girdiye girseydi kendi kalemlerini yeniden fark eder ve her turda büyürdü.
  const second = await run(place);
  assert.equal(second.candidates.length, first.candidates.length,
    'ikinci tur birinciyle aynı sayıda aday üretmeli, yankı olmamalı');
});

test('an unchanged result does not rewrite the file', async t => {
  const {deliver} = require('../notice.cjs');
  const place = await vault(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Kalem** · **13 Eylül 2026**'),
  });
  const out = await run(place);
  const first = await deliver({vault: place.folder, language: 'tr', candidates: out.candidates, now: NOW});
  const again = await deliver({vault: place.folder, language: 'tr', candidates: out.candidates, now: NOW});

  assert.equal(first.changed, true);
  assert.equal(again.changed, false,
    'her turda dosyaya dokunmak Obsidian geçmişini şişirir ve durgunluk ölçüsünü kirletir');
});

test('every written line carries why it is there', async t => {
  const {deliver} = require('../notice.cjs');
  const place = await vault(t, {
    'Reminders.md': note('ajanda', day(30), '- [ ] **Garanti** · **13 Eylül 2026** · kutusu duruyor'),
  });
  const out = await run(place);
  await deliver({vault: place.folder, language: 'tr', candidates: out.candidates, now: NOW});
  const written = await fs.readFile(path.join(place.folder, 'Claudian Fark ettikleri.md'), 'utf8');

  assert.match(written, /- Neden:/, 'gerekçesiz bir satır yazılmaz');
  assert.match(written, /- Kanıt:/, 'kanıt taşınır');
  assert.match(written, /- Üretici:/, 'hangi üreticiden geldiği yazılır');
  assert.match(written, /^tür: ajanda$/m, 'iskeletin frontmatter düzenine uyar');
});

test('an empty result does not create the note, but does clear an existing one', async t => {
  const {deliver} = require('../notice.cjs');
  const place = await vault(t, {'Claudian Home.md': note('giriş', day(1), 'Boş.')});

  const first = await deliver({vault: place.folder, language: 'tr', candidates: [], now: NOW});
  assert.equal(first.changed, false);
  assert.ok(!(await fs.readdir(place.folder)).includes('Claudian Fark ettikleri.md'),
    'boş bir vault her oturumda okunacak boş bir dosya kazanmaz');

  await deliver({vault: place.folder, language: 'tr', now: NOW,
    candidates: [{title: 'Bir şey', why: 'çünkü', evidence: ['x.md'], producer: 'zaman', origin: 'monitors.ts'}]});
  const cleared = await deliver({vault: place.folder, language: 'tr', candidates: [], now: NOW});
  assert.equal(cleared.changed, true, 'var olan bir liste bayat bırakılmaz');
  assert.match(await fs.readFile(path.join(place.folder, 'Claudian Fark ettikleri.md'), 'utf8'), /fark edilen bir şey yok/);
});

// ── Tekilleştirme, kalem düzeyinde ─────────────────────────────────────────
//
// "Tek kalem, tek aday" kuralı kâğıt üzerinde kalmıştı: tekilleştirme konu anahtarına
// bakıyordu ve aynı kalem için taahhüt `item|...`, düşen dayanak `basis|...` üretiyordu.
// İkisi de geçiyordu. Önceki test yalnız anahtarların tekilliğini ölçtüğü için görmedi --
// ölçtüğü şey doğruydu ama sorduğu soru yanlıştı.
test('two producers about one item yield one candidate', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(24), '- [ ] **Sunum aracı taslağını gönder**'),
    'Claudian Decisions.md': note('nöron', day(9), '## Sunum aracı\n\n- **Aktif:** tek sayfa PDF'),
  });
  const out = await run(place);
  const about = out.candidates.filter(c => /Sunum aracı taslağını/.test(c.title));
  assert.equal(about.length, 1, 'tek iş, tek dürtme: ' + out.candidates.map(c => c.producer).join(', '));
  assert.match(out.quiet.join(' '), /tekil ·/);
});

// ── Hangi aday kalır ───────────────────────────────────────────────────────
//
// Aciliyete göre seçmek "24 gündür açık" adayını tutup "dayanağı değişmiş olabilir"
// adayını eliyordu. Birincisi kullanıcının panelinde zaten görünüyor; ikincisi iki ayrı
// notu birleştirmeden görülemez -- yani katmanın var olma sebebi.
test('the candidate that crosses notes wins over the one already visible in a panel', async t => {
  const place = await vault(t, {
    'Control Panel.md': note('ajanda', day(24), '- [ ] **Sunum aracı taslağını gönder**'),
    'Claudian Decisions.md': note('nöron', day(9), '## Sunum aracı\n\n- **Aktif:** tek sayfa PDF'),
  });
  const out = await run(place);
  const kept = out.candidates.find(c => /Sunum aracı taslağını/.test(c.title));
  assert.equal(kept.producer, 'düşen dayanak',
    'tek notta görünmeyen şey, zaten görünen şeye tercih edilir');
  assert.ok(kept.evidence.length > 1, 'iki notu birleştiren aday iki kanıt taşır');
});

test('informativeness does not override a genuinely urgent single-note item', () => {
  const {informative} = require('../notice.cjs');
  const overdue = {urgency: 1, weight: 3, evidence: ['a.md']};
  const crossing = {urgency: 0.7, weight: 3, evidence: ['a.md', 'b.md']};
  // Kesişen aday öne geçer, ama bu yalnız AYNI kalem içindeki seçim için geçerli --
  // sıralama hâlâ score() ile yapılır ve orada aciliyet baskındır.
  assert.ok(informative(crossing) > informative(overdue), 'aynı kalem içinde kesişen kazanır');
  assert.ok(require('../notice.cjs').score(overdue) > require('../notice.cjs').score(crossing),
    'ama listede sıralama hâlâ aciliyete göre');
});

// ── Giriş haritasından bağlanma ────────────────────────────────────────────
//
// Not diskte duruyordu, skill onu giriş okumasında sayıyordu, ve üç ayrı oturumun hiçbiri
// açmadı. Sebep: model önce Home'u okuyor ve "Açık uçlar" altındaki bağlantıları izliyor;
// Home'un hiç anmadığı bir dosyayı aramıyor. Bağlandıktan sonra altı koşunun dördü okudu.
test('the first time it writes, it links itself from the entry map', async t => {
  const {deliver} = require('../notice.cjs');
  const place = await vault(t, {
    'Claudian Home.md': note('giriş', day(1), '# Hafıza\n\n## Açık uçlar\n\n[[Control Panel|Açık konular]]\n\n## Nöronlar\n'),
    'Reminders.md': note('ajanda', day(30), '- [ ] **Kalem** · **13 Eylül 2026**'),
  });
  const out = await run(place);
  await deliver({vault: place.folder, language: 'tr', candidates: out.candidates, now: NOW});

  const home = await fs.readFile(path.join(place.folder, 'Claudian Home.md'), 'utf8');
  assert.match(home, /\[\[Claudian Fark ettikleri\|/, 'harita nota bağlanır');
  assert.match(home, /Claudian Fark ettikleri\|.*\] · \[\[Control Panel/,
    'var olan bağlantıların yanına girer, kendi satırını açmaz');
});

test('the link is offered once, not restored after the user removes it', async t => {
  const {deliver} = require('../notice.cjs');
  const place = await vault(t, {
    'Claudian Home.md': note('giriş', day(1), '# Hafıza\n\n## Açık uçlar\n\n[[Control Panel|Açık konular]]\n'),
    'Reminders.md': note('ajanda', day(30), '- [ ] **Kalem** · **13 Eylül 2026**'),
  });
  const out = await run(place);
  await deliver({vault: place.folder, language: 'tr', candidates: out.candidates, now: NOW});

  // Kullanıcı bağlantıyı siliyor.
  const home = path.join(place.folder, 'Claudian Home.md');
  const cleaned = (await fs.readFile(home, 'utf8')).replace(/\[\[Claudian Fark ettikleri\|[^\]]*\]\] · /, '');
  await fs.writeFile(home, cleaned);

  // İçerik değişsin ki deliver yeniden yazsın.
  await deliver({vault: place.folder, language: 'tr', now: NOW,
    candidates: [...out.candidates, {title: 'Yeni', why: 'x', evidence: ['a.md'], producer: 'zaman', origin: 'monitors.ts'}]});
  assert.doesNotMatch(await fs.readFile(home, 'utf8'), /Claudian Fark ettikleri/,
    'bir kez sunulur; silinen bir satırı geri koymak kullanıcının kararını geçersiz saymaktır');
});

// Olculdu 12.09.2026, sentetik vault uzerinde: kalemin yasi yalnizca notun degistirilme
// tarihinden aliniyordu. Panele tek bir satir eklemek, icindeki butun kalemleri "bugun
// acilmis" yapiyor ve hem taahhut hem dusen dayanak susuyordu -- yani paneli kullanmak,
// panelin fark etme yetenegini siliyordu. Satir kendi acilis tarihini ilan ediyorsa
// dogru olan odur.
test('editing the panel does not reset the age of the items in it', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-age-'));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  const NL = String.fromCharCode(10);
  const today = '2026-09-12';
  await fs.writeFile(path.join(folder, 'Control Panel.md'),
    '---' + NL + 'güncellenme: ' + today + NL + '---' + NL + NL +
    '# Açık konular' + NL + NL +
    '- [ ] **Vana rölesini dene** · açıldı: 2026-06-28' + NL +
    '- [ ] **Bugün açılan iş** · açıldı: ' + today + NL);

  const seen = await look({
    vault: folder,
    ledgerFile: path.join(folder, '..', 'ledger-' + Date.now() + '.json'),
    now: Date.parse(today + 'T12:00:00Z'),
  });
  const old = seen.candidates.find(c => c.title.includes('Vana rölesini dene'));
  assert.ok(old, 'iki buçuk aydır açık kalem görülmeli: ' +
    seen.candidates.map(c => c.producer + '/' + c.title).join(' | '));
  assert.match(old.why, /gündür açık/);
  assert.ok(!seen.candidates.some(c => c.title.includes('Bugün açılan iş')),
    'bugün açılmış bir iş için henüz bir şey söylenmez');
});
