// mobile/src/app.js — root PWA router. Small tab-based flow: (one-time
// install choice) → login → pick room → scan/register/sync. Kept
// intentionally simple for a single-purpose field tool used on shared
// staff phones.
import { renderLogin } from './features/auth/ui-login.js';
import { renderAssetScan } from './features/asset-scan/ui-scan.js';
import { renderRegister } from './features/register/ui-register.js';
import { renderSync } from './features/sync/ui-sync.js';
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

function screenFor(tab) {
  if (tab === 'register') return renderRegister();
  if (tab === 'sync') return renderSync();
  return renderAssetScan();
}

function renderShell() {
  root.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'm-shell';

  const user = currentUser();
  const userBar = document.createElement('div');
  userBar.className = 'm-userbar';
  userBar.textContent = user ? `LOGGED IN: ${user.username.toUpperCase()} (${user.role.toUpperCase()})` : '';

  const tabs = document.createElement('div');
  tabs.className = 'm-tabs';
  tabs.innerHTML = `
    <button data-tab="scan" class="m-tab active">SCAN</button>
    <button data-tab="register" class="m-tab">REGISTER</button>
    <button data-tab="sync" class="m-tab">SYNC</button>
    <button data-tab="logout" class="m-tab">LOG OUT</button>
  `;

  const content = document.createElement('div');
  content.className = 'm-content';
  content.appendChild(screenFor('scan'));

  tabs.addEventListener('click', (e) => {
    const tab = e.target.dataset.tab;
    if (!tab) return;
    if (tab === 'logout') { logout(); renderApp(); return; }

    [...tabs.children].forEach((b) => b.classList.toggle('active', b === e.target));
    content.innerHTML = '';
    content.appendChild(screenFor(tab));
  });

  shell.appendChild(userBar);
  shell.appendChild(tabs);
  shell.appendChild(content);
  root.appendChild(shell);
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
