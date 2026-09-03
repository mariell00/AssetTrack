// js/router.js — client-side hash-based routing. Each feature's ui.js
// exports render(); this router just swaps what's mounted into #app.
import { render as renderLogin } from '../../features/auth/ui.js';
import { render as renderAssets } from '../../features/assets/ui.js';
import { render as renderMap } from '../../features/mapping/ui-map.js';
import { render as renderReports } from '../../features/reports/ui.js';
import { render as renderQr } from '../../features/qr-distribution/ui.js';
import { render as renderInventoryPanel } from '../../features/inventory/ui.js';

const app = document.getElementById('app');
const navLinks = document.getElementById('nav-links');
const hostLabel = document.getElementById('host-label');

const routes = {
  '/login': renderLogin,
  '/assets': renderAssets,
  '/map': renderMap,
  '/reports': renderReports,
  '/mobile': renderQr,
  '/dashboard': renderDashboard
};

function renderDashboard() {
  const el = document.createElement('div');
  el.className = 'screen screen-dashboard scanline';
  el.innerHTML = `<div class="crt-panel"><div class="crt-header"><span class="crt-dot"></span> SYSTEM DASHBOARD</div><div id="dash-body" style="padding:16px"></div></div>`;
  el.querySelector('#dash-body').appendChild(renderInventoryPanel());
  return el;
}

function isAuthed() {
  return !!localStorage.getItem('assettrack_token');
}

function setActiveNav(path) {
  [...navLinks.querySelectorAll('a')].forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === `#${path}`);
  });
}

function navigate() {
  let path = window.location.hash.replace('#', '') || '/dashboard';
  if (!isAuthed() && path !== '/login') path = '/login';

  const renderFn = routes[path] || renderDashboard;
  app.innerHTML = '';
  app.appendChild(renderFn());
  setActiveNav(path);

  document.getElementById('sidebar').style.display = path === '/login' ? 'none' : 'flex';
}

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('assettrack_token');
  localStorage.removeItem('assettrack_user');
  window.location.hash = '#/login';
});

if (window.assetTrackHost) {
  hostLabel.textContent = `HOST: ${window.assetTrackHost.hostname}`;
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', navigate);
navigate();
