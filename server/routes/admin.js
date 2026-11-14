// Master platform administration
const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('./auth');

const router = express.Router();
router.use(authMiddleware(['admin']));

router.get('/stats', (req, res) => {
  const count = (sql) => db.prepare(sql).get().c;
  res.json({
    users: count('SELECT COUNT(*) c FROM users'),
    regions: count('SELECT COUNT(*) c FROM regions'),
    cities: count('SELECT COUNT(*) c FROM cities'),
    hospitals: count('SELECT COUNT(*) c FROM hospitals'),
    departments: count('SELECT COUNT(*) c FROM departments'),
    cases: count('SELECT COUNT(*) c FROM cases'),
    publishedCases: count("SELECT COUNT(*) c FROM cases WHERE status='published'"),
    runs: count('SELECT COUNT(*) c FROM case_runs'),
    completedRuns: count("SELECT COUNT(*) c FROM case_runs WHERE status='completed'"),
    prescriptions: count('SELECT COUNT(*) c FROM prescriptions'),
    auditEntries: count('SELECT COUNT(*) c FROM audit_log')
  });
});

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, email, full_name, role, level, created_at FROM users ORDER BY created_at DESC').all();
  const runs = db.prepare("SELECT learner_id, COUNT(*) c FROM case_runs WHERE status='completed' GROUP BY learner_id").all();
  const runMap = Object.fromEntries(runs.map(r => [r.learner_id, r.c]));
  res.json({ users: users.map(u => ({ ...u, completedRuns: runMap[u.id] || 0 })) });
});

router.put('/users/:id/role', (req, res) => {
  const { role } = req.body || {};
  const ROLES = ['student','intern','resident','specialist','surgeon','anaesthetist','nurse','pharmacist','lab_scientist','radiologist','instructor','admin'];
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  db.prepare('INSERT INTO audit_log (user_id, action, target, detail) VALUES (?,?,?,?)').run(req.user.id, 'role_change', req.params.id, role);
  res.json({ ok: true });
});

router.get('/audit', (req, res) => {
  res.json({ audit: db.prepare('SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200').all() });
});

// Learner performance report across runs (instructors and admins)
router.get('/learners/:id/report', (req, res) => {
  const runs = db.prepare(`SELECT cr.*, c.title, c.difficulty FROM case_runs cr JOIN cases c ON c.id = cr.case_id
    WHERE cr.learner_id = ? AND cr.status = 'completed' ORDER BY cr.ended_at DESC`).all(req.params.id);
  const scores = runs.map(r => r.score ? JSON.parse(r.score) : null).filter(Boolean);
  const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x.percentage, 0) / scores.length) : null;
  res.json({
    runs: runs.map(r => ({ id: r.id, title: r.title, difficulty: r.difficulty, ended: r.ended_at, score: r.score ? JSON.parse(r.score) : null })),
    averageScore: avg,
    weakest: avg ? scores.flatMap(s => s.dimensions).reduce((acc, d) => {
      const key = d.dimension;
      const ratio = d.score / d.max;
      if (!acc[key]) acc[key] = { total: 0, max: 0 };
      acc[key].total += d.score; acc[key].max += d.max;
      return acc;
    }, {}) : null
  });
});

module.exports = { router };
