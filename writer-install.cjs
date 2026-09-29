'use strict';

/*
  Note writers on this computer (1.7.0 · 29.09.2026). ChatGPT (Codex CLI) and Gemini (Antigravity CLI) write the note
  with the user's own sign-in and every tool switched off (laya-kapi/yazicilar.py). Before, the user had to install
  them alone (Codex needed Node and npm); nothing in Claudian said how. Now each writer has two buttons:

    Kur        ChatGPT: the publisher's Codex build for Windows, pinned by size and SHA-256 and checked for OpenAI's
               Authenticode signature, unpacked into %LOCALAPPDATA%\Claudian\araclar\codex.
               Gemini: Google's own install script (antigravity.google/cli/install.ps1) runs in a visible PowerShell
               window; afterwards agy.exe must carry Google's Authenticode signature, or it counts as not installed.
    Giriş yap  A visible window runs the CLI's own sign-in; the browser opens and the user signs in there.
               Claudian never sees the account, the password or the token.
*/

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const {spawn, execFile} = require('child_process');
const {downloadFile, sha256File} = require('./ring-install.cjs');

const CODEX = {file: 'codex-x86_64-pc-windows-msvc.exe.zip', version: '0.159.0',
  url: 'https://github.com/openai/codex/releases/download/rust-v0.159.0/codex-x86_64-pc-windows-msvc.exe.zip',
  size: 161636821, sha256: '1e22e9b2a3bd6bb3aa7bf0fe7373c22365d709bd3a5fafe2b810ac800b2fa5e5'};
const AGY_SCRIPT = 'https://antigravity.google/cli/install.ps1';
const SIGNERS = {codex: 'OpenAI OpCo, LLC', gemini: 'Google LLC'};

const localApp = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const codexDir = () => path.join(localApp(), 'Claudian', 'araclar', 'codex');
const codexExe = () => path.join(codexDir(), 'codex.exe');
const npmCodex = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'codex.cmd');
const agyExe = () => path.join(localApp(), 'agy', 'bin', 'agy.exe');
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

/** Authenticode signer of an executable ("" if unsigned or invalid). */
function signer(file) {
  return new Promise(resolve => {
    const ps = `$s = Get-AuthenticodeSignature -LiteralPath $env:CLAUDIAN_IMZA; if ($s.Status -eq 'Valid') { $s.SignerCertificate.GetNameInfo('SimpleName', $false) }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {env: {...process.env, CLAUDIAN_IMZA: file}, windowsHide: true, timeout: 30000},
      (err, out) => resolve(err ? '' : String(out || '').trim()));
  });
}

/** A visible console window (a detached console program gets its own window): the user sees what runs. */
function visible(command, args) {
  const options = {detached: true, stdio: 'ignore', windowsHide: false};
  const child = /\.cmd$/i.test(command)
    ? spawn('cmd.exe', ['/d', '/s', '/c', `"${[`"${command}"`, ...args].join(' ')}"`], {...options, windowsVerbatimArguments: true})
    : spawn(command, args, options);
  child.on('error', () => {});
  child.unref();
}

function createWriterSetup({fetch, send = () => {}} = {}) {
  const signed = new Map(); // path → signer, once per run

  async function signedBy(file, id) {
    if (!signed.has(file)) signed.set(file, await signer(file));
    return signed.get(file) === SIGNERS[id];
  }

  async function status() {
    const codex = (await exists(codexExe()) && await signedBy(codexExe(), 'codex')) ? codexExe() : (await exists(npmCodex()) ? npmCodex() : null);
    const gemini = await exists(agyExe()) && await signedBy(agyExe(), 'gemini') ? agyExe() : null;
    return {
      codex: {installed: !!codex, signedIn: !!codex && await exists(path.join(codexHome(), 'auth.json')), path: codex},
      // agy keeps its session in Windows Credential Manager; whether it is signed in shows only when it runs.
      gemini: {installed: !!gemini, signedIn: null, path: gemini},
    };
  }

  async function install(id, {signal} = {}) {
    if (id === 'codex') {
      const cache = path.join(localApp(), 'Claudian', 'araclar', 'indirilen');
      const zip = path.join(cache, CODEX.file);
      await fs.mkdir(cache, {recursive: true});
      await downloadFile(fetch, CODEX.url, zip, {size: CODEX.size, sha256: CODEX.sha256, signal,
        onBytes: (n, total) => send('ring:writer-setup', {id, adim: 'indiriliyor', indirilen: n, toplam: total})});
      send('ring:writer-setup', {id, adim: 'aciliyor'});
      const temp = codexDir() + '.yeni';
      await fs.rm(temp, {recursive: true, force: true});
      await fs.mkdir(temp, {recursive: true});
      // Windows' own bsdtar (a GNU tar earlier on PATH, e.g. Git's, reads "C:" as a remote host).
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      await new Promise((resolve, reject) => execFile(tar, ['-xf', zip, '-C', temp], {windowsHide: true}, e => e ? reject(e) : resolve()));
      const built = path.join(temp, 'codex-x86_64-pc-windows-msvc.exe');
      if (!await exists(built)) throw Error('Codex paketinden codex.exe çıkmadı.');
      await fs.rename(built, path.join(temp, 'codex.exe'));
      if (await signer(path.join(temp, 'codex.exe')) !== SIGNERS.codex) {
        await fs.rm(temp, {recursive: true, force: true});
        throw Error('Codex dosyası OpenAI imzası taşımıyor; kurulmadı.');
      }
      await fs.rm(codexDir(), {recursive: true, force: true});
      await fs.rename(temp, codexDir());
      await fs.rm(zip, {force: true});
      signed.clear();
      send('ring:writer-setup', {id, adim: 'bitti'});
      return status();
    }
    if (id === 'gemini') {
      // Google's installer, in a window the user sees; Claudian checks the result by its signature afterwards.
      visible('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${AGY_SCRIPT} | iex; Write-Host ''; Read-Host 'Bitti. Pencereyi kapatmak icin Enter'`]);
      signed.clear();
      return status();
    }
    throw Error('Bilinmeyen not yazıcısı.');
  }

  async function signIn(id) {
    const s = await status();
    if (id === 'codex') {
      if (!s.codex.installed) throw Error('Önce ChatGPT (Codex) kurulmalı.');
      visible(s.codex.path, ['login']);
    } else if (id === 'gemini') {
      if (!s.gemini.installed) throw Error('Önce Gemini (Antigravity) kurulmalı.');
      visible(s.gemini.path, []);
    } else throw Error('Bilinmeyen not yazıcısı.');
    return s;
  }

  return {status, install, signIn};
}

module.exports = {createWriterSetup, CODEX, SIGNERS, codexExe, agyExe};
