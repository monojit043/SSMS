const cron = require('node-cron');
const { syncStressLines } = require('../services/stress.service');
const { syncPimsLines } = require('../services/pims-stress.service');

const startStressSync = () => {
    // Both syncs persist into stress_lines every 10 min.
    // PIMS is also queried live on every /stress-lines request for zero-lag dropdown.
    cron.schedule('*/10 * * * *', async () => {
        console.log(`Running stress sync at: ${new Date().toISOString()}`);

        try {
            const count = await syncStressLines();
            console.log(`[3000] Synced ${count} lines`);
        } catch (err) {
            console.error('[3000] Sync failed:', err.message);
        }

        try {
            const { total, inserted, skipped } = await syncPimsLines();
            console.log(`[PIMS] Synced ${total} lines (${inserted} upserted, ${skipped} skipped)`);
        } catch (err) {
            console.error('[PIMS] Sync failed:', err.message);
        }
    });
};

module.exports = { startStressSync };