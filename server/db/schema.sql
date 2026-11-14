-- Medic1905 Virtual Hospital — core schema
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','intern','resident','specialist','surgeon','anaesthetist','nurse','pharmacist','lab_scientist','radiologist','instructor','admin')),
  level TEXT DEFAULT 'beginner',
  city_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('rural','suburban','urban','metropolitan')),
  population INTEGER NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('village','town','city','major-city')),
  population INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('rural-clinic','health-centre','district-hospital','general-hospital','teaching-hospital','specialist-centre')),
  beds INTEGER NOT NULL,
  has_ed INTEGER DEFAULT 0,
  has_icu INTEGER DEFAULT 0,
  has_theatre INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital_departments (
  hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (hospital_id, department_id)
);

CREATE TABLE IF NOT EXISTS drugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  generic TEXT NOT NULL,
  drug_class TEXT NOT NULL,
  forms TEXT NOT NULL,
  adult_dose TEXT NOT NULL,
  max_dose TEXT,
  renal_note TEXT,
  hepatic_note TEXT,
  pregnancy_category TEXT,
  interactions TEXT NOT NULL,      -- JSON: [{with, severity, note}]
  contraindications TEXT NOT NULL, -- JSON array
  allergy_tags TEXT NOT NULL,      -- JSON array
  high_alert INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lab_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT,
  ref_range TEXT NOT NULL,
  turnaround_min INTEGER DEFAULT 45,
  container TEXT
);

CREATE TABLE IF NOT EXISTS imaging_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  modality TEXT NOT NULL,
  category TEXT NOT NULL,
  turnaround_min INTEGER DEFAULT 30,
  requires_justify INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  specialty TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('undergraduate','intern','resident','specialist')),
  scenario_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  author_id INTEGER REFERENCES users(id),
  scenario TEXT NOT NULL,   -- full scenario JSON (see docs/ARCHITECTURE.md)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS case_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id),
  learner_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','aborted')),
  state TEXT NOT NULL,       -- live physiology/progress state JSON
  score TEXT,               -- final rubric score JSON
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS run_participants (
  run_id INTEGER NOT NULL REFERENCES case_runs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role_in_case TEXT NOT NULL DEFAULT 'learner',
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, user_id)
);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES case_runs(id) ON DELETE CASCADE,
  ts TEXT DEFAULT (datetime('now')),
  actor_id INTEGER,
  actor_role TEXT,
  type TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES case_runs(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('learner','patient','system')),
  content TEXT NOT NULL,
  ts TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES case_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('lab','imaging')),
  item_key TEXT NOT NULL,
  justification TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','resulted','rejected')),
  requested_at TEXT DEFAULT (datetime('now')),
  resulted_at TEXT,
  result TEXT,             -- JSON result payload
  urgent INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES case_runs(id) ON DELETE CASCADE,
  drug_key TEXT NOT NULL,
  dose TEXT NOT NULL,
  route TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT,
  checks TEXT,             -- JSON safety check results
  status TEXT NOT NULL DEFAULT 'prescribed' CHECK (status IN ('prescribed','dispensed','administered','cancelled')),
  prescribed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES case_runs(id) ON DELETE CASCADE,
  author_id INTEGER,
  type TEXT NOT NULL,       -- admission, ward_round, handover, procedure, discharge, nursing
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nursing_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES case_runs(id) ON DELETE CASCADE,
  author_id INTEGER,
  hr INTEGER, sbp INTEGER, dbp INTEGER, rr INTEGER, temp REAL, spo2 INTEGER,
  pain_score INTEGER, gcs INTEGER,
  consciousness TEXT, urine_output TEXT, fluid_balance TEXT, wound TEXT, notes TEXT,
  recorded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now')),
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_run ON run_events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_run ON orders(run_id);
CREATE INDEX IF NOT EXISTS idx_chat_run ON chat_messages(run_id, id);
CREATE INDEX IF NOT EXISTS idx_runs_learner ON case_runs(learner_id);
