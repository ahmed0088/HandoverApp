/* ════════════════════════════════════════════════════════════
   FRONT OFFICE HANDOVER — APP.JS v3
   Features: Multi-hotel, No Shows, Incognito, POD, Pro PDF
   ════════════════════════════════════════════════════════════ */
"use strict";

// ── Global state ──────────────────────────────────────────────
let db, currentRef, firebaseEnabled = false;
let currentHotel = null;  // hotel object from HOTELS array
let currentKpiShift = 'Morning';
let saveTimer = null;
let isLoading = false;

const EMPTY_KPI = () => ({ walkin:0, ext:0, bb:0, room:0, spark:0, prof:0, enrollment:0, welcome:0, allMembership:0 });

function freshState() {
  return {
    meta: { date:'', agent:'', receiver:'', from:'Morning Shift', to:'Evening Shift' },
    kpis: { Morning: EMPTY_KPI(), Evening: EMPTY_KPI(), Night: EMPTY_KPI() },
    handover: [],
    noshow: [],
    incognito: [],
    pod: [],
    generalNotes: { morning:'', evening:'', night:'' }
  };
}

let state = freshState();

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildHotelSelector();
  const saved = localStorage.getItem('fo_last_hotel');
  if (saved && HOTELS.find(h => h.id === saved)) {
    selectHotel(saved, false);
  }
});

// ── Hotel Selector ────────────────────────────────────────────
function buildHotelSelector() {
  const container = document.getElementById('hotelCards');
  if (!container) return;
  container.innerHTML = HOTELS.map(h => `
    <div class="hotel-card" onclick="selectHotel('${h.id}', true)">
      <div class="hotel-card-accent" style="background:${h.color}"></div>
      <div class="hotel-card-info">
        <div class="hotel-card-name">${h.name}</div>
        <div class="hotel-card-stars">${'★'.repeat(h.stars)}</div>
      </div>
      <svg class="hotel-card-arrow" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 5l5 5-5 5"/></svg>
    </div>
  `).join('');
}

function selectHotel(id, animate) {
  currentHotel = HOTELS.find(h => h.id === id);
  if (!currentHotel) return;
  localStorage.setItem('fo_last_hotel', id);

  // Apply hotel accent color to topbar
  const topbar = document.getElementById('topbar');
  const navtabs = document.getElementById('navtabs');
  if (topbar) topbar.style.setProperty('--hotel-color', currentHotel.color);
  if (navtabs) navtabs.style.setProperty('--hotel-color', currentHotel.color);

  document.getElementById('hotelShortName').textContent = currentHotel.short;

  // Hide overlay, show app
  const overlay = document.getElementById('hotelOverlay');
  const app = document.getElementById('app');
  if (overlay) {
    if (animate) {
      overlay.style.transition = 'opacity .35s, transform .35s';
      overlay.style.opacity = '0';
      overlay.style.transform = 'scale(.97)';
      setTimeout(() => { overlay.style.display = 'none'; }, 350);
    } else {
      overlay.style.display = 'none';
    }
  }
  if (app) app.style.display = '';

  // Boot app for this hotel
  state = freshState();
  initDate();
  initFirebase();
  renderAll();
  setupListeners();
}

function showHotelSelector() {
  // Disconnect existing listener
  if (currentRef && firebaseEnabled) currentRef.off();
  firebaseEnabled = false;

  const overlay = document.getElementById('hotelOverlay');
  const app = document.getElementById('app');
  if (overlay) {
    overlay.style.transition = 'opacity .3s';
    overlay.style.opacity = '1';
    overlay.style.transform = 'scale(1)';
    overlay.style.display = 'flex';
  }
  if (app) app.style.display = 'none';
  buildHotelSelector();
}

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
  } catch(e) { setFBStatus('error','Offline'); fallbackLS(); }
}

function setFBStatus(cls, txt) {
  const el = document.getElementById('fbStatus');
  if (el) { el.className = 'fb-chip '+cls; el.innerHTML = `<span class="fb-dot"></span><span class="hide-sm">${txt}</span>`; }
}

function lsKey()  { return `fo_v3_${currentHotel?.id||'default'}_${getDateKey()}`; }
function getDateKey() { return (state.meta.date || todayISO()).replace(/-/g,'_'); }
function dbPath() { return `${DB_ROOT}/${currentHotel?.id||'default'}/${getDateKey()}`; }

function fallbackLS() {
  try { const r = localStorage.getItem(lsKey()); if (r) { mergeState(JSON.parse(r)); renderAll(); } } catch(e) {}
}

function loadFromDB() {
  if (currentRef) currentRef.off();
  currentRef = db.ref(dbPath());
  currentRef.on('value', snap => {
    const d = snap.val();
    if (d) { isLoading = true; mergeState(d); renderAll(); isLoading = false; }
  });
}

function saveToDB() {
  const saveState = JSON.parse(JSON.stringify(state));
  if (!firebaseEnabled || !db) {
    try { localStorage.setItem(lsKey(), JSON.stringify(saveState)); } catch(e) {}
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.ref(dbPath()).set(saveState).catch(() => showToast('Save failed', true));
    try { localStorage.setItem(lsKey(), JSON.stringify(saveState)); } catch(e) {}
  }, 600);
}

function onDateChange() {
  const d = document.getElementById('ho_date').value;
  if (!d) return;
  state.meta.date = d;
  document.getElementById('todayDate').textContent = fmtDate(d);
  if (currentRef && firebaseEnabled) currentRef.off();
  state = freshState();
  state.meta.date = d;
  if (firebaseEnabled) loadFromDB();
  else fallbackLS();
  renderAll();
}

function mergeState(d) {
  if (d.meta)         state.meta         = { ...state.meta,         ...d.meta };
  if (d.kpis)         state.kpis         = { ...state.kpis,         ...d.kpis };
  if (d.generalNotes) state.generalNotes = { ...state.generalNotes, ...d.generalNotes };
  if (Array.isArray(d.handover))  state.handover  = d.handover;
  if (Array.isArray(d.noshow))    state.noshow    = d.noshow;
  if (Array.isArray(d.incognito)) state.incognito = d.incognito;
  if (Array.isArray(d.pod))       state.pod       = d.pod;
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
  const ad = document.getElementById('agentDisplay'); if (ad) ad.textContent = state.meta.agent||'—';
}

function manualSave() { collectAll(); saveToDB(); showToast('Saved successfully ✓'); }

// ── Render All ────────────────────────────────────────────────
function renderAll() {
  setVal('ho_date',     state.meta.date || todayISO());
  setVal('ho_agent',    state.meta.agent);
  setVal('ho_receiver', state.meta.receiver);
  setVal('ho_from',     state.meta.from);
  setVal('ho_to',       state.meta.to);
  const ad = document.getElementById('agentDisplay'); if (ad) ad.textContent = state.meta.agent||'—';
  renderKpi();
  renderHandoverTable();
  renderNoshowTable();
  renderIncognitoTable();
  renderPodTable();
  renderNotes();
  updateCounts();
}

