'use strict';

/*
  Kaydın bağlamı (1.5.0 · 28.09.2026). Motor, kaydın saatine denk gelen dersleri, etkinlikleri ve randevuları
  kullanıcının kendi vault'undan çıkarır; yazıcı içeriği örtüşeni seçer (laya-kapi/baglam.py). Bu dosya seçilen
  bağlamı nota ve bağlamın kendi notuna işler:

  - Yüzük notu: frontmatter'da `ders:` ya da `etkinlik:` bağlantısı, başlığın altında "**Ders:** [[…]] · saat · hoca".
  - Ders/etkinlik notu: "## Ders kayıtları" (ya da "## Kayıtlar", "## Oturumlar") tablosuna o kaydın satırı.
  - Randevu: hatırlatıcı satırının altına "→ kayıt: [[…]]".

  Bağlamdaki metinler vault'tan gelir ama notu bir yazıcı seçti: bağlantı hedefi yalnız vault'ta gerçekten var olan
  bir nota işaret ediyorsa yazılır; diğer alanlar düz metne indirgenir.
*/

const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const BOLUM = /^## (Ders kayıtları|Kayıtlar|Oturumlar|Lecture recordings|Recordings|Sessions)\s*$/;

/** Düz metin: satır sonu yok, bağlantı ve tablo kıran işaret yok. */
function plain(s, max = 200) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[[\]|<>`#^]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Bağlantı hedefi: vault'a göre uzantısız yol; '..', mutlak yol ve bağlantı kıran karakter yok. */
function target(p) {
  const s = String(p ?? '').replace(/\\/g, '/').trim();
  if (!s || s.length > 240 || /[[\]|#^\r\n]/.test(s) || s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').some(x => x === '..' || x === '.' || !x)) return null;
  return s;
}

function kindLabel(tur, language) {
  const tr = {ders: 'Ders', etkinlik: 'Etkinlik', hatirlatici: 'Bağlam'};
  const en = {ders: 'Course', etkinlik: 'Event', hatirlatici: 'Context'};
  return (language === 'en' ? en : tr)[tur] || null;
}

/** Notun frontmatter'ına girecek satır (yalnız ders ve etkinlik bir nota bağlanır). */
function frontmatterLine(ctx) {
  const t = ctx && target(ctx.not);
  if (!t || !['ders', 'etkinlik'].includes(ctx.tur)) return null;
  return `${ctx.tur}: "[[${t}]]"`;
}

/** Başlığın altındaki bağlam satırı. */
function contextLine(ctx, language = 'tr') {
  if (!ctx || !kindLabel(ctx.tur, language)) return null;
  const t = target(ctx.not);
  const name = plain(ctx.ad, 160);
  if (!name) return null;
  const head = t ? `[[${t}|${name}]]` : name;
  const parts = [head, plain(ctx.zaman, 80)];
  if (ctx.tur === 'ders' && ctx.hoca) parts.push(plain(ctx.hoca, 120));
  return `**${kindLabel(ctx.tur, language)}:** ${parts.filter(Boolean).join(' · ')}`;
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
}

/**
 * Ders ya da etkinlik notunun kayıt tablosuna satır ekler. Tablo yoksa bölümün altına kurar; bölüm yoksa notun sonuna
 * "## Kayıtlar" açar. Aynı kayıt bağlantısı zaten varsa notu değiştirmez (null döner).
 */
function addRecordRow(body, {date, time, heading, link}) {
  if (body.includes(`[[${link}]]`)) return null;
  const lines = body.split('\n');
  const title = plain(heading, 120);
  const row = n => {
    const cells = n >= 4 ? [date, time, title, `[[${link}]]`] : n === 3 ? [date, title, `[[${link}]]`] : [`${date} · ${title}`, `[[${link}]]`];
    while (cells.length < n) cells.splice(cells.length - 1, 0, '');
    return `| ${cells.join(' | ')} |`;
  };
  const fresh = ['| Tarih | Konu | Not |', '|---|---|---|', row(3)];
  let start = lines.findIndex(l => BOLUM.test(l.trim()));
  if (start < 0) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return [...lines, '', '## Kayıtlar', '', ...fresh, ''].join('\n');
  }
  let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end);
  const lastRow = section.map((l, i) => (l.trim().startsWith('|') ? i : -1)).filter(i => i >= 0).pop();
  if (lastRow !== undefined) {
    const header = section.find(l => l.trim().startsWith('|'));
    const n = Math.max(2, tableCells(header).length);
    lines.splice(start + 1 + lastRow + 1, 0, row(n));
    return lines.join('\n');
  }
  // Bölüm var, tablo yok: "Henüz yok." gibi yer tutucu satır tablonun yerine geçer.
  const placeholder = section.findIndex(l => /^(henüz yok|none yet)\.?$/i.test(l.trim()));
  if (placeholder >= 0) {
    lines.splice(start + 1 + placeholder, 1, ...fresh);
  } else {
    lines.splice(start + 1, 0, '', ...fresh);
  }
  return lines.join('\n');
}

/** Hatırlatıcı satırının altına kaydın bağlantısı. Satır bulunamazsa ya da bağlantı varsa null. */
function linkReminder(body, name, link) {
  const wanted = String(name || '').trim();
  if (!wanted || wanted.endsWith('…') || body.includes(`[[${link}]]`)) return null;
  const lines = body.split('\n');
  const i = lines.findIndex(l => /^- \[[ xX]\] \*\*/.test(l) && l.includes(`**${wanted}`));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && /^\s{2,}\S/.test(lines[j])) j++;
  lines.splice(j, 0, `  → kayıt: [[${link}]]`);
  return lines.join('\n');
}

function dayLabel(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${GUN_KISA[d.getDay()]}`;
}

module.exports = {plain, target, frontmatterLine, contextLine, addRecordRow, linkReminder, dayLabel};
