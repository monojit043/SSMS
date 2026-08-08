const express = require('express');
const router  = express.Router();
const pool    = require('../db/db');

// GET all notes for a job/unit
router.get('/', async (req, res) => {
    const { jobNo, unitNo } = req.query;
    if (!jobNo || !unitNo) return res.json({ ok: false, error: 'Missing params' });
    try {
        const r = await pool.query(
            `SELECT * FROM spring_notes WHERE job_no=$1 AND unit_no=$2 ORDER BY note_number ASC`,
            [jobNo, unitNo]
        );
        res.json({ ok: true, data: r.rows });
    } catch (err) {
        console.error('Notes GET:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST — add a new note
router.post('/', async (req, res) => {
    const { jobNo, unitNo, noteText, createdBy, role } = req.body;
    if (!jobNo || !unitNo || !noteText?.trim()) return res.json({ ok: false, error: 'Missing fields' });
    try {
        const maxRes = await pool.query(
            `SELECT COALESCE(MAX(note_number), 0) AS max_num FROM spring_notes WHERE job_no=$1 AND unit_no=$2`,
            [jobNo, unitNo]
        );
        const noteNumber = maxRes.rows[0].max_num + 1;

        const r = await pool.query(
            `INSERT INTO spring_notes (job_no, unit_no, note_text, created_by, role, note_number)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [jobNo, unitNo, noteText.trim(), createdBy || '', role || '', noteNumber]
        );
        res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        console.error('Notes POST:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// PUT — edit note text
router.put('/:id', async (req, res) => {
    const { noteText } = req.body;
    if (!noteText?.trim()) return res.json({ ok: false, error: 'Note text is required' });
    try {
        const r = await pool.query(
            `UPDATE spring_notes SET note_text=$1 WHERE id=$2 RETURNING *`,
            [noteText.trim(), req.params.id]
        );
        if (r.rowCount === 0) return res.json({ ok: false, error: 'Note not found' });
        res.json({ ok: true, data: r.rows[0] });
    } catch (err) {
        console.error('Notes PUT:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// DELETE — remove a note by id
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM spring_notes WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        console.error('Notes DELETE:', err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
