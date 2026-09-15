'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// סכימה
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS soldiers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name  TEXT NOT NULL,
    last_name   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    soldier_id  INTEGER NOT NULL,
    start_date  TEXT NOT NULL,          -- YYYY-MM-DD
    end_date    TEXT NOT NULL,          -- YYYY-MM-DD (כולל)
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (soldier_id) REFERENCES soldiers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS department_exits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date  TEXT NOT NULL,
    end_date    TEXT NOT NULL,
    label       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_requests_dates ON requests(start_date, end_date);
  CREATE INDEX IF NOT EXISTS idx_requests_soldier ON requests(soldier_id);
`);

// ---------------------------------------------------------------------------
// נתוני זריעה (seed) - רצים פעם אחת בלבד, בהתבסס על טבלה ריקה
// ---------------------------------------------------------------------------

// רשימת החיילים (שם פרטי / שם משפחה). המספרים המקוריים הוסרו בכוונה,
// המיון בפועל מתבצע לפי שם משפחה בכל שליפה.
const SOLDIERS = [
  ['גיא', 'כהן'],
  ['גיא', 'בובליל'],
  ['יהושע מרדכי', 'לורך'],
  ['גבריאל', 'סנדי'],
  ['אליעזר', 'יונה'],
  ['אלון', 'כהן'],
  ['הלל', 'גרדי'],
  ['ניב', 'מנצור'],
  ['נתנאל', 'רוזמרין'],
  ['ניר', 'כורשיד'],
  ['ישי', 'זכאי'],
  ['נתנאל', 'לבן'],
  ['ירין', 'רצון'],
  ['נטע', 'בן שלום'],
  ['יאיר', 'בלוך'],
  ['דניאל', 'אייזנפלד'],
  ['אלישר', 'ידיד'],
  ['אמוץ', 'חברון'],
  ['אסף', 'טוויל'],
  ['יעקב', 'כהן'],
  ['רון', 'שררה'],
  ['ברק', 'פרבר'],
  ['דרור', 'גרניק'],
  ['ניר', 'אמזלג'],
  ['דניאל', 'בלטה'],
  ['דוד', 'שלמה'],
  ['שני', 'קינן'],
  ['מאיר', 'אשר'],
];

// לוח היציאות המחלקתיות (מחלקה 1). תאריכים כ-YYYY-MM-DD, טווח כולל.
const DEPARTMENT_EXITS = [
  ['2026-09-20', '2026-09-23', 'יציאה מחלקתית'],
  ['2026-09-30', '2026-10-07', 'יציאה מחלקתית'],
  ['2026-10-09', '2026-10-11', 'יציאה מחלקתית'],
  ['2026-10-15', '2026-10-18', 'יציאה מחלקתית'],
  ['2026-10-22', '2026-10-25', 'יציאה מחלקתית'],
  ['2026-10-28', '2026-11-04', 'יציאה מחלקתית'],
  ['2026-11-11', '2026-11-18', 'יציאה מחלקתית'],
  ['2026-11-25', '2026-12-01', 'יציאה מחלקתית'],
  ['2026-12-03', '2026-12-03', 'סיום תעסוקה'],
];

const soldierCount = db.prepare('SELECT COUNT(*) AS c FROM soldiers').get().c;
if (soldierCount === 0) {
  const insertSoldier = db.prepare(
    'INSERT INTO soldiers (first_name, last_name) VALUES (?, ?)'
  );
  const seedSoldiers = db.transaction((rows) => {
    for (const [first, last] of rows) insertSoldier.run(first, last);
  });
  seedSoldiers(SOLDIERS);
}

const deptCount = db.prepare('SELECT COUNT(*) AS c FROM department_exits').get().c;
if (deptCount === 0) {
  const insertDept = db.prepare(
    'INSERT INTO department_exits (start_date, end_date, label) VALUES (?, ?, ?)'
  );
  const seedDept = db.transaction((rows) => {
    for (const [s, e, l] of rows) insertDept.run(s, e, l);
  });
  seedDept(DEPARTMENT_EXITS);
}

module.exports = db;
