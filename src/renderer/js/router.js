// js/router.js — client-side hash-based routing. Each feature's ui.js
// exports render(); this router just swaps what's mounted into #app, and
// keeps the header (page title / clock) and the menu drawer in sync.
import { render as renderLogin, renderUserManagement } from '../../features/auth/ui.js';
import { render as renderAssets } from '../../features/assets/ui.js';
import { render as renderMap } from '../../features/mapping/ui-map.js';
import { render as renderLocations } from '../../features/mapping/ui-locations.js';
import { render as renderReports } from '../../features/reports/ui.js';
import { render as renderQr } from '../../features/qr-distribution/ui.js';
import { render as renderInventory } from '../../features/inventory/ui.js';
import { render as renderAnalytics } from '../../features/analytics/ui.js';
import { render as renderDashboard } from '../../features/analytics/ui-dashboard.js';
import { apiGet } from './api-client.js';

const app = document.getElementById('app');
const shell = document.getElementById('shell');
const navLinks = document.getElementById('nav-links');
const pageTitle = document.getElementById('page-title');

const ROUTE_TITLES = {
  '/dashboard': 'Dashboard',
  '/assets': 'Asset registry',
  '/map': 'Cluster map',
  '/locations': 'Locations',
  '/inventory': 'Inventory sync',
  '/reports': 'Reports',
  '/mobile': 'QR distribution',
  '/users': 'Manage user accounts',
  '/analytics': 'Spatial analytics'
};

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

// Signing in does not survive closing the app: main.js loads this page with a
// ?boot=<random id> that changes every time the window is created. A session
// saved by an earlier launch carries a different id, so it is dropped here,
// before the first route runs, and the app opens on the login screen. Reloading
// the page keeps the same id, so a reload does not sign you out.
(function enforceFreshLaunchLogin() {
  const bootId = new URLSearchParams(window.location.search).get('boot');
  if (!bootId) return; // not opened by the desktop app (e.g. a plain browser): leave the session alone
  if (localStorage.getItem('assettrack_boot') !== bootId) {
    localStorage.removeItem('assettrack_token');
    localStorage.removeItem('assettrack_user');
    localStorage.setItem('assettrack_boot', bootId);
  }
})();

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
  const title = ROUTE_TITLES[path] || 'Dashboard';
  pageTitle.textContent = title;
  document.title = `AssetTrack — ${title}`;
  closeMenu();
  if (path !== '/login') updateSidebarUser();
  shell.classList.add('ready'); // un-hide the shell (see boot guard in index.html)
}

function logout() {
  localStorage.removeItem('assettrack_token');
  localStorage.removeItem('assettrack_user');
  window.location.hash = '#/login';
}

// Log out asks first. A native <dialog> gives focus trapping and Esc-to-cancel
// for free; Cancel gets the initial focus so Enter never logs you out by accident.
const logoutDialog = document.createElement('dialog');
logoutDialog.className = 'confirm-dialog';
logoutDialog.setAttribute('aria-labelledby', 'logout-confirm-title');
logoutDialog.innerHTML = `
  <div class="confirm-bar">
    <span class="confirm-code">confirm</span>
    <button type="button" class="confirm-x" id="logout-x" aria-label="Close">&times;</button>
  </div>
  <div class="confirm-body">
    <h2 class="confirm-title" id="logout-confirm-title">Log out?</h2>
    <p class="confirm-text">Are you sure you want to log out? You will be returned to the login screen.</p>
    <div class="confirm-actions">
      <button type="button" class="btn-retro outline" id="logout-cancel" autofocus>Cancel</button>
      <button type="button" class="btn-retro" id="logout-confirm">Log out</button>
    </div>
  </div>
`;
document.body.appendChild(logoutDialog);

document.getElementById('btn-logout').addEventListener('click', () => logoutDialog.showModal());
logoutDialog.querySelector('#logout-cancel').addEventListener('click', () => logoutDialog.close());
logoutDialog.querySelector('#logout-x').addEventListener('click', () => logoutDialog.close());
logoutDialog.querySelector('#logout-confirm').addEventListener('click', () => { logoutDialog.close(); logout(); });
// A click on the dimmed backdrop (the dialog element itself) cancels too.
logoutDialog.addEventListener('click', (e) => { if (e.target === logoutDialog) logoutDialog.close(); });

// Menu: the icon at the top right of the header opens a drawer with the
// navigation, the signed-in user and Log out. It closes on a link click, the
// close button, the dimmed backdrop, or Escape.
const menuBtn = document.getElementById('btn-menu');
const menuClose = document.getElementById('btn-menu-close');
const menuDrawer = document.getElementById('menu-drawer');
const menuScrim = document.getElementById('menu-scrim');

function openMenu(viaKeyboard) {
  menuDrawer.hidden = false;
  menuScrim.hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  // Move focus into the drawer only for keyboard users, so a mouse click doesn't leave a focus highlight on the page link.
  if (!viaKeyboard) return;
  const target = menuDrawer.querySelector('#nav-links a.active') || menuDrawer.querySelector('#nav-links a');
  if (target) target.focus();
}
function closeMenu() {
  if (menuDrawer.hidden) return;
  menuDrawer.hidden = true;
  menuScrim.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', (e) => (menuDrawer.hidden ? openMenu(e.detail === 0) : closeMenu()));
menuClose.addEventListener('click', () => { closeMenu(); menuBtn.focus(); });
menuScrim.addEventListener('click', closeMenu);
menuDrawer.addEventListener('click', (e) => { if (e.target.closest('#nav-links a')) closeMenu(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menuDrawer.hidden && !logoutDialog.open) { closeMenu(); menuBtn.focus(); }
});

// Header: live time and date, refreshed independently of route changes.
function tickClock() {
  const now = new Date();
  document.getElementById('top-time').textContent =
    now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  document.getElementById('top-date').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
