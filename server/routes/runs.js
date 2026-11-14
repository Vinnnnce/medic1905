// Case run workflow — the encounter engine API.
// Learners interact through: chat, examination, orders, prescriptions,
// procedures, oxygen, observations, notes, diagnosis and completion.
// All physiological changes flow through the deterministic engine.
const express = require('express');
const { db } = require('../db');
const { authMiddleware } = require('./auth');
const physiology = require('../engines/physiology');
const conversation = require('../engines/conversation');
const safety = require('../engines/safety');
const scoring = require('../engines/scoring');

const router = express.Router();
router.use(authMiddleware());

function loadRun(id) {
  const run = db.prepare('SELECT * FROM case_runs WHERE id = ?').get(id);
  if (!run) return null;
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(run.case_id);
  return { run, caseRow: c, scenario: JSON.parse(c.scenario) };
}

function persistState(run, state) {
  db.prepare('UPDATE case_runs SET state = ? WHERE id = ?').run(JSON.stringify(state), run.id);
}

function addEvent(run, state, type, data) {
  db.prepare('INSERT INTO run_events (run_id, actor_id, actor_role, type, data) VALUES (?,?,?,?,?)')
    .run(run.id, null, 'system', type, JSON.stringify(data));
  state.events.push({ ...data, type, at: new Date().toISOString() });
}

// ——— Start / list ———
router.post('/runs', (req, res) => {
  const { caseId } = req.body || {};
  const c = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
  if (!c || c.status !== 'published') return res.status(404).json({ error: 'Case not found or not published' });
  const scenario = JSON.parse(c.scenario);
  const state = physiology.newState(scenario, Date.now());
  const id = db.prepare('INSERT INTO case_runs (case_id, learner_id, status, state) VALUES (?,?,?,?)')
    .run(c.id, req.user.id, 'active', JSON.stringify(state)).lastInsertRowid;
  db.prepare('INSERT INTO run_participants (run_id, user_id, role_in_case) VALUES (?,?,?)').run(id, req.user.id, 'learner');
  db.prepare('INSERT INTO chat_messages (run_id, role, content) VALUES (?,?,?)')
    .run(id, 'patient', scenario.presentation.initial);
  db.prepare('INSERT INTO audit_log (user_id, action, target) VALUES (?,?,?)').run(req.user.id, 'run_start', id);
  res.json({ runId: id });
});

router.get('/runs', (req, res) => {
  const rows = db.prepare(`SELECT cr.*, c.title, c.difficulty, c.specialty FROM case_runs cr
    JOIN cases c ON c.id = cr.case_id WHERE cr.learner_id = ? ORDER BY cr.started_at DESC`).all(req.user.id);
  res.json({ runs: rows.map(r => ({ ...r, state: undefined, score: r.score ? JSON.parse(r.score) : null, scenario: undefined })) });
});

// ——— Run state (polling endpoint) ———
router.get('/runs/:id/state', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const state = JSON.parse(ctx.run.state);
  if (state.paused) {
    return res.json(viewState(ctx, state, false));
  }
  physiology.tick(ctx.scenario, state, ctx.run.id);
  const vitals = physiology.computeVitals(ctx.scenario, state, ctx.run.id);
  state.vitals = vitals;
  persistState(ctx.run, state);
  res.json(viewState(ctx, state, true));
});

function viewState(ctx, state, live) {
  const phase = (ctx.scenario.phases || []).find(p => p.id === state.phase) || {};
  const activeComplication = state.pendingComplication
    ? (ctx.scenario.complications || []).find(c => c.id === state.pendingComplication) : null;
  return {
    runId: ctx.run.id,
    status: ctx.run.status,
    live,
    paused: !!state.paused,
    dead: !!state.dead,
    recovered: !!state.recovered,
    phase: { id: state.phase, name: phase.name || '—', description: phase.description || '' },
    vitals: state.vitals,
    news2: physiology.news2(state.vitals || {}),
    minutesElapsed: Math.round(physiology.minutesSince(state.startedAt) * 10) / 10,
    events: (state.events || []).slice(-30),
    complication: activeComplication ? { name: activeComplication.name, description: activeComplication.description, requires: activeComplication.requires } : null,
    completedManagementCount: Object.keys(state.completedManagement || {}).length
  };
}

