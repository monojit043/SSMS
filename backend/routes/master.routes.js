const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const pimsPool = require('../db/pims-db');
const { getGroupMembers, getMasterFor, isMasterUnit, getMastersForJob } = require('../utils/unitGroups');

/* =====================================================
   1. GET JOB NUMBERS
   ===================================================== */
router.get('/jobs', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT job_no FROM stress_lines ORDER BY job_no`
        );

        res.json({ ok: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/* =====================================================
   2. GET UNIT NUMBERS BY JOB
   ===================================================== */
router.get('/units', async (req, res) => {
    try {
        const { jobNo, includeMasters } = req.query;

        if (!jobNo) {
            return res.status(400).json({ ok: false, error: 'jobNo is required' });
        }

        // A unit counts as "real" for this job if it has critical-line data,
        // or at least one person is formally assigned to work in it — covers
        // offsite units that exist (and have JEs/LEs assigned) but haven't had
        // PIMS data synced yet.
        const result = await pool.query(
            `SELECT DISTINCT unit_no FROM (
                SELECT unit_no FROM stress_lines WHERE job_no = $1
                UNION
                SELECT unit_no FROM user_assignments WHERE job_no = $1
            ) combined
            ORDER BY unit_no`,
            [jobNo]
        );

        // Opt-in only (Dashboard's unrestricted selector) — the Unit Groups admin
        // member picker must NOT see this, to avoid nesting a master inside another group.
        if (includeMasters === 'true') {
            const masters = await getMastersForJob(jobNo);
            const existing = new Set(result.rows.map(r => r.unit_no));
            masters.forEach(m => {
                if (!existing.has(m.unit_no)) {
                    result.rows.push({ unit_no: m.unit_no, is_master: true, master_members: m.members });
                } else {
                    const row = result.rows.find(r => r.unit_no === m.unit_no);
                    row.is_master = true;
                    row.master_members = m.members;
                }
            });
            result.rows.sort((a, b) => a.unit_no.localeCompare(b.unit_no));
        }

        res.json({ ok: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/* =====================================================
   3. GET STRESS LINES (CORE API)
   ===================================================== */
router.get('/stress-lines', async (req, res) => {
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

        // Live pull from PIMS — zone suffix (e.g. -A, -B) is preserved as it is meaningful
        let pimsRows = [];
        try {
            const pimsRes = await pimsPool.query(
                `SELECT TRIM(line_no) AS line_id, stress_system, unit_no
                 FROM drawings
                 WHERE stress_critical = 'Y'
                   AND job_no = $1
                   AND ${unitFilterSql}
                   AND line_no IS NOT NULL
                 ORDER BY line_no`,
                [jobNo, unitParam]
            );
            pimsRows = pimsRes.rows;
        } catch (pimsErr) {
            console.error('[PIMS live query failed, using local only]', pimsErr.message);
        }

        // Merge: local rows take priority; PIMS adds any lines not yet in local
        const seenLocal = new Set(
            localCriticalRes.rows.map(r => `${r.unit_no}|${r.line_id}`)
        );
        const pimsOnly = pimsRows.filter(
            r => r.line_id && !seenLocal.has(`${r.unit_no}|${r.line_id}`)
        );

        const criticalRows = [
            ...localCriticalRes.rows,
            ...pimsOnly
        ].sort((a, b) => (a.line_id || '').localeCompare(b.line_id || ''));

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
router.get('/unit-groups', async (req, res) => {
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

// Create / replace a grouping — memberUnitNos should include the master itself
router.post('/unit-groups', async (req, res) => {
    try {
        const { jobNo, masterUnitNo, memberUnitNos, createdBy } = req.body;

        if (!jobNo || !masterUnitNo || !Array.isArray(memberUnitNos) || memberUnitNos.length === 0) {
            return res.status(400).json({ ok: false, error: 'jobNo, masterUnitNo and memberUnitNos[] are required' });
        }

        const members = Array.from(new Set([...memberUnitNos, masterUnitNo]));

        await pool.query('BEGIN');
        try {
            // Clear out the master's previous member list
            await pool.query(
                `DELETE FROM unit_master_map WHERE job_no = $1 AND master_unit_no = $2`,
                [jobNo, masterUnitNo]
            );

            for (const unitNo of members) {
                await pool.query(
                    `INSERT INTO unit_master_map (job_no, unit_no, master_unit_no, created_by)
                     VALUES ($1,$2,$3,$4)
                     ON CONFLICT (job_no, unit_no)
                     DO UPDATE SET master_unit_no = EXCLUDED.master_unit_no, created_by = EXCLUDED.created_by`,
                    [jobNo, unitNo, masterUnitNo, createdBy || '']
                );
            }

            await pool.query('COMMIT');
        } catch (err) {
            await pool.query('ROLLBACK');
            throw err;
        }

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Dissolve a grouping — its members revert to standalone
router.delete('/unit-groups/:masterUnitNo', async (req, res) => {
    try {
        const { masterUnitNo } = req.params;
        const { jobNo } = req.query;
        if (!jobNo) {
            return res.status(400).json({ ok: false, error: 'jobNo is required' });
        }

        await pool.query(
            `DELETE FROM unit_master_map WHERE job_no = $1 AND master_unit_no = $2`,
            [jobNo, masterUnitNo]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* =====================================================
   5. NON-CRITICAL LINES
   ===================================================== */

// Check whether a line_id already exists elsewhere in the SAME job
// (outside the units already searched), in either critical or non-critical data.
router.get('/line-lookup', async (req, res) => {
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

router.post('/non-critical-lines', async (req, res) => {
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
   6. LINE SPEC FROM PIMS linelist_lines
   Live lookup by line ID — returns piping spec, size,
   insulation, insulation thickness, design temp.
   ===================================================== */
router.get('/line-spec', async (req, res) => {
    try {
        const { lineId } = req.query;
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

        const result = await pimsPool.query(
            `SELECT DISTINCT
                 line_class          AS piping_class,
                 line_size,
                 insulation,
                 insulation_thickness,
                 design_temp
             FROM linelist_lines
             WHERE service  = $1
               AND SPLIT_PART(unit_no, ' ', 1) = $2
               AND line_no  = $3
             LIMIT 1`,
            [service, unit, lineNo]
        );

        res.json({ ok: true, data: result.rows[0] || null });

    } catch (err) {
        console.error('[line-spec]', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;