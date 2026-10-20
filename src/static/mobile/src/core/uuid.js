// mobile/src/core/uuid.js — the phone's own id for a registration.
//
// Made once, when staff save a registration, and sent with it every time it is
// (re)sent. Nobody sees or types it. It lets the desktop tell "this one again"
// from "a new one", and lets the phone later ask which asset it became.
//
// crypto.randomUUID() only exists on secure pages (https / localhost), and the
// phone usually opens AssetTrack over plain http on the LAN — so fall back to
// getRandomValues(), which works everywhere.
export function newUuid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); // very old browsers
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
