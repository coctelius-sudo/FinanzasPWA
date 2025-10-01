/* app.js - lógica principal con edición, reconciliación, Excel export y backups automáticos */

// version para bust cache si actualizas -> cambiar también en index.html ?v=...
const APP_VERSION = '1.0.1';

// ----- Helpers -----
const $ = id => document.getElementById(id);
const formatMoney = n => Number(n||0).toLocaleString('es-AR', { style:'currency', currency:'ARS' });

// ----- Storage model -----
const STORAGE_KEY = 'finanzas_pwa_v2';
const BACKUPS_KEY = 'finanzas_pwa_backups_v2';
const defaultData = {
  version: APP_VERSION,
  accounts: [
    { id: 'sueldo', name: 'Sueldo', balance: 0 },
    { id: 'efectivo', name: 'Efectivo', balance: 0 },
    { id: 'tarjeta', name: 'Tarjeta', balance: 0 }
  ],
  categories: [
    'Alimentación', 'Transporte', 'Vivienda', 'Ocio', 'Salud', 'Educación', 'Otros'
  ],
  budget: {
    monthlyIncome: 0,
    monthlyLimit: 0
  },
  transactions: [],
  reminders: []
};

function readData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultData);
    return Object.assign(structuredClone(defaultData), JSON.parse(raw));
  }catch(e){
    console.error('readData', e);
    return structuredClone(defaultData);
  }
}

