'use strict';

// ---------------------------------------------------------------------------
// עזרי כלליים
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const STATUS_LABEL = { pending: 'בטיפול', approved: 'מאושר', rejected: 'לא מאושר' };

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// המרת YYYY-MM-DD לתצוגה DD.MM.YYYY
function fmtDate(s) {
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}
function fmtRange(start, end) {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

async function api(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401) {
    showLogin();
    throw new Error((data && data.error) || 'נדרשת התחברות');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || 'שגיאת שרת');
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

// ---------------------------------------------------------------------------
// מצב
// ---------------------------------------------------------------------------
const state = {
  soldiers: [],
  calMonth: new Date(),   // מייצג את החודש המוצג
  today: ymd(new Date()),
};

// ---------------------------------------------------------------------------
// לשוניות
// ---------------------------------------------------------------------------
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('is-active'));
    $$('.tab-panel').forEach((p) => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    $(`#tab-${tab.dataset.tab}`).classList.add('is-active');
    if (tab.dataset.tab === 'requests') loadRequests();
    if (tab.dataset.tab === 'roster') loadRoster();
    if (tab.dataset.tab === 'calendar') loadCalendar();
  });
});

// ---------------------------------------------------------------------------
// לוח שנה
// ---------------------------------------------------------------------------
async function loadCalendar() {
  const y = state.calMonth.getFullYear();
  const m = state.calMonth.getMonth(); // 0-11
  const monthStr = `${y}-${pad(m + 1)}`;
  $('#cal-title').textContent = `${HE_MONTHS[m]} ${y}`;

  let data;
  try {
    data = await api(`/api/calendar?month=${monthStr}`);
  } catch (e) {
    toast(e.message);
    return;
  }

  const byDate = {};
  data.days.forEach((d) => { byDate[d.date] = d; });

  const grid = $('#cal-grid');
  grid.innerHTML = '';

  const firstDow = new Date(y, m, 1).getDay(); // 0=ראשון
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // תאים ריקים עד היום הראשון
  for (let i = 0; i < firstDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell empty';
    grid.appendChild(cell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${monthStr}-${pad(day)}`;
    const info = byDate[date];
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    if (info && info.is_department_exit) cell.classList.add('dept');
    if (date === state.today) cell.classList.add('today');

    const num = document.createElement('div');
    num.className = 'cal-daynum';
    num.textContent = day;
    cell.appendChild(num);

    const dots = document.createElement('div');
    dots.className = 'cal-dots';
    if (info && !info.is_department_exit) {
      if (info.approved > 0) dots.appendChild(mkDot('approved'));
      if (info.pending > 0) dots.appendChild(mkDot('pending'));
    }
    cell.appendChild(dots);

    const count = document.createElement('div');
    count.className = 'cal-count';
    if (info && info.is_department_exit) {
      count.textContent = 'כל המחלקה';
    } else if (info && info.out > 0) {
      count.textContent = `${info.out} בחוץ`;
    }
    cell.appendChild(count);

    cell.addEventListener('click', () => openDay(date));
    grid.appendChild(cell);
  }
}

function mkDot(kind) {
  const d = document.createElement('span');
  d.className = `mini-dot ${kind}`;
  return d;
}

$('#cal-prev').addEventListener('click', () => {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
  loadCalendar();
});
$('#cal-next').addEventListener('click', () => {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
  loadCalendar();
});

// ---------------------------------------------------------------------------
// מודאל סיכום יום
// ---------------------------------------------------------------------------
let currentDay = null;

async function openDay(date) {
  currentDay = date;
  let data;
  try {
    data = await api(`/api/day/${date}`);
  } catch (e) {
    toast(e.message);
    return;
  }

  $('#day-title').textContent = fmtDate(date);

  const summary = $('#day-summary');
  summary.innerHTML = '';
  summary.appendChild(mkStat('out', data.out, 'בחוץ'));
  summary.appendChild(mkStat('remaining', data.remaining, 'נשארים'));

  // באנר יציאה מחלקתית - מוסר קודם כדי למנוע כפילות
  cleanupDeptBanner();
  if (data.is_department_exit) {
    const banner = document.createElement('div');
    banner.className = 'dept-banner';
    banner.id = 'active-dept-banner';
    banner.textContent = data.department_labels.length
      ? `יציאה מחלקתית — ${data.department_labels.join(', ')}`
      : 'יציאה מחלקתית — כל המחלקה בחוץ';
    summary.parentNode.insertBefore(banner, summary);
  }

  const reqWrap = $('#day-requests');
  reqWrap.innerHTML = '';
  if (data.requests.length === 0) {
    reqWrap.innerHTML = '<p class="empty-msg">אין בקשות יציאה אישיות ליום זה.</p>';
  } else {
    data.requests.forEach((r) => reqWrap.appendChild(renderRequestCard(r, () => openDay(date))));
  }

  $('#day-backdrop').hidden = false;
}

function cleanupDeptBanner() {
  const old = $('#active-dept-banner');
  if (old) old.remove();
  // גם באנרים ללא id (מאיטרציה קודמת) - מנקים
  $$('.dept-banner').forEach((b) => { if (b.id !== 'active-dept-banner') b.remove(); });
}

function mkStat(kind, num, label) {
  const el = document.createElement('div');
  el.className = `day-stat ${kind}`;
  el.innerHTML = `<div class="num">${num}</div><div class="label">${label}</div>`;
  return el;
}

$('#day-close').addEventListener('click', () => {
  $('#day-backdrop').hidden = true;
  cleanupDeptBanner();
});
$('#day-add').addEventListener('click', () => {
  $('#day-backdrop').hidden = true;
  cleanupDeptBanner();
  openRequestModal(currentDay);
});

// ---------------------------------------------------------------------------
// כרטיס בקשה (משמש גם ברשימה וגם בסיכום יום)
// ---------------------------------------------------------------------------
function renderRequestCard(r, onChange) {
  const card = document.createElement('div');
  card.className = `req-card ${r.status}`;

  const name = document.createElement('div');
  name.className = `req-name ${r.status}`;
  name.textContent = r.full_name;
  card.appendChild(name);

  const dates = document.createElement('div');
  dates.className = 'req-dates';
  const dayWord = r.days > 1 ? `${r.days} ימים` : 'יום אחד';
  dates.textContent = `${fmtRange(r.start_date, r.end_date)} · ${dayWord} · ${STATUS_LABEL[r.status]}`;
  card.appendChild(dates);

  if (r.note) {
    const note = document.createElement('div');
    note.className = 'req-note';
    note.textContent = r.note;
    card.appendChild(note);
  }

  const actions = document.createElement('div');
  actions.className = 'req-actions';

  if (r.status !== 'approved') {
    actions.appendChild(mkAction('אישור', 'act-approve', () => setStatus(r.id, 'approved', onChange)));
  }
  if (r.status !== 'rejected') {
    actions.appendChild(mkAction('לא לאשר', 'act-reject', () => setStatus(r.id, 'rejected', onChange)));
  }
  if (r.status !== 'pending') {
    actions.appendChild(mkAction('החזר לטיפול', 'act-pending', () => setStatus(r.id, 'pending', onChange)));
  }
  actions.appendChild(mkAction('מחיקה', 'act-delete', () => deleteRequest(r.id, onChange)));

  card.appendChild(actions);
  return card;
}

function mkAction(label, cls, handler) {
  const b = document.createElement('button');
  b.className = `act-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', handler);
  return b;
}

async function setStatus(id, status, onChange) {
  try {
    await api(`/api/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(`הבקשה עודכנה: ${STATUS_LABEL[status]}`);
    if (onChange) onChange();
  } catch (e) { toast(e.message); }
}

async function deleteRequest(id, onChange) {
  if (!confirm('למחוק את הבקשה על כל הטווח שלה?')) return;
  try {
    await api(`/api/requests/${id}`, { method: 'DELETE' });
    toast('הבקשה נמחקה');
    if (onChange) onChange();
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------------------
// לשונית בקשות
// ---------------------------------------------------------------------------
async function loadRequests() {
  let all;
  try {
    all = await api('/api/requests');
  } catch (e) { toast(e.message); return; }

  const groups = { pending: [], approved: [], rejected: [] };
  all.forEach((r) => groups[r.status].push(r));

  fillReqList('#list-pending', groups.pending, 'אין בקשות בטיפול.');
  fillReqList('#list-approved', groups.approved, 'אין יציאות מאושרות.');
  fillReqList('#list-rejected', groups.rejected, 'אין בקשות שלא אושרו.');
}

function fillReqList(sel, list, emptyMsg) {
  const wrap = $(sel);
  wrap.innerHTML = '';
  if (list.length === 0) {
    wrap.innerHTML = `<p class="empty-msg">${emptyMsg}</p>`;
    return;
  }
  list.forEach((r) => wrap.appendChild(renderRequestCard(r, loadRequests)));
}

// ---------------------------------------------------------------------------
// לשונית רשימת שמות
// ---------------------------------------------------------------------------
async function loadRoster() {
  let soldiers;
  try {
    soldiers = await api('/api/soldiers');
  } catch (e) { toast(e.message); return; }
  state.soldiers = soldiers;

  const wrap = $('#roster-list');
  wrap.innerHTML = '';
  soldiers.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'roster-row';

    // בניית השם עם textContent (בטוח מפני HTML בשמות שהוזנו ידנית)
    const name = document.createElement('div');
    name.className = 'roster-name';
    name.appendChild(document.createTextNode(s.last_name + ' '));
    const first = document.createElement('span');
    first.className = 'first';
    first.textContent = s.first_name;
    name.appendChild(first);
    row.appendChild(name);

    const right = document.createElement('div');
    right.className = 'roster-right';

    const days = document.createElement('div');
    days.className = 'roster-days' + (s.days_out === 0 ? ' zero' : '');
    days.textContent = s.days_out === 1 ? 'יום 1' : `${s.days_out} ימים`;
    right.appendChild(days);

    const edit = document.createElement('button');
    edit.className = 'roster-act edit';
    edit.title = 'עריכת שם';
    edit.setAttribute('aria-label', `עריכת השם של ${s.full_name}`);
    edit.textContent = '✎';
    edit.addEventListener('click', () => openSoldierModal(s));
    right.appendChild(edit);

    const del = document.createElement('button');
    del.className = 'roster-act delete';
    del.title = 'הסרת חייל';
    del.setAttribute('aria-label', `הסרת ${s.full_name}`);
    del.textContent = '🗑';
    del.addEventListener('click', () => deleteSoldier(s));
    right.appendChild(del);

    row.appendChild(right);
    wrap.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// הוספה / עריכה / הסרה של חיילים
// ---------------------------------------------------------------------------
let editingSoldierId = null;

function openSoldierModal(soldier) {
  editingSoldierId = soldier ? soldier.id : null;
  $('#soldier-title').textContent = soldier ? 'עריכת שם חייל' : 'הוספת חייל';
  $('#s-first').value = soldier ? soldier.first_name : '';
  $('#s-last').value = soldier ? soldier.last_name : '';
  $('#soldier-error').hidden = true;
  $('#soldier-backdrop').hidden = false;
  $('#s-first').focus();
}

$('#add-soldier-btn').addEventListener('click', () => openSoldierModal(null));
$('#soldier-cancel').addEventListener('click', () => { $('#soldier-backdrop').hidden = true; });

$('#soldier-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#soldier-error');
  errEl.hidden = true;

  const first_name = $('#s-first').value.trim();
  const last_name = $('#s-last').value.trim();
  if (!first_name || !last_name) {
    errEl.textContent = 'יש להזין שם פרטי ושם משפחה';
    errEl.hidden = false;
    return;
  }

  try {
    if (editingSoldierId) {
      await api(`/api/soldiers/${editingSoldierId}`, {
        method: 'PATCH',
        body: JSON.stringify({ first_name, last_name }),
      });
      toast('שם החייל עודכן');
    } else {
      await api('/api/soldiers', {
        method: 'POST',
        body: JSON.stringify({ first_name, last_name }),
      });
      toast('החייל נוסף לרשימה');
    }
    $('#soldier-backdrop').hidden = true;
    state.soldiers = []; // ניקוי מטמון כדי לשמור סנכרון (טופס בקשה, לוח שנה)
    await loadRoster();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

async function deleteSoldier(s) {
  const extra = s.requests_count > 0
    ? `\n\nשים לב: פעולה זו תמחק גם ${s.requests_count} בקשות/יציאות המשויכות לחייל.`
    : '';
  if (!confirm(`להסיר את ${s.full_name} מהרשימה?${extra}`)) return;
  try {
    const res = await api(`/api/soldiers/${s.id}`, { method: 'DELETE' });
    toast(res && res.deleted_requests
      ? `החייל הוסר (נמחקו גם ${res.deleted_requests} בקשות)`
      : 'החייל הוסר מהרשימה');
    state.soldiers = []; // ניקוי מטמון כדי לשמור סנכרון
    await loadRoster();
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------------------
// מודאל הוספת בקשה
// ---------------------------------------------------------------------------
async function ensureSoldiers() {
  if (state.soldiers.length === 0) {
    state.soldiers = await api('/api/soldiers');
  }
  return state.soldiers;
}

async function openRequestModal(presetDate) {
  await ensureSoldiers();
  const sel = $('#f-soldier');
  sel.innerHTML = '';
  state.soldiers.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.last_name} ${s.first_name}`;
    sel.appendChild(opt);
  });

  const start = presetDate || state.today;
  $('#f-start').value = start;
  $('#f-end').value = start;
  $('#f-note').value = '';
  $('#form-error').hidden = true;
  // איפוס מצב ל"יום בודד"
  $$('input[name="mode"]').forEach((r) => { r.checked = r.value === 'single'; });
  applyMode('single');

  $('#modal-backdrop').hidden = false;
}

function applyMode(mode) {
  const endWrap = $('#f-end-wrap');
  const startLabel = $('#f-start-label');
  if (mode === 'range') {
    endWrap.hidden = false;
    startLabel.textContent = 'מתאריך';
  } else {
    endWrap.hidden = true;
    startLabel.textContent = 'תאריך';
  }
}

$$('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => applyMode(radio.value));
});

$('#add-request-btn').addEventListener('click', () => openRequestModal());
$('#modal-cancel').addEventListener('click', () => { $('#modal-backdrop').hidden = true; });

$('#request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#form-error');
  errEl.hidden = true;

  const mode = $$('input[name="mode"]').find((r) => r.checked).value;
  const soldier_id = Number($('#f-soldier').value);
  const start_date = $('#f-start').value;
  const end_date = mode === 'range' ? ($('#f-end').value || start_date) : start_date;
  const note = $('#f-note').value.trim();

  if (!start_date) {
    errEl.textContent = 'יש לבחור תאריך';
    errEl.hidden = false;
    return;
  }
  if (mode === 'range' && end_date < start_date) {
    errEl.textContent = 'תאריך הסיום מוקדם מתאריך ההתחלה';
    errEl.hidden = false;
    return;
  }

  try {
    await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ soldier_id, start_date, end_date, note }),
    });
    $('#modal-backdrop').hidden = true;
    toast('בקשת היציאה נוספה (בטיפול)');
    // רענון התצוגה הפעילה
    loadCalendar();
    if ($('#tab-requests').classList.contains('is-active')) loadRequests();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

