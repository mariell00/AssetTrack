// mobile/src/app.js — root PWA router. Small tab-based flow: login → pick
// room → scan → sync. Kept intentionally simple for a single-purpose
// field tool used on shared staff phones.
import { renderLogin } from './features/auth/ui-login.js';
import { renderAssetScan } from './features/asset-scan/ui-scan.js';
import { renderSync } from './features/sync/ui-sync.js';
import { currentUser, logout } from './features/auth/services.js';

const root = document.getElementById('mobile-app');

function renderShell() {
  root.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'm-shell';

  const tabs = document.createElement('div');
  tabs.className = 'm-tabs';
  tabs.innerHTML = `
    <button data-tab="scan" class="m-tab active">SCAN</button>
    <button data-tab="sync" class="m-tab">SYNC</button>
    <button data-tab="logout" class="m-tab">LOG OUT</button>
  `;

  const content = document.createElement('div');
  content.className = 'm-content';
  content.appendChild(renderAssetScan(null));

  tabs.addEventListener('click', (e) => {
    const tab = e.target.dataset.tab;
    if (!tab) return;
    if (tab === 'logout') { logout(); renderApp(); return; }

    [...tabs.children].forEach((b) => b.classList.toggle('active', b === e.target));
    content.innerHTML = '';
    content.appendChild(tab === 'sync' ? renderSync() : renderAssetScan(null));
  });

  shell.appendChild(tabs);
  shell.appendChild(content);
  root.appendChild(shell);
}

function renderApp() {
  root.innerHTML = '';
  if (currentUser()) {
    renderShell();
  } else {
    root.appendChild(renderLogin(renderShell));
  }
}

renderApp();
