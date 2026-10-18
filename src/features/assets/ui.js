// features/assets/ui.js — "Asset Registry" screen: search + sort, a table of
// assets (click a row for the full-detail pop-up with Edit / QR label / Delete),
// the add/edit modal, CSV/XLSX bulk import and printable QR labels.
import { apiGet, apiPost, apiPut, apiDelete } from '../../js/api-client.js';
import { compressImageFile } from '../../js/photo.js';

const STATUS_LABELS = { active: 'ACTIVE', maintenance: 'MAINT.', pending: 'PENDING', offline: 'OFFLINE' };

function statusBadge(status) {
  const s = status || 'active';
  return `<span class="badge badge-asset-${s}">${STATUS_LABELS[s] || s.toUpperCase()}</span>`;
}

// Themed replacement for window.confirm(): a native <dialog> in the app's
// style (same look as the Log out pop-up). Resolves true on confirm, false on
// Cancel / Esc / the X / a click on the backdrop. Cancel has the initial focus.
function confirmDialog({ title, messageHtml, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.setAttribute('aria-labelledby', 'confirm-dialog-title');
    dlg.innerHTML = `
      <div class="confirm-bar">
        <span class="confirm-code">confirm</span>
        <button type="button" class="confirm-x" data-act="cancel" aria-label="Close">&times;</button>
      </div>
      <div class="confirm-body">
        <h2 class="confirm-title" id="confirm-dialog-title">${esc(title)}</h2>
        <p class="confirm-text">${messageHtml}</p>
        <div class="confirm-actions">
          <button type="button" class="btn-retro outline" data-act="cancel" autofocus>Cancel</button>
          <button type="button" class="btn-retro${danger ? ' danger' : ''}" data-act="ok">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    let result = false;
    dlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) { result = act.dataset.act === 'ok'; dlg.close(); }
      else if (e.target === dlg) dlg.close(); // backdrop click cancels
    });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
  });
}

// Shows the QR code for one asset (as returned by GET /api/v1/assets/:id/qr)
// with buttons to download the PNG or open a print-formatted popup — for
// sticking a physical label on the asset that the mobile Scan screen can
// read straight away.
function showQrLabelModal(root, { asset_tag, name, dataUrl }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel qr-label-box">
      <div class="crt-header">
        <span class="crt-dot"></span> ASSET QR LABEL
        <button class="modal-close" id="qr-modal-close">✕</button>
      </div>
      <div class="qr-label-body">
        <img src="${dataUrl}" alt="QR code for ${asset_tag}" class="qr-label-img" />
        <div class="qr-label-tag mono-strong">${asset_tag}</div>
        <div class="qr-label-name">${name}</div>
        <div class="qr-label-actions">
          <button class="btn-retro small outline" id="qr-btn-download">⭳ DOWNLOAD PNG</button>
          <button class="btn-retro small" id="qr-btn-print">⎙ PRINT LABEL</button>
        </div>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector('#qr-modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#qr-btn-download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${asset_tag}-qr.png`;
    a.click();
  });

  overlay.querySelector('#qr-btn-print').addEventListener('click', () => {
    const win = window.open('', '_blank', 'width=380,height=480');
    if (!win) return; // popup blocked — download still works
    win.document.write(`
      <html>
        <head>
          <title>${asset_tag} label</title>
          <style>
            body { font-family: 'Courier New', monospace; text-align: center; padding: 24px; }
            img { width: 220px; height: 220px; }
            h2 { margin: 10px 0 2px; letter-spacing: 1px; }
            p { margin: 0 0 16px; color: #555; }
          </style>
        </head>
        <body>
          <img src="${dataUrl}" />
          <h2>${asset_tag}</h2>
          <p>${name}</p>
          <script>window.onload = () => window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  });
}

// Rooms are now a managed list (see mapping/ui-locations.js) grouped by
// Building, instead of a free-typed name — this is what the ROOM <select>
// below is populated from, so scanning/registering picks from what's
// actually listed rather than risking "Lab 201" vs "Room 201" typos.
function roomOptionsHtml(rooms, selectedRoomId) {
  const grouped = new Map(); // building_name (or null) -> rooms[]
  for (const r of rooms) {
    const key = r.building_name || null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }
  const optionHtml = (r) => `<option value="${r.id}" ${Number(selectedRoomId) === r.id ? 'selected' : ''}>${r.name}</option>`;

  let html = `<option value="">— Unassigned —</option>`;
  for (const [buildingName, roomsInBuilding] of grouped) {
    html += buildingName
      ? `<optgroup label="${buildingName}">${roomsInBuilding.map(optionHtml).join('')}</optgroup>`
      : roomsInBuilding.map(optionHtml).join(''); // no building set yet — flat, ungrouped
  }
  return html;
}

// Category choices for the register/edit form — edit this list to change the
// dropdown. A category already saved on an asset (e.g. from a CSV import) that
// isn't listed here is added as an extra option, so editing never drops it.
const CATEGORY_OPTIONS = [
  'Personal Computer', 'Laptop', 'Monitor', 'Printer', 'Projector',
  'Network Equipment', 'Air Conditioner', 'Furniture', 'Laboratory Equipment', 'Other'
];

function categoryOptionsHtml(selected) {
  const extra = selected && !CATEGORY_OPTIONS.includes(selected) ? [selected] : [];
  return `<option value="">— Select category —</option>`
    + [...CATEGORY_OPTIONS, ...extra].map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

// PLACEHOLDER: the assignee list will come from a separate board that isn't
// built yet. Until then the dropdown offers Unassigned, plus whoever is already
// assigned (so editing an asset never wipes its current assignee).
function assigneeOptionsHtml(current) {
  return `<option value="">— Unassigned —</option>`
    + (current ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : '')
    + `<option disabled>Assignee list coming soon</option>`;
}

async function openAssetModal(root, { asset } = {}) {
  const isEdit = !!asset;
  const roomsResult = await apiGet('/api/v1/map/rooms/list');
  const rooms = roomsResult.ok ? roomsResult.rooms : [];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel asset-form-box">
      <div class="crt-header">
        <span class="crt-dot"></span> ${isEdit ? 'EDIT ASSET' : 'REGISTER ASSET'}
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <form id="asset-form" class="retro-form modal-form">
        ${isEdit ? `<label>ASSET ID
          <input type="text" class="retro-input" value="${esc(asset.asset_tag)}" readonly aria-readonly="true" />
        </label>` : ''}
        <label>NAME
          <input type="text" id="f-name" class="retro-input" value="${asset ? asset.name : ''}" required />
        </label>
        <label>CATEGORY
          <select id="f-category" class="retro-input">${categoryOptionsHtml(asset ? asset.category : '')}</select>
        </label>
        <label>ROOM
          <select id="f-room" class="retro-input">${roomOptionsHtml(rooms, asset ? asset.room_id : '')}</select>
        </label>
        <label>ASSIGNED TO (ASSET USER)
          <select id="f-assigned" class="retro-input">${assigneeOptionsHtml(asset ? asset.assigned_to : '')}</select>
        </label>
        <label id="f-assigned-photo-field">ASSIGNED USER PHOTO <span class="mono-dim">(optional${isEdit ? ' — leave as-is to keep the current one' : ''})</span>
          <div class="photo-field-row">
            <img id="f-assigned-photo-preview" class="photo-preview photo-preview-round" src="${asset && asset.assigned_photo ? asset.assigned_photo : ''}" style="${asset && asset.assigned_photo ? '' : 'display:none;'}" alt="" />
            <label class="btn-retro small outline file-btn">
              <span id="f-assigned-photo-label">${asset && asset.assigned_photo ? 'CHANGE PHOTO' : 'ATTACH PHOTO'}</span>
              <input type="file" id="f-assigned-photo" accept="image/*" hidden />
            </label>
          </div>
        </label>
        <label>STATUS
          <select id="f-status" class="retro-input">
            ${Object.entries(STATUS_LABELS).map(([val, label]) =>
              `<option value="${val}" ${asset && asset.status === val ? 'selected' : ''}>${label}</option>`
            ).join('')}
          </select>
        </label>
        <label>PHOTO <span class="mono-dim">(optional${isEdit ? ' — leave as-is to keep the current one' : ''})</span>
          <div class="photo-field-row">
            <img id="f-photo-preview" class="photo-preview" src="${asset && asset.photo ? asset.photo : ''}" style="${asset && asset.photo ? '' : 'display:none;'}" alt="" />
            <label class="btn-retro small outline file-btn">
              <span id="f-photo-label">${asset && asset.photo ? 'CHANGE PHOTO' : 'ATTACH PHOTO'}</span>
              <input type="file" id="f-photo" accept="image/*" hidden />
            </label>
          </div>
        </label>
        <button type="submit" class="btn-retro">${isEdit ? '▶ SAVE CHANGES' : '▶ REGISTER ASSET'}</button>
        <p id="modal-error" class="form-error"></p>
      </form>
    </div>
  `;
  root.appendChild(overlay);

  overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  let newPhotoDataUrl = null; // stays null unless a new photo is picked, so saving without touching it keeps the existing one on edit
  const photoInput = overlay.querySelector('#f-photo');
  const photoPreview = overlay.querySelector('#f-photo-preview');
  const photoLabel = overlay.querySelector('#f-photo-label');
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    photoLabel.textContent = 'COMPRESSING…';
    try {
      newPhotoDataUrl = await compressImageFile(file);
      photoPreview.src = newPhotoDataUrl;
      photoPreview.style.display = 'block';
      photoLabel.textContent = 'CHANGE PHOTO';
    } catch {
      newPhotoDataUrl = null;
      photoLabel.textContent = 'ATTACH PHOTO — failed, try again';
    }
  });

  // The assigned user's photo is saved against the assignee, so the field only
  // makes sense once someone is picked.
  const assignedSelect = overlay.querySelector('#f-assigned');
  const assignedPhotoField = overlay.querySelector('#f-assigned-photo-field');
  const syncAssignedPhotoField = () => { assignedPhotoField.style.display = assignedSelect.value ? '' : 'none'; };
  assignedSelect.addEventListener('change', syncAssignedPhotoField);
  syncAssignedPhotoField();

  // Same pattern as the item photo above, but for the assigned user's
  // profile picture (assets.assigned_photo) — shown as an avatar on the
  // Cluster Map instead of initials once set (see ui-map.js).
  let newAssignedPhotoDataUrl = null;
  const assignedPhotoInput = overlay.querySelector('#f-assigned-photo');
  const assignedPhotoPreview = overlay.querySelector('#f-assigned-photo-preview');
  const assignedPhotoLabel = overlay.querySelector('#f-assigned-photo-label');
  assignedPhotoInput.addEventListener('change', async () => {
    const file = assignedPhotoInput.files[0];
    if (!file) return;
    assignedPhotoLabel.textContent = 'COMPRESSING…';
    try {
      newAssignedPhotoDataUrl = await compressImageFile(file);
      assignedPhotoPreview.src = newAssignedPhotoDataUrl;
      assignedPhotoPreview.style.display = 'block';
      assignedPhotoLabel.textContent = 'CHANGE PHOTO';
    } catch {
      newAssignedPhotoDataUrl = null;
      assignedPhotoLabel.textContent = 'ATTACH PHOTO — failed, try again';
    }
  });

  overlay.querySelector('#asset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    // No asset_tag in the payload: the Asset ID is generated by the server on
    // create, and left untouched on edit (QR labels already encode it).
    const payload = {
      name: overlay.querySelector('#f-name').value.trim(),
      category: overlay.querySelector('#f-category').value || null,
      assigned_to: assignedSelect.value || null,
      status: overlay.querySelector('#f-status').value
    };
    // Room comes from the managed list (mapping/ui-locations.js) as a
    // room_id now, rather than a free-typed name the backend had to
    // resolve/create on the fly — "" (Unassigned) becomes null.
    const roomValue = overlay.querySelector('#f-room').value;
    payload.room_id = roomValue ? Number(roomValue) : null;
    // Only send `photo`/`assigned_photo` if a new one was actually picked —
    // omitting the key (rather than sending null) is what keeps
    // updateAsset() from wiping out an existing photo on an edit that
    // didn't touch it.
    if (newPhotoDataUrl) payload.photo = newPhotoDataUrl;
    if (newAssignedPhotoDataUrl) payload.assigned_photo = newAssignedPhotoDataUrl;

    const result = isEdit
      ? await apiPut(`/api/v1/assets/${asset.id}`, payload)
      : await apiPost('/api/v1/assets', payload);

    if (!result.ok) {
      overlay.querySelector('#modal-error').textContent = result.error || 'Save failed.';
      return;
    }
    overlay.remove();
    document.dispatchEvent(new CustomEvent('assettrack:assets-changed'));

    // Newly registered asset — immediately generate its QR label so it can
    // be printed and stuck on the item before it leaves the supply office.
    if (!isEdit) {
      const qr = await apiGet(`/api/v1/assets/${result.asset.id}/qr`);
      if (qr.ok) showQrLabelModal(root, qr);
    }
  });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDateTime(sqlDate) {
  // SQLite "YYYY-MM-DD HH:MM:SS" is UTC; show it in the viewer's local time.
  if (!sqlDate) return '—';
  const d = new Date(String(sqlDate).replace(' ', 'T') + (String(sqlDate).includes('T') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return esc(sqlDate);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).length <= 10 ? `${value}T00:00:00` : String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return esc(value);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const SCAN_LABELS = { verified: 'VERIFIED', missing: 'MISSING', misplaced: 'MISPLACED' };

// Full-detail pop-up for one asset: everything we know about it, plus the
// actions that used to sit in the table (QR label, Edit, Delete).
async function openAssetDetailModal(root, assetId) {
  const result = await apiGet(`/api/v1/assets/${assetId}/detail`);
  if (!result.ok) { alert(result.error || 'Could not load this asset.'); return; }
  const a = result.asset;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const field = (label, value) => `
    <div class="ad-field"><span class="ad-label">${label}</span><span class="ad-value">${value}</span></div>`;
  const location = [a.building_name, a.room_name].filter(Boolean).map(esc).join(' › ') || '—';

  overlay.innerHTML = `
    <div class="modal-box crt-panel asset-detail-box" role="dialog" aria-modal="true" aria-label="Asset details">
      <div class="crt-header">
        <span class="crt-dot"></span> ASSET DETAILS
        <button class="modal-close" id="ad-close" aria-label="Close">✕</button>
      </div>

      <div class="ad-scroll">
      <div class="ad-top">
        ${a.photo
          ? `<img class="ad-photo" src="${a.photo}" alt="Photo of ${esc(a.name)}" />`
          : '<div class="ad-photo ad-photo-empty">NO PHOTO</div>'}
        <div class="ad-id">
          <div class="ad-tag">${esc(a.asset_tag)}</div>
          <div class="ad-name">${esc(a.name)}</div>
          <div>${statusBadge(a.status)}</div>
        </div>
      </div>

      <div class="ad-grid">
        ${field('Category', esc(a.category) || '—')}
        ${field('Condition', esc(a.condition ? a.condition.charAt(0).toUpperCase() + a.condition.slice(1) : '') || '—')}
        ${field('Location', location)}
        ${field('Assigned to', a.assigned_to
          ? `${a.assigned_photo ? `<img src="${a.assigned_photo}" class="assigned-row-photo" alt="" />` : ''}${esc(a.assigned_to)}`
          : '—')}
        ${field('Registered', formatDateTime(a.created_at))}
        ${field('Last scanned', formatDateTime(a.last_scanned))}
      </div>

      ${a.description ? `<div class="ad-section"><h3>Description</h3><p class="ad-text">${esc(a.description)}</p></div>` : ''}

      <div class="ad-section">
        <h3>Open issues <span class="mono-dim">(${a.open_issues})</span></h3>
        ${a.issues && a.issues.length ? a.issues.map((i) => `
          <div class="ad-row">
            <span class="badge ${i.resolved ? 'badge-asset-active' : 'badge-asset-offline'}">${i.resolved ? 'RESOLVED' : 'OPEN'}</span>
            <span class="ad-row-main">${esc(i.note)}</span>
            <span class="ad-row-meta">${esc(i.reported_by)} · ${formatDate(i.created_at)}</span>
          </div>`).join('') : '<p class="ad-empty">No issues reported.</p>'}
      </div>

      <div class="ad-section">
        <h3>Recent scans</h3>
        ${a.recent_scans && a.recent_scans.length ? a.recent_scans.map((s) => `
          <div class="ad-row">
            <span class="badge badge-scan-${esc(s.status)}">${SCAN_LABELS[s.status] || esc(s.status).toUpperCase()}</span>
            <span class="ad-row-main">${esc(s.room_name) || '—'}</span>
            <span class="ad-row-meta">${esc(s.scanned_by)} · ${formatDateTime(s.scanned_at)}</span>
          </div>`).join('') : '<p class="ad-empty">Not scanned yet.</p>'}
      </div>

      </div>

      <div class="ad-actions">
        <button class="btn-retro small danger" id="ad-delete">DELETE</button>
        <button class="btn-retro small outline" id="ad-qr">QR LABEL</button>
        <button class="btn-retro small" id="ad-edit">EDIT</button>
      </div>
    </div>
  `;
  root.appendChild(overlay);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    // Escape closes the detail pop-up, unless another pop-up (QR label / edit) is on top of it.
    if (e.key === 'Escape' && overlay.nextElementSibling === null && !document.querySelector('dialog.confirm-dialog[open]')) close();
  };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('#ad-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#ad-close').focus();

  overlay.querySelector('#ad-qr').addEventListener('click', async () => {
    const qr = await apiGet(`/api/v1/assets/${a.id}/qr`);
    if (qr.ok) showQrLabelModal(root, qr);
  });
  overlay.querySelector('#ad-edit').addEventListener('click', () => {
    close();
    openAssetModal(root, { asset: a });
  });
  overlay.querySelector('#ad-delete').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete asset?',
      messageHtml: `Delete <strong>${esc(a.asset_tag)}</strong> (${esc(a.name)})? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    await apiDelete(`/api/v1/assets/${a.id}`);
    close();
    document.dispatchEvent(new CustomEvent('assettrack:assets-changed'));
  });
}

// ---- sorting ----
const SORT_OPTIONS = [
  { key: 'asset_tag', label: 'Asset ID' },
  { key: 'name', label: 'Name' },
  { key: 'assigned_to', label: 'Assigned to' },
  { key: 'room_name', label: 'Room' },
  { key: 'status', label: 'Status' },
  { key: 'created_at', label: 'Date added' }
];
// Status sorts by urgency rather than alphabetically: working assets first.
const STATUS_ORDER = { active: 0, pending: 1, maintenance: 2, offline: 3 };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortAssets(assets, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const valueOf = (a) => (key === 'status' ? (STATUS_ORDER[a.status || 'active'] ?? 9) : a[key]);
  return [...assets].sort((x, y) => {
    const vx = valueOf(x), vy = valueOf(y);
    const ex = vx === null || vx === undefined || vx === '';
    const ey = vy === null || vy === undefined || vy === '';
    if (ex || ey) return ex && ey ? 0 : (ex ? 1 : -1); // empty values always sink to the bottom
    const cmp = typeof vx === 'number' && typeof vy === 'number' ? vx - vy : collator.compare(String(vx), String(vy));
    return cmp * sign || collator.compare(String(x.asset_tag), String(y.asset_tag));
  });
}

function loadSortPref() {
  try {
    const p = JSON.parse(localStorage.getItem('assettrack_asset_sort') || 'null');
    if (p && SORT_OPTIONS.some((o) => o.key === p.key) && (p.dir === 'asc' || p.dir === 'desc')) return p;
  } catch { /* fall through to default */ }
  return { key: 'asset_tag', dir: 'asc' };
}
function saveSortPref(pref) {
  try { localStorage.setItem('assettrack_asset_sort', JSON.stringify(pref)); } catch { /* storage unavailable */ }
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-assets';
  let sort = loadSortPref();
  let assets = [];

  const sortableTh = (key, label) => `<th scope="col" aria-sort="none" data-th="${key}"><button type="button" class="th-sort" data-sort="${key}">${label}<span class="sort-ind" aria-hidden="true"></span></button></th>`;

  el.innerHTML = `
    <div class="crt-panel">
      <div class="registry-toolbar">
        <input type="text" id="asset-search" class="retro-input search-input" placeholder="› search assets..." aria-label="Search assets" />
        <div class="sort-group">
          <label class="sort-label" for="asset-sort">SORT BY</label>
          <select id="asset-sort" class="retro-input sort-select">
            ${SORT_OPTIONS.map((o) => `<option value="${o.key}" ${o.key === sort.key ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <button type="button" id="asset-sort-dir" class="btn-retro small outline sort-dir"></button>
        </div>
        <div class="toolbar-actions">
          <button id="btn-add-asset" class="btn-retro">+ REGISTER ASSET</button>
          <label class="btn-retro outline file-btn">
            IMPORT CSV
            <input type="file" id="import-file" accept=".xlsx,.csv" hidden />
          </label>
        </div>
      </div>
      <table class="retro-table asset-table">
        <thead>
          <tr>
            <th></th>
            ${sortableTh('asset_tag', 'ASSET ID')}
            ${sortableTh('name', 'NAME')}
            ${sortableTh('assigned_to', 'ASSIGNED TO')}
            ${sortableTh('room_name', 'ROOM')}
            ${sortableTh('status', 'STATUS')}
          </tr>
        </thead>
        <tbody id="asset-rows"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
      <div class="reg-foot" aria-live="polite">
        <span id="asset-foot-count"></span>
        <span id="asset-foot-sort"></span>
      </div>
    </div>
  `;

  const tbody = el.querySelector('#asset-rows');
  const footCount = el.querySelector('#asset-foot-count');
  const footSort = el.querySelector('#asset-foot-sort');
  const sortSelect = el.querySelector('#asset-sort');
  const dirBtn = el.querySelector('#asset-sort-dir');
  const searchInput = el.querySelector('#asset-search');

  function syncSortControls() {
    sortSelect.value = sort.key;
    dirBtn.textContent = sort.dir === 'asc' ? 'A–Z ↑' : 'Z–A ↓';
    dirBtn.setAttribute('aria-label', `Sort order: ${sort.dir === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`);
    el.querySelectorAll('th[data-th]').forEach((th) => {
      const active = th.dataset.th === sort.key;
      th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('.sort-ind').textContent = active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    });
  }

  // Footer under the table: how many assets are showing (and for which search),
  // and how they are sorted.
  function drawFoot() {
    const query = searchInput.value.trim();
    const n = assets.length;
    footCount.innerHTML = query
      ? `<strong>${n}</strong> ${n === 1 ? 'result' : 'results'} for “${esc(query)}”`
      : `<strong>${n}</strong> ${n === 1 ? 'asset' : 'assets'}`;
    const label = SORT_OPTIONS.find((o) => o.key === sort.key).label;
    footSort.innerHTML = `Sorted by <strong>${esc(label)}</strong> · ${sort.dir === 'asc' ? 'Ascending ↑' : 'Descending ↓'}`;
  }

  function drawRows() {
    syncSortControls();
    drawFoot();
    if (assets.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">No assets found.</td></tr>`;
      return;
    }
    tbody.innerHTML = sortAssets(assets, sort.key, sort.dir).map((a) => `
      <tr class="asset-row" data-id="${a.id}" tabindex="0" role="button" aria-label="Open details for ${esc(a.asset_tag)}">
        <td>${a.photo ? `<img src="${a.photo}" class="asset-row-photo" alt="" />` : ''}</td>
        <td class="mono-strong">${esc(a.asset_tag)}</td>
        <td>${esc(a.name)}</td>
        <td>
          ${a.assigned_photo ? `<img src="${a.assigned_photo}" class="assigned-row-photo" alt="" />` : ''}
          ${esc(a.assigned_to) || '—'}
        </td>
        <td>${esc(a.room_name) || '—'}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>
    `).join('');
  }

  async function loadAssets() {
    const result = await apiGet(`/api/v1/assets?search=${encodeURIComponent(searchInput.value)}`);
    assets = result.ok ? result.assets : [];
    drawRows();
  }

  function setSort(next) {
    sort = next;
    saveSortPref(sort);
    drawRows();
  }

  // Click (or Enter / Space) on a row opens its detail pop-up.
  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('.asset-row');
    if (row) openAssetDetailModal(el, row.dataset.id);
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.asset-row');
    if (!row) return;
    e.preventDefault();
    openAssetDetailModal(el, row.dataset.id);
  });

  sortSelect.addEventListener('change', () => setSort({ key: sortSelect.value, dir: sort.dir }));
  dirBtn.addEventListener('click', () => setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }));
  // Column headers: click to sort by that column, click again to reverse.
  el.querySelector('thead').addEventListener('click', (e) => {
    const btn = e.target.closest('.th-sort');
    if (!btn) return;
    const key = btn.dataset.sort;
    setSort({ key, dir: key === sort.key && sort.dir === 'asc' ? 'desc' : 'asc' });
  });

  searchInput.addEventListener('input', loadAssets);
  el.querySelector('#btn-add-asset').addEventListener('click', () => openAssetModal(el));

  el.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const token = localStorage.getItem('assettrack_token');
    const res = await fetch('/api/v1/assets/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: buffer
    });
    const result = await res.json().catch(() => ({ ok: false, error: `Import failed (HTTP ${res.status}).` }));
    alert(result.ok ? `Imported ${result.imported} of ${result.total_rows} rows.` : (result.error || 'Import failed.'));
    loadAssets();
  });

  document.addEventListener('assettrack:assets-changed', loadAssets);

  syncSortControls();
  loadAssets();
  return el;
}
