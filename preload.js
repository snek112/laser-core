const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('laser', {
  startup: () => ipcRenderer.invoke('laser:startup'),
  status: () => ipcRenderer.invoke('laser:status'),
  peers: () => ipcRenderer.invoke('laser:peers'),
  walletList: () => ipcRenderer.invoke('laser:wallet-list'),
  walletOpen: (name, passphrase) =>
    ipcRenderer.invoke('laser:wallet-open', name, passphrase),
  walletCreate: (name, passphrase) =>
    ipcRenderer.invoke('laser:wallet-create', name, passphrase),
  walletRestore: (name) => ipcRenderer.invoke('laser:wallet-restore', name),
  walletExists: (name) => ipcRenderer.invoke('laser:wallet-exists', name),
  walletUnlocked: (name) => ipcRenderer.invoke('laser:wallet-unlocked', name),
  walletLock: (name) => ipcRenderer.invoke('laser:wallet-lock', name),
  copyAddress: (address) => ipcRenderer.invoke('laser:copy-address', address),
  minerMetrics: (wallet) => ipcRenderer.invoke('laser:miner-metrics', wallet),
  mine: (wallet, count, intensity, solo) => ipcRenderer.invoke('laser:mine', wallet, count, intensity, solo === true),
  mineStart: (wallet, intervalMs, intensity, solo) => ipcRenderer.invoke('laser:mine-start', wallet, intervalMs, intensity, solo === true),
  mineSetIntensity: (intensity) => ipcRenderer.invoke('laser:mine-intensity', intensity),
  mineStop: () => ipcRenderer.invoke('laser:mine-stop'),
  mineStatus: () => ipcRenderer.invoke('laser:mine-status'),
  send: (from, to, amount, fee) => ipcRenderer.invoke('laser:send', from, to, amount, fee),
  config: () => ipcRenderer.invoke('laser:config'),
  publisherStatus: () => ipcRenderer.invoke('laser:publisher-status'),
  publisherSave: (settings) => ipcRenderer.invoke('laser:publisher-save', settings),
  onPublisherSettings: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('publisher:settings', listener);
    return () => ipcRenderer.removeListener('publisher:settings', listener);
  },
  onBlockMined: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('mine:block-mined', listener);
    return () => ipcRenderer.removeListener('mine:block-mined', listener);
  },
  onMineError: (cb) => {
    const listener = (_e, msg, state) => cb(msg, state);
    ipcRenderer.on('mine:error', listener);
    return () => ipcRenderer.removeListener('mine:error', listener);
  }
});
