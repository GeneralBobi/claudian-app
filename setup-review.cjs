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
async function apply(core, hosts) {
  const snapshot = await core.snapshot(), profile = snapshot.profile;
  if (!profile || !Array.isArray(hosts) || !hosts.length || new Set(hosts).size !== hosts.length || hosts.some(id=>!snapshot.hosts.some(h=>h.id===id))) throw Error('En az bir AI uygulaması seç.');
  const added = hosts.filter(id=>!profile.hosts.some(h=>h.id===id));
  if (added.length) {
    const plan = await core.prepare({...profile,mode:'existing',action:'extend',hosts:added});
    await core.install(plan.id);
  }
  // Deselecting explicitly withdraws a connection, never deletes the user's notes.
  for (const host of profile.hosts.filter(h=>!hosts.includes(h.id))) await core.removeHost(host.id);
  return core.upgrade();
}
module.exports = {pending,acknowledge,apply};