// ——— Full run detail ———
router.get('/runs/:id', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const state = JSON.parse(ctx.run.state);
  physiology.tick(ctx.scenario, state, ctx.run.id);
  state.vitals = physiology.computeVitals(ctx.scenario, state, ctx.run.id);
  persistState(ctx.run, state);
  const chat = db.prepare('SELECT role, content, ts FROM chat_messages WHERE run_id = ? ORDER BY id').all(ctx.run.id);
  const orders = db.prepare('SELECT * FROM orders WHERE run_id = ? ORDER BY id').all(ctx.run.id);
  const prescriptions = db.prepare('SELECT * FROM prescriptions WHERE run_id = ? ORDER BY id').all(ctx.run.id).map(p => ({ ...p, checks: p.checks ? JSON.parse(p.checks) : null }));
  const notes = db.prepare('SELECT n.*, u.full_name as author_name FROM clinical_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.run_id = ? ORDER BY n.id DESC').all(ctx.run.id);
  const observations = db.prepare('SELECT * FROM nursing_observations WHERE run_id = ? ORDER BY id DESC LIMIT 50').all(ctx.run.id);
  res.json({
    run: { id: ctx.run.id, status: ctx.run.status, started_at: ctx.run.started_at, ended_at: ctx.run.ended_at, score: ctx.run.score ? JSON.parse(ctx.run.score) : null },
    case: { id: ctx.caseRow.id, title: ctx.caseRow.title, difficulty: ctx.caseRow.difficulty, specialty: ctx.caseRow.specialty },
    patient: ctx.scenario.patient,
    allergies: ctx.scenario.history.allergies || [],
    state: viewState(ctx, state, true),
    examsPerformed: state.examsPerformed || [],
    chat, orders: orders.map(o => ({ ...o, result: o.result ? JSON.parse(o.result) : null })),
    prescriptions, notes, observations
  });
});

// ——— Chat with the AI patient ———
router.post('/runs/:id/chat', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message required' });
  const state = JSON.parse(ctx.run.state);
  if (state.dead) return res.status(400).json({ error: 'Patient has died. Complete the debrief.' });
  physiology.tick(ctx.scenario, state, ctx.run.id);
  const turn = db.prepare('SELECT COUNT(*) c FROM chat_messages WHERE run_id = ? AND role = ?').get(ctx.run.id, 'learner').c;
  db.prepare('INSERT INTO chat_messages (run_id, role, content) VALUES (?,?,?)').run(ctx.run.id, 'learner', message);
  const reply = conversation.reply(ctx.scenario, state, message, turn);
  db.prepare('INSERT INTO chat_messages (run_id, role, content) VALUES (?,?,?)').run(ctx.run.id, 'patient', reply);
  // Track covered tags for scoring
  const learnerMsgs = db.prepare("SELECT content FROM chat_messages WHERE run_id = ? AND role = 'learner' ORDER BY id").all(ctx.run.id).map(m => m.content);
  state.tagsCovered = conversation.tagsCovered(ctx.scenario, learnerMsgs);
  state.vitals = physiology.computeVitals(ctx.scenario, state, ctx.run.id);
  persistState(ctx.run, state);
  res.json({ reply });
});

// ——— Examination ———
router.post('/runs/:id/exam', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const system = (req.body.system || '').trim();
  const systems = ctx.scenario.exam.systems || {};
  if (!systems[system]) return res.status(400).json({ error: 'Unknown examination system', available: Object.keys(systems) });
  const state = JSON.parse(ctx.run.state);
  state.examsPerformed = state.examsPerformed || [];
  if (!state.examsPerformed.includes(system)) {
    state.examsPerformed.push(system);
    addEvent(ctx.run, state, 'examination', { system });
    persistState(ctx.run, state);
  }
  const findings = system === 'general' ? ctx.scenario.exam.general : systems[system];
  res.json({ system, findings });
});

