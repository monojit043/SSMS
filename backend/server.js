const express = require('express');
const path = require('path');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = express();

app.use(express.json({ limit: '50mb' }));
app.get('/', (req, res) => res.redirect('/Login.html'));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Security: every /api call needs the single sign-on cookie (except login/logout);
// "who did it" fields are always the signed-in user. See middleware/auth.js.
// Stress lines are no longer synced — they are read live from PIMS (db/linkPc2.js).
const { requireAuth, stampIdentity } = require('./middleware/auth');
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', requireAuth, stampIdentity);

app.listen(process.env.PORT, () => {
    console.log(`Server running on http://localhost:${process.env.PORT}`);
});

const masterRoutes = require('./routes/master.routes');
const springRoutes = require('./routes/spring.routes');

// Auto-migrate columns
const pool = require('./db/db');
pool.query(`ALTER TABLE spring_details ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT ''`)
    .catch(err => console.error('Migration error (remarks):', err.message));
pool.query(`ALTER TABLE spring_details ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`)
    .catch(err => console.error('Migration error (created_by):', err.message));
pool.query(`ALTER TABLE spring_details ADD COLUMN IF NOT EXISTS reviewed_by TEXT DEFAULT ''`)
    .catch(err => console.error('Migration error (reviewed_by):', err.message));
pool.query(`ALTER TABLE spring_details ADD COLUMN IF NOT EXISTS review_remarks TEXT DEFAULT ''`)
    .catch(err => console.error('Migration error (review_remarks):', err.message));

const authRoutes = require('./routes/auth.routes');
app.use('/api/auth', authRoutes);

app.use('/api/master', masterRoutes);
app.use('/api/spring', springRoutes);
app.use('/api/team', require('./routes/team.routes'));

const notesRoutes = require('./routes/notes.routes');
app.use('/api/notes', notesRoutes);

pool.query(`CREATE TABLE IF NOT EXISTS spring_notes (
  id         SERIAL PRIMARY KEY,
  job_no     VARCHAR(50)  NOT NULL,
  unit_no    VARCHAR(50)  NOT NULL,
  note_text  TEXT         NOT NULL,
  created_by VARCHAR(100) DEFAULT '',
  role       VARCHAR(20)  DEFAULT '',
  created_at TIMESTAMP    DEFAULT NOW()
)`).catch(err => console.error('Migration error (spring_notes):', err.message));

pool.query(`ALTER TABLE spring_details ADD COLUMN IF NOT EXISTS mr_no VARCHAR(100) DEFAULT ''`)
    .catch(err => console.error('Migration error (mr_no):', err.message));

pool.query(`ALTER TABLE spring_details ADD COLUMN IF NOT EXISTS order_status VARCHAR(50) DEFAULT 'Not Ordered'`)
    .catch(err => console.error('Migration error (order_status):', err.message));
pool.query(`ALTER TABLE spring_notes ADD COLUMN IF NOT EXISTS note_number INTEGER DEFAULT 0`)
    .then(() => pool.query(`
        CREATE OR REPLACE FUNCTION assign_note_number()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.note_number IS NULL OR NEW.note_number = 0 THEN
                SELECT COALESCE(MAX(note_number), 0) + 1
                INTO NEW.note_number
                FROM spring_notes
                WHERE job_no = NEW.job_no AND unit_no = NEW.unit_no;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    `))
    .then(() => pool.query(`DROP TRIGGER IF EXISTS auto_note_number ON spring_notes`))
    .then(() => pool.query(`
        CREATE TRIGGER auto_note_number
        BEFORE INSERT ON spring_notes
        FOR EACH ROW EXECUTE FUNCTION assign_note_number()
    `))
    .then(() => pool.query(`
        UPDATE spring_notes sn
        SET note_number = sub.rn
        FROM (
            SELECT id,
                   COALESCE((
                       SELECT MAX(note_number) FROM spring_notes
                       WHERE job_no = sn2.job_no AND unit_no = sn2.unit_no AND note_number > 0
                   ), 0) + ROW_NUMBER() OVER (PARTITION BY job_no, unit_no ORDER BY created_at ASC, id ASC) AS rn
            FROM spring_notes sn2
            WHERE note_number = 0
        ) sub
        WHERE sn.id = sub.id AND sn.note_number = 0
    `))
    .catch(err => console.error('Migration error (note_number):', err.message));

pool.query(`CREATE TABLE IF NOT EXISTS spring_vendor_data (
  id                  SERIAL PRIMARY KEY,
  spring_id           INTEGER       NOT NULL,
  vendor_name         VARCHAR(200)  DEFAULT '',
  po_no               VARCHAR(100)  DEFAULT '',
  po_date             DATE,
  spring_designation  VARCHAR(200)  DEFAULT '',
  spring_constant     VARCHAR(100)  DEFAULT '',
  preset_load         VARCHAR(100)  DEFAULT '',
  load_variation      VARCHAR(100)  DEFAULT '',
  remarks             TEXT          DEFAULT '',
  created_by          VARCHAR(100)  DEFAULT '',
  created_at          TIMESTAMP     DEFAULT NOW()
)`).catch(err => console.error('Migration error (spring_vendor_data):', err.message));

// Add new technical columns for existing installations
pool.query(`ALTER TABLE spring_vendor_data ADD COLUMN IF NOT EXISTS spring_designation VARCHAR(200) DEFAULT ''`)
    .catch(err => console.error('Migration error (spring_designation):', err.message));
pool.query(`ALTER TABLE spring_vendor_data ADD COLUMN IF NOT EXISTS spring_constant VARCHAR(100) DEFAULT ''`)
    .catch(err => console.error('Migration error (spring_constant):', err.message));
pool.query(`ALTER TABLE spring_vendor_data ADD COLUMN IF NOT EXISTS preset_load VARCHAR(100) DEFAULT ''`)
    .catch(err => console.error('Migration error (preset_load):', err.message));
pool.query(`ALTER TABLE spring_vendor_data ADD COLUMN IF NOT EXISTS load_variation VARCHAR(100) DEFAULT ''`)
    .catch(err => console.error('Migration error (load_variation):', err.message));

pool.query(`CREATE TABLE IF NOT EXISTS spring_bid_data (
  id                   SERIAL PRIMARY KEY,
  spring_tag           TEXT          NOT NULL,
  job_no               TEXT          NOT NULL,
  vendor_name          TEXT          NOT NULL,
  spring_designation   TEXT          DEFAULT '',
  spring_constant      TEXT          DEFAULT '',
  preset_load          TEXT          DEFAULT '',
  load_variation_pct   TEXT          DEFAULT '',
  uploaded_at          TIMESTAMPTZ   DEFAULT NOW(),
  uploaded_by          TEXT          DEFAULT '',
  UNIQUE (spring_tag, vendor_name)
)`).catch(err => console.error('Migration error (spring_bid_data):', err.message));

pool.query(`CREATE TABLE IF NOT EXISTS non_critical_lines (
  id             SERIAL PRIMARY KEY,
  job_no         TEXT         NOT NULL,
  unit_no        TEXT         NOT NULL,
  line_id        TEXT         NOT NULL,
  stress_system  TEXT         DEFAULT NULL,
  created_by     VARCHAR(100) DEFAULT '',
  created_at     TIMESTAMP    DEFAULT NOW(),
  UNIQUE(job_no, unit_no, line_id)
)`).catch(err => console.error('Migration error (non_critical_lines):', err.message));