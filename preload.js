const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  quit: () => ipcRenderer.send('quit-app'),

  // 🌐 Abrir enlace externo
  openExternal: (url) => ipcRenderer.send('open-external', url),

  onCallLunari: (cb) => ipcRenderer.on('call-lunari', cb),
  onHideLunari: (cb) => ipcRenderer.on('hide-lunari', cb),
  onTogglePose: (cb) => ipcRenderer.on('toggle-pose', cb),
  onCopyConfig: (cb) => ipcRenderer.on('copy-config', cb),
  onShowCredits: (cb) => ipcRenderer.on('show-credits', cb),
});