// One-off repair for data imported before three parser bugs were fixed:
//   1. December rows stamped with the following year, landing in the future
//   2. Chase's converted-check boilerplate parsed as a positive mirror of the check
//   3. Qapital (a savings app) counted as income rather than a transfer
// Also recategorises Target as Groceries. Backs up to CSV first.
// Run with: node server/repair-statement-data.js
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
      console.log('No transactions to repair.');
      return;
    }

    const header = ['id', 'user_id', 'transaction_date', 'description', 'amount', 'category', 'created_at'];
    const lines = [header.join(',')];
    for (const row of rows) lines.push(header.map((key) => csvCell(row[key])).join(','));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(here, `transactions-before-repair-${stamp}.csv`);
    await fs.writeFile(backupPath, lines.join('\n'), 'utf8');
    console.log(`Backed up ${rows.length} transactions to ${path.basename(backupPath)}\n`);

    await client.query('BEGIN');

    // 1. Anything dated in the future came from a statement that rolled over the year.
    const shifted = await client.query(
      `UPDATE transactions
          SET transaction_date = transaction_date - INTERVAL '1 year'
        WHERE transaction_date > CURRENT_DATE
        RETURNING id`
    );
    console.log(`1. Moved ${shifted.rowCount} future-dated transactions back one year`);

    // 2. The boilerplate paragraph is not a transaction.
    const boilerplate = await client.query(
      `DELETE FROM transactions
        WHERE description ~* 'if you see a check description|image of this check|converted for electronic payment'
        RETURNING amount`
    );
    console.log(`2. Deleted ${boilerplate.rowCount} boilerplate rows (phantom income)`);

    // 3. Qapital moves money between the user's own accounts.
    const qapital = await client.query(
      `UPDATE transactions SET category = 'Transfer'
        WHERE description ~* 'qapital' AND category <> 'Transfer'
        RETURNING id`
    );
    console.log(`3. Recategorised ${qapital.rowCount} Qapital rows as Transfer`);

    // 4. Target is where the groceries get bought.
    const target = await client.query(
      `UPDATE transactions SET category = 'Groceries'
        WHERE description ~* '\\mtarget\\M' AND category <> 'Groceries'
        RETURNING id`
    );
    console.log(`4. Recategorised ${target.rowCount} Target rows as Groceries`);

    await client.query('COMMIT');

    const after = await client.query(
      `SELECT to_char(date_trunc('month', transaction_date),'YYYY-MM') AS month,
              COUNT(*) AS n,
              SUM(amount) FILTER (WHERE amount > 0 AND category <> 'Transfer') AS income,
              SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend
         FROM transactions GROUP BY month ORDER BY month`
    );
    console.log('\nAfter repair:');
    console.table(after.rows);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Repair failed:', error.message || error);
  process.exit(1);
});
