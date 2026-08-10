import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './auth.js';
import { authMiddleware } from './authMiddleware.js';
import { ensureSchema, initializeDb, query } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));
app.use('/api/auth', authRoutes);

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

app.post('/api/upload', authMiddleware, upload.single('statement'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!query) {
    return res.status(503).json({ error: 'Database unavailable.' });
  }

  try {
    const contents = await fs.readFile(req.file.path, 'utf8');
    await fs.unlink(req.file.path).catch(() => {});

    const lines = contents.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'Statement file contains no transactions.' });
    }

    const header = parseCsvLine(lines.shift());
    const normalizedHeader = header.map((cell) => cell.toLowerCase().trim());
    const dateIndex = normalizedHeader.indexOf('date');
    const descriptionIndex = normalizedHeader.indexOf('description');
    const amountIndex = normalizedHeader.indexOf('amount');
    const categoryIndex = normalizedHeader.indexOf('category');

    if (dateIndex === -1 || amountIndex === -1 || categoryIndex === -1) {
      return res.status(400).json({
        error: 'CSV must include at least date, amount, and category columns.',
      });
    }

    const transactions = [];
    for (const line of lines) {
      const cells = parseCsvLine(line);
      const rawDate = cells[dateIndex];
      const rawAmount = cells[amountIndex];
      const rawCategory = cells[categoryIndex] || 'Other';
      const description = descriptionIndex !== -1 ? cells[descriptionIndex] || '' : '';

      if (!rawDate || !rawAmount) continue;
      const amount = parseFloat(rawAmount.replace(/[^0-9.-]/g, ''));
      if (Number.isNaN(amount)) continue;

      transactions.push({
        date: rawDate,
        description,
        amount,
        category: rawCategory || 'Other',
      });
    }

    if (transactions.length === 0) {
      return res.status(400).json({ error: 'No valid transactions were found in the statement.' });
    }

    await query('BEGIN');
    const insertText = 'INSERT INTO transactions (user_id, transaction_date, description, amount, category) VALUES ($1, $2, $3, $4, $5)';
    for (const transaction of transactions) {
      await query(insertText, [req.user.sub, transaction.date, transaction.description, transaction.amount, transaction.category]);
    }
    await query('COMMIT');

    return res.json({ message: 'Uploaded successfully', count: transactions.length });
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    console.error('Upload failed:', error);
    return res.status(500).json({ error: 'Upload failed. Please check the file format and try again.' });
  }
});

app.get('/api/overview', authMiddleware, async (req, res) => {
  if (!query) {
    return res.status(503).json({ error: 'Database unavailable.' });
  }

  try {
    const userId = req.user.sub;
    const months = [];
    const now = new Date();

    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const label = date.toLocaleString('default', { month: 'short' });
      months.push({ label, start: date.toISOString().slice(0, 10), value: 0 });
    }

    const trendRows = await query(
      `SELECT date_trunc('month', transaction_date) AS month_start,
              SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend
         FROM transactions
        WHERE user_id = $1
          AND transaction_date >= date_trunc('month', current_date) - INTERVAL '5 months'
        GROUP BY month_start
        ORDER BY month_start`,
      [userId]
    );

    const trendMap = new Map(trendRows.rows.map((row) => [row.month_start.toISOString().slice(0, 10), Number(row.spend || 0)]));
    const trendData = months.map((month) => ({ label: month.label, value: trendMap.get(month.start) || 0 }));

    const totalsRow = await query(
      `SELECT
         SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend,
         SUM(amount) FILTER (WHERE amount > 0) AS income
       FROM transactions
      WHERE user_id = $1
        AND date_trunc('month', transaction_date) = date_trunc('month', current_date)`,
      [userId]
    );
    const totals = totalsRow.rows[0] || { spend: 0, income: 0 };

    const prevRow = await query(
      `SELECT
         SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend,
         SUM(amount) FILTER (WHERE amount > 0) AS income
       FROM transactions
      WHERE user_id = $1
        AND date_trunc('month', transaction_date) = date_trunc('month', current_date - INTERVAL '1 month')`,
      [userId]
    );
    const prevTotals = prevRow.rows[0] || { spend: 0, income: 0 };

    const calcChange = (current, previous) => {
      if (!previous || previous === 0) {
        return current === 0 ? 0 : 100;
      }
      return Math.round(((current - previous) / Math.abs(previous)) * 100);
    };

    const categoriesRows = await query(
      `SELECT category, SUM(amount) * -1 AS spend
       FROM transactions
      WHERE user_id = $1
        AND date_trunc('month', transaction_date) = date_trunc('month', current_date)
        AND amount < 0
      GROUP BY category
      ORDER BY spend DESC`,
      [userId]
    );

    const requestedCategories = [
      'Dining Takeout',
      'Shopping',
      'Other',
      'Groceries',
      'Transport',
      'Subscriptions',
      'Rent & Utilities',
      'Health & Fitness',
    ];

    const categoryMap = new Map(categoriesRows.rows.map((row) => [row.category, Number(row.spend || 0)]));
    const categories = requestedCategories.map((name) => ({
      name,
      amount: categoryMap.get(name) || 0,
      change: 0,
    }));

    return res.json({
      totalSpend: Number(totals.spend || 0),
      totalIncome: Number(totals.income || 0),
      spendChange: calcChange(Number(totals.spend || 0), Number(prevTotals.spend || 0)),
      incomeChange: calcChange(Number(totals.income || 0), Number(prevTotals.income || 0)),
      trendData,
      categories,
    });
  } catch (error) {
    console.error('Overview fetch failed:', error);
    return res.status(500).json({ error: 'Unable to load overview data.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const port = process.env.PORT ?? 3000;

initializeDb()
  .then(async (dbReady) => {
    if (dbReady) {
      await ensureSchema();
      console.log('PostgreSQL database connected.');
    } else {
      console.log('PostgreSQL unavailable. Running with in-memory auth fallback.');
    }

    app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
  });
