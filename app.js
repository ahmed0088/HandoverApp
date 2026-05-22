/* ════════════════════════════════════════════════════════════
   FRONT OFFICE HANDOVER — APP.JS
   ════════════════════════════════════════════════════════════ */
"use strict";

let db, todayRef, firebaseEnabled = false;

const EMPTY_KPI = () => ({ walkin:0, ext:0, bb:0, room:0, spark:0, prof:0, enrollment:0, welcome:0, allMembership:0 });

let state = {
  meta: { date:'', agent:'', receiver:'', from:'Morning Shift', to:'Evening Shift' },
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
  if (el) { el.className = cls; el.innerHTML = `<span class="fb-dot"></span> <span class="hide-mobile">${txt}</span>`; }
}

function fallbackLS() {
  try { const r = localStorage.getItem('fo_v5'); if (r) { mergeState(JSON.parse(r)); renderAll(); } } catch(e) {}
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
  // Strip image data before saving to Firebase (too large), save separately in localStorage
  const saveState = JSON.parse(JSON.stringify(state));
  saveState.handover = saveState.handover.map(r => {
    const copy = {...r};
    if (copy.images) copy.images = copy.images.map(img => ({ id: img.id, name: img.name }));
    return copy;
  });

  if (!firebaseEnabled || !db) {
    try { localStorage.setItem('fo_v5', JSON.stringify(state)); } catch(e) {}
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.ref(`${DB_ROOT}/${getKey()}`).set(saveState).catch(() => showToast('Save failed', true));
    // Save full state (with images) to localStorage as backup
    try { localStorage.setItem('fo_v5', JSON.stringify(state)); } catch(e) {}
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
  if (Array.isArray(d.handover)) {
    // Restore image data from localStorage if available
    const lsData = (() => { try { return JSON.parse(localStorage.getItem('fo_v5')||'{}'); } catch(e) { return {}; } })();
    const lsHandover = lsData.handover || [];
    state.handover = d.handover.map(r => {
      const lsRow = lsHandover.find(lr => lr.id === r.id);
      return { ...r, images: lsRow?.images || r.images || [] };
    });
  }
  if (Array.isArray(d.pod)) state.pod = d.pod;
}

// ── Collect ───────────────────────────────────────────────────
function collectMeta() {
  state.meta.date     = v('ho_date')     || state.meta.date;
  state.meta.agent    = v('ho_agent')    || '';
  state.meta.receiver = v('ho_receiver') || '';
  state.meta.from     = v('ho_from')     || 'Morning Shift';
  state.meta.to       = v('ho_to')       || 'Evening Shift';
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

function autoSave() {
  if (isLoading) return;
  collectAll();
  saveToDB();
  document.getElementById('agentDisplay').textContent = state.meta.agent||'—';
}
function manualSave() { collectAll(); saveToDB(); showToast('Saved ✓'); }

// ── Render ────────────────────────────────────────────────────
function renderAll() {
  setVal('ho_date',     state.meta.date || todayISO());
  setVal('ho_agent',    state.meta.agent);
  setVal('ho_receiver', state.meta.receiver);
  setVal('ho_from',     state.meta.from);
  setVal('ho_to',       state.meta.to);
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

// ── Image helpers ─────────────────────────────────────────────
function openImagePicker(rowId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = e => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const row = state.handover.find(r => r.id === rowId);
        if (!row) return;
        if (!row.images) row.images = [];
        row.images.push({ id: uid(), name: file.name, data: ev.target.result });
        renderHandoverTable();
        autoSave();
      };
      reader.readAsDataURL(file);
    });
  };
  input.click();
}

function removeImage(rowId, imgId) {
  const row = state.handover.find(r => r.id === rowId);
  if (row && row.images) {
    row.images = row.images.filter(img => img.id !== imgId);
    renderHandoverTable();
    autoSave();
  }
}

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightboxImg').src = src;
  lb.classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

