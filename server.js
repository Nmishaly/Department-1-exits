'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1); // מאחורי פרוקסי (Fly/הוסטינג) - נדרש לעוגיות Secure

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// אימות - סיסמה משותפת אחת למפקדים
// ---------------------------------------------------------------------------
const APP_PASSWORD = process.env.APP_PASSWORD || 'mahlaka1';
const SESSION_SECRET =
  process.env.SESSION_SECRET || 'dev-insecure-secret-change-in-production';
const COOKIE_NAME = 'auth';
const MAX_AGE_DAYS = 30;
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD) {
  if (!process.env.APP_PASSWORD) {
    console.warn('אזהרה: APP_PASSWORD לא הוגדר - נעשה שימוש בסיסמת ברירת המחדל!');
  }
  if (!process.env.SESSION_SECRET) {
    console.warn('אזהרה: SESSION_SECRET לא הוגדר - חובה להגדיר אותו בסביבת פרודקשן!');
  }
}

function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function makeToken() {
  const iat = String(Date.now());
  return `${iat}.${sign(iat)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const iat = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(iat);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const iatNum = Number(iat);
  if (!Number.isFinite(iatNum)) return false;
  return Date.now() - iatNum <= MAX_AGE_DAYS * 86400000;
}

// השוואת סיסמאות בזמן קבוע (מונע דליפת מידע דרך זמני תגובה)
function passwordMatches(input) {
  if (typeof input !== 'string') return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setAuthCookie(res, token, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (IS_PROD || process.env.SECURE_COOKIE === '1') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!passwordMatches(password)) {
    return res.status(401).json({ error: 'סיסמה שגויה' });
  }
  setAuthCookie(res, makeToken(), MAX_AGE_DAYS * 86400);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  setAuthCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: verifyToken(parseCookies(req)[COOKIE_NAME]) });
});

// שמירה על כל שאר נתיבי ה-API מאחורי התחברות
app.use('/api', (req, res, next) => {
  if (['/login', '/logout', '/session'].includes(req.path)) return next();
  if (verifyToken(parseCookies(req)[COOKIE_NAME])) return next();
  return res.status(401).json({ error: 'נדרשת התחברות' });
});

// ---------------------------------------------------------------------------
// עזרי תאריכים (כל התאריכים בפורמט YYYY-MM-DD, טווחים כוללים)
// ---------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// מספר הימים בטווח (כולל את שני הקצוות)
function daysInRange(start, end) {
  const a = new Date(start + 'T00:00:00Z').getTime();
  const b = new Date(end + 'T00:00:00Z').getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

// כל התאריכים בטווח כמערך של מחרוזות
function datesInRange(start, end) {
  const out = [];
  let t = new Date(start + 'T00:00:00Z').getTime();
  const b = new Date(end + 'T00:00:00Z').getTime();
  while (t <= b) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

// ---------------------------------------------------------------------------
// שאילתות מוכנות
// ---------------------------------------------------------------------------
const q = {
  soldiers: db.prepare(
    `SELECT id, first_name, last_name FROM soldiers`
  ),
  soldierById: db.prepare(`SELECT id, first_name, last_name FROM soldiers WHERE id = ?`),
  approvedBySoldier: db.prepare(
    `SELECT start_date, end_date FROM requests
     WHERE soldier_id = ? AND status = 'approved'`
  ),
  allRequests: db.prepare(
    `SELECT r.*, s.first_name, s.last_name
     FROM requests r JOIN soldiers s ON s.id = r.soldier_id`
  ),
  requestsOnDate: db.prepare(
    `SELECT r.*, s.first_name, s.last_name
     FROM requests r JOIN soldiers s ON s.id = r.soldier_id
     WHERE r.start_date <= ? AND r.end_date >= ?`
  ),
  requestsInSpan: db.prepare(
    `SELECT r.*, s.first_name, s.last_name
     FROM requests r JOIN soldiers s ON s.id = r.soldier_id
     WHERE r.start_date <= ? AND r.end_date >= ?`
  ),
  requestById: db.prepare(`SELECT * FROM requests WHERE id = ?`),
  insertRequest: db.prepare(
    `INSERT INTO requests (soldier_id, start_date, end_date, status, note)
     VALUES (?, ?, ?, 'pending', ?)`
  ),
  updateStatus: db.prepare(`UPDATE requests SET status = ? WHERE id = ?`),
  deleteRequest: db.prepare(`DELETE FROM requests WHERE id = ?`),
  deptExits: db.prepare(`SELECT id, start_date, end_date, label FROM department_exits ORDER BY start_date`),
  deptOnDate: db.prepare(
    `SELECT id, start_date, end_date, label FROM department_exits
     WHERE start_date <= ? AND end_date >= ?`
  ),
};

// מיון לפי שם משפחה (עברית), ואז שם פרטי
const heCollator = new Intl.Collator('he');
function sortByLastName(list) {
  return list.slice().sort((a, b) => {
    const byLast = heCollator.compare(a.last_name, b.last_name);
    if (byLast !== 0) return byLast;
    return heCollator.compare(a.first_name, b.first_name);
  });
}

function fullName(s) {
  return `${s.first_name} ${s.last_name}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// רשימת החיילים (ממוינת לפי שם משפחה) + סך ימי היציאה האישית שאושרו לכל חייל
app.get('/api/soldiers', (req, res) => {
  const soldiers = sortByLastName(q.soldiers.all());
  const result = soldiers.map((s) => {
    const approved = q.approvedBySoldier.all(s.id);
    const days = new Set();
    for (const r of approved) {
      for (const d of datesInRange(r.start_date, r.end_date)) days.add(d);
    }
    return {
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      full_name: fullName(s),
      days_out: days.size,
    };
  });
  res.json(result);
});

// כל היציאות המחלקתיות
app.get('/api/department-exits', (req, res) => {
  res.json(q.deptExits.all());
});

// כל הבקשות, ממוינות: מחלקה קודם לפי שם משפחה ואז לפי תאריך
app.get('/api/requests', (req, res) => {
  const { status, date } = req.query;
  let rows = date && isValidDate(date)
    ? q.requestsOnDate.all(date, date)
    : q.allRequests.all();
  if (status) rows = rows.filter((r) => r.status === status);
  rows = rows.map(enrichRequest);
  rows.sort((a, b) => {
    const byLast = heCollator.compare(a.last_name, b.last_name);
    if (byLast !== 0) return byLast;
    return a.start_date.localeCompare(b.start_date);
  });
  res.json(rows);
});

function enrichRequest(r) {
  return {
    id: r.id,
    soldier_id: r.soldier_id,
    first_name: r.first_name,
    last_name: r.last_name,
    full_name: `${r.first_name} ${r.last_name}`,
    start_date: r.start_date,
    end_date: r.end_date,
    days: daysInRange(r.start_date, r.end_date),
    status: r.status,
    note: r.note || '',
    created_at: r.created_at,
  };
}

// יצירת בקשת יציאה (יום בודד או טווח). נוצרת תמיד כ"בטיפול"
app.post('/api/requests', (req, res) => {
  const { soldier_id, start_date } = req.body || {};
  let { end_date, note } = req.body || {};
  if (!end_date) end_date = start_date;

  if (!Number.isInteger(soldier_id)) {
    return res.status(400).json({ error: 'חסר מזהה חייל תקין' });
  }
  if (!q.soldierById.get(soldier_id)) {
    return res.status(404).json({ error: 'חייל לא נמצא' });
  }
  if (!isValidDate(start_date) || !isValidDate(end_date)) {
    return res.status(400).json({ error: 'תאריך לא תקין (נדרש YYYY-MM-DD)' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'תאריך הסיום מוקדם מתאריך ההתחלה' });
  }

  const info = q.insertRequest.run(
    soldier_id,
    start_date,
    end_date,
    typeof note === 'string' ? note.trim() : null
  );
  const created = q.requestById.get(info.lastInsertRowid);
  const soldier = q.soldierById.get(soldier_id);
  const enriched = enrichRequest({
    ...created,
    first_name: soldier.first_name,
    last_name: soldier.last_name,
  });
  res.status(201).json(enriched);
});

// שינוי סטטוס בקשה (אישור / דחייה / חזרה לטיפול) - חל על כל הטווח
app.patch('/api/requests/:id', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const valid = ['pending', 'approved', 'rejected'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'סטטוס לא תקין' });
  }
  const existing = q.requestById.get(id);
  if (!existing) return res.status(404).json({ error: 'בקשה לא נמצאה' });
  q.updateStatus.run(status, id);
  const updated = q.requestById.get(id);
  const soldier = q.soldierById.get(updated.soldier_id);
  res.json(enrichRequest({
    ...updated,
    first_name: soldier.first_name,
    last_name: soldier.last_name,
  }));
});

