const axios = require('axios');
const pool = require('../db/db');

const syncStressLines = async () => {
  const response = await axios.get(
    `${process.env.OLD_API_URL}/api/stress/lines`
  );

  const lines = response.data.data;

  for (const line of lines) {
    // Skip rows with missing conflict keys — NULLs bypass ON CONFLICT
    if (!line.jobNo || !line.unitNo || !line.line_id) continue;

    await pool.query(
      `INSERT INTO stress_lines 
      (job_no, unit_no, line_id, stress_system, dept, stress_eng_id, stress_eng_name, uploaded_by, uploaded_on, last_synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (job_no, unit_no, line_id)
      DO UPDATE SET
        stress_system = EXCLUDED.stress_system,
        dept = EXCLUDED.dept,
        stress_eng_id = EXCLUDED.stress_eng_id,
        stress_eng_name = EXCLUDED.stress_eng_name,
        uploaded_on = EXCLUDED.uploaded_on,
        last_synced_at = NOW()
      `,
      [
        line.jobNo,
        line.unitNo,
        line.line_id,
        line.stress_system,
        line.dept,
        line.stress_eng_id,
        line.stress_eng_name,
        line.stress_index_uploaded_by,
        line.stress_index_uploaded_on
      ]
    );
  }

  return lines.length;
};

module.exports = { syncStressLines };