const { contextBridge } = require('electron');

// Exponer APIs seguras al contexto del navegador (frontend de React)
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('Precios al Día: Entorno de escritorio inicializado.');
});
