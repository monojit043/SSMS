// Sign-in for SSMS — one account for every module (eil_employees on PC-2) and the
// shared single sign-on cookie. Roles come from effective_assignments (services/liveUser).
const express = require('express');
const router = express.Router();
const sso = require('../utils/sso');
const { checkCredentials, getAssignments } = require('../services/liveUser');

const NO_ACCESS = 'You have no SSMS role yet. Ask your Group Leader to add you to a job.';

router.post('/login', async (req, res) => {
    try {
        const { employee_id, password } = req.body || {};
        if (!employee_id || !password) {
            return res.json({ ok: false, error: 'Employee ID and password required' });
        }
        const id = await checkCredentials(String(employee_id).trim(), String(password));
        if (!id) return res.json({ ok: false, error: 'Invalid Employee ID or password' });

        const assignments = await getAssignments(id);
        if (!assignments.length) return res.status(403).json({ ok: false, error: NO_ACCESS });

        sso.setCookie(res, id);
        return res.json({ ok: true, data: assignments });
    } catch (err) {
        console.error('login:', err.message);
        return res.status(503).json({ ok: false, error: 'Employee server (PC-2) is unreachable. Please try again shortly.' });
    }
});

router.post('/logout', (req, res) => {
    sso.clearCookie(res);
    res.json({ ok: true });
});

// The signed-in user's current assignments. Also used by the login page to pick up an
// existing single sign-on session (signed in through ePULSE / MRCS).
router.get('/assignments', async (req, res) => {
    try {
        const assignments = await getAssignments(req.user.employeeId);
        if (!assignments.length) return res.status(403).json({ ok: false, error: NO_ACCESS });
        res.json({ ok: true, data: assignments, user: req.user });
    } catch (err) {
        console.error('assignments:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.put('/change-password', (req, res) => {
    res.status(403).json({ ok: false, error: 'Passwords are managed centrally (one account for all modules). Please contact ITS.' });
});

module.exports = router;
