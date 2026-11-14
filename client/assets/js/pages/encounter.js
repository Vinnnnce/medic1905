// Encounter workspace — consultation, exam, orders, prescribing, actions, nursing, debrief
let ENC = { runId: null, tab: 'consult', chatBusy: false, orders: [] };

Pages.encounter = async function () {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const runId = params.get('id');
  if (!runId) { location.hash = '/library'; return App.shell('<div class="wrap"></div>'); }
  ENC.runId = runId;
  ENC.tab = params.get('tab') || (params.get('view') === 'debrief' ? 'debrief' : 'consult');
  const data = await api.get('/runs/' + runId);
  ENC.data = data;
  ENC.allergies = data.allergies || [];
  return App.shell(renderEncounter());
};

function renderEncounter() {
  const d = ENC.data;
  if (!d) return '<div class="empty">Loading…</div>';
  const completed = d.run.status === 'completed';
  const tabs = [
    ['consult', 'Consultation'], ['exam', 'Examination'], ['invest', 'Investigations'],
    ['rx', 'Prescribing'], ['actions', 'Procedures'], ['nursing', 'Nursing & Notes'], ['debrief', completed ? 'Debrief & Report' : 'Finish & Debrief']
  ];
  return `
  <div class="grid" style="grid-template-columns:1fr 340px;gap:14px;align-items:start;" id="enc-main">
    <div>
      <div class="card card-pad mb" id="enc-header">${encHeaderHtml(d)}</div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="${ENC.tab === k ? 'active' : ''}" onclick="encTab('${k}')">${l}</button>`).join('')}</div>
      <div id="enc-body">${encBodyHtml()}</div>
    </div>
    <div id="enc-side">${encSideHtml(d)}</div>
  </div>
  <style>@media(max-width:1000px){#enc-main{grid-template-columns:1fr !important;}}</style>`;
}

function encHeaderHtml(d) {
  const p = d.patient;
  return `
  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:flex-start;">
    <div>
      <h2 style="font-size:19px;">${esc(p.name)} <span class="muted" style="font-weight:400;">— ${p.age}${p.sex}, ${esc(p.occupation || '')}</span></h2>
      <div class="sub" style="margin-bottom:4px;">${esc(d.case.title)} · <span class="badge blue">${esc(d.case.difficulty)}</span> <span class="badge teal">${esc(d.case.specialty)}</span></div>
      <div style="font-size:13px;" class="muted">Allergies: ${esc((ENC.allergies || []).map(a => a.drug || a).join(', ') || 'None known — confirm with the patient')}</div>
    </div>
    <div style="text-align:right;">
      <div class="badge ${d.run.status === 'completed' ? 'green' : 'blue'}">${esc(d.run.status.toUpperCase())}</div>
      <div class="muted" style="font-size:12px;margin-top:6px;padding-bottom:4px;">Started ${fmtTime(d.run.started_at)}</div>
    </div>
  </div>`;
}

