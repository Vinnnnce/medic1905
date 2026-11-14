// Authentication & authorization
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../db');

const router = express.Router();
const ROLES = ['student','intern','resident','specialist','surgeon','anaesthetist','nurse','pharmacist','lab_scientist','radiologist','instructor','admin'];
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;

function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .run(token, userId, new Date(Date.now() + TOKEN_TTL_MS).toISOString());
  return token;
}

function authMiddleware(requiredRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!row || Date.parse(row.expires_at) < Date.now()) return res.status(401).json({ error: 'Session expired' });
    const user = db.prepare('SELECT id, email, full_name, role, level, city_id FROM users WHERE id = ?').get(row.user_id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (requiredRoles && !requiredRoles.includes(user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    req.user = user;
    next();
  };
}

router.post('/register', (req, res) => {
  const { email, password, full_name, role } = req.body || {};
  if (!email || !password || !full_name || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Valid email, password, full name and role are required', roles: ROLES });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
  const id = db.prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?,?,?,?)')
    .run(email.toLowerCase(), hashPassword(password), full_name, role).lastInsertRowid;
  db.prepare('INSERT INTO audit_log (user_id, action, target) VALUES (?,?,?)').run(id, 'register', email);
  const token = createSession(id);
  res.json({ token, user: { id, email: email.toLowerCase(), full_name, role } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = createSession(user.id);
  db.prepare('INSERT INTO audit_log (user_id, action) VALUES (?,?)').run(user.id, 'login');
  res.json({ token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, level: user.level } });
});

router.post('/logout', authMiddleware(), (req, res) => {
  const header = req.headers.authorization;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(header.slice(7));
  res.json({ ok: true });
});

router.get('/me', authMiddleware(), (req, res) => res.json({ user: req.user }));

module.exports = { router, authMiddleware, ROLES };
