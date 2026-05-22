/* app.js - COMPLETE REPLACEMENT with KPI fix */
"use strict";

// ── Global state ──────────────────────────────────────────────
let db, currentRef, firebaseEnabled = false;
let currentHotel = null;
let currentKpiShift = 'Morning';
let isLoading = false;
let isRestoring = false;
let saveTimer = null;

// History stack (in-memory for undo/redo)
let historyStack = [];
let historyIndex = -1;
let isUndoRedo = false;

// Track user typing to prevent Firebase re-renders from interrupting input
let userIsTyping = false;
let typingTimer = null;
let pendingRemoteState = null; // holds incoming Firebase data while user is typing

// Activity log (user actions only)
let activityLog = [];
let activityLogIdCounter = 0;

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
      <div class="hotel-card-logo-wrap">
        <img class="hotel-card-logo" src="${h.logo}" alt="${escapeHtml(h.short)} logo"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="hotel-card-logo-fallback" style="display:none;color:${h.color}">${escapeHtml(h.short)}</div>
      </div>
      <div class="hotel-card-info">
        <div class="hotel-card-name">${escapeHtml(h.name)}</div>
        <div class="hotel-card-stars" style="color:${h.color}">${'★'.repeat(h.stars)}${'☆'.repeat(5-h.stars)}</div>
      </div>
      <svg class="hotel-card-arrow" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 5l5 5-5 5"/></svg>
    </div>
  `).join('');
}

function selectHotel(id, animate) {
  currentHotel = HOTELS.find(h => h.id === id);
  if (!currentHotel) return;
  localStorage.setItem('fo_last_hotel', id);

  const topbar = document.getElementById('topbar');
  const navtabs = document.getElementById('navtabs');
  if (topbar) topbar.style.setProperty('--hotel-color', currentHotel.color);
  if (navtabs) navtabs.style.setProperty('--hotel-color', currentHotel.color);

  document.getElementById('hotelShortName').textContent = currentHotel.short;

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

  // Reset history for new hotel
  historyStack = [];
  historyIndex = -1;
  activityLog = [];
  activityLogIdCounter = 0;
  updateUndoRedoButtons();

  state = freshState();
  initDate();
  initFirebase();
  renderAll();
  setupListeners();
  
  // Load trash from Firebase
  loadTrashFromDB();
}

function showHotelSelector() {
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

// ── Trash bin (Firebase) ─────────────────────────────────────
function trashPath() { return `${DB_ROOT}/${currentHotel?.id||'default'}/${getDateKey()}/trash`; }

async function addToTrash(tableName, rowData) {
  if (!firebaseEnabled || !db) return;
  try {
    const trashRef = db.ref(trashPath());
    const trashItem = {
      id: rowData.id || uid(),
      table: tableName,
      data: rowData,
      deletedAt: Date.now(),
      deletedBy: state.meta.agent || 'Unknown'
    };
    await trashRef.child(trashItem.id).set(trashItem);
    // Keep only last 50 trash items
    const snapshot = await trashRef.orderByChild('deletedAt').limitToLast(100).once('value');
    const items = snapshot.val();
    if (items && Object.keys(items).length > 50) {
      const keys = Object.keys(items).sort((a,b) => items[a].deletedAt - items[b].deletedAt);
      const toDelete = keys.slice(0, keys.length - 50);
      for (const key of toDelete) {
        await trashRef.child(key).remove();
      }
    }
  } catch(e) { console.warn('Trash save failed', e); }
}

async function loadTrashFromDB() {
  if (!firebaseEnabled || !db) return;
  try {
    const snapshot = await db.ref(trashPath()).orderByChild('deletedAt').limitToLast(20).once('value');
    const trash = snapshot.val();
    renderTrashList(trash);
  } catch(e) { console.warn('Load trash failed', e); }
}

function renderTrashList(trash) {
  const restorePanel = document.getElementById('restorePanel');
  const trashList = document.getElementById('trashList');
  const trashCountSpan = document.getElementById('trashCount');
  
  if (!trashList) return;
  
  const trashArray = trash ? Object.values(trash).reverse() : [];
  const count = trashArray.length;
  
  if (trashCountSpan) trashCountSpan.textContent = count + ' item' + (count !== 1 ? 's' : '');
  
  if (count === 0) {
    if (restorePanel) restorePanel.style.display = 'none';
    return;
  }
  
  if (restorePanel) restorePanel.style.display = 'block';
  
  const tableNames = { ho: 'Handover', ns: 'No Show', ic: 'Incognito', pod: 'POD' };
  
  trashList.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;">' + 
    trashArray.map(item => {
      const itemName = item.data.name || item.data.heartist || item.data.room || '(unnamed)';
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface);border-radius:8px;border:1px solid var(--border);">
        <div style="font-size:12px;">
          <strong style="color:#9B1B1B">🗑️ ${tableNames[item.table] || item.table}</strong><br>
          <span style="color:var(--text3);font-size:11px;">Deleted: ${new Date(item.deletedAt).toLocaleString()}</span>
          <div style="font-size:11px;color:var(--text2);">${escapeHtml(itemName)}</div>
        </div>
        <button class="btn btn-ghost" style="padding:4px 12px;font-size:11px;" onclick="restoreFromTrash('${item.id}', '${item.table}')">Restore</button>
      </div>
    `}).join('') + '</div>';
}

async function restoreFromTrash(trashId, tableName) {
  if (!firebaseEnabled || !db) return;
  isRestoring = true;
  try {
    const trashRef = db.ref(trashPath());
    const snapshot = await trashRef.child(trashId).once('value');
    const trashItem = snapshot.val();
    if (!trashItem) { showToast('Item not found in trash', true); return; }
    
    const targetArray = getTblArray(tableName);
    if (targetArray) {
      // Check if item already exists (avoid duplicates)
      const exists = targetArray.some(item => item.id === trashItem.data.id);
      if (!exists) {
        targetArray.push(trashItem.data);
        addActivityLog(`Restored ${tableNameToName(tableName)}: ${getItemSummary(trashItem.data)}`, 'restore');
        pushToHistory();
        await saveToDB();
        renderTable(tableName);
        showToast(`Restored ${tableNameToName(tableName)} item`);
      }
    }
    
    // Remove from trash
    await trashRef.child(trashId).remove();
    await loadTrashFromDB();
  } catch(e) { console.warn('Restore failed', e); showToast('Restore failed', true); }
  isRestoring = false;
}

