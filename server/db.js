import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
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

    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      transaction_date DATE NOT NULL,
      description TEXT,
      amount NUMERIC NOT NULL,
      category TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- One row per user: the declared fixed costs the statements cannot identify
    -- on their own (rent arrives as an unlabelled check) plus the optional
    -- belt-tightening percentage applied to the discretionary budget.
    CREATE TABLE IF NOT EXISTS goal_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      declared_rent NUMERIC NOT NULL DEFAULT 0,
      reduction_percent INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Capped at two per user by the API, not by a constraint, so the limit can
    -- be raised without a migration.
    CREATE TABLE IF NOT EXISTS savings_goals (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_amount NUMERIC NOT NULL,
      target_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- One row per upload, so a statement can be removed again along with everything
    -- it brought in. Transactions uploaded before this existed have a NULL
    -- statement_id and are removed by month instead.
    CREATE TABLE IF NOT EXISTS statements (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      transaction_count INTEGER NOT NULL DEFAULT 0,
      period_start DATE,
      period_end DATE,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS statement_id INTEGER REFERENCES statements(id) ON DELETE CASCADE;
  `);
}

export default pool;
