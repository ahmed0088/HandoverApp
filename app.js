/* ════════════════════════════════════════════════════════════
   FRONT OFFICE HANDOVER — APP.JS
   ════════════════════════════════════════════════════════════ */
"use strict";

let db, todayRef, firebaseEnabled = false;

const EMPTY_KPI = () => ({ walkin:0, ext:0, bb:0, room:0, spark:0, prof:0, enrollment:0, welcome:0, allMembership:0 });

let state = {
  meta: { date:'', agent:'', from:'Morning Shift', to:'Evening Shift' },
  kpis: { Morning: EMPTY_KPI(), Evening: EMPTY_KPI(), Night: EMPTY_KPI() },
  handover: [],
  pod: [],
  generalNotes: { morning:'', evening:'', night:'' }
};

let currentKpiShift = 'Morning';
let saveTimer = null;
let isLoading = false;

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDate();
  initFirebase();
  renderAll();
  setupListeners();
});

// ── Firebase ──────────────────────────────────────────────────
function initFirebase() {
  try {
    if (typeof firebase === 'undefined') { setFBStatus('error','Offline'); fallbackLS(); return; }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    firebaseEnabled = true;
    setFBStatus('connecting','Connecting…');
    db.ref('.info/connected').on('value', s => {
      if (s.val()) { setFBStatus('connected','Live'); loadFromDB(); }
      else setFBStatus('connecting','Reconnecting…');
    });
  } catch(e) { setFBStatus('error','Config error'); fallbackLS(); }
}

function setFBStatus(cls, txt) {
  const el = document.getElementById('fbStatus');
  if (el) { el.className = cls; el.innerHTML = `<span class="fb-dot"></span> ${txt}`; }
}

function fallbackLS() {
  try { const r = localStorage.getItem('fo_v4'); if (r) { mergeState(JSON.parse(r)); renderAll(); } } catch(e) {}
}

function getKey() { return (state.meta.date || todayISO()).replace(/-/g,'_'); }

function loadFromDB() {
  const key = getKey();
  todayRef = db.ref(`${DB_ROOT}/${key}`);
  todayRef.on('value', snap => {
    const d = snap.val();
    if (d) { isLoading = true; mergeState(d); renderAll(); isLoading = false; }
  });
}

function saveToDB() {
  if (!firebaseEnabled || !db) { try { localStorage.setItem('fo_v4', JSON.stringify(state)); } catch(e) {} return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.ref(`${DB_ROOT}/${getKey()}`).set(state).catch(() => showToast('Save failed', true));
  }, 600);
}

function onDateChange() {
  const d = document.getElementById('ho_date').value;
  if (!d) return;
  state.meta.date = d;
  document.getElementById('todayDate').textContent = fmtDate(d);
  if (todayRef && firebaseEnabled) todayRef.off();
  state = { ...state, kpis:{ Morning:EMPTY_KPI(), Evening:EMPTY_KPI(), Night:EMPTY_KPI() },
    handover:[], pod:[], generalNotes:{ morning:'', evening:'', night:'' } };
  if (firebaseEnabled) loadFromDB();
  renderAll();
}

function mergeState(d) {
  if (d.meta)         state.meta         = { ...state.meta,         ...d.meta };
  if (d.kpis)         state.kpis         = { ...state.kpis,         ...d.kpis };
  if (d.generalNotes) state.generalNotes = { ...state.generalNotes, ...d.generalNotes };
  if (Array.isArray(d.handover)) state.handover = d.handover;
  if (Array.isArray(d.pod))      state.pod      = d.pod;
}

// ── Collect ───────────────────────────────────────────────────
function collectMeta() {
  state.meta.date  = v('ho_date')  || state.meta.date;
  state.meta.agent = v('ho_agent') || '';
  state.meta.from  = v('ho_from')  || 'Morning Shift';
  state.meta.to    = v('ho_to')    || 'Evening Shift';
}
function collectKpi() {
  const sh = currentKpiShift;
  ['walkin','ext','bb','room','spark','prof','enrollment','welcome','allMembership'].forEach(k => {
    const el = document.getElementById('kpi_'+k); if (el) state.kpis[sh][k] = parseInt(el.value)||0;
  });
}
function collectNotes() {
  ['morning','evening','night'].forEach(s => { const el = document.getElementById('note_'+s); if (el) state.generalNotes[s] = el.value||''; });
}
function collectAll() { collectMeta(); collectKpi(); collectNotes(); }