function tableNameToName(tbl) {
  const names = { ho: 'Handover', ns: 'No Show', ic: 'Incognito', pod: 'POD' };
  return names[tbl] || tbl;
}

function getItemSummary(item) {
  return item.name || item.heartist || item.room || (item.note ? item.note.substring(0,30) : '(item)');
}

// ── History (Undo/Redo) ──────────────────────────────────────
function pushToHistory() {
  if (isUndoRedo || isRestoring) return;
  
  // Remove any future states if we're not at the end
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  
  const snapshot = JSON.parse(JSON.stringify(state));
  historyStack.push(snapshot);
  historyIndex = historyStack.length - 1;
  
  // Limit history size to 50
  while (historyStack.length > 50) {
    historyStack.shift();
    historyIndex--;
  }
  
  updateUndoRedoButtons();
}

function restoreFromHistory(snapshot) {
  isUndoRedo = true;
  state = JSON.parse(JSON.stringify(snapshot));
  renderAll();
  isUndoRedo = false;
  saveToDB();
}

function historyUndo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreFromHistory(historyStack[historyIndex]);
  updateUndoRedoButtons();
  showToast('Undo successful');
}

function historyRedo() {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  restoreFromHistory(historyStack[historyIndex]);
  updateUndoRedoButtons();
  showToast('Redo successful');
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const undoPanel = document.getElementById('undoBtnPanel');
  const redoPanel = document.getElementById('redoBtnPanel');
  
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyStack.length - 1;
  
  if (undoBtn) undoBtn.disabled = !canUndo;
  if (redoBtn) redoBtn.disabled = !canRedo;
  if (undoPanel) undoPanel.disabled = !canUndo;
  if (redoPanel) redoPanel.disabled = !canRedo;
}

// ── Activity Log ─────────────────────────────────────────────
function addActivityLog(description, type = 'edit') {
  const entry = {
    id: ++activityLogIdCounter,
    timestamp: Date.now(),
    description: description,
    type: type,
    agent: state.meta.agent || 'Unknown'
  };
  activityLog.unshift(entry);
  
  // Keep only last 200 entries
  if (activityLog.length > 200) activityLog.pop();
  
  renderActivityLog();
}

function renderActivityLog() {
  const container = document.getElementById('activityLogList');
  if (!container) return;
  
  const logCountSpan = document.getElementById('logCount');
  if (logCountSpan) logCountSpan.textContent = activityLog.length + ' entry' + (activityLog.length !== 1 ? 's' : '');
  
  if (activityLog.length === 0) {
    container.innerHTML = '<div class="log-empty">No activity recorded yet. Changes you make will appear here.</div>';
    return;
  }
  
  const typeIcons = {
    add: '➕', delete: '🗑️', edit: '✏️', restore: '🔄', clear: '🧹'
  };
  
  container.innerHTML = activityLog.map(entry => `
    <div class="log-entry">
      <div class="log-icon">${typeIcons[entry.type] || '📝'}</div>
      <div class="log-body">
        <div class="log-label">${escapeHtml(entry.description)}</div>
        <div class="log-meta">${new Date(entry.timestamp).toLocaleString()} • ${escapeHtml(entry.agent)}</div>
      </div>
    </div>
  `).join('');
}

function clearActivityLog() {
  if (!confirm('Clear all activity log entries? This cannot be undone.')) return;
  activityLog = [];
  renderActivityLog();
  addActivityLog('Activity log cleared', 'clear');
  showToast('Activity log cleared');
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
    if (isRestoring) return;
    const d = snap.val();
    if (d && !isUndoRedo) {
      if (userIsTyping) {
        // User is actively typing — hold the incoming data and apply once they pause
        pendingRemoteState = d;
        return;
      }
      isLoading = true;
      mergeState(d);
      renderAll();
      isLoading = false;
      if (historyStack.length === 0) {
        pushToHistory();
      }
    }
    loadTrashFromDB();
  });
}

function saveToDB() {
  if (isRestoring || isUndoRedo) return;
  const saveState = JSON.parse(JSON.stringify(state));
  if (!firebaseEnabled || !db) {
    try { localStorage.setItem(lsKey(), JSON.stringify(saveState)); } catch(e) {}
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    db.ref(dbPath()).set(saveState).catch(() => showToast('Save failed', true));
    try { localStorage.setItem(lsKey(), JSON.stringify(saveState)); } catch(e) {}
  }, 2500); // debounce: wait for user to pause before writing to Firebase
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
  historyStack = [];
  historyIndex = -1;
  pushToHistory();
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
  if (isLoading || isRestoring) return;
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
  if (hc) hc.textContent = state.handover.filter(r=>r.note||r.heartist).length + ' task' + (state.handover.filter(r=>r.note||r.heartist).length!==1?'s':'');
  if (nc) nc.textContent = state.noshow.filter(r=>r.name||r.resv).length + ' record' + (state.noshow.filter(r=>r.name||r.resv).length!==1?'s':'');
  if (ic) ic.textContent = state.incognito.filter(r=>r.room||r.name).length + ' room' + (state.incognito.filter(r=>r.room||r.name).length!==1?'s':'');
  if (pc) pc.textContent = state.pod.filter(r=>r.room||r.name).length + ' room' + (state.pod.filter(r=>r.room||r.name).length!==1?'s':'');
}

