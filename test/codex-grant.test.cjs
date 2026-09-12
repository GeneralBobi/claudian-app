'use strict';
// Codex'e verilen yazma izni.
//
// 12.09.2026'da gerçek bir oturumda ölçüldü. Uygulama profilde "erişim verildi" yazıyordu;
// Codex ise not klasörünü okuyup şunu söylüyordu:
//
//   "Oturum yalnızca okuma iznine sahip olduğundan yanıt dosyasına yazamadım."
//
// Sebep: izin yalnız `writable_roots` yazıyordu. Codex'in varsayılan sanal alanı read-only
// ve o kipte kökler hiçbir şey ifade etmiyor. Aynı yönerge `--sandbox workspace-write` ile
// hemen yazdı; `sandbox_mode` yapılandırmaya konduğunda bayraksız da yazdı.
//
// Doğrulamanın sonsuza kadar beklemesinin sebebi buydu: AI sorunu açıkça söylüyor, uygulama
// yalnız dosyaya bakıyor ve cevabı hiç duymuyordu.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {codexGrant, sectionBody} = require('../codex-grant.cjs');

const VAULT = 'C:' + String.fromCharCode(92) + 'Vault' + String.fromCharCode(92) + 'Notlar';
const POSIX = 'C:/Vault/Notlar';

test('an empty configuration gets both the mode and the roots', () => {
  const {content} = codexGrant('', VAULT);
  assert.match(content, /sandbox_mode = "workspace-write"/,
    'kipsiz bir izin yazmak, izin vermemekle aynı şey');
  assert.ok(content.includes('writable_roots = ["' + POSIX + '"]'), 'kökler de yazılır');
  assert.equal((content.match(/# Claudian: the selected/g) || []).length, 1,
    'işaret bir kez yazılır');
});

test('the mode is written above the first table heading', () => {
  // TOML'de bir anahtar, kendinden önceki en yakın başlığın tablosuna aittir. Sona eklemek
  // `sandbox_mode`'u [sandbox_workspace_write] tablosunun İÇİNE sokar ve etkisiz kalır.
  const existing = 'model = "x"\n\n[windows]\nsandbox = "elevated"\n';
  const {content} = codexGrant(existing, VAULT);
  assert.ok(content.indexOf('sandbox_mode') < content.indexOf('[windows]'),
    'kip bir tablonun içine düşerse hiçbir şey yapmaz');
});

test('a configuration that already lists the vault only gains the mode', () => {
  // Regression case: kökler doğruydu, kip yoktu, ve eski kod
  // tümden vazgeçip kullanıcıyı elle adıma gönderiyordu.
  const existing = '[sandbox_workspace_write]\nwritable_roots = ["' + POSIX + '"]\n';
  const result = codexGrant(existing, VAULT);
  assert.ok(result.content, 'elle adıma düşmez: ' + JSON.stringify(result));
  assert.match(result.content, /sandbox_mode = "workspace-write"/);
  assert.equal((result.content.match(/writable_roots/g) || []).length, 1,
    'var olan kökler ikinci kez yazılmaz');
});

test('an already complete configuration is left alone', () => {
  const first = codexGrant('', VAULT).content;
  const again = codexGrant(first, VAULT);
  assert.equal(again.satisfied, true, 'doğru olan bir dosyaya her turda dokunulmaz');
  assert.equal(again.content, undefined);
});

test('another folder is added beside the one already there', () => {
  const existing = '[sandbox_workspace_write]\nwritable_roots = ["C:/Baska/Yer"]\n';
  const {content} = codexGrant(existing, VAULT);
  assert.ok(content.includes('"C:/Baska/Yer"'), 'kullanıcının kendi kökü korunur');
  assert.ok(content.includes('"' + POSIX + '"'), 'yeni kök yanına eklenir');
});

test('a deliberate read-only choice is reported, never overwritten', () => {
  const result = codexGrant('sandbox_mode = "read-only"\n', VAULT);
  assert.ok(result.manual, 'kullanıcının açık kararı sessizce ezilmez');
  assert.match(result.manual, /workspace-write/, 'ne yapılacağını söyler');
});

test('danger-full-access counts as writable and is not downgraded', () => {
  const existing = 'sandbox_mode = "danger-full-access"\n[sandbox_workspace_write]\nwritable_roots = ["' + POSIX + '"]\n';
  assert.equal(codexGrant(existing, VAULT).satisfied, true);
});

test('a section is read to its own end, not into the next one', () => {
  const text = '[a]\nx = 1\n\n[sandbox_workspace_write]\nwritable_roots = ["p"]\n\n[b]\ny = 2\n';
  const section = sectionBody(text, 'sandbox_workspace_write');
  assert.match(section.body, /writable_roots/);
  assert.doesNotMatch(section.body, /y = 2/, 'komşu tablo bu bölümün içine sayılmaz');
});
