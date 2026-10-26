// mobile/src/app.js — root PWA. Flow: (one-time install choice) → login →
// the Scanner. The menu (☰, top right) opens a sidebar with the other
// screens — Asset Registry and Sync — and Log out. Kept intentionally simple
// for a single-purpose field tool.
import { renderLogin } from './features/auth/ui-login.js';
import { renderAssetScan, resetScanSession } from './features/asset-scan/ui-scan.js';
import { renderRegistry } from './features/registry/ui-registry.js';
import { renderSync } from './features/sync/ui-sync.js';
import { pendingCount } from './features/sync/services.js';
import { currentUser, logout } from './features/auth/services.js';
import { shouldShowInstallChoice, renderInstallChoice } from './features/install-prompt/ui-install.js';

const root = document.getElementById('mobile-app');

// Captured as early as possible — the browser only fires this once, early
// in the page's life, and there's no way to re-request it later. Chrome
// fires it automatically when the page qualifies as installable (valid
// manifest + registered service worker + secure context); iOS Safari never
// fires it at all, which the install-choice screen handles separately.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

const PAGES = {
  scan: { title: 'Scanner', label: 'Scanner', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4"/></svg>' },
  registry: { title: 'Asset registry', label: 'Asset registry', icon: '<svg viewBox="0 0 24 24"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>' },
  sync: { title: 'Sync', label: 'Sync', icon: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 20v-5h-5"/></svg>' }
};

let clockTimer = null;

function renderPage(page) {
  if (page === 'registry') return renderRegistry();
  if (page === 'sync') return renderSync();
  return renderAssetScan();
}

function initials(name) { return String(name || '?').slice(0, 2).toUpperCase(); }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderShell() {
  root.innerHTML = '';
  const user = currentUser();
  const roleLabel = user ? ({ superadmin: 'Super admin', admin: 'Admin' }[user.role] || String(user.role || '')) : '';

  const shell = document.createElement('div');
  shell.className = 'm-shell';
  shell.innerHTML = `
    <header class="m-head">
      <img class="m-logo" src="assets/brand/nbsc-shield.jpg" alt="NBSC" />
      <div class="m-title">
        <h1 class="m-brand">AssetTrack</h1>
        <p class="m-page" id="m-pagebar"></p>
      </div>
      <button type="button" class="m-menu-btn" id="m-menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="m-drawer">
        <span></span><span></span><span></span>
      </button>
    </header>
    <div class="m-clockbar"><span class="m-time" id="m-time"></span><span class="m-date" id="m-date"></span></div>
    <div class="m-content" id="m-content"></div>

    <div class="m-scrim" id="m-scrim" hidden></div>
    <aside class="m-drawer" id="m-drawer" aria-label="Main menu" hidden>
      <div class="m-drawer-bar">
        <span>Menu</span>
        <button type="button" class="m-drawer-x" id="m-drawer-x" aria-label="Close menu">&times;</button>
      </div>
      <nav class="m-nav" id="m-nav">
        ${Object.entries(PAGES).map(([key, p]) => `
          <button type="button" class="m-nav-item" data-page="${key}">
            <span class="m-nav-icon" aria-hidden="true">${p.icon}</span>
            <span class="m-nav-label">${p.label}</span>
            ${key === 'sync' ? '<span class="m-nav-badge" id="m-nav-pending" hidden></span>' : ''}
          </button>`).join('')}
      </nav>
      <div class="m-drawer-foot" id="m-drawer-foot"></div>
    </aside>
  `;
  root.appendChild(shell);

  const $ = (sel) => shell.querySelector(sel);
  const content = $('#m-content');
  const pagebar = $('#m-pagebar');
  const drawer = $('#m-drawer');
  const scrim = $('#m-scrim');
  const menuBtn = $('#m-menu-btn');
  let current = null;

  function openDrawer() {
    drawer.hidden = false;
    scrim.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    renderFoot();
    refreshPendingBadge();
    (drawer.querySelector('.m-nav-item.active') || drawer.querySelector('.m-nav-item')).focus();
  }
  function closeDrawer() {
    if (drawer.hidden) return;
    drawer.hidden = true;
    scrim.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  async function refreshPendingBadge() {
    const n = await pendingCount();
    const badge = $('#m-nav-pending');
    badge.hidden = n === 0;
    badge.textContent = String(n);
  }

  function showPage(page, opts = {}) {
    if (!PAGES[page]) page = 'scan';
    current = page;
    content.innerHTML = '';
    content.appendChild(renderPage(page, opts));
    content.scrollTop = 0;
    pagebar.textContent = PAGES[page].title;
    drawer.querySelectorAll('.m-nav-item').forEach((b) => {
      const on = b.dataset.page === page;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    closeDrawer();
  }

  // Live time and date in the header (same as the desktop). Stops by itself
  // once this shell is replaced, e.g. after logging out.
  const timeEl = $('#m-time');
  const dateEl = $('#m-date');
  function tickClock() {
    if (!shell.isConnected) { clearInterval(clockTimer); return; }
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  clearInterval(clockTimer);
  tickClock();
  clockTimer = setInterval(tickClock, 1000);

  // Footer: who's signed in + Log out. Log out asks first, and says so if
  // scans are still waiting to sync (they stay on this phone, but the person
  // logging out should know).
  function renderFoot(confirming = false, pending = 0) {
    const foot = $('#m-drawer-foot');
    if (!confirming) {
      foot.innerHTML = `
        <div class="m-usercard">
          <span class="m-avatar">${esc(initials(user && user.username))}</span>
          <span class="m-usermeta">
            <span class="m-username">${esc(user ? user.username : '')}</span>
            <span class="m-userrole">${esc(roleLabel)}</span>
          </span>
        </div>
        <button type="button" class="m-btn m-btn-secondary m-logout" id="m-logout">Log out</button>`;
      foot.querySelector('#m-logout').addEventListener('click', async () => renderFoot(true, await pendingCount()));
    } else {
      foot.innerHTML = `
        <p class="m-confirm-title">Log out?</p>
        <p class="m-status">${pending > 0
          ? `<strong>${pending}</strong> scan${pending === 1 ? ' is' : 's are'} not synced yet. ${pending === 1 ? 'It stays' : 'They stay'} on this phone until you sync.`
          : 'You will be returned to the login screen.'}</p>
        <div class="m-confirm-actions">
          <button type="button" class="m-btn m-btn-secondary" id="m-logout-cancel">Cancel</button>
          <button type="button" class="m-btn" id="m-logout-confirm">Log out</button>
        </div>`;
      foot.querySelector('#m-logout-cancel').addEventListener('click', () => renderFoot(false));
      foot.querySelector('#m-logout-confirm').addEventListener('click', () => {
        resetScanSession();
        logout();
        renderApp();
      });
    }
  }

  menuBtn.addEventListener('click', () => (drawer.hidden ? openDrawer() : closeDrawer()));
  $('#m-drawer-x').addEventListener('click', () => { closeDrawer(); menuBtn.focus(); });
  scrim.addEventListener('click', closeDrawer);
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); menuBtn.focus(); } });
  $('#m-nav').addEventListener('click', (e) => {
    const item = e.target.closest('.m-nav-item');
    if (item) showPage(item.dataset.page);
  });

  // The Scanner is the home screen.
  showPage('scan');
  refreshPendingBadge();
}

function renderApp() {
  root.innerHTML = '';
  if (shouldShowInstallChoice()) {
    root.appendChild(renderInstallChoice(() => deferredInstallPrompt, renderApp));
    return;
  }
  if (currentUser()) {
    renderShell();
  } else {
    root.appendChild(renderLogin(renderShell));
  }
}

// If a request ever comes back 401 (expired/invalid token), api-client
// clears the stored session and fires this — bounce straight back to the
// login screen instead of leaving a half-logged-in shell on screen.
window.addEventListener('assettrack:session-expired', () => renderApp());

renderApp();
