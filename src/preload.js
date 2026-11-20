'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reports', {
  generate: options => ipcRenderer.invoke('report:generate', options),
  cancel: () => ipcRenderer.invoke('report:cancel'),
  save: format => ipcRenderer.invoke('report:save', format),
  copy: format => ipcRenderer.invoke('report:copy', format),
  supportsUpdates: () => ipcRenderer.invoke('update:supported'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onProgress: callback => {
    ipcRenderer.on('report:progress', (_event, progress) => callback(progress));
  }
});
