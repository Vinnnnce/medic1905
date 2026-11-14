// Medic1905 database seeder — creates and populates the virtual nation.
const { db } = require('./index');
const { COUNTRY, REGIONS } = require('../data/country');
const { DEPARTMENTS, TIER_DEPARTMENTS, HOSPITAL_NAME_POOLS } = require('../data/departments');
const { DRUGS } = require('../data/drugs');
const { LABS, IMAGING } = require('../data/catalog');
const { CASES_PART1 } = require('../data/cases1');
const { CASES_PART2 } = require('../data/cases2');
const { CASES_PART3 } = require('../data/cases3');
const { CASES_PART4 } = require('../data/cases4');
const bcrypt = require('bcryptjs');

function main() {
  console.log('Seeding Medic1905 Republic...');

  // ——— Departments ———
  const deptStmt = db.prepare('INSERT OR IGNORE INTO departments (key, name, category) VALUES (?,?,?)');
  for (const [key, name, category] of DEPARTMENTS) deptStmt.run(key, name, category);

  // ——— Regions & cities ———
  const regionStmt = db.prepare('INSERT INTO regions (code, name, tier, population, description) VALUES (?,?,?,?,?)');
  const cityStmt = db.prepare('INSERT INTO cities (region_id, name, tier, population) VALUES (?,?,?,?)');
  const cityCache = [];
  for (const r of REGIONS) {
    const rid = regionStmt.run(r.code, r.name, r.tier, r.population, r.description).lastInsertRowid;
    for (const [name, tier, pop] of r.cities) {
      const cid = cityStmt.run(rid, name, tier, pop).lastInsertRowid;
      cityCache.push({ cid, name, tier });
    }
  }

  // ——— Hospitals per city (deterministic) ———
  const hospStmt = db.prepare('INSERT INTO hospitals (city_id, name, tier, beds, has_ed, has_icu, has_theatre) VALUES (?,?,?,?,?,?,?)');
  const hdStmt = db.prepare('INSERT INTO hospital_departments (hospital_id, department_id) VALUES (?,?)');
  const allDeptIds = db.prepare('SELECT id FROM departments').all().map(d => d.id);
  const deptIdByKey = Object.fromEntries(db.prepare('SELECT id, key FROM departments').all().map(d => [d.key, d.id]));
  let hospCount = 0;

  const addHospital = (cityId, name, tier) => {
    const beds = { 'rural-clinic': 12, 'health-centre': 40, 'district-hospital': 180, 'general-hospital': 450, 'teaching-hospital': 1200, 'specialist-centre': 300 }[tier];
    const hasED = ['rural-clinic','health-centre','district-hospital','general-hospital','teaching-hospital'].includes(tier);
    const hasICU = ['district-hospital','general-hospital','teaching-hospital','specialist-centre'].includes(tier);
    const hasTh = ['district-hospital','general-hospital','teaching-hospital','specialist-centre'].includes(tier);
    const hid = hospStmt.run(cityId, name, tier, beds, hasED ? 1 : 0, hasICU ? 1 : 0, hasTh ? 1 : 0).lastInsertRowid;
    let deptKeys = TIER_DEPARTMENTS[tier];
    if (deptKeys === '*') deptKeys = DEPARTMENTS.map(d => d[0]);
    const base = ['administration', 'medical-records', 'billing', 'nursing', 'mortuary'];
    for (const k of new Set([...deptKeys, ...base])) {
      if (deptIdByKey[k]) hdStmt.run(hid, deptIdByKey[k]);
    }
    hospCount++;
    return hid;
  };

  let nameCursor = 0;
  for (const city of cityCache) {
    const pools = {
      'major-city': ['teaching-hospital', 'specialist-centre', 'general-hospital'],
      'city': ['general-hospital', 'specialist-centre'],
      'town': ['district-hospital', 'health-centre'],
      'village': ['rural-clinic']
    };
    for (const tier of pools[city.tier]) {
      const pool = HOSPITAL_NAME_POOLS[tier];
      const name = `${city.name} ${pool[nameCursor++ % pool.length]}`;
      addHospital(city.cid, name, tier);
    }
  }

  // ——— Formulary, lab & imaging catalogs ———
  const drugStmt = db.prepare(`INSERT INTO drugs (name, generic, drug_class, forms, adult_dose, max_dose, renal_note, hepatic_note, pregnancy_category, interactions, contraindications, allergy_tags, high_alert)
    VALUES (@name,@generic,@drug_class,@forms,@adult_dose,@max_dose,@renal_note,@hepatic_note,@pregnancy_category,@interactions,@contraindications,@allergy_tags,@high_alert)`);
  for (const d of DRUGS) drugStmt.run(d);
  const labStmt = db.prepare('INSERT INTO lab_catalog (key, name, category, unit, ref_range, turnaround_min, container) VALUES (?,?,?,?,?,?,?)');
  for (const l of LABS) labStmt.run(...l);
  const imgStmt = db.prepare('INSERT INTO imaging_catalog (key, name, modality, category, turnaround_min, requires_justify) VALUES (?,?,?,?,?,?)');
  for (const i of IMAGING) imgStmt.run(...i);

  // ——— Cases ———
  const caseStmt = db.prepare(`INSERT INTO cases (key, title, specialty, difficulty, scenario_type, description, status, scenario)
    VALUES (?,?,?,?,?,?,?,?)`);
  const allCases = [...CASES_PART1, ...CASES_PART2, ...CASES_PART3, ...CASES_PART4];
  for (const c of allCases) {
    caseStmt.run(c.key, c.title, c.specialty, c.difficulty, c.scenario_type, c.description, 'published', JSON.stringify(c.scenario));
  }

  // ——— Demo users (password: medic1905) ———
  const pw = bcrypt.hashSync('medic1905', 10);
  const userStmt = db.prepare('INSERT INTO users (email, password_hash, full_name, role, level) VALUES (?,?,?,?,?)');
  const demoUsers = [
    ['admin@medic1905.sim', 'Dr. Adaora Nkemelu', 'admin', 'master'],
    ['instructor@medic1905.sim', 'Prof. Marcus Aurelius Reyes', 'instructor', 'consultant'],
    ['student@medic1905.sim', 'Yuki Tanaka', 'student', 'year 3'],
    ['intern@medic1905.sim', 'Karim Aziz', 'intern', 'foundation year 1'],
    ['resident@medic1905.sim', 'Elena Petrova', 'resident', 'IMT2'],
    ['nurse@medic1905.sim', 'Sister Mary Ochieng', 'nurse', 'senior'],
    ['pharmacist@medic1905.sim', 'Dr. Jonas Weber', 'pharmacist', 'senior'],
    ['surgeon@medic1905.sim', 'Mr. Rafael Delgado', 'surgeon', 'consultant'],
    ['radiologist@medic1905.sim', 'Dr. Aisha Mbeki', 'radiologist', 'consultant'],
    ['lab@medic1905.sim', 'Dr. Stefan Novak', 'lab_scientist', 'consultant']
  ];
  for (const [email, name, role, level] of demoUsers) {
    try { userStmt.run(email, pw, name, role, level); } catch (e) { /* already seeded */ }
  }

  console.log(`Seeded: ${REGIONS.length} regions, ${cityCache.length} cities, ${hospCount} hospitals, ${DEPARTMENTS.length} departments, ${DRUGS.length} drugs, ${LABS.length} lab tests, ${IMAGING.length} imaging modalities, ${allCases.length} clinical cases, ${demoUsers.length} demo accounts.`);
  console.log('Demo login: student@medic1905.sim / medic1905 (also instructor, resident, nurse, pharmacist, surgeon, radiologist, lab, intern, admin)');
}
main();
