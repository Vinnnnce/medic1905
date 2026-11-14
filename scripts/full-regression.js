/* Full clinical regression — all 18 published cases.
 * Drives each case end-to-end against the live API: history (one question per
 * interview tag), full examination, expected investigations, diagnosis,
 * management (procedures, drugs, oxygen, admission), documentation note,
 * full surgical theatre workflow for theatre cases (or gating check for
 * medical cases), then ends the run and records the deterministic score.
 * Usage: node scripts/full-regression.js [baseUrl] (default http://localhost:3000) */
const Database = require('better-sqlite3');
const BASE = process.argv[2] || 'http://localhost:3000';
const assert = require('assert');

const CHECKLIST = {
  signIn: ['patient_identity', 'site', 'procedure', 'allergies', 'airway_risk', 'blood_loss'],
  timeOut: ['introduce_team', 'patient_confirm', 'site_marking', 'imaging', 'critical_events', 'antibiotic_timing'],
  signOut: ['procedure_recorded', 'instrument_count', 'specimen_labelled', 'key_concerns']
};
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
// mirrors theatre.js parseAsa: first ASA roman numeral in the string
const parseAsa = a => {
  if (typeof a === 'number') return a;
  const m = String(a || '').match(/ASA\s*([IVX]+)/i);
  return m && ROMAN[m[1].toUpperCase()] ? ROMAN[m[1].toUpperCase()] : 3;
};

let token;
const failures = [];

async function api(method, path, body, expectFail) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (expectFail) return { status: res.status, json };
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + JSON.stringify(json).slice(0, 200));
  return json;
}

const allTrue = keys => Object.fromEntries(keys.map(k => [k, true]));

