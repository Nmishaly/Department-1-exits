'use strict';

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('שגיאה: משתנה הסביבה DATABASE_URL אינו מוגדר. ראה .env.example / DEPLOY.md');
  process.exit(1);
}

// חיבור מקומי לא דורש SSL; חיבור מרוחק (Neon וכד') דורש SSL
const isLocal = /(^|@)(localhost|127\.0\.0\.1)/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

// ---------------------------------------------------------------------------
// נתוני זריעה (seed)
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

// ---------------------------------------------------------------------------
// אתחול הסכימה + זריעה (idempotent - בטוח להריץ בכל עלייה)
// ---------------------------------------------------------------------------
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS soldiers (
      id          SERIAL PRIMARY KEY,
      first_name  TEXT NOT NULL,
      last_name   TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id          SERIAL PRIMARY KEY,
      soldier_id  INTEGER NOT NULL REFERENCES soldiers(id) ON DELETE CASCADE,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      note        TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS department_exits (
      id          SERIAL PRIMARY KEY,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      label       TEXT
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_dates ON requests(start_date, end_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_soldier ON requests(soldier_id);`);

  // זריעת חיילים (רק אם הטבלה ריקה)
  const soldierCount = Number((await pool.query('SELECT COUNT(*) AS c FROM soldiers')).rows[0].c);
  if (soldierCount === 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [first, last] of SOLDIERS) {
        await client.query('INSERT INTO soldiers (first_name, last_name) VALUES ($1, $2)', [first, last]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // זריעת יציאות מחלקתיות (רק אם הטבלה ריקה)
  const deptCount = Number((await pool.query('SELECT COUNT(*) AS c FROM department_exits')).rows[0].c);
  if (deptCount === 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [s, e, l] of DEPARTMENT_EXITS) {
        await client.query('INSERT INTO department_exits (start_date, end_date, label) VALUES ($1, $2, $3)', [s, e, l]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = { pool, init };
