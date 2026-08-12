import dotenv from 'dotenv';
import pkg from 'pg';

dotenv.config();
const { Client } = pkg;

function parseAmountFromText(text) {
  const match = text.match(/(-?\(?\$?[\d,]+\.\d{2}\)?)/);
  if (!match) return null;
  let s = match[1];
  const negative = s.includes('(') || s.includes('-');
  s = s.replace(/[()\$\s]/g, '').replace(/,/g, '');
  const v = parseFloat(s);
  if (Number.isNaN(v)) return null;
  return negative ? -Math.abs(v) : v;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query('SELECT id, user_id, transaction_date, description, amount FROM transactions ORDER BY transaction_date DESC LIMIT 1000');
    const diffs = [];
    for (const r of rows.rows) {
      const extracted = parseAmountFromText(r.description || '');
      if (extracted === null) continue;
      const stored = parseFloat(r.amount);
      if (Number.isNaN(stored)) continue;
      if (Math.abs(stored - extracted) > 0.01) {
        diffs.push({ id: r.id, user_id: r.user_id, date: r.transaction_date, description: r.description.slice(0, 120), stored, extracted });
      }
    }
    console.log(`Found ${diffs.length} potential mismatches (showing up to 20):`);
    console.log(JSON.stringify(diffs.slice(0, 20), null, 2));
  } catch (err) {
    console.error('Preview failed:', err.message || err);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
