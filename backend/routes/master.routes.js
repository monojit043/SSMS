const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const { ROLES, requireUnitRole, requireJobRole } = require('../middleware/auth');
const { getGroupMembers, isMasterUnit } = require('../utils/unitGroups');

/* =====================================================
   1. GET JOB NUMBERS — active PIMS jobs where the user has an SSMS role
   ===================================================== */
router.get('/jobs', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT p.job_no, p.job_name
             FROM pims_projects p
             JOIN effective_assignments e ON e.job_no = p.job_no
             WHERE upper(e.employee_id) = upper($1)
             ORDER BY p.job_no`,
            [req.user.employeeId]
        );
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/* =====================================================
   2. GET UNITS BY JOB — PIMS master units only (with their member units).
      Any role on the job may list them.
   ===================================================== */
router.get('/units', requireJobRole(ROLES.READ), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.unit_no, m.unit_name, true AS is_master,
                    ARRAY(SELECT c.unit_no FROM pims_units c
                          WHERE c.job_no = m.job_no AND c.master_unit = m.unit_no
                          ORDER BY c.unit_no) AS master_members
             FROM pims_units m
             WHERE m.job_no = $1 AND m.is_master
             ORDER BY m.unit_no`,
            [req.query.jobNo]
        );
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/* =====================================================
   3. GET STRESS LINES (CORE API)
   ===================================================== */