// ── KPI ───────────────────────────────────────────────────────
function renderKpi() {
  const d = state.kpis[currentKpiShift] || EMPTY_KPI();
  ['walkin','ext','bb','room','spark','prof','enrollment','welcome','allMembership'].forEach(k => {
    const el = document.getElementById('kpi_'+k); if (el) el.value = d[k] || '';
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
    <td><input class="cell-input" value="${escapeHtml(r.heartist)}" data-id="${r.id}" data-field="heartist" data-tbl="ho" placeholder="Agent name"></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="note" data-tbl="ho" placeholder="Task or note…">${escapeHtml(r.note)}</textarea></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="update" data-tbl="ho" placeholder="Action taken…">${escapeHtml(r.update)}</textarea></td>
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
      <div class="m-card-field"><label>Heartist</label><input type="text" value="${escapeHtml(r.heartist)}" data-id="${r.id}" data-field="heartist" data-tbl="ho" placeholder="Agent name"></div>
      <div class="m-card-field full"><label>Task / Note</label><textarea data-id="${r.id}" data-field="note" data-tbl="ho" placeholder="Task or note…">${escapeHtml(r.note)}</textarea></div>
      <div class="m-card-field full"><label>Update / Action Taken</label><textarea data-id="${r.id}" data-field="update" data-tbl="ho" placeholder="Action taken…">${escapeHtml(r.update)}</textarea></div>
    </div>`;
  return div;
}

function addHandoverRow() { 
  const newRow = emptyTask();
  state.handover.push(newRow); 
  renderHandoverTable(); 
  addActivityLog(`Added handover task`, 'add');
  pushToHistory();
  autoSave(); 
}

function clearHandover() {
  if (!confirm('Clear all handover tasks?')) return;
  const count = state.handover.filter(r=>r.note||r.heartist).length;
  state.handover = [emptyTask()];
  renderHandoverTable();
  addActivityLog(`Cleared ${count} handover task${count!==1?'s':''}`, 'clear');
  pushToHistory();
  autoSave();
}

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
    <tr><div class="row-num">${i+1}</div></td>
    <td><input class="cell-input" value="${escapeHtml(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ns" placeholder="Guest name"></td>
    <td><input class="cell-input" value="${escapeHtml(r.resv)}" data-id="${r.id}" data-field="resv" data-tbl="ns" placeholder="Resv. / Room no."></td>
    <td><input class="cell-input" type="date" value="${r.arrival||''}" data-id="${r.id}" data-field="arrival" data-tbl="ns"></td>
    <td><input class="cell-input" type="number" min="1" value="${escapeHtml(r.nights)}" data-id="${r.id}" data-field="nights" data-tbl="ns" placeholder="1" style="width:70px"></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="remarks" data-tbl="ns" placeholder="Contact attempts, charges applied…">${escapeHtml(r.remarks)}</textarea></td>
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
      <div class="m-card-field"><label>Guest Name</label><input type="text" value="${escapeHtml(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ns" placeholder="Guest name"></div>
      <div class="m-card-field"><label>Resv. / Room No.</label><input type="text" value="${escapeHtml(r.resv)}" data-id="${r.id}" data-field="resv" data-tbl="ns" placeholder="Resv. / Room no."></div>
      <div class="m-card-field"><label>Arrival Date</label><input type="date" value="${r.arrival||''}" data-id="${r.id}" data-field="arrival" data-tbl="ns"></div>
      <div class="m-card-field"><label>Nights</label><input type="number" min="1" value="${escapeHtml(r.nights)}" data-id="${r.id}" data-field="nights" data-tbl="ns" placeholder="1"></div>
      <div class="m-card-field full"><label>Remarks / Action Taken</label><textarea data-id="${r.id}" data-field="remarks" data-tbl="ns" placeholder="Contact attempts, charges applied…">${escapeHtml(r.remarks)}</textarea></div>
    </div>`;
  return div;
}

function addNoshowRow() { 
  const newRow = emptyNoshow();
  state.noshow.push(newRow); 
  renderNoshowTable(); 
  addActivityLog(`Added no-show record`, 'add');
  pushToHistory();
  autoSave(); 
}

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
    <td><input class="cell-input" value="${escapeHtml(r.room)}" data-id="${r.id}" data-field="room" data-tbl="ic" placeholder="e.g. 412"></td>
    <td><input class="cell-input" value="${escapeHtml(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ic" placeholder="Name / Alias"></td>
    <td><input class="cell-input" type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="ic"></td>
    <td><input class="cell-input" type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="ic"></td>
    <td><textarea class="cell-textarea" data-id="${r.id}" data-field="instructions" data-tbl="ic" placeholder="Special instructions, restrictions…">${escapeHtml(r.instructions)}</textarea></td>
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
      <div class="m-card-field"><label>Room No.</label><input type="text" value="${escapeHtml(r.room)}" data-id="${r.id}" data-field="room" data-tbl="ic" placeholder="e.g. 412"></div>
      <div class="m-card-field"><label>Name / Alias</label><input type="text" value="${escapeHtml(r.name)}" data-id="${r.id}" data-field="name" data-tbl="ic" placeholder="Name or alias"></div>
      <div class="m-card-field"><label>Check-In</label><input type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="ic"></div>
      <div class="m-card-field"><label>Check-Out</label><input type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="ic"></div>
      <div class="m-card-field full"><label>Special Instructions</label><textarea data-id="${r.id}" data-field="instructions" data-tbl="ic" placeholder="Special instructions…">${escapeHtml(r.instructions)}</textarea></div>
    </div>`;
  return div;
}

function addIncognitoRow() { 
  const newRow = emptyIncognito();
  state.incognito.push(newRow); 
  renderIncognitoTable(); 
  addActivityLog(`Added incognito room`, 'add');
  pushToHistory();
  autoSave(); 
}

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
    <td><input class="cell-input" value="${escapeHtml(r.room)}" data-id="${r.id}" data-field="room" data-tbl="pod" placeholder="e.g. 401"></td>
    <td><input class="cell-input" value="${escapeHtml(r.name)}" data-id="${r.id}" data-field="name" data-tbl="pod" placeholder="Guest name"></td>
    <td><input class="cell-input" type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="pod"></td>
    <td><input class="cell-input" type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="pod"></td>
    <td><input class="cell-input" value="${escapeHtml(r.remarks)}" data-id="${r.id}" data-field="remarks" data-tbl="pod" placeholder="Notes…"></td>
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
      <div class="m-card-field"><label>Room No.</label><input type="text" value="${escapeHtml(r.room)}" data-id="${r.id}" data-field="room" data-tbl="pod" placeholder="e.g. 401"></div>
      <div class="m-card-field"><label>Guest Name</label><input type="text" value="${escapeHtml(r.name)}" data-id="${r.id}" data-field="name" data-tbl="pod" placeholder="Guest name"></div>
      <div class="m-card-field"><label>Check-In</label><input type="date" value="${r.checkin||''}" data-id="${r.id}" data-field="checkin" data-tbl="pod"></div>
      <div class="m-card-field"><label>Check-Out</label><input type="date" value="${r.checkout||''}" data-id="${r.id}" data-field="checkout" data-tbl="pod"></div>
      <div class="m-card-field full"><label>Remarks</label><input type="text" value="${escapeHtml(r.remarks)}" data-id="${r.id}" data-field="remarks" data-tbl="pod" placeholder="Notes…"></div>
    </div>`;
  return div;
}

function addPodRow() { 
  const newRow = emptyPod();
  state.pod.push(newRow); 
  renderPodTable(); 
  addActivityLog(`Added POD room`, 'add');
  pushToHistory();
  autoSave(); 
}

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

function renderTable(tableName) {
  const renderers = { ho: renderHandoverTable, ns: renderNoshowTable, ic: renderIncognitoTable, pod: renderPodTable };
  if (renderers[tableName]) renderers[tableName]();
}

// ── Tab navigation ────────────────────────────────────────────
function showTab(tab) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  document.getElementById('tab-'+tab).classList.add('active');
  if (tab === 'summary') renderSummary();
  if (tab === 'log') renderActivityLog();
}

