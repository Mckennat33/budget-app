import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Client } = pkg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const counts = await client.query(
      `SELECT user_id, COUNT(*) AS cnt, SUM(amount) AS total
       FROM transactions
       GROUP BY user_id
       ORDER BY cnt DESC`
    );
    console.log('Counts by user:');
    console.log(JSON.stringify(counts.rows, null, 2));

    const recent = await client.query(
      `SELECT id, user_id, transaction_date, description, amount, category
       FROM transactions
       ORDER BY transaction_date DESC
       LIMIT 20`
    );
    console.log('Recent transactions:');
    console.log(JSON.stringify(recent.rows, null, 2));
  } catch (err) {
    console.error('DB check failed:', err.message || err);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