// ——— Orders (labs / imaging) ———
router.post('/runs/:id/orders', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const { kind, item, justification, urgent } = req.body || {};
  if (!['lab', 'imaging'].includes(kind) || !item) return res.status(400).json({ error: 'kind (lab|imaging) and item required' });
  const state = JSON.parse(ctx.run.state);
  if (state.dead) return res.status(400).json({ error: 'Patient has died.' });

  const cat = kind === 'lab'
    ? db.prepare('SELECT * FROM lab_catalog WHERE key = ? OR name = ?').get(item, item)
    : db.prepare('SELECT * FROM imaging_catalog WHERE key = ? OR name = ?').get(item, item);
  if (!cat) return res.status(400).json({ error: 'Unknown investigation: ' + item });

  const turnaround = cat.turnaround_min || 30;
  // Real-time compression: ECG ~20s, CXR ~30s, CT ~40s, cultures ~3min
  const processingMs = 15000 + Math.min(turnaround, 240) * 600;
  const id = db.prepare('INSERT INTO orders (run_id, kind, item_key, justification, status, urgent, requested_at, resulted_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(ctx.run.id, kind, cat.key, justification || '', 'processing', urgent ? 1 : 0,
      new Date().toISOString(), new Date(Date.now() + processingMs).toISOString())
    .lastInsertRowid;

  // management credit for expected orders
  const mgmts = ctx.scenario.management.filter(m => (m.type === 'lab' || m.type === 'imaging') && (m.item === cat.key || (m.type === 'imaging' && !m.item)));
  if (mgmts.length) physiology.completeManagement(state, mgmts[0].id, ctx.scenario);
  addEvent(ctx.run, state, 'order', { kind, item: cat.name, urgent: !!urgent, justification: justification || null });
  state.vitals = physiology.computeVitals(ctx.scenario, state, ctx.run.id);
  persistState(ctx.run, state);
  res.json({ orderId: id, status: 'processing', resultedAt: new Date(Date.now() + processingMs).toISOString() });
});

// Called by client polling to collect results
router.get('/runs/:id/orders', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const state = JSON.parse(ctx.run.state);
  const phase = state.phase;
  const pending = db.prepare('SELECT * FROM orders WHERE run_id = ? AND status = ? ORDER BY id').all(ctx.run.id, 'processing');
  for (const o of pending) {
    if (Date.parse(o.resulted_at) <= Date.now()) {
      const result = buildResult(ctx.scenario, state, o);
      db.prepare('UPDATE orders SET status = ?, result = ? WHERE id = ?').run('resulted', JSON.stringify(result), o.id);
      if (result.critical) addEvent(ctx.run, state, 'critical_result', { item: result.name, value: result.value || result.finding });
      persistState(ctx.run, state);
    }
  }
  const orders = db.prepare('SELECT * FROM orders WHERE run_id = ? ORDER BY id').all(ctx.run.id);
  res.json({ orders: orders.map(o => ({ ...o, result: o.result ? JSON.parse(o.result) : null })) });
});

