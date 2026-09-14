// mobile/features/register/services.js — registers a brand-new asset
// straight from the field and fetches its QR label. Unlike a Scan
// (which just queues in IndexedDB for later sync), registering a new
// asset needs the desktop's database to assign it a real ID and hand
// back a QR image — so this always requires a live connection to the
// Desktop host. There's no offline queue for this one.
import { apiPost, apiGet } from '../../core/api-client.js';

async function registerAsset({ assetTag, name, category, room, status }) {
  const result = await apiPost('/api/v1/assets', {
    asset_tag: assetTag,
    name,
    category: category || null,
    room_name: room || undefined,
    status: status || 'active'
  });
  if (!result.ok) return result;

  const qr = await apiGet(`/api/v1/assets/${result.asset.id}/qr`);
  return { ok: true, asset: result.asset, qr: qr.ok ? qr : null };
}

export { registerAsset };