function updateCounts() {
  const hc = document.getElementById('handoverCount');
  const nc = document.getElementById('noshowCount');
  const ic = document.getElementById('incognitoCount');
  const pc = document.getElementById('podCount');
  const hlen = state.handover.filter(r=>r.note||r.heartist).length;
  const nlen = state.noshow.filter(r=>r.name||r.resv).length;
  const ilen = state.incognito.filter(r=>r.room||r.name).length;
  const plen = state.pod.filter(r=>r.room||r.name).length;
  if (hc) hc.textContent = hlen + ' task' + (hlen!==1?'s':'');
  if (nc) nc.textContent = nlen + ' record' + (nlen!==1?'s':'');
  if (ic) ic.textContent = ilen + ' room' + (ilen!==1?'s':'');
  if (pc) pc.textContent = plen + ' room' + (plen!==1?'s':'');
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
  collectKpi(); currentKpiShift = sh;
  document.getElementById('currentShift').textContent = sh;
  const dot = document.getElementById('shiftDot');
  if (dot) {
    const colors = { Morning:'#C8A96E', Evening:'#60A5FA', Night:'#A78BFA' };
    dot.style.background = colors[sh]||'#C8A96E';
    dot.style.boxShadow = `0 0 8px ${colors[sh]||'#C8A96E'}99`;
  }
  renderKpi();
}

// ── Notes ─────────────────────────────────────────────────────
function renderNotes() {
  ['morning','evening','night'].forEach(s => { const el = document.getElementById('note_'+s); if (el) el.value = state.generalNotes[s]||''; });
}

// ── HANDOVER TABLE ────────────────────────────────────────────
function emptyTask()    { return { id:uid(), date:todayISO(), heartist:'', note:'', update:'', status:'Pending' }; }

function renderHandoverTable() {
  if (!state.handover.length) state.handover.push(emptyTask());
  renderDesktopTable('heartistBody', state.handover, makeTaskRow);
  renderMobileList('heartistMobileList', state.handover, makeTaskCard);
  applyStatusColors();
  updateCounts();
}

function makeTaskRow(r, i) {
  const tr = document.createElement('tr');
  const ss = statusStyle(r.status);
  tr.innerHTML = `
    <td><div class="row-num">${i+1}</div></td>
    <td><input class="cell-input" type="date" value="${r.date||''}" data-id="${r.id}" data-field="date" data-tbl="ho"></td>
    <td><input class="cell-input" value="${esc(r.heartist)}" data-id="${r.id}" data-field="heartist" data-tbl="ho" placeholder="Agent name"></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="note" data-tbl="ho" placeholder="Task or note…">${esc(r.note)}</textarea></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="update" data-tbl="ho" placeholder="Action taken…">${esc(r.update)}</textarea></td>
    <td><select class="status-sel" data-id="${r.id}" data-tbl="ho" style="background:${ss.bg};color:${ss.color};border-color:${ss.border}">
      ${taskStatuses().map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
    </select></td>
    <td><button class="del-btn" data-del="ho" data-id="${r.id}">${trashSvg()}</button></td>`;
  return tr;
}

function makeTaskCard(r, i) {
  const div = document.createElement('div');
  div.className = 'm-card';
  const ss = statusStyle(r.status);
  div.innerHTML = `
    <div class="m-card-header">
      <span class="m-card-num">Task #${i+1}</span>
      <div style="flex:1;max-width:140px">
        <select class="status-sel" data-id="${r.id}" data-tbl="ho" style="background:${ss.bg};color:${ss.color};border-color:${ss.border};width:100%;padding:5px 8px;font-size:11px">
          ${taskStatuses().map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <button class="del-btn" style="margin-left:auto" data-del="ho" data-id="${r.id}">${trashSvg()}</button>
    </div>
    <div class="m-card-grid">
      <div class="m-card-field"><label>Date</label><input type="date" value="${r.date||''}" data-id="${r.id}" data-field="date" data-tbl="ho"></div>
      <div class="m-card-field"><label>Heartist</label><input type="text" value="${esc(r.heartist)}" data-id="${r.id}" data-field="heartist" data-tbl="ho" placeholder="Agent name"></div>
      <div class="m-card-field full"><label>Task / Note</label><textarea data-id="${r.id}" data-field="note" data-tbl="ho" placeholder="Task or note…">${esc(r.note)}</textarea></div>
      <div class="m-card-field full"><label>Update / Action Taken</label><textarea data-id="${r.id}" data-field="update" data-tbl="ho" placeholder="Action taken…">${esc(r.update)}</textarea></div>
    </div>`;
  return div;
}

function addHandoverRow() { state.handover.push(emptyTask()); renderHandoverTable(); autoSave(); }

// ── NO SHOW TABLE ─────────────────────────────────────────────
function emptyNoshow() { return { id:uid(), name:'', resv:'', arrival:todayISO(), nights:'1', remarks:'', status:'No Show' }; }

function renderNoshowTable() {
  if (!state.noshow.length) state.noshow.push(emptyNoshow());
  renderDesktopTable('noshowBody', state.noshow, makeNoshowRow);
  renderMobileList('noshowMobileList', state.noshow, makeNoshowCard);
  applyStatusColors();
  updateCounts();
}

function makeNoshowRow(r, i) {
  const tr = document.createElement('tr');
  const ss = noshowStatusStyle(r.status);
  tr.innerHTML = `
    <td><div class="row-num">${i+1}</div></td>
    <td><input class="cell-input" value="${esc(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ns" placeholder="Guest name"></td>
    <td><input class="cell-input" value="${esc(r.resv)}" data-id="${r.id}" data-field="resv" data-tbl="ns" placeholder="Resv. / Room no."></td>
    <td><input class="cell-input" type="date" value="${r.arrival||''}" data-id="${r.id}" data-field="arrival" data-tbl="ns"></td>
    <td><input class="cell-input" type="number" min="1" value="${esc(r.nights)}" data-id="${r.id}" data-field="nights" data-tbl="ns" placeholder="1" style="width:70px"></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="remarks" data-tbl="ns" placeholder="Contact attempts, charges applied…">${esc(r.remarks)}</textarea></td>
    <td><select class="status-sel ns-status" data-id="${r.id}" data-tbl="ns" style="background:${ss.bg};color:${ss.color};border-color:${ss.border}">
      ${noshowStatuses().map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
    </select></td>
    <td><button class="del-btn" data-del="ns" data-id="${r.id}">${trashSvg()}</button></td>`;
  return tr;
}