function autoSave() { if (isLoading) return; collectAll(); saveToDB(); document.getElementById('agentDisplay').textContent = state.meta.agent||'—'; }
function manualSave() { collectAll(); saveToDB(); showToast('Saved'); }

// ── Render ────────────────────────────────────────────────────
function renderAll() {
  setVal('ho_date',  state.meta.date || todayISO());
  setVal('ho_agent', state.meta.agent);
  setVal('ho_from',  state.meta.from);
  setVal('ho_to',    state.meta.to);
  const el = document.getElementById('agentDisplay'); if (el) el.textContent = state.meta.agent||'—';
  renderKpi();
  renderHandoverTable();
  renderPodTable();
  renderNotes();
}

// ── KPI ───────────────────────────────────────────────────────
function renderKpi() {
  const d = state.kpis[currentKpiShift] || EMPTY_KPI();
  ['walkin','ext','bb','room','spark','prof','enrollment','welcome','allMembership'].forEach(k => {
    const el = document.getElementById('kpi_'+k); if (el) el.value = d[k]||'';
  });
  document.querySelectorAll('.kpi-shift-label').forEach(el => el.textContent = currentKpiShift);
  document.querySelectorAll('.shift-pill').forEach(p => p.classList.toggle('active', p.dataset.shift === currentKpiShift));
}
function switchKpiShift(sh) {
  collectKpi(); currentKpiShift = sh; state.meta.shift = sh;
  document.getElementById('currentShift').textContent = sh+' Shift';
  renderKpi();
}

// ── Notes ─────────────────────────────────────────────────────
function renderNotes() {
  ['morning','evening','night'].forEach(s => { const el = document.getElementById('note_'+s); if (el) el.value = state.generalNotes[s]||''; });
}