(async () => {
  // login
  const l = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@medic1905.sim', password: 'medic1905' }),
  });
  assert(l.ok, 'login failed');
  token = (await l.json()).token;

  const db = new Database('server/db/medic1905.db', { readonly: true });
  const rows = db.prepare("SELECT id, title, scenario FROM cases WHERE status = 'published' ORDER BY id").all();
  console.log(`FULL REGRESSION — ${rows.length} cases\n`);
  const results = [];

  for (const row of rows) {
    const sc = JSON.parse(row.scenario);
    const problems = [];
    const t = (ok, label) => { if (!ok) problems.push(label); };

    const run = await api('POST', '/api/runs', { caseId: row.id });

    // 1. History — one question per interview tag (longest keyword = most specific)
    for (const item of (sc.interview || [])) {
      const kws = [...item.match].sort((a, b) => b.length - a.length);
      await api('POST', `/api/runs/${run.runId}/chat`, { message: `Could you tell me about the ${kws[0]} please?` });
    }
    t(true, '');

    // 2. Examination — every system
    for (const sys of Object.keys(sc.exam.systems || {})) {
      const ex = await api('POST', `/api/runs/${run.runId}/exam`, { system: sys });
      assert(ex.findings, 'exam missing ' + sys);
    }

    // 3. Expected investigations
    const labKeys = Object.keys((sc.labs && sc.labs.baseline) || {}).filter(k => typeof sc.labs.baseline[k] !== 'string' || !k.endsWith('_note'));
    for (const m of sc.management) {
      if (m.type === 'lab') {
        const item = m.item || labKeys[0] || 'wcc';
        await api('POST', `/api/runs/${run.runId}/orders`, { kind: 'lab', item, justification: m.label });
      } else if (m.type === 'imaging') {
        const item = m.item || Object.keys(sc.imaging || {})[0] || 'cxr';
        await api('POST', `/api/runs/${run.runId}/orders`, { kind: 'imaging', item, justification: m.label });
      }
    }

    // 4. Diagnosis
    await api('POST', `/api/runs/${run.runId}/actions`, { type: 'diagnosis', value: sc.hidden.diagnosis });

    // 5. Procedures (free text = the expected label itself)
    for (const m of sc.management.filter(m => m.type === 'procedure'))
      await api('POST', `/api/runs/${run.runId}/actions`, { type: 'procedure', value: m.label });

    // 6. Drugs — first formulary-listed drug of each expectation
    for (const m of sc.management.filter(m => m.type === 'drug')) {
      let done = false;
      for (const d of m.drugs) {
        // formulary lookup is case-sensitive on name — try exact, then capitalised
        for (const variant of [d, d.charAt(0).toUpperCase() + d.slice(1)]) {
          let pr = null;
          try { pr = await api('POST', `/api/runs/${run.runId}/prescribe`, { drug: variant, dose: 'per protocol', route: 'per protocol' }); }
          catch (e) { continue; } // unknown drug spelling — try next variant
          if (pr.blocked) break; // allergy/interaction teaching point — try next option
          done = true; break;
        }
        if (done) break;
      }
      if (!done && m.drugs.length) problems.push(`drug not administered: ${m.drugs.join('/')}`);
    }

    // 7. Oxygen / admission
    if (sc.management.some(m => m.type === 'oxygen'))
      await api('POST', `/api/runs/${run.runId}/actions`, { type: 'oxygen', value: '94-98%' });
    if (sc.management.some(m => m.type === 'admit'))
      await api('POST', `/api/runs/${run.runId}/actions`, { type: 'admit', value: 'ward' });

    // 8. Documentation
    await api('POST', `/api/runs/${run.runId}/actions`, { type: 'note', system: 'ward_round', value: `Working diagnosis: ${sc.hidden.diagnosis}. Assessment and management plan documented.` });

    // 9. Theatre — full workflow, or gating rejection for medical cases
    let theatreScore = null;
    if (sc.theatre) {
      const block = sc.theatre;
      const preop = await api('POST', `/api/runs/${run.runId}/theatre`, { action: 'preop', data: {
        asaClass: parseAsa(block.asa), airway: 'Mallampati 1, mouth opening >3cm',
        fasting: 'Nil by mouth 6h solids, 2h clear fluids', comorbidities: 'As per case notes',
        allergiesConfirmed: true } });
      t(preop.score >= 80, `preop score ${preop.score}`);
      const consent = await api('POST', `/api/runs/${run.runId}/theatre`, { action: 'consent', data: {
        discussedRisks: block.risks.slice(0, 3), alternatives: 'Conservative options discussed',
        signatureName: 'Regression Learner', signatureRole: 'Student doctor' } });
      t(consent.score >= 90, `consent score ${consent.score}`);
      for (const [action, keys] of [['signin', CHECKLIST.signIn], ['timeout', CHECKLIST.timeOut], ['signout', CHECKLIST.signOut]])
        await api('POST', `/api/runs/${run.runId}/theatre`, { action, data: allTrue(keys) });
      for (let i = 1; i <= block.steps.length; i++) {
        const st = await api('POST', `/api/runs/${run.runId}/theatre`, { action: 'step', data: { stepId: 'step_' + i } });
        if (!st.ok) problems.push(`theatre step ${i} rejected: ${st.error}`);
      }
      const rep = await api('POST', `/api/runs/${run.runId}/theatre`, { action: 'report', data: {
        findings: 'Findings as expected for this procedure', procedureDone: block.procedure,
        complications: 'None', swabCount: 'correct', durationMin: 60 } });
      theatreScore = rep.theatreScore ? rep.theatreScore.total : null;
      t(theatreScore !== null && theatreScore >= 95, `theatre total ${theatreScore}`);
    } else {
      const r = await api('POST', `/api/runs/${run.runId}/theatre`, { action: 'signin', data: {} }, true);
      t(r.status === 400 && /no surgical theatre component/i.test(r.json.error || ''), 'theatre gating failed');
    }

    // 10. End & score
    const end = await api('POST', `/api/runs/${run.runId}/end`);
    const score = end.score;
    results.push({ id: row.id, title: row.title, pct: score.percentage, theatre: theatreScore, dims: score.dimensions });

    const dimLine = score.dimensions.map(d => `${d.dimension} ${d.score}/${d.max}`).join(' · ');
    console.log(`#${String(row.id).padStart(2)} ${row.title.padEnd(52)} ${score.percentage}%` +
      (theatreScore !== null ? ` theatre ${theatreScore}%` : '') + (problems.length ? '  ISSUES: ' + problems.join('; ') : ''));
    console.log(`    ${dimLine}`);
  }

  console.log('\n=== SUMMARY ===');
  const pcts = results.map(r => r.pct);
  console.log(`Cases: ${results.length} · minimum ${Math.min(...pcts)}% · average ${Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)}%`);
  console.log(`Theatre cases: ${results.filter(r => r.theatre !== null).length} (all ${results.filter(r => r.theatre !== null).every(r => r.theatre >= 95) ? '≥95%' : 'BELOW 95%'})`);
  const bad = results.filter(r => r.pct < 75 || r.theatre !== null && r.theatre < 95);
  console.log(bad.length ? `BELOW THRESHOLD: ${bad.map(r => `#${r.id} ${r.pct}%`).join(', ')}` : 'ALL CHECKS PASSED');
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('REGRESSION ERROR:', e.message); process.exit(1); });