function makeNoshowCard(r, i) {
  const div = document.createElement('div');
  div.className = 'm-card';
  const ss = noshowStatusStyle(r.status);
  div.innerHTML = `
    <div class="m-card-header">
      <span class="m-card-num">Record #${i+1}</span>
      <div style="flex:1;max-width:140px">
        <select class="status-sel ns-status" data-id="${r.id}" data-tbl="ns" style="background:${ss.bg};color:${ss.color};border-color:${ss.border};width:100%;padding:5px 8px;font-size:11px">
          ${noshowStatuses().map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <button class="del-btn" style="margin-left:auto" data-del="ns" data-id="${r.id}">${trashSvg()}</button>
    </div>
    <div class="m-card-grid">
      <div class="m-card-field"><label>Guest Name</label><input type="text" value="${esc(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ns" placeholder="Guest name"></div>
      <div class="m-card-field"><label>Resv. / Room No.</label><input type="text" value="${esc(r.resv)}" data-id="${r.id}" data-field="resv" data-tbl="ns" placeholder="Resv. / Room no."></div>
      <div class="m-card-field"><label>Arrival Date</label><input type="date" value="${r.arrival||''}" data-id="${r.id}" data-field="arrival" data-tbl="ns"></div>
      <div class="m-card-field"><label>Nights</label><input type="number" min="1" value="${esc(r.nights)}" data-id="${r.id}" data-field="nights" data-tbl="ns" placeholder="1"></div>
      <div class="m-card-field full"><label>Remarks / Action Taken</label><textarea data-id="${r.id}" data-field="remarks" data-tbl="ns" placeholder="Contact attempts, charges applied…">${esc(r.remarks)}</textarea></div>
    </div>`;
  return div;
}

function addNoshowRow() { state.noshow.push(emptyNoshow()); renderNoshowTable(); autoSave(); }

// ── INCOGNITO TABLE ───────────────────────────────────────────
function emptyIncognito() { return { id:uid(), room:'', name:'', checkin:todayISO(), checkout:'', instructions:'', priority:'VIP' }; }

function renderIncognitoTable() {
  if (!state.incognito.length) state.incognito.push(emptyIncognito());
  renderDesktopTable('incognitoBody', state.incognito, makeIncognitoRow);
  renderMobileList('incognitoMobileList', state.incognito, makeIncognitoCard);
  applyIncognitoColors();
  updateCounts();
}

function makeIncognitoRow(r, i) {
  const tr = document.createElement('tr');
  const ps = priorityStyle(r.priority);
  tr.innerHTML = `
    <td><div class="row-num">${i+1}</div></td>
    <td><input class="cell-input" value="${esc(r.room)}" data-id="${r.id}" data-field="room" data-tbl="ic" placeholder="e.g. 412"></td>
    <td><input class="cell-input" value="${esc(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ic" placeholder="Name / Alias"></td>
    <td><input class="cell-input" type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="ic"></td>
    <td><input class="cell-input" type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="ic"></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="instructions" data-tbl="ic" placeholder="Special instructions, restrictions…">${esc(r.instructions)}</textarea></td>
    <td><select class="status-sel ic-priority" data-id="${r.id}" data-tbl="ic" style="background:${ps.bg};color:${ps.color};border-color:${ps.border}">
      ${incogPriorities().map(s=>`<option ${r.priority===s?'selected':''}>${s}</option>`).join('')}
    </select></td>
    <td><button class="del-btn" data-del="ic" data-id="${r.id}">${trashSvg()}</button></td>`;
  return tr;
}

