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
`qr-distribution`, `analytics`, `system`) is self-contained: its own database schema, business logic,
Express routes, and UI. To add a new feature (e.g. "depreciation"), copy the
shape of an existing feature folder, register its routes in `main.js`, and
add a nav link in `src/renderer/index.html` — nothing else needs to change.

## Who uses which app

| Account | App | What it can do |
| --- | --- | --- |
| **Super admin** | Electron desktop app (Admin Hub) | Everything. Only on the computer that holds the data. Verifies what phones and the web app send, manages users, imports, deletes. |
| **Admin** | **Web app** at `/admin/` (any browser, always on) | A limited version of the Admin Hub: dashboard + room progress, asset search/detail/QR label, locations, assignees, audit reports (PDF/Excel). Can *propose* a change to an asset's location, condition, status, quantity or user; it waits for the super admin. Source: `web/`. |
| **Admin** | Mobile PWA at `/static/mobile/` | Unchanged: field scanning and proposed edits. |

The web app sends `X-Client-Type: web`. A single gate in `src/server/app.js` refuses every write from a web
session except "propose an edit to one asset", which only enters the review queue. Super admin sign-in
stays Electron-only, on the machine running the server.

## Always-on server (for the web app)

The API, the web app and the phone PWA run from the same Express app (`src/server/app.js`). The Electron
app starts it for you, but the web app needs it running *without* anyone having the window open, so there is
also a headless entry point:

```bash
npm install            # full install: the super admin's Electron app on this PC needs it
npm run serve          # = node server.js ; web app at http://<this-pc>:3000/admin/
```

(On a machine that will *only* run the server and never the desktop app, `npm install --omit=dev` is fine and
smaller. Don't use it on the PC where you run `npm start`: it removes Electron.)

Run the server in one terminal and, if you want the desktop app, `npm start` in a second one.

Keep it alive with PM2 (`pm2 start server.js --name assettrack`), a Windows service/Task Scheduler entry, or systemd.
Settings (`settings.json` / `settings.local.json`, including the Cloudflare `publicAccess` tunnel) work exactly
as for the desktop app, so a named tunnel gives the web app a permanent public address. Behind your own
reverse proxy/domain instead, set `ASSETTRACK_PUBLIC_URL=https://your.domain` and `ASSETTRACK_TRUST_PROXY=1`.
`GET /api/v1/health` is a public liveness check for uptime monitors.

**One database, one server.** When the Electron app starts and finds `server.js` already running on this
computer, it doesn't start a second server: it just opens its window onto the running one. So run `server.js`
on the always-on PC, and the super admin opens the Electron app on that same PC to verify changes.

> The super admin can only sign in from the machine itself (loopback). That is deliberate, and it means the
> data and server must live on the supervisor's own computer, not on a remote host or inside a Docker
> container that hides the loopback address.

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
- **Password:** generated on first run and saved in `data/first-login.txt` (there is no shared default password). Sign in, change it, then delete that file. To choose your own, set the `ASSETTRACK_ADMIN_PASSWORD` environment variable before the first start.

Public internet access (Cloudflare tunnel) is controlled by `publicAccess.enabled`; see
`publicAccess` in `settings.json` (`quick` or `named` mode). Set it to `false` for LAN-only phones.

## 4. Build the portable desktop app

```bash
npm run build:desktop
```

This runs `build-mobile.js` (copies `/mobile` into `src/static/mobile`) and
then `electron-builder`, producing a portable `.exe` (Windows) or
`.AppImage` (Linux) inside `/dist`. The whole `dist` output folder is
self-contained — `data/` and an optional `settings.json` / `settings.local.json`
are read from next to the executable, and your development `data/` folder is
never bundled. Copy it to any PC and run it with zero configuration
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
2. Staff walk rooms with the mobile app, scanning QR labels. Each scan, with the count
   and any changes entered, is saved to IndexedDB immediately — no Wi-Fi required.
3. Staff hit **SYNC** when back in Wi-Fi range; scans POST to
   `/api/v1/inventory/sync` and clear from the local queue on success.
4. The Admin Hub dashboard shows live per-room verification progress.
5. **Reports** generates a consolidated PDF or Excel audit at any time.

### What a phone can and can't do

New assets are **registered on the desktop only** (the Assets screen, or a bulk import).
A phone can't register anything, and the server refuses it even from an older copy of
the app.

When a phone scans an asset it can record, and propose changes to, these six things:

| Field | Meaning |
| --- | --- |
| **Location** | the room the asset is in |
| **Condition** | good / fair / poor |
| **Status** | active / pending / maintenance / offline |
| **Quantity** | how many the asset record says there are |
| **User** | who is using it (from the Assignees list) |
| **Counted** | how many were actually counted *at this scan* (a physical count) |

Everything else about an asset (name, category, specifications, photo, value, property
numbers…) can only be changed on the desktop. The server enforces this list
(`PHONE_EDITABLE_FIELDS` in `src/features/inventory/services.js`), not just the phone's screen.

**Counted vs Quantity.** Quantity belongs to the asset; Counted belongs to the scan, so
each scan is a fresh count and the history is kept. Nothing a phone sends takes effect
until the super admin verifies it on the Sync screen, where a count that doesn't match
the quantity the record will have is flagged ("2 short" / "1 over").

## Portability & backups

- All runtime data (`inventory.db`, `settings.json`) lives in `/data` next
  to the executable — moving the folder moves the whole install.
- `core/database.js` copies `inventory.db` to `/backups` every 24 hours
  (configurable via `backupIntervalHours` in `settings.json`).

## Extending the system

Add a feature by creating `src/features/<name>/` with `models.js`, `services.js`,
`routes.js` and `ui.js` (same shape as any existing feature), then add one
`expressApp.use('/api/v1/<name>', ...)` line to `main.js` and one nav link in
`src/renderer/index.html`.
