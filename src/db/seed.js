require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    const users = [
      {
        fullName: 'Freddy Mkhabela',
        email: 'freddy.admin@bilatechral.co.za',
        password: 'Admin@123',
        role: 'md'
      },
      {
        fullName: 'Bilatechral Staff',
        email: 'staff@bilatechral.co.za',
        password: 'Staff@123',
        role: 'staff'
      }
    ];

    for (const user of users) {
      const hash = await bcrypt.hash(user.password, 10);
      await client.query(
        `
          INSERT INTO users (full_name, email, password_hash, role)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (email) DO NOTHING
        `,
        [user.fullName, user.email, hash, user.role]
      );
    }

    console.log('Seed completed successfully.');
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
