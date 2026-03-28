const { Pool } = require('pg');

// Parse DATABASE_URL and force IPv4 (127.0.0.1) instead of localhost
// This fixes cPanel PostgreSQL pg_hba.conf IPv6 issues
let connectionConfig = {
  connectionString: process.env.DATABASE_URL
};

// If DATABASE_URL contains localhost, replace with 127.0.0.1
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')) {
  connectionConfig.connectionString = process.env.DATABASE_URL.replace('localhost', '127.0.0.1');
}

const pool = new Pool(connectionConfig);

// Log connection errors but don't crash the app
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

module.exports = pool;
