// core/paths.js — single source of truth for where runtime data lives.
//
// In development this is the project folder (unchanged behaviour). In a
// packaged build, __dirname points INSIDE the read-only app bundle, so
// "data next to the executable" has to be resolved explicitly:
//   - Windows portable .exe  -> PORTABLE_EXECUTABLE_DIR (set by electron-builder)
//   - Linux AppImage         -> the folder containing the .AppImage file
//   - other packaged builds  -> the folder containing the executable
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.join(__dirname, '..', '..');

function runtimeRoot() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);
  try {
    const electron = require('electron');
    const app = electron && electron.app;
    if (app && app.isPackaged) return path.dirname(app.getPath('exe'));
  } catch { /* plain node (e.g. tiles:fetch) — fall through */ }
  return APP_ROOT;
}

const RUNTIME_ROOT = runtimeRoot();
const DATA_DIR = path.join(RUNTIME_ROOT, 'data');

// Prefer a settings.json sitting next to the executable (editable, survives
// updates); fall back to the one bundled with the app.
function settingsPath() {
  const external = path.join(RUNTIME_ROOT, 'settings.json');
  return fs.existsSync(external) ? external : path.join(APP_ROOT, 'settings.json');
}

// Optional, git-ignored overrides (API keys, SMTP password) merged over settings.json.
function localSettingsPath() {
  return path.join(RUNTIME_ROOT, 'settings.local.json');
}

module.exports = { APP_ROOT, RUNTIME_ROOT, DATA_DIR, settingsPath, localSettingsPath };
