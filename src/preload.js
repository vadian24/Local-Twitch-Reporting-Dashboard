'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reports', {
  generate: options => ipcRenderer.invoke('report:generate', options),
  cancel: () => ipcRenderer.invoke('report:cancel'),
  save: (format, section) => ipcRenderer.invoke('report:save', format, section),
  copy: (format, section) => ipcRenderer.invoke('report:copy', format, section),
  supportsUpdates: () => ipcRenderer.invoke('update:supported'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateStatus: callback => {
    ipcRenderer.on('update:status', (_event, message) => callback(message));
  },
  onProgress: callback => {
    ipcRenderer.on('report:progress', (_event, progress) => callback(progress));
  }
});