function buildResult(scenario, state, order) {
  const cat = order.kind === 'lab'
    ? db.prepare('SELECT * FROM lab_catalog WHERE key = ?').get(order.item_key)
    : db.prepare('SELECT * FROM imaging_catalog WHERE key = ?').get(order.item_key);
  const name = cat ? cat.name : order.item_key;
  if (order.kind === 'imaging') {
    const defined = (scenario.imaging || {})[order.item_key];
    const finding = defined ? defined.finding : 'Unremarkable study. No acute pathology identified.';
    return { name, modality: cat ? cat.modality : '—', finding, phaseVisible: defined ? defined.phases.includes(state.phase) : true, critical: /occlusion|active|rupture|embol|elevat/i.test(finding) && !!defined };
  }
  // Lab values: scenario baseline + phase modifiers
  const labs = scenario.labs || {};
  const base = (labs.baseline || {})[order.item_key];
  const phaseMod = ((labs.phases || {})[state.phase] || {})[order.item_key];
  let value = base !== undefined ? base : null;
  if (value === null) {
    // generic normal values for unlisted tests
    value = cat && cat.ref_range ? `Within reference range (${cat.ref_range})` : 'No abnormality detected';
    return { name, category: cat ? cat.category : '—', unit: cat ? cat.unit : '', value, normal: true, critical: false };
  }
  if (phaseMod !== undefined) value = phaseMod;
  const criticalPatterns = /k\s*[>=]\s*6|glucose\s*[>=]?\s*(2[5-9]|3\d)|ph\s*7\.[01]|troponin\s*[>=]?\s*(5\d|[6-9]\d|\d{3})|platelets?\s*<\s*\d|h\s*b\s*<\s*80|inr\s*[>=]\s*4/i;
  return { name, category: cat ? cat.category : '—', unit: cat ? cat.unit : '', value: String(value), normal: false, critical: criticalPatterns.test(String(value)) };
}

// ——— Prescriptions with pharmacy safety engine ———
router.post('/runs/:id/prescribe', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const { drug, dose, route, frequency, duration } = req.body || {};
  const d = db.prepare('SELECT * FROM drugs WHERE name = ? OR generic LIKE ?').get(drug, '%' + drug + '%');
  if (!d) return res.status(400).json({ error: 'Unknown drug in formulary: ' + drug });
  const state = JSON.parse(ctx.run.state);
  if (state.dead) return res.status(400).json({ error: 'Patient has died.' });

  const existing = db.prepare('SELECT drug_key FROM prescriptions WHERE run_id = ? AND status != ?').all(ctx.run.id, 'cancelled').map(p => p.drug_key);
  const allergies = ctx.scenario.history.allergies || [];
  const eGFR = 90; // baseline unless case says otherwise
  const check = safety.checkPrescription({ drug: d, prescribed: { dose, route }, patientAllergies: allergies, existingPrescriptions: existing, eGFR });

  const id = db.prepare('INSERT INTO prescriptions (run_id, drug_key, dose, route, frequency, duration, checks) VALUES (?,?,?,?,?,?,?)')
    .run(ctx.run.id, d.name, dose || d.adult_dose, route || 'oral', frequency || 'once daily', duration || '', JSON.stringify(check))
    .lastInsertRowid;

  state.safetyEvents = state.safetyEvents || [];
  state.safetyEvents.push({ drug: d.name, ...check });

  if (check.blocked) {
    addEvent(ctx.run, state, 'prescription_blocked', { drug: d.name, reason: check.issues.filter(i => i.severity === 'critical').map(i => i.message).join('; ') });
    persistState(ctx.run, state);
    return res.json({ blocked: true, prescriptionId: id, checks: check.issues, message: 'PHARMACY SAFETY: prescription flagged. ' + check.issues.filter(i => i.severity === 'critical').map(i => i.message).join(' ') });
  }

  // Administer: engine intervention + management credit
  const key = d.name.toLowerCase();
  physiology.applyIntervention(ctx.scenario, state, key);
  const mgmt = ctx.scenario.management.find(m => m.type === 'drug' && (m.drugs || []).map(x => x.toLowerCase()).includes(key));
  if (mgmt) physiology.completeManagement(state, mgmt.id, ctx.scenario);
  db.prepare('UPDATE prescriptions SET status = ? WHERE id = ?').run('administered', id);
  addEvent(ctx.run, state, 'medication', { drug: d.name, dose: dose || d.adult_dose, route: route || 'oral' });
  state.vitals = physiology.computeVitals(ctx.scenario, state, ctx.run.id);
  persistState(ctx.run, state);
  res.json({ blocked: false, prescriptionId: id, checks: check.issues, message: `${d.name} administered.`, vitals: state.vitals });
});

