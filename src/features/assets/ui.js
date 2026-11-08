// features/assets/ui.js — "Asset Registry" screen: search + sort, a table of
// assets (click a row for the full-detail pop-up with Edit / QR label / Delete),
// the add/edit modal, CSV/XLSX bulk import and printable QR labels.
import { apiGet, apiPost, apiPut, apiDelete } from '../../js/api-client.js';
import { compressImageFile } from '../../js/photo.js';

const STATUS_LABELS = { active: 'Active', maintenance: 'Maintenance', pending: 'Pending', offline: 'Offline' };

function statusBadge(status) {
  const s = status || 'active';
  return `<span class="badge badge-asset-${s}">${STATUS_LABELS[s] || s.toUpperCase()}</span>`;
}

// Themed replacement for window.confirm(): a native <dialog> in the app's
// style (same look as the Log out pop-up). Resolves true on confirm, false on
// Cancel / Esc / the X / a click on the backdrop. Cancel has the initial focus.
export function confirmDialog({ title, messageHtml, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dialog';
    dlg.setAttribute('aria-labelledby', 'confirm-dialog-title');
    dlg.innerHTML = `
      <div class="confirm-bar">
        <span class="confirm-code">Confirm</span>
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
        <span class="crt-dot"></span> Asset QR label
        <button class="modal-close" id="qr-modal-close">✕</button>
      </div>
      <div class="qr-label-body">
        <img src="${dataUrl}" alt="QR code for ${asset_tag}" class="qr-label-img" />
        <div class="qr-label-tag mono-strong">${asset_tag}</div>
        <div class="qr-label-name">${name}</div>
        <div class="qr-label-actions">
          <button class="btn-retro small outline" id="qr-btn-download">Download PNG</button>
          <button class="btn-retro small" id="qr-btn-print">Print label</button>
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
            body { font-family: Inter, system-ui, sans-serif; text-align: center; padding: 24px; }
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

// Category choices for the register/edit form come from the server (features/specs), which
// also says which spec fields each category has. A category already saved on an asset that
// isn't in that list (an older one such as "Monitor", or one from a CSV import) is added as
// an extra option, so editing never drops it.
function categoryOptionsHtml(selected, categories) {
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const labels = categories.map((c) => c.label);
  const extra = selected && !labels.some((l) => same(l, selected)) ? [selected] : [];
  return `<option value="">— Select category —</option>`
    + [...labels, ...extra].map((c) => `<option value="${esc(c)}" ${same(c, selected) ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

// One input in the Specifications window. They belong to the registration <form> through the
// `form` attribute even though the window sits beside it, so the one Save button and the
// browser's required-field checks cover both windows.
function specFieldHtml(f, value) {
  const common = `id="spec-${esc(f.key)}" data-spec="${esc(f.key)}" form="asset-form" class="retro-input"${f.required ? ' required' : ''}`;
  let control;
  if (f.type === 'select') {
    control = `<select ${common}><option value="">— Select —</option>${(f.options || []).map((o) => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (f.type === 'boolean') {
    control = `<select ${common}><option value="">—</option><option value="1" ${value === '1' ? 'selected' : ''}>Yes</option><option value="0" ${value === '0' ? 'selected' : ''}>No</option></select>`;
  } else if (f.type === 'number') {
    control = `<input type="number" step="any" min="0" ${common} value="${esc(value)}" />`;
  } else if (f.type === 'date') {
    control = `<input type="date" ${common} value="${esc(value)}" />`;
  } else {
    control = `<input type="text" maxlength="200" ${common} value="${esc(value)}" />`;
  }
  return `
    <label class="spec-field spec-${esc(f.type)}">
      <span class="spec-label">${esc(f.label)}${f.required ? '<span class="spec-req" aria-hidden="true"> *</span>' : ''}</span>
      <span class="spec-control">${control}${f.unit ? `<span class="spec-unit">${esc(f.unit)}</span>` : ''}</span>
    </label>`;
}

function specWindowHtml(entry, values) {
  const specs = entry.fields.filter((f) => !f.attached);
  const attached = entry.fields.filter((f) => f.attached);
  const section = (title, note, fields) => (fields.length ? `
    <section class="spec-section">
      <h3>${title}</h3>${note ? `<p class="spec-note">${note}</p>` : ''}
      <div class="spec-grid">${fields.map((f) => specFieldHtml(f, values[f.key] ?? '')).join('')}</div>
    </section>` : '');
  return `
    <div class="crt-header"><span class="crt-dot"></span> Specifications <span class="badge spec-cat">${esc(entry.label)}</span></div>
    <div class="spec-scroll">
      ${section('Specifications', '', specs)}
      ${section('Attached equipment', 'Anything that goes with this asset.', attached)}
      <p class="spec-note spec-legend"><span class="spec-req">*</span> required</p>
    </div>`;
}

// The ASSIGNED TO dropdown is fed by the Manage Assignees screen
// (features/assignees). Only active assignees are offered, but whoever the
// asset is already assigned to is always kept as an option — even if they've
// since been deactivated — so editing an asset never wipes its current assignee.
function assigneeOptionsHtml(assignees, current) {
  const active = assignees.filter((p) => p.status === 'active');
  const has = (name) => active.some((p) => p.name.toLowerCase() === String(name).toLowerCase());
  const options = [...active.map((p) => p.name)];
  if (current && !has(current)) options.unshift(current);
  const isCurrent = (name) => current && name.toLowerCase() === String(current).toLowerCase();
  return `<option value="">— Unassigned —</option>`
    + options.map((n) => `<option value="${esc(n)}" ${isCurrent(n) ? 'selected' : ''}>${esc(n)}</option>`).join('')
    + (active.length === 0 ? `<option disabled>No assignees yet — add some in Manage Assignees</option>` : '');
}

async function openAssetModal(root, { asset } = {}) {
  const isEdit = !!asset;
  const [roomsResult, assigneesResult, catalogResult, savedSpecsResult] = await Promise.all([
    apiGet('/api/v1/map/rooms/list'),
    apiGet('/api/v1/assignees'),
    apiGet('/api/v1/specs/categories'),
    // The detail pop-up already carries the saved spec values; anywhere else, fetch them.
    isEdit && !asset.spec_values ? apiGet(`/api/v1/specs/asset/${asset.id}`) : Promise.resolve(null)
  ]);
  const rooms = roomsResult.ok ? roomsResult.rooms : [];
  const assignees = assigneesResult.ok ? assigneesResult.assignees : [];
  const categories = catalogResult.ok ? catalogResult.categories : [];
  const savedSpecs = !isEdit ? {} : (asset.spec_values || (savedSpecsResult && savedSpecsResult.ok ? savedSpecsResult.values : {}));
  // Name → saved photo, so picking someone previews their picture without
  // stuffing every base64 image into the <option> attributes.
  const assigneePhotos = new Map(assignees.map((p) => [p.name.toLowerCase(), p.photo]));

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-pair">
    <div class="modal-box crt-panel asset-form-box">
      <div class="crt-header">
        <span class="crt-dot"></span> ${isEdit ? 'Edit asset' : 'Register asset'}
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <form id="asset-form" class="retro-form modal-form">
        ${isEdit ? `<label>Asset ID
          <input type="text" class="retro-input" value="${esc(asset.asset_tag)}" readonly aria-readonly="true" />
        </label>` : ''}
        <label>Name
          <input type="text" id="f-name" class="retro-input" value="${asset ? asset.name : ''}" required />
        </label>
        <label>Category
          <select id="f-category" class="retro-input">${categoryOptionsHtml(asset ? asset.category : '', categories)}</select>
        </label>
        <label>Room
          <select id="f-room" class="retro-input">${roomOptionsHtml(rooms, asset ? asset.room_id : '')}</select>
        </label>
        <label>Assigned to (Asset user)
          <select id="f-assigned" class="retro-input">${assigneeOptionsHtml(assignees, asset ? asset.assigned_to : '')}</select>
          <span class="mono-dim asg-manage-hint">Not listed? Add them under <a href="#/assignees" id="f-assigned-manage">Manage Assignees</a>.</span>
        </label>
        <label id="f-assigned-photo-field">Assigned user photo <span class="mono-dim">(optional${isEdit ? ' — leave as-is to keep the current one' : ''})</span>
          <div class="photo-field-row">
            <img id="f-assigned-photo-preview" class="photo-preview photo-preview-round" src="${asset && asset.assigned_photo ? asset.assigned_photo : ''}" style="${asset && asset.assigned_photo ? '' : 'display:none;'}" alt="" />
            <label class="btn-retro small outline file-btn">
              <span id="f-assigned-photo-label">${asset && asset.assigned_photo ? 'Change photo' : 'Attach photo'}</span>
              <input type="file" id="f-assigned-photo" accept="image/*" hidden />
            </label>
          </div>
        </label>
        <label>Status
          <select id="f-status" class="retro-input">
            ${Object.entries(STATUS_LABELS).map(([val, label]) =>
              `<option value="${val}" ${asset && asset.status === val ? 'selected' : ''}>${label}</option>`
            ).join('')}
          </select>
        </label>
        <label>Photo <span class="mono-dim">(optional${isEdit ? ' — leave as-is to keep the current one' : ''})</span>
          <div class="photo-field-row">
            <img id="f-photo-preview" class="photo-preview" src="${asset && asset.photo ? asset.photo : ''}" style="${asset && asset.photo ? '' : 'display:none;'}" alt="" />
            <label class="btn-retro small outline file-btn">
              <span id="f-photo-label">${asset && asset.photo ? 'Change photo' : 'Attach photo'}</span>
              <input type="file" id="f-photo" accept="image/*" hidden />
            </label>
          </div>
        </label>
        <button type="submit" class="btn-retro">${isEdit ? 'Save changes' : 'Register asset'}</button>
        <p id="modal-error" class="form-error"></p>
      </form>
    </div>
    </div>
  `;
  root.appendChild(overlay);

  // ---- Specifications window: pops out beside this one once a category that has spec fields is
  // picked (laptop, printer, projector…), and goes away for one that doesn't (Other, older ones).
  // What was typed is remembered per category, so flipping the dropdown back and forth loses nothing,
  // and one category's values never leak into another's.
  const pair = overlay.querySelector('.modal-pair');
  const categorySelect = overlay.querySelector('#f-category');
  const specWindowFor = (label) => categories.find((c) => c.label.toLowerCase() === String(label || '').toLowerCase());
  const specValues = new Map(); // category key -> { field key: value }
  const initialEntry = isEdit ? specWindowFor(asset.category) : null;
  if (initialEntry) specValues.set(initialEntry.key, { ...savedSpecs });
  let specBox = null;

  function syncSpecWindow() {
    const entry = specWindowFor(categorySelect.value);
    if (!entry || entry.fields.length === 0) {
      if (specBox) { specBox.remove(); specBox = null; }
      return;
    }
    if (!specValues.has(entry.key)) specValues.set(entry.key, {});
    if (!specBox) {
      specBox = document.createElement('div');
      specBox.className = 'modal-box crt-panel spec-box is-new';
      specBox.setAttribute('role', 'region');
      pair.appendChild(specBox);
    } else {
      specBox.classList.remove('is-new');
    }
    specBox.dataset.category = entry.key;
    specBox.setAttribute('aria-label', `${entry.label} specifications`);
    specBox.innerHTML = specWindowHtml(entry, specValues.get(entry.key));
  }
  const rememberSpec = (e) => {
    const key = e.target.dataset && e.target.dataset.spec;
    if (key && specBox) specValues.get(specBox.dataset.category)[key] = e.target.value;
  };
  overlay.addEventListener('input', rememberSpec);
  overlay.addEventListener('change', rememberSpec);
  categorySelect.addEventListener('change', syncSpecWindow);
  syncSpecWindow();

  overlay.querySelector('#modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#f-assigned-manage').addEventListener('click', () => overlay.remove());

  let newPhotoDataUrl = null; // stays null unless a new photo is picked, so saving without touching it keeps the existing one on edit
  const photoInput = overlay.querySelector('#f-photo');
  const photoPreview = overlay.querySelector('#f-photo-preview');
  const photoLabel = overlay.querySelector('#f-photo-label');
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;
    photoLabel.textContent = 'Compressing…';
    try {
      newPhotoDataUrl = await compressImageFile(file);
      photoPreview.src = newPhotoDataUrl;
      photoPreview.style.display = 'block';
      photoLabel.textContent = 'Change photo';
    } catch {
      newPhotoDataUrl = null;
      photoLabel.textContent = 'Couldn’t attach photo, try again';
    }
  });

  // The assigned user's photo is saved against the assignee, so the field only
  // makes sense once someone is picked.
  const assignedSelect = overlay.querySelector('#f-assigned');
  const assignedPhotoField = overlay.querySelector('#f-assigned-photo-field');
  const syncAssignedPhotoField = () => { assignedPhotoField.style.display = assignedSelect.value ? '' : 'none'; };
  assignedSelect.addEventListener('change', () => {
    syncAssignedPhotoField();
    // Switching person: show THEIR saved photo (a photo attached a moment ago
    // belongs to the previous pick, so it's dropped).
    newAssignedPhotoDataUrl = null;
    const saved = assigneePhotos.get(assignedSelect.value.toLowerCase());
    assignedPhotoPreview.src = saved || '';
    assignedPhotoPreview.style.display = saved ? 'block' : 'none';
    assignedPhotoLabel.textContent = saved ? 'Change photo' : 'Attach photo';
  });
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
    assignedPhotoLabel.textContent = 'Compressing…';
    try {
      newAssignedPhotoDataUrl = await compressImageFile(file);
      assignedPhotoPreview.src = newAssignedPhotoDataUrl;
      assignedPhotoPreview.style.display = 'block';
      assignedPhotoLabel.textContent = 'Change photo';
    } catch {
      newAssignedPhotoDataUrl = null;
      assignedPhotoLabel.textContent = 'Couldn’t attach photo, try again';
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
    // The spec window's fields are the complete set for this category (a cleared field is removed).
    // With no spec window there is nothing to send, which leaves any saved specs as they are.
    if (specBox) {
      payload.specs = {};
      specBox.querySelectorAll('[data-spec]').forEach((el) => { payload.specs[el.dataset.spec] = el.value; });
    }

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

export function esc(value) {
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

const SCAN_LABELS = { verified: 'Verified', missing: 'Missing', misplaced: 'Misplaced' };

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
  // A two-column grid; an odd count gets an empty cell so the last row keeps its borders.
  const specGrid = (title, rows) => (rows.length
    ? `<div class="ad-section"><h3>${title}</h3><div class="ad-grid">${rows.map((s) => field(esc(s.label), esc(s.display))).join('')}${rows.length % 2 ? '<div class="ad-field"></div>' : ''}</div></div>`
    : '');
  const specRows = (a.specs || []).filter((s) => !s.attached);
  const attachedRows = (a.specs || []).filter((s) => s.attached);

  overlay.innerHTML = `
    <div class="modal-box crt-panel asset-detail-box" role="dialog" aria-modal="true" aria-label="Asset details">
      <div class="crt-header">
        <span class="crt-dot"></span> Asset details
        <button class="modal-close" id="ad-close" aria-label="Close">✕</button>
      </div>

      <div class="ad-scroll">
      <div class="ad-top">
        ${a.photo
          ? `<img class="ad-photo" src="${a.photo}" alt="Photo of ${esc(a.name)}" />`
          : '<div class="ad-photo ad-photo-empty">No photo</div>'}
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

      ${specGrid('Specifications', specRows)}
      ${specGrid('Attached equipment', attachedRows)}

      <div class="ad-section">
        <h3>Open issues <span class="mono-dim">(${a.open_issues})</span></h3>
        ${a.issues && a.issues.length ? a.issues.map((i) => `
          <div class="ad-row">
            <span class="badge ${i.resolved ? 'badge-asset-active' : 'badge-asset-offline'}">${i.resolved ? 'Resolved' : 'Open'}</span>
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
        <button class="btn-retro small danger" id="ad-delete">Delete</button>
        <button class="btn-retro small outline" id="ad-qr">QR label</button>
        <button class="btn-retro small" id="ad-edit">Edit</button>
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
        <input type="text" id="asset-search" class="retro-input search-input" placeholder="Search assets…" aria-label="Search assets" />
        <div class="sort-group">
          <label class="sort-label" for="asset-sort">Sort by</label>
          <select id="asset-sort" class="retro-input sort-select">
            ${SORT_OPTIONS.map((o) => `<option value="${o.key}" ${o.key === sort.key ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <button type="button" id="asset-sort-dir" class="btn-retro small outline sort-dir"></button>
        </div>
        <div class="toolbar-actions">
          <button id="btn-add-asset" class="btn-retro">+ Register asset</button>
          <label class="btn-retro outline file-btn">
            Import CSV
            <input type="file" id="import-file" accept=".xlsx,.csv" hidden />
          </label>
        </div>
      </div>
      <table class="retro-table asset-table">
        <thead>
          <tr>
            <th></th>
            ${sortableTh('asset_tag', 'Asset ID')}
            ${sortableTh('name', 'Name')}
            ${sortableTh('assigned_to', 'Assigned to')}
            ${sortableTh('room_name', 'Room')}
            ${sortableTh('status', 'Status')}
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
    if (!result.ok) alert(result.error || 'Import failed.');
    else {
      const bits = [];
      if (result.new_assets) bits.push(`${result.new_assets} new asset(s)`);
      if (result.updates) bits.push(`${result.updates} update(s) to existing assets`);
      const skipped = [result.unchanged ? `${result.unchanged} unchanged` : '', result.duplicates ? `${result.duplicates} duplicate(s)` : '', result.invalid ? `${result.invalid} row(s) missing Asset ID or name` : ''].filter(Boolean).join(', ');
      alert((bits.length
        ? `Sent ${bits.join(' and ')} to Inventory Sync for verification. Nothing is added to the registry until you approve it there.`
        : 'Nothing to send for verification.') + (skipped ? `\n\nSkipped: ${skipped}.` : ''));
    }
    e.target.value = '';
    loadAssets();
  });

  document.addEventListener('assettrack:assets-changed', loadAssets);

  syncSortControls();
  loadAssets();
  return el;
}
