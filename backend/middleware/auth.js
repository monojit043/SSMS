// SSMS server-side security (added 2026-10-18 — before this the server trusted the browser).
//
//  requireAuth    — every /api call must carry the shared single sign-on cookie (utils/sso.js).
//                   The user is read live from PC-2; req.user = { employeeId, fullName, department }.
//  stampIdentity  — "who did it" fields in the body (created_by, reviewed_by, …) are always
//                   overwritten with the signed-in user, so nobody can act as someone else.
//  require*Role   — the caller must hold one of the given roles ON THAT job / master unit.
//
// Role sets used by the routes:
//   READ   JE LE GL MAT   — view lists, exports, dashboards
//   EDIT   JE LE GL       — create / edit / submit / delete springs
//   REVIEW LE GL          — approve / reject springs
//   MAT    MAT GL         — material work: bids, vendor data
const pool = require('../db/db');
const sso = require('../utils/sso');
const { loadLiveUser, rolesOnUnit, rolesOnJob } = require('../services/liveUser');

const ROLES = {
    READ:   ['JE', 'LE', 'GL', 'MAT'],
    EDIT:   ['JE', 'LE', 'GL'],
    REVIEW: ['LE', 'GL'],
    MR:     ['LE', 'GL', 'MAT'],
    MAT:    ['MAT', 'GL'],
};

const PUBLIC_API = new Set(['/auth/login', '/auth/logout']);

async function requireAuth(req, res, next) {
    if (PUBLIC_API.has(req.path)) return next();
    const employeeId = sso.currentUserId(req);
    if (!employeeId) return res.status(401).json({ ok: false, error: 'Not signed in. Please sign in again.' });
    try {
        const user = await loadLiveUser(employeeId);
        if (!user) {
            sso.clearCookie(res);
            return res.status(401).json({ ok: false, error: 'Your account is no longer active. Please contact ITS.' });
        }
        req.user = user;
        next();
    } catch (err) {
        console.error('requireAuth: PC-2 unreachable:', err.message);
        res.status(503).json({ ok: false, error: 'Employee server (PC-2) is unreachable. Please try again shortly.' });
    }
}

const IDENTITY_FIELDS = ['created_by', 'createdBy', 'reviewed_by', 'reviewedBy', 'uploaded_by', 'uploadedBy', 'locked_by', 'lockedBy'];

function stampIdentity(req, res, next) {
    if (req.user && req.body && typeof req.body === 'object' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        for (const f of IDENTITY_FIELDS) req.body[f] = req.user.employeeId;
    }
    next();
}

const pick = (req, ...keys) => {
    const src = { ...(req.query || {}), ...(req.body || {}) };
    for (const k of keys) if (src[k]) return String(src[k]);
    return '';
};

function denied(res, roles, where) {
    return res.status(403).json({ ok: false, error: `Access denied: you need ${roles.join(' / ')} on ${where}` });
}

// Role on the job + unit named in the request (jobNo / unitNo, query or body)
function requireUnitRole(roles) {
    return async (req, res, next) => {
        const jobNo = pick(req, 'jobNo', 'job_no'), unitNo = pick(req, 'unitNo', 'unit_no');
        if (!jobNo || !unitNo) return res.status(400).json({ ok: false, error: 'jobNo and unitNo are required' });
        try {
            const mine = await rolesOnUnit(req.user.employeeId, jobNo, unitNo);
            if (mine.some(r => roles.includes(r))) { req.userRoles = mine; return next(); }
            return denied(res, roles, `${jobNo} / ${unitNo}`);
        } catch (err) {
            console.error('requireUnitRole:', err.message);
            res.status(500).json({ ok: false, error: 'Access check failed' });
        }
    };
}

// Role anywhere on the job named in the request (job-level features)
function requireJobRole(roles) {
    return async (req, res, next) => {
        const jobNo = pick(req, 'jobNo', 'job_no');
        if (!jobNo) return res.status(400).json({ ok: false, error: 'jobNo is required' });
        try {
            const mine = await rolesOnJob(req.user.employeeId, jobNo);
            if (mine.some(r => roles.includes(r))) return next();
            return denied(res, roles, `job ${jobNo}`);
        } catch (err) {
            console.error('requireJobRole:', err.message);
            res.status(500).json({ ok: false, error: 'Access check failed' });
        }
    };
}

