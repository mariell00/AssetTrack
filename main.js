// main.js — Electron entry point. Boots the Express API inside the main
// process, then opens a BrowserWindow pointed at that local server.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const express = require('express');
const fs = require('fs');

const { loadConfig, discoverLocalIp } = require('./src/core/config');
const { initDatabase, startAutoBackup } = require('./src/core/database');

// ---- Portability: keep all runtime data NEXT TO the executable ----
// Moving the whole AssetTrack_Desktop folder to another PC just works.
const userDataPath = path.join(__dirname, 'data');
if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

let mainWindow;
let server;

function registerFeatureRoutes(expressApp) {
  // Each feature module owns its own routes.js — mounted here so the
  // architecture stays pluggable. Adding a feature = adding one require + use().
  expressApp.use('/api/v1/auth', require('./src/features/auth/routes'));
  expressApp.use('/api/v1/assets', require('./src/features/assets/routes'));
  expressApp.use('/api/v1/inventory', require('./src/features/inventory/routes'));
  expressApp.use('/api/v1/map', require('./src/features/mapping/routes'));
  expressApp.use('/api/v1/qr', require('./src/features/qr-distribution/routes'));
  expressApp.use('/api/v1/reports', require('./src/features/reports/routes'));
}

function startServer(config) {
  const expressApp = express();
  expressApp.use(express.json({ limit: '10mb' }));

  registerFeatureRoutes(expressApp);

  // Static hosting: offline map tiles + the mobile PWA bundle
  expressApp.use('/static/map_tiles', express.static(path.join(__dirname, 'src/static/map_tiles')));
  expressApp.use('/static/mobile', express.static(path.join(__dirname, 'src/static/mobile')));

  server = expressApp.listen(config.port, '0.0.0.0', () => {
    console.log(`[AssetTrack] API + PWA host listening on port ${config.port}`);
  });
}

function createWindow(config) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111844',
    title: 'AssetTrack — Admin Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  // Open external links (e.g. help docs) in the OS browser, not Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  const config = loadConfig(userDataPath);
  config.localIp = discoverLocalIp();

  initDatabase(userDataPath);
  startAutoBackup(userDataPath, config.backupIntervalHours);

  startServer(config);
  createWindow(config);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(config);
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});