// ── Event listeners ───────────────────────────────────────────
let listenersSetup = false;
function setupListeners() {
  if (listenersSetup) return;
  listenersSetup = true;

  let editTimeout;
  let lastEditValue = {};
  
  document.addEventListener('focusin', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      userIsTyping = true;
      clearTimeout(typingTimer);
    }
  });

  document.addEventListener('focusout', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        userIsTyping = false;
        // Apply any remote update that was held back while user was typing
        if (pendingRemoteState) {
          const held = pendingRemoteState;
          pendingRemoteState = null;
          isLoading = true;
          mergeState(held);
          renderAll();
          isLoading = false;
        }
      }, 2000); // wait 2s after focus leaves before allowing remote re-render
    }
  });

  document.addEventListener('input', e => {
    const el = e.target, id = el.dataset.id, tbl = el.dataset.tbl, field = el.dataset.field;
    // Mark user as actively typing — reset the idle timer
    userIsTyping = true;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      userIsTyping = false;
      if (pendingRemoteState) {
        const held = pendingRemoteState;
        pendingRemoteState = null;
        isLoading = true;
        mergeState(held);
        renderAll();
        isLoading = false;
      }
    }, 2000);

    if (!id || !tbl) return;
    const arr = getTblArray(tbl);
    if (arr) { 
      const row = arr.find(r => r.id === id); 
      if (row) { 
        const oldValue = row[field];
        row[field] = el.value; 
        
        clearTimeout(editTimeout);
        editTimeout = setTimeout(() => {
          const key = `${tbl}_${id}_${field}`;
          if (lastEditValue[key] !== el.value && oldValue !== el.value && !isUndoRedo && !isRestoring) {
            addActivityLog(`Edited ${tableNameToName(tbl)}: ${field} changed`, 'edit');
            lastEditValue[key] = el.value;
          }
        }, 1000);
        
        autoSave(); 
      } 
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.classList.contains('status-sel') || el.classList.contains('ns-status') || el.classList.contains('ic-priority')) {
      const tbl = el.dataset.tbl;
      const arr = getTblArray(tbl);
      if (arr) {
        const row = arr.find(r => r.id === el.dataset.id);
        if (row) {
          const oldVal = row.status || row.priority;
          if (tbl === 'ic') row.priority = el.value;
          else row.status = el.value;
          if (!isUndoRedo && !isRestoring && oldVal !== el.value) {
            addActivityLog(`Changed ${tableNameToName(tbl)} status to "${el.value}"`, 'edit');
          }
          autoSave();
          const s = tbl === 'ic' ? priorityStyle(el.value) : tbl === 'ns' ? noshowStatusStyle(el.value) : statusStyle(el.value);
          el.style.background = s.bg; el.style.color = s.color; el.style.borderColor = s.border;
        }
      }
    }
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const { del: tbl, id } = btn.dataset;
    
    let deletedItem = null;
    let deletedName = '';
    
    if (tbl === 'ho') { 
      deletedItem = state.handover.find(r => r.id === id);
      deletedName = deletedItem?.heartist || (deletedItem?.note ? deletedItem.note.substring(0,30) : 'task');
      state.handover = state.handover.filter(r => r.id !== id);
      renderHandoverTable();
      if (deletedItem) addToTrash('ho', deletedItem);
      addActivityLog(`Deleted handover task: "${deletedName}"`, 'delete');
    }
    if (tbl === 'ns') { 
      deletedItem = state.noshow.find(r => r.id === id);
      deletedName = deletedItem?.name || 'record';
      state.noshow = state.noshow.filter(r => r.id !== id);
      renderNoshowTable();
      if (deletedItem) addToTrash('ns', deletedItem);
      addActivityLog(`Deleted no-show record: "${deletedName}"`, 'delete');
    }
    if (tbl === 'ic') { 
      deletedItem = state.incognito.find(r => r.id === id);
      deletedName = deletedItem?.room || deletedItem?.name || 'incognito room';
      state.incognito = state.incognito.filter(r => r.id !== id);
      renderIncognitoTable();
      if (deletedItem) addToTrash('ic', deletedItem);
      addActivityLog(`Deleted incognito room: "${deletedName}"`, 'delete');
    }
    if (tbl === 'pod') { 
      deletedItem = state.pod.find(r => r.id === id);
      deletedName = deletedItem?.room || deletedItem?.name || 'POD room';
      state.pod = state.pod.filter(r => r.id !== id);
      renderPodTable();
      if (deletedItem) addToTrash('pod', deletedItem);
      addActivityLog(`Deleted POD room: "${deletedName}"`, 'delete');
    }
    
    pushToHistory();
    autoSave();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderHandoverTable(); renderNoshowTable(); renderIncognitoTable(); renderPodTable();
    }, 200);
  });
  
  // Ctrl+Z / Ctrl+Y shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      historyUndo();
    }
    if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      historyRedo();
    }
  });
}