function makeIncognitoCard(r, i) {
  const div = document.createElement('div');
  div.className = 'm-card';
  const ps = priorityStyle(r.priority);
  div.innerHTML = `
    <div class="m-card-header">
      <span class="m-card-num">🔒 Room #${i+1}</span>
      <div style="flex:1;max-width:130px">
        <select class="status-sel ic-priority" data-id="${r.id}" data-tbl="ic" style="background:${ps.bg};color:${ps.color};border-color:${ps.border};width:100%;padding:5px 8px;font-size:11px">
          ${incogPriorities().map(s=>`<option ${r.priority===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
      <button class="del-btn" style="margin-left:auto" data-del="ic" data-id="${r.id}">${trashSvg()}</button>
    </div>
    <div class="m-card-grid">
      <div class="m-card-field"><label>Room No.</label><input type="text" value="${esc(r.room)}" data-id="${r.id}" data-field="room" data-tbl="ic" placeholder="e.g. 412"></div>
      <div class="m-card-field"><label>Name / Alias</label><input type="text" value="${esc(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ic" placeholder="Name or alias"></div>
      <div class="m-card-field"><label>Check-In</label><input type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="ic"></div>
      <div class="m-card-field"><label>Check-Out</label><input type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="ic"></div>
      <div class="m-card-field full"><label>Special Instructions</label><textarea data-id="${r.id}" data-field="instructions" data-tbl="ic" placeholder="Special instructions…">${esc(r.instructions)}</textarea></div>
    </div>`;
  return div;
}

function addIncognitoRow() { state.incognito.push(emptyIncognito()); renderIncognitoTable(); autoSave(); }

// ── POD TABLE ─────────────────────────────────────────────────
function emptyPod() { return { id:uid(), room:'', name:'', checkin:'', checkout:'', remarks:'' }; }

function renderPodTable() {
  if (!state.pod.length) state.pod.push(emptyPod());
  renderDesktopTable('podBody', state.pod, makePodRow);
  renderMobileList('podMobileList', state.pod, makePodCard);
  updateCounts();
}

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
  div.className = 'm-card';
  div.innerHTML = `
    <div class="m-card-header">
      <span class="m-card-num">Room #${i+1}</span>
      <button class="del-btn" style="margin-left:auto" data-del="pod" data-id="${r.id}">${trashSvg()}</button>
    </div>
    <div class="m-card-grid">
      <div class="m-card-field"><label>Room No.</label><input type="text" value="${esc(r.room)}" data-id="${r.id}" data-field="room" data-tbl="pod" placeholder="e.g. 401"></div>
      <div class="m-card-field"><label>Guest Name</label><input type="text" value="${esc(r.name)}" data-id="${r.id}" data-field="name" data-tbl="pod" placeholder="Guest name"></div>
      <div class="m-card-field"><label>Check-In</label><input type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="pod"></div>
      <div class="m-card-field"><label>Check-Out</label><input type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="pod"></div>
      <div class="m-card-field full"><label>Remarks</label><input type="text" value="${esc(r.remarks)}" data-id="${r.id}" data-field="remarks" data-tbl="pod" placeholder="Notes…"></div>
    </div>`;
  return div;
}

function addPodRow() { state.pod.push(emptyPod()); renderPodTable(); autoSave(); }

// ── Generic render helpers ────────────────────────────────────
function renderDesktopTable(tbodyId, arr, makeRowFn) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = '';
  arr.forEach((r,i) => tbody.appendChild(makeRowFn(r,i)));
}

function renderMobileList(listId, arr, makeCardFn) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  arr.forEach((r,i) => list.appendChild(makeCardFn(r,i)));
}

// ── Tab navigation ────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  document.getElementById('tab-'+tab).classList.add('active');
  if (tab === 'summary') renderSummary();
}

// ── Event listeners ───────────────────────────────────────────
let listenersSetup = false;
function setupListeners() {
  if (listenersSetup) return;
  listenersSetup = true;

  document.addEventListener('input', e => {
    const el = e.target, id = el.dataset.id, tbl = el.dataset.tbl, field = el.dataset.field;
    if (!id || !tbl) return;
    const arr = tblArray(tbl);
    if (arr) { const row = arr.find(r => r.id === id); if (row) { row[field] = el.value; autoSave(); } }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.classList.contains('status-sel') || el.classList.contains('ns-status') || el.classList.contains('ic-priority')) {
      const tbl = el.dataset.tbl;
      const arr = tblArray(tbl);
      if (arr) {
        const row = arr.find(r => r.id === el.dataset.id);
        if (row) {
          if (tbl === 'ic') row.priority = el.value;
          else row.status = el.value;
          autoSave();
          // Re-apply color
          const s = tbl === 'ic' ? priorityStyle(el.value) : tbl === 'ns' ? noshowStatusStyle(el.value) : statusStyle(el.value);
          el.style.background = s.bg; el.style.color = s.color; el.style.borderColor = s.border;
        }
      }
    }
    if (el.dataset.id && el.dataset.tbl && !el.classList.contains('status-sel') && !el.classList.contains('ns-status') && !el.classList.contains('ic-priority')) {
      const arr = tblArray(el.dataset.tbl);
      if (arr) { const row = arr.find(r => r.id === el.dataset.id); if (row) { row[el.dataset.field] = el.value; autoSave(); } }
    }
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const { del: tbl, id } = btn.dataset;
    if (tbl === 'ho')  { state.handover  = state.handover.filter(r=>r.id!==id);  renderHandoverTable();  autoSave(); }
    if (tbl === 'ns')  { state.noshow    = state.noshow.filter(r=>r.id!==id);    renderNoshowTable();    autoSave(); }
    if (tbl === 'ic')  { state.incognito = state.incognito.filter(r=>r.id!==id); renderIncognitoTable(); autoSave(); }
    if (tbl === 'pod') { state.pod       = state.pod.filter(r=>r.id!==id);       renderPodTable();       autoSave(); }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderHandoverTable(); renderNoshowTable(); renderIncognitoTable(); renderPodTable();
    }, 200);
  });
}

function tblArray(tbl) {
  if (tbl === 'ho')  return state.handover;
  if (tbl === 'ns')  return state.noshow;
  if (tbl === 'ic')  return state.incognito;
  if (tbl === 'pod') return state.pod;
  return null;
}

// ── Summary ───────────────────────────────────────────────────
function renderSummary() {
  collectAll();
  const el = document.getElementById('summaryContent'); if (!el) return;
  const m = state.meta, k = state.kpis;
  const hotel = currentHotel;

  el.innerHTML = `
    <div class="sum-block">
      <div class="sum-head"><h3>Property &amp; Shift Details</h3></div>
      <div class="sum-body">
        <div class="sum-stat-grid">
          ${[
            ['Property', hotel?.name||'—'],
            ['Date', fmtDate(m.date)||'—'],
            ['Agent (Handing Over)', m.agent||'—'],
            ['Received By', m.receiver||'—'],
            ['From Shift', m.from||'—'],
            ['To Shift', m.to||'—']
          ].map(([l,v])=>`<div class="sum-stat"><div class="sum-stat-label">${l}</div><div class="sum-stat-value">${v}</div></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="sum-block">
      <div class="sum-head"><h3>KPI Overview — All Shifts</h3></div>
      <div class="sum-body"><div style="overflow-x:auto">
        <table class="data-table"><thead><tr>
          <th>Shift</th><th>Walk In</th><th>Extensions</th><th>B&B Up.</th><th>Room Up.</th>
          <th>Sparkles</th><th>Profiles</th><th>Enrollment</th><th>All Memb.</th><th>Welcome</th>
        </tr></thead><tbody>
          ${['Morning','Evening','Night'].map(sh => { const d = k[sh]||EMPTY_KPI(); const clr={Morning:'#FEF3C7,#92400E',Evening:'#DBEAFE,#1E40AF',Night:'#EDE9FE,#5B21B6'}[sh].split(','); return `<tr>
            <td><span style="background:${clr[0]};color:${clr[1]};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${sh}</span></td>
            ${['walkin','ext','bb','room','spark','prof','enrollment','allMembership','welcome'].map(f=>`<td style="text-align:center;font-weight:600">${d[f]||'—'}</td>`).join('')}
          </tr>`; }).join('')}
          <tr style="background:var(--surface);font-weight:700"><td style="font-weight:800;font-size:12px">TOTAL</td>
            ${['walkin','ext','bb','room','spark','prof','enrollment','allMembership','welcome'].map(f=>{
              const t=['Morning','Evening','Night'].reduce((s,sh)=>s+(parseInt(k[sh]?.[f])||0),0);
              return `<td style="text-align:center;color:var(--gold-dim)">${t||'—'}</td>`;
            }).join('')}
          </tr>
        </tbody></table>
      </div></div>
    </div>

    <div class="sum-block">
      <div class="sum-head"><h3>Handover Tasks</h3><span class="sum-count">${state.handover.filter(r=>r.note||r.heartist).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Date</th><th>Heartist</th><th>Task</th><th>Update</th><th>Status</th></tr></thead><tbody>
        ${state.handover.filter(r=>r.note||r.heartist).map(r => {
          const ss = statusStyle(r.status);
          return `<tr><td>${fmtDateShort(r.date)}</td><td><strong>${esc(r.heartist)||'—'}</strong></td><td>${esc(r.note)||'—'}</td><td>${esc(r.update)||'—'}</td>
          <td><span style="background:${ss.bg};color:${ss.color};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${r.status}</span></td></tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3);font-style:italic;padding:14px">No tasks recorded</td></tr>'}
      </tbody></table></div></div>
    </div>

    ${state.noshow.filter(r=>r.name||r.resv).length ? `
    <div class="sum-block">
      <div class="sum-head" style="background:linear-gradient(135deg,#7A1010,#991B1B)"><h3 style="color:#FCA5A5">No Shows</h3><span class="sum-count" style="color:rgba(255,255,255,.5)">${state.noshow.filter(r=>r.name||r.resv).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Guest Name</th><th>Resv. / Room</th><th>Arrival</th><th>Nights</th><th>Status</th><th>Remarks</th></tr></thead><tbody>
        ${state.noshow.filter(r=>r.name||r.resv).map(r => {
          const ss = noshowStatusStyle(r.status);
          return `<tr><td><strong>${esc(r.name)||'—'}</strong></td><td>${esc(r.resv)||'—'}</td><td>${fmtDateShort(r.arrival)}</td><td>${esc(r.nights)||'1'}</td>
          <td><span style="background:${ss.bg};color:${ss.color};padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700">${r.status}</span></td>
          <td>${esc(r.remarks)||'—'}</td></tr>`;
        }).join('')}
      </tbody></table></div></div>
    </div>` : ''}

    ${state.incognito.filter(r=>r.room||r.name).length ? `
    <div class="sum-block">
      <div class="sum-head" style="background:linear-gradient(135deg,#3A0A7A,#5A1A9A)"><h3 style="color:#C4A0F0">Incognito Rooms</h3><span class="sum-count" style="color:rgba(255,255,255,.5)">${state.incognito.filter(r=>r.room||r.name).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Room</th><th>Name / Alias</th><th>Check-In</th><th>Check-Out</th><th>Priority</th><th>Instructions</th></tr></thead><tbody>
        ${state.incognito.filter(r=>r.room||r.name).map(r => {
          const ps = priorityStyle(r.priority);
          return `<tr><td><strong>${esc(r.room)||'—'}</strong></td><td>${esc(r.name)||'—'}</td><td>${fmtDateShort(r.checkin)}</td><td>${fmtDateShort(r.checkout)}</td>
          <td><span style="background:${ps.bg};color:${ps.color};padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700">${r.priority}</span></td>
          <td>${esc(r.instructions)||'—'}</td></tr>`;
        }).join('')}
      </tbody></table></div></div>
    </div>` : ''}

    ${state.pod.filter(r=>r.room||r.name).length ? `
    <div class="sum-block">
      <div class="sum-head"><h3>POD Rooms</h3><span class="sum-count">${state.pod.filter(r=>r.room||r.name).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Room</th><th>Guest Name</th><th>Check-In</th><th>Check-Out</th><th>Remarks</th></tr></thead><tbody>
        ${state.pod.filter(r=>r.room||r.name).map(r=>`<tr>
          <td><strong>${esc(r.room)||'—'}</strong></td><td>${esc(r.name)||'—'}</td>
          <td>${fmtDateShort(r.checkin)}</td><td>${fmtDateShort(r.checkout)}</td><td>${esc(r.remarks)||'—'}</td>
        </tr>`).join('')}
      </tbody></table></div></div>
    </div>` : ''}
  `;
}

// ════════════════════════════════════════════════════════════
// PRO PDF EXPORT
// ════════════════════════════════════════════════════════════
function exportPDF() {
  collectAll();
  const m = state.meta, k = state.kpis;
  const hotel = currentHotel || { name: 'Hotel', color: '#C8A96E', stars: 5 };

  const fmt = iso => { if(!iso) return '—'; const [y,mo,d]=iso.split('-'); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${parseInt(d)} ${M[parseInt(mo)-1]} ${y}`; };
  const dow = m.date ? new Date(m.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long'}) : '';

  const taskRows = state.handover.filter(r=>r.date||r.heartist||r.note||r.update).map((r,i) => {
    const sc = statusStyle(r.status);
    return `<tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td style="white-space:nowrap">${fmt(r.date)}</td>
      <td><strong>${esc(r.heartist)||'—'}</strong></td>
      <td>${esc(r.note)||'—'}</td>
      <td>${esc(r.update)||'—'}</td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color};border:1pt solid ${sc.border}">${r.status}</span></td>
    </tr>`;
  }).join('');

  const kpiRows = ['Morning','Evening','Night'].map(sh => {
    const d=k[sh]||EMPTY_KPI();
    const C={Morning:['#FEF3C7','#92400E'],Evening:['#DBEAFE','#1E40AF'],Night:['#EDE9FE','#5B21B6']}[sh];
    return `<tr>
      <td><span class="sbadge" style="background:${C[0]};color:${C[1]}">${sh}</span></td>
      <td class="c">${d.walkin||'—'}</td><td class="c">${d.ext||'—'}</td><td class="c">${d.bb||'—'}</td>
      <td class="c">${d.room||'—'}</td><td class="c">${d.spark||'—'}</td><td class="c">${d.prof||'—'}</td>
      <td class="c">${d.enrollment||'—'}</td><td class="c">${d.allMembership||'—'}</td><td class="c">${d.welcome||'—'}</td>
    </tr>`;
  }).join('');

  const totals = ['walkin','ext','bb','room','spark','prof','enrollment','allMembership','welcome'].map(f => {
    const t=['Morning','Evening','Night'].reduce((s,sh)=>s+(parseInt(k[sh]?.[f])||0),0);
    return `<td class="c"><strong>${t||'—'}</strong></td>`;
  }).join('');

  const noshowRows = state.noshow.filter(r=>r.name||r.resv).map((r,i) => {
    const sc = noshowStatusStyle(r.status);
    return `<tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td><strong>${esc(r.name)||'—'}</strong></td>
      <td>${esc(r.resv)||'—'}</td>
      <td style="white-space:nowrap">${fmt(r.arrival)}</td>
      <td class="c">${esc(r.nights)||'1'}</td>
      <td>${esc(r.remarks)||'—'}</td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color};border:1pt solid ${sc.border}">${r.status}</span></td>
    </tr>`;
  }).join('');

  const incognitoRows = state.incognito.filter(r=>r.room||r.name).map((r,i) => {
    const ps = priorityStyle(r.priority);
    return `<tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td><strong>${esc(r.room)||'—'}</strong></td>
      <td>${esc(r.name)||'—'}</td>
      <td style="white-space:nowrap">${fmt(r.checkin)}</td>
      <td style="white-space:nowrap">${fmt(r.checkout)}</td>
      <td><span class="badge" style="background:${ps.bg};color:${ps.color};border:1pt solid ${ps.border}">${r.priority}</span></td>
      <td>${esc(r.instructions)||'—'}</td>
    </tr>`;
  }).join('');

  const podRows = state.pod.filter(r=>r.room||r.name).map((r,i) => `
    <tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td><strong>${esc(r.room)||'—'}</strong></td>
      <td>${esc(r.name)||'—'}</td>
      <td style="white-space:nowrap">${fmt(r.checkin)}</td>
      <td style="white-space:nowrap">${fmt(r.checkout)}</td>
      <td>${esc(r.remarks)||'—'}</td>
    </tr>`).join('');

  const notesHtml = ['morning','evening','night'].filter(s=>state.generalNotes[s]).map(s => {
    const C={morning:['#FEF3C7','#92400E'],evening:['#DBEAFE','#1E40AF'],night:['#EDE9FE','#5B21B6']}[s];
    return `<tr>
      <td style="white-space:nowrap"><span class="sbadge" style="background:${C[0]};color:${C[1]};text-transform:capitalize">${s}</span></td>
      <td style="text-align:left;white-space:pre-wrap;line-height:1.6">${esc(state.generalNotes[s])}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${hotel.name} — Handover ${fmt(m.date)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;font-size:8.5pt;color:#1A1F2E;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:12mm 12mm 15mm 12mm}

/* HEADER */
.header{display:flex;align-items:stretch;margin-bottom:9pt;border-radius:8pt;overflow:hidden;box-shadow:0 2pt 12pt rgba(0,0,0,.15)}
.header-stripe{width:7pt;flex-shrink:0;background:linear-gradient(180deg,${hotel.color} 0%,${hotel.color}88 100%)}
.header-body{background:linear-gradient(135deg,#0A0F1E 0%,#1C2840 50%,#0A0F1E 100%);flex:1;padding:11pt 16pt;display:flex;align-items:center;justify-content:space-between;gap:12pt}
.h-brand{}
.h-stars{font-size:8pt;letter-spacing:4pt;color:${hotel.color};margin-bottom:4pt;opacity:.8}
.h-name{font-family:'Playfair Display',serif;font-size:20pt;font-weight:700;color:#fff;letter-spacing:.3pt;line-height:1;margin-bottom:3pt}
.h-sub{font-size:7.5pt;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:1.5pt}
.h-right{text-align:right}
.h-dow{font-size:6.5pt;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:1pt;margin-bottom:2pt}
.h-date{font-family:'Playfair Display',serif;font-size:19pt;font-weight:700;color:${hotel.color};line-height:1}
.h-hotel-sub{font-size:6.5pt;color:rgba(255,255,255,.3);margin-top:3pt;text-align:right}

/* META STRIP */
.meta{display:grid;grid-template-columns:repeat(6,1fr);gap:4pt;margin-bottom:9pt}
.mt{background:#F8F7F4;border:1pt solid #E6E1D8;border-radius:5pt;padding:6pt 9pt;position:relative;overflow:hidden}
.mt::after{content:'';position:absolute;top:0;left:0;right:0;height:2pt;background:linear-gradient(90deg,${hotel.color},${hotel.color}44)}
.mt .l{font-size:5.5pt;font-weight:700;color:#7A8899;text-transform:uppercase;letter-spacing:.6pt;margin-bottom:2pt}
.mt .v{font-size:8.5pt;font-weight:600;color:#1A1F2E;line-height:1.3}
.mt.hl .v{color:${hotel.color=='#C8A96E'?'#7A5A1A':'#1A3A7A'}}

/* SECTION */
.sec{margin-bottom:9pt;page-break-inside:avoid}
.sec-hd{display:flex;align-items:center;gap:6pt;margin-bottom:5pt}
.sec-icon{width:18pt;height:18pt;border-radius:4pt;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sec-icon svg{width:11pt;height:11pt}
.sec-title{font-family:'Playfair Display',serif;font-size:13pt;font-weight:700;color:#1A1F2E}
.sec-line{flex:1;height:.75pt;background:linear-gradient(90deg,#E6E1D8,transparent)}
.sec-cnt{font-size:6.5pt;color:#7A8899;background:#F0EDE7;padding:2pt 7pt;border-radius:20pt;border:1pt solid #E6E1D8}

/* TABLES */
.tw{border:1pt solid #E6E1D8;border-radius:0 0 6pt 6pt;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:7.5pt}
thead tr{background:linear-gradient(135deg,#0A0F1E 0%,#1C2840 100%)}
thead th{color:rgba(255,255,255,.7);font-weight:700;padding:5pt 7pt;text-align:left;font-size:6.5pt;text-transform:uppercase;letter-spacing:.5pt}
thead th:first-child{border-radius:4pt 0 0 0}
thead th:last-child{border-radius:0 4pt 0 0}
tbody tr{border-bottom:.75pt solid #F0EDE7}
tbody tr:last-child{border-bottom:none}
tbody tr:nth-child(even) td{background:#FAFAF8}
tbody td{padding:5pt 7pt;vertical-align:top;color:#1A1F2E;line-height:1.45}
.c{text-align:center}

/* KPI TABLE */
.kpi thead tr{background:linear-gradient(135deg,#1A3D8A 0%,#2D5299 100%)}
.kpi-tot td{background:linear-gradient(135deg,#0A0F1E,#1C2840)!important;color:${hotel.color}!important;font-weight:700;font-size:8pt;padding:6pt 7pt}
.kpi-tot td:first-child{border-radius:0 0 0 4pt}
.kpi-tot td:last-child{border-radius:0 0 4pt 0}

/* NO SHOW */
.ns-hd{background:linear-gradient(135deg,#7A0A0A 0%,#991B1B 100%)!important}
.ns-hd .sec-title{color:#FCA5A5!important}

/* INCOGNITO */
.ic-hd{background:linear-gradient(135deg,#2A0A5A 0%,#4C1A8A 100%)!important}
.ic-hd .sec-title{color:#C4A0F0!important}
.ic-watermark{font-size:7pt;font-weight:700;color:#9B2020;background:#FDE8E8;border:1pt solid #F5B0B0;border-radius:4pt;padding:4pt 8pt;display:inline-block;margin-bottom:5pt;text-transform:uppercase;letter-spacing:.5pt}

/* BADGES */
.badge{display:inline-block;padding:2pt 6pt;border-radius:20pt;font-size:6.5pt;font-weight:700;border:1pt solid transparent;white-space:nowrap}
.sbadge{display:inline-block;padding:2pt 7pt;border-radius:20pt;font-size:6.5pt;font-weight:700}

/* DIVIDER */
.div{height:.75pt;background:linear-gradient(90deg,${hotel.color},rgba(200,169,110,.1));margin:8pt 0}

/* SIGNATURES */
.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:10pt;margin-top:10pt}
.sig-box{border:1pt solid #E6E1D8;border-radius:5pt;padding:9pt 12pt 6pt;background:#FAFAF8;position:relative;overflow:hidden}
.sig-box::before{content:'';position:absolute;top:0;left:0;right:0;height:2pt;background:linear-gradient(90deg,${hotel.color},transparent)}
.sig-lbl{font-size:6pt;font-weight:700;color:#7A8899;text-transform:uppercase;letter-spacing:.5pt;margin-bottom:2pt}
.sig-name{font-family:'Playfair Display',serif;font-size:11pt;font-weight:600;color:#1A1F2E;margin-bottom:9pt}
.sig-line{border-bottom:.75pt solid #B0BCC8;margin-bottom:3pt}
.sig-sub{font-size:6pt;color:#7A8899;text-transform:uppercase;letter-spacing:.4pt}

/* FOOTER */
.footer{margin-top:10pt;padding-top:6pt;border-top:.75pt solid #E6E1D8;display:flex;justify-content:space-between;align-items:center;font-size:6.5pt;color:#7A8899}
.f-brand{display:flex;align-items:center;gap:5pt}
.f-stars{color:${hotel.color};font-size:7.5pt;letter-spacing:2pt}

@media print{body{font-size:8.5pt}.no-print{display:none}}
</style>
</head><body>

<!-- HEADER -->
<div class="header">
  <div class="header-stripe"></div>
  <div class="header-body">
    <div class="h-brand">
      <div class="h-stars">${'★'.repeat(hotel.stars)}</div>
      <div class="h-name">${hotel.name}</div>
      <div class="h-sub">Front Office — Shift Handover Report</div>
    </div>
    <div class="h-right">
      <div class="h-dow">${dow}</div>
      <div class="h-date">${fmt(m.date)}</div>
      <div class="h-hotel-sub">Confidential document</div>
    </div>
  </div>
</div>

<!-- META STRIP -->
<div class="meta">
  <div class="mt hl"><div class="l">Agent — Handing Over</div><div class="v">${esc(m.agent)||'—'}</div></div>
  <div class="mt hl"><div class="l">Received By</div><div class="v">${esc(m.receiver)||'—'}</div></div>
  <div class="mt"><div class="l">From Shift</div><div class="v">${esc(m.from)||'—'}</div></div>
  <div class="mt"><div class="l">To Shift</div><div class="v">${esc(m.to)||'—'}</div></div>
  <div class="mt"><div class="l">Date Generated</div><div class="v">${new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</div></div>
  <div class="mt"><div class="l">Time Generated</div><div class="v">${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div></div>
</div>

<!-- HANDOVER TASKS -->
<div class="sec">
  <div class="sec-hd">
    <div class="sec-icon" style="background:#0A0F1E"><svg viewBox="0 0 20 20" fill="none" stroke="${hotel.color}" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="2" height="4" rx="1"/></svg></div>
    <div class="sec-title">Heartist Handover Tasks</div>
    <div class="sec-line"></div>
    <div class="sec-cnt">${state.handover.filter(r=>r.note||r.heartist).length} tasks</div>
  </div>
  <div class="tw">
    <table>
      <thead><tr><th style="width:3%">#</th><th style="width:9%">Date</th><th style="width:12%">Heartist</th><th style="width:28%">Task / Note</th><th style="width:28%">Update / Action</th><th style="width:10%">Status</th></tr></thead>
      <tbody>${taskRows||'<tr><td colspan="6" style="text-align:center;color:#7A8899;font-style:italic;padding:10pt">No tasks recorded</td></tr>'}</tbody>
    </table>
  </div>
</div>

<!-- KPIs -->
<div class="sec">
  <div class="sec-hd">
    <div class="sec-icon" style="background:#1A3D8A"><svg viewBox="0 0 20 20" fill="none" stroke="#93C5FD" stroke-width="1.5"><path d="M4 15l4-4 3 3 5-6"/></svg></div>
    <div class="sec-title">KPI Overview — All Shifts</div>
    <div class="sec-line"></div>
  </div>
  <div class="tw">
    <table class="kpi">
      <thead><tr><th>Shift</th><th class="c">Walk In</th><th class="c">Extensions</th><th class="c">B&B Up.</th><th class="c">Room Up.</th><th class="c">Sparkles</th><th class="c">Profiles</th><th class="c">Enrollment</th><th class="c">All Memb.</th><th class="c">Welcome</th></tr></thead>
      <tbody>
        ${kpiRows}
        <tr class="kpi-tot"><td>TOTAL</td>${totals}</tr>
      </tbody>
    </table>
  </div>
</div>

${noshowRows ? `
<!-- NO SHOWS -->
<div class="sec">
  <div class="sec-hd ns-hd" style="background:linear-gradient(135deg,#7A0A0A,#991B1B);padding:5pt 8pt;border-radius:5pt">
    <div class="sec-icon" style="background:rgba(0,0,0,.3)"><svg viewBox="0 0 20 20" fill="none" stroke="#FCA5A5" stroke-width="1.5"><circle cx="10" cy="8" r="3"/><path d="M4 18c0-3.314 2.686-6 6-6s6 2.686 6 6"/><path d="M16 4L4 16" stroke-width="1.8"/></svg></div>
    <div class="sec-title" style="color:#FCA5A5">No Show Log</div>
    <div class="sec-line" style="background:rgba(252,165,165,.3)"></div>
    <div class="sec-cnt" style="background:rgba(0,0,0,.3);color:#FCA5A5;border-color:rgba(252,165,165,.3)">${state.noshow.filter(r=>r.name||r.resv).length} records</div>
  </div>
  <div class="tw">
    <table>
      <thead><tr><th style="width:3%">#</th><th style="width:18%">Guest Name</th><th style="width:14%">Resv. / Room</th><th style="width:10%">Arrival</th><th style="width:7%">Nights</th><th style="width:10%">Status</th><th>Remarks</th></tr></thead>
      <tbody>${noshowRows}</tbody>
    </table>
  </div>
</div>` : ''}

${incognitoRows ? `
<!-- INCOGNITO -->
<div class="sec">
  <div class="sec-hd" style="background:linear-gradient(135deg,#2A0A5A,#4C1A8A);padding:5pt 8pt;border-radius:5pt">
    <div class="sec-icon" style="background:rgba(0,0,0,.3)"><svg viewBox="0 0 20 20" fill="none" stroke="#C4A0F0" stroke-width="1.5"><path d="M10 3C5 3 2 10 2 10s3 7 8 7 8-7 8-7-3-7-8-7z"/><circle cx="10" cy="10" r="2.5"/></svg></div>
    <div class="sec-title" style="color:#C4A0F0">Incognito Rooms — CONFIDENTIAL</div>
    <div class="sec-line" style="background:rgba(196,160,240,.3)"></div>
    <div class="sec-cnt" style="background:rgba(0,0,0,.3);color:#C4A0F0;border-color:rgba(196,160,240,.3)">${state.incognito.filter(r=>r.room||r.name).length} rooms</div>
  </div>
  <div style="margin-bottom:4pt"><span class="ic-watermark">⚠ Confidential — Do Not Distribute</span></div>
  <div class="tw">
    <table>
      <thead><tr><th style="width:3%">#</th><th style="width:8%">Room</th><th style="width:18%">Name / Alias</th><th style="width:10%">Check-In</th><th style="width:10%">Check-Out</th><th style="width:10%">Priority</th><th>Special Instructions</th></tr></thead>
      <tbody>${incognitoRows}</tbody>
    </table>
  </div>
</div>` : ''}

${podRows ? `
<!-- POD ROOMS -->
<div class="sec">
  <div class="sec-hd">
    <div class="sec-icon" style="background:#0D4B8A"><svg viewBox="0 0 20 20" fill="none" stroke="#93C5FD" stroke-width="1.5"><rect x="2" y="7" width="16" height="11" rx="1"/><path d="M6 7V5a4 4 0 018 0v2"/></svg></div>
    <div class="sec-title">Priority Of Day — POD Rooms</div>
    <div class="sec-line"></div>
    <div class="sec-cnt">${state.pod.filter(r=>r.room||r.name).length} rooms</div>
  </div>
  <div class="tw">
    <table>
      <thead><tr><th style="width:3%">#</th><th style="width:9%">Room</th><th style="width:20%">Guest Name</th><th style="width:11%">Check-In</th><th style="width:11%">Check-Out</th><th>Remarks</th></tr></thead>
      <tbody>${podRows}</tbody>
    </table>
  </div>
</div>` : ''}

${notesHtml ? `
<!-- NOTES -->
<div class="sec">
  <div class="sec-hd">
    <div class="sec-icon" style="background:#0F5A3A"><svg viewBox="0 0 20 20" fill="none" stroke="#6EE7B7" stroke-width="1.5"><path d="M4 4h12v9l-4 4H4z"/><path d="M7 8h6M7 11h4"/></svg></div>
    <div class="sec-title">Shift Notes</div>
    <div class="sec-line"></div>
  </div>
  <div class="tw">
    <table><thead><tr><th style="width:12%">Shift</th><th>Notes</th></tr></thead><tbody>${notesHtml}</tbody></table>
  </div>
</div>` : ''}

<div class="div"></div>

<!-- SIGNATURES -->
<div class="sig-row">
  <div class="sig-box">
    <div class="sig-lbl">Handed Over By</div>
    <div class="sig-name">${esc(m.agent)||'_________________________'}</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &amp; Time</div>
  </div>
  <div class="sig-box">
    <div class="sig-lbl">Received By</div>
    <div class="sig-name">${esc(m.receiver)||'_________________________'}</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &amp; Time</div>
  </div>
</div>

<!-- FOOTER -->
<div class="footer">
  <div class="f-brand">
    <span class="f-stars">${'★'.repeat(hotel.stars)}</span>
    <span><strong>${hotel.name}</strong> — Front Office Handover Report</span>
  </div>
  <span>${fmt(m.date)} &nbsp;·&nbsp; ${esc(m.from)} → ${esc(m.to)}</span>
  <span>Generated ${new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
</div>

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked — allow pop-ups and retry', true); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); setTimeout(() => win.print(), 600); };
}

// ── Status / Priority helpers ─────────────────────────────────
function taskStatuses() { return ['Pending','In Progress','Done','Urgent','Follow Up','Info','Cancelled']; }
function noshowStatuses() { return ['No Show','Charged','Waived','Disputed','Refunded','Investigating']; }
function incogPriorities() { return ['VIP','VVIP','Celebrity','Government','Security Risk','Media']; }

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

function noshowStatusStyle(s) {
  return ({
    'No Show':     {bg:'#FEE2E2',color:'#991B1B',border:'#FCA5A5'},
    'Charged':     {bg:'#D1FAE5',color:'#065F46',border:'#6EE7B7'},
    'Waived':      {bg:'#F3F4F6',color:'#374151',border:'#D1D5DB'},
    'Disputed':    {bg:'#FEF3C7',color:'#92400E',border:'#E2C47A'},
    'Refunded':    {bg:'#DBEAFE',color:'#1E3A8A',border:'#93C5FD'},
    'Investigating':{bg:'#EDE9FE',color:'#4C1D95',border:'#C4B5FD'},
  })[s] || {bg:'#FEE2E2',color:'#991B1B',border:'#FCA5A5'};
}

function priorityStyle(s) {
  return ({
    'VIP':          {bg:'#FEF3C7',color:'#92400E',border:'#E2C47A'},
    'VVIP':         {bg:'#FDE8E8',color:'#7A1010',border:'#F5B0B0'},
    'Celebrity':    {bg:'#EDE9FE',color:'#4C1D95',border:'#C4B5FD'},
    'Government':   {bg:'#DBEAFE',color:'#1E3A8A',border:'#93C5FD'},
    'Security Risk':{bg:'#FEE2E2',color:'#991B1B',border:'#FCA5A5'},
    'Media':        {bg:'#F0F9FF',color:'#075985',border:'#BAE6FD'},
  })[s] || {bg:'#EDE9FE',color:'#4C1D95',border:'#C4B5FD'};
}

function applyStatusColors() {
  document.querySelectorAll('.status-sel').forEach(sel => {
    const tbl = sel.dataset.tbl;
    let s;
    if (tbl === 'ns') s = noshowStatusStyle(sel.value);
    else s = statusStyle(sel.value);
    sel.style.background = s.bg; sel.style.color = s.color; sel.style.borderColor = s.border;
  });
}

function applyIncognitoColors() {
  document.querySelectorAll('.ic-priority').forEach(sel => {
    const ps = priorityStyle(sel.value);
    sel.style.background = ps.bg; sel.style.color = ps.color; sel.style.borderColor = ps.border;
  });
}

// ── Utilities ─────────────────────────────────────────────────
function v(id)          { const el=document.getElementById(id); return el?el.value:''; }
function setVal(id,val) { const el=document.getElementById(id); if(el&&val!=null) el.value=val; }
function esc(s)         { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid()          { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function todayISO()     { return new Date().toISOString().split('T')[0]; }
function fmtDate(iso)   { if(!iso) return ''; const d=new Date(iso+'T00:00:00'); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtDateShort(iso) { if(!iso) return '—'; const [y,mo,d]=iso.split('-'); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${parseInt(d)} ${M[parseInt(mo)-1]} ${y}`; }
function trashSvg()     { return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 4h4M5 7h10l-1 10H6L5 7z" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 7h14" stroke-linecap="round"/></svg>`; }

function showToast(msg, isErr) {
  const t=document.getElementById('toast'); if(!t) return;
  t.innerHTML=`${isErr
    ?'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7"/><path d="M10 7v4M10 13h.01"/></svg>'
    :'<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 10l4 4 6-6"/></svg>'} ${msg}`;
  t.className='toast'+(isErr?' error-toast':'')+' show';
  setTimeout(()=>t.classList.remove('show'), 2800);
}

function initDate() {
  const today=todayISO();
  const dtEl=document.getElementById('todayDate'); if(dtEl) dtEl.textContent=fmtDate(today);
  if (!state.meta.date) { state.meta.date=today; setVal('ho_date',today); }
  const hr=new Date().getHours();
  // Morning 08:00–17:00 | Evening 15:00–00:00 | Night 19:00–04:00
  // During overlaps, the most-recently-started shift takes priority:
  //   15–17 → Evening started at 15, Morning at 08 → Evening wins
  //   19–00 → Night started at 19, Evening at 15 → Night wins
  let sh;
  if (hr >= 19 || hr < 4)       sh = 'Night';    // 19:00–03:59
  else if (hr >= 15)             sh = 'Evening';  // 15:00–18:59
  else if (hr >= 8)              sh = 'Morning';  // 08:00–14:59
  else if (hr >= 4 && hr < 8)   sh = 'Night';    // 04:00–07:59 (night tail)
  else                           sh = 'Morning';  // fallback
  currentKpiShift=sh;
  const csEl=document.getElementById('currentShift'); if(csEl) csEl.textContent=sh;
  const dot=document.getElementById('shiftDot');
  if(dot){const C={Morning:'#C8A96E',Evening:'#60A5FA',Night:'#A78BFA'}; dot.style.background=C[sh]; dot.style.boxShadow=`0 0 8px ${C[sh]}99`;}
}

// ── Expose globals ────────────────────────────────────────────
window.showTab          = showTab;
window.autoSave         = autoSave;
window.manualSave       = manualSave;
window.exportPDF        = exportPDF;
window.onDateChange     = onDateChange;
window.switchKpiShift   = switchKpiShift;
window.addHandoverRow   = addHandoverRow;
window.addNoshowRow     = addNoshowRow;
window.addIncognitoRow  = addIncognitoRow;
window.addPodRow        = addPodRow;
window.renderSummary    = renderSummary;
window.showHotelSelector = showHotelSelector;
window.selectHotel      = selectHotel;
window.clearHandover    = () => {
  if (!confirm('Clear all handover tasks?')) return;
  state.handover=[]; renderHandoverTable(); autoSave();
};
