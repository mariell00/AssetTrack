// features/auth/recovery.js — "forget password?" for the superadmin.
//
// Flow: the login screen asks for a one-time code → we email it to the system
// administrator's address from settings.json (the person who set the system up)
// → they type it back in with a new user name + password → the primary admin
// account (the first 'admin' user — the one the app seeds) is updated.
//
// Security properties, on purpose:
//  * The code is never returned by the API or shown in the UI — only emailed.
//  * Only a bcrypt hash of it is stored; it expires after 10 minutes, works
//    once, and dies after 5 wrong guesses. A newer code replaces older ones.
//  * Both endpoints are for the desktop app only (see isDesktopRequest) — the
//    server is also reachable over the LAN and the public tunnel, and those
//    clients must never be able to reach this.
//  * A reset signs out every existing session of that account.
const crypto = require('crypto');
const { getDb } = require('../../core/database');
const { hashPassword, verifyPassword } = require('../../core/security');
const { loadConfig } = require('../../core/config');

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 60;
const MAX_REQUESTS_PER_HOUR = 5;
// No I, O, 0, 1 — easy to misread when typing a code from an email.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8; // 32^8 ≈ 1.1 trillion possibilities

const GENERIC_BAD_CODE = 'That code is wrong or has expired. Request a new one.';

// ---------- who may call this ----------

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'cf-ray'];

// True only for a request made by the Admin Hub window on this same computer.
// The remote address alone isn't enough: the Cloudflare tunnel connects from
// 127.0.0.1 too (so proxy headers are rejected), and any website open in a
// local browser can also reach 127.0.0.1 (so Origin and Host must be loopback).
function isDesktopRequest(req) {
  const addr = (req.socket && req.socket.remoteAddress) || '';
  if (!LOOPBACK_ADDRS.has(addr)) return false;
  if (PROXY_HEADERS.some((h) => req.headers[h])) return false;
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!LOOPBACK_HOST.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && !LOOPBACK_ORIGIN.test(origin)) return false;
  return true;
}

// ---------- email ----------

function recoveryConfig() {
  let cfg = {};
  try { cfg = loadConfig().recovery || {}; } catch { /* unreadable settings.json → treated as not configured */ }
  const smtp = cfg.smtp || {};
  const email = String(cfg.email || '').trim();
  const configured = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !!smtp.host && !!smtp.user && !!smtp.pass;
  return { configured, email, smtp };
}

