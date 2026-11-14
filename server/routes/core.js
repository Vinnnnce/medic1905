// Country, hospitals, departments, and clinical case library
const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('./auth');

const router = express.Router();

// ——— The Medic1905 Republic ———
router.get('/country', (req, res) => {
  const regions = db.prepare('SELECT * FROM regions ORDER BY tier, name').all();
  const cities = db.prepare('SELECT * FROM cities').all();
  const hospitals = db.prepare('SELECT * FROM hospitals').all();
  const byRegion = {};
  for (const r of regions) {
    byRegion[r.id] = { ...r, cities: [] };
  }
  const cityMap = {};
  for (const c of cities) {
    cityMap[c.id] = { ...c, hospitals: [] };
    if (byRegion[c.region_id]) byRegion[c.region_id].cities.push(cityMap[c.id]);
  }
  for (const h of hospitals) if (cityMap[h.city_id]) cityMap[h.city_id].hospitals.push(h);
  res.json({ country: { name: 'Medic1905 Republic', tagline: 'The virtual nation of the Medic1905 teaching hospital network', emergencyNumber: '1905' }, regions: Object.values(byRegion) });
});

router.get('/departments', (req, res) => {
  res.json({ departments: db.prepare('SELECT * FROM departments ORDER BY category, name').all() });
});

router.get('/hospitals/:id', (req, res) => {
  const h = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hospital not found' });
  const depts = db.prepare(`SELECT d.* FROM departments d
    JOIN hospital_departments hd ON hd.department_id = d.id
    WHERE hd.hospital_id = ? ORDER BY d.category, d.name`).all(h.id);
  const city = db.prepare('SELECT c.*, r.name as region_name, r.tier as region_tier FROM cities c JOIN regions r ON r.id = c.region_id WHERE c.id = ?').get(h.city_id);
  res.json({ hospital: h, city, departments: depts });
});

// ——— Case library ———
function caseForLearner(row) {
  const s = JSON.parse(row.scenario);
  return {
    id: row.id, key: row.key, title: row.title, specialty: row.specialty, difficulty: row.difficulty,
    scenario_type: row.scenario_type, description: row.description, status: row.status,
    patient: { name: s.patient.name, age: s.patient.age, sex: s.patient.sex },
    presentation: s.presentation,
    examSystems: Object.keys(s.exam.systems || {}),
    theatre: s.theatre ? { procedure: s.theatre.procedure, anaesthesia: s.theatre.anaesthesia, steps: s.theatre.steps.length } : null,
    labCatalogAvailable: true
  };
}

router.get('/cases', authMiddleware(), (req, res) => {
  const { difficulty, specialty, type } = req.query;
  let rows = db.prepare('SELECT * FROM cases WHERE status = ? ORDER BY difficulty, specialty').all('published');
  if (req.user.role === 'instructor' || req.user.role === 'admin') {
    rows = db.prepare('SELECT * FROM cases ORDER BY status, difficulty').all();
  }
  if (difficulty) rows = rows.filter(r => r.difficulty === difficulty);
  if (specialty) rows = rows.filter(r => r.specialty === specialty);
  if (type) rows = rows.filter(r => r.scenario_type === type);
  res.json({ cases: rows.map(caseForLearner) });
});

router.get('/cases/:id', authMiddleware(), (req, res) => {
  const row = db.prepare('SELECT * FROM cases WHERE id = ? OR key = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  if (req.user.role === 'instructor' || req.user.role === 'admin') {
    return res.json({ case: { ...row, scenario: JSON.parse(row.scenario) } });
  }
  res.json({ case: caseForLearner(row) });
});

// Instructor authoring
function requireInstructor(req, res, next) {
  if (!['instructor', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Instructor role required' });
  next();
}

router.post('/cases', authMiddleware(), requireInstructor, (req, res) => {
  const { key, title, specialty, difficulty, scenario_type, description, scenario } = req.body || {};
  if (!key || !title || !scenario) return res.status(400).json({ error: 'key, title and scenario are required' });
  const existing = db.prepare('SELECT id FROM cases WHERE key = ?').get(key);
  if (existing) return res.status(409).json({ error: 'Case key already exists' });
  const id = db.prepare(`INSERT INTO cases (key, title, specialty, difficulty, scenario_type, description, status, author_id, scenario)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(key, title, specialty || 'general-medicine', difficulty || 'undergraduate', scenario_type || 'clinical',
      description || title, 'draft', req.user.id, JSON.stringify(scenario)).lastInsertRowid;
  db.prepare('INSERT INTO audit_log (user_id, action, target) VALUES (?,?,?)').run(req.user.id, 'case_create', key);
  res.json({ id, ok: true });
});

router.put('/cases/:id', authMiddleware(), requireInstructor, (req, res) => {
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  const { title, specialty, difficulty, scenario_type, description, scenario, status } = req.body || {};
  db.prepare(`UPDATE cases SET title=?, specialty=?, difficulty=?, scenario_type=?, description=?, scenario=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(title || row.title, specialty || row.specialty, difficulty || row.difficulty, scenario_type || row.scenario_type,
      description || row.description, scenario ? JSON.stringify(scenario) : row.scenario, status || row.status, row.id);
  res.json({ ok: true });
});

router.post('/cases/:id/duplicate', authMiddleware(), requireInstructor, (req, res) => {
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Case not found' });
  const newKey = row.key + '-v' + Date.now().toString(36);
  db.prepare(`INSERT INTO cases (key, title, specialty, difficulty, scenario_type, description, status, author_id, scenario)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(newKey, row.title + ' (copy)', row.specialty, row.difficulty, row.scenario_type, row.description, 'draft', req.user.id, row.scenario);
  res.json({ ok: true, key: newKey });
});

router.post('/cases/:id/publish', authMiddleware(), requireInstructor, (req, res) => {
  db.prepare(`UPDATE cases SET status='published', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  db.prepare('INSERT INTO audit_log (user_id, action, target) VALUES (?,?,?)').run(req.user.id, 'case_publish', req.params.id);
  res.json({ ok: true });
});

// Catalogs for ordering UI
router.get('/catalog/labs', authMiddleware(), (req, res) => {
  res.json({ labs: db.prepare('SELECT * FROM lab_catalog ORDER BY category, name').all() });
});
router.get('/catalog/imaging', authMiddleware(), (req, res) => {
  res.json({ imaging: db.prepare('SELECT * FROM imaging_catalog ORDER BY category, name').all() });
});
router.get('/catalog/drugs', authMiddleware(), (req, res) => {
  res.json({ drugs: db.prepare('SELECT * FROM drugs ORDER BY name').all() });
});

module.exports = { router };
