import pkg from 'pg';
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL || '';
let pool = connectionString ? new Pool({ connectionString }) : null;
export let dbAvailable = false;

export async function initializeDb() {
  if (!pool) {
    dbAvailable = false;
    return false;
  }

  try {
    const client = await pool.connect();
    client.release();
    dbAvailable = true;
    return true;
  } catch (error) {
    console.warn('Database connection unavailable, falling back to in-memory auth:', error.message);
    pool = null;
    dbAvailable = false;
    return false;
  }
}

export async function query(text, params) {
  if (!pool) {
    throw new Error('Database is not configured.');
  }
  return pool.query(text, params);
}

export async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export default pool;
