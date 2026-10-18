// Who a user is and what they may do RIGHT NOW — read live on every request.
//   identity (name, department, active) → pc2_emp.users (eil_employees on PC-2)
//   roles per job / master unit         → effective_assignments
//       GL  : from PIMS only (GL / SGL on any unit of the group, or project SGL)
//       LE / JE / MAT : stored in SSMS user_assignments (given by a GL / LE)
// See PC1_PC2_INTEGRATION_GUIDE.md.
const pool = require('../db/db');

const RANK = { JE: 1, LE: 2, GL: 3 };   // MAT sits outside this chain

// { employeeId, fullName, department } or null if unknown / inactive
async function loadLiveUser(employeeId) {
    const { rows } = await pool.query(
        `SELECT id, name, nullif(trim(department), '') AS department
         FROM pc2_emp.users WHERE upper(id) = upper($1) AND is_active = 1`,
        [employeeId]
    );
    const u = rows[0];
    return u ? { employeeId: u.id, fullName: u.name, department: u.department } : null;
}

// Password check against eil_employees (plain-text column there; never copied)
async function checkCredentials(employeeId, password) {
    const { rows } = await pool.query(
        `SELECT id FROM pc2_emp.users
         WHERE upper(id) = upper($1) AND password_hash = $2 AND is_active = 1`,
        [employeeId, password]
    );
    return rows[0]?.id || null;
}

// The user's assignments in the shape the pages expect (one row per job / master unit /
// role), highest role first — pages use assignments[0].role for navigation.
async function getAssignments(employeeId) {
    const { rows } = await pool.query(
        `SELECT DISTINCT e.employee_id, e.role, e.department, e.job_no, e.unit_no, e.source,
                me.employee_name,
                ARRAY(SELECT pu.unit_no FROM pims_units pu
                      WHERE pu.job_no = e.job_no AND pu.master_unit = e.unit_no
                      ORDER BY pu.unit_no) AS master_members
         FROM effective_assignments e
         LEFT JOIN master_employees me ON upper(me.employee_id) = upper(e.employee_id)
         WHERE upper(e.employee_id) = upper($1)`,
        [employeeId]
    );
    const order = { GL: 1, LE: 2, JE: 3, MAT: 4 };
    return rows
        .map(r => ({ ...r, is_master: true }))
        .sort((a, b) => (order[a.role] - order[b.role]) || a.job_no.localeCompare(b.job_no) || a.unit_no.localeCompare(b.unit_no));
}

// Roles the user holds on a job + unit. Any unit (even a child) is resolved to its
// PIMS master unit first — assignments live on master units.
async function rolesOnUnit(employeeId, jobNo, unitNo) {
    const { rows } = await pool.query(
        `SELECT DISTINCT e.role
         FROM effective_assignments e
         WHERE upper(e.employee_id) = upper($1) AND upper(e.job_no) = upper($2)
           AND e.unit_no = COALESCE(
                 (SELECT pu.master_unit FROM pims_units pu
                  WHERE upper(pu.job_no) = upper($2) AND pu.unit_no = $3), $3)`,
        [employeeId, jobNo, unitNo]
    );
    return rows.map(r => r.role);
}

// Roles the user holds anywhere on a job (job-level features: MR index, bids)
async function rolesOnJob(employeeId, jobNo) {
    const { rows } = await pool.query(
        `SELECT DISTINCT role FROM effective_assignments
         WHERE upper(employee_id) = upper($1) AND upper(job_no) = upper($2)`,
        [employeeId, jobNo]
    );
    return rows.map(r => r.role);
}

module.exports = { RANK, loadLiveUser, checkCredentials, getAssignments, rolesOnUnit, rolesOnJob };