function saveData(data){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ----- App State -----
let DB = readData();
let charts = { categories: null, evolution: null };

// ----- UI Initialization -----
function init(){
  // Elements
  const btnAdd = $('btn-add');
  const modal = $('modal');
  const modalClose = $('modal-close');
  const formMov = $('form-mov');
  const categoria = $('categoria');
  const cuenta = $('cuenta');
  const fecha = $('fecha');

  // Fill selectors and displays
  fillCategories();
  fillAccounts();
  reconcileBalances();
  refreshDashboard();
  refreshMovimientos();

  // set today's date default
  fecha.value = new Date().toISOString().slice(0,10);

  // Events
  btnAdd.addEventListener('click', () => openModal());
  modalClose.addEventListener('click', closeModal);
  $('btn-config').addEventListener('click', () => { refreshConfigLists(); $('modal-config').classList.remove('hidden'); });
  $('btn-close-config').addEventListener('click', () => $('modal-config').classList.add('hidden'));
  $('btn-clear-data').addEventListener('click', () => {
    if (confirm('Borrar todos los datos? Esta acción es irreversible.')) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(BACKUPS_KEY);
      DB = readData();
      fillCategories(); fillAccounts(); reconcileBalances(); refreshDashboard(); refreshMovimientos(); refreshConfigLists();
    }
  });

  formMov.addEventListener('submit', e => {
    e.preventDefault();
    saveMovimientoFromForm();
  });

  // Config: add category/account
  $('btn-add-category').addEventListener('click', () => {
    const name = $('new-category-name').value.trim();
    if (!name) return alert('Nombre vacío');
    DB.categories.push(name);
    saveData(DB);
    $('new-category-name').value = '';
    fillCategories(); refreshConfigLists(); refreshCharts();
  });

  $('btn-add-account').addEventListener('click', () => {
    const name = $('new-account-name').value.trim();
    if (!name) return alert('Nombre vacío');
    const id = 'acc_' + Date.now();
    DB.accounts.push({ id, name, balance: 0 });
    saveData(DB);
    $('new-account-name').value = '';
    fillAccounts(); refreshConfigLists();
  });

  // Export CSV/XLSX
  $('btn-export').addEventListener('click', exportCSV);
  $('btn-export-xlsx').addEventListener('click', exportXLSX);

  // Account / Income input
  $('input-income').addEventListener('change', () => {
    DB.budget.monthlyIncome = Number($('input-income').value) || 0;
    DB.budget.monthlyLimit = DB.budget.monthlyIncome; // initial: set same
    saveData(DB);
    refreshDashboard();
  });

  // Import file (restore)
  $('import-file').addEventListener('change', handleImportFile);

  // Download all backups
  $('btn-download-all-backups').addEventListener('click', downloadAllBackups);

  // Reminders UI
  refreshConfigLists();

  // Request Notification permission for reminders
  if ('Notification' in window) {
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  // Initial charts
  initCharts();

  // check for due reminders every minute while open
  setInterval(checkRemindersDue, 60_000);
  checkRemindersDue();

  // automatic backups: snapshot every 5 minutes
  setInterval(makeBackupSnapshot, 5 * 60 * 1000);
  // create an initial backup on first run
  makeBackupSnapshot();
}

// ----- Modal handlers -----
function openModal(editId = null){
  $('modal-title').innerText = editId ? 'Editar movimiento' : 'Agregar movimiento';
  $('modal').classList.remove('hidden');
  // fill form for edit
  if (editId) {
    const tx = DB.transactions.find(t => t.id === editId);
    if (!tx) return alert('Movimiento no encontrado');
    $('editingId').value = tx.id;
    $('tipo').value = tx.tipo;
    $('monto').value = tx.monto;
    $('descripcion').value = tx.descripcion || '';
    fillCategories();
    fillAccounts();
    $('categoria').value = tx.categoria;
    $('cuenta').value = tx.cuenta;
    $('fecha').value = tx.fecha;
    $('reminder-due').value = tx.reminderDue || '';
    $('btn-delete').classList.remove('hidden');
    $('btn-delete').onclick = () => {
      if (confirm('Eliminar movimiento?')) {
        DB.transactions = DB.transactions.filter(t => t.id !== tx.id);
        saveData(DB);
        reconcileBalances();
        closeModal();
        refreshMovimientos();
        refreshDashboard();
        refreshCharts();
        refreshConfigLists();
      }
    };
  } else {
    $('form-mov').reset();
    $('editingId').value = '';
    $('fecha').value = new Date().toISOString().slice(0,10);
    fillCategories(); fillAccounts();
    $('btn-delete').classList.add('hidden');
    $('btn-delete').onclick = null;
  }
}

function closeModal(){
  $('modal').classList.add('hidden');
}

// ----- Save / Add movimiento (handles edit) -----
function saveMovimientoFromForm(){
  const editingId = $('editingId').value || null;
  const tipo = $('tipo').value;
  const monto = Number($('monto').value) || 0;
  const descripcion = $('descripcion').value || '';
  const categoria = $('categoria').value;
  const cuenta = $('cuenta').value;
  const fecha = $('fecha').value;
  const reminderDue = $('reminder-due').value || null;

  if (monto <= 0) return alert('Ingrese un monto mayor que 0');

  if (editingId) {
    // edit existing
    const tx = DB.transactions.find(t => t.id === editingId);
    if (!tx) return alert('Movimiento no encontrado');
    tx.tipo = tipo; tx.monto = monto; tx.descripcion = descripcion; tx.categoria = categoria;
    tx.cuenta = cuenta; tx.fecha = fecha; tx.reminderDue = reminderDue;
  } else {
    const tx = {
      id: 'tx_' + Date.now(),
      tipo, monto, descripcion, categoria, cuenta, fecha, createdAt: new Date().toISOString(),
      reminderDue
    };
    DB.transactions.push(tx);
    // if reminder set, push to reminders
    if (reminderDue) {
      DB.reminders.push({ id: 'r_' + Date.now(), txId: tx.id, title: `${tipo === 'gasto' ? 'Pago' : 'Ingreso'}: ${descripcion || categoria}`, due: reminderDue, seen:false});
    }
  }

  saveData(DB);
  reconcileBalances();
  closeModal();
  refreshMovimientos();
  refreshDashboard();
  refreshConfigLists();
  refreshCharts();
}

// ----- UI refresh: categories/accounts -----
function fillCategories(){
  const sel = $('categoria');
  sel.innerHTML = '';
  DB.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
}

function fillAccounts(){
  const sel = $('cuenta');
  sel.innerHTML = '';
  DB.accounts.forEach(a => {
    const o = document.createElement('option');
    o.value = a.id; o.textContent = `${a.name}`;
    sel.appendChild(o);
  });
}

// ----- Reconcile balances from scratch based on transactions -----
function reconcileBalances(){
  // reset balances
  DB.accounts.forEach(a => a.balance = 0);
  // iterate sorted transactions oldest->newest to accumulate balances
  const sorted = [...DB.transactions].sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
  sorted.forEach(tx => {
    const acc = DB.accounts.find(a => a.id === tx.cuenta);
    if (!acc) return;
    acc.balance = (acc.balance || 0) + (tx.tipo === 'ingreso' ? Number(tx.monto) : -Number(tx.monto));
  });
  saveData(DB);
}

// ----- Movements list -----
function refreshMovimientos(){
  const list = $('movimientos-list');
  list.innerHTML = '';
  const txs = [...DB.transactions].sort((a,b)=> new Date(b.fecha) - new Date(a.fecha));
  $('movimiento-count').innerText = txs.length;
  txs.forEach(tx => {
    const el = document.createElement('div');
    el.className = 'p-2 bg-slate-800 rounded flex justify-between items-center';
    const left = document.createElement('div');
    left.innerHTML = `<div class="text-sm text-slate-400">${tx.categoria} • ${tx.descripcion || ''}</div>
                      <div class="text-xs text-slate-400">${tx.fecha}</div>`;
    const right = document.createElement('div');
    right.className = 'text-right';
    right.innerHTML = `<div class="${tx.tipo==='gasto' ? 'text-rose-400' : 'text-emerald-400'} font-semibold">${tx.tipo==='gasto' ? '-' : '+'}${formatMoney(tx.monto)}</div>
                       <div class="text-xs text-slate-400">${DB.accounts.find(a=>a.id===tx.cuenta)?.name || ''}</div>`;
    el.appendChild(left); el.appendChild(right);

    // click to edit
    el.addEventListener('click', () => {
      openModal(tx.id);
    });

    list.appendChild(el);
  });
}

// ----- Dashboard summary -----
function refreshDashboard(){
  const ingresos = DB.transactions.filter(t=>t.tipo==='ingreso').reduce((s,t)=>s + Number(t.monto),0);
  const gastos = DB.transactions.filter(t=>t.tipo==='gasto').reduce((s,t)=>s + Number(t.monto),0);
  const saldo = ingresos - gastos;
  $('saldo').innerText = formatMoney(saldo);
  $('total-ingresos').innerText = formatMoney(ingresos);
  $('total-gastos').innerText = formatMoney(gastos);
  $('presupuesto-display').innerText = formatMoney(DB.budget.monthlyLimit || 0);
}

// ----- Config lists (accounts, categories, reminders, backups) -----
function refreshConfigLists(){
  const accountsList = $('accounts-list');
  const catList = $('categories-list');
  const remList = $('reminders-list');
  const backupsList = $('backups-list');
  accountsList.innerHTML = '';
  catList.innerHTML = '';
  remList.innerHTML = '';
  backupsList.innerHTML = '';

  DB.accounts.forEach(a => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `<div class="flex-1">${a.name}</div>
                     <div class="text-sm text-slate-400">${formatMoney(a.balance)}</div>
                     <button data-id="${a.id}" class="btn-del-account px-2 rounded bg-rose-600">X</button>`;
    accountsList.appendChild(div);
  });

  DB.categories.forEach((c,i) => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2';
    div.innerHTML = `<div class="flex-1">${c}</div>
                    <button data-index="${i}" class="btn-del-cat px-2 rounded bg-rose-600">X</button>`;
    catList.appendChild(div);
  });

  DB.reminders.forEach(r => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between';
    div.innerHTML = `<div>
                       <div class="text-sm">${r.title}</div>
                       <div class="text-xs text-slate-400">${new Date(r.due).toLocaleString()}</div>
                     </div>
                     <div>
                        <button data-id="${r.id}" class="btn-del-rem px-2 rounded bg-rose-600">X</button>
                     </div>`;
    remList.appendChild(div);
  });

  // Backups from localStorage
  const backups = JSON.parse(localStorage.getItem(BACKUPS_KEY) || "[]");
  backups.forEach((b, idx) => {
    const div = document.createElement('div');
    div.className = 'flex items-center justify-between';
    div.innerHTML = `<div>
                       <div class="text-sm">Backup · ${new Date(b.ts).toLocaleString()}</div>
                       <div class="text-xs text-slate-400">${b.note || ''}</div>
                     </div>
                     <div class="flex gap-2">
                        <button data-idx="${idx}" class="btn-download-backup px-2 rounded bg-slate-700">Descargar</button>
                        <button data-idx="${idx}" class="btn-restore-backup px-2 rounded bg-emerald-500">Restaurar</button>
                     </div>`;
    backupsList.appendChild(div);
  });

  // delete handlers
  document.querySelectorAll('.btn-del-account').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    DB.accounts = DB.accounts.filter(a => a.id !== id);
    saveData(DB); fillAccounts(); refreshConfigLists(); refreshMovimientos(); reconcileBalances(); refreshDashboard(); refreshCharts();
  });
  document.querySelectorAll('.btn-del-cat').forEach(b => b.onclick = () => {
    const idx = Number(b.dataset.index);
    if (confirm('Eliminar categoría? los movimientos no se borrarán')) {
      DB.categories.splice(idx,1);
      saveData(DB); fillCategories(); refreshConfigLists(); refreshCharts();
    }
  });
  document.querySelectorAll('.btn-del-rem').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    DB.reminders = DB.reminders.filter(r => r.id !== id);
    saveData(DB); refreshConfigLists();
  });

  // backups buttons
  document.querySelectorAll('.btn-download-backup').forEach(b => b.onclick = (ev) => {
    const idx = Number(ev.target.dataset.idx);
    const backups = JSON.parse(localStorage.getItem(BACKUPS_KEY) || "[]");
    const blob = new Blob([JSON.stringify(backups[idx], null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finanzas-backup-${new Date(backups[idx].ts).toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelectorAll('.btn-restore-backup').forEach(b => b.onclick = (ev) => {
    const idx = Number(ev.target.dataset.idx);
    const backups = JSON.parse(localStorage.getItem(BACKUPS_KEY) || "[]");
    if (!backups[idx]) return alert('Backup no encontrado');
    if (!confirm('Restaurar este backup reemplazará tus datos actuales. Continuar?')) return;
    DB = backups[idx].data;
    saveData(DB);
    reconcileBalances();
    fillCategories(); fillAccounts(); refreshMovimientos(); refreshDashboard(); refreshCharts(); refreshConfigLists();
    alert('Backup restaurado.');
  });

  // fill income input
  $('input-income').value = DB.budget.monthlyIncome || '';
}

// ----- Charts -----
function initCharts(){
  const ctxCat = document.getElementById('chart-categories').getContext('2d');
  const ctxEvo = document.getElementById('chart-evolution').getContext('2d');

  charts.categories = new Chart(ctxCat, {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [] }]},
    options: { plugins: { legend: { labels: { color: '#cbd5e1' } } } }
  });

  charts.evolution = new Chart(ctxEvo, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Balance (mes)', data: [], fill: true }]},
    options: { plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { y: { ticks: { color:'#cbd5e1' } }, x: { ticks: { color:'#cbd5e1' } } } }
  });

  refreshCharts();
}

function refreshCharts(){
  // categories: sum gastos por categoria
  const gastos = DB.transactions.filter(t => t.tipo==='gasto');
  const map = {};
  DB.categories.forEach(c => map[c]=0);
  gastos.forEach(g => { map[g.categoria] = (map[g.categoria]||0) + Number(g.monto); });
  const labels = Object.keys(map);
  const data = labels.map(l => map[l]);

  charts.categories.data.labels = labels;
  charts.categories.data.datasets[0].data = data;
  charts.categories.update();

  // evolution: balance per month (last 6 months)
  const months = [];
  const now = new Date();
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push(key);
  }
  const monthly = months.map(m => {
    const [y,mm] = m.split('-');
    const total = DB.transactions
      .filter(t => t.fecha && t.fecha.slice(0,7) === `${y}-${mm}`)
      .reduce((s,t)=> s + (t.tipo==='ingreso'? Number(t.monto): -Number(t.monto)), 0);
    return total;
  });

  charts.evolution.data.labels = months;
  charts.evolution.data.datasets[0].data = monthly;
  charts.evolution.update();
}

