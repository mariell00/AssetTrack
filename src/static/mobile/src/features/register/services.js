// mobile/features/register/services.js — registers a brand-new asset from the
// field. It is NOT added straight away: the registration is saved on the phone,
// goes out with the next SYNC as a pending registration, and the super admin
// verifies it in Inventory sync. Only then does the desktop create the asset
// and give it its Asset ID — so there is no ID or QR label to show yet.
//
// Staff never type an Asset ID. Instead the phone gives every registration its own
// random id (`client_uuid`) when it is saved. It is internal — nobody sees it — and
// it travels with the registration each time it is sent, so if a sync reaches the
// desktop but the reply is lost, sending it again does NOT make a second copy: the
// desktop recognises the id. The desktop-made Asset ID (AST-0001…) is what people see.
import { addPendingScan, saveRegistrationRecord } from '../../core/indexed-db.js';
import { currentUser } from '../auth/services.js';
import { fetchRoomsList, fetchAssignees } from '../../core/lookups.js';
import { newUuid } from '../../core/uuid.js';

async function registerAsset({ name, category, roomId, assignedTo, status, photo }) {
  const user = currentUser();
  const clientUuid = newUuid();
  try {
    // The outbox item first: that is what actually sends the registration.
    await addPendingScan({
      type: 'registration',
      client_uuid: clientUuid,
      scanned_by: user ? user.username : 'unknown',
      payload: {
        name,
        category: category || null,
        room_id: roomId ? Number(roomId) : null,
        assigned_to: assignedTo || null,
        status: status || 'active',
        photo: photo || null
      }
    });
    // Then a small record so the phone can show its progress after the outbox is emptied.
    await saveRegistrationRecord({
      client_uuid: clientUuid, name, state: 'queued', asset_tag: null, created_at: new Date().toISOString()
    }).catch(() => {}); // the registration is queued either way; this only feeds the progress list
  } catch (err) {
    return { ok: false, error: 'Could not save this registration on the phone. Try again.' };
  }
  return { ok: true, name, client_uuid: clientUuid };
}

export { registerAsset, fetchRoomsList, fetchAssignees };
