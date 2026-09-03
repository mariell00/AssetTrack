// core/security.js — password hashing + JWT issuance, shared by auth
// (desktop admin login) and the mobile sync handshake.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// In a real deployment this should come from an env var / secure file
// generated on first run, not be hardcoded. Kept simple for a LAN-only,
// offline, single-office deployment.
const JWT_SECRET = 'assettrack-local-lan-secret-change-me';
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

module.exports = { hashPassword, verifyPassword, issueToken, verifyToken };