// ----- CSV Export -----
function exportCSV(){
  const rows = [
    ['id','tipo','monto','descripcion','categoria','cuenta','fecha','createdAt','reminderDue']
  ];
  DB.transactions.forEach(t => {
    rows.push([t.id,t.tipo,t.monto,t.descripcion,t.categoria,t.cuenta,t.fecha,t.createdAt,t.reminderDue || '']);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finanzas_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ----- Excel Export (SheetJS) -----
function exportXLSX(){
  try {
    const ws_data = [
      ['id','tipo','monto','descripcion','categoria','cuenta','fecha','createdAt','reminderDue']
    ];
    DB.transactions.forEach(t => ws_data.push([t.id,t.tipo,t.monto,t.descripcion,t.categoria, DB.accounts.find(a=>a.id===t.cuenta)?.name || t.cuenta, t.fecha, t.createdAt, t.reminderDue || '']));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
    const wbout = XLSX.write(wb, {bookType:'xlsx', type:'array'});
    const blob = new Blob([wbout], {type: 'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finanzas_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error exportando Excel: ' + e.message);
  }
}

// ----- Reminders -----
function checkRemindersDue(){
  const now = new Date();
  DB.reminders.forEach(r => {
    if (!r.notified && new Date(r.due) <= now) {
      showReminderNotification(r);
      r.notified = true;
    }
  });
  saveData(DB);
  refreshConfigLists();
}

function showReminderNotification(r){
  if (Notification.permission === 'granted') {
    new Notification(r.title, { body: `Recordatorio: ${new Date(r.due).toLocaleString()}` });
  } else {
    alert(`Recordatorio: ${r.title}\n${new Date(r.due).toLocaleString()}`);
  }
}

// ----- Backups (automatic snapshots stored in localStorage) -----
function makeBackupSnapshot(note = '') {
  try {
    const backups = JSON.parse(localStorage.getItem(BACKUPS_KEY) || "[]");
    const snapshot = { ts: Date.now(), note, data: DB };
    // keep last 20 backups only
    backups.unshift(snapshot);
    while (backups.length > 20) backups.pop();
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups));
    refreshConfigLists();
  } catch (e) {
    console.error('backup failed', e);
  }
}

function downloadAllBackups(){
  const backups = JSON.parse(localStorage.getItem(BACKUPS_KEY) || "[]");
  const blob = new Blob([JSON.stringify(backups, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finanzas-backups-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleImportFile(e){
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const obj = JSON.parse(ev.target.result);
      if (!obj) return alert('Archivo inválido');
      if (!confirm('Restaurar datos desde archivo reemplazará tus datos actuales. Continuar?')) return;
      // If the file contains backups array (from downloadAllBackups) try to restore the latest backup's data
      if (Array.isArray(obj) && obj.length && obj[0].data) {
        DB = obj[0].data;
      } else if (obj.data && obj.ts) {
        DB = obj.data;
      } else {
        DB = obj;
      }
      saveData(DB);
      reconcileBalances();
      fillCategories(); fillAccounts(); refreshMovimientos(); refreshDashboard(); refreshCharts(); refreshConfigLists();
      alert('Importación completa.');
    } catch (err) {
      alert('Error leyendo archivo: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ----- initial run -----
document.addEventListener('DOMContentLoaded', init);