// סגירת מודאל בלחיצה על הרקע
$$('.modal-backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => {
    if (e.target === bd) {
      bd.hidden = true;
      cleanupDeptBanner();
    }
  });
});

// ---------------------------------------------------------------------------
// התחברות
// ---------------------------------------------------------------------------
function showLogin() {
  $('#login-screen').hidden = false;
  $('#logout-btn').hidden = true;
  const pw = $('#login-password');
  if (pw) { pw.value = ''; pw.focus(); }
}

function hideLogin() {
  $('#login-screen').hidden = true;
  $('#logout-btn').hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#login-error');
  errEl.hidden = true;
  const password = $('#login-password').value;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    hideLogin();
    await startApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  state.soldiers = [];
  showLogin();
});

// ---------------------------------------------------------------------------
// אתחול
// ---------------------------------------------------------------------------
async function startApp() {
  try {
    state.soldiers = await api('/api/soldiers');
  } catch (e) { return; /* אם 401 - מסך ההתחברות כבר מוצג */ }
  hideLogin();
  loadCalendar();
}

(async function init() {
  let session;
  try {
    session = await api('/api/session');
  } catch (e) {
    session = { authenticated: false };
  }
  if (session && session.authenticated) {
    await startApp();
  } else {
    showLogin();
  }
})();
