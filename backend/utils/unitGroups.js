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

// Every unit belonging to the groups of the given units (a master expands to all its members).
async function expandUnits(jobNo, unitNos) {
    const result = await pool.query(
        `SELECT DISTINCT m.unit_no FROM unit_master_map m
         WHERE m.job_no = $1 AND m.master_unit_no IN (
             SELECT master_unit_no FROM unit_master_map WHERE job_no = $1 AND unit_no = ANY($2::text[]))`,
        [jobNo, unitNos]
    );
    return [...new Set([...unitNos, ...result.rows.map(r => r.unit_no)])].sort();
}

module.exports = { getGroupMembers, getMasterFor, isMasterUnit, expandUnits };
