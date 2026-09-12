'use strict';
// Local connector implementation. Scope and ownership are checked before changes.
const path = require('node:path');

const posix = value => path.resolve(value).split(String.fromCharCode(92)).join('/');
const MODE = 'sandbox_mode = "workspace-write"';
const MARK = '# Claudian: the selected memory folder stays writable from any working directory.';

/** Bölümün gövdesi: başlıktan bir sonraki `[bölüm]` başlığına kadar. */
function sectionBody(text, name) {
  const heading = new RegExp('^[ \\t]*\\[' + name + '\\][ \\t]*$', 'm').exec(text);
  if (!heading) return null;
  const from = heading.index + heading[0].length;
  const next = /^[ \t]*\[[^\]]+\][ \t]*$/m.exec(text.slice(from));
  return { from, to: next ? from + next.index : text.length, body: text.slice(from, next ? from + next.index : text.length) };
}

/**
 * @returns {{content:string}|{satisfied:true}|{manual:string}}
 *   content   — yazılacak yeni yapılandırma
 *   satisfied — zaten doğru, dokunma
 *   manual    — güvenle düzenlenemiyor, kullanıcıya söyle
 */
function codexGrant(previous, vault) {
  let text = previous || '';
  const target = posix(vault);
  const quoted = ['"' + target + '"', "'" + target + "'"];

  // 1 — Sanal alan kipi. Bu olmadan kökler ölü harf.
  const hasMode = /^[ \t]*sandbox_mode[ \t]*=/m.test(text);
  const modeIsWrite = /^[ \t]*sandbox_mode[ \t]*=[ \t]*["'](workspace-write|danger-full-access)["']/m.test(text);
  if (hasMode && !modeIsWrite) {
    // Kullanıcı bilerek read-only seçmiş olabilir; sessizce değiştirmek onun kararını ezer.
    return { manual: `Codex: ~/.codex/config.toml içindeki sandbox_mode değerini "workspace-write" yapın, yoksa not klasörüne yazamaz.` };
  }

  const section = sectionBody(text, 'sandbox_workspace_write');
  const rootsHere = section && quoted.some(q => section.body.includes(q));

  if (modeIsWrite && rootsHere) return { satisfied: true };

  // 2 — Kökler.
  if (!section) {
    text = (text && !text.endsWith('\n') ? text + '\n' : text) +
      '\n' + MARK + '\n[sandbox_workspace_write]\nwritable_roots = ["' + target + '"]\n';
  } else if (!rootsHere) {
    const line = /^[ \t]*writable_roots[ \t]*=[ \t]*\[([^\]]*)\]/m.exec(section.body);
    if (!line) {
      return { manual: `Codex: ~/.codex/config.toml içindeki [sandbox_workspace_write] bölümüne writable_roots = ["${target}"] ekleyin.` };
    }
    const inner = line[1].trim();
    const replaced = line[0].replace(/\[([^\]]*)\]/, '[' + (inner ? inner.replace(/,\s*$/, '') + ', ' : '') + '"' + target + '"]');
    text = text.slice(0, section.from) + section.body.replace(line[0], replaced) + text.slice(section.to);
  }

  // 3 — Kipi ekle. Bölüm başlıklarından ÖNCE olmalı: TOML'de bir anahtar, kendinden
  // önceki en yakın başlığın tablosuna aittir; sona eklemek onu o tablonun içine sokar.
  if (!hasMode) {
    const firstHeading = /^[ \t]*\[[^\]]+\][ \t]*$/m.exec(text);
    // İşaret yalnız bir kez: bölüm de eklendiyse yorum zaten metinde.
    const insertion = (text.includes(MARK) ? '' : MARK + '\n') + MODE + '\n\n';
    text = firstHeading
      ? text.slice(0, firstHeading.index) + insertion + text.slice(firstHeading.index)
      : (text && !text.endsWith('\n') ? text + '\n' : text) + insertion;
  }

  return { content: text };
}

module.exports = { codexGrant, sectionBody };
