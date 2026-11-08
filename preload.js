const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('info'),
  apps: () => ipcRenderer.invoke('apps'),
  images: () => ipcRenderer.invoke('images'),
  open: p => ipcRenderer.invoke('open', p),
});
