// AssetTrack Admin web app — a browser client for `admin` accounts, styled like the desktop app.
// It identifies itself with X-Client-Type: web. The server refuses every write from a web session
// except "propose an edit to one asset", which only enters the super admin's review queue.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
    del: (k) => { try { sessionStorage.removeItem(k); } catch { /* private mode */ } }
  };
  let token = store.get('at_web_token');

  async function request(path, opts = {}) {
    const res = await fetch('/api/v1' + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Client-Type': 'web', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401 && token && !opts.noAuthRedirect) { signOut(); throw new Error('Your session has ended. Please log in again.'); }
    return res;
  }
  async function api(path, opts) {
    const res = await request(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Request failed.');
    return data;
  }

  // ---- auth -----------------------------------------------------------
  function signOut() {
    token = null; store.del('at_web_token'); store.del('at_web_user'); closeMenu();
    $('#shell').hidden = true; $('#login').hidden = false;
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), err = $('#login-error');
    err.textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', noAuthRedirect: true, body: { username: f.get('username'), password: f.get('password') } });
      token = data.token; store.set('at_web_token', token); store.set('at_web_user', data.user.username);
      e.target.reset(); start();
    } catch (ex) { err.textContent = ex.message; }
  });
  $('#logout').addEventListener('click', signOut);

  // ---- header clock, menu drawer, server status ------------------------
  const tick = () => {
    const d = new Date();
    $('#top-time').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#top-date').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };
  setInterval(tick, 15000); tick();
  const openMenu = () => { $('#menu-drawer').hidden = false; $('#menu-scrim').hidden = false; $('#btn-menu').setAttribute('aria-expanded', 'true'); $('#btn-menu-close').focus(); };
  function closeMenu() { $('#menu-drawer').hidden = true; $('#menu-scrim').hidden = true; $('#btn-menu').setAttribute('aria-expanded', 'false'); }
  $('#btn-menu').addEventListener('click', openMenu);
  $('#btn-menu-close').addEventListener('click', closeMenu);
  $('#menu-scrim').addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#menu-drawer').hidden) closeMenu(); });
  $('#nav-links').addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  async function ping() {
    try { const r = await fetch('/api/v1/health', { cache: 'no-store' }); const ok = r.ok; $('#dot').className = 'status-dot ' + (ok ? 'on' : 'off'); $('#srv').textContent = ok ? 'Server online' : 'Server offline'; }
    catch { $('#dot').className = 'status-dot off'; $('#srv').textContent = 'Server offline'; }
  }
  setInterval(() => { if (token) ping(); }, 30000);

  // ---- helpers ----------------------------------------------------------
  const view = $('#view');
  const fail = (ex) => { view.innerHTML = `<div class="panel"><p class="form-error">${esc(ex.message)}</p></div>`; };
  const badge = (cls, v) => `<span class="badge ${cls}">${esc(v || '—')}</span>`;
  const tone = { active: 'b-ok', good: 'b-ok', pending: 'b-warn', maintenance: 'b-warn', fair: 'b-warn', offline: 'b-bad', poor: 'b-bad' };
  const table = (head, rows, empty) => `<div class="tablewrap"><table class="retro-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="muted">${empty}</td></tr>`}</tbody></table></div>`;
  const head = (title) => `<div class="screen-head"><h2>${title}</h2></div>`;

  // ---- screens ----------------------------------------------------------
  async function dashboard() {
    view.innerHTML = head('Dashboard') + '<p class="muted">Loading…</p>';
    try {
      const [{ stats }, { rooms }] = await Promise.all([api('/assets/dashboard-stats'), api('/inventory/progress')]);
      const card = (n, l) => `<div class="stat-card"><div class="stat-value">${esc(n)}</div><div class="stat-label">${l}</div></div>`;
      view.innerHTML = `<div class="stat-card-row">${card(stats.totalAssets, 'Total assets')}${card(stats.verifiedToday, 'Verified today')}${card(stats.pendingSync, 'Awaiting super admin review')}${card(stats.maintenanceDue, 'In maintenance')}</div>
        <section class="panel"><h3 class="panel-title">Room verification today</h3><div class="tablewrap"><table class="retro-table"><thead><tr><th>Room</th><th>Verified</th><th>Expected</th><th>Awaiting</th><th>Progress</th><th>Last sync</th></tr></thead><tbody>
        ${rooms.map((r) => `<tr><td>${esc(r.room_name)}</td><td>${esc(r.verified)}</td><td>${esc(r.expected)}</td><td>${esc(r.awaiting)}</td>
          <td><div class="progress-track" title="${esc(r.pct)}%"><div class="progress-fill" style="width:${Math.min(100, Number(r.pct) || 0)}%"></div></div></td><td>${esc(r.last_sync || '—')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No rooms yet.</td></tr>'}
        </tbody></table></div></section>`;
    } catch (ex) { fail(ex); }
  }

  async function assets() {
    view.innerHTML = `<section class="panel"><div class="toolbar"><input id="q" class="retro-input" type="search" placeholder="Search tag, name, serial, property no., custodian…" aria-label="Search assets"><span id="count" class="record-count"></span></div>
      <div class="tablewrap"><table class="retro-table"><thead><tr><th>Tag</th><th>Name</th><th>Category</th><th>Room</th><th>Assigned to</th><th>Condition</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table></div></section>`;
    let seq = 0, timer;
    const load = async () => {
      const mine = ++seq;
      try {
        const { assets: list } = await api('/assets?lite=1&search=' + encodeURIComponent($('#q').value.trim()));
        if (mine !== seq) return;
        $('#count').textContent = list.length + ' asset' + (list.length === 1 ? '' : 's');
        $('#rows').innerHTML = list.map((a) => `<tr data-id="${esc(a.id)}" tabindex="0"><td><strong>${esc(a.asset_tag)}</strong></td><td>${esc(a.name)}</td><td>${esc(a.category)}</td><td>${esc(a.room_name)}</td><td>${esc(a.assigned_to)}</td>
          <td>${badge(tone[a.condition], a.condition)}</td><td>${badge(tone[a.status], a.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No assets found.</td></tr>';
      } catch (ex) { if (mine === seq) $('#rows').innerHTML = `<tr><td colspan="7" class="form-error">${esc(ex.message)}</td></tr>`; }
    };
    $('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    load();
  }

  async function locations() {
    view.innerHTML = head('Locations') + '<p class="muted">Loading…</p>';
    try {
      const { rooms } = await api('/map/rooms/list');
      view.innerHTML = '<section class="panel">' + table(['Building', 'Room', 'Floor', 'Assets'], rooms.map((r) => [r.building_name || '—', r.name, r.floor || '—', r.asset_count]), 'No rooms yet.') + '</section>';
    } catch (ex) { fail(ex); }
  }

  async function assignees() {
    view.innerHTML = head('Assignees') + '<p class="muted">Loading…</p>';
    try {
      const { assignees: list } = await api('/assignees');
      view.innerHTML = '<section class="panel">' + table(['Name', 'Position', 'Department', 'Assets', 'Status'], list.map((p) => [p.name, p.position || '—', p.department || '—', p.asset_count, p.status]), 'No assignees yet.') + '</section>';
    } catch (ex) { fail(ex); }
  }

  const rangeQuery = () => ['from', 'to'].map((k) => ($('#r-' + k) && $('#r-' + k).value ? `&${k}=${encodeURIComponent($('#r-' + k).value)}` : '')).join('');
  function reports() {
    view.innerHTML = `<section class="panel" style="max-width:560px"><h3 class="panel-title">Audit report</h3>
      <div class="toolbar"><label>From <input id="r-from" class="retro-input" type="date"></label><label>To <input id="r-to" class="retro-input" type="date"></label></div>
      <p id="r-preview" class="muted">Choose a date range, or leave it empty for everything.</p>
      <button class="btn-retro outline small" id="r-prev">Preview</button>
      <button class="btn-retro small" data-report="pdf">Download PDF</button> <button class="btn-retro small" data-report="xlsx">Download Excel</button></section>`;
    $('#r-prev').addEventListener('click', async () => {
      try { const { preview: p } = await api('/reports/preview?' + rangeQuery().slice(1)); $('#r-preview').textContent = `${p.total_records} records across ${p.rooms_count} room(s).`; }
      catch (ex) { $('#r-preview').textContent = ex.message; }
    });
  }
  async function downloadReport(format) {
    try {
      const res = await request('/reports/download?format=' + format + rangeQuery());
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Report failed.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob()); a.download = 'assettrack-audit.' + format; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (ex) { $('#r-preview').textContent = ex.message; }
  }

  // ---- asset detail + propose a change ------------------------------------
  const dlg = $('#dlg');
  $('#dlg-close').addEventListener('click', () => dlg.close());
  async function showAsset(id) {
    $('#dlg-body').innerHTML = '<p class="muted">Loading…</p>'; dlg.showModal();
    try {
      const [{ asset: a }, qr, { rooms }, { assignees: people }] = await Promise.all([
        api(`/assets/${encodeURIComponent(id)}/detail`), api(`/assets/${encodeURIComponent(id)}/qr`), api('/map/rooms/list'), api('/assignees?status=active')]);
      const rows = [['Asset tag', a.asset_tag], ['Category', a.category], ['Description', a.description], ['Room', [a.building_name, a.room_name].filter(Boolean).join(' · ')],
        ['Assigned to', a.assigned_to], ['Condition', a.condition], ['Status', a.status], ['Property no.', a.property_no], ['Serial no.', a.serial_no],
        ['Value (PHP)', a.value_php], ['Acquired', a.acquired_date], ['Last scanned', a.last_scanned], ['Open issues', a.open_issues]];
      const opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(label ?? v)}</option>`;
      dlg.dataset.orig = JSON.stringify({ room_id: String(a.room_id ?? ''), assigned_to: a.assigned_to ?? '', condition: a.condition ?? '', status: a.status ?? '', quantity: String(a.quantity ?? 1) });
      $('#dlg-body').innerHTML = `<h3>${esc(a.name)}</h3><dl>${rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <img class="qr" alt="QR label for ${esc(a.asset_tag)}" src="${esc(qr.dataUrl)}">
        <form id="edit-form" data-id="${esc(a.id)}"><h4>Propose a change</h4><p class="muted">Nothing changes until the super admin verifies it.</p>
          <div class="grid2">
          <label>Location <select class="retro-input" name="room_id">${opt('', a.room_id, '— none —')}${rooms.map((r) => opt(r.id, a.room_id, (r.building_name ? r.building_name + ' · ' : '') + r.name)).join('')}</select></label>
          <label>Assigned to <select class="retro-input" name="assigned_to">${opt('', a.assigned_to, '— nobody —')}${people.map((p) => opt(p.name, a.assigned_to)).join('')}</select></label>
          <label>Condition <select class="retro-input" name="condition">${['good', 'fair', 'poor'].map((c) => opt(c, a.condition)).join('')}</select></label>
          <label>Status <select class="retro-input" name="status">${['active', 'pending', 'maintenance', 'offline'].map((c) => opt(c, a.status)).join('')}</select></label>
          <label>Quantity <input class="retro-input" name="quantity" type="number" min="0" step="1" value="${esc(a.quantity ?? 1)}"></label></div>
          <p id="edit-msg" class="form-error" role="status"></p><button class="btn-retro small" type="submit">Send for verification</button></form>`;
    } catch (ex) { $('#dlg-body').innerHTML = `<p class="form-error">${esc(ex.message)}</p>`; }
  }
  dlg.addEventListener('submit', async (e) => {
    if (e.target.id !== 'edit-form') return;
    e.preventDefault();
    const orig = JSON.parse(dlg.dataset.orig || '{}'), f = new FormData(e.target), body = {}, msg = $('#edit-msg');
    for (const k of Object.keys(orig)) {
      const v = String(f.get(k) ?? '');
      if (v === orig[k]) continue;
      body[k] = k === 'room_id' ? (v === '' ? null : Number(v)) : k === 'quantity' ? Number(v) : (k === 'assigned_to' && v === '' ? null : v);
    }
    msg.className = 'form-error';
    if (!Object.keys(body).length) { msg.textContent = 'You haven’t changed anything.'; return; }
    try {
      await api('/assets/' + encodeURIComponent(e.target.dataset.id), { method: 'PUT', body });
      msg.className = 'form-ok'; msg.textContent = 'Sent. The super admin will verify it before it takes effect.';
    } catch (ex) { msg.textContent = ex.message; }
  });

  view.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]'); if (row) showAsset(row.dataset.id);
    const rep = e.target.closest('[data-report]'); if (rep) downloadReport(rep.dataset.report);
  });
  view.addEventListener('keydown', (e) => { const row = e.target.closest && e.target.closest('tr[data-id]'); if (row && e.key === 'Enter') showAsset(row.dataset.id); });

  // ---- routing --------------------------------------------------------
  const routes = { dashboard, assets, locations, assignees, reports };
  const titles = { dashboard: 'Dashboard', assets: 'Asset registry', locations: 'Locations', assignees: 'Assignees', reports: 'Reports' };
  function route() {
    const name = routes[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
    $('#page-title').textContent = titles[name];
    routes[name]();
  }
  function start() {
    $('#login').hidden = true; $('#shell').hidden = false;
    const u = store.get('at_web_user') || 'Admin';
    $('#who').textContent = u; $('#avatar').textContent = u.slice(0, 2).toUpperCase(); $('#host').textContent = location.host;
    ping(); route();
  }
  window.addEventListener('hashchange', () => { if (token) route(); });
  if (token) start(); else $('#login').hidden = false;
})();
