const { Pool } = require('pg');
require('dotenv').config();

const pimsPool = new Pool({
    host: process.env.PIMS_DB_HOST,
    port: parseInt(process.env.PIMS_DB_PORT, 10),
    database: process.env.PIMS_DB_NAME,
    user: process.env.PIMS_DB_USER,
    password: process.env.PIMS_DB_PASSWORD,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
});

pimsPool.on('error', (err) => {
    console.error('PIMS DB pool error:', err.message);
});

module.exports = pimsPool;