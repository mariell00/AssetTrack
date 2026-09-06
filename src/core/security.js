// core/security.js — password hashing + JWT issuance/verification, shared
// by every feature route (see requireAuth/requireRole below).
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The JWT secret used to be a hardcoded string baked into source
// ('assettrack-local-lan-secret-change-me') — meaning every install of this
// app shared the exact same secret, and anyone who read the source (or the
// public GitHub repo) could mint their own valid admin tokens. That was
// tolerable ONLY under the assumption the server never left a private LAN.
// Now that the server can be exposed publicly (see main.js public tunnel
// support), a shared/guessable secret is a real vulnerability, so instead
// we generate a random 256-bit secret on first run and persist it next to
// the local database — unique per install, never committed to source.
const SECRET_PATH = path.join(__dirname, '..', '..', 'data', 'jwt-secret.key');

function getOrCreateSecret() {
  try {
    if (fs.existsSync(SECRET_PATH)) {
      const existing = fs.readFileSync(SECRET_PATH, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch { /* fall through to generating a fresh one */ }

  const secret = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
  } catch (err) {
    // Worst case: still works, just won't survive a restart (all tokens
    // invalidate) — better than silently falling back to a shared default.
    console.error('[security] Could not persist JWT secret to disk:', err.message);
  }
  return secret;
}

const JWT_SECRET = getOrCreateSecret();
const TOKEN_TTL = '12h';

function hashPassword(plain) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plain, salt);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function issueToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Express middleware: rejects the request unless it carries a valid
// Bearer token. Attaches the decoded payload to req.user on success.
// Previously this check existed nowhere in the app — every /api/v1/*
// route executed with zero server-side authentication, regardless of what
// the client sent. This (wired up in main.js) is what actually enforces it.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
  if (!token) return res.status(401).json({ ok: false, error: 'Authentication required.' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Invalid or expired token.' });
  req.user = payload;
  next();
}

// Same as requireAuth, but additionally requires a specific role (admins
// always pass, matching the original behavior in auth/services.js).
function requireRole(role) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (role && req.user.role !== role && req.user.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Forbidden.' });
      }
      next();
    });
  };
}

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken, requireAuth, requireRole };
