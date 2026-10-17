// js/router.js — client-side hash-based routing. Each feature's ui.js
// exports render(); this router just swaps what's mounted into #app, and
// keeps the top bar (breadcrumb / IP / clock / DB status) in sync.
import { render as renderLogin, renderUserManagement } from '../../features/auth/ui.js';
import { render as renderAssets } from '../../features/assets/ui.js';
import { render as renderMap } from '../../features/mapping/ui-map.js';
import { render as renderLocations } from '../../features/mapping/ui-locations.js';
import { render as renderReports } from '../../features/reports/ui.js';
import { render as renderQr } from '../../features/qr-distribution/ui.js';
import { render as renderInventory } from '../../features/inventory/ui.js';
import { render as renderAnalytics } from '../../features/analytics/ui.js';
import { apiGet } from './api-client.js';

const app = document.getElementById('app');
const shell = document.getElementById('shell');
const navLinks = document.getElementById('nav-links');
const breadcrumb = document.getElementById('breadcrumb');

const ROUTE_TITLES = {
  '/dashboard': 'DASHBOARD',
  '/assets': 'ASSET REGISTRY',
  '/map': 'CLUSTER MAP',
  '/locations': 'LOCATIONS',
  '/inventory': 'INVENTORY SYNC',
  '/reports': 'REPORTS',
  '/mobile': 'QR DISTRIBUTION',
  '/users': 'MANAGE USER ACCOUNTS',
  '/analytics': 'SPATIAL ANALYTICS'
};

const CATEGORY_CLASS = {
  SYNC: 'log-sync', IMPORT: 'log-import', ALERT: 'log-alert', UPDATE: 'log-update',
  CONN: 'log-conn', EXPORT: 'log-export', AUTH: 'log-auth', INIT: 'log-init'
};

function renderDashboard() {
  const el = document.createElement('div');
  el.className = 'screen screen-dashboard';
  el.innerHTML = `
    <div class="stat-card-row" id="dashboard-stats">Loading…</div>
    <div class="crt-panel activity-panel">
      <div class="crt-header">
        ACTIVITY LOG // TERMINAL
        <span class="live-feed">● LIVE FEED</span>
      </div>
      <div id="activity-log" class="activity-log">Loading…</div>
    </div>
  `;

  async function loadStats() {
    const result = await apiGet('/api/v1/assets/dashboard-stats');
    const box = el.querySelector('#dashboard-stats');
    if (!result.ok) { box.textContent = 'Unable to load stats.'; return; }
    const s = result.stats;
    box.innerHTML = `
      <div class="stat-card">
        <div class="stat-card-top"><span class="stat-value">${s.totalAssets.toLocaleString()}</span><span class="stat-dot dot-green"></span></div>
        <div class="stat-label">TOTAL ASSETS</div>
        <div class="stat-sub">ALL LOCATIONS</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-top"><span class="stat-value">${s.verifiedToday.toLocaleString()}</span><span class="stat-dot dot-green"></span></div>
        <div class="stat-label">VERIFIED TODAY</div>
        <div class="stat-sub">SINCE 00:00</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-top"><span class="stat-value">${s.pendingSync.toLocaleString()}</span><span class="stat-dot dot-yellow"></span></div>
        <div class="stat-label">PENDING SYNC</div>
        <div class="stat-sub">AWAITING CHECK-IN</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-top"><span class="stat-value">${s.maintenanceDue.toLocaleString()}</span><span class="stat-dot dot-red"></span></div>
        <div class="stat-label">MAINTENANCE DUE</div>
        <div class="stat-sub">FLAGGED ASSETS</div>
      </div>
    `;
  }

  async function loadActivity() {
    const result = await apiGet('/api/v1/system/activity?limit=30');
    const box = el.querySelector('#activity-log');
    if (!result.ok || result.events.length === 0) {
      box.innerHTML = '<p class="empty-hint">No activity yet.</p>';
      return;
    }
    box.innerHTML = result.events.map((ev) => `
      <div class="log-line">
        <span class="log-time">[${ev.created_at.replace('T', ' ').slice(11, 19)}]</span>
        <span class="log-tag ${CATEGORY_CLASS[ev.category] || ''}">${ev.category}</span>
        <span class="log-sep">·</span>
        <span class="log-msg log-level-${ev.level}">${ev.message}</span>
      </div>
    `).join('');
  }

  loadStats();
  loadActivity();
  const poll = setInterval(loadActivity, 6000);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(el)) { clearInterval(poll); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return el;
}