// מחיקת בקשה - חל על כל הטווח
app.delete('/api/requests/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = q.requestById.get(id);
  if (!existing) return res.status(404).json({ error: 'בקשה לא נמצאה' });
  q.deleteRequest.run(id);
  res.json({ ok: true });
});

// סיכום יום מסוים: מי בחוץ, כמה נשארים, האם יציאה מחלקתית
app.get('/api/day/:date', (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'תאריך לא תקין' });
  }
  const totalSoldiers = q.soldiers.all().length;
  const dept = q.deptOnDate.all(date, date);
  const isDeptExit = dept.length > 0;

  const requests = q.requestsOnDate.all(date, date).map(enrichRequest);
  requests.sort((a, b) => heCollator.compare(a.last_name, b.last_name));

  // חיילים בחוץ = יציאה אישית שאושרה ליום זה (או כל המחלקה ביום יציאה מחלקתית)
  const approvedIds = new Set(
    requests.filter((r) => r.status === 'approved').map((r) => r.soldier_id)
  );

  let outCount;
  let remainingCount;
  if (isDeptExit) {
    outCount = totalSoldiers;
    remainingCount = 0;
  } else {
    outCount = approvedIds.size;
    remainingCount = totalSoldiers - outCount;
  }

  res.json({
    date,
    total: totalSoldiers,
    out: outCount,
    remaining: remainingCount,
    is_department_exit: isDeptExit,
    department_labels: dept.map((d) => d.label).filter(Boolean),
    requests,
  });
});

