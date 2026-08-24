# AssetTrack

A sustainable, portable, offline-first asset management system. Retro-computing
themed Admin Hub (Electron desktop app) paired with a companion mobile PWA for
NFC-based room verification.

## Architecture at a glance

```
AssetTrack_Desktop/
├── main.js / preload.js        Electron entry point + secure bridge
├── src/core/                   shared db, config, security (used by every feature)
├── src/features/<name>/        one folder per feature: models, services, routes, ui
├── src/renderer/                the Admin Hub UI (retro theme, router, api-client)
├── src/static/mobile/          built copy of /mobile, hosted for QR distribution
└── mobile/                     the mobile PWA source (NFC scanning, offline sync)
```

Each feature module (`auth`, `assets`, `inventory`, `mapping`, `reports`,
`qr-distribution`) is self-contained: its own database schema, business logic,
Express routes, and UI. To add a new feature (e.g. "depreciation"), copy the
shape of an existing feature folder, register its routes in `main.js`, and
add a nav link in `src/renderer/index.html` — nothing else needs to change.

## 1. Install dependencies

```bash
cd AssetTrack_Desktop
npm install
```

## 2. (Optional, one-time, needs internet) Cache offline map tiles

Edit the `mapBoundingBox` in `settings.json` to match your campus, then:

```bash
npm run tiles:fetch
```

This downloads OpenStreetMap tiles into `src/static/map_tiles/`. Skip this
step if you don't need the cluster map, or if you'll add tiles later — the
app runs fine without it.

## 3. Run in development

```bash
npm start
```

This launches Electron, which boots the Express API on `localhost:3000`
(configurable in `settings.json`) and opens the Admin Hub window. Log in
with the seeded default account:

- **Username:** `admin`
- **Password:** `changeme` — change this immediately via the user panel.

## 4. Build the portable desktop app

```bash
npm run build:desktop
```

This runs `build-mobile.js` (copies `/mobile` into `src/static/mobile`) and
then `electron-builder`, producing a portable `.exe` (Windows) or
`.AppImage` (Linux) inside `/dist`. The whole `dist` output folder is
self-contained — copy it to any PC and run it with zero configuration
changes, aside from re-scanning the QR code if the local IP changes.

## 5. Install the mobile app on staff phones

1. On the Admin Hub, open **MOBILE QR**.
2. Staff scan the QR code with an Android phone's camera.
3. The link opens the AssetTrack Scanner PWA in Chrome.
4. Staff tap **"Add to Home Screen"** — it now behaves like a native app,
   including offline support via the service worker.
5. On first launch, staff enter the Desktop's local IP (pre-filled from the
   QR code) and log in.

## How data flows

1. Admin registers assets and NFC tags in the **Assets** screen (or bulk
   imports an `.xlsx` sheet with columns `asset_tag, name, category,
   description, condition, room`).
2. Staff walk rooms with the mobile app, tapping NFC tags. Scans are saved
   to IndexedDB immediately — no Wi-Fi required.
3. Staff hit **SYNC** when back in Wi-Fi range; scans POST to
   `/api/v1/inventory/sync` and clear from the local queue on success.
4. The Admin Hub dashboard shows live per-room verification progress.
5. **Reports** generates a consolidated PDF or Excel audit at any time.

## Portability & backups

- All runtime data (`inventory.db`, `settings.json`) lives in `/data` next
  to the executable — moving the folder moves the whole install.
- `core/database.js` copies `inventory.db` to `/backups` every 24 hours
  (configurable via `backupIntervalHours` in `settings.json`).

## Extending the system

Want to add a "Depreciation" feature? Create:

```
src/features/depreciation/
├── models.js     # CREATE TABLE IF NOT EXISTS ...
├── services.js   # business logic, imports getDb() from core/database
├── routes.js     # Express router, mounted at /api/v1/depreciation
└── ui.js         # export function render() { ... }
```

Then add one line to `main.js` (`expressApp.use('/api/v1/depreciation', ...)`)
and one nav link in `index.html`. No other file needs to change.
