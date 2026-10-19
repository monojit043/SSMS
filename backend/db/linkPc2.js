// Links spring_schedule_office to the master DBs on PC-2 with postgres_fdw — LIVE, nothing
// is copied. Same pattern as ePULSE / MRCS — see PC1_PC2_INTEGRATION_GUIDE.md.
//
//   eil_employees (PC-2) → schema pc2_emp  (users)
//   cmp_pims_1014 (PC-2) → schema pc2_pims (projects, units, user_unit_roles, project_sgls,
//                                           stress_lines)
//   ePULSE DB     (PC-1) → schema pc1_epulse (line_list — the line list is kept in ePULSE,
//                                           uploaded through ll-normalize.html; decided 2026-10-19)
//
// Local tables replaced by read-only VIEWS of the same name (every read goes to PC-2):
//   master_employees  ← eil_employees.users        (no password column)
//   stress_lines      ← PIMS stress_lines           (was synced every 10 min by cron)
//   unit_master_map   ← PIMS units.parent_unit      (was SSMS's own grouping)
// New views: pims_projects, pims_units, epulse_line_list, effective_assignments.
// user_assignments stays SSMS's own table (LE / JE / MAT); its plain-text password
// column is dropped — login is checked against eil_employees.
//
// Run once per machine:  npm run db:link-pc2    (safe to re-run)
// DRY_RUN=1 runs every step, prints live counts, then rolls back.
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

// Password from .env, else from %APPDATA%\postgresql\pgpass.conf (same rules as psql)
function resolvePassword(prefix) {
  if (process.env[`${prefix}_PASSWORD`]) return process.env[`${prefix}_PASSWORD`];
  const host = process.env[`${prefix}_HOST`], port = process.env[`${prefix}_PORT`] || "5432";
  const db = process.env[`${prefix}_NAME`], user = process.env[`${prefix}_USER`] || "postgres";
  const file = process.env.PGPASSFILE || path.join(process.env.APPDATA || "", "postgresql", "pgpass.conf");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const f = line.split(/(?<!\\):/).map((s) => s.replace(/\\([:\\])/g, "$1"));
      if (f.length < 5) continue;
      const ok = (v, want) => v === "*" || v === want;
      if (ok(f[0], host) && ok(f[1], port) && ok(f[2], db) && ok(f[3], user)) return f.slice(4).join(":");
    }
  }
  throw new Error(`No password for ${user}@${host}/${db} — set ${prefix}_PASSWORD in .env or add it to ${file}`);
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const DRY_RUN = process.env.DRY_RUN === "1";

function serverCfg(prefix, defaultDb) {
  const c = {
    host: process.env[`${prefix}_HOST`], port: process.env[`${prefix}_PORT`] || "5432",
    dbname: process.env[`${prefix}_NAME`] || defaultDb, user: process.env[`${prefix}_USER`] || "postgres",
  };
  if (!c.host) throw new Error(`${prefix}_HOST missing in .env`);
  c.password = resolvePassword(prefix);
  return c;
}