// נתוני חודש עבור לוח השנה: לכל יום סוג/מונים
app.get('/api/calendar', (req, res) => {
  const month = req.query.month; // YYYY-MM
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'פרמטר month נדרש בפורמט YYYY-MM' });
  }
  const [y, m] = month.split('-').map(Number);
  const firstDay = `${month}-01`;
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = `${month}-${String(lastDayNum).padStart(2, '0')}`;
  const totalSoldiers = q.soldiers.all().length;

  // בקשות שנוגעות בחודש זה
  const monthRequests = q.requestsInSpan.all(lastDay, firstDay).map(enrichRequest);
  const deptRanges = q.deptExits.all();

  const days = {};
  for (let d = 1; d <= lastDayNum; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    days[date] = {
      date,
      is_department_exit: false,
      department_labels: [],
      approved: 0,
      pending: 0,
      rejected: 0,
      out: 0,
      remaining: totalSoldiers,
    };
  }

  for (const dr of deptRanges) {
    for (const date of datesInRange(dr.start_date, dr.end_date)) {
      if (days[date]) {
        days[date].is_department_exit = true;
        if (dr.label) days[date].department_labels.push(dr.label);
      }
    }
  }

  for (const r of monthRequests) {
    for (const date of datesInRange(r.start_date, r.end_date)) {
      if (!days[date]) continue;
      if (r.status === 'approved') days[date].approved++;
      else if (r.status === 'pending') days[date].pending++;
      else if (r.status === 'rejected') days[date].rejected++;
    }
  }

  for (const date of Object.keys(days)) {
    const day = days[date];
    if (day.is_department_exit) {
      day.out = totalSoldiers;
      day.remaining = 0;
    } else {
      day.out = day.approved;
      day.remaining = totalSoldiers - day.approved;
    }
  }

  res.json({ month, total: totalSoldiers, days: Object.values(days) });
});

// דף הבית
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`יציאות מחלקה 1 - השרת פועל על http://localhost:${PORT}`);
});
