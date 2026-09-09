'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('claudian', {
  snapshot: () => invoke('app:snapshot'),
  discover: () => invoke('app:discover'),
  enter: () => invoke('app:enter'),
  chooseFolder: () => invoke('app:folder'),
  prepare: input => invoke('setup:prepare', input),
  install: id => invoke('setup:install', id),
  cancel: () => invoke('setup:cancel'),
  activity: () => invoke('memory:activity'),
  challenge: host => invoke('memory:challenge', host),
  verify: host => invoke('memory:verify', host),
  copy: text => invoke('app:copy', text),
  open: kind => invoke('app:open', kind),
  onProgress: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('setup:event', listener);
    return () => ipcRenderer.removeListener('setup:event', listener);
  },
});
