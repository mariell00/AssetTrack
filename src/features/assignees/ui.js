// features/assignees/ui.js — "Manage Assignees" screen: the people assets are
// handed to. This list feeds the ASSIGNED TO dropdown in the Asset Registry.
// (Logins — the super admin and the admins — are a separate screen,
// Manage Admins, opened from the profile card in the menu.)
import { apiGet, apiPost, apiPut, apiDelete } from '../../js/api-client.js';
import { compressImageFile } from '../../js/photo.js';
import { confirmDialog, esc } from '../assets/ui.js';

const initials = (name) => {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || ''))).toUpperCase();
};

function avatarHtml(p, cls = '') {
  return p.photo
    ? `<img class="asg-avatar${cls}" src="${p.photo}" alt="" />`
    : `<span class="asg-avatar asg-avatar-initials${cls}" aria-hidden="true">${esc(initials(p.name))}</span>`;
}

function openAssigneeModal(root, { assignee } = {}, onSaved) {
  const isEdit = !!assignee;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box crt-panel asset-form-box">
      <div class="crt-header">
        <span class="crt-dot"></span> ${isEdit ? 'Edit assignee' : 'Add assignee'}
        <button class="modal-close" id="asg-close" type="button" aria-label="Close">✕</button>
      </div>
      <form id="asg-form" class="retro-form modal-form">
        <label>Full name
          <input type="text" id="asg-name" class="retro-input" value="${isEdit ? esc(assignee.name) : ''}" required />
        </label>
        <label>Position <span class="mono-dim">(optional)</span>
          <input type="text" id="asg-position" class="retro-input" placeholder="e.g. Registrar" value="${isEdit ? esc(assignee.position || '') : ''}" />
        </label>
        <label>Department / office <span class="mono-dim">(optional)</span>
          <input type="text" id="asg-dept" class="retro-input" placeholder="e.g. Supply Office" value="${isEdit ? esc(assignee.department || '') : ''}" />
        </label>
        <label>Contact <span class="mono-dim">(optional — phone or email)</span>
          <input type="text" id="asg-contact" class="retro-input" value="${isEdit ? esc(assignee.contact || '') : ''}" />
        </label>
        <label>Photo <span class="mono-dim">(optional${isEdit && assignee.photo ? ' — leave as-is to keep the current one' : ''})</span>
          <div class="photo-field-row">
            <img id="asg-photo-preview" class="photo-preview photo-preview-round" src="${isEdit && assignee.photo ? assignee.photo : ''}" style="${isEdit && assignee.photo ? '' : 'display:none;'}" alt="" />
            <label class="btn-retro small outline file-btn">
              <span id="asg-photo-label">${isEdit && assignee.photo ? 'Change photo' : 'Attach photo'}</span>
              <input type="file" id="asg-photo" accept="image/*" hidden />
            </label>
            ${isEdit && assignee.photo ? '<button type="button" class="btn-retro small danger" id="asg-photo-clear">Remove</button>' : ''}
          </div>
        </label>
        ${isEdit && assignee.asset_count > 0 ? `<p class="asg-note">Renaming updates the ${assignee.asset_count} asset${assignee.asset_count === 1 ? '' : 's'} assigned to this person too.</p>` : ''}
        <button type="submit" class="btn-retro">${isEdit ? 'Save changes' : 'Add assignee'}</button>
        <p id="asg-error" class="form-error" role="alert"></p>
      </form>
    </div>
  `;
  root.appendChild(overlay);
  const q = (sel) => overlay.querySelector(sel);
  q('#asg-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  q('#asg-name').focus();

  // undefined = keep what's saved, a data URL = replace, null = remove.
  let photo;
  q('#asg-photo').addEventListener('change', async () => {
    const file = q('#asg-photo').files[0];
    if (!file) return;
    q('#asg-photo-label').textContent = 'Compressing…';
    try {
      photo = await compressImageFile(file);
      q('#asg-photo-preview').src = photo;
      q('#asg-photo-preview').style.display = 'block';
      q('#asg-photo-label').textContent = 'Change photo';
    } catch {
      photo = undefined;
      q('#asg-photo-label').textContent = 'Couldn’t attach photo, try again';
    }
  });
  const clearBtn = q('#asg-photo-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    photo = null;
    q('#asg-photo-preview').style.display = 'none';
    q('#asg-photo-label').textContent = 'Attach photo';
    clearBtn.remove();
  });

  q('#asg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: q('#asg-name').value.trim(),
      position: q('#asg-position').value.trim(),
      department: q('#asg-dept').value.trim(),
      contact: q('#asg-contact').value.trim()
    };
    if (photo !== undefined) payload.photo = photo;
    const submit = q('button[type="submit"]');
    submit.disabled = true;
    const result = isEdit ? await apiPut(`/api/v1/assignees/${assignee.id}`, payload) : await apiPost('/api/v1/assignees', payload);
    submit.disabled = false;
    if (!result.ok) { q('#asg-error').textContent = result.error || 'Could not save.'; return; }
    overlay.remove();
    // Asset rows show the assignee's name/photo, so they need to refresh after a rename or new photo.
    document.dispatchEvent(new CustomEvent('assettrack:assets-changed'));
    onSaved();
  });
}

export function render() {
  const el = document.createElement('div');
  el.className = 'screen screen-assignees';
  el.innerHTML = `
    <div class="crt-panel">
      <div class="crt-header">
        <span class="crt-dot"></span> Manage assignees
        <div class="header-actions">
          <button id="btn-add-assignee" class="btn-retro small" type="button">+ Add assignee</button>
        </div>
      </div>
      <p class="screen-lede">People who can be picked in <strong>Assigned to</strong> when registering an asset. They don’t sign in — for logins, open <a href="#/admins">Manage Admins</a> from your profile in the menu.</p>
      <div class="users-toolbar">
        <input type="text" id="asg-search" class="retro-input" placeholder="Search by name, position or office…" aria-label="Search assignees" />
      </div>
      <table class="retro-table">
        <thead>
          <tr><th>Assignee</th><th>Position / office</th><th>Contact</th><th>Assets</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="asg-rows"><tr><td colspan="6">Loading…</td></tr></tbody>
      </table>
      <div class="reg-foot"><span id="asg-count"></span></div>
    </div>
  `;
  const tbody = el.querySelector('#asg-rows');
  const search = el.querySelector('#asg-search');
  let rows = [];

  async function load() {
    const result = await apiGet(`/api/v1/assignees?search=${encodeURIComponent(search.value.trim())}`);
    if (!result.ok) { tbody.innerHTML = `<tr><td colspan="6">${esc(result.error || 'Unable to load assignees.')}</td></tr>`; return; }
    rows = result.assignees;
    el.querySelector('#asg-count').innerHTML = `<strong>${rows.length}</strong> assignee${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6">${search.value.trim() ? 'No one matches that search.' : 'No assignees yet. Add the first one — they’ll show up in the Assigned to dropdown.'}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((p) => `
      <tr data-id="${p.id}" class="${p.status === 'inactive' ? 'row-inactive' : ''}">
        <td class="user-cell">${avatarHtml(p)} <span class="asg-name">${esc(p.name)}</span></td>
        <td>${esc([p.position, p.department].filter(Boolean).join(' · ')) || '—'}</td>
        <td>${esc(p.contact) || '—'}</td>
        <td class="mono-strong">${p.asset_count}</td>
        <td><span class="badge badge-status-${p.status}">${p.status}</span></td>
        <td class="row-actions">
          <button class="btn-retro small outline" data-act="edit" type="button">Edit</button>
          <button class="btn-retro small outline" data-act="toggle" type="button">${p.status === 'active' ? 'Deactivate' : 'Activate'}</button>
          <button class="btn-retro small danger" data-act="delete" type="button" aria-label="Delete ${esc(p.name)}">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const person = rows.find((p) => p.id === Number(btn.closest('tr').dataset.id));
    if (!person) return;

    if (btn.dataset.act === 'edit') {
      openAssigneeModal(el, { assignee: person }, load);
    } else if (btn.dataset.act === 'toggle') {
      const next = person.status === 'active' ? 'inactive' : 'active';
      const result = await apiPut(`/api/v1/assignees/${person.id}`, { status: next });
      if (!result.ok) alert(result.error || 'Could not update.');
      load();
    } else if (btn.dataset.act === 'delete') {
      const ok = await confirmDialog({
        title: 'Delete assignee?',
        messageHtml: person.asset_count > 0
          ? `<strong>${esc(person.name)}</strong> still has ${person.asset_count} asset${person.asset_count === 1 ? '' : 's'} assigned, so they can’t be deleted. Deactivate them instead to hide them from the dropdown.`
          : `Remove <strong>${esc(person.name)}</strong> from the assignee list? This can’t be undone.`,
        confirmLabel: 'Delete', danger: true
      });
      if (!ok) return;
      const result = await apiDelete(`/api/v1/assignees/${person.id}`);
      if (!result.ok) alert(result.error || 'Could not delete.');
      load();
    }
  });

  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });
  el.querySelector('#btn-add-assignee').addEventListener('click', () => openAssigneeModal(el, {}, load));

  load();
  return el;
}
