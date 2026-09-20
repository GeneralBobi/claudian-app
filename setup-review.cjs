'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
async function pending(dataDir, stamp, profile) {
  if (!profile) return false;
  try { return JSON.parse(await fs.readFile(path.join(dataDir,'setup-reviewed.json'),'utf8')).stamp !== stamp; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
async function acknowledge(dataDir, stamp) {
  await fs.mkdir(dataDir,{recursive:true});
  await fs.writeFile(path.join(dataDir,'setup-reviewed.json'),JSON.stringify({stamp,at:new Date().toISOString()}));
}
async function apply(core, hosts, consent, consentWithdraw) {
  const snapshot = await core.snapshot(), profile = snapshot.profile;
  if (!profile || !Array.isArray(hosts) || !hosts.length || new Set(hosts).size !== hosts.length || hosts.some(id=>!snapshot.hosts.some(h=>h.id===id))) throw Error('En az bir AI uygulaması seç.');
  // Connecting an AI to a folder that is not there installs the appearance of a memory. The
  // folder is the subject of every file this call writes, so it is settled first.
  if (snapshot.vaultMissing) throw Error('Not klasörü bulunamadı. Önce klasörü seç veya yeniden oluştur.');
  // One card can stand for more than one entry point (Antigravity's IDE and terminal). The
  // half the user never saw must be kept with the half they ticked, not silently withdrawn.
  hosts = require('./core.cjs').expandCompanions(hosts).filter(id=>snapshot.hosts.some(h=>h.id===id));
  const added = hosts.filter(id=>!profile.hosts.some(h=>h.id===id));
  if (added.length) {
    // Adding a connection here writes the same files setup writes, so it needs the same grant.
    // Passing none made this screen refuse itself with "nothing is connected without approving
    // these permissions" -- a message about a permission the screen never offered.
    if (consent !== true) throw Error('Bu bağlantıları kurmak için izin onayı gerekiyor.');
    const plan = await core.prepare({...profile,mode:'existing',action:'extend',hosts:added});
    await core.install(plan.id, true);
  }
  // Withdrawing is a separate act from confirming, and it must be asked for by name.
  //
  // This screen looked like a confirmation and behaved like a removal: an installation that had
  // just written seven connections came back with one, because everything not ticked here was
  // withdrawn without a word. Measured 13.09.2026 on a real profile -- the setup log recorded
  // all seven written and completed, and the profile afterwards held only Claude Code.
  const withdrawn = profile.hosts.filter(h => !hosts.includes(h.id)).map(h => h.id);
  if (withdrawn.length && !Array.isArray(consentWithdraw)) {
    const error = Error('Bu bağlantılar kaldırılacak; kaldırmayı ayrıca onayla.');
    error.withdrawing = withdrawn;
    throw error;
  }
  for (const id of withdrawn) if (!consentWithdraw.includes(id)) throw Error('Kaldırma onayı bu bağlantıyı kapsamıyor: ' + id);
  for (const id of withdrawn) {
    // Removing a provider takes its companion entry points with it, so by the time the loop
    // reaches the companion there may be nothing left to remove. That is success, not a fault.
    if (!(await core.snapshot()).profile?.hosts.some(h => h.id === id)) continue;
    await core.removeHost(id);
  }
  return core.upgrade();
}
module.exports = {pending,acknowledge,apply};