function getTblArray(tbl) {
  if (tbl === 'ho')  return state.handover;
  if (tbl === 'ns')  return state.noshow;
  if (tbl === 'ic')  return state.incognito;
  if (tbl === 'pod') return state.pod;
  return null;
}

// ── Summary ───────────────────────────────────────────────────
function renderSummary() {
  collectAll();
  const el = document.getElementById('summaryContent'); 
  if (!el) return;
  const m = state.meta, k = state.kpis;
  const hotel = currentHotel;

  // Helper to safely get KPI value
  const getKpiVal = (shift, field) => {
    const val = k[shift]?.[field];
    return (val !== undefined && val !== null && val !== '') ? val : 0;
  };

  // Calculate totals safely
  const getTotal = (field) => {
    return (getKpiVal('Morning', field) || 0) + 
           (getKpiVal('Evening', field) || 0) + 
           (getKpiVal('Night', field) || 0);
  };

  const fields = ['walkin', 'ext', 'bb', 'room', 'spark', 'prof', 'enrollment', 'allMembership', 'welcome'];
  const fieldLabels = ['Walk In', 'Extensions', 'B&B Up.', 'Room Up.', 'Sparkles', 'Profiles', 'Enrollment', 'All Memb.', 'Welcome'];

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
          ].map(([l,v])=>`<div class="sum-stat"><div class="sum-stat-label">${l}</div><div class="sum-stat-value">${escapeHtml(v)}</div></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="sum-block">
      <div class="sum-head"><h3>KPI Overview — All Shifts</h3></div>
      <div class="sum-body"><div style="overflow-x:auto">
        <table class="data-table" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:linear-gradient(135deg, var(--navy) 0%, var(--navy3) 100%);">
              <th style="padding:10px; text-align:left; color:rgba(255,255,255,0.7);">Shift</th>
              ${fieldLabels.map(label => `<th style="padding:10px; text-align:center; color:rgba(255,255,255,0.7);">${label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${['Morning','Evening','Night'].map(sh => { 
              const clr = {Morning:'#FEF3C7,#92400E', Evening:'#DBEAFE,#1E40AF', Night:'#EDE9FE,#5B21B6'}[sh].split(',');
              return `<tr style="border-bottom:1px solid var(--surface2);">
                <td style="padding:8px 10px;"><span style="background:${clr[0]};color:${clr[1]};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${sh}</span></td>
                ${fields.map(f => `<td style="padding:8px 10px; text-align:center; font-weight:600">${getKpiVal(sh, f)}</td>`).join('')}
              </tr>`;
            }).join('')}
            <tr style="background:var(--surface);font-weight:700; border-top:1px solid var(--border);">
              <td style="padding:8px 10px; font-weight:800; font-size:12px">TOTAL</td>
              ${fields.map(f => `<td style="padding:8px 10px; text-align:center; color:var(--gold-dim)">${getTotal(f)}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div></div>
    </div>

    <div class="sum-block">
      <div class="sum-head"><h3>Handover Tasks</h3><span class="sum-count">${state.handover.filter(r=>r.note||r.heartist).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Date</th><th>Heartist</th><th>Task</th><th>Update</th><th>Status</th></tr></thead><tbody>
        ${state.handover.filter(r=>r.note||r.heartist).map(r => {
          const ss = statusStyle(r.status);
          return `<tr>
            <td>${fmtDateShort(r.date)}</td>
            <td><strong>${escapeHtml(r.heartist)||'—'}</strong></td>
            <td>${escapeHtml(r.note)||'—'}</td>
            <td>${escapeHtml(r.update)||'—'}</td>
            <td><span style="background:${ss.bg};color:${ss.color};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${r.status}</span></td>
          </tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3);font-style:italic;padding:14px">No tasks recorded</td></tr>'}
      </tbody></table></div></div>
    </div>

    ${state.noshow.filter(r=>r.name||r.resv).length ? `
    <div class="sum-block">
      <div class="sum-head" style="background:linear-gradient(135deg,#7A1010,#991B1B)"><h3 style="color:#FCA5A5">No Shows</h3><span class="sum-count" style="color:rgba(255,255,255,.5)">${state.noshow.filter(r=>r.name||r.resv).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Guest Name</th><th>Resv. / Room</th><th>Arrival</th><th>Nights</th><th>Status</th><th>Remarks</th></tr></thead><tbody>
        ${state.noshow.filter(r=>r.name||r.resv).map(r => {
          const ss = noshowStatusStyle(r.status);
          return `<tr>
            <td><strong>${escapeHtml(r.name)||'—'}</strong></td>
            <td>${escapeHtml(r.resv)||'—'}</td>
            <td>${fmtDateShort(r.arrival)}</td>
            <td>${escapeHtml(r.nights)||'1'}</td>
            <td><span style="background:${ss.bg};color:${ss.color};padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700">${r.status}</span></td>
            <td>${escapeHtml(r.remarks)||'—'}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div></div>
    </div>` : ''}

    ${state.incognito.filter(r=>r.room||r.name).length ? `
    <div class="sum-block">
      <div class="sum-head" style="background:linear-gradient(135deg,#3A0A7A,#5A1A9A)"><h3 style="color:#C4A0F0">Incognito Rooms</h3><span class="sum-count" style="color:rgba(255,255,255,.5)">${state.incognito.filter(r=>r.room||r.name).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Room</th><th>Name / Alias</th><th>Check-In</th><th>Check-Out</th><th>Priority</th><th>Instructions</th></tr></thead><tbody>
        ${state.incognito.filter(r=>r.room||r.name).map(r => {
          const ps = priorityStyle(r.priority);
          return `<tr>
            <td><strong>${escapeHtml(r.room)||'—'}</strong></td>
            <td>${escapeHtml(r.name)||'—'}</td>
            <td>${fmtDateShort(r.checkin)}</td>
            <td>${fmtDateShort(r.checkout)}</td>
            <td><span style="background:${ps.bg};color:${ps.color};padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700">${r.priority}</span></td>
            <td>${escapeHtml(r.instructions)||'—'}</td>
          </tr>`;
        }).join('')}
      </tbody></table></div></div>
    </div>` : ''}

    ${state.pod.filter(r=>r.room||r.name).length ? `
    <div class="sum-block">
      <div class="sum-head"><h3>POD Rooms</h3><span class="sum-count">${state.pod.filter(r=>r.room||r.name).length}</span></div>
      <div class="sum-body"><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>Room</th><th>Guest Name</th><th>Check-In</th><th>Check-Out</th><th>Remarks</th></tr></thead><tbody>
        ${state.pod.filter(r=>r.room||r.name).map(r=>`<tr>
          <td><strong>${escapeHtml(r.room)||'—'}</strong></td>
          <td>${escapeHtml(r.name)||'—'}</td>
          <td>${fmtDateShort(r.checkin)}</td>
          <td>${fmtDateShort(r.checkout)}</td>
          <td>${escapeHtml(r.remarks)||'—'}</td>
        </tr>`).join('')}
      </tbody></table></div></div>
    </div>` : ''}
  `;
}

// ════════════════════════════════════════════════════════════
// PRO PDF EXPORT (with hotel logos embedded)
// ════════════════════════════════════════════════════════════
function exportPDF() {
  collectAll();
  const m = state.meta, k = state.kpis;
  const hotel = currentHotel || { name: 'Hotel', color: '#C8A96E', stars: 5, logo: '' };

  const fmt = iso => { if(!iso) return '—'; const [y,mo,d]=iso.split('-'); const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${parseInt(d)} ${M[parseInt(mo)-1]} ${y}`; };
  const dow = m.date ? new Date(m.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long'}) : '';

  // Helper to safely get KPI value
  const getKpiVal = (shift, field) => {
    const val = k[shift]?.[field];
    return (val !== undefined && val !== null && val !== '') ? val : 0;
  };

  const taskRows = state.handover.filter(r=>r.date||r.heartist||r.note||r.update).map((r,i) => {
    const sc = statusStyle(r.status);
    return `<tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td style="white-space:nowrap">${fmt(r.date)}</td>
      <td><strong>${escapeHtml(r.heartist)||'—'}</strong></td>
      <td>${escapeHtml(r.note)||'—'}</td>
      <td>${escapeHtml(r.update)||'—'}</td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color};border:1pt solid ${sc.border}">${r.status}</span></td>
    </tr>`;
  }).join('');

  const fields = ['walkin','ext','bb','room','spark','prof','enrollment','allMembership','welcome'];
  const fieldLabels = ['Walk In','Extensions','B&B Up.','Room Up.','Sparkles','Profiles','Enrollment','All Memb.','Welcome'];

  const kpiRows = ['Morning','Evening','Night'].map(sh => {
    const C = {Morning:['#FEF3C7','#92400E'],Evening:['#DBEAFE','#1E40AF'],Night:['#EDE9FE','#5B21B6']}[sh];
    return `<tr>
      <td><span class="sbadge" style="background:${C[0]};color:${C[1]}">${sh}</span></td>
      ${fields.map(f => `<td class="c">${getKpiVal(sh, f)}</td>`).join('')}
    </tr>`;
  }).join('');

  const totals = fields.map(f => {
    return getKpiVal('Morning', f) + getKpiVal('Evening', f) + getKpiVal('Night', f);
  }).map(t => `<td class="c"><strong>${t}</strong></td>`).join('');

  const noshowRows = state.noshow.filter(r=>r.name||r.resv).map((r,i) => {
    const sc = noshowStatusStyle(r.status);
    return `<tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td><strong>${escapeHtml(r.name)||'—'}</strong></td>
      <td>${escapeHtml(r.resv)||'—'}</td>
      <td style="white-space:nowrap">${fmt(r.arrival)}</td>
      <td class="c">${escapeHtml(r.nights)||'1'}</td>
      <td>${escapeHtml(r.remarks)||'—'}</td>
      <td><span class="badge" style="background:${sc.bg};color:${sc.color};border:1pt solid ${sc.border}">${r.status}</span></td>
    </tr>`;
  }).join('');

  const incognitoRows = state.incognito.filter(r=>r.room||r.name).map((r,i) => {
    const ps = priorityStyle(r.priority);
    return `<tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td><strong>${escapeHtml(r.room)||'—'}</strong></td>
      <td>${escapeHtml(r.name)||'—'}</td>
      <td style="white-space:nowrap">${fmt(r.checkin)}</td>
      <td style="white-space:nowrap">${fmt(r.checkout)}</td>
      <td><span class="badge" style="background:${ps.bg};color:${ps.color};border:1pt solid ${ps.border}">${r.priority}</span></td>
      <td>${escapeHtml(r.instructions)||'—'}</td>
    </tr>`;
  }).join('');

  const podRows = state.pod.filter(r=>r.room||r.name).map((r,i) => `
    <tr>
      <td class="c" style="color:#8A9BB0">${i+1}</td>
      <td><strong>${escapeHtml(r.room)||'—'}</strong></td>
      <td>${escapeHtml(r.name)||'—'}</td>
      <td style="white-space:nowrap">${fmt(r.checkin)}</td>
      <td style="white-space:nowrap">${fmt(r.checkout)}</td>
      <td>${escapeHtml(r.remarks)||'—'}</td>
    </tr>`).join('');

  const notesHtml = ['morning','evening','night'].filter(s=>state.generalNotes[s]).map(s => {
    const C={morning:['#FEF3C7','#92400E'],evening:['#DBEAFE','#1E40AF'],night:['#EDE9FE','#5B21B6']}[s];
    return `<tr>
      <td style="white-space:nowrap"><span class="sbadge" style="background:${C[0]};color:${C[1]};text-transform:capitalize">${s}</span></td>
      <td style="text-align:left;white-space:pre-wrap;line-height:1.6">${escapeHtml(state.generalNotes[s])}</td>
    </tr>`;
  }).join('');

  const hotelLogoHtml = hotel.logo ? 
    `<img src="${hotel.logo}" style="height:36px;object-fit:contain;filter:brightness(0) invert(1);opacity:.85;" alt="${hotel.name} logo" onerror="this.style.display='none'">` :
    `<span style="font-family:'Playfair Display',serif;font-size:22pt;font-weight:700;">${hotel.name.charAt(0)}</span>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${hotel.name} — Handover ${fmt(m.date)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;font-size:8.5pt;color:#1A1F2E;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:12mm 12mm 15mm 12mm}

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
.h-logo{height:38px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.07);border-radius:8px;padding:4px 8px;border:1px solid rgba(255,255,255,.1);margin-left:10px}
.h-logo img{max-height:28px;width:auto}

.meta{display:grid;grid-template-columns:repeat(6,1fr);gap:4pt;margin-bottom:9pt}
.mt{background:#F8F7F4;border:1pt solid #E6E1D8;border-radius:5pt;padding:6pt 9pt;position:relative;overflow:hidden}
.mt::after{content:'';position:absolute;top:0;left:0;right:0;height:2pt;background:linear-gradient(90deg,${hotel.color},${hotel.color}44)}
.mt .l{font-size:5.5pt;font-weight:700;color:#7A8899;text-transform:uppercase;letter-spacing:.6pt;margin-bottom:2pt}
.mt .v{font-size:8.5pt;font-weight:600;color:#1A1F2E;line-height:1.3}
.mt.hl .v{color:${hotel.color=='#C8A96E'?'#7A5A1A':'#1A3A7A'}}

.sec{margin-bottom:9pt;page-break-inside:avoid}
.sec-hd{display:flex;align-items:center;gap:6pt;margin-bottom:5pt}
.sec-icon{width:18pt;height:18pt;border-radius:4pt;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sec-icon svg{width:11pt;height:11pt}
.sec-title{font-family:'Playfair Display',serif;font-size:13pt;font-weight:700;color:#1A1F2E}
.sec-line{flex:1;height:.75pt;background:linear-gradient(90deg,#E6E1D8,transparent)}
.sec-cnt{font-size:6.5pt;color:#7A8899;background:#F0EDE7;padding:2pt 7pt;border-radius:20pt;border:1pt solid #E6E1D8}

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

.kpi thead tr{background:linear-gradient(135deg,#1A3D8A 0%,#2D5299 100%)}
.kpi-tot td{background:linear-gradient(135deg,#0A0F1E,#1C2840)!important;color:${hotel.color}!important;font-weight:700;font-size:8pt;padding:6pt 7pt}
.kpi-tot td:first-child{border-radius:0 0 0 4pt}
.kpi-tot td:last-child{border-radius:0 0 4pt 0}

.ns-hd{background:linear-gradient(135deg,#7A0A0A 0%,#991B1B 100%)!important}
.ns-hd .sec-title{color:#FCA5A5!important}

.ic-hd{background:linear-gradient(135deg,#2A0A5A 0%,#4C1A8A 100%)!important}
.ic-hd .sec-title{color:#C4A0F0!important}
.ic-watermark{font-size:7pt;font-weight:700;color:#9B2020;background:#FDE8E8;border:1pt solid #F5B0B0;border-radius:4pt;padding:4pt 8pt;display:inline-block;margin-bottom:5pt;text-transform:uppercase;letter-spacing:.5pt}

.badge{display:inline-block;padding:2pt 6pt;border-radius:20pt;font-size:6.5pt;font-weight:700;border:1pt solid transparent;white-space:nowrap}
.sbadge{display:inline-block;padding:2pt 7pt;border-radius:20pt;font-size:6.5pt;font-weight:700}

.div{height:.75pt;background:linear-gradient(90deg,${hotel.color},rgba(200,169,110,.1));margin:8pt 0}

.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:10pt;margin-top:10pt}
.sig-box{border:1pt solid #E6E1D8;border-radius:5pt;padding:9pt 12pt 6pt;background:#FAFAF8;position:relative;overflow:hidden}
.sig-box::before{content:'';position:absolute;top:0;left:0;right:0;height:2pt;background:linear-gradient(90deg,${hotel.color},transparent)}
.sig-lbl{font-size:6pt;font-weight:700;color:#7A8899;text-transform:uppercase;letter-spacing:.5pt;margin-bottom:2pt}
.sig-name{font-family:'Playfair Display',serif;font-size:11pt;font-weight:600;color:#1A1F2E;margin-bottom:9pt}
.sig-line{border-bottom:.75pt solid #B0BCC8;margin-bottom:3pt}
.sig-sub{font-size:6pt;color:#7A8899;text-transform:uppercase;letter-spacing:.4pt}

.footer{margin-top:10pt;padding-top:6pt;border-top:.75pt solid #E6E1D8;display:flex;justify-content:space-between;align-items:center;font-size:6.5pt;color:#7A8899}
.f-brand{display:flex;align-items:center;gap:5pt}
.f-stars{color:${hotel.color};font-size:7.5pt;letter-spacing:2pt}

@media print{body{font-size:8.5pt}.no-print{display:none}}
</style>
</head><body>

<div class="header">
  <div class="header-stripe"></div>
  <div class="header-body">
    <div class="h-brand">
      <div class="h-stars">${'★'.repeat(hotel.stars)}</div>
      <div class="h-name">${hotel.name}</div>
      <div class="h-sub">Front Office — Shift Handover Report</div>
    </div>
    <div style="display:flex;align-items:center;">
      <div class="h-right">
        <div class="h-dow">${dow}</div>
        <div class="h-date">${fmt(m.date)}</div>
        <div class="h-hotel-sub">Confidential document</div>
      </div>
      <div class="h-logo">${hotelLogoHtml}</div>
    </div>
  </div>
</div>

<div class="meta">
  <div class="mt hl"><div class="l">Agent — Handing Over</div><div class="v">${escapeHtml(m.agent)||'—'}</div></div>
  <div class="mt hl"><div class="l">Received By</div><div class="v">${escapeHtml(m.receiver)||'—'}</div></div>
  <div class="mt"><div class="l">From Shift</div><div class="v">${escapeHtml(m.from)||'—'}</div></div>
  <div class="mt"><div class="l">To Shift</div><div class="v">${escapeHtml(m.to)||'—'}</div></div>
  <div class="mt"><div class="l">Date Generated</div><div class="v">${new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</div></div>
  <div class="mt"><div class="l">Time Generated</div><div class="v">${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div></div>
</div>

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

<div class="sec">
  <div class="sec-hd">
    <div class="sec-icon" style="background:#1A3D8A"><svg viewBox="0 0 20 20" fill="none" stroke="#93C5FD" stroke-width="1.5"><path d="M4 15l4-4 3 3 5-6"/></svg></div>
    <div class="sec-title">KPI Overview — All Shifts</div>
    <div class="sec-line"></div>
  </div>
  <div class="tw">
    <table class="kpi">
      <thead><tr><th>Shift</th>${fieldLabels.map(l => `<th class="c">${l}</th>`).join('')}</tr></thead>
      <tbody>
        ${kpiRows}
        <tr class="kpi-tot"><td>TOTAL</td>${totals}</tr>
      </tbody>
    </table>
  </div>
</div>

${noshowRows ? `
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

<div class="sig-row">
  <div class="sig-box">
    <div class="sig-lbl">Handed Over By</div>
    <div class="sig-name">${escapeHtml(m.agent)||'_________________________'}</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &amp; Time</div>
  </div>
  <div class="sig-box">
    <div class="sig-lbl">Received By</div>
    <div class="sig-name">${escapeHtml(m.receiver)||'_________________________'}</div>
    <div class="sig-line"></div>
    <div class="sig-sub">Signature &amp; Time</div>
  </div>
</div>

<div class="footer">
  <div class="f-brand">
    <span class="f-stars">${'★'.repeat(hotel.stars)}</span>
    <span><strong>${hotel.name}</strong> — Front Office Handover Report</span>
  </div>
  <span>${fmt(m.date)} &nbsp;·&nbsp; ${escapeHtml(m.from)} → ${escapeHtml(m.to)}</span>
  <span>Generated ${new Date().toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
</div>

</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked — allow pop-ups and retry', true); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => win.focus();
}

// ── Status / Priority helpers ─────────────────────────────────
function taskStatuses() { return ['Pending','In Progress','Done','Urgent','Follow Up','Info','Cancelled']; }
function noshowStatuses() { return ['No Show','Charged','Waived','Disputed','Refunded','Investigating']; }
function incogPriorities() { return ['VIP','VVIP','Celebrity','Government','Security Risk','Media']; }

function statusStyle(s) {
  const styles = {
    'Pending':     {bg:'#FEF3C7',color:'#92400E',border:'#E2C47A'},
    'In Progress': {bg:'#DBEAFE',color:'#1E3A8A',border:'#93C5FD'},
    'Done':        {bg:'#D1FAE5',color:'#065F46',border:'#6EE7B7'},
    'Urgent':      {bg:'#FEE2E2',color:'#991B1B',border:'#FCA5A5'},
    'Follow Up':   {bg:'#EDE9FE',color:'#4C1D95',border:'#C4B5FD'},
    'Info':        {bg:'#F0F9FF',color:'#075985',border:'#BAE6FD'},
    'Cancelled':   {bg:'#F3F4F6',color:'#4B5563',border:'#D1D5DB'},
  };
  return styles[s] || styles['Pending'];
}

function noshowStatusStyle(s) {
  const styles = {
    'No Show':     {bg:'#FEE2E2',color:'#991B1B',border:'#FCA5A5'},
    'Charged':     {bg:'#D1FAE5',color:'#065F46',border:'#6EE7B7'},
    'Waived':      {bg:'#F3F4F6',color:'#374151',border:'#D1D5DB'},
    'Disputed':    {bg:'#FEF3C7',color:'#92400E',border:'#E2C47A'},
    'Refunded':    {bg:'#DBEAFE',color:'#1E3A8A',border:'#93C5FD'},
    'Investigating':{bg:'#EDE9FE',color:'#4C1D95',border:'#C4B5FD'},
  };
  return styles[s] || styles['No Show'];
}

function priorityStyle(s) {
  const styles = {
    'VIP':          {bg:'#FEF3C7',color:'#92400E',border:'#E2C47A'},
    'VVIP':         {bg:'#FDE8E8',color:'#7A1010',border:'#F5B0B0'},
    'Celebrity':    {bg:'#EDE9FE',color:'#4C1D95',border:'#C4B5FD'},
    'Government':   {bg:'#DBEAFE',color:'#1E3A8A',border:'#93C5FD'},
    'Security Risk':{bg:'#FEE2E2',color:'#991B1B',border:'#FCA5A5'},
    'Media':        {bg:'#F0F9FF',color:'#075985',border:'#BAE6FD'},
  };
  return styles[s] || styles['VIP'];
}

function applyStatusColors() {
  document.querySelectorAll('.status-sel').forEach(sel => {
    const tbl = sel.dataset.tbl;
    let s;
    if (tbl === 'ns') s = noshowStatusStyle(sel.value);
    else if (tbl === 'ic') s = priorityStyle(sel.value);
    else s = statusStyle(sel.value);
    if (s) {
      sel.style.background = s.bg; 
      sel.style.color = s.color; 
      sel.style.borderColor = s.border;
    }
  });
}

function applyIncognitoColors() {
  document.querySelectorAll('.ic-priority').forEach(sel => {
    const ps = priorityStyle(sel.value);
    sel.style.background = ps.bg; 
    sel.style.color = ps.color; 
    sel.style.borderColor = ps.border;
  });
}

// ── Utilities ─────────────────────────────────────────────────
function v(id)          { const el=document.getElementById(id); return el?el.value:''; }
function setVal(id,val) { const el=document.getElementById(id); if(el&&val!=null) el.value=val; }
function escapeHtml(s)  { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function esc(s)         { return escapeHtml(s); }
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
  const sh=hr>=6&&hr<14?'Morning':hr>=14&&hr<22?'Evening':'Night';
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
window.clearHandover    = clearHandover;
window.historyUndo      = historyUndo;
window.historyRedo      = historyRedo;
window.clearActivityLog = clearActivityLog;
window.restoreFromTrash = restoreFromTrash;