// Role on the job + unit of a spring. idOf(req) returns the spring_details id.
async function checkSpring(req, res, roles, id) {
    const { rows } = await pool.query('SELECT job_no, unit_no FROM spring_details WHERE id = $1', [id]);
    if (!rows[0]) { res.status(404).json({ ok: false, error: 'Spring not found' }); return false; }
    const mine = await rolesOnUnit(req.user.employeeId, rows[0].job_no, rows[0].unit_no);
    if (mine.some(r => roles.includes(r))) return true;
    denied(res, roles, `${rows[0].job_no} / ${rows[0].unit_no}`);
    return false;
}

function requireSpringRole(roles, idOf = (req) => req.params.id) {
    return async (req, res, next) => {
        let id;
        try { id = await idOf(req); } catch (err) { return res.status(500).json({ ok: false, error: 'Access check failed' }); }
        if (id === undefined || id === null || id === '') return res.status(400).json({ ok: false, error: 'Spring id is required' });
        try {
            if (await checkSpring(req, res, roles, id)) next();
        } catch (err) {
            console.error('requireSpringRole:', err.message);
            res.status(500).json({ ok: false, error: 'Access check failed' });
        }
    };
}

// Every spring in req.body.ids (bulk actions) — all must pass, or nothing happens
function requireSpringsRole(roles) {
    return async (req, res, next) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
        if (!ids.length) return res.status(400).json({ ok: false, error: 'ids are required' });
        try {
            const { rows } = await pool.query(
                'SELECT DISTINCT job_no, unit_no FROM spring_details WHERE id = ANY($1::int[])', [ids]
            );
            for (const r of rows) {
                const mine = await rolesOnUnit(req.user.employeeId, r.job_no, r.unit_no);
                if (!mine.some(x => roles.includes(x))) return denied(res, roles, `${r.job_no} / ${r.unit_no}`);
            }
            next();
        } catch (err) {
            console.error('requireSpringsRole:', err.message);
            res.status(500).json({ ok: false, error: 'Access check failed' });
        }
    };
}

// List / export scope: jobNo plus unitNo, or unitNos (comma list, Spring Index) — every unit must pass
function requireScopeRole(roles) {
    return async (req, res, next) => {
        const jobNo = pick(req, 'jobNo');
        const units = pick(req, 'unitNos').split(',').map(u => u.trim()).filter(Boolean);
        if (!units.length && pick(req, 'unitNo')) units.push(pick(req, 'unitNo'));
        if (!jobNo || !units.length) return res.status(400).json({ ok: false, error: 'jobNo and unitNo (or unitNos) are required' });
        try {
            for (const u of units) {
                const mine = await rolesOnUnit(req.user.employeeId, jobNo, u);
                if (!mine.some(r => roles.includes(r))) return denied(res, roles, `${jobNo} / ${u}`);
            }
            next();
        } catch (err) {
            console.error('requireScopeRole:', err.message);
            res.status(500).json({ ok: false, error: 'Access check failed' });
        }
    };
}

// Every spring with one of the given tags (MR assign / drop, bid data). tagsOf(req) → [tags]
function requireTagsRole(roles, tagsOf) {
    return async (req, res, next) => {
        const tags = (tagsOf(req) || []).filter(Boolean).map(String);
        if (!tags.length) return res.status(400).json({ ok: false, error: 'springTags are required' });
        try {
            const { rows } = await pool.query(
                'SELECT DISTINCT job_no, unit_no FROM spring_details WHERE spring_tag = ANY($1::text[])', [tags]
            );
            if (!rows.length) return res.status(404).json({ ok: false, error: 'Spring not found' });
            for (const r of rows) {
                const mine = await rolesOnUnit(req.user.employeeId, r.job_no, r.unit_no);
                if (!mine.some(x => roles.includes(x))) return denied(res, roles, `${r.job_no} / ${r.unit_no}`);
            }
            next();
        } catch (err) {
            console.error('requireTagsRole:', err.message);
            res.status(500).json({ ok: false, error: 'Access check failed' });
        }
    };
}

module.exports = {
    ROLES, requireAuth, stampIdentity,
    requireUnitRole, requireJobRole, requireSpringRole, requireSpringsRole, requireScopeRole, requireTagsRole,
};
