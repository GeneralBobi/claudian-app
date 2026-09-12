'use strict';
/**
 * Fark etme turu: bak → vault'a yaz → gerekiyorsa bir kez dürt.
 *
 * Bu bir ajan oturumu değil, sıradan uygulama kodu. Hiçbir zaman izin sormaz, çünkü soracak
 * bir merci yok — [[Claudian Dispatcher]]'da bir kez ölçülen şey buydu: sohbet ürünü üstüne
 * kurulan bir "sürekli çalışan ajan", durumu diske yazmak zorunda kaldığı anda izin kapısına
 * çarpar ve döngü özerk olamaz. Çözüm bir ayar değil, bir mimari.
 *
 * ── Dürtme disiplini, vault'un kendi kayıtlarından ────────────────────────
 *
 * "Sıklık sorun değil, tekrar sorun." Bir konu, kendisi kıpırdamadan ikinci kez açılmaz.
 *
 * "Telefon tarih içindir." Hipotezler — durgunluk, yaklaşık tarih — titretmez; panele/nota
 * düşer. Titreten şey yalnız kesin ve yaklaşmış bir yükümlülük ya da bir çelişki.
 *
 * "Sessizlik varsayılan değildir" kuralı burada geçerli DEĞİL: o kural sohbet içindir.
 * Buradaki dürtme, kullanıcı hiçbir yere bakmazken kesilen bir sessizliktir ve bedeli
 * yüksektir; o yüzden eşik yüksek tutulur.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const notice = require('./notice.cjs');

const HOUR = 3600000;

/** Bir aday telefonu titretmeyi hak ediyor mu. */
function worthInterrupting(candidate) {
  if (candidate.hypothesis) return false;          // "belki bakmalısın" bir bildirim değildir
  return candidate.urgency >= 0.7;
}

/**
 * Tek bir tur.
 *
 * @param {object} input
 * @param {string} input.vault
 * @param {string} input.ledgerFile   ilk-görülme ve dürtme defteri; vault'un DIŞINDA
 * @param {string} [input.language]
 * @param {function} [input.notify]   ({title, body}) => void — enjekte edilir ki test Electron istemesin
 * @param {number} [input.now]
 * @param {number} [input.quietHours] iki dürtme arasındaki en az süre
 */
async function tick({ vault, ledgerFile, language = 'en', notify = null, now = Date.now(), quietHours = 4 }) {
  const seen = await notice.look({ vault, ledgerFile, now });
  if (seen.missing) return { missing: true, wrote: false, notified: null };

  const written = await notice.deliver({ vault, language, candidates: seen.candidates, now });

  // Defter: ilk-görülme taze turdan, dürtme geçmişi eskisinden. İkisi ayrı bilgi.
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(ledgerFile, 'utf8')); } catch { previous = {}; }
  const ledger = {};
  for (const [topic, value] of Object.entries(seen.ledger)) {
    ledger[topic] = { ...value, notifiedAt: previous[topic]?.notifiedAt ?? null };
  }
  // Artık görülmeyen konuların dürtme kaydı da düşer: kalem kapandıysa geçmişi tutmanın
  // anlamı yok ve defter süresiz büyümemeli.
  for (const candidate of seen.candidates) {
    if (!ledger[candidate.topic]) {
      ledger[candidate.topic] = { firstSeen: previous[candidate.topic]?.firstSeen ?? now,
        notifiedAt: previous[candidate.topic]?.notifiedAt ?? null };
    }
  }

  let notified = null;
  if (notify) {
    const lastAny = Math.max(0, ...Object.values(previous).map(v => v?.notifiedAt || 0));
    const quiet = now - lastAny < quietHours * HOUR;
    // Turda en fazla bir dürtme. Bir listeyi bildirime sığdırmaya çalışmak, bildirimin
    // tasiyamadigi gövdeyi başlığa sıkıştırmak demektir; o bir kez denendi ve taklit oldu.
    const candidate = seen.candidates.find(c =>
      worthInterrupting(c) && !ledger[c.topic]?.notifiedAt);
    if (candidate && !quiet) {
      notify({ title: candidate.title, body: candidate.why });
      ledger[candidate.topic] = { ...ledger[candidate.topic], notifiedAt: now };
      notified = candidate.topic;
    }
  }

  await fs.mkdir(path.dirname(ledgerFile), { recursive: true });
  await fs.writeFile(ledgerFile, JSON.stringify(ledger, null, 1));

  return { missing: false, wrote: written.changed, note: written.note,
    candidates: seen.candidates.length, notified };
}

module.exports = { tick, worthInterrupting };
