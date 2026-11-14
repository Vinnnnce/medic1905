/* Paediatric regression: croup + kawasaki — full clinical workflow + theatre gating.
 * Usage: node scripts/paediatric-regression.js [baseUrl] (default http://localhost:3000) */
const BASE = process.argv[2] || 'http://localhost:3000';
const assert = require('assert');

let token, results = [];

async function api(method, path, body, expectFail) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (expectFail) return { status: res.status, json };
  if (!res.ok) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + JSON.stringify(json).slice(0, 300));
  return json;
}

async function login(user) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user + '@medic1905.sim', password: 'medic1905' }),
  });
  assert(res.ok, 'login failed for ' + user);
  token = (await res.json()).token;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function doCase({ key, name, chat, exams, orders, diagnosis, drugs, procedures, oxygen, admit, note, theatreReject }) {
  const run = await api('POST', '/api/runs', { caseId: key });
  const log = [];
  const t = (label, ok, extra) => { log.push(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`); if (!ok) process.exitCode = 1; };

  // History — cover interview tags
  for (const msg of chat) await api('POST', `/api/runs/${run.runId}/chat`, { message: msg });
  t('history conversation', true, `${chat.length} questions asked`);

  // Examination — all systems
  for (const s of exams) {
    const ex = await api('POST', `/api/runs/${run.runId}/exam`, { system: s });
    assert(ex.findings, 'exam findings missing: ' + s);
  }
  t('examination', true, `${exams.length} systems examined (incl. general)`);

  // Investigations
  for (const o of orders) {
    const ord = await api('POST', `/api/runs/${run.runId}/orders`, o);
    assert(ord.orderId, 'order failed');
  }
  if (orders.length) { await wait(1000); await api('GET', `/api/runs/${run.runId}/orders`); }
  t('investigations', true, orders.length ? orders.map(o => o.item).join(', ') : 'none ordered (clinical diagnosis)');

  // Diagnosis
  await api('POST', `/api/runs/${run.runId}/actions`, { type: 'diagnosis', value: diagnosis });
  t('diagnosis submitted', true, diagnosis);

  // Management
  for (const p of procedures) {
    await api('POST', `/api/runs/${run.runId}/actions`, { type: 'procedure', value: p });
  }
  t('procedures', true, `${procedures.length} performed`);
  for (const d of drugs) {
    const pr = await api('POST', `/api/runs/${run.runId}/prescribe`, { drug: d.drug, dose: d.dose, route: d.route || 'oral' });
    assert(pr.blocked !== true || d.allowBlocked, 'prescription blocked unexpectedly: ' + d.drug + ' ' + JSON.stringify(pr));
  }
  t('prescriptions', true, drugs.map(d => d.drug).join(', '));
  if (oxygen) { await api('POST', `/api/runs/${run.runId}/actions`, { type: 'oxygen', value: oxygen }); t('oxygen', true, oxygen); }
  if (admit) { await api('POST', `/api/runs/${run.runId}/actions`, { type: 'admit', value: admit }); t('admission', true, admit); }
  await api('POST', `/api/runs/${run.runId}/actions`, { type: 'note', system: 'ward_round', value: note });
  t('documentation', true, 'clinical note written');

  // Theatre gating — these medical cases have no theatre component
  if (theatreReject) {
    const r = await api('POST', `/api/runs/${run.runId}/theatre`, { action: 'signin', checklist: { patient_identity: true, site: true, procedure: true, consent_form: true } }, true);
    t('theatre correctly rejected', r.status === 400 && /no surgical theatre component/i.test(r.json.error || ''), `HTTP ${r.status}: ${(r.json.error || '').slice(0, 80)}`);
  }

  // End & score
  const end = await api('POST', `/api/runs/${run.runId}/end`);
  const score = end.score || end;
  results.push({ name, score: score.percentage, dims: score.dimensions });
  console.log(`${log.join('\n')}`);
  console.log(`  SCORE  ${name}: overall ${score.percentage}%` +
    (score.dimensions ? ' — ' + score.dimensions.map(d => `${d.dimension} ${d.score}/${d.max}`).join(' · ') : ''));
  console.log('');
  return score;
}

(async () => {
  await login('student');
  console.log('=== PAEDIATRIC REGRESSION: croup + kawasaki ===\n');

  await doCase({
    key: 17, name: 'Croup (Elsie Moreau, 2F)',
    exams: ['respiratory', 'ent', 'cardiovascular', 'neuro'],
    chat: [
      'When did this start?', 'What does the cough sound like?', 'Is it worse when she cries or lies down?',
      'Is she drooling or able to swallow?', 'Does she have a fever?', 'How is her breathing?',
      'Are her vaccinations up to date including Hib?', 'Has she had anything like this before?',
    ],
    note: 'Croup: moderate severity — stridor at rest with recession. Dexamethasone given, nebulised adrenaline, kept calm on mum\'s lap, anaesthetics informed, continuous monitoring. Safety-netting explained.',
    orders: [],
    diagnosis: 'Viral croup (laryngotracheobronchitis)',
    procedures: [
      'Keep the child calm on her mother\'s lap',
      'Continuous monitoring of a child with stridor at rest',
      'Senior anaesthetic review — theatre on standby for intubation',
      'Discharge with safety-netting advice once stridor resolved, drinking, steroids given',
    ],
    drugs: [
      { drug: 'Dexamethasone', dose: '0.15mg/kg PO once (max 12mg)', route: 'oral' },
      { drug: 'Adrenaline', dose: '5mL of 1:1000 nebulised', route: 'nebulised' },
    ],
    oxygen: '94-98%',
    admit: 'paediatric observation ward',
    theatreReject: true,
  });

  await doCase({
    key: 18, name: 'Kawasaki disease (3F)',
    exams: ['ent', 'lymph', 'skin', 'cardiovascular', 'respiratory', 'neuro'],
    chat: [
      'How long has the fever been going on?', 'Any rash or redness of the eyes, mouth or hands?',
      'Any swollen glands in the neck?', 'Has she had any recent infections or antibiotics?',
      'Any joint pain, abdominal pain or vomiting?', 'Is she drinking and passing urine?',
      'Has she been irritable or clingy or just not herself?', 'Any travel or unwell contacts?',
    ],
    orders: [
      { kind: 'lab', item: 'wcc' }, { kind: 'lab', item: 'crp' }, { kind: 'lab', item: 'esr' },
      { kind: 'lab', item: 'hb' }, { kind: 'lab', item: 'platelets' }, { kind: 'lab', item: 'alt' },
      { kind: 'lab', item: 'urinalysis' },
      { kind: 'imaging', item: 'echo', justification: 'Baseline echocardiogram — coronary assessment in suspected Kawasaki' },
    ],
    diagnosis: 'Kawasaki disease (incomplete features evolving to complete)',
    note: 'Day 5 fever with conjunctival injection, cracked lips, strawberry tongue, polymorphous rash, indurative hand/foot oedema and a 2.5cm cervical node — complete Kawasaki. IVIG 2g/kg and aspirin started, baseline echo booked, ibuprofen stopped.',
    procedures: [
      'Recognise 5 days of fever with 4 features — complete Kawasaki disease',
      'Serial echocardiography at weeks 2 and 6 with cardiology follow-up',
      'Avoid corticosteroids as first-line; stop ibuprofen due to aspirin interaction',
    ],
    drugs: [
      { drug: 'Immunoglobulin', dose: '2g/kg IV single infusion over 8-12 hours', route: 'IV' },
      { drug: 'Aspirin', dose: '30-50mg/kg/day anti-inflammatory dose', route: 'oral' },
    ],
    oxygen: null,
    admit: 'paediatric ward',
    theatreReject: true,
  });

  console.log('=== SUMMARY ===');
  for (const r of results) console.log(`${r.name}: ${r.score}% overall`);
  const min = Math.min(...results.map(r => r.score));
  console.log(min >= 80 ? `\nALL CHECKS PASSED (minimum overall ${min}%)` : `\nSCORE BELOW THRESHOLD (minimum ${min}%)`);
})().catch(e => { console.error('REGRESSION ERROR:', e.message); process.exit(1); });