// ——— Procedures / oxygen / diagnosis / admit / notes / observations ———
router.post('/runs/:id/actions', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const { type, value, system } = req.body || {};
  const state = JSON.parse(ctx.run.state);
  if (state.dead && type !== 'note') return res.status(400).json({ error: 'Patient has died. Proceed to debrief.' });

  switch (type) {
    case 'oxygen': {
      physiology.applyIntervention(ctx.scenario, state, 'oxygen');
      const mgmt = ctx.scenario.management.find(m => m.type === 'oxygen');
      if (mgmt) physiology.completeManagement(state, mgmt.id, ctx.scenario);
      addEvent(ctx.run, state, 'oxygen', { target: value || '94-98%' });
      break;
    }
    case 'procedure': {
      // free-text procedure, matched against expected management
      const text = (value || '').toLowerCase();
      const mgmts = ctx.scenario.management.filter(m => m.type === 'procedure' && !state.completedManagement[m.id]);
      const match = mgmts.find(m => {
        const words = m.label.toLowerCase().split(/\W+/).filter(w => w.length > 4);
        return words.some(w => text.includes(w));
      });
      if (match) {
        physiology.completeManagement(state, match.id, ctx.scenario);
        addEvent(ctx.run, state, 'procedure', { label: match.label });
      } else {
        addEvent(ctx.run, state, 'procedure_attempt', { label: value || 'unspecified procedure', matched: false });
      }
      break;
    }
    case 'defib': {
      physiology.completeManagement(state, 'defib', ctx.scenario);
      addEvent(ctx.run, state, 'defibrillation', { energy: value || '200J' });
      break;
    }
    case 'diagnosis': {
      state.finalDiagnosis = value || '';
      addEvent(ctx.run, state, 'diagnosis_submitted', { diagnosis: value });
      break;
    }
    case 'admit': {
      const mgmt = ctx.scenario.management.find(m => m.type === 'admit');
      if (mgmt) physiology.completeManagement(state, mgmt.id, ctx.scenario);
      addEvent(ctx.run, state, 'admission', { destination: value || 'ward' });
      break;
    }
    case 'note': {
      db.prepare('INSERT INTO clinical_notes (run_id, author_id, type, content) VALUES (?,?,?,?)')
        .run(ctx.run.id, req.user.id, system || 'ward_round', value || '');
      state.notes = db.prepare('SELECT COUNT(*) c FROM clinical_notes WHERE run_id = ?').get(ctx.run.id).c;
      addEvent(ctx.run, state, 'documentation', { system: system || 'note' });
      break;
    }
    case 'observation': {
      const o = req.body;
      db.prepare(`INSERT INTO nursing_observations (run_id, author_id, hr, sbp, dbp, rr, temp, spo2, pain_score, gcs, consciousness, urine_output, fluid_balance, wound, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(ctx.run.id, req.user.id, o.hr, o.sbp, o.dbp, o.rr, o.temp, o.spo2, o.pain_score, o.gcs, o.consciousness, o.urine_output, o.fluid_balance, o.wound, o.notes || '');
      addEvent(ctx.run, state, 'nursing_observation', { recorded: true });
      break;
    }
    default:
      return res.status(400).json({ error: 'Unknown action type' });
  }
  state.vitals = physiology.computeVitals(ctx.scenario, state, ctx.run.id);
  persistState(ctx.run, state);
  res.json({ ok: true, state: viewState(ctx, state, true) });
});

// ——— End run & score ———
router.post('/runs/:id/end', (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const state = JSON.parse(ctx.run.state);
  if (!state.finalDiagnosis && req.body.diagnosis) state.finalDiagnosis = req.body.diagnosis;
  const learnerMsgs = db.prepare("SELECT content FROM chat_messages WHERE run_id = ? AND role = 'learner'").all(ctx.run.id).map(m => m.content);
  state.tagsCovered = conversation.tagsCovered(ctx.scenario, learnerMsgs);
  const notes = db.prepare('SELECT COUNT(*) c FROM clinical_notes WHERE run_id = ?').get(ctx.run.id).c;
  const orders = db.prepare('SELECT * FROM orders WHERE run_id = ?').all(ctx.run.id).map(o => ({ item_key: o.item_key, item: o.item_key }));
  const run = {
    chatLog: db.prepare('SELECT role, content FROM chat_messages WHERE run_id = ?').all(ctx.run.id),
    tagsCovered: state.tagsCovered,
    examsPerformed: state.examsPerformed || [],
    finalDiagnosis: state.finalDiagnosis || '',
    safetyEvents: state.safetyEvents || [],
    notes: new Array(notes),
    orders
  };
  const score = scoring.scoreRun(ctx.scenario, state, run);
  db.prepare("UPDATE case_runs SET status = 'completed', ended_at = datetime('now'), score = ? WHERE id = ?")
    .run(JSON.stringify(score), ctx.run.id);
  db.prepare('INSERT INTO audit_log (user_id, action, target) VALUES (?,?,?)').run(req.user.id, 'run_complete', ctx.run.id);
  res.json({ score });
});

// ——— Instructor: live monitoring & overrides ———
function requireInstructor(req, res, next) {
  if (!['instructor', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Instructor role required' });
  next();
}

router.get('/instructor/runs', requireInstructor, (req, res) => {
  const rows = db.prepare(`SELECT cr.*, c.title, u.full_name as learner_name FROM case_runs cr
    JOIN cases c ON c.id = cr.case_id JOIN users u ON u.id = cr.learner_id
    WHERE cr.status IN ('active','paused') ORDER BY cr.started_at DESC`).all();
  res.json({ runs: rows.map(r => {
    const state = JSON.parse(r.state);
    const scenario = JSON.parse(db.prepare('SELECT scenario FROM cases WHERE id = ?').get(r.case_id).scenario);
    const phase = (scenario.phases || []).find(p => p.id === state.phase) || {};
    return { runId: r.id, caseTitle: r.title, learner: r.learner_name, started: r.started_at, paused: !!state.paused,
      phase: phase.name, news2: physiology.news2(state.vitals || {}), vitals: state.vitals, dead: !!state.dead,
      completedManagement: Object.keys(state.completedManagement || {}).length };
  }) });
});

router.post('/instructor/runs/:id/control', requireInstructor, (req, res) => {
  const ctx = loadRun(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Run not found' });
  const state = JSON.parse(ctx.run.state);
  const { action, complicationId, phaseId } = req.body || {};
  switch (action) {
    case 'pause':
      if (!state.paused) { state.paused = true; state.pausedAt = Date.now(); }
      break;
    case 'resume':
      if (state.paused) { state.phaseEnteredAt += Date.now() - (state.pausedAt || Date.now()); state.paused = false; }
      break;
    case 'inject': {
      const c = (ctx.scenario.complications || []).find(c => c.id === complicationId);
      if (!c) return res.status(400).json({ error: 'Unknown complication' });
      state.pendingComplication = c.id;
      state.events.push({ type: 'complication', name: c.name, description: c.description, at: new Date().toISOString(), injected: true });
      break;
    }
    case 'set_phase': {
      const p = (ctx.scenario.phases || []).find(p => p.id === phaseId);
      if (!p) return res.status(400).json({ error: 'Unknown phase' });
      state.phase = p.id; state.phaseEnteredAt = Date.now();
      if (p.recovery) state.recovered = true;
      break;
    }
    default:
      return res.status(400).json({ error: 'Unknown control action' });
  }
  db.prepare('INSERT INTO audit_log (user_id, action, target, detail) VALUES (?,?,?,?)')
    .run(req.user.id, 'instructor_' + action, ctx.run.id, JSON.stringify({ complicationId, phaseId }));
  persistState(ctx.run, state);
  res.json({ ok: true, state: viewState(ctx, state, true) });
});

module.exports = { router };
