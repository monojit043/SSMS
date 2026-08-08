const pimsPool = require('../db/pims-db');
const localPool = require('../db/db');

// Strip trailing single-letter suffix: P-111-12345-A → P-111-12345
function normaliseLineNo(rawLineNo) {
    if (!rawLineNo) return rawLineNo;
    return rawLineNo.trim().replace(/-[A-Za-z]$/, '');
}

const syncPimsLines = async () => {
    try {

        const { rows } = await pimsPool.query(
            `SELECT job_no, unit_no, line_no, stress_system
             FROM drawings
             WHERE stress_critical = 'Y'
               AND job_no IS NOT NULL
               AND unit_no IS NOT NULL
               AND line_no IS NOT NULL`
        );

        let inserted = 0;
        let skipped = 0;

        for (const row of rows) {

            const lineId = normaliseLineNo(row.line_no);

            const result = await localPool.query(
                `INSERT INTO stress_lines
                   (job_no, unit_no, line_id, stress_system, last_synced_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (job_no, unit_no, line_id) DO UPDATE
                   SET stress_system = COALESCE(
                         NULLIF(EXCLUDED.stress_system, ''),
                         stress_lines.stress_system
                       ),
                       last_synced_at = NOW()
                 WHERE stress_lines.stress_eng_id IS NULL
                    OR stress_lines.stress_eng_id = ''`,
                [
                    row.job_no,
                    row.unit_no,
                    lineId,
                    row.stress_system || ''
                ]
            );

            if (result.rowCount > 0) {
                inserted++;
            } else {
                skipped++;
            }
        }

        console.log(
            `PIMS sync: ${inserted} upserted, ${skipped} skipped`
        );

        return {
            total: rows.length,
            inserted,
            skipped
        };

    } catch (err) {

        console.error('===== PIMS ERROR =====');
        console.error(err);
        console.error(err.stack);

        throw err;
    }
};

module.exports = { syncPimsLines };