// ── Handover Table ────────────────────────────────────────────
function renderHandoverTable() {
  const tbody = document.getElementById('heartistBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!state.handover.length) state.handover.push(emptyTask());
  state.handover.forEach((r,i) => tbody.appendChild(makeTaskRow(r,i)));
  applyStatusColors();
}

function emptyTask() { return { id:uid(), date:todayISO(), heartist:'', note:'', update:'', status:'Pending' }; }

function makeTaskRow(r, i) {
  const tr = document.createElement('tr');
  const ss = statusStyle(r.status);
  tr.innerHTML = `
    <td><div class="row-num">${i+1}</div></td>
    <td><input class="cell-input" type="date" value="${r.date||''}" data-id="${r.id}" data-field="date" data-tbl="ho"></td>
    <td><input class="cell-input" value="${esc(r.heartist)}" data-id="${r.id}" data-field="heartist" data-tbl="ho" placeholder="Agent name"></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="note" data-tbl="ho" rows="2" placeholder="Task / note…">${esc(r.note)}</textarea></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="update" data-tbl="ho" rows="2" placeholder="Action taken…">${esc(r.update)}</textarea></td>
    <td>
      <select class="status-sel" data-id="${r.id}" data-tbl="ho" style="background:${ss.bg};color:${ss.color};border-color:${ss.border}">
        ${['Pending','In Progress','Done','Urgent','Follow Up','Info','Cancelled'].map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </td>
    <td><button class="del-btn" data-del="ho" data-id="${r.id}">${trashSvg()}</button></td>`;
  return tr;
}

function addHandoverRow() { state.handover.push(emptyTask()); renderHandoverTable(); autoSave(); }

// ── POD Table ─────────────────────────────────────────────────
function renderPodTable() {
  const tbody = document.getElementById('podBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!state.pod.length) state.pod.push(emptyPod());
  state.pod.forEach((r,i) => tbody.appendChild(makePodRow(r,i)));
}

function emptyPod() { return { id:uid(), room:'', name:'', checkin:'', checkout:'', remarks:'' }; }

function makePodRow(r, i) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><div class="row-num">${i+1}</div></td>
    <td><input class="cell-input" value="${esc(r.room)}" data-id="${r.id}" data-field="room" data-tbl="pod" placeholder="e.g. 401"></td>
    <td><input class="cell-input" value="${esc(r.name)}" data-id="${r.id}" data-field="name" data-tbl="pod" placeholder="Guest name"></td>
    <td><input class="cell-input" type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="pod"></td>
    <td><input class="cell-input" type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="pod"></td>
    <td><input class="cell-input" value="${esc(r.remarks)}" data-id="${r.id}" data-field="remarks" data-tbl="pod" placeholder="Notes…"></td>
    <td><button class="del-btn" data-del="pod" data-id="${r.id}">${trashSvg()}</button></td>`;
  return tr;
}

function addPodRow() { state.pod.push(emptyPod()); renderPodTable(); autoSave(); }

// ── Event listeners ───────────────────────────────────────────
function setupListeners() {
  document.addEventListener('input', e => {
    const el = e.target, id = el.dataset.id, tbl = el.dataset.tbl, field = el.dataset.field;
    if (!id || !tbl) return;
    const arr = tbl === 'ho' ? state.handover : tbl === 'pod' ? state.pod : null;
    if (arr) { const row = arr.find(r => r.id === id); if (row) { row[field] = el.value; autoSave(); } }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.classList.contains('status-sel')) {
      const row = state.handover.find(r => r.id === el.dataset.id);
      if (row) { row.status = el.value; autoSave(); applyStatusEl(el); }
    }
    if (el.dataset.id && el.dataset.tbl && !el.classList.contains('status-sel')) {
      const arr = el.dataset.tbl === 'ho' ? state.handover : el.dataset.tbl === 'pod' ? state.pod : null;
      if (arr) { const row = arr.find(r => r.id === el.dataset.id); if (row) { row[el.dataset.field] = el.value; autoSave(); } }
    }
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const { del: tbl, id } = btn.dataset;
    if (tbl === 'ho')  { state.handover = state.handover.filter(r => r.id !== id); renderHandoverTable(); autoSave(); }
    if (tbl === 'pod') { state.pod = state.pod.filter(r => r.id !== id); renderPodTable(); autoSave(); }
  });
}

// ── Tab navigation ────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  document.getElementById('tab-'+tab).classList.add('active');
  if (tab === 'summary') renderSummary();
}

// ── Summary ───────────────────────────────────────────────────
function renderSummary() {
  collectAll();
  const el = document.getElementById('summaryContent'); if (!el) return;
  const m = state.meta, k = state.kpis;
  el.innerHTML = `
    <div class="summary-block">
      <div class="summary-block-head"><h3>Shift Details</h3></div>
      <div class="summary-block-body">
        <div class="summary-stat-grid">
          ${[['Date', fmtDate(m.date)||'—'],['Agent',m.agent||'—'],['From',m.from||'—'],['To',m.to||'—']].map(([l,v])=>`
          <div class="summary-stat"><div class="summary-stat-label">${l}</div><div class="summary-stat-value" style="font-size:15px">${v}</div></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="summary-block">
      <div class="summary-block-head"><h3>KPI Overview — All Shifts</h3></div>
      <div class="summary-block-body"><div style="overflow-x:auto">
        <table class="data-table"><thead><tr>
          <th>Shift</th><th>Walk In</th><th>Extensions</th><th>BB Up.</th><th>Room Up.</th>
          <th>Sparkles</th><th>Profiles</th><th>Enrollment</th><th>All Memb.</th><th>Welcome Drink</th>
        </tr></thead><tbody>
          ${['Morning','Evening','Night'].map(sh => { const d = k[sh]||EMPTY_KPI(); return `<tr>
            <td><span class="shift-tag ${sh.toLowerCase()}">${sh}</span></td>
            ${['walkin','ext','bb','room','spark','prof','enrollment','allMembership','welcome'].map(f=>`<td style="text-align:center;font-weight:600">${d[f]||'—'}</td>`).join('')}
          </tr>`; }).join('')}
          <tr style="background:var(--surface);font-weight:700"><td><strong>Total</strong></td>
            ${['walkin','ext','bb','room','spark','prof','enrollment','allMembership','welcome'].map(f=>{
              const t = ['Morning','Evening','Night'].reduce((s,sh)=>s+(parseInt(k[sh]?.[f])||0),0);
              return `<td style="text-align:center;color:var(--gold-dim)">${t||'—'}</td>`;
            }).join('')}
          </tr>
        </tbody></table>
      </div></div>
    </div>
    <div class="summary-block">
      <div class="summary-block-head"><h3>Handover Tasks (${state.handover.length})</h3></div>
      <div class="summary-block-body">${state.handover.length===0?'<p style="color:var(--text3);font-size:13px">No tasks.</p>':`
        <div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Date</th><th>Heartist</th><th>Task</th><th>Update</th><th>Status</th></tr></thead><tbody>
          ${state.handover.map(r=>{const ss=statusStyle(r.status);return`<tr>
            <td>${r.date||'—'}</td><td>${esc(r.heartist)||'—'}</td><td>${esc(r.note)||'—'}</td>
            <td>${esc(r.update)||'—'}</td>
            <td><span style="background:${ss.bg};color:${ss.color};padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600">${r.status}</span></td>
          </tr>`}).join('')}
        </tbody></table></div>`}
      </div>
    </div>`;
}

// ── PDF Export ────────────────────────────────────────────────
function exportPDF() {
  collectAll();
  const m = state.meta, k = state.kpis;

  const fmtDateShort = iso => { if (!iso) return ''; const [y,mo,d]=iso.split('-'); return `${d}/${mo}/${y}`; };

  const statusColors = {
    'Pending':     '#F59E0B', 'In Progress': '#3B82F6', 'Done':        '#10B981',
    'Urgent':      '#EF4444', 'Follow Up':   '#8B5CF6', 'Info':        '#0EA5E9', 'Cancelled':   '#9CA3AF'
  };

  const kpiRows = ['Morning','Evening','Night'].map(sh => {
    const d = k[sh]||EMPTY_KPI();
    return `<tr>
      <td>${sh}</td>
      <td>${d.walkin||''}</td><td>${d.ext||''}</td><td>${d.bb||''}</td>
      <td>${d.room||''}</td><td>${d.spark||''}</td><td>${d.prof||''}</td>
      <td>${d.enrollment||''}</td><td>${d.welcome||''}</td>
    </tr>`;
  }).join('');

  const taskRows = state.handover.filter(r => r.date||r.heartist||r.note||r.update).map((r,i) => `
    <tr>
      <td style="text-align:center">${i+1}</td>
      <td>${fmtDateShort(r.date)}</td>
      <td>${esc(r.heartist)}</td>
      <td style="text-align:left">${esc(r.note)}</td>
      <td style="text-align:left">${esc(r.update)}</td>
      <td><span class="badge" style="background:${statusColors[r.status]||'#9CA3AF'}">${r.status||''}</span></td>
    </tr>`).join('');

  const podRows = state.pod.filter(r => r.room||r.name).map((r,i) => `
    <tr>
      <td style="text-align:center">${i+1}</td>
      <td>${esc(r.room)}</td>
      <td>${esc(r.name)}</td>
      <td>${fmtDateShort(r.checkin)}</td>
      <td>${fmtDateShort(r.checkout)}</td>
      <td style="text-align:left">${esc(r.remarks)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Front Office Handover — ${fmtDateShort(m.date)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Outfit',sans-serif; font-size:9pt; color:#1A2030; background:#fff; }
  @page { size:A4; margin:14mm 12mm 14mm 12mm; }

  /* ── HEADER ── */
  .header { display:grid; grid-template-columns:1fr auto; align-items:stretch; margin-bottom:6pt; }
  .header-title { background:#1F5EBD; color:#fff; padding:10pt 14pt; display:flex; flex-direction:column; justify-content:center; border-radius:6pt 0 0 6pt; }
  .header-title h1 { font-size:18pt; font-weight:600; letter-spacing:.5pt; }
  .header-title p  { font-size:8pt; opacity:.8; margin-top:2pt; }
  .header-date { background:#FFD700; padding:10pt 16pt; display:flex; flex-direction:column; align-items:center; justify-content:center; border-radius:0 6pt 6pt 0; min-width:110pt; }
  .header-date .date-val  { font-size:13pt; font-weight:700; color:#000; }
  .header-date .date-lbl  { font-size:7pt; color:#555; text-transform:uppercase; letter-spacing:.5pt; margin-bottom:2pt; }

  /* ── META ROW ── */
  .meta-row { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:4pt; margin-bottom:6pt; }
  .meta-cell { background:#92D050; border-radius:4pt; padding:5pt 8pt; }
  .meta-cell .lbl { font-size:6.5pt; font-weight:600; color:rgba(0,0,0,.55); text-transform:uppercase; letter-spacing:.4pt; }
  .meta-cell .val { font-size:9pt; font-weight:600; color:#000; margin-top:1pt; }

  /* ── SECTION HEADER ── */
  .sec { margin-bottom:2pt; }
  .sec-head { background:#1F5EBD; color:#fff; padding:4pt 8pt; font-size:8pt; font-weight:600; border-radius:4pt 4pt 0 0; text-transform:uppercase; letter-spacing:.5pt; }
  .sec-head.green { background:#92D050; color:#000; }

  /* ── TABLES ── */
  table { width:100%; border-collapse:collapse; font-size:8pt; margin-bottom:6pt; }
  th { background:#BDD7EE; color:#000; font-weight:600; padding:4pt 5pt; text-align:center; border:1pt solid #A0C4E8; font-size:7.5pt; text-transform:uppercase; letter-spacing:.3pt; }
  td { padding:4pt 5pt; border:1pt solid #D1D5DB; vertical-align:top; text-align:center; }
  tr:nth-child(even) td { background:#F8FAFC; }

  /* ── KPI TABLE ── */
  .kpi-table th { background:#0070C0; color:#fff; }

  /* ── STATUS BADGE ── */
  .badge { display:inline-block; color:#fff; padding:1.5pt 6pt; border-radius:20pt; font-size:7pt; font-weight:600; }

  /* ── KPI TOTALS ── */
  .totals td { background:#1A2030; color:#E2C47A; font-weight:700; }

  /* ── FOOTER ── */
  .footer { margin-top:8pt; border-top:1pt solid #E5E1D8; padding-top:5pt; display:flex; justify-content:space-between; font-size:7pt; color:#8A9BB0; }

  /* ── PAGE BREAK ── */
  .page-break { page-break-before:always; }
</style>
</head><body>

<!-- HEADER -->
<div class="header">
  <div class="header-title">
    <h1>Front Office Handover</h1>
    <p>★★★★★ Shift Report</p>
  </div>
  <div class="header-date">
    <div class="date-lbl">Date</div>
    <div class="date-val">${fmtDateShort(m.date)||'—'}</div>
  </div>
</div>

<!-- META -->
<div class="meta-row">
  <div class="meta-cell"><div class="lbl">Agent Name</div><div class="val">${esc(m.agent)||'—'}</div></div>
  <div class="meta-cell"><div class="lbl">Handover</div><div class="val">Shift Report</div></div>
  <div class="meta-cell"><div class="lbl">Handover From</div><div class="val">${esc(m.from)||'—'}</div></div>
  <div class="meta-cell"><div class="lbl">Handover To</div><div class="val">${esc(m.to)||'—'}</div></div>
</div>

<!-- HANDOVER TASKS -->
<div class="sec">
  <div class="sec-head">Heartist Handover Tasks</div>
  <table>
    <thead><tr>
      <th style="width:4%">#</th>
      <th style="width:8%">Date</th>
      <th style="width:11%">Heartist</th>
      <th style="width:30%;text-align:left">Task / Note</th>
      <th style="width:30%;text-align:left">Update / Action Taken</th>
      <th style="width:10%">Status</th>
    </tr></thead>
    <tbody>${taskRows||'<tr><td colspan="6" style="color:#9CA3AF;text-align:center">No tasks recorded</td></tr>'}</tbody>
  </table>
</div>

<!-- KPIs -->
<div class="sec">
  <div class="sec-head">KPI\'s</div>
  <table class="kpi-table">
    <thead><tr>
      <th>Shift</th><th>Walk In</th><th>Extensions</th><th>BB Upselling</th>
      <th>Room Upselling</th><th>Sparkles</th><th>Profiles</th>
      <th>All Enrollment</th><th>Welcome Drink</th>
    </tr></thead>
    <tbody>
      ${kpiRows}
      <tr class="totals">
        <td>TOTAL</td>
        ${['walkin','ext','bb','room','spark','prof','enrollment','welcome'].map(f=>{
          const t=['Morning','Evening','Night'].reduce((s,sh)=>s+(parseInt(k[sh]?.[f])||0),0);
          return`<td>${t||''}</td>`;
        }).join('')}
      </tr>
    </tbody>
  </table>
</div>

<!-- POD ROOMS -->
${state.pod.some(r=>r.room||r.name) ? `
<div class="sec">
  <div class="sec-head" style="background:#0070C0">POD Rooms</div>
  <table>
    <thead><tr>
      <th style="width:5%">#</th>
      <th style="width:12%">Room No.</th>
      <th style="width:25%">Guest Name</th>
      <th style="width:13%">Check-In</th>
      <th style="width:13%">Check-Out</th>
      <th style="width:32%;text-align:left">Remarks</th>
    </tr></thead>
    <tbody>${podRows}</tbody>
  </table>
</div>` : ''}

<!-- NOTES -->
${['morning','evening','night'].some(s=>state.generalNotes[s]) ? `
<div class="sec">
  <div class="sec-head green">Shift Notes</div>
  <table>
    <thead><tr><th style="width:15%">Shift</th><th style="text-align:left">Notes</th></tr></thead>
    <tbody>
      ${['morning','evening','night'].filter(s=>state.generalNotes[s]).map(s=>`
      <tr><td style="font-weight:600;text-transform:capitalize">${s}</td>
      <td style="text-align:left;white-space:pre-wrap">${esc(state.generalNotes[s])}</td></tr>`).join('')}
    </tbody>
  </table>
</div>` : ''}

<div class="footer">
  <span>Front Office Handover Report — ${fmtDateShort(m.date)||'—'}</span>
  <span>Generated ${new Date().toLocaleString('en-GB')}</span>
</div>

</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ── Helpers ───────────────────────────────────────────────────
function v(id)       { const el=document.getElementById(id); return el?el.value:''; }
function setVal(id,val) { const el=document.getElementById(id); if(el&&val!=null) el.value=val; }
function esc(s)      { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid()       { return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function todayISO()  { return new Date().toISOString().split('T')[0]; }
function fmtDate(iso){ if(!iso) return ''; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function trashSvg()  { return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 4h4M5 7h10l-1 10H6L5 7z" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 7h14" stroke-linecap="round"/></svg>`; }

function statusStyle(s) {
  return ({
    'Pending':     {bg:'#FEF3C7',color:'#92400E',border:'#E2C47A'},
    'In Progress': {bg:'#DBEAFE',color:'#1E3A8A',border:'#93C5FD'},
    'Done':        {bg:'#D1FAE5',color:'#065F46',border:'#6EE7B7'},
    'Urgent':      {bg:'#FEE2E2',color:'#991B1B',border:'#FCA5A5'},
    'Follow Up':   {bg:'#EDE9FE',color:'#4C1D95',border:'#C4B5FD'},
    'Info':        {bg:'#F0F9FF',color:'#075985',border:'#BAE6FD'},
    'Cancelled':   {bg:'#F3F4F6',color:'#4B5563',border:'#D1D5DB'},
  })[s] || {bg:'#FEF3C7',color:'#92400E',border:'#E2C47A'};
}
function applyStatusEl(sel) { const ss=statusStyle(sel.value); sel.style.background=ss.bg; sel.style.color=ss.color; sel.style.borderColor=ss.border; }
function applyStatusColors() { document.querySelectorAll('.status-sel').forEach(applyStatusEl); }

function showToast(msg, isErr) {
  const t=document.getElementById('toast'); if(!t) return;
  t.innerHTML=`${isErr?'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><path d="M10 7v4M10 13h.01"/></svg>':'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 10l4 4 6-6"/></svg>'} ${msg}`;
  t.className='toast'+(isErr?' error-toast':'')+' show';
  setTimeout(()=>t.classList.remove('show'),2500);
}

function initDate() {
  const today=todayISO();
  document.getElementById('todayDate').textContent=fmtDate(today);
  if (!state.meta.date) { state.meta.date=today; setVal('ho_date',today); }
  const hr=new Date().getHours();
  const sh=hr>=6&&hr<14?'Morning':hr>=14&&hr<22?'Evening':'Night';
  currentKpiShift=sh; state.meta.shift=sh;
  document.getElementById('currentShift').textContent=sh+' Shift';
}

// ── Expose globals ────────────────────────────────────────────
window.showTab        = showTab;
window.autoSave       = autoSave;
window.manualSave     = manualSave;
window.exportPDF      = exportPDF;
window.onDateChange   = onDateChange;
window.switchKpiShift = switchKpiShift;
window.addHandoverRow = addHandoverRow;
window.addPodRow      = addPodRow;
window.renderSummary  = renderSummary;
window.clearHandover  = () => {
  if (!confirm('Clear all handover tasks?')) return;
  state.handover=[]; renderHandoverTable(); autoSave();
};
