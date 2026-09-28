'use strict';

/*
  Vakti geçen hatırlatıcı kapanır (1.5.0 · 28.09.2026).

  Boran: "hatırlatıcılarda da bir hatırlatmayı yaptıktan sonra işaretle ki sanki hala yapılması gerekilen bir şeymiş
  gibi kalmasın." Telefon saatli kalemi 30 dakika önce, saatsiz kalemi o sabah hatırlatır; takvim aboneliği de aynı
  listeden alarm kurar. Hatırlatma yapıldıktan sonra kutu açık kalırsa not, hâlâ yapılacak bir iş varmış gibi okunur.

  Kural: saatli kalem saati gelince, saatsiz kalem günü bitince "- [x] … — vakti geçti, hatırlatıldı." olur. Bu
  "yapıldı" demek değildir; yapılıp yapılmadığı kayıtlı değildir. Kalem yerinde kalır (taşınmaz, silinmez); arşiv
  bölümüne (Kapanan) dokunulmaz. Telefonda "Yarın tekrar" denen kalemin tarihi zaten ileri alınmıştır, kapanmaz.
*/

const AYLAR = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ITEM = /^- \[ \] \*\*(.+?)\*\*.*?· \*\*~?(\d{1,2}) (\S+) (\d{4})\*\*/;
const HOUR = /· saat (\d{2}):(\d{2})\s*$/;
const ARCHIVE = /^## (kapanan|closed|done)\s*$/i;
const MARK = {tr: ' — **vakti geçti, hatırlatıldı.**', en: ' — **time passed, reminded.**'};

function monthIndex(name) {
  const n = String(name).toLocaleLowerCase('tr');
  const i = AYLAR.indexOf(n);
  return i >= 0 ? i : MONTHS.indexOf(n.toLowerCase());
}

/** Kalemin kapanma anı: saatliyse o saat, saatsizse günün bittiği an. Tarih okunamazsa null. */
function dueMoment(line) {
  const m = ITEM.exec(line);
  if (!m) return null;
  const month = monthIndex(m[3]);
  if (month < 0) return null;
  const day = Number(m[2]), year = Number(m[4]);
  if (new Date(year, month, day).getDate() !== day) return null; // 31 Eylül gibi olmayan gün
  const hour = HOUR.exec(m[1]);
  const at = hour ? new Date(year, month, day, Number(hour[1]), Number(hour[2])) : new Date(year, month, day + 1, 0, 0);
  return {at, title: m[1].replace(HOUR, '').replace(/[\s·]+$/, '')};
}

/** Vakti geçen açık kalemleri işaretler. {body, closed: [başlık]} — değişiklik yoksa closed boş ve body aynı. */
function closeDue(body, now = new Date(), language = 'tr') {
  const lines = body.split('\n');
  const closed = [];
  let archived = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (/^## /.test(line)) archived = ARCHIVE.test(line.trim());
    if (archived) continue;
    const due = dueMoment(line);
    if (!due || now < due.at) continue;
    const cr = lines[i].endsWith('\r') ? '\r' : '';
    lines[i] = line.replace(/^- \[ \]/, '- [x]') + (/hatırlatıldı|reminded/.test(line) ? '' : MARK[language] || MARK.tr) + cr;
    closed.push(due.title);
  }
  return {body: closed.length ? lines.join('\n') : body, closed};
}

/*
  Telefon bildirimindeki düğmeler (1.5.0). Kalem, motorun /v1/hatirlaticilar listesindeki kimliğiyle bulunur:
  sha1("YYYY-AA-GG|metin") ilk 16 hane — metin kalın yazının saat eki atılmış hâli (laya-kapi sunucu.py ile aynı).
*/
const crypto = require('crypto');
const AYLAR_BUYUK = AYLAR.map(a => a.charAt(0).toLocaleUpperCase('tr') + a.slice(1));
const pad = n => String(n).padStart(2, '0');

function reminderId(line) {
  const m = ITEM.exec(String(line).replace(/\r$/, ''));
  if (!m) return null;
  const month = monthIndex(m[3]);
  if (month < 0) return null;
  const iso = `${m[4]}-${pad(month + 1)}-${pad(Number(m[2]))}`;
  let text = m[1];
  const hour = /· saat (\d{2}:\d{2})\s*$/.exec(text);
  if (hour) text = text.slice(0, hour.index).replace(/[ ·]+$/, '');
  return crypto.createHash('sha1').update(`${iso}|${text}`, 'utf8').digest('hex').slice(0, 16);
}

/** "yapildi": kalem kapanır. "yarin": tarihi yarına alınır (saati korunur). Bulunamazsa hata. */
function applyAction(body, id, action, now = new Date()) {
  if (!/^[0-9a-f]{16}$/.test(String(id)) || !['yapildi', 'yarin'].includes(action)) throw Error('Kimlik ya da işlem geçersiz.');
  const lines = body.split('\n');
  let archived = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (/^## /.test(line)) archived = ARCHIVE.test(line.trim());
    if (archived || reminderId(line) !== id) continue;
    const cr = lines[i].endsWith('\r') ? '\r' : '';
    if (action === 'yapildi') {
      lines[i] = line.replace(/^- \[ \]/, '- [x]') + ` — **yapıldı (telefondan, ${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}).**` + cr;
      return {body: lines.join('\n'), date: null};
    }
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    lines[i] = line.replace(/· \*\*~?\d{1,2} \S+ \d{4}\*\*/, `· **${t.getDate()} ${AYLAR_BUYUK[t.getMonth()]} ${t.getFullYear()}**`) + cr;
    return {body: lines.join('\n'), date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`};
  }
  throw Error("Bu hatırlatıcı vault'ta artık açık değil.");
}

module.exports = {closeDue, dueMoment, reminderId, applyAction};
