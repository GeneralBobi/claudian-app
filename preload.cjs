'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('claudian', {
  obsidianInstalled: () => invoke('app:obsidian-installed'),
  downloadObsidian: () => invoke('app:download-obsidian'),
  scanPreview: language => invoke('memory:scan-preview',language),
  chooseCli: id => invoke('memory:choose-cli',id),
  existingSkill: id => invoke('memory:existing-skill',id),
  scanSend: (id,prompt) => invoke('memory:scan-send',id,prompt),
  memoryTrigger: () => invoke('memory:trigger'),
  companionConnect: code => invoke('companion:connect',code),
  companionRefresh: () => invoke('companion:refresh'),
  companionDisconnect: () => invoke('companion:disconnect'),
  openAiApp: id => invoke('memory:open-app',id),
  repair: host => invoke('memory:repair',host),
  updates: () => invoke('app:updates'),
  downloadUpdate: () => invoke('app:download-update'),
  snapshot: () => invoke('app:snapshot'),
  reviewSetup: hosts => invoke('setup:review', hosts),
  finishReview: () => invoke('setup:review-done'),
  preferences: language => invoke('app:preferences', language),
  connections: () => invoke('memory:connections'),
  checkFiles: () => invoke('memory:check-files'),
  removeHost: host => invoke('memory:remove', host),
  configuration: (host, kind) => invoke('memory:configuration', host, kind),
  obsidian: () => invoke('memory:obsidian'),
  discover: () => invoke('app:discover'),
  enter: () => invoke('app:enter'),
  chooseFolder: () => invoke('app:folder'),
  relocate: target => invoke('memory:relocate', target),
  verifyWatch: (host,requestId) => invoke('memory:verify-watch', host,requestId),
  cancelVerify: host => invoke('memory:verify-cancel',host),
  prepare: input => invoke('setup:prepare', input),
  install: id => invoke('setup:install', id),
  cancel: () => invoke('setup:cancel'),
  activity: () => invoke('memory:activity'),
  health: () => invoke('memory:health'),
  notice: () => invoke('memory:notice'),
  adoptProtocol: () => invoke('memory:adopt-protocol'),
  skipVerification: () => invoke('memory:skip-verification'),
  challenge: host => invoke('memory:challenge', host),
  verify: host => invoke('memory:verify', host),
  copy: text => invoke('app:copy', text),
  open: kind => invoke('app:open', kind),
  onVerify: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('verify:event', listener);
    return () => ipcRenderer.removeListener('verify:event', listener);
  },
  onProgress: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('setup:event', listener);
    return () => ipcRenderer.removeListener('setup:event', listener);
  },
});
