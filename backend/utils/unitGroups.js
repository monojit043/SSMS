const pool = require('../db/db');

// Full list of unit_no values that share the same master as unitNo (including itself).
// Returns [unitNo] if the unit has no grouping configured.
async function getGroupMembers(jobNo, unitNo) {
    const result = await pool.query(
        `SELECT master_unit_no FROM unit_master_map WHERE job_no = $1 AND unit_no = $2`,
        [jobNo, unitNo]
    );
    if (result.rows.length === 0) return [unitNo];

    const masterUnitNo = result.rows[0].master_unit_no;
    const members = await pool.query(
        `SELECT unit_no FROM unit_master_map WHERE job_no = $1 AND master_unit_no = $2`,
        [jobNo, masterUnitNo]
    );
    return members.rows.map(r => r.unit_no);
}

// The master unit number for unitNo, or unitNo itself if it has no grouping.
async function getMasterFor(jobNo, unitNo) {
    const result = await pool.query(
        `SELECT master_unit_no FROM unit_master_map WHERE job_no = $1 AND unit_no = $2`,
        [jobNo, unitNo]
    );
    return result.rows.length ? result.rows[0].master_unit_no : unitNo;
}

// True if unitNo is the master of at least one group (including itself as a member).
async function isMasterUnit(jobNo, unitNo) {
    const result = await pool.query(
        `SELECT 1 FROM unit_master_map WHERE job_no = $1 AND master_unit_no = $2 LIMIT 1`,
        [jobNo, unitNo]
    );
    return result.rows.length > 0;
}

// Returns the job's master units as plain rows: [{ unit_no: '150', members: ['150','208',...] }]
async function getMastersForJob(jobNo) {
    const result = await pool.query(
        `SELECT master_unit_no, array_agg(unit_no ORDER BY unit_no) AS members
         FROM unit_master_map
         WHERE job_no = $1
         GROUP BY master_unit_no`,
        [jobNo]
    );
    return result.rows.map(r => ({ unit_no: r.master_unit_no, members: r.members }));
}

// Given raw user_assignments rows, adds a synthetic row for any master unit the
// user qualifies for (has a real assignment to at least one member of that group).
// Real assignments are never altered; synthetic rows are flagged is_master:true.
async function getAugmentedAssignments(rawRows) {
    if (!rawRows.length) return rawRows;

    const jobNos = [...new Set(rawRows.map(r => r.job_no))];
    const mapResult = await pool.query(
        `SELECT job_no, unit_no, master_unit_no FROM unit_master_map WHERE job_no = ANY($1::text[])`,
        [jobNos]
    );

    const unitToMaster = {};     // job_no -> { unit_no -> master_unit_no }
    const masterToMembers = {};  // job_no -> { master_unit_no -> [unit_no...] }

    mapResult.rows.forEach(r => {
        unitToMaster[r.job_no] = unitToMaster[r.job_no] || {};
        unitToMaster[r.job_no][r.unit_no] = r.master_unit_no;

        masterToMembers[r.job_no] = masterToMembers[r.job_no] || {};
        masterToMembers[r.job_no][r.master_unit_no] = masterToMembers[r.job_no][r.master_unit_no] || [];
        masterToMembers[r.job_no][r.master_unit_no].push(r.unit_no);
    });

    const seen = new Set(rawRows.map(r => `${r.job_no}::${r.unit_no}`));
    const virtualRows = [];

    rawRows.forEach(row => {
        const masterUnitNo = unitToMaster[row.job_no] && unitToMaster[row.job_no][row.unit_no];
        if (!masterUnitNo) return;

        const key = `${row.job_no}::${masterUnitNo}`;
        if (seen.has(key)) return; // already a real assignment, or already added
        seen.add(key);

        virtualRows.push({
            ...row,
            unit_no: masterUnitNo,
            is_master: true,
            master_members: masterToMembers[row.job_no][masterUnitNo].slice().sort()
        });
    });

    return [...rawRows, ...virtualRows];
}

module.exports = { getGroupMembers, getMasterFor, isMasterUnit, getMastersForJob, getAugmentedAssignments };
