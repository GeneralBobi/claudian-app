'use strict';
/*
  Which account a local AI connection runs as (1.3.0, madde 3).

  Local connections (Claude Code, Codex, Claude Desktop) belong to this computer, not to an account: whoever is signed
  in to that program on this computer uses them. Where the program itself records the signed-in account, its e-mail is
  shown so a person with two Claude or two ChatGPT accounts can tell which one it is. Only the e-mail is read out;
  no token, key or other field ever leaves this module. Where nothing is recorded, nothing is guessed.
    Claude Code: ~/.claude.json → oauthAccount.emailAddress (and organizationName)
    Codex:       ~/.codex/auth.json → tokens.id_token (a JWT; only its payload's "email" is read, the signature is not needed
                 because nothing is authorised with it) — or, with an API key login, "API key", never the key.
*/
const fs = require('fs/promises');
const path = require('path');

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const clean = v => (typeof v === 'string' && EMAIL.test(v) ? v : null);

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

function jwtEmail(token) {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try { return clean(JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).email); } catch { return null; }
}

async function localAccounts(home, {codexHome = path.join(home, '.codex')} = {}) {
  const claude = await readJson(path.join(home, '.claude.json'));
  const codex = await readJson(path.join(codexHome, 'auth.json'));
  const o = claude?.oauthAccount || {};
  const codexEmail = jwtEmail(codex?.tokens?.id_token);
  return {
    'claude-code': clean(o.emailAddress) ? {email: clean(o.emailAddress), org: typeof o.organizationName === 'string' ? o.organizationName.slice(0, 80) : null} : null,
    codex: codexEmail ? {email: codexEmail} : codex?.OPENAI_API_KEY ? {apiKey: true} : null,
  };
}

module.exports = {localAccounts, jwtEmail};
