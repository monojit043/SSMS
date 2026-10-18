// Team per job + PIMS master unit (added 2026-10-18).
//   GL — always from PIMS (GL / SGL), never stored here, cannot be added or removed in SSMS.
//   GL adds / removes LE, JE and MAT;  LE adds / removes JE.
//   Only people of your own department (eil_employees on PC-2), only on PIMS master units.
const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const { ROLES, requireUnitRole } = require('../middleware/auth');

const CAN_MANAGE = { GL: ['LE', 'JE', 'MAT'], LE: ['JE'] };
const manageable = (myRoles) => [...new Set(myRoles.flatMap(r => CAN_MANAGE[r] || []))];

// Resolve any unit to its PIMS master unit (null if the unit isn't in PIMS)
async function masterOf(jobNo, unitNo) {
    const { rows } = await pool.query(
        'SELECT job_no, master_unit FROM pims_units WHERE upper(job_no) = upper($1) AND unit_no = $2', [jobNo, unitNo]
    );
    return rows[0] ? { jobNo: rows[0].job_no, unitNo: rows[0].master_unit } : null;
}

const sameDept = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

router.use(requireUnitRole(ROLES.REVIEW));

// Members of the team + what the signed-in user may change
router.get('/', async (req, res) => {
    try {
        const m = await masterOf(req.query.jobNo, req.query.unitNo);
        if (!m) return res.status(404).json({ ok: false, error: 'Unit not found in PIMS' });
        const { rows } = await pool.query(
            `SELECT e.employee_id, me.employee_name, e.role, e.department, e.source,
                    ua.assigned_by, ua.assigned_at
             FROM effective_assignments e
             LEFT JOIN master_employees me ON upper(me.employee_id) = upper(e.employee_id)
             LEFT JOIN user_assignments ua ON ua.employee_id = e.employee_id AND ua.role = e.role
                                           AND ua.job_no = e.job_no AND ua.unit_no = e.unit_no
             WHERE e.job_no = $1 AND e.unit_no = $2
             ORDER BY array_position(ARRAY['GL','LE','JE','MAT'], e.role::text), me.employee_name`,
            [m.jobNo, m.unitNo]
        );
        const canAdd = manageable(req.userRoles);
        const data = rows.map(r => ({
            ...r,
            can_remove: r.source === 'assigned' && canAdd.includes(r.role) && sameDept(r.department, req.user.department),
        }));
        res.json({ ok: true, data, meta: { jobNo: m.jobNo, unitNo: m.unitNo, myRoles: req.userRoles, canAdd, department: req.user.department } });
    } catch (err) {
        console.error('team list:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// People who can be added: active employees of the signed-in user's department
router.get('/candidates', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT employee_id, employee_name FROM master_employees
             WHERE lower(trim(department)) = lower(trim($1)) ORDER BY employee_name`,
            [req.user.department || '']
        );
        res.json({ ok: true, data: rows });
    } catch (err) {
        console.error('team candidates:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Shared checks for add / remove → { m, target } or sends the error
async function validate(req, res) {
    const { employeeId, role } = req.body || {};
    if (!employeeId || !role) { res.status(400).json({ ok: false, error: 'employeeId and role are required' }); return null; }
    if (!manageable(req.userRoles).includes(role)) {
        res.status(403).json({ ok: false, error: role === 'GL'
            ? 'GL comes from PIMS — change it there'
            : `You cannot manage ${role} here (GL manages LE / JE / MAT, LE manages JE)` });
        return null;
    }
    const m = await masterOf(req.body.jobNo, req.body.unitNo);
    if (!m) { res.status(404).json({ ok: false, error: 'Unit not found in PIMS' }); return null; }
    const { rows } = await pool.query(
        'SELECT employee_id, employee_name, department FROM master_employees WHERE upper(employee_id) = upper($1)', [employeeId]
    );
    const target = rows[0];
    if (!target) { res.status(404).json({ ok: false, error: 'Employee not found or not active' }); return null; }
    if (!sameDept(target.department, req.user.department)) {
        res.status(403).json({ ok: false, error: 'You can only manage people of your own department' });
        return null;
    }
    return { m, target, role };
}

router.post('/', async (req, res) => {
    try {
        const v = await validate(req, res);
        if (!v) return;
        const r = await pool.query(
            `INSERT INTO user_assignments (employee_id, role, department, job_no, unit_no, name, assigned_by, assigned_at)
             VALUES ($1, $2, lower(trim($3)), $4, $5, $6, $7, now())
             ON CONFLICT (employee_id, role, job_no, unit_no) DO NOTHING`,
            [v.target.employee_id, v.role, v.target.department, v.m.jobNo, v.m.unitNo, v.target.employee_name, req.user.employeeId]
        );
        res.json({ ok: true, added: r.rowCount, alreadyMember: r.rowCount === 0 });
    } catch (err) {
        console.error('team add:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.delete('/', async (req, res) => {
    try {
        const v = await validate(req, res);
        if (!v) return;
        const r = await pool.query(
            `DELETE FROM user_assignments
             WHERE upper(employee_id) = upper($1) AND role = $2 AND job_no = $3 AND unit_no = $4`,
            [v.target.employee_id, v.role, v.m.jobNo, v.m.unitNo]
        );
        if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Not a member with that role' });
        res.json({ ok: true, removed: r.rowCount });
    } catch (err) {
        console.error('team remove:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