async function main() {
  const e = serverCfg("EMP_DB", "eil_employees");
  const p = serverCfg("PIMS_DB", "cmp_pims_1014");
  const l = serverCfg("EPULSE_DB", "ePULSE_DEV_v1.0.0");
  if (!/cmp_pims/i.test(p.dbname)) throw new Error(`PIMS_DB_NAME must be the PC-2 PIMS DB (cmp_pims_…), got ${p.dbname}`);

  console.log(`Linking ${process.env.DB_NAME} to PC-2 ${e.host} (${e.dbname}, ${p.dbname})${DRY_RUN ? " — DRY RUN, will roll back" : ""}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("  1/4 creating links and foreign tables...");
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS postgres_fdw;
      DROP SCHEMA IF EXISTS pc2_emp CASCADE;
      DROP SCHEMA IF EXISTS pc2_pims CASCADE;
      DROP SERVER IF EXISTS pc2_employees CASCADE;
      DROP SERVER IF EXISTS pc2_pims CASCADE;
      DROP SCHEMA IF EXISTS pc1_epulse CASCADE;
      DROP SERVER IF EXISTS pc1_epulse CASCADE;

      CREATE SERVER pc2_employees FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host ${lit(e.host)}, port ${lit(e.port)}, dbname ${lit(e.dbname)}, connect_timeout '10');
      CREATE USER MAPPING FOR CURRENT_USER SERVER pc2_employees
        OPTIONS (user ${lit(e.user)}, password ${lit(e.password)});
      CREATE SCHEMA pc2_emp;
      IMPORT FOREIGN SCHEMA public LIMIT TO (users) FROM SERVER pc2_employees INTO pc2_emp;

      CREATE SERVER pc2_pims FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host ${lit(p.host)}, port ${lit(p.port)}, dbname ${lit(p.dbname)}, connect_timeout '10');
      CREATE USER MAPPING FOR CURRENT_USER SERVER pc2_pims
        OPTIONS (user ${lit(p.user)}, password ${lit(p.password)});
      CREATE SCHEMA pc2_pims;
      IMPORT FOREIGN SCHEMA public
        LIMIT TO (projects, units, user_unit_roles, project_sgls, stress_lines)
        FROM SERVER pc2_pims INTO pc2_pims;

      CREATE SERVER pc1_epulse FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host ${lit(l.host)}, port ${lit(l.port)}, dbname ${lit(l.dbname)}, connect_timeout '10');
      CREATE USER MAPPING FOR CURRENT_USER SERVER pc1_epulse
        OPTIONS (user ${lit(l.user)}, password ${lit(l.password)});
      CREATE SCHEMA pc1_epulse;
      IMPORT FOREIGN SCHEMA public LIMIT TO (line_list) FROM SERVER pc1_epulse INTO pc1_epulse;
    `);

    console.log("  2/4 removing old local copies...");
    const { rows: rel } = await client.query(
      `SELECT relname, relkind FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname IN ('master_employees', 'stress_lines', 'unit_master_map')`
    );
    for (const r of rel.filter((x) => x.relkind === "r")) {
      if (r.relname === "master_employees") {
        await client.query(`ALTER TABLE user_assignments DROP CONSTRAINT IF EXISTS user_assignments_employee_id_fkey`);
      }
      await client.query(`DROP TABLE public.${r.relname} CASCADE`);
      console.log(`  dropped local table ${r.relname}`);
    }
    // Login is checked against eil_employees now — stop keeping plain-text passwords
    await client.query(`ALTER TABLE user_assignments DROP COLUMN IF EXISTS password`);
    // Departments now come from eil_employees — drop the old fixed list of department names
    await client.query(`ALTER TABLE user_assignments DROP CONSTRAINT IF EXISTS department_check`);
    // Old rows were loaded with explicit ids — move the id sequence past them
    await client.query(`SELECT setval(pg_get_serial_sequence('user_assignments', 'id'), GREATEST((SELECT max(id) FROM user_assignments), 1))`);
    // Audit columns for assignments given inside SSMS
    await client.query(`ALTER TABLE user_assignments ADD COLUMN IF NOT EXISTS assigned_by VARCHAR(50)`);
    await client.query(`ALTER TABLE user_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

    console.log("  3/4 creating live views...");
    await client.query(`
      DROP VIEW IF EXISTS public.master_employees, public.stress_lines, public.unit_master_map;

      CREATE VIEW public.master_employees AS
        SELECT id::varchar(50) AS employee_id, name::varchar(100) AS employee_name,
               email::varchar(150) AS email, department::varchar(50) AS department
        FROM pc2_emp.users
        WHERE is_active = 1 AND nullif(trim(department), '') IS NOT NULL;

      CREATE VIEW public.pims_projects AS
        SELECT id::varchar(50) AS job_no, name::varchar(200) AS job_name
        FROM pc2_pims.projects WHERE is_active = 1;

      -- Active units of active projects, each with its top-most master unit
      CREATE VIEW public.pims_units AS
        WITH RECURSIVE u AS (
          SELECT un.project_id AS job_no, un.unit_no, un.unit_name,
                 nullif(trim(un.parent_unit), '') AS parent
          FROM pc2_pims.units un
          JOIN pc2_pims.projects pr ON pr.id = un.project_id AND pr.is_active = 1
          WHERE un.is_active = 1
        ),
        chain AS (
          SELECT job_no, unit_no, unit_no AS cur, parent, 0 AS depth FROM u
          UNION ALL
          SELECT ch.job_no, ch.unit_no, up.unit_no, up.parent, ch.depth + 1
          FROM chain ch JOIN u up ON up.job_no = ch.job_no AND up.unit_no = ch.parent
          WHERE ch.parent IS NOT NULL AND ch.parent <> ch.cur AND ch.depth < 10
        ),
        top AS (
          SELECT DISTINCT ON (job_no, unit_no) job_no, unit_no, cur AS master_unit
          FROM chain ORDER BY job_no, unit_no, depth DESC
        )
        SELECT u.job_no::varchar(50) AS job_no, u.unit_no::varchar(50) AS unit_no,
               u.unit_name::varchar(200) AS unit_name, t.master_unit::varchar(50) AS master_unit,
               (t.master_unit = u.unit_no) AS is_master
        FROM u JOIN top t ON t.job_no = u.job_no AND t.unit_no = u.unit_no;

      -- SSMS's grouping table, now straight from PIMS (every unit → its master; masters → themselves)
      CREATE VIEW public.unit_master_map AS
        SELECT job_no::varchar(50) AS job_no, unit_no::varchar(50) AS unit_no,
               master_unit::varchar(50) AS master_unit_no,
               ''::varchar(100) AS created_by, NULL::timestamp AS created_at
        FROM pims_units;

      -- Stress-critical lines, live from PIMS (read-only in SSMS)
      CREATE VIEW public.stress_lines AS
        SELECT s.id::int AS id, s.project_id::text AS job_no, s.unit_no::text AS unit_no,
               s.line_key::text AS line_id, s.stress_system::text AS stress_system,
               s.dept::text AS dept, s.stress_eng_id::text AS stress_eng_id,
               s.stress_eng_name::text AS stress_eng_name, s.uploaded_by::text AS uploaded_by,
               s.uploaded_on::text AS uploaded_on
        FROM pc2_pims.stress_lines s
        JOIN pc2_pims.projects pr ON pr.id = s.project_id AND pr.is_active = 1;

      -- Line specification (class, size, insulation, design temp) from the ePULSE line list (PC-1).
      -- unit_no is the unit code: "101 (PDH Unit)" / "101(PDH Unit)" → "101"
      CREATE VIEW public.epulse_line_list AS
        SELECT project_id::text AS job_no,
               COALESCE(substring(unit_no from '^s*(d+)'), split_part(unit_no, ' ', 1))::text AS unit_no,
               service::text AS service, line_no::text AS line_no,
               line_class::text AS piping_class, line_size::text AS line_size,
               insulation::text AS insulation, insulation_thickness::text AS insulation_thickness,
               design_temp::text AS design_temp
        FROM pc1_epulse.line_list;

      -- EFFECTIVE roles (decided 2026-10-18). GL is never stored — PIMS only:
      --   PIMS GL / SGL on ANY unit of a group → GL on that group's master unit;
      --   PIMS project SGL → GL on every master unit of that job.
      -- Stored LE / JE / MAT count only on a PIMS master unit (old non-PIMS rows grant nothing).
      CREATE VIEW public.effective_assignments AS
        SELECT ua.employee_id::varchar(50) AS employee_id, ua.role::varchar(10) AS role,
               ua.department::varchar(100) AS department, ua.job_no::varchar(50) AS job_no,
               ua.unit_no::varchar(50) AS unit_no, 'assigned'::varchar(10) AS source
        FROM user_assignments ua
        WHERE ua.role IN ('LE', 'JE', 'MAT')
          AND EXISTS (SELECT 1 FROM pims_units pu
                      WHERE pu.job_no = ua.job_no AND pu.unit_no = ua.unit_no AND pu.is_master)
        UNION
        SELECT u.id::varchar(50), 'GL', u.department::varchar(100), pu.job_no, pu.master_unit, 'pims'
        FROM pc2_pims.user_unit_roles r
        JOIN pims_units pu ON pu.job_no = r.project_id AND pu.unit_no = r.unit_no
        JOIN pc2_emp.users u ON upper(u.id) = upper(r.user_id)
        WHERE r.role_code IN ('GL', 'SGL')
          AND u.is_active = 1 AND nullif(trim(u.department), '') IS NOT NULL
        UNION
        SELECT u.id::varchar(50), 'GL', u.department::varchar(100), pu.job_no, pu.unit_no, 'pims'
        FROM pc2_pims.project_sgls s
        JOIN pims_units pu ON pu.job_no = s.project_id AND pu.is_master
        JOIN pc2_emp.users u ON upper(u.id) = upper(s.user_id)
        WHERE u.is_active = 1 AND nullif(trim(u.department), '') IS NOT NULL;
    `);

    console.log("  4/4 reading live counts from PC-2...");
    const { rows: counts } = await client.query(`
      SELECT (SELECT count(*) FROM master_employees)::int AS employees_with_department,
             (SELECT count(*) FROM pims_projects)::int AS pims_jobs,
             (SELECT count(*) FROM pims_units WHERE is_master)::int AS pims_master_units,
             (SELECT count(*) FROM stress_lines)::int AS stress_lines,
             (SELECT count(*) FROM epulse_line_list)::int AS epulse_line_list_rows,
             (SELECT count(DISTINCT employee_id) FROM effective_assignments WHERE source = 'pims')::int AS gl_from_pims,
             (SELECT count(*) FROM effective_assignments WHERE source = 'assigned')::int AS stored_assignments_in_use,
             (SELECT count(*) FROM user_assignments)::int AS stored_assignments_total`);

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("✅ Dry run OK — nothing changed. Live counts would be:", counts[0]);
    } else {
      await client.query("COMMIT");
      console.log(`✅ Linked to PC-2 (${e.host}) — live counts:`, counts[0]);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("❌ Linking to PC-2 failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Linking to PC-2 failed:", err.message);
  process.exitCode = 1;
});
