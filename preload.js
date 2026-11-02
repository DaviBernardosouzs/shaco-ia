const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shaco', {
  onUpdate: (cb) => ipcRenderer.on('shaco:update', (_e, data) => cb(data)),
  onSay: (cb) => ipcRenderer.on('shaco:say', (_e, data) => cb(data)),
  onChat: (cb) => ipcRenderer.on('shaco:chat', (_e, data) => cb(data)),
  onLayout: (cb) => ipcRenderer.on('shaco:layout', (_e, data) => cb(data)),
  onEmote: (cb) => ipcRenderer.on('shaco:emote', (_e, key) => cb(key)),
  onCalibrate: (cb) => ipcRenderer.on('shaco:calibrate', () => cb()),
  calibrateDone: () => ipcRenderer.send('shaco:calibrateDone'),
  dismissSummary: () => ipcRenderer.send('shaco:dismissSummary'),
  hover: (over) => ipcRenderer.send('shaco:hover', over),
  closeChat: () => ipcRenderer.send('shaco:closeChat'),
  ask: (question) => ipcRenderer.invoke('shaco:ask', question),
  applyRunes: () => ipcRenderer.invoke('shaco:applyRunes'),
  tts: (text) => ipcRenderer.invoke('shaco:tts', text),
});