const routes = {
  '/login': renderLogin,
  '/assets': renderAssets,
  '/map': renderMap,
  '/locations': renderLocations,
  '/inventory': renderInventory,
  '/reports': renderReports,
  '/mobile': renderQr,
  '/dashboard': renderDashboard,
  '/users': renderUserManagement,
  '/analytics': renderAnalytics
};

function isAuthed() {
  const token = localStorage.getItem('assettrack_token');
  if (!token) return false;
  // The token lives in localStorage across app restarts but expires after 12h.
  // Drop an expired one up front — otherwise the dashboard renders, its first
  // API call comes back 401, and only then are we bounced to the login screen.
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      localStorage.removeItem('assettrack_token');
      localStorage.removeItem('assettrack_user');
      return false;
    }
  } catch (_) { /* unreadable token: let the server decide */ }
  return true;
}

function setActiveNav(path) {
  [...navLinks.querySelectorAll('a')].forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
  });
}

function updateSidebarUser() {
  const raw = localStorage.getItem('assettrack_user');
  if (!raw) return;
  const user = JSON.parse(raw);
  document.getElementById('sidebar-avatar').textContent = user.username.slice(0, 2).toUpperCase();
  document.getElementById('sidebar-username').textContent = user.username.toUpperCase();
  document.getElementById('sidebar-role').textContent = user.role === 'admin' ? 'SUPERUSER' : 'STAFF';
  // Manage Users is admin-only server-side (requireRole('admin') on every
  // /api/v1/auth/users route) — hide the link entirely for staff accounts
  // rather than showing a screen that will just error on load.
  document.getElementById('nav-users').style.display = user.role === 'admin' ? '' : 'none';
  // Managing Buildings/Rooms is an admin-level configuration task (like
  // Manage Users) — staff still see the resulting rooms everywhere they
  // need them (Cluster Map, Asset Registry's ROOM dropdown, mobile scan),
  // they just don't edit the list itself.
  document.getElementById('nav-locations').style.display = user.role === 'admin' ? '' : 'none';
}

function navigate() {
  let path = window.location.hash.replace('#', '') || '/dashboard';
  if (!isAuthed() && path !== '/login') path = '/login';

  // Manage Users is admin-only — the nav link is hidden for staff, but the
  // route itself needs its own guard too since the hash can be typed
  // directly. The API would reject it anyway (requireRole('admin')), this
  // just avoids showing a broken "Unable to load users" screen first.
  if (path === '/users' || path === '/locations') {
    const raw = localStorage.getItem('assettrack_user');
    const role = raw ? JSON.parse(raw).role : null;
    if (role !== 'admin') path = '/dashboard';
  }

  const renderFn = routes[path] || renderDashboard;
  app.innerHTML = '';
  app.appendChild(renderFn());
  setActiveNav(path);

  shell.classList.toggle('auth-mode', path === '/login');
  breadcrumb.textContent = `› ${ROUTE_TITLES[path] || 'DASHBOARD'}`;
  if (path !== '/login') updateSidebarUser();
  shell.classList.add('ready'); // un-hide the shell (see boot guard in index.html)
}

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('assettrack_token');
  localStorage.removeItem('assettrack_user');
  window.location.hash = '#/login';
});

// Collapsible menu bar: clicking the ☰ toggles the sidebar between full
// width (icons + labels) and a minimized icon-only rail (see the
// #sidebar.collapsed / #shell.sidebar-collapsed rules in retro-theme.css).
// Preference persists across restarts via localStorage.
const sidebarToggleBtn = document.getElementById('btn-sidebar-toggle');
const sidebarEl = document.getElementById('sidebar');
function applySidebarCollapsed(collapsed) {
  sidebarEl.classList.toggle('collapsed', collapsed);
  shell.classList.toggle('sidebar-collapsed', collapsed);
}
applySidebarCollapsed(localStorage.getItem('assettrack_sidebar_collapsed') === '1');
sidebarToggleBtn.addEventListener('click', () => {
  const collapsed = !sidebarEl.classList.contains('collapsed');
  applySidebarCollapsed(collapsed);
  localStorage.setItem('assettrack_sidebar_collapsed', collapsed ? '1' : '0');
});

// Top bar: live clock + local IP, refreshed independently of route changes.
function tickClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('top-clock').textContent = stamp;
}
async function loadTopIp() {
  const result = await apiGet('/api/v1/system/status');
  if (result.ok) document.getElementById('top-ip').textContent = result.status.localIp;
}

setInterval(tickClock, 1000);
tickClock();
loadTopIp();
setInterval(loadTopIp, 30000);

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', navigate);
navigate();
