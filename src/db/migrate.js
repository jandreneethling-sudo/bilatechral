require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(150) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('md', 'staff')),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS weighbridge_tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(30) NOT NULL UNIQUE,
        transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('supplier_offload', 'customer_load')),
        party_name VARCHAR(150) NOT NULL,
        truck_registration VARCHAR(30) NOT NULL,
        driver_name VARCHAR(100),
        ore_grade VARCHAR(50),
        tare_weight NUMERIC(12,3) NOT NULL CHECK (tare_weight >= 0),
        gross_weight NUMERIC(12,3) NOT NULL CHECK (gross_weight >= 0),
        net_weight NUMERIC(12,3) NOT NULL CHECK (net_weight >= 0),
        unit_price NUMERIC(12,2),
        total_amount NUMERIC(14,2),
        notes TEXT,
        captured_by_user_id INTEGER NOT NULL REFERENCES users(id),
        captured_by_name VARCHAR(150) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_number VARCHAR(30) NOT NULL UNIQUE,
        ticket_id INTEGER NOT NULL UNIQUE REFERENCES weighbridge_tickets(id) ON DELETE CASCADE,
        customer_name VARCHAR(150) NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid')),
        generated_by_user_id INTEGER NOT NULL REFERENCES users(id),
        generated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL UNIQUE REFERENCES weighbridge_tickets(id) ON DELETE CASCADE,
        supplier_name VARCHAR(150) NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
        processed_by_user_id INTEGER REFERENCES users(id),
        processed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_summary_email_logs (
        id SERIAL PRIMARY KEY,
        month_key VARCHAR(7) NOT NULL UNIQUE,
        sent_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