function encSideHtml(d) {
  const s = d.state;
  const news = s.news2;
  const newsClass = news >= 7 ? 'news-5plus' : news >= 5 ? 'news-1-4' : 'news-0';
  const v = s.vitals || {};
  const crit = (val, test) => test ? 'crit' : '';
  return `
  <div class="monitor mb">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span style="font-size:11px;color:#5b8a97;letter-spacing:1px;">PATIENT MONITOR — SIMULATED</span>
      <span style="font-size:11px;color:#5b8a97;">${esc(s.phase.name)}</span>
    </div>
    <div class="monitor-grid">
      <div class="vital ${v.hr > 120 || v.hr < 50 ? 'crit' : ''}"><div class="v-label">HR</div><div class="v-value">${v.hr ?? '—'}</div><div class="v-unit">bpm</div></div>
      <div class="vital ${v.sbp < 90 || v.sbp > 180 ? 'crit' : ''}"><div class="v-label">NIBP</div><div class="v-value">${v.sbp ?? '—'}/${v.dbp ?? '—'}</div><div class="v-unit">mmHg</div></div>
      <div class="vital ${v.rr > 24 || v.rr < 10 ? 'crit' : ''}"><div class="v-label">RR</div><div class="v-value">${v.rr ?? '—'}</div><div class="v-unit">/min</div></div>
      <div class="vital ${v.spo2 < 92 ? 'crit' : ''}"><div class="v-label">SpO2</div><div class="v-value">${v.spo2 ?? '—'}</div><div class="v-unit">%</div></div>
      <div class="vital ${v.temp >= 38 || v.temp < 36 ? 'crit' : ''}"><div class="v-label">TEMP</div><div class="v-value">${v.temp ?? '—'}</div><div class="v-unit">°C</div></div>
      <div class="vital ${v.gcs < 13 ? 'crit' : ''}"><div class="v-label">GCS</div><div class="v-value">${v.gcs ?? '—'}</div><div class="v-unit">/15</div></div>
      <div class="vital"><div class="v-label">PAIN</div><div class="v-value">${v.pain ?? '—'}</div><div class="v-unit">/10</div></div>
      <div class="vital"><div class="v-label">TIME</div><div class="v-value" style="font-size:16px;">${Math.floor(s.minutesElapsed)}m</div><div class="v-unit">elapsed</div></div>
    </div>
    <div style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:11px;color:#5b8a97;">NEWS2 SCORE</span>
      <span class="news-chip ${newsClass}" style="background:#16252f;color:${news >= 7 ? '#ff6b6b' : news >= 5 ? '#ffd166' : '#7ef9c5'};">${news}</span>
    </div>
  </div>
  ${s.complication ? `<div class="alert critical"><b>⚠ ${esc(s.complication.name)}</b><br>${esc(s.complication.description)}${s.complication.requires ? `<br><b>Required action: ${esc(s.complication.requires)}</b> — use the Procedures tab NOW.` : ''}</div>` : ''}
  ${s.dead ? `<div class="alert critical"><b>Patient deceased.</b> Complete the debrief to review what happened and what should have been done differently.</div>` : ''}
  ${s.paused ? '<div class="alert warning">Simulation paused by instructor.</div>' : ''}
  <div class="card card-pad">
    <h3>Clinical timeline</h3>
    <div style="max-height:300px;overflow-y:auto;">
      ${(s.events || []).slice().reverse().map(e => `
        <div style="font-size:12.5px;padding:6px 0;border-bottom:1px solid var(--line);">
          <span class="muted mono" style="font-size:11px;">${e.at ? fmtTime(e.at) : ''}</span>
          ${eventLabel(e)}${e.onTime === false ? ' <span class="badge red">late</span>' : ''}
        </div>`).join('') || '<div class="empty">No events yet.</div>'}
    </div>
  </div>`;
}


function eventLabel(e) {
  const map = {
    order: () => 'Ordered: ' + (e.item || e.id || 'investigation'),
    medication: () => `Given <b>${esc(e.drug || 'drug')}</b> ${esc(e.dose || '')} ${esc(e.route || '')}`,
    prescription_blocked: () => `<span style="color:var(--red);">Pharmacy blocked: ${esc(e.drug || 'prescription')}</span>`,
    examination: () => 'Examined: ' + esc(e.system),
    diagnosis_submitted: () => 'Diagnosis recorded: <b>' + esc(e.diagnosis || '') + '</b>',
    critical_result: () => '<b style="color:var(--red);">CRITICAL RESULT: ' + esc(e.item || '') + '</b>',
    oxygen: () => 'Oxygen therapy started (target ' + esc(e.target || '') + ')',
    defibrillation: () => '<b>Defibrillated ' + esc(e.energy || '') + '</b>',
    admission: () => 'Admitted — ' + esc(e.destination || 'ward'),
    complication: () => '<b style="color:var(--red);">⚠ ' + esc(e.name || '') + '</b>',
    phase: () => 'Phase change: <b>' + esc(e.name || '') + '</b>',
    death: () => '<b style="color:var(--red);">Patient died — ' + esc(e.description || '') + '</b>',
    resuscitated: () => '<b style="color:var(--green);">Resuscitation successful — ' + esc(e.name || '') + '</b>',
    documentation: () => 'Note written (' + esc(e.type2 || e.system || 'clinical') + ')',
    nursing_observation: () => 'Nursing observation recorded',
    management: () => '✓ ' + esc(e.label || e.id || ''),
    procedure: () => 'Performed: ' + esc(e.label || ''),
    procedure_attempt: () => 'Attempted: ' + esc(e.label || '') + ' <span class="badge amber">not recognised</span>'
  };
  const fn = map[e.type];
  return fn ? fn() : esc(e.name || e.label || e.type);
}

