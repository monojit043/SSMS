const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const { getAugmentedAssignments } = require('../utils/unitGroups');

router.post('/login', async (req, res) => {
    try {
        const { employee_id, password } = req.body;

        if (!employee_id || !password) {
            return res.json({ ok: false, error: "Employee ID and password required" });
        }

        const result = await pool.query(
            `SELECT ua.*, me.employee_name
             FROM user_assignments ua
             LEFT JOIN master_employees me ON ua.employee_id = me.employee_id
             WHERE ua.employee_id = $1`,
            [employee_id]
        );

        if (result.rows.length === 0) {
            return res.json({ ok: false, error: "Invalid Employee ID or password" });
        }

        const storedPassword = result.rows[0].password;

        if (!storedPassword || storedPassword !== password) {
            return res.json({ ok: false, error: "Invalid Employee ID or password" });
        }

        const augmented = await getAugmentedAssignments(result.rows);

        return res.json({
            ok: true,
            data: augmented
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ ok: false, error: "Server error" });
    }
});

// Re-fetch this employee's assignments (including any newly created master
// units) without requiring a fresh login.
router.get('/assignments', async (req, res) => {
    try {
        const { employee_id } = req.query;
        if (!employee_id) {
            return res.status(400).json({ ok: false, error: 'employee_id is required' });
        }

        const result = await pool.query(
            `SELECT ua.*, me.employee_name
             FROM user_assignments ua
             LEFT JOIN master_employees me ON ua.employee_id = me.employee_id
             WHERE ua.employee_id = $1`,
            [employee_id]
        );

        const augmented = await getAugmentedAssignments(result.rows);
        res.json({ ok: true, data: augmented });

    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.put('/change-password', async (req, res) => {
    try {
        const { employee_id, currentPassword, newPassword } = req.body;
        if (!employee_id || !currentPassword || !newPassword) {
            return res.json({ ok: false, error: 'All fields are required' });
        }
        if (newPassword.length < 4) {
            return res.json({ ok: false, error: 'New password must be at least 4 characters' });
        }

        const result = await pool.query(
            'SELECT password FROM user_assignments WHERE employee_id = $1',
            [employee_id]
        );
        if (result.rows.length === 0) {
            return res.json({ ok: false, error: 'User not found' });
        }
        if (result.rows[0].password !== currentPassword) {
            return res.json({ ok: false, error: 'Current password is incorrect' });
        }

        await pool.query(
            'UPDATE user_assignments SET password = $1 WHERE employee_id = $2',
            [newPassword, employee_id]
        );
        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

module.exports = router;