router.get('/stress-lines', requireUnitRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo, aggregate } = req.query;

        if (!jobNo || !unitNo) {
            return res.status(400).json({
                ok: false,
                error: 'jobNo and unitNo are required'
            });
        }

        let unitParam     = unitNo;
        let unitFilterSql = 'unit_no = $2';
        let aggregated     = false;

        if (aggregate === 'true' && await isMasterUnit(jobNo, unitNo)) {
            unitParam     = await getGroupMembers(jobNo, unitNo);
            unitFilterSql = 'unit_no = ANY($2::text[])';
            aggregated    = true;
        }

        const [localCriticalRes, nonCriticalRes] = await Promise.all([
            pool.query(
                `SELECT line_id, stress_system, unit_no
                 FROM stress_lines
                 WHERE job_no = $1 AND ${unitFilterSql}
                 ORDER BY line_id`,
                [jobNo, unitParam]
            ),
            pool.query(
                `SELECT line_id, stress_system, unit_no
                 FROM non_critical_lines
                 WHERE job_no = $1 AND ${unitFilterSql}
                 ORDER BY line_id`,
                [jobNo, unitParam]
            )
        ]);

        // Critical lines come live from PIMS (stress_lines is a view of cmp_pims_1014)
        const criticalRows = localCriticalRes.rows;

        const data = [
            ...criticalRows.map(r => ({ ...r, is_critical: true })),
            ...nonCriticalRes.rows.map(r => ({ ...r, is_critical: false }))
        ];

        res.json({
            ok: true,
            count: data.length,
            data,
            meta: {
                aggregated,
                masterUnitNo: aggregated ? unitNo : null,
                members: aggregated ? unitParam : [unitNo]
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/* =====================================================
   4. UNIT GROUPS (Master Unit Mapping)
   ===================================================== */

// List all groupings for a job: [{ master_unit_no, members: [...] }]
router.get('/unit-groups', requireJobRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo } = req.query;
        if (!jobNo) {
            return res.status(400).json({ ok: false, error: 'jobNo is required' });
        }

        const result = await pool.query(
            `SELECT master_unit_no, array_agg(unit_no ORDER BY unit_no) AS members
             FROM unit_master_map
             WHERE job_no = $1
             GROUP BY master_unit_no
             ORDER BY master_unit_no`,
            [jobNo]
        );

        res.json({ ok: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Groupings are PIMS parent units now — maintained in PIMS, read-only here.
const managedInPims = (req, res) =>
    res.status(403).json({ ok: false, error: 'Unit groups are managed in PIMS (parent unit). Please change them there.' });
router.post('/unit-groups', managedInPims);
router.delete('/unit-groups/:masterUnitNo', managedInPims);

/* =====================================================
   5. NON-CRITICAL LINES
   ===================================================== */

// Check whether a line_id already exists elsewhere in the SAME job
// (outside the units already searched), in either critical or non-critical data.
router.get('/line-lookup', requireJobRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, lineId, excludeUnits } = req.query;
        if (!jobNo || !lineId) {
            return res.status(400).json({ ok: false, error: 'jobNo and lineId are required' });
        }
        const excludeList = excludeUnits ? excludeUnits.split(',').filter(Boolean) : [];

        const critical = await pool.query(
            `SELECT unit_no FROM stress_lines
             WHERE job_no = $1 AND line_id = $2 AND unit_no != ALL($3::text[]) LIMIT 1`,
            [jobNo, lineId, excludeList]
        );
        if (critical.rows.length) {
            return res.json({ ok: true, found: true, unitNo: critical.rows[0].unit_no, isCritical: true });
        }

        const nonCritical = await pool.query(
            `SELECT unit_no FROM non_critical_lines
             WHERE job_no = $1 AND line_id = $2 AND unit_no != ALL($3::text[]) LIMIT 1`,
            [jobNo, lineId, excludeList]
        );
        if (nonCritical.rows.length) {
            return res.json({ ok: true, found: true, unitNo: nonCritical.rows[0].unit_no, isCritical: false });
        }

        res.json({ ok: true, found: false });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Register a new non-critical line for a job/unit.
// Real line IDs in this system follow PREFIX-UNITNO-NUMBER (e.g. FL-208-5401).
// If the typed line's embedded unit segment looks numeric and doesn't match the
// target unit, it's very likely a typo/wrong-unit mistake — flag it unless forced.
function embeddedUnitOf(lineId) {
    const parts = String(lineId || '').split('-');
    if (parts.length < 2) return null;
    const seg = parts[1].trim();
    return /^\d{2,4}$/.test(seg) ? seg : null;
}

router.post('/non-critical-lines', requireUnitRole(ROLES.EDIT), async (req, res) => {
    try {
        const { jobNo, unitNo, lineId, stressSystem, createdBy, force } = req.body;
        if (!jobNo || !unitNo || !lineId) {
            return res.status(400).json({ ok: false, error: 'jobNo, unitNo and lineId are required' });
        }

        const embeddedUnit = embeddedUnitOf(lineId);
        if (embeddedUnit && embeddedUnit !== unitNo && !force) {
            return res.json({
                ok: false,
                mismatch: true,
                embeddedUnit,
                error: `Line "${lineId}" looks like it belongs to Unit ${embeddedUnit}, not Unit ${unitNo}`
            });
        }

        const result = await pool.query(
            `INSERT INTO non_critical_lines (job_no, unit_no, line_id, stress_system, created_by)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (job_no, unit_no, line_id) DO NOTHING
             RETURNING *`,
            [jobNo, unitNo, lineId, stressSystem || null, createdBy || '']
        );

        if (result.rows.length === 0) {
            // Already existed (e.g. a concurrent add) — return the existing row instead of erroring.
            const existing = await pool.query(
                `SELECT * FROM non_critical_lines WHERE job_no = $1 AND unit_no = $2 AND line_id = $3`,
                [jobNo, unitNo, lineId]
            );
            return res.json({ ok: true, data: existing.rows[0], alreadyExisted: true });
        }

        res.json({ ok: true, data: result.rows[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* =====================================================
   5b. ZONES OF A LINE — live from PIMS lines.line_no (view pims_line_zones)
   Field 04 (Area / Zone) on the Spring Details page offers these zones.
   ===================================================== */
router.get('/line-zones', requireUnitRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo, lineId } = req.query;
        if (!lineId) return res.status(400).json({ ok: false, error: 'lineId is required' });
        const baseLineId = String(lineId).trim().replace(/-[A-Za-z]$/, '');
        // The line may sit on any unit of the selected unit's group
        const units = await getGroupMembers(jobNo, unitNo);
        const result = await pool.query(
            `SELECT DISTINCT zone FROM pims_line_zones
             WHERE job_no = $1 AND line_id = $2 AND unit_no = ANY($3::text[])
             ORDER BY zone`,
            [jobNo, baseLineId, units]
        );
        res.json({ ok: true, lineId: baseLineId, data: result.rows.map(r => r.zone) });
    } catch (err) {
        console.error('[line-zones]', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* =====================================================
   6. LINE SPEC FROM THE ePULSE LINE LIST ON PC-1 (view epulse_line_list)
   Live lookup by line ID — returns piping spec, size,
   insulation, insulation thickness, design temp.
   ===================================================== */
router.get('/line-spec', async (req, res) => {
    try {
        const { lineId, jobNo } = req.query;
        if (!lineId) return res.status(400).json({ ok: false, error: 'lineId is required' });

        // Strip trailing zone suffix: CL-101-02404-A → CL-101-02404
        const baseLineId = lineId.trim().replace(/-[A-Za-z]$/, '');

        // Parse service / unit / line_no from e.g. CL-101-02404
        // service = everything before the first all-digit segment
        // unit    = first all-digit segment
        // line_no = last all-digit segment
        const parts = baseLineId.split('-');
        const firstDigitIdx = parts.findIndex(p => /^\d+$/.test(p));
        if (firstDigitIdx < 1) {
            return res.json({ ok: true, data: null });
        }
        const service = parts.slice(0, firstDigitIdx).join('-');
        const unit    = parts[firstDigitIdx];
        const lineNo  = parts[parts.length - 1];   // last segment

        const result = await pool.query(
            `SELECT piping_class, line_size, insulation, insulation_thickness, design_temp
             FROM epulse_line_list
             WHERE service = $1 AND unit_no = $2 AND line_no = $3
               AND ($4::text IS NULL OR job_no = $4)
             LIMIT 1`,
            [service, unit, lineNo, jobNo || null]
        );

        res.json({ ok: true, data: result.rows[0] || null });

    } catch (err) {
        console.error('[line-spec]', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;