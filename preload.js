// preload.js — the ONLY bridge between the untrusted renderer and Node/Electron.
// Keeps nodeIntegration off; the UI only ever talks to the local Express API
// over fetch(), so this bridge just exposes a couple of safe, read-only bits.
const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

contextBridge.exposeInMainWorld('assetTrackHost', {
  platform: process.platform,
  hostname: os.hostname(),
  // Asks the main process to hand keyboard focus back to the window (see renderer/js/focus-fix.js).
  refocus: () => ipcRenderer.send('assettrack:refocus')
});
