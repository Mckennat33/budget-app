import dotenv from 'dotenv'; import jwt from 'jsonwebtoken'; import pkg from 'pg'; dotenv.config();
const c = new pkg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
const userId = (await c.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0].id;
const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '1h' });
const H = { Authorization: `Bearer ${token}` };
if (Number((await c.query('SELECT COUNT(*) FROM transactions')).rows[0].count) !== 0) { console.log('NOT EMPTY - aborting'); process.exit(0); }
const M = 'ONEMONTH';
try {
  console.log('--- with ZERO statements ---');
  const empty = await (await fetch('http://localhost:3086/api/goals', { headers: H })).json();
  console.log('  hasData:', empty.hasData, '(page shows the empty-state card)');

  for (const r of [
    ['2026-07-01', `Check # 4151 ${M}`, -995, 'Other'],
    ['2026-07-02', `Comed ${M}`, -88.40, 'Rent & Utilities'],
    ['2026-07-10', `Coyote ${M}`, 2487.74, 'Other'],
    ['2026-07-05', `Tst* Frank ${M}`, -300, 'Dining Takeout'],
    ['2026-07-08', `Target ${M}`, -200, 'Shopping'],
    ['2026-07-12', `Jewel groceries ${M}`, -150, 'Groceries'],
  ]) await c.query('INSERT INTO transactions (user_id,transaction_date,description,amount,category) VALUES ($1,$2,$3,$4,$5)', [userId, ...r]);

  console.log('\n--- with ONE statement (July) ---');
  const one = await (await fetch('http://localhost:3086/api/goals', { headers: H })).json();
  console.log('  hasData        :', one.hasData);
  console.log('  anchor         :', one.anchorLabel);
  console.log('  ALLOWANCE      : day', one.flexibleDaily, '| week', one.flexibleWeekly, '| month', one.flexibleMonthly);
  console.log('  split          :', one.flexibleBreakdown.map(f => `${f.name} $${f.amount}`).join(', '));
  console.log('  prev month     :', one.previousDiscretionary, '(null = no goal progress possible yet)');
  console.log('  scorecard rows :', one.scorecard.length);
} finally {
  await c.query(`DELETE FROM transactions WHERE description LIKE '%${M}%'`);
  await c.query('DELETE FROM goal_settings WHERE user_id=$1', [userId]);
  console.log('\nCleaned up. transactions:', (await c.query('SELECT COUNT(*) FROM transactions')).rows[0].count);
  await c.end();
}
