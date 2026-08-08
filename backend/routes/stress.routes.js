const express = require('express');
const router = express.Router();
const { syncStressLines } = require('../services/stress.service');

router.get('/sync', async (req, res) => {
  try {
    const count = await syncStressLines();
    res.json({ ok: true, synced: count });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;