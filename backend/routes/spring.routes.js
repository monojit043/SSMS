const express = require('express');
const router  = express.Router();
const pool    = require('../db/db');
const xlsx    = require('xlsx-js-style');
const { getGroupMembers, getMasterFor, isMasterUnit, expandUnits } = require('../utils/unitGroups');
const {
    ROLES, requireUnitRole, requireJobRole, requireSpringRole, requireSpringsRole, requireScopeRole, requireTagsRole,
} = require('../middleware/auth');

// Who may do what (see middleware/auth.js): READ = JE/LE/GL/MAT, EDIT = JE/LE/GL,
// REVIEW = LE/GL, MR = LE/GL/MAT, MAT = MAT/GL. Always checked on the job + master unit.
const vendorSpringId = async (req) =>
    (await pool.query('SELECT spring_id FROM spring_vendor_data WHERE id = $1', [req.params.id])).rows[0]?.spring_id ?? 0;   // 0 → "Spring not found"

/* =====================================================
   4. SAVE SPRING DATA
   ===================================================== */
router.post('/save', requireUnitRole(ROLES.EDIT), async (req, res) => {
    try {
        const {
            jobNo,
            unitNo,
            line_id,
            stress_system,

            subline,
            area,
            piping_class,
            line_size,
            line_schedule,
            insulation,
            insulation_thickness,
            design_temp,

            spring_type,
            figure,
            pipe_location_type,
            pipe_size_at_spring,
            pipe_sch_at_spring,
            dummy_pipe_material,
            dimension,
            travel_up,
            travel_down,
            max_up,
            max_down,
            horiz_axial,
            horiz_trans,
            operating_load,
            hydro_load,
            spring_tag,
            quantity,
            node_no,
            status,
            remarks,
            created_by
        } = req.body;

        const result = await pool.query(
            `INSERT INTO spring_details
            (job_no, unit_no, line_id, stress_system,
             subline, area, piping_class, line_size, line_schedule, insulation, insulation_thickness, design_temp,
             spring_type, figure, pipe_location_type, pipe_size_at_spring, pipe_sch_at_spring, dummy_pipe_material,
             dimension, travel_up, travel_down, max_up, max_down,
             horiz_axial, horiz_trans, operating_load, hydro_load,
             spring_tag, quantity, node_no, status, remarks, created_by)

            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                    $13,$14,$15,$16,$17,$18,
                    $19,$20,$21,$22,$23,$24,$25,$26,$27,
                    $28,$29,$30,$31,$32,$33)
            ON CONFLICT (spring_tag) DO NOTHING`,
            [
                jobNo, unitNo, line_id, stress_system,
                subline, area, piping_class, line_size, line_schedule,
                insulation, insulation_thickness || null, design_temp,
                spring_type, figure,
                pipe_location_type || 'main',
                pipe_size_at_spring || null,
                pipe_sch_at_spring || null,
                dummy_pipe_material || null,
                dimension, travel_up, travel_down, max_up, max_down,
                horiz_axial, horiz_trans, operating_load, hydro_load,
                spring_tag, quantity, node_no,
                status || 'saved', remarks || '', created_by || ''
            ]
        );

        res.json({ ok: true, data: result.rows[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/piping/save', requireUnitRole(ROLES.EDIT), async (req, res) => {
    try {
        const {
            jobNo,
            unitNo,
            line_id,
            subline,
            area,
            line_size,
            line_schedule,
            piping_class,
            insulation
        } = req.body;

        await pool.query(
            `INSERT INTO piping_details
            (job_no, unit_no, line_id, subline, area, line_size, line_schedule, piping_class, insulation)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                jobNo,
                unitNo,
                line_id,
                subline,
                area,
                line_size,
                line_schedule,
                piping_class,
                insulation
            ]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/list', requireScopeRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo, unitNos, createdBy, status, excludeStatus, aggregate } = req.query;

        // Multi-unit mode (MAT role)
        if (jobNo && unitNos) {
            const units = await expandUnits(jobNo, unitNos.split(',').map(u => u.trim()).filter(Boolean));
            let q = `SELECT sd.*, COALESCE(b.bid_count,0)::int AS bid_count
                     FROM spring_details sd
                     LEFT JOIN (SELECT spring_tag, COUNT(*) AS bid_count FROM spring_bid_data GROUP BY spring_tag) b
                       ON b.spring_tag = sd.spring_tag
                     WHERE sd.job_no = $1 AND sd.unit_no = ANY($2::text[])`;
            const p = [jobNo, units];
            if (status)        { q += ` AND sd.status = $${p.length + 1}`;  p.push(status); }
            if (excludeStatus) { q += ` AND sd.status != $${p.length + 1}`; p.push(excludeStatus); }
            q += ` ORDER BY sd.unit_no, sd.line_id, sd.spring_tag`;
            const r = await pool.query(q, p);
            return res.json({ ok: true, data: r.rows, meta: { aggregated: false, members: units } });
        }

        // Aggregate mode (LE Approval / Dashboard only — never requested by JE calls):
        // when the selected unit is a master unit, widen the filter to its whole group.
        let unitParam     = unitNo;
        let unitFilterSql = `unit_no = $2`;
        let aggregated     = false;

        if (aggregate === 'true' && await isMasterUnit(jobNo, unitNo)) {
            unitParam     = await getGroupMembers(jobNo, unitNo);
            unitFilterSql = `unit_no = ANY($2::text[])`;
            aggregated    = true;
        }

        let query = `SELECT sd.*, COALESCE(b.bid_count,0)::int AS bid_count
                     FROM spring_details sd
                     LEFT JOIN (SELECT spring_tag, COUNT(*) AS bid_count FROM spring_bid_data GROUP BY spring_tag) b
                       ON b.spring_tag = sd.spring_tag
                     WHERE sd.job_no = $1 AND sd.${unitFilterSql}`;
        const params = [jobNo, unitParam];

        if (createdBy) {
            query += ` AND sd.created_by = $${params.length + 1}`;
            params.push(createdBy);
        }

        if (status) {
            query += ` AND sd.status = $${params.length + 1}`;
            params.push(status);
        }

        if (excludeStatus) {
            query += ` AND sd.status != $${params.length + 1}`;
            params.push(excludeStatus);
        }

        query += ` ORDER BY sd.id DESC`;

        const result = await pool.query(query, params);

        res.json({
            ok: true,
            data: result.rows,
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

router.get('/next-tag', requireUnitRole(ROLES.EDIT), async (req, res) => {
    try {
        const { jobNo, unitNo, springType } = req.query;

        if (!jobNo || !unitNo || !springType) {
            return res.status(400).json({ ok: false, error: "Missing params" });
        }

        // Determine type code
        const csTypes = ["CS1", "CS2", "CS3", "CS4"];
        const typeCode = csTypes.includes(springType) ? "CSH" : "VSH";

        // Master-unit grouping: if this unit belongs to a group, the printed tag
        // uses the master unit number and the number pool spans the whole group.
        const effectiveUnit = await getMasterFor(jobNo, unitNo);
        const memberUnits   = await getGroupMembers(jobNo, unitNo);

        // 🔥 IMPORTANT CHANGE: remove type filtering
        const result = await pool.query(
            `SELECT spring_tag
             FROM spring_details
             WHERE job_no = $1 AND unit_no = ANY($2::text[])`,
            [jobNo, memberUnits]
        );

        let max = 0;

        result.rows.forEach(row => {
            const parts = row.spring_tag.split("-");
            const num = parseInt(parts[parts.length - 1]);

            if (!isNaN(num) && num > max) {
                max = num;
            }
        });

        const nextNum = String(max + 1).padStart(4, "0");

        const tag = `${jobNo}-${effectiveUnit}-${typeCode}-${nextNum}`;
        const grouped = effectiveUnit !== unitNo;

        res.json({
            ok: true,
            tag,
            meta: {
                grouped,
                literalUnitNo: unitNo,
                masterUnitNo: grouped ? effectiveUnit : null
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.delete('/delete/:id', requireSpringRole(ROLES.EDIT), async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query(
            `DELETE FROM spring_details WHERE id = $1`,
            [id]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.put('/update/:id', requireSpringRole(ROLES.EDIT), async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const mrCheck = await pool.query(`SELECT mr_no FROM spring_details WHERE id = $1`, [id]);
        if (mrCheck.rows.length && mrCheck.rows[0].mr_no) {
            return res.status(403).json({ ok: false, error: 'Spring is locked — an MR has been raised against it.' });
        }

        await pool.query(
            `UPDATE spring_details SET
        
                line_id=$1,
                stress_system=$2,
        
                subline=$3,
                area=$4,
                piping_class=$5,
                line_size=$6,
                line_schedule=$7,
                insulation=$8,
                insulation_thickness=$9,
                design_temp=$10,

                spring_type=$11,
                figure=$12,
                pipe_location_type=$13,
                pipe_size_at_spring=$14,
                pipe_sch_at_spring=$15,
                dummy_pipe_material=$16,
                dimension=$17,
                travel_up=$18,
                travel_down=$19,
                max_up=$20,
                max_down=$21,
                horiz_axial=$22,
                horiz_trans=$23,
                operating_load=$24,
                hydro_load=$25,

                quantity=$26,
                node_no=$27,
                remarks=$28

             WHERE id=$29`,
            [
                data.line_id,
                data.stress_system,
                data.subline,
                data.area,
                data.piping_class,
                data.line_size,
                data.line_schedule,
                data.insulation,
                data.insulation_thickness || null,
                data.design_temp,
                data.spring_type,
                data.figure,
                data.pipe_location_type || 'main',
                data.pipe_size_at_spring || null,
                data.pipe_sch_at_spring || null,
                data.dummy_pipe_material || null,
                data.dimension,
                data.travel_up,
                data.travel_down,
                data.max_up,
                data.max_down,
                data.horiz_axial,
                data.horiz_trans,
                data.operating_load,
                data.hydro_load,
                data.quantity,
                data.node_no,
                data.remarks || '',
                id
            ]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/analytics', requireUnitRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo, createdBy, aggregate } = req.query;

        if (!jobNo || !unitNo) {
            return res.status(400).json({ ok: false, error: 'jobNo and unitNo are required' });
        }

        // Aggregate mode (Dashboard, LE only — never requested by JE calls):
        // when the selected unit is a master unit, widen the filter to its whole group.
        let unitParam     = unitNo;
        let unitFilterSql = `unit_no=$2`;
        let aggregated     = false;

        if (aggregate === 'true' && await isMasterUnit(jobNo, unitNo)) {
            unitParam     = await getGroupMembers(jobNo, unitNo);
            unitFilterSql = `unit_no = ANY($2::text[])`;
            aggregated    = true;
        }

        const baseParams = [jobNo, unitParam];
        const createdByClause = createdBy ? ` AND created_by = $3` : '';
        if (createdBy) baseParams.push(createdBy);

        const [statusRes, typeRes, engineerRes, lineRes, recentRes] = await Promise.all([
            pool.query(
                `SELECT status, COUNT(*)::int AS count
                 FROM spring_details
                 WHERE job_no=$1 AND ${unitFilterSql}${createdByClause}
                 GROUP BY status`,
                baseParams
            ),
            pool.query(
                `SELECT spring_type, COUNT(*)::int AS count
                 FROM spring_details
                 WHERE job_no=$1 AND ${unitFilterSql}${createdByClause}
                 GROUP BY spring_type ORDER BY spring_type`,
                baseParams
            ),
            pool.query(
                `SELECT created_by,
                        COUNT(*)::int                                        AS total,
                        COUNT(*) FILTER (WHERE status='approved')::int       AS approved,
                        COUNT(*) FILTER (WHERE status='submitted')::int      AS pending,
                        COUNT(*) FILTER (WHERE status='rejected')::int       AS rejected,
                        COUNT(*) FILTER (WHERE status='saved')::int          AS saved
                 FROM spring_details
                 WHERE job_no=$1 AND ${unitFilterSql}
                 GROUP BY created_by
                 ORDER BY total DESC`,
                [jobNo, unitParam]
            ),
            pool.query(
                `SELECT line_id,
                        COUNT(*)::int                                        AS total,
                        COUNT(*) FILTER (WHERE status='approved')::int       AS approved,
                        COUNT(*) FILTER (WHERE status='submitted')::int      AS pending,
                        COUNT(*) FILTER (WHERE status='rejected')::int       AS rejected
                 FROM spring_details
                 WHERE job_no=$1 AND ${unitFilterSql}${createdByClause}
                 GROUP BY line_id ORDER BY line_id`,
                baseParams
            ),
            pool.query(
                `SELECT id, spring_tag, line_id, spring_type, status, created_by, reviewed_by, node_no
                 FROM spring_details
                 WHERE job_no=$1 AND ${unitFilterSql}${createdByClause}
                 ORDER BY id DESC LIMIT 12`,
                baseParams
            )
        ]);

        res.json({
            ok: true,
            data: {
                statusBreakdown:   statusRes.rows,
                typeBreakdown:     typeRes.rows,
                engineerBreakdown: engineerRes.rows,
                lineBreakdown:     lineRes.rows,
                recentActivity:    recentRes.rows
            },
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

router.get('/dashboard', requireUnitRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo } = req.query;

        const result = await pool.query(
            `SELECT 
                COUNT(*) AS total_springs,
                COUNT(DISTINCT line_id) AS total_lines,
                COUNT(*) FILTER (WHERE spring_tag LIKE '%CSH%') AS csh_count,
                COUNT(*) FILTER (WHERE spring_tag LIKE '%VSH%') AS vsh_count
             FROM spring_details
             WHERE job_no = $1 AND unit_no = $2`,
            [jobNo, unitNo]
        );

        res.json({ ok: true, data: result.rows[0] });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.put('/submit/:id', requireSpringRole(ROLES.EDIT), async (req, res) => {
    try {
        await pool.query(
            `UPDATE spring_details 
             SET status = 'submitted'
             WHERE id = $1`,
            [req.params.id]
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

// Submitted springs awaiting review — only on units where the signed-in user is LE / GL
router.get('/submitted', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT sd.* FROM spring_details sd
             WHERE sd.status = 'submitted'
               AND EXISTS (
                   SELECT 1 FROM effective_assignments e
                   WHERE upper(e.employee_id) = upper($1) AND e.role IN ('LE', 'GL')
                     AND e.job_no = sd.job_no
                     AND e.unit_no = COALESCE((SELECT pu.master_unit FROM pims_units pu
                                               WHERE pu.job_no = sd.job_no AND pu.unit_no = sd.unit_no), sd.unit_no))
             ORDER BY sd.line_id`,
            [req.user.employeeId]
        );
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.put('/approve/:id', requireSpringRole(ROLES.REVIEW), async (req, res) => {
    try {
        const { reviewed_by, remarks } = req.body;
        await pool.query(
            `UPDATE spring_details
             SET status = 'approved',
                 reviewed_by = $2,
                 review_remarks = $3
             WHERE id = $1`,
            [req.params.id, reviewed_by || '', remarks || '']
        );
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

router.put('/reject/:id', requireSpringRole(ROLES.REVIEW), async (req, res) => {
    try {
        const { reviewed_by, remarks } = req.body;
        const mrCheck = await pool.query(`SELECT mr_no FROM spring_details WHERE id = $1`, [req.params.id]);
        if (mrCheck.rows.length && mrCheck.rows[0].mr_no) {
            return res.status(403).json({ ok: false, error: 'Spring is locked — an MR has been raised against it.' });
        }
        await pool.query(
            `UPDATE spring_details
             SET status = 'rejected',
                 reviewed_by = $2,
                 review_remarks = $3
             WHERE id = $1`,
            [req.params.id, reviewed_by || '', remarks || '']
        );
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});


router.put('/disapprove/:id', requireSpringRole(ROLES.REVIEW), async (req, res) => {
    try {
        const { reviewed_by } = req.body;
        const check = await pool.query(
            `SELECT status, mr_no FROM spring_details WHERE id = $1`,
            [req.params.id]
        );
        if (!check.rows.length) return res.status(404).json({ ok: false, error: 'Spring not found' });
        if (check.rows[0].mr_no) return res.status(403).json({ ok: false, error: 'Spring is locked — an MR has been raised against it.' });
        if (check.rows[0].status !== 'approved') return res.status(400).json({ ok: false, error: 'Only approved springs can be disapproved' });
        await pool.query(
            `UPDATE spring_details
             SET status = 'submitted',
                 reviewed_by = $2,
                 review_remarks = ''
             WHERE id = $1`,
            [req.params.id, reviewed_by || '']
        );
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

router.get('/export', requireScopeRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo, aggregate } = req.query;

        const params = [];
        let where = `WHERE status = 'approved'`;
        if (jobNo && unitNo) {
            if (aggregate === 'true' && await isMasterUnit(jobNo, unitNo)) {
                where += ` AND job_no = $1 AND unit_no = ANY($2::text[])`;
                params.push(jobNo, await getGroupMembers(jobNo, unitNo));
            } else {
                where += ` AND job_no = $1 AND unit_no = $2`;
                params.push(jobNo, unitNo);
            }
        }

        const result = await pool.query(
            `SELECT * FROM spring_details ${where} ORDER BY id`,
            params
        );

        const XLSX = require('xlsx-js-style');

        const rows = result.rows.map((r, idx) => ({
            "S.NO": idx + 1,
            "MR NO": "",
            "JOB NO": r.job_no || "",
            "Contractor Code": "",
            "DIA": r.line_size || "",
            "Service": "",
            "Unit": r.unit_no || "",
            "Isrno": "",
            "subline": r.subline || "",
            "Piping Class": r.piping_class || "",
            "Insulation": r.insulation || "",
            "areano": r.area || "",
            "isosheet": "",
            "SPRING Serial NUMBER": "",
            "SPRING TAG NO.(AUTO GENERATION THRU EXCEL)": r.spring_tag || "",
            "Qty": r.quantity || "",
            "SUPPORT ARRANGEMENT TYPE": r.spring_type || "",
            "FIG. No.": r.figure || "",
            "DIMENSIONS (MM) C": r.dimension || "",
            "DIMENSIONS (MM) L": "",
            "TRAVEL CORRESPONDING TO OPERATING TEMPERATURE (MM) UP": r.travel_up != null ? r.travel_up : "",
            "TRAVEL CORRESPONDING TO OPERATING TEMPERATURE (MM) DOWN": r.travel_down != null ? r.travel_down : "",
            "MAX VERTICAL TRAVEL (MM) UP": r.max_up != null ? r.max_up : "",
            "MAX VERTICAL TRAVEL (MM) DOWN": r.max_down != null ? r.max_down : "",
            "HORIZONTAL MOVEMENT. (MM) AXIAL": r.horiz_axial != null ? r.horiz_axial : "",
            "HORIZONTAL MOVEMENT. (MM) TRANSVERSE": r.horiz_trans != null ? r.horiz_trans : "",
            "OPERATING LOAD (KG)": r.operating_load != null ? r.operating_load : "",
            "HYDRO TEST LOAD (KG)": r.hydro_load != null ? r.hydro_load : "",
            "LINE/DUMMY PIPE MATERIAL AT SPRING LOCATION": "",
            "SCHEDULE": r.line_schedule || "",
            "LINE DESIGN TEMP DEG.C": r.design_temp || "",
            "INSULATION THICKNESS (MM)": r.insulation_thickness || "",
            "SPRING LOCATION TYPE": r.pipe_location_type === 'dummy' ? "Dummy Pipe" : "Main Line",
            "PIPE SIZE AT SPRING LOCATION": r.pipe_size_at_spring || "",
            "PIPE SCHEDULE AT SPRING LOCATION": r.pipe_sch_at_spring || "",
            "DUMMY PIPE MATERIAL": r.dummy_pipe_material || "",
            "REMARKS": r.remarks || ""
        }));

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Approved Springs");

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const filename = jobNo && unitNo
            ? `${jobNo}_${unitNo}_approved_springs.xlsx`
            : `approved_springs.xlsx`;

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/export-eil', requireScopeRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo, unitNos, aggregate, springTags, mrNo } = req.query;

        let where = `WHERE sd.status = 'approved'`;
        const params = [];
        let aggregated = false;
        if (jobNo && unitNos) {
            // MAT multi-unit export
            const units = await expandUnits(jobNo, unitNos.split(',').map(u => u.trim()).filter(Boolean));
            where += ` AND sd.job_no = $1 AND sd.unit_no = ANY($2::text[])`;
            params.push(jobNo, units);
            aggregated = units.length > 1;
        } else if (jobNo && unitNo) {
            if (aggregate === 'true' && await isMasterUnit(jobNo, unitNo)) {
                aggregated = true;
                where += ` AND sd.job_no = $1 AND sd.unit_no = ANY($2::text[])`;
                params.push(jobNo, await getGroupMembers(jobNo, unitNo));
            } else {
                where += ` AND sd.job_no = $1 AND sd.unit_no = $2`;
                params.push(jobNo, unitNo);
            }
        }

        // Filter to specific spring tags (MAT selective export)
        if (springTags) {
            const tags = springTags.split(',').map(t => t.trim()).filter(Boolean);
            where += ` AND sd.spring_tag = ANY($${params.length + 1}::text[])`;
            params.push(tags);
        }

        const { rows: springs } = await pool.query(
            `SELECT sd.*,
                    svd.spring_designation, svd.spring_constant,
                    svd.preset_load,        svd.load_variation
             FROM spring_details sd
             LEFT JOIN spring_vendor_data svd ON svd.spring_id = sd.id
             ${where}
             ORDER BY sd.id`,
            params
        );

        const { rows: customNotes } = await pool.query(
            `SELECT note_text, note_number FROM spring_notes WHERE job_no=$1 AND unit_no=$2 ORDER BY note_number ASC`,
            [jobNo || '', unitNo || '']
        );

        const ExcelJS = require('exceljs');
        const path    = require('path');

        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Spring Schedule');

        /* ── Column widths (A–Z, 26 cols) ──────────── */
        ws.columns = [
            {width:8},{width:12},{width:20},{width:6},{width:14},{width:8},
            {width:8},{width:8},{width:14},{width:8},{width:8},{width:8},
            {width:8},{width:8},{width:10},{width:10},{width:10},{width:16},
            {width:18},{width:8},{width:14},{width:14},{width:18},{width:14},
            {width:10},{width:12}
        ];

        /* ── Style helpers ──────────────────────────── */
        const thinBorder = {
            top:    { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            left:   { style: 'thin', color: { argb: 'FF000000' } },
            right:  { style: 'thin', color: { argb: 'FF000000' } }
        };
        const yellowFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

        // Header cell (yellow background, bold, borders, centered)
        function hCell(colNum, rowNum, value) {
            const c = ws.getCell(rowNum, colNum);
            c.value        = value;
            c.font         = { bold: true, size: 8, name: 'Arial' };
            c.fill         = yellowFill;
            c.alignment    = { horizontal: 'center', vertical: 'middle', wrapText: true };
            c.border       = thinBorder;
        }
        // Data cell (borders, centered)
        function dCell(colNum, rowNum, value) {
            const c = ws.getCell(rowNum, colNum);
            c.value     = value;
            c.font      = { size: 9, name: 'Arial' };
            c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            c.border    = thinBorder;
        }

        /* ══════════════════════════════════════════════
           ROWS 1-3 : EIL header banner
           A1:D3  → logo image  (same height as title)
           E1:V3  → SPRING SCHEDULE
           W1:Z3  → Document No. (full height – same as spring schedule)
        ══════════════════════════════════════════════ */
        ws.mergeCells('A1:D3');   // logo
        ws.mergeCells('E1:V3');   // spring schedule title
        ws.mergeCells('W1:Z3');   // document no. block – full 3-row height

        ws.getRow(1).height = 20;
        ws.getRow(2).height = 18;
        ws.getRow(3).height = 18;

        // Logo cell – bordered placeholder (image overlaid below)
        const logoCell = ws.getCell('A1');
        logoCell.border = thinBorder;

        // SPRING SCHEDULE title
        const titleCell = ws.getCell('E1');
        titleCell.value     = 'SPRING SCHEDULE';
        titleCell.font      = { bold: true, size: 14, name: 'Arial' };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.border    = thinBorder;

        // Document No. (W1:Z3 merged – same height as spring schedule)
        // Format: {JOB_NO}-{UNIT_NO}-16-43-DS-{MR_NO}
        const unitDisplay = unitNo
            || (unitNos ? unitNos.split(',')[0].trim() : 'XXX');
        const docNum = `${jobNo || 'XXXX'}-${unitDisplay}-16-43-DS-${mrNo || 'XXXX'}`;
        const docCell = ws.getCell('W1');
        docCell.value     = `Document No.\n${docNum}\nRev.  No. X`;
        docCell.font      = { bold: true, size: 8, name: 'Arial' };
        docCell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
        docCell.border    = thinBorder;

        // Embed EIL logo image (overlay on A1:D3)
        try {
            const logoPath = path.join(__dirname, '../../public/Assets/logo1.png');
            const imageId  = wb.addImage({ filename: logoPath, extension: 'jpeg' });
            ws.addImage(imageId, {
                tl: { col: 0, row: 0 },   // col/row 0-based: A=0, row1=0
                br: { col: 4, row: 3 },   // exclusive end: col D+1=4, row 3+1=3
                editAs: 'oneCell'
            });
        } catch (imgErr) {
            logoCell.value     = 'ENGINEERS INDIA LIMITED';
            logoCell.font      = { bold: true, size: 9, name: 'Arial' };
            logoCell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        /* ══════════════════════════════════════════════
           ROWS 4-6 : Project info
        ══════════════════════════════════════════════ */
        const infoFont  = { bold: true, size: 9, name: 'Arial' };
        const infoAlign = { horizontal: 'left', vertical: 'middle' };

        ws.getCell(4, 1).value = 'JOB NO :';   ws.getCell(4, 1).font = infoFont; ws.getCell(4, 1).alignment = infoAlign;
        ws.getCell(4, 2).value = jobNo || '';   ws.getCell(4, 2).font = infoFont;
        ws.mergeCells(4, 2, 4, 20);   // B4:T4 — leaves U-Z for revision table

        ws.getCell(5, 1).value = 'PROJECT :';  ws.getCell(5, 1).font = infoFont; ws.getCell(5, 1).alignment = infoAlign;
        ws.mergeCells(5, 2, 5, 20);   // B5:T5

        ws.getCell(6, 1).value = 'CLIENT :';   ws.getCell(6, 1).font = infoFont; ws.getCell(6, 1).alignment = infoAlign;
        ws.mergeCells(6, 2, 6, 20);   // B6:T6

        [4, 5, 6].forEach(r => { ws.getRow(r).height = 18; });

        /* ── Revision table  U-Z (cols 21-26), rows 4-6 ─────────
           Rows 4-5 : empty data rows (for filling revision entries)
           Row  6   : column headers at the bottom
        ──────────────────────────────────────────────────────── */
        for (let r = 4; r <= 5; r++) {
            for (let i = 0; i < 6; i++) {
                const c = ws.getCell(r, 21 + i);
                c.value  = '';
                c.border = thinBorder;
            }
        }
        ['REV. NO', 'DATE', 'REVISION', 'BY', 'CHK.', 'APPD.'].forEach((h, i) => {
            const c = ws.getCell(6, 21 + i);   // U6 V6 W6 X6 Y6 Z6
            c.value     = h;
            c.font      = { bold: true, size: 7, name: 'Arial' };
            c.fill      = yellowFill;
            c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            c.border    = thinBorder;
        });

        /* ══════════════════════════════════════════════
           ROWS 8-9 : Column headers  (H1=8, H2=9)
        ══════════════════════════════════════════════ */
        const H1 = 8, H2 = 9;

        // Single-column headers that span both header rows (colNum is 1-based)
        const singles = [
            [1,  'MR\nS. NO'],
            [2,  'ITEMCODE'],
            [3,  'SPRING TAG NUMBER\n(XXXX-XXX-XX-XXXX)\n(NOTE-1)'],
            [4,  'QTY\n(Nos.)'],
            [5,  'SUPPORT\nARRANGEMENT\nTYPE\n(NOTE-2,5,11,12)'],
            [6,  'FIG. No\n(NOTE-\n2,5,11,12)'],
            [9,  'PIPE DIA (INCH) &\nTHICKNESS (SCH)\nAT SPRING\nLOCATION\n(NOTE-11)'],
            [16, 'OPERATING\nLOAD (KG)'],
            [17, 'HYDRO TEST\nLOAD (KG)'],
            [18, 'LINE NUMBER'],
            [19, 'LINE / DUMMY\nPIPE MATERIAL\nAT SPRING\nLOCATION\n(NOTE-11)'],
            [20, 'LINE DESIGN\nTEMP DEG C'],
            [21, 'INSULATION\nTHICKNESS (MM)\n& TYPE'],
            [22, 'REMARKS\n(NOTE-7)']
        ];
        singles.forEach(([col, val]) => {
            hCell(col, H1, val);
            hCell(col, H2, '');
            ws.mergeCells(H1, col, H2, col);
        });

        // DIMENSIONS G-H (cols 7-8)
        hCell(7, H1, 'DIMENSIONS (MM)\n(EITHER C OR L)\n(NOTE-2)'); hCell(8, H1, '');
        ws.mergeCells(H1, 7, H1, 8);
        hCell(7, H2, 'C'); hCell(8, H2, 'L');

        // TRAVEL J-K (cols 10-11)
        hCell(10, H1, 'TRAVEL CORRESPONDING\nTO OPERATING\nTEMPERATURE (MM)\n(NOTE-10)'); hCell(11, H1, '');
        ws.mergeCells(H1, 10, H1, 11);
        hCell(10, H2, 'UP'); hCell(11, H2, 'DOWN');

        // MAX VERTICAL TRAVEL L-M (cols 12-13)
        hCell(12, H1, 'MAX VERTICAL\nTRAVEL (MM)\n(UP & DOWN)\n(NOTE-10)'); hCell(13, H1, '');
        ws.mergeCells(H1, 12, H1, 13);
        hCell(12, H2, 'UP'); hCell(13, H2, 'DOWN');

        // HORIZONTAL MOVEMENT N-O (cols 14-15)
        hCell(14, H1, 'HORIZONTAL\nMOVEMENT (MM)\n(NOTE-4)'); hCell(15, H1, '');
        ws.mergeCells(H1, 14, H1, 15);
        hCell(14, H2, 'AXIAL'); hCell(15, H2, 'TRANSVERSE');

        // TO BE FILLED BY BIDDER/SUPPLIER W-Z (cols 23-26)
        hCell(23, H1, 'TO BE FILLED BY BIDDER/SUPPLIER');
        hCell(24, H1, ''); hCell(25, H1, ''); hCell(26, H1, '');
        ws.mergeCells(H1, 23, H1, 26);
        hCell(23, H2, "VENDOR'S SPRING\nDESIGNATION\n(NOTE 6)");
        hCell(24, H2, 'SPRING CONSTANT\n(KG/MM)\n(Note-6)');
        hCell(25, H2, 'PRESET LOAD\n(KG)\n(Note-6)');
        hCell(26, H2, '% LOAD\nVARIATION\n(NOTE-3,6& 7)');

        ws.getRow(H1).height = 72;
        ws.getRow(H2).height = 36;

        /* ══════════════════════════════════════════════
           DATA ROWS from row 10
        ══════════════════════════════════════════════ */
        const R0 = 10;
        let col2MaxLen  = 12; // ITEMCODE — start at current default
        let col18MaxLen = 16; // LINE NUMBER — start at current default
        let col19MaxLen = 18; // DUMMY PIPE MATERIAL — start at current default
        springs.forEach((s, idx) => {
            const rowNum   = R0 + idx;
            const pipeInfo = [s.pipe_size_at_spring, s.pipe_sch_at_spring || ''].filter(Boolean).join(' ');
            const insulInfo = [s.insulation, s.insulation_thickness ? s.insulation_thickness + ' MM' : ''].filter(Boolean).join(' ');
            // A subline of "0"/"00" means "no subline" — omit it from the line number.
            // Any other value (e.g. "01", "02") is a real subline and stays.
            const sublineForLineNo = s.subline && !/^0+$/.test(s.subline.trim()) ? s.subline : null;

            const values = [
                mrNo ? String(idx + 1).padStart(3, '0') : (s.mr_no || ''),  // 1  A
                (() => {
                    const parts    = (s.spring_tag || '').split('-');
                    const tagJob   = parts[0] || jobNo || '';
                    const tagUnit  = parts[1] || unitDisplay;
                    const serialNo = parts[parts.length - 1] || '';
                    return `*${tagJob}${tagUnit}SPG${serialNo}ZZ`;
                })(),                           // 2  B  ITEMCODE
                s.spring_tag          || '',   // 3  C
                s.quantity            ?? '',   // 4  D
                s.spring_type         || '',   // 5  E
                s.figure              || '',   // 6  F
                ['CS4','VS4'].includes(s.spring_type) ? (s.dimension ?? '') : '',  // 7  G DIM C
                ['CS4','VS4'].includes(s.spring_type) ? '' : (s.dimension ?? ''),  // 8  H DIM L
                pipeInfo,                       // 9  I
                s.travel_up           ?? '',   // 10 J
                s.travel_down         ?? '',   // 11 K
                s.max_up              ?? '',   // 12 L
                s.max_down            ?? '',   // 13 M
                s.horiz_axial         ?? '',   // 14 N
                s.horiz_trans         ?? '',   // 15 O
                s.operating_load      ?? '',   // 16 P
                s.hydro_load          ?? '',   // 17 Q
                (aggregated
                    ? [s.unit_no, s.line_size, s.line_id, sublineForLineNo, s.piping_class, s.insulation, s.area]
                    : [s.line_size, s.line_id, sublineForLineNo, s.piping_class, s.insulation, s.area]
                ).filter(Boolean).join('-'),  // 18 R LINE NUMBER
                s.dummy_pipe_material || '',   // 19 S
                s.design_temp         || '',   // 20 T
                insulInfo,                      // 21 U
                s.remarks             || '',   // 22 V
                s.spring_designation  || '',   // 23 W
                s.spring_constant     || '',   // 24 X
                s.preset_load         || '',   // 25 Y
                s.load_variation      || ''    // 26 Z
            ];

            col2MaxLen  = Math.max(col2MaxLen,  String(values[1]).length);
            col18MaxLen = Math.max(col18MaxLen, String(values[17]).length);
            col19MaxLen = Math.max(col19MaxLen, String(values[18]).length);
            values.forEach((v, i) => dCell(i + 1, rowNum, v));
            ws.getRow(rowNum).height = 18;
        });

        // Apply content-fitted widths (capped to avoid runaway columns)
        ws.getColumn(2).width  = Math.min(col2MaxLen  + 3, 35);
        ws.getColumn(18).width = Math.min(col18MaxLen + 3, 50);
        ws.getColumn(19).width = Math.min(col19MaxLen + 3, 40);

        /* ══════════════════════════════════════════════
           NOTES SECTION
        ══════════════════════════════════════════════ */
        const STANDARD_NOTES = [
            "In case of identical springs (like A\\B\\C\\D etc), the data furnished is applicable for individual spring. Spring tag number legend: XXXX (Job number) – XXX (Unit number) – XX (VS/CS) – XXXX (Unique serial number).",
            "Refer EIL standards No. 7-44-00761/62/63/65/68/69/70/71/86 as applicable.",
            "Variable spring shall have max. 15% load variation based on operating load unless otherwise specified against remarks column. Vendor to provide the % load variation of the spring offered based on the operating load & the corresponding travel specified.",
            "Vendor to ensure that the spring will be suitable and will be able to provide the support load without leading to eccentric loading for the horizontal movement specified.",
            "For all the springs with clamp arrangement, an additional lock-nut shall be provided. Bolt length shall be suitably increased to accommodate the lock-nut.",
            "Spring constant, preset load & the % load variation of the spring shall be filled by spring vendor.",
            "Note 3 is not applicable wherever spring constant is specified against remarks column. Vendor shall offer the spring according to the applicable requirement.",
            "The tag no. specified in the spring schedule shall be used for tagging & marking as per the technical notes for spring assemblies.",
            "Vendor to ensure that clamps and other components are designed for maximum allowable load of spring wherever the size or load is not covered in EIL std. MOC of clamp & components shall be identical to pipe MOC or the material suitable for the intended design conditions.",
            "Spring shall be suitable for the travel range specified in the MR.",
            "Protection shield, if indicated in the support arrangement type drawing, shall be of the same MOC of the line pipe or shall be rolled from equivalent plate material. Thickness of protection shield shall be same as that of line pipe or 12 mm whichever is less.",
            "Protection shield indicated on elbow/bend shall be suitable & matching the curvature profile of the elbow/bend (1.5D radius & as per B-16.9, unless otherwise specified)."
        ];

        const lastDataRow = R0 + Math.max(springs.length - 1, 0);
        let nr = lastDataRow + 2;

        function noteHead(rowNum, colNum, value) {
            const c = ws.getCell(rowNum, colNum);
            c.value = value;
            c.font  = { bold: true, size: 9, name: 'Arial' };
            c.alignment = { horizontal: 'left', vertical: 'middle' };
        }
        function noteText(rowNum, colNum, value) {
            const c = ws.getCell(rowNum, colNum);
            c.value = value;
            c.font  = { size: 9, name: 'Arial' };
            c.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        }

        noteHead(nr, 1, 'ABBREVIATIONS :'); nr++;
        [['CS', 'Constant Spring Support'], ['VS', 'Variable Spring Support']].forEach(([code, def]) => {
            noteHead(nr, 1, code); noteText(nr, 2, def); nr++;
        });
        nr++;

        noteHead(nr, 1, 'NOTES :'); nr++;
        STANDARD_NOTES.forEach((note, i) => {
            noteHead(nr, 1, `${i + 1}.`);
            noteText(nr, 2, note);
            try { ws.mergeCells(nr, 2, nr, 26); } catch (_) {}
            ws.getRow(nr).height = 30;
            nr++;
        });

        if (customNotes.length > 0) {
            nr++;
            noteHead(nr, 1, 'CUSTOM NOTES :'); nr++;
            customNotes.forEach((n, i) => {
                noteHead(nr, 1, `${STANDARD_NOTES.length + (n.note_number > 0 ? n.note_number : i + 1)}.`);
                noteText(nr, 2, n.note_text);
                try { ws.mergeCells(nr, 2, nr, 26); } catch (_) {}
                ws.getRow(nr).height = 30;
                nr++;
            });
        }

        const buf  = await wb.xlsx.writeBuffer();
        const fname = mrNo
            ? `${mrNo}_EIL_spring_schedule.xlsx`
            : jobNo && unitNo
                ? `${jobNo}_${unitNo}_EIL_spring_schedule.xlsx`
                : 'EIL_spring_schedule.xlsx';

        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);

    } catch (err) {
        console.error('EIL export error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════════
   EXPORT ALL SPRINGS  (all statuses, colour-coded)
═══════════════════════════════════════════════════════════════ */
router.get('/export-all', requireScopeRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo, unitNo, unitNos, createdBy, aggregate } = req.query;
        const params = [];
        let where = 'WHERE 1=1';
        if (jobNo && unitNos) {
            // MAT multi-unit export
            const units = await expandUnits(jobNo, unitNos.split(',').map(u => u.trim()).filter(Boolean));
            where += ' AND job_no = $1 AND unit_no = ANY($2::text[])';
            params.push(jobNo, units);
        } else if (jobNo && unitNo) {
            if (aggregate === 'true' && await isMasterUnit(jobNo, unitNo)) {
                where += ' AND job_no = $1 AND unit_no = ANY($2::text[])';
                params.push(jobNo, await getGroupMembers(jobNo, unitNo));
            } else {
                where += ' AND job_no = $1 AND unit_no = $2';
                params.push(jobNo, unitNo);
            }
        }
        if (createdBy) {
            where += ` AND created_by = $${params.length + 1}`;
            params.push(createdBy);
        }

        const { rows: springs } = await pool.query(
            `SELECT * FROM spring_details ${where} ORDER BY line_id, spring_tag`,
            params
        );

        const ExcelJS = require('exceljs');
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('All Springs');

        const STATUS_FILL = {
            approved:  { type:'pattern', pattern:'solid', fgColor:{ argb:'FFC6EFCE' } },
            submitted: { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFFFCC' } },
            rejected:  { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFC7CE' } },
            saved:     { type:'pattern', pattern:'solid', fgColor:{ argb:'FFE2E2E2' } },
        };
        const STATUS_FONT_COLOR = {
            approved:  'FF276221',
            submitted: 'FF7F6000',
            rejected:  'FF9C0006',
            saved:     'FF404040',
        };

        // IPMCS import format — columns in exact order required by the system
        const COLS = [
            { header: 'S.NO',                                                          width: 6,  val: (_s, i) => i + 1 },
            { header: 'MR NO',                                                         width: 14, val: s => s.mr_no               || '' },
            { header: 'JOB NO',                                                        width: 10, val: s => s.job_no              || '' },
            { header: 'Contractor Code',                                               width: 14, val: ()  => ''                       },
            { header: 'DIA XXX',                                                       width: 10, val: s => {
                if (!s.line_size && s.line_size !== 0) return '';
                const n = parseFloat(String(s.line_size).replace(/["“”’']/g, '').replace(/\binch(es)?\b/gi, '').trim());
                return isNaN(n) ? s.line_size : (n % 1 === 0 ? Math.round(n) : n);
            }},
            { header: 'Service',                                                       width: 16, val: s => s.stress_system ? s.stress_system.toUpperCase() : '' },
            { header: 'Unit XXX',                                                      width: 10, val: s => s.unit_no             || '' },
            { header: 'lsrno',                                                         width: 18, val: s => s.line_id             || '' },
            { header: 'subline',                                                       width: 10, val: s => s.subline             || '' },
            { header: 'Piping  Class',                                                 width: 12, val: s => s.piping_class ? s.piping_class.toUpperCase() : '' },
            { header: 'Insulation',                                                    width: 12, val: s => s.insulation          || '' },
            { header: 'areano',                                                        width: 8,  val: s => s.area                || '' },
            { header: 'isosheet',                                                      width: 12, val: ()  => ''                       },
            { header: 'SPRING Serial NUMBER XXX',                                      width: 20, val: ()  => ''                       },
            { header: 'SPRING TAG NO.',                                                width: 22, val: s => s.spring_tag          || '' },
            { header: 'Qty',                                                           width: 6,  val: s => s.quantity            || '' },
            { header: 'SUPPORT ARRANGEMENT TYPE\n(NOTE-2,5,11, 12) XXX',              width: 22, val: s => s.spring_type         || '' },
            { header: 'FIG. No.\n(NOTE-2,5,11,12) X',                                 width: 12, val: s => s.figure              || '' },
            { header: 'DIMENSIONS (MM)\nC',                                            width: 14, val: s => s.dimension           || '' },
            { header: 'DIMENSIONS (MM)\nL',                                            width: 14, val: ()  => ''                       },
            { header: 'TRAVEL CORRESPONDING TO\nOPERATING TEMPERATURE (MM)\nUP',      width: 22, val: s => s.travel_up           || '' },
            { header: 'TRAVEL CORRESPONDING TO\nOPERATING TEMPERATURE (MM)\nDOWN',    width: 22, val: s => s.travel_down         || '' },
            { header: 'MAX VERTICAL TRAVEL (MM)\nUP',                                  width: 16, val: s => s.max_up              || '' },
            { header: 'MAX VERTICAL TRAVEL (MM)\nDOWN',                                width: 16, val: s => s.max_down            || '' },
            { header: 'HORIZONTAL MOVEMENT. (MM)\nAXIAL',                              width: 18, val: s => s.horiz_axial         || '' },
            { header: 'HORIZONTAL MOVEMENT. (MM)\nTRANSVERSE',                         width: 18, val: s => s.horiz_trans         || '' },
            { header: 'OPERATING LOAD (KG)',                                           width: 16, val: s => s.operating_load      || '' },
            { header: 'HYDRO TEST LOAD (KG)',                                          width: 16, val: s => s.hydro_load          || '' },
            { header: 'LINE/DUMMY PIPE MATERIAL\nAT SPRING LOCATION\n(NOTE-11)',       width: 24, val: s => s.dummy_pipe_material  || '' },
            { header: 'LINE/DUMMY PIPE SIZE\nAT SPRING LOCATION\n(NOTE-11)',           width: 24, val: s => s.pipe_size_at_spring  || '' },
            { header: 'SCHEDULE',                                                      width: 12, val: s => s.pipe_sch_at_spring  || '' },
            { header: 'LINE DESIGN TEMP DEG.C',                                       width: 18, val: s => s.design_temp         || '' },
            { header: 'INSULATION THICKNESS (MM)',                                     width: 18, val: s => s.insulation_thickness || '' },
            { header: 'REMARKS (NOTE-7)',                                              width: 24, val: s => s.remarks             || '' },
        ];

        ws.columns = COLS.map(c => ({ width: c.width }));

        // Title row
        ws.mergeCells(1, 1, 1, COLS.length);
        const titleCell = ws.getCell(1, 1);
        titleCell.value     = createdBy
            ? `SPRINGS BY ${createdBy} — JOB: ${jobNo || '—'}  UNIT: ${unitNo || '—'}`
            : `ALL SPRINGS — JOB: ${jobNo || '—'}  UNIT: ${unitNo || '—'}`;
        titleCell.font      = { bold: true, size: 12, name: 'Arial', color: { argb: 'FF1A1A2E' } };
        titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFEE' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 22;

        // Status legend row
        const legendLabels = ['Approved', 'Submitted', 'Rejected', 'Saved'];
        const legendFills  = ['FFC6EFCE', 'FFFFFFCC', 'FFFFC7CE', 'FFE2E2E2'];
        const legendFonts  = ['FF276221', 'FF7F6000', 'FF9C0006', 'FF404040'];
        legendLabels.forEach((lbl, i) => {
            const c = ws.getCell(2, i + 1);
            c.value     = lbl;
            c.font      = { bold: true, size: 8, name: 'Arial', color: { argb: legendFonts[i] } };
            c.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: legendFills[i] } };
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.border    = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        });
        ws.getRow(2).height = 14;

        // Column header row (row 3)
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C2C3E' } };
        COLS.forEach((col, i) => {
            const c = ws.getCell(3, i + 1);
            c.value     = col.header;
            c.font      = { bold: true, size: 8, name: 'Arial', color: { argb: 'FFFFD700' } };
            c.fill      = headerFill;
            c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            c.border    = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
        });
        ws.getRow(3).height = 52;

        // Data rows
        springs.forEach((s, idx) => {
            const rowNum  = 4 + idx;
            const status  = (s.status || 'saved').toLowerCase();
            const rowFill = STATUS_FILL[status]      || STATUS_FILL.saved;
            const fntClr  = STATUS_FONT_COLOR[status] || STATUS_FONT_COLOR.saved;

            const values = COLS.map((col, ci) => col.val(s, idx));

            values.forEach((v, i) => {
                const c = ws.getCell(rowNum, i + 1);
                c.value     = v;
                c.font      = { size: 9, name: 'Arial', color: { argb: fntClr } };
                c.fill      = rowFill;
                c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                c.border    = { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} };
            });

            ws.getRow(rowNum).height = 18;
        });

        if (!springs.length) {
            ws.mergeCells(4, 1, 4, COLS.length);
            ws.getCell(4, 1).value = 'No springs found for this job / unit.';
            ws.getCell(4, 1).alignment = { horizontal: 'center' };
        }

        const buf = await wb.xlsx.writeBuffer();
        let fname;
        if (jobNo && unitNo && createdBy) {
            fname = `${jobNo}_${unitNo}_${createdBy}_Springs.xlsx`;
        } else if (jobNo && unitNo) {
            fname = `${jobNo}_${unitNo}_All_Springs.xlsx`;
        } else {
            fname = 'All_Springs.xlsx';
        }

        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);

    } catch (err) {
        console.error('Export-all error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.put('/bulk-approve', requireSpringsRole(ROLES.REVIEW), async (req, res) => {
    try {
        const { ids, reviewed_by } = req.body;

        if (!ids || ids.length === 0) {
            return res.json({ ok: false });
        }

        await pool.query(
            `UPDATE spring_details
             SET status = 'approved',
                 reviewed_by = $2
             WHERE id = ANY($1::int[])`,
            [ids, reviewed_by || '']
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false });
    }
});

/* ── MR / Order Status Excel Upload ──────────────── */

router.post('/upload-mr-excel', requireUnitRole(ROLES.MR), async (req, res) => {
    try {
        const { jobNo, unitNo, fileBase64 } = req.body;
        if (!jobNo || !unitNo || !fileBase64) {
            return res.status(400).json({ ok: false, error: 'Missing parameters' });
        }

        // Parse workbook from base64
        const buffer   = Buffer.from(fileBase64, 'base64');
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];
        const rows     = xlsx.utils.sheet_to_json(sheet, { defval: '' });

        if (!rows.length) return res.json({ ok: true, updated: 0, message: 'Empty sheet' });

        // Discover MR and PR column names dynamically from the header row
        const allKeys = Object.keys(rows[0]);
        const mrCols  = allKeys.filter(k => /^MR\d+$/i.test(k.trim()));
        const prCols  = allKeys.filter(k => /^PR\d+$/i.test(k.trim()));

        // Fetch all springs for this job/unit
        const { rows: springs } = await pool.query(
            `SELECT id, spring_tag FROM spring_details WHERE job_no = $1 AND unit_no = $2`,
            [jobNo, unitNo]
        );
        if (!springs.length) return res.json({ ok: true, updated: 0, message: 'No springs for this Job/Unit' });

        // Helper — resolve column value with case-insensitive key lookup
        function cellVal(row, candidates) {
            for (const key of Object.keys(row)) {
                if (candidates.some(c => c.toLowerCase() === key.toLowerCase()))
                    return String(row[key] || '').trim();
            }
            return '';
        }

        let updatedCount = 0;
        const results = [];

        for (const spring of springs) {
            const tag = (spring.spring_tag || '').trim();
            if (!tag) continue;

            // Match Excel row where ITEMCODE or DESCR contains the spring tag
            const matchedRow = rows.find(row => {
                const itemCode = cellVal(row, ['ITEMCODE', 'Item Code', 'ITEM_CODE', 'item code']);
                const descr    = cellVal(row, ['DESCR', 'DESCRIPTION', 'Description', 'descr']);
                return itemCode.toUpperCase().includes(tag.toUpperCase()) ||
                       descr.toUpperCase().includes(tag.toUpperCase());
            });

            if (!matchedRow) continue;

            // Collect all non-empty MR numbers
            const mrNos = mrCols
                .map(col => String(matchedRow[col] || '').trim())
                .filter(v => v !== '');
            const mrNoStr = mrNos.join(' / ');

            // If any PR column has a value → Ordered
            const hasPR = prCols.some(col => String(matchedRow[col] || '').trim() !== '');
            const orderStatus = hasPR ? 'Ordered' : (mrNos.length > 0 ? 'Not Ordered' : 'Not Ordered');

            await pool.query(
                `UPDATE spring_details SET mr_no = $1, order_status = $2 WHERE id = $3`,
                [mrNoStr, orderStatus, spring.id]
            );
            updatedCount++;
            results.push({ tag, mrNos, hasPR });
        }

        res.json({ ok: true, updated: updatedCount, total: springs.length, results });

    } catch (err) {
        console.error('Excel upload error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ── Assign MR number (MAT selective export) ─────── */

router.patch('/assign-mr', requireTagsRole(ROLES.MR, req => req.body?.springTags), async (req, res) => {
    try {
        const { springTags, mrNo } = req.body;
        if (!mrNo || !Array.isArray(springTags) || springTags.length === 0) {
            return res.status(400).json({ ok: false, error: 'mrNo and springTags[] are required' });
        }
        const result = await pool.query(
            `UPDATE spring_details
             SET mr_no = $1
             WHERE spring_tag = ANY($2::text[])`,
            [mrNo.trim(), springTags]
        );
        res.json({ ok: true, updated: result.rowCount });
    } catch (err) {
        console.error('assign-mr error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ── Drop springs from MR (non-bid re-assignment) ─── */

router.patch('/drop-mr', requireTagsRole(ROLES.MR, req => req.body?.springTags), async (req, res) => {
    try {
        const { springTags } = req.body;
        if (!Array.isArray(springTags) || springTags.length === 0) {
            return res.status(400).json({ ok: false, error: 'springTags[] required' });
        }
        const result = await pool.query(
            `UPDATE spring_details SET mr_no = NULL
             WHERE spring_tag = ANY($1::text[]) AND status = 'approved'`,
            [springTags]
        );
        res.json({ ok: true, updated: result.rowCount });
    } catch (err) {
        console.error('drop-mr error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ── MR Index ─────────────────────────────────────── */

router.get('/mr-index', requireJobRole(ROLES.READ), async (req, res) => {
    try {
        const { jobNo } = req.query;
        if (!jobNo) return res.status(400).json({ ok: false, error: 'jobNo required' });
        const result = await pool.query(
            `SELECT mr_no,
                    COUNT(*)::int AS spring_count,
                    array_agg(DISTINCT unit_no ORDER BY unit_no) AS units,
                    json_agg(
                        json_build_object(
                            'spring_tag',    spring_tag,
                            'unit_no',       unit_no,
                            'line_id',       line_id,
                            'spring_type',   spring_type,
                            'node_no',       node_no,
                            'travel_up',     travel_up,
                            'travel_down',   travel_down,
                            'operating_load',operating_load
                        ) ORDER BY unit_no, spring_tag
                    ) AS springs
             FROM spring_details
             WHERE job_no = $1 AND mr_no IS NOT NULL AND mr_no <> ''
             GROUP BY mr_no
             ORDER BY mr_no`,
            [jobNo]
        );
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        console.error('mr-index error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ── Bid Upload (Excel from vendor) ──────────────── */

router.post('/upload-bid', requireJobRole(ROLES.MAT), async (req, res) => {
    try {
        const { vendorName, jobNo, fileBase64 } = req.body;
        if (!vendorName || !jobNo || !fileBase64) {
            return res.status(400).json({ ok: false, error: 'vendorName, jobNo, fileBase64 required' });
        }

        const ExcelJS = require('exceljs');
        const buf = Buffer.from(fileBase64, 'base64');
        const wb  = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);

        const ws = wb.getWorksheet(1);
        if (!ws) return res.status(400).json({ ok: false, error: 'No worksheet found in file' });

        /* EIL layout: data from row 10, spring tag col 3, bid cols 23-26.
           Spring tags look like "B862-101-CSH-0041" — four hyphen-separated
           alphanumeric parts, no spaces. Notes/footer rows are long sentences
           and will not match this pattern. */
        const SPRING_TAG_RE = /^[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+$/;
        const rows = [];
        ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
            if (rowNum < 10) return;
            const tag = (row.getCell(3).text || row.getCell(3).value || '').toString().trim();
            if (!tag || !SPRING_TAG_RE.test(tag)) return;
            rows.push({
                tag,
                designation:  (row.getCell(23).value ?? '').toString().trim(),
                constant:     (row.getCell(24).value ?? '').toString().trim(),
                presetLoad:   (row.getCell(25).value ?? '').toString().trim(),
                loadVar:      (row.getCell(26).value ?? '').toString().trim(),
            });
        });

        if (rows.length === 0) {
            return res.status(400).json({ ok: false, error: 'No spring rows found. Expected data from row 10 with spring tag in column C.' });
        }

        for (const r of rows) {
            await pool.query(
                `INSERT INTO spring_bid_data
                    (spring_tag, job_no, vendor_name, spring_designation, spring_constant, preset_load, load_variation_pct)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (spring_tag, vendor_name)
                 DO UPDATE SET spring_designation=$4, spring_constant=$5, preset_load=$6,
                               load_variation_pct=$7, uploaded_at=NOW()`,
                [r.tag, jobNo, vendorName, r.designation, r.constant, r.presetLoad, r.loadVar]
            );
        }

        res.json({ ok: true, processed: rows.length });
    } catch (err) {
        console.error('upload-bid error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/bid-data', requireTagsRole(ROLES.READ, req => [req.query.springTag]), async (req, res) => {
    try {
        const { springTag, jobNo } = req.query;
        if (!springTag) return res.status(400).json({ ok: false, error: 'springTag required' });

        const params = [springTag];
        let extra = '';
        if (jobNo) { params.push(jobNo); extra = ' AND job_no = $2'; }

        const result = await pool.query(
            `SELECT vendor_name, spring_designation, spring_constant,
                    preset_load, load_variation_pct, uploaded_at
             FROM spring_bid_data
             WHERE spring_tag = $1${extra}
             ORDER BY vendor_name`,
            params
        );
        res.json({ ok: true, data: result.rows });
    } catch (err) {
        console.error('bid-data error:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/* ── Vendor Data ─────────────────────────────────── */

router.get('/vendor-data/:springId', requireSpringRole(ROLES.READ, req => req.params.springId), async (req, res) => {
    try {
        const { springId } = req.params;
        const result = await pool.query(
            `SELECT * FROM spring_vendor_data WHERE spring_id = $1 LIMIT 1`,
            [springId]
        );
        res.json({ ok: true, data: result.rows[0] || null });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/vendor-data', requireSpringRole(ROLES.MAT, req => req.body?.springId), async (req, res) => {
    try {
        const { springId, vendorName, poNo, poDate, springDesignation, springConstant, presetLoad, loadVariation, remarks, createdBy } = req.body;
        const result = await pool.query(
            `INSERT INTO spring_vendor_data
               (spring_id, vendor_name, po_no, po_date, spring_designation, spring_constant, preset_load, load_variation, remarks, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [springId, vendorName || '', poNo || '', poDate || null, springDesignation || '', springConstant || '', presetLoad || '', loadVariation || '', remarks || '', createdBy || '']
        );
        res.json({ ok: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.put('/vendor-data/:id', requireSpringRole(ROLES.MAT, vendorSpringId), async (req, res) => {
    try {
        const { id } = req.params;
        const { vendorName, poNo, poDate, springDesignation, springConstant, presetLoad, loadVariation, remarks } = req.body;
        const result = await pool.query(
            `UPDATE spring_vendor_data
             SET vendor_name=$1, po_no=$2, po_date=$3,
                 spring_designation=$4, spring_constant=$5, preset_load=$6, load_variation=$7, remarks=$8
             WHERE id=$9
             RETURNING *`,
            [vendorName || '', poNo || '', poDate || null, springDesignation || '', springConstant || '', presetLoad || '', loadVariation || '', remarks || '', id]
        );
        res.json({ ok: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;