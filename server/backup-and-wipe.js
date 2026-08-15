// One-off maintenance script: exports every transaction to a timestamped CSV in
// server/, then deletes all transaction rows so statements can be re-imported with
// the corrected PDF parser. Run with: node server/backup-and-wipe.js
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';

dotenv.config();
const { Client } = pkg;
const here = path.dirname(fileURLToPath(import.meta.url));

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const { rows } = await client.query(
      `SELECT id, user_id, transaction_date, description, amount, category, created_at
         FROM transactions ORDER BY id`
    );

    if (rows.length === 0) {
      console.log('No transactions to back up. Nothing to do.');
      return;
    }

    const header = ['id', 'user_id', 'transaction_date', 'description', 'amount', 'category', 'created_at'];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(header.map((key) => csvCell(row[key])).join(','));
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(here, `transactions-backup-${stamp}.csv`);
    await fs.writeFile(backupPath, lines.join('\n'), 'utf8');
    console.log(`Backed up ${rows.length} transactions to ${backupPath}`);

    const deleted = await client.query('DELETE FROM transactions');
    console.log(`Deleted ${deleted.rowCount} transactions. Re-upload your statements to repopulate.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Backup/wipe failed:', error.message || error);
  process.exit(1);
});
