import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import pkg from 'pg';

dotenv.config();
const { Client } = pkg;

function parseAmountFromText(text) {
  const match = text.match(/(-?\(?\$?[\d,]+\.\d{2}\)?)/);
  if (!match) return null;
  let s = match[1];
  const negative = s.includes('(') || s.includes('-') && !/\d-\d/.test(s);
  s = s.replace(/[()\$\s]/g, '').replace(/,/g, '');
  const v = parseFloat(s);
  if (Number.isNaN(v)) return null;
  return negative ? -Math.abs(v) : v;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const rows = await client.query('SELECT id, user_id, transaction_date, description, amount FROM transactions');
    const diffs = [];
    for (const r of rows.rows) {
      const extracted = parseAmountFromText(r.description || '');
      if (extracted === null) continue;
      const stored = parseFloat(r.amount);
      if (Number.isNaN(stored)) continue;
      if (Math.abs(stored - extracted) > 0.01) {
        diffs.push({ id: r.id, user_id: r.user_id, date: r.transaction_date, description: (r.description || '').replace(/\n/g, ' '), stored, extracted });
      }
    }

    if (diffs.length === 0) {
      console.log('No mismatches found. Nothing to do.');
      await client.end();
      return;
    }

    const backupName = `amount-fix-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    const backupPath = path.join(process.cwd(), 'server', backupName);
    const header = 'id,user_id,transaction_date,stored,extracted,description\n';
    const lines = diffs.map(d => `${d.id},${d.user_id},"${d.date.toISOString()}",${d.stored},${d.extracted},"${d.description.replace(/"/g, '""')}"`).join('\n');
    fs.writeFileSync(backupPath, header + lines, 'utf8');
    console.log(`Wrote backup of ${diffs.length} rows to ${backupPath}`);

    await client.query('BEGIN');
    let updated = 0;
    for (const d of diffs) {
      const res = await client.query('UPDATE transactions SET amount = $1 WHERE id = $2', [d.extracted, d.id]);
      updated += res.rowCount || 0;
    }
    await client.query('COMMIT');

    console.log(`Updated ${updated} rows.`);
    console.log('Done.');
  } catch (err) {
    console.error('Apply failed:', err.message || err);
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