function encTab(tab) {
  ENC.tab = tab;
  document.querySelectorAll('.tabs button').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase().includes(({
      consult: 'consultation', exam: 'examination', invest: 'investigations',
      rx: 'prescribing', actions: 'procedures', nursing: 'nursing', debrief: 'debrief'
    })[tab] || tab));
  });
  const body = document.getElementById('enc-body');
  body.innerHTML = encBodyHtml();
  if (tab === 'consult') loadChatScroll();
  if (tab === 'invest') pollOrders();
  if (tab === 'nursing') renderNotes();
}

function encBodyHtml() {
  const d = ENC.data;
  switch (ENC.tab) {
    case 'consult': return consultHtml(d);
    case 'exam': return examHtml(d);
    case 'invest': return investHtml(d);
    case 'rx': return rxHtml(d);
    case 'actions': return actionsHtml(d);
    case 'nursing': return nursingHtml(d);
    case 'debrief': return debriefHtml(d);
  }
  return '';
}

// ——— Consultation ———
function consultHtml(d) {
  const chat = d.chat.map(m => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('');
  const suggestions = ['Where is the pain?', 'When did it start?', 'What does the pain feel like?', 'Do you have any allergies?', 'What medications do you take?', 'Any medical history?', 'Do you smoke?', 'Any family history?'];
  return `
  <div class="card card-pad">
    <h2>Consultation with the AI patient</h2>
    <div class="sub">Ask open questions first, then narrow down. The patient reveals symptoms according to what you ask — they never know their own diagnosis. Emotional state colours their answers.</div>
    <div class="chat-box" id="chat-box">${chat}</div>
    <div class="q-suggest">${suggestions.map(s => `<button onclick="quickAsk('${s.replace(/'/g, "\\'")}')">${s}</button>`).join('')}</div>
    <div class="chat-input">
      <input id="chat-input" placeholder="Ask the patient…" onkeydown="if(event.key==='Enter')sendChat()">
      <button class="btn" onclick="sendChat()" ${d.state.dead ? 'disabled' : ''}>Send</button>
    </div>
  </div>`;
}
function loadChatScroll() { const b = document.getElementById('chat-box'); if (b) b.scrollTop = b.scrollHeight; }
function quickAsk(q) { document.getElementById('chat-input').value = q; sendChat(); }
async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg || ENC.chatBusy) return;
  ENC.chatBusy = true;
  input.value = '';
  const box = document.getElementById('chat-box');
  box.insertAdjacentHTML('beforeend', `<div class="msg learner">${esc(msg)}</div><div class="msg patient" id="typing">…</div>`);
  box.scrollTop = box.scrollHeight;
  try {
    const r = await api.post(`/runs/${ENC.runId}/chat`, { message: msg });
    document.getElementById('typing').remove();
    box.insertAdjacentHTML('beforeend', `<div class="msg patient">${esc(r.reply)}</div>`);
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    document.getElementById('typing')?.remove();
    box.insertAdjacentHTML('beforeend', `<div class="msg system">${esc(e.message)}</div>`);
  }
  ENC.chatBusy = false;
}

// ——— Examination ———
function examHtml(d) {
  const systems = ['general', 'cardiovascular', 'respiratory', 'abdominal', 'neuro', 'peripheral', 'gynaecological', 'obstetric', 'ent', 'skin'];
  const done = d.examsPerformed || [];
  return `
  <div class="card card-pad">
    <h2>Clinical examination</h2>
    <div class="sub">Findings appear only when you examine the relevant system. Done: ${done.length} system(s).</div>
    <div class="pill-row mb">
      ${systems.map(s => `<button class="sys-btn ${done.includes(s) ? 'active' : ''}" onclick="doExam('${s}')">${s[0].toUpperCase() + s.slice(1)}${done.includes(s) ? ' ✓' : ''}</button>`).join('')}
    </div>
    <div id="exam-result"></div>
  </div>`;
}
async function doExam(system) {
  try {
    const r = await api.post(`/runs/${ENC.runId}/exam`, { system });
    document.getElementById('exam-result').innerHTML = `
      <div class="alert info"><b>${esc(r.system[0].toUpperCase() + r.system.slice(1))} examination</b><br>${esc(r.findings)}</div>`;
    ENC.data.examsPerformed = ENC.data.examsPerformed || [];
    if (!ENC.data.examsPerformed.includes(system)) ENC.data.examsPerformed.push(system);
    document.querySelectorAll('.sys-btn').forEach(b => { if (b.textContent.toLowerCase().startsWith(system)) b.classList.add('active'); });
  } catch (e) { alert(e.message); }
}

// ——— Investigations ———
function investHtml(d) {
  const cat = window._catalog || { labs: [], imaging: [] };
  const byCat = {};
  for (const l of cat.labs) (byCat[l.category] = byCat[l.category] || []).push(l);
  return `
  <div class="card card-pad mb">
    <h2>Order investigations</h2>
    <div class="sub">Results are generated by the simulation engine according to the patient's underlying condition and current phase. Critical values trigger alerts. Justify your imaging requests.</div>
    <h3>Laboratory</h3>
    ${Object.entries(byCat).map(([c, labs]) => `
      <div style="margin:8px 0;"><b style="font-size:12px;color:var(--ink-faint);text-transform:uppercase;">${esc(c)}</b></div>
      <div class="pill-row">${labs.map(l => `<button class="badge gray" style="cursor:pointer;font-size:12px;" onclick="orderItem('lab','${esc(l.key)}','${esc(l.name)}')">${esc(l.name)}</button>`).join('')}</div>
    `).join('')}
    <h3 style="margin-top:16px;">Imaging & diagnostics</h3>
    <div class="pill-row">${cat.imaging.map(i => `<button class="badge blue" style="cursor:pointer;font-size:12px;" onclick="orderItem('imaging','${esc(i.key)}','${esc(i.name)}')">${esc(i.name)}</button>`).join('')}</div>
  </div>
  <div class="card card-pad">
    <h2>Results</h2>
    <div id="order-list">${ordersHtml(d.orders || [])}</div>
  </div>`;
}
function ordersHtml(orders) {
  if (!orders.length) return '<div class="empty">No investigations ordered yet.</div>';
  return orders.slice().reverse().map(o => `
    <div style="padding:10px 0;border-bottom:1px solid var(--line);">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <b>${esc(o.item_key)}</b>
        <span class="badge ${o.status === 'resulted' ? 'green' : 'amber'}">${esc(o.status)}</span>
      </div>
      ${o.justification ? `<div class="muted" style="font-size:12px;">Indication: ${esc(o.justification)}</div>` : ''}
      ${o.status === 'resulted' ? resultHtml(o) : `<div class="muted" style="font-size:12px;">Processing… (result at ${fmtTime(o.resulted_at)})</div>`}
    </div>`).join('');
}
function resultHtml(o) {
  const r = o.result;
  if (!r) return '';
  if (r.modality) return `<div style="font-size:13px;margin-top:4px;" class="${r.critical ? 'result-crit' : ''}"><b>${esc(r.modality)} report:</b> ${esc(r.finding)}</div>`;
  return `<div style="font-size:13px;margin-top:4px;" class="${r.critical ? 'result-crit' : ''}">
    <b>${esc(r.name)}:</b> ${esc(r.value)}${r.unit ? ' ' + esc(r.unit) : ''} ${r.normal ? '<span class="badge green">normal</span>' : (r.critical ? '<span class="badge red">CRITICAL</span>' : '')}
    ${r.category ? `<span class="muted" style="font-size:11px;">(${esc(r.category)}, ref: see catalog)</span>` : ''}</div>`;
}
async function orderItem(kind, key, name) {
  const justify = kind === 'imaging' ? prompt(`Clinical justification for ${name}:`) : '';
  if (kind === 'imaging' && (justify === null || !justify.trim())) { alert('Imaging requests require a clinical justification (radiation safety).'); return; }
  try {
    await api.post(`/runs/${ENC.runId}/orders`, { kind, item: key, justification: justify, urgent: false });
    pollOrders();
  } catch (e) { alert(e.message); }
}
async function pollOrders() {
  try {
    const r = await api.get(`/runs/${ENC.runId}/orders`);
    ENC.data.orders = r.orders;
    const el = document.getElementById('order-list');
    if (el) el.innerHTML = ordersHtml(r.orders);
    ENC.seenCrit = ENC.seenCrit || new Set();
    const criticals = r.orders.filter(o => o.result && o.result.critical && !ENC.seenCrit.has(o.id));
    for (const c of criticals) {
      ENC.seenCrit.add(c.id);
      ENC.data.state.events.push({ type: 'critical_result', item: c.result.name + ': ' + String(c.result.value || c.result.finding || '').slice(0, 90), at: new Date().toISOString() });
    }
    if (criticals.length) refreshSide();
    setTimeout(() => { if (ENC.tab === 'invest') pollOrders(); }, 4000);
  } catch (e) { /* polling continues */ }
}

// ——— Prescribing ———
function rxHtml(d) {
  const drugs = window._drugs || [];
  if (!drugs.length) {
    api.get('/catalog/drugs').then(r => { window._drugs = r.drugs; if (ENC.tab === 'rx') encTab('rx'); });
    return '<div class="card card-pad"><div class="empty">Loading formulary…</div></div>';
  }
  return `
  <div class="grid cols-2">
    <div class="card card-pad">
      <h2>Prescribe medication</h2>
      <div class="sub">The pharmacy safety engine checks allergies, interactions, contraindications and renal dosing before administration. Blocked prescriptions are never administered.</div>
      <div class="field"><label>Drug (formulary)</label>
        <select id="rx-drug">${drugs.map(x => `<option value="${esc(x.name)}">${esc(x.name)} — ${esc(x.drug_class)}</option>`).join('')}</select>
      </div>
      <div class="row">
        <div class="field"><label>Dose</label><input id="rx-dose" placeholder="e.g. 300mg"></div>
        <div class="field"><label>Route</label><select id="rx-route"><option>oral</option><option>IV</option><option>IM</option><option>SC</option><option>nebulised</option><option>sublingual</option></select></div>
        <div class="field"><label>Frequency</label><input id="rx-freq" placeholder="e.g. once / TDS / 1mg/kg/h"></div>
      </div>
      <button class="btn" onclick="prescribe()">Prescribe & administer</button>
      <div id="rx-checks" class="mt"></div>
    </div>
    <div class="card card-pad">
      <h2>Medication administration record</h2>
      <div id="rx-list">${rxListHtml(d.prescriptions || [])}</div>
    </div>
  </div>`;
}
function rxListHtml(rx) {
  if (!rx.length) return '<div class="empty">No medications given yet.</div>';
  return `<table><tr><th>Drug</th><th>Dose</th><th>Status</th></tr>${rx.map(p => `
    <tr><td><b>${esc(p.drug_key)}</b></td><td>${esc(p.dose)} ${esc(p.route)}</td>
    <td><span class="badge ${p.status === 'administered' ? 'green' : 'red'}">${esc(p.status)}</span></td></tr>`).join('')}</table>`;
}
async function prescribe() {
  const drug = document.getElementById('rx-drug').value;
  const dose = document.getElementById('rx-dose').value;
  const route = document.getElementById('rx-route').value;
  const frequency = document.getElementById('rx-freq').value;
  try {
    const r = await api.post(`/runs/${ENC.runId}/prescribe`, { drug, dose, route, frequency });
    const checksEl = document.getElementById('rx-checks');
    checksEl.innerHTML = `
      <div class="alert ${r.blocked ? 'critical' : 'success'}">${esc(r.message)}</div>
      ${(r.checks || []).map(c => `<div class="alert ${c.severity === 'critical' ? 'critical' : c.severity === 'major' ? 'warning' : 'info'}" style="font-size:12.5px;">${esc(c.message)}</div>`).join('')}`;
    ENC.data.prescriptions = (ENC.data.prescriptions || []).concat([{ drug_key: drug, dose, route, status: r.blocked ? 'flagged' : 'administered' }]);
    document.getElementById('rx-list').innerHTML = rxListHtml(ENC.data.prescriptions);
    if (!r.blocked) refreshSide();
  } catch (e) { alert(e.message); }
}

// ——— Procedures & actions ———
function actionsHtml(d) {
  return `
  <div class="grid cols-2">
    <div class="card card-pad">
      <h2>Oxygen therapy</h2>
      <div class="sub">Current SpO2 ${d.state.vitals.spo2}%. Give oxygen for hypoxia; remember COPD patients need 88-92% targets.</div>
      <div class="row">
        <button class="btn" onclick="doAction('oxygen','94-98%')">Oxygen mask (target 94-98%)</button>
        <button class="btn secondary" onclick="doAction('oxygen','88-92%')">Oxygen — COPD target (88-92%)</button>
      </div>
      <h2 class="mt">Cardiac resuscitation</h2>
      <div class="sub">If the monitor shows VF/VT arrest, deliver a defibrillator shock without delay.</div>
      <button class="btn danger" onclick="if(confirm('Deliver 200J biphasic shock?'))doAction('defib','200J')">⚡ Defibrillate 200J</button>
    </div>
    <div class="card card-pad">
      <h2>Procedures & decisions</h2>
      <div class="sub">Describe the procedure or decision you are performing. The engine matches it against clinically expected actions.</div>
      <div class="field"><label>Procedure / decision</label>
        <input id="proc-input" placeholder="e.g. activate cath lab for primary PCI" onkeydown="if(event.key==='Enter')doAction('procedure')">
      </div>
      <button class="btn" onclick="doAction('procedure')">Perform / decide</button>
      <div class="mt">
        <div class="field"><label>Working diagnosis (submit before finishing)</label>
          <input id="dx-input" placeholder="e.g. Acute inferior STEMI" value="${esc(ENC.data.state.finalDiagnosis || (ENC.dxInput || ''))}">
        </div>
        <button class="btn secondary" onclick="submitDx()">Record diagnosis</button>
      </div>
      <div class="mt">
        <button class="btn secondary" onclick="doAction('admit','ward')">Admit patient to ward</button>
      </div>
    </div>
  </div>
  <div class="card card-pad mt" id="action-log">
    <h2>Recent actions</h2>
    ${(d.state.events || []).filter(e => ['oxygen', 'procedure', 'defibrillation', 'medication', 'diagnosis_submitted', 'admission'].includes(e.type)).slice(-8).reverse().map(e =>
      `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid var(--line);"><span class="muted mono" style="font-size:11px;">${e.at ? fmtTime(e.at) : ''}</span> ${esc(e.label || e.drug || e.diagnosis || e.destination || e.type)}</div>`).join('') || '<div class="empty">No actions yet.</div>'}
  </div>`;
}
async function doAction(type, value) {
  if (type === 'procedure') value = document.getElementById('proc-input').value.trim();
  try {
    const r = await api.post(`/runs/${ENC.runId}/actions`, { type, value });
    ENC.data.state = { ...ENC.data.state, ...r.state };
    refreshSide();
    if (type === 'procedure') {
      document.getElementById('proc-input').value = '';
      encTab('actions');
    }
  } catch (e) { alert(e.message); }
}
async function submitDx() {
  const dx = document.getElementById('dx-input').value.trim();
  ENC.dxInput = dx;
  if (!dx) return alert('Enter your working diagnosis first.');
  await doAction('diagnosis', dx);
  alert('Diagnosis recorded: ' + dx + '\nIt will be assessed in the debrief.');
}

// ——— Nursing & notes ———
function nursingHtml(d) {
  return `
  <div class="grid cols-2">
    <div class="card card-pad">
      <h2>Nursing observation chart</h2>
      <div class="sub">Record observations to track the patient's trajectory. Early-warning scores drive escalation.</div>
      <div class="row">
        <div class="field"><label>HR</label><input id="obs-hr" type="number" value="${d.state.vitals.hr}"></div>
        <div class="field"><label>BP (sys/dia)</label><input id="obs-bp" value="${d.state.vitals.sbp}/${d.state.vitals.dbp}"></div>
        <div class="field"><label>RR</label><input id="obs-rr" type="number" value="${d.state.vitals.rr}"></div>
        <div class="field"><label>SpO2</label><input id="obs-spo2" type="number" value="${d.state.vitals.spo2}"></div>
        <div class="field"><label>Temp</label><input id="obs-temp" type="number" step="0.1" value="${d.state.vitals.temp}"></div>
        <div class="field"><label>Pain score</label><input id="obs-pain" type="number" min="0" max="10" value="${d.state.vitals.pain ?? 0}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Consciousness (ACVPU)</label><select id="obs-cons"><option>A — Alert</option><option>C — Confused</option><option>V — Voice</option><option>P — Pain</option><option>U — Unresponsive</option></select></div>
        <div class="field"><label>Urine output</label><input id="obs-urine" placeholder="e.g. 30mL/h"></div>
        <div class="field"><label>Fluid balance</label><input id="obs-fluid" placeholder="e.g. +250mL"></div>
        <div class="field"><label>Wound / skin</label><input id="obs-wound" placeholder="e.g. clean, dry, intact"></div>
      </div>
      <button class="btn" onclick="saveObservation()">Record observation</button>
    </div>
    <div class="card card-pad">
      <h2>Clinical notes</h2>
      <div class="field"><label>Note type</label>
        <select id="note-type"><option value="admission">Admission clerking</option><option value="ward_round">Ward round</option><option value="handover">Handover (SBAR)</option><option value="procedure">Procedure note</option><option value="discharge">Discharge summary</option><option value="nursing">Nursing note</option></select>
      </div>
      <div class="field"><label>Content</label><textarea id="note-content" rows="5" placeholder="Document findings, differential, plan…"></textarea></div>
      <button class="btn secondary" onclick="saveNote()">Write note</button>
      <div id="notes-list" class="mt"></div>
    </div>
  </div>
  <div class="card card-pad mt">
    <h2>Recorded observations</h2>
    ${(d.observations || []).slice().reverse().map(o => `
      <div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--line);">
        <span class="muted mono" style="font-size:11px;">${fmtTime(o.recorded_at)}</span>
        HR ${o.hr} · BP ${o.sbp}/${o.dbp} · RR ${o.rr} · SpO2 ${o.spo2}% · T ${o.temp}°C · pain ${o.pain_score ?? '—'} · ${esc(o.consciousness || '')} ${o.urine_output ? '· urine ' + esc(o.urine_output) : ''} ${o.fluid_balance ? '· balance ' + esc(o.fluid_balance) : ''}
      </div>`).join('') || '<div class="empty">No observations recorded yet.</div>'}
  </div>`;
}
async function saveObservation() {
  const bp = document.getElementById('obs-bp').value.split('/');
  const body = {
    hr: +document.getElementById('obs-hr').value, sbp: +bp[0], dbp: +bp[1],
    rr: +document.getElementById('obs-rr').value, spo2: +document.getElementById('obs-spo2').value,
    temp: +document.getElementById('obs-temp').value, pain_score: +document.getElementById('obs-pain').value,
    consciousness: document.getElementById('obs-cons').value,
    urine_output: document.getElementById('obs-urine').value, fluid_balance: document.getElementById('obs-fluid').value,
    wound: document.getElementById('obs-wound').value
  };
  await doAction('observation', body.type);
  ENC.data.observations = (ENC.data.observations || []).concat([body]);
  encTab('nursing');
}
async function saveNote() {
  const content = document.getElementById('note-content').value.trim();
  if (!content) return;
  await api.post(`/runs/${ENC.runId}/actions`, { type: 'note', value: content, system: document.getElementById('note-type').value });
  ENC.data.notes = (ENC.data.notes || []).concat([{ content, type: document.getElementById('note-type').value, author_name: api.user.full_name, created_at: new Date().toISOString() }]);
  renderNotes();
  document.getElementById('note-content').value = '';
}
function renderNotes() {
  const el = document.getElementById('notes-list');
  if (!el) return;
  el.innerHTML = (ENC.data.notes || []).map(n => `
    <div style="padding:8px 0;border-bottom:1px solid var(--line);">
      <b style="font-size:13px;">${esc(n.type)}</b> <span class="muted" style="font-size:11px;">by ${esc(n.author_name || 'you')} · ${n.created_at ? fmtTime(n.created_at) : ''}</span>
      <div style="font-size:13px;white-space:pre-wrap;">${esc(n.content)}</div>
    </div>`).join('') || '<div class="empty">No notes yet.</div>';
}

// ——— Debrief ———
function debriefHtml(d) {
  const s = d.run.score;
  if (!s) {
    return `
    <div class="card card-pad">
      <h2>Finish encounter & receive debrief</h2>
      <div class="sub">Ending the encounter locks the encounter and generates your full assessment report: nine scored dimensions, missed findings, the hidden diagnosis, and learning points.</div>
      ${!ENC.data.state.finalDiagnosis ? '<div class="alert warning">You have not recorded a working diagnosis — do it in the Procedures tab first for full credit.</div>' : `<div class="alert info">Recorded diagnosis: <b>${esc(ENC.data.state.finalDiagnosis)}</b></div>`}
      <button class="btn danger" onclick="endRun()">End encounter & generate report</button>
    </div>`;
  }
  return `
  <div class="card card-pad mb">
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;align-items:center;">
      <div>
        <h2>Assessment report</h2>
        <div class="sub">${esc(s.grade)} · Outcome: ${esc(s.outcome)}</div>
      </div>
      <div class="score-big" style="color:${s.percentage >= 70 ? 'var(--green)' : s.percentage >= 50 ? 'var(--amber)' : 'var(--red)'};">${s.percentage}%</div>
    </div>
    ${s.dimensions.map(dim => `
      <div style="margin:10px 0;">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;"><b>${esc(dim.dimension)}</b><span>${dim.score}/${dim.max}</span></div>
        <div class="bar"><div style="width:${Math.round(100 * dim.score / dim.max)}%;background:${dim.score / dim.max >= .7 ? 'var(--green)' : dim.score / dim.max >= .4 ? 'var(--amber)' : 'var(--red)'};"></div></div>
        <div class="muted" style="font-size:12px;">${esc(dim.detail)}</div>
      </div>`).join('')}
  </div>
  <div class="grid cols-2">
    <div class="card card-pad">
      <h2>Clinical debrief</h2>
      <div class="alert info"><b>Correct diagnosis:</b> ${esc(s.debrief.correctDiagnosis)}</div>
      <p style="font-size:14px;">${esc(s.debrief.summary)}</p>
      <h3 class="mt">Learning points</h3>
      <ul style="padding-left:18px;font-size:13.5px;">${s.debrief.learningPoints.map(p => `<li style="margin:5px 0;">${esc(p)}</li>`).join('')}</ul>
      <h3 class="mt">References</h3>
      <ul style="padding-left:18px;font-size:13px;" class="muted">${s.debrief.references.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>
    <div>
      <div class="card card-pad mb">
        <h2>Expected differentials</h2>
        ${s.debrief.expectedDifferentials.map(x => `<div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:13.5px;"><b>${esc(x.dx)}</b><br><span class="muted">${esc(x.why)}</span></div>`).join('')}
      </div>
      ${s.missedManagement.length ? `<div class="card card-pad mb"><h2>Missed management steps</h2><ul style="padding-left:18px;font-size:13.5px;">${s.missedManagement.map(m => `<li style="margin:4px 0;color:var(--red);">${esc(m)}</li>`).join('')}</ul></div>` : '<div class="alert success">All expected management steps were performed.</div>'}
      ${s.missedHistory.length ? `<div class="card card-pad"><h2>History areas not covered</h2><div class="pill-row">${s.missedHistory.map(t => `<span class="badge amber">${esc(t.replace(/_/g, ' '))}</span>`).join('')}</div></div>` : ''}
    </div>
  </div>
  <div class="mt"><a class="btn" href="#/library">Next case</a></div>`;
}
async function endRun() {
  const dx = ENC.data.state.finalDiagnosis || ENC.dxInput || '';
  try {
    const r = await api.post(`/runs/${ENC.runId}/end`, { diagnosis: dx });
    ENC.data.run.score = r.score;
    ENC.data.run.status = 'completed';
    encTab('debrief');
  } catch (e) { alert(e.message); }
}

// ——— Live polling ———
function refreshSide() {
  const side = document.getElementById('enc-side');
  const header = document.getElementById('enc-header');
  if (side && ENC.data) side.innerHTML = encSideHtml(ENC.data);
  if (header && ENC.data) header.innerHTML = encHeaderHtml(ENC.data);
}
window.addEventListener('hashchange', () => { clearInterval(window._encPoll); });
window._encPoll = setInterval(async () => {
  if (!ENC.runId || location.hash.includes('/encounter')) {
    try {
      const r = await api.get(`/runs/${ENC.runId}/state`);
      ENC.data.state = { ...ENC.data.state, ...r };
      refreshSide();
    } catch (e) { /* token or run issue — stop silently */ }
  }
}, 4000);