// ── Handover Table ────────────────────────────────────────────
function renderHandoverTable() {
  const isMobile = window.innerWidth <= 680;

  // Desktop table
  const tbody = document.getElementById('heartistBody');
  if (tbody) {
    tbody.innerHTML = '';
    if (!state.handover.length) state.handover.push(emptyTask());
    state.handover.forEach((r,i) => tbody.appendChild(makeTaskRow(r,i)));
    applyStatusColors();
  }

  // Mobile cards
  const mobileList = document.getElementById('heartistMobileList');
  if (mobileList) {
    mobileList.innerHTML = '';
    if (!state.handover.length) state.handover.push(emptyTask());
    state.handover.forEach((r,i) => mobileList.appendChild(makeTaskCard(r,i)));
  }
}

function emptyTask() { return { id:uid(), date:todayISO(), heartist:'', note:'', update:'', status:'Pending', images:[] }; }

function makeTaskRow(r, i) {
  const tr = document.createElement('tr');
  const ss = statusStyle(r.status);
  const imgs = (r.images||[]);
  const imgHtml = imgs.map(img => `
    <img class="img-thumb" src="${img.data||''}" title="${esc(img.name)}" onclick="event.stopPropagation();openLightbox('${img.data||''}')" alt="${esc(img.name)}">
  `).join('');

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
    <td>
      <div class="img-cell">
        ${imgHtml}
        <button class="img-add-btn" onclick="openImagePicker('${r.id}')" title="Add image">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="16" height="13" rx="2"/><circle cx="7" cy="9" r="1.5"/><path d="M2 14l4-4 3 3 3-3 6 6"/></svg>
        </button>
      </div>
    </td>
    <td><button class="del-btn" data-del="ho" data-id="${r.id}">${trashSvg()}</button></td>`;
  return tr;
}

function makeTaskCard(r, i) {
  const div = document.createElement('div');
  div.className = 'task-card';
  const ss = statusStyle(r.status);
  const imgs = (r.images||[]);
  const imgHtml = imgs.map(img => `
    <img class="img-thumb" src="${img.data||''}" title="${esc(img.name)}" onclick="openLightbox('${img.data||''}')" alt="${esc(img.name)}">
  `).join('');

  div.innerHTML = `
    <div class="task-card-header">
      <span class="task-card-num">Task #${i+1}</span>
      <div class="task-card-status">
        <select class="status-sel" data-id="${r.id}" data-tbl="ho" style="background:${ss.bg};color:${ss.color};border-color:${ss.border}">
          ${['Pending','In Progress','Done','Urgent','Follow Up','Info','Cancelled'].map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <button class="del-btn task-card-del" data-del="ho" data-id="${r.id}">${trashSvg()}</button>
    </div>
    <div class="task-card-grid">
      <div class="task-card-field">
        <label>Date</label>
        <input type="date" value="${r.date||''}" data-id="${r.id}" data-field="date" data-tbl="ho">
      </div>
      <div class="task-card-field">
        <label>Heartist / Agent</label>
        <input type="text" value="${esc(r.heartist)}" data-id="${r.id}" data-field="heartist" data-tbl="ho" placeholder="Agent name">
      </div>
      <div class="task-card-field full">
        <label>Task / Note</label>
        <textarea data-id="${r.id}" data-field="note" data-tbl="ho" placeholder="Task / note…">${esc(r.note)}</textarea>
      </div>
      <div class="task-card-field full">
        <label>Update / Action Taken</label>
        <textarea data-id="${r.id}" data-field="update" data-tbl="ho" placeholder="Action taken…">${esc(r.update)}</textarea>
      </div>
    </div>
    <div class="task-card-images">
      ${imgHtml}
      <button class="img-add-btn" onclick="openImagePicker('${r.id}')" title="Add image">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="16" height="13" rx="2"/><circle cx="7" cy="9" r="1.5"/><path d="M2 14l4-4 3 3 3-3 6 6"/></svg>
      </button>
    </div>`;
  return div;
}

function addHandoverRow() { state.handover.push(emptyTask()); renderHandoverTable(); autoSave(); }

// ── POD Table ─────────────────────────────────────────────────
function renderPodTable() {
  const tbody = document.getElementById('podBody');
  if (tbody) {
    tbody.innerHTML = '';
    if (!state.pod.length) state.pod.push(emptyPod());
    state.pod.forEach((r,i) => tbody.appendChild(makePodRow(r,i)));
  }

  const mobileList = document.getElementById('podMobileList');
  if (mobileList) {
    mobileList.innerHTML = '';
    if (!state.pod.length) state.pod.push(emptyPod());
    state.pod.forEach((r,i) => mobileList.appendChild(makePodCard(r,i)));
  }
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

function makePodCard(r, i) {
  const div = document.createElement('div');
  div.className = 'pod-card';
  div.innerHTML = `
    <div class="pod-card-header">
      <span class="task-card-num">Room #${i+1}</span>
      <button class="del-btn" data-del="pod" data-id="${r.id}">${trashSvg()}</button>
    </div>
    <div class="pod-card-grid">
      <div class="pod-card-field">
        <label>Room No.</label>
        <input type="text" value="${esc(r.room)}" data-id="${r.id}" data-field="room" data-tbl="pod" placeholder="e.g. 401">
      </div>
      <div class="pod-card-field">
        <label>Guest Name</label>
        <input type="text" value="${esc(r.name)}" data-id="${r.id}" data-field="name" data-tbl="pod" placeholder="Guest name">
      </div>
      <div class="pod-card-field">
        <label>Check-In</label>
        <input type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="pod">
      </div>
      <div class="pod-card-field">
        <label>Check-Out</label>
        <input type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="pod">
      </div>
      <div class="pod-card-field full">
        <label>Remarks</label>
        <input type="text" value="${esc(r.remarks)}" data-id="${r.id}" data-field="remarks" data-tbl="pod" placeholder="Notes…">
      </div>
    </div>`;
  return div;
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

  // Close lightbox on Escape
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  // Re-render on resize (mobile/desktop switch)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { renderHandoverTable(); renderPodTable(); }, 200);
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
          ${[
            ['Date', fmtDate(m.date)||'—'],
            ['Agent (Handing Over)', m.agent||'—'],
            ['Received By', m.receiver||'—'],
            ['From', m.from||'—'],
            ['To', m.to||'—']
          ].map(([l,v])=>`
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
        <div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Date</th><th>Heartist</th><th>Task</th><th>Update</th><th>Status</th><th>Images</th></tr></thead><tbody>
          ${state.handover.map(r=>{const ss=statusStyle(r.status); const imgs=r.images||[]; return`<tr>
            <td>${r.date||'—'}</td><td>${esc(r.heartist)||'—'}</td><td>${esc(r.note)||'—'}</td>
            <td>${esc(r.update)||'—'}</td>
            <td><span style="background:${ss.bg};color:${ss.color};padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600">${r.status}</span></td>
            <td>${imgs.length ? imgs.map(img=>`<img src="${img.data||''}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;cursor:pointer;margin:1px" onclick="openLightbox('${img.data||''}')">`).join('') : '—'}</td>
          </tr>`}).join('')}
        </tbody></table></div>`}
      </div>
    </div>`;
}

// ── PDF Export ────────────────────────────────────────────────
function exportPDF() {
  collectAll();
  const m = state.meta, k = state.kpis;

  const fmtDateShort = iso => {
    if (!iso) return '—';
    const [y,mo,d] = iso.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(d)} ${months[parseInt(mo)-1]} ${y}`;
  };

  const statusColors = {
    'Pending':     { bg:'#FEF3C7', color:'#92400E', border:'#E2C47A' },
    'In Progress': { bg:'#DBEAFE', color:'#1E3A8A', border:'#93C5FD' },
    'Done':        { bg:'#D1FAE5', color:'#065F46', border:'#6EE7B7' },
    'Urgent':      { bg:'#FEE2E2', color:'#991B1B', border:'#FCA5A5' },
    'Follow Up':   { bg:'#EDE9FE', color:'#4C1D95', border:'#C4B5FD' },
    'Info':        { bg:'#F0F9FF', color:'#075985', border:'#BAE6FD' },
    'Cancelled':   { bg:'#F3F4F6', color:'#4B5563', border:'#D1D5DB' },
  };

  const kpiRows = ['Morning','Evening','Night'].map(sh => {
    const d = k[sh]||EMPTY_KPI();
    const shiftColors = { Morning:'#FEF3C7,#92400E', Evening:'#DBEAFE,#1E40AF', Night:'#EDE9FE,#5B21B6' };
    const [bg, color] = shiftColors[sh].split(',');
    return `<tr>
      <td><span class="shift-badge" style="background:${bg};color:${color}">${sh}</span></td>
      <td>${d.walkin||'—'}</td><td>${d.ext||'—'}</td><td>${d.bb||'—'}</td>
      <td>${d.room||'—'}</td><td>${d.spark||'—'}</td><td>${d.prof||'—'}</td>
      <td>${d.enrollment||'—'}</td><td>${d.allMembership||'—'}</td><td>${d.welcome||'—'}</td>
    </tr>`;
  }).join('');

  const totals = ['walkin','ext','bb','room','spark','prof','enrollment','allMembership','welcome'].map(f => {
    const t = ['Morning','Evening','Night'].reduce((s,sh) => s+(parseInt(k[sh]?.[f])||0), 0);
    return `<td><strong>${t||'—'}</strong></td>`;
  }).join('');

  const taskRows = state.handover.filter(r => r.date||r.heartist||r.note||r.update).map((r,i) => {
    const sc = statusColors[r.status] || statusColors['Pending'];
    const imgs = (r.images||[]).filter(img => img.data);
    const imgHtml = imgs.length ? `<div style="display:flex;gap:4pt;flex-wrap:wrap;margin-top:3pt">${imgs.map(img=>`<img src="${img.data}" style="width:44pt;height:44pt;object-fit:cover;border-radius:4pt;border:1pt solid #E5E1D8">`).join('')}</div>` : '';
    return `
    <tr>
      <td style="text-align:center;color:#8A9BB0;font-size:8pt">${i+1}</td>
      <td style="white-space:nowrap">${fmtDateShort(r.date)}</td>
      <td><strong>${esc(r.heartist)||'—'}</strong></td>
      <td style="text-align:left">
        <div>${esc(r.note)||'—'}</div>
        ${imgHtml}
      </td>
      <td style="text-align:left">${esc(r.update)||'—'}</td>
      <td>
        <span class="badge" style="background:${sc.bg};color:${sc.color};border:1pt solid ${sc.border}">${r.status||'—'}</span>
      </td>
    </tr>`;
  }).join('');

  const podRows = state.pod.filter(r => r.room||r.name).map((r,i) => `
    <tr>
      <td style="text-align:center;color:#8A9BB0;font-size:8pt">${i+1}</td>
      <td><strong>${esc(r.room)||'—'}</strong></td>
      <td>${esc(r.name)||'—'}</td>
      <td>${fmtDateShort(r.checkin)}</td>
      <td>${fmtDateShort(r.checkout)}</td>
      <td style="text-align:left">${esc(r.remarks)||'—'}</td>
    </tr>`).join('');

  const notesHtml = ['morning','evening','night'].filter(s=>state.generalNotes[s]).map(s => `
    <tr>
      <td style="font-weight:600;text-transform:capitalize;white-space:nowrap">
        <span class="shift-badge" style="${s==='morning'?'background:#FEF3C7;color:#92400E':s==='evening'?'background:#DBEAFE;color:#1E40AF':'background:#EDE9FE;color:#5B21B6'}">${s}</span>
      </td>
      <td style="text-align:left;white-space:pre-wrap">${esc(state.generalNotes[s])}</td>
    </tr>`).join('');

  const dayOfWeek = m.date ? new Date(m.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long'}) : '';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Handover Report — ${fmtDateShort(m.date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family:'Outfit',sans-serif;
    font-size:9pt;
    color:#1A2030;
    background:#fff;
    -webkit-print-color-adjust:exact;
    print-color-adjust:exact;
  }
  @page { size:A4; margin:14mm 13mm 16mm 13mm; }

  /* ── WATERMARK BACKGROUND TEXTURE ── */
  body::before {
    content:'';
    position:fixed;
    top:0; left:0; right:0; bottom:0;
    background-image:
      radial-gradient(ellipse 200% 60% at 50% -10%, rgba(201,168,76,.04) 0%, transparent 60%);
    pointer-events:none;
    z-index:-1;
  }

  /* ── HEADER ── */
  .header {
    display:flex;
    align-items:stretch;
    margin-bottom:10pt;
    border-radius:8pt;
    overflow:hidden;
    box-shadow:0 2pt 12pt rgba(0,0,0,.12);
  }
  .header-accent {
    width:6pt;
    background:linear-gradient(180deg, #C9A84C 0%, #8A6B2A 100%);
    flex-shrink:0;
  }
  .header-main {
    background:linear-gradient(135deg, #0C1117 0%, #1E2837 100%);
    flex:1;
    padding:12pt 16pt;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12pt;
  }
  .header-brand h1 {
    font-family:'Cormorant Garamond',serif;
    font-size:22pt;
    font-weight:600;
    color:#fff;
    letter-spacing:.5pt;
    line-height:1;
    margin-bottom:3pt;
  }
  .header-brand .stars { color:#C9A84C; font-size:9pt; letter-spacing:4pt; }
  .header-brand .subtitle { font-size:7.5pt; color:rgba(255,255,255,.5); margin-top:3pt; text-transform:uppercase; letter-spacing:1pt; }
  .header-date-block {
    text-align:right;
    flex-shrink:0;
  }
  .header-date-block .day { font-size:7pt; color:rgba(255,255,255,.5); text-transform:uppercase; letter-spacing:1pt; margin-bottom:2pt; }
  .header-date-block .date { font-family:'Cormorant Garamond',serif; font-size:18pt; font-weight:600; color:#E2C47A; line-height:1; }

  /* ── META STRIP ── */
  .meta-strip {
    display:grid;
    grid-template-columns:repeat(5,1fr);
    gap:5pt;
    margin-bottom:10pt;
  }
  .meta-tile {
    background:#FAFAF8;
    border:1pt solid #E5E1D8;
    border-radius:5pt;
    padding:7pt 9pt;
    position:relative;
    overflow:hidden;
  }
  .meta-tile::before {
    content:'';
    position:absolute;
    top:0; left:0; right:0;
    height:2pt;
    background:linear-gradient(90deg,#C9A84C,#E2C47A);
  }
  .meta-tile .lbl {
    font-size:6pt;
    font-weight:700;
    color:#8A9BB0;
    text-transform:uppercase;
    letter-spacing:.6pt;
    margin-bottom:3pt;
  }
  .meta-tile .val {
    font-size:9pt;
    font-weight:600;
    color:#1A2030;
    line-height:1.3;
  }
  .meta-tile.highlight .val { color:#8A6B2A; }

  /* ── SECTION ── */
  .section { margin-bottom:10pt; }
  .sec-header {
    display:flex;
    align-items:center;
    gap:7pt;
    margin-bottom:5pt;
  }
  .sec-icon {
    width:18pt; height:18pt;
    border-radius:4pt;
    display:flex; align-items:center; justify-content:center;
    flex-shrink:0;
  }
  .sec-icon svg { width:11pt; height:11pt; }
  .sec-title {
    font-family:'Cormorant Garamond',serif;
    font-size:13pt;
    font-weight:600;
    color:#1A2030;
  }
  .sec-line {
    flex:1;
    height:1pt;
    background:linear-gradient(90deg,#E5E1D8,transparent);
  }
  .sec-count {
    font-size:7pt;
    color:#8A9BB0;
    background:#F2F0EB;
    padding:2pt 7pt;
    border-radius:20pt;
    border:1pt solid #E5E1D8;
  }

  /* ── TABLES ── */
  table { width:100%; border-collapse:collapse; font-size:8pt; }
  thead tr { background:linear-gradient(135deg,#0C1117,#1E2837); }
  thead th {
    color:rgba(255,255,255,.8);
    font-weight:600;
    padding:5pt 7pt;
    text-align:left;
    font-size:7pt;
    text-transform:uppercase;
    letter-spacing:.4pt;
  }
  thead th:first-child { border-radius:4pt 0 0 0; }
  thead th:last-child { border-radius:0 4pt 0 0; }
  tbody tr { border-bottom:1pt solid #F2F0EB; }
  tbody tr:last-child { border-bottom:none; }
  tbody tr:nth-child(even) td { background:#FAFAF8; }
  tbody td { padding:5pt 7pt; vertical-align:top; color:#1A2030; }
  tbody tr:hover td { background:#F9F0DC; }

  /* Table wrapper with border */
  .table-wrap {
    border:1pt solid #E5E1D8;
    border-radius:0 0 6pt 6pt;
    overflow:hidden;
  }

  /* ── KPI TABLE ── */
  .kpi-table thead tr { background:linear-gradient(135deg,#1A3A7A,#2D5299); }
  .kpi-totals td {
    background:linear-gradient(135deg,#0C1117,#1E2837) !important;
    color:#E2C47A !important;
    font-weight:700;
    font-size:8.5pt;
    padding:6pt 7pt;
  }
  .kpi-totals td:first-child { border-radius:0 0 0 5pt; }
  .kpi-totals td:last-child  { border-radius:0 0 5pt 0; }

  /* ── BADGES ── */
  .badge {
    display:inline-block;
    padding:2pt 7pt;
    border-radius:20pt;
    font-size:7pt;
    font-weight:700;
    border:1pt solid transparent;
    white-space:nowrap;
  }
  .shift-badge {
    display:inline-block;
    padding:2pt 7pt;
    border-radius:20pt;
    font-size:7pt;
    font-weight:700;
  }

  /* ── DIVIDER ── */
  .divider {
    height:1pt;
    background:linear-gradient(90deg,#C9A84C,rgba(201,168,76,.1));
    margin:10pt 0;
  }

  /* ── FOOTER ── */
  .footer {
    margin-top:12pt;
    padding-top:7pt;
    border-top:1pt solid #E5E1D8;
    display:flex;
    justify-content:space-between;
    align-items:center;
    font-size:7pt;
    color:#8A9BB0;
  }
  .footer-brand { display:flex; align-items:center; gap:5pt; }
  .footer-brand .stars { color:#C9A84C; font-size:8pt; letter-spacing:2pt; }

  /* ── SIGNATURE BLOCK ── */
  .sig-row {
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:12pt;
    margin-top:12pt;
  }
  .sig-box {
    border:1pt solid #E5E1D8;
    border-radius:5pt;
    padding:10pt 12pt 6pt;
    background:#FAFAF8;
  }
  .sig-label { font-size:7pt; font-weight:700; color:#8A9BB0; text-transform:uppercase; letter-spacing:.5pt; margin-bottom:2pt; }
  .sig-name { font-size:10pt; font-weight:600; color:#1A2030; margin-bottom:8pt; }
  .sig-line { border-bottom:1pt solid #BCC8D8; margin-bottom:3pt; }
  .sig-sub { font-size:6.5pt; color:#8A9BB0; text-transform:uppercase; letter-spacing:.4pt; }

  /* ── EMPTY STATE ── */
  .empty-row td { color:#8A9BB0; font-style:italic; text-align:center; padding:10pt; }

  /* ── NO PRINT ── */
  @media print {
    body { font-size:9pt; }
    .no-print { display:none; }
  }
</style>
</head><body>

<!-- HEADER -->
<div class="header">
  <div class="header-accent"></div>
  <div class="header-main">
    <div class="header-brand">
      <div class="stars">★★★★★</div>
      <h1>Front Office Handover</h1>
      <div class="subtitle">Shift Handover Report</div>
    </div>
    <div class="header-date-block">
      <div class="day">${dayOfWeek}</div>
      <div class="date">${fmtDateShort(m.date)}</div>
    </div>
  </div>
</div>

<!-- META STRIP -->
<div class="meta-strip">
  <div class="meta-tile highlight">
    <div class="lbl">Agent — Handing Over</div>
    <div class="val">${esc(m.agent)||'—'}</div>
  </div>
  <div class="meta-tile highlight">
    <div class="lbl">Received By</div>
    <div class="val">${esc(m.receiver)||'—'}</div>
  </div>
  <div class="meta-tile">
    <div class="lbl">From Shift</div>
    <div class="val">${esc(m.from)||'—'}</div>
  </div>
  <div class="meta-tile">
    <div class="lbl">To Shift</div>
    <div class="val">${esc(m.to)||'—'}</div>
  </div>
  <div class="meta-tile">
    <div class="lbl">Generated</div>
    <div class="val">${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
  </div>
</div>

<!-- HANDOVER TASKS -->
<div class="section">
  <div class="sec-header">
    <div class="sec-icon" style="background:#0C1117">
      <svg viewBox="0 0 20 20" fill="none" stroke="#E2C47A" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="2" height="4" rx="1"/></svg>
    </div>
    <div class="sec-title">Heartist Handover Tasks</div>
    <div class="sec-line"></div>
    <div class="sec-count">${state.handover.filter(r=>r.note||r.heartist).length} tasks</div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th style="width:3%">#</th>
        <th style="width:9%">Date</th>
        <th style="width:11%">Heartist</th>
        <th style="width:28%;text-align:left">Task / Note</th>
        <th style="width:28%;text-align:left">Update / Action Taken</th>
        <th style="width:10%;text-align:center">Status</th>
      </tr></thead>
      <tbody>
        ${taskRows || '<tr class="empty-row"><td colspan="6">No tasks recorded for this shift</td></tr>'}
      </tbody>
    </table>
  </div>
</div>

<!-- KPIs -->
<div class="section">
  <div class="sec-header">
    <div class="sec-icon" style="background:#1A3A7A">
      <svg viewBox="0 0 20 20" fill="none" stroke="#93C5FD" stroke-width="1.5"><path d="M4 15l4-4 3 3 5-6"/></svg>
    </div>
    <div class="sec-title">KPI Overview — All Shifts</div>
    <div class="sec-line"></div>
  </div>
  <div class="table-wrap">
    <table class="kpi-table">
      <thead><tr>
        <th>Shift</th><th>Walk In</th><th>Extensions</th><th>BB Upselling</th>
        <th>Room Upselling</th><th>Sparkles</th><th>Profiles</th>
        <th>Enrollment</th><th>All Memb.</th><th>Welcome Drink</th>
      </tr></thead>
      <tbody>
        ${kpiRows}
        <tr class="kpi-totals">
          <td>TOTAL</td>${totals}
        </tr>
      </tbody>
    </table>
  </div>
</div>

${state.pod.some(r=>r.room||r.name) ? `
<!-- POD ROOMS -->
<div class="section">
  <div class="sec-header">
    <div class="sec-icon" style="background:#0D4B8A">
      <svg viewBox="0 0 20 20" fill="none" stroke="#93C5FD" stroke-width="1.5"><rect x="2" y="7" width="16" height="11" rx="1"/><path d="M6 7V5a4 4 0 018 0v2"/></svg>
    </div>
    <div class="sec-title">POD Rooms</div>
    <div class="sec-line"></div>
    <div class="sec-count">${state.pod.filter(r=>r.room||r.name).length} rooms</div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th style="width:4%">#</th>
        <th style="width:10%">Room No.</th>
        <th style="width:20%">Guest Name</th>
        <th style="width:12%">Check-In</th>
        <th style="width:12%">Check-Out</th>
        <th style="text-align:left">Remarks</th>
      </tr></thead>
      <tbody>${podRows}</tbody>
    </table>
  </div>
</div>` : ''}

${['morning','evening','night'].some(s=>state.generalNotes[s]) ? `
<!-- NOTES -->
<div class="section">
  <div class="sec-header">
    <div class="sec-icon" style="background:#1A6B4A">
      <svg viewBox="0 0 20 20" fill="none" stroke="#6EE7B7" stroke-width="1.5"><path d="M4 4h12v9l-4 4H4z"/><path d="M7 8h6M7 11h4"/></svg>
    </div>
    <div class="sec-title">Shift Notes</div>
    <div class="sec-line"></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th style="width:12%">Shift</th><th style="text-align:left">Notes</th></tr></thead>
      <tbody>${notesHtml}</tbody>
    </table>
  </div>
</div>` : ''}

<!-- SIGNATURE BLOCK -->
<div class="sig-row">
  <div class="sig-box">
    <div class="sig-label">Handed Over By</div>
    <div class="sig-name">${esc(m.agent)||'_________________________'}</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &amp; Time</div>
  </div>
  <div class="sig-box">
    <div class="sig-label">Received By</div>
    <div class="sig-name">${esc(m.receiver)||'_________________________'}</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &amp; Time</div>
  </div>
</div>

<!-- FOOTER -->
<div class="footer">
  <div class="footer-brand">
    <span class="stars">★★★★★</span>
    <span>Front Office Handover Report</span>
  </div>
  <span>${fmtDateShort(m.date)} &nbsp;·&nbsp; ${esc(m.from)} → ${esc(m.to)}</span>
  <span>Generated ${new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
</div>

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked. Allow pop-ups and try again.', true); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); setTimeout(() => win.print(), 500); };
}

// ── Helpers ───────────────────────────────────────────────────
function v(id)          { const el=document.getElementById(id); return el?el.value:''; }
function setVal(id,val) { const el=document.getElementById(id); if(el&&val!=null) el.value=val; }
function esc(s)         { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid()          { return Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function todayISO()     { return new Date().toISOString().split('T')[0]; }
function fmtDate(iso)   { if(!iso) return ''; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function trashSvg()     { return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 4h4M5 7h10l-1 10H6L5 7z" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 7h14" stroke-linecap="round"/></svg>`; }

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
window.showTab         = showTab;
window.autoSave        = autoSave;
window.manualSave      = manualSave;
window.exportPDF       = exportPDF;
window.onDateChange    = onDateChange;
window.switchKpiShift  = switchKpiShift;
window.addHandoverRow  = addHandoverRow;
window.addPodRow       = addPodRow;
window.renderSummary   = renderSummary;
window.openImagePicker = openImagePicker;
window.removeImage     = removeImage;
window.openLightbox    = openLightbox;
window.closeLightbox   = closeLightbox;
window.clearHandover   = () => {
  if (!confirm('Clear all handover tasks?')) return;
  state.handover=[]; renderHandoverTable(); autoSave();
};