// "owner@gmail.com" → "o•••@g•••.com" — enough to recognise the mailbox, not enough to leak it.
function maskEmail(email) {
  const [local, domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0] || ''}•••@${name[0] || ''}•••${tld}`;
}

async function defaultSendMail({ to, subject, text, smtp }) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    const err = new Error('The "nodemailer" package is not installed — run: npm install nodemailer');
    err.code = 'NO_MAILER';
    throw err;
  }
  const port = Number(smtp.port) || (smtp.secure === false ? 587 : 465);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: smtp.secure !== undefined ? !!smtp.secure : port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
  await transport.sendMail({ from: smtp.from || smtp.user, to, subject, text });
}

let sendMail = defaultSendMail;
// Test hook: lets the test-suite capture the email instead of sending it.
function _setMailer(fn) { sendMail = fn || defaultSendMail; }

// ---------- helpers ----------

function logEvent(message, level = 'alert') {
  try { require('../system/services').logEvent('AUTH', message, level); } catch { /* logging must never break recovery */ }
}

function generateCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}
const formatCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
const normalizeCode = (raw) => String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// The superadmin = the primary admin account: the lowest-id user with role 'admin'.
function primaryAdmin() {
  return getDb().prepare("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
}

function fail(status, code, error, extra = {}) {
  return { ok: false, status, code, error, ...extra };
}

// ---------- step 1: email a code ----------

async function requestCode({ ip } = {}) {
  const { configured, email, smtp } = recoveryConfig();
  if (!configured) {
    return fail(503, 'not_configured',
      'Recovery email is not set up on this computer. The system administrator needs to add it to settings.json (see "recovery").');
  }
  const admin = primaryAdmin();
  if (!admin) return fail(404, 'no_admin', 'No administrator account exists to recover.');

  const db = getDb();
  const now = Date.now();

  // Housekeeping: nothing older than a day is useful for anything.
  db.prepare('DELETE FROM password_reset_codes WHERE created_at < ?').run(now - 24 * 60 * 60 * 1000);

  // Throttle (counted even for failed sends, so a broken mail setup can't be hammered).
  const last = db.prepare('SELECT created_at FROM password_reset_codes ORDER BY id DESC LIMIT 1').get();
  if (last && now - last.created_at < RESEND_COOLDOWN_S * 1000) {
    const retryAfter = Math.ceil((RESEND_COOLDOWN_S * 1000 - (now - last.created_at)) / 1000);
    return fail(429, 'cooldown', `Please wait ${retryAfter}s before requesting another code.`, { retryAfter });
  }
  const recent = db.prepare('SELECT COUNT(*) AS c FROM password_reset_codes WHERE created_at > ?').get(now - 60 * 60 * 1000);
  if (recent.c >= MAX_REQUESTS_PER_HOUR) {
    return fail(429, 'rate_limited', 'Too many code requests. Try again in an hour.', { retryAfter: 3600 });
  }

  const code = generateCode();
  const info = db.prepare(
    'INSERT INTO password_reset_codes (code_hash, created_at, expires_at, requested_ip) VALUES (?, ?, ?, ?)'
  ).run(hashPassword(code), now, now + CODE_TTL_MS, ip || null);
  const newId = Number(info.lastInsertRowid);

  try {
    await sendMail({
      to: email,
      smtp,
      subject: 'AssetTrack — your one-time recovery code',
      text:
        `Someone asked to reset the superadmin account on the AssetTrack computer.\n\n` +
        `One-time code:  ${formatCode(code)}\n\n` +
        `It works once and expires in ${CODE_TTL_MS / 60000} minutes. ` +
        `It can only be used on that computer, at the AssetTrack login screen.\n\n` +
        `If you did not ask for this, ignore this email — nothing changes unless the code is entered.`
    });
  } catch (err) {
    db.prepare('UPDATE password_reset_codes SET used_at = ? WHERE id = ?').run(Date.now(), newId); // void it
    logEvent(`Recovery code email FAILED: ${err.code === 'NO_MAILER' ? err.message : err.message || err}`, 'error');
    return fail(502, 'send_failed',
      err.code === 'NO_MAILER'
        ? 'Email support is not installed. Run "npm install nodemailer" and restart AssetTrack.'
        : 'Could not send the email. Check this computer’s internet connection and the SMTP settings in settings.json.');
  }

  // Only now do older codes stop working — if the email failed, they still do.
  db.prepare('UPDATE password_reset_codes SET used_at = ? WHERE used_at IS NULL AND id != ?').run(Date.now(), newId);
  logEvent(`Superadmin recovery code emailed to ${maskEmail(email)}`);
  return { ok: true, maskedEmail: maskEmail(email), expiresInMinutes: CODE_TTL_MS / 60000, cooldownSeconds: RESEND_COOLDOWN_S };
}

// ---------- step 2: code + new credentials ----------

function validateNewCredentials(username, password) {
  const fields = {};
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    fields.username = { flag: 'invalid', message: 'User name must be 3–32 characters: letters, numbers, dot, dash or underscore.' };
  }
  if (password.length < 8) {
    fields.password = { flag: 'too short', message: 'Password must be at least 8 characters.' };
  } else if (Buffer.byteLength(password, 'utf8') > 72) {
    fields.password = { flag: 'too long', message: 'Password is too long (72 bytes at most).' };
  } else if (password.toLowerCase() === username.toLowerCase() || password.toLowerCase() === 'changeme') {
    fields.password = { flag: 'too weak', message: 'Choose a password that is not your user name or the default one.' };
  }
  return fields;
}

function resetWithCode({ code, username, password } = {}) {
  username = String(username || '').trim();
  password = String(password || '');

  // Check the new details first, so a typo doesn't burn one of the 5 code attempts.
  const fields = validateNewCredentials(username, password);
  if (Object.keys(fields).length) return fail(400, 'invalid_input', 'Please fix the highlighted fields.', { fields });

  const db = getDb();
  const now = Date.now();
  const entered = normalizeCode(code);
  const active = db.prepare(
    'SELECT * FROM password_reset_codes WHERE used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1'
  ).get(now);
  // Same answer whether there's no code, an expired one, or a wrong one.
  if (!active || entered.length !== CODE_LENGTH) {
    if (active && entered.length !== CODE_LENGTH) {
      // A malformed entry still counts as a try, so length can't be probed for free.
      registerFailure(db, active, now);
    }
    return fail(400, 'invalid_code', GENERIC_BAD_CODE);
  }

  if (!verifyPassword(entered, active.code_hash)) {
    const left = registerFailure(db, active, now);
    return fail(400, 'invalid_code', left > 0 ? `${GENERIC_BAD_CODE} (${left} ${left === 1 ? 'try' : 'tries'} left)` : GENERIC_BAD_CODE, { attemptsLeft: left });
  }

  // Code is correct from here on.
  const admin = primaryAdmin();
  if (!admin) return fail(404, 'no_admin', 'No administrator account exists to recover.');
  const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, admin.id);
  if (clash) {
    // Checked only AFTER the code is verified, so this can't be used to discover user names.
    // The code stays valid — the person just needs to pick a different name.
    return fail(409, 'username_taken', 'That user name is already in use by another account.', {
      fields: { username: { flag: 'taken', message: 'That user name is already in use by another account.' } }
    });
  }

  const apply = db.transaction(() => {
    db.prepare(
      "UPDATE users SET username = ?, password_hash = ?, status = 'active', tokens_valid_after = ? WHERE id = ?"
    ).run(username, hashPassword(password), Math.floor(now / 1000), admin.id);
    db.prepare('UPDATE password_reset_codes SET used_at = ? WHERE used_at IS NULL').run(now);
  });
  apply();

  logEvent(`Superadmin credentials reset with a one-time code (user name "${admin.username}" → "${username}")`);
  return { ok: true, username };
}

// Adds one failed attempt; voids the code on the last one. Returns tries left.
function registerFailure(db, active, now) {
  const attempts = active.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    db.prepare('UPDATE password_reset_codes SET attempts = ?, used_at = ? WHERE id = ?').run(attempts, now, active.id);
    logEvent('Recovery code voided after too many wrong attempts');
    return 0;
  }
  db.prepare('UPDATE password_reset_codes SET attempts = ? WHERE id = ?').run(attempts, active.id);
  return MAX_ATTEMPTS - attempts;
}

module.exports = { requestCode, resetWithCode, isDesktopRequest, maskEmail, _setMailer };
