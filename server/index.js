import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './auth.js';
import { authMiddleware } from './authMiddleware.js';
import { ensureSchema, initializeDb, query, dbAvailable } from './db.js';

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

function normalizeDate(rawDate, fallbackYear = new Date().getFullYear()) {
  let cleaned = rawDate
    .replace(/\./g, '/')
    .replace(/-/g, '/')
    .replace(/(st|nd|rd|th)/gi, '')
    .trim();

  const numericDateMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (numericDateMatch) {
    let [, a, b, c] = numericDateMatch;
    if (!c) c = `${fallbackYear}`;
    if (c.length === 2) c = `20${c}`;
    let month = a;
    let day = b;
    if (parseInt(month, 10) > 12) {
      month = b;
      day = a;
    }
    // sanity check — reject impossible month/day combos (prevents parsing amounts like 02.67 as dates)
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    if (Number.isNaN(m) || Number.isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) {
      return null;
    }
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    return `${c}-${month}-${day}`;
  }

  const monthNameDateMatch = cleaned.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthNameDateMatch) {
    const parsed = new Date(cleaned);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  const dayMonthNameDateMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dayMonthNameDateMatch) {
    const parsed = new Date(cleaned);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeAmount(rawAmount) {
  let cleaned = rawAmount.replace(/[^0-9,\.\-()]/g, '').trim();
  const negative = cleaned.includes('(') && cleaned.includes(')');
  cleaned = cleaned.replace(/[()]/g, '');
  cleaned = cleaned.replace(/,/g, '');
  const value = parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return negative ? -Math.abs(value) : value;
}

function guessCategory(description) {
  const text = description.toLowerCase();
  if (/groc|supermarket|whole foods|costco|walmart|aldi|trader joe|instacart|safeway|kroger|publix|sprouts/i.test(text)) {
    return 'Groceries';
  }
  if (/uber|lyft|taxi|bus|train|divvy|transit|metro|tram/i.test(text)) {
    return 'Transport';
  }
  if (/rent|mortgage|landlord|apartment|utility|electric|water|gas|internet|comcast|verizon|xfinity/i.test(text)) {
    return 'Rent & Utilities';
  }
  if (/netflix|spotify|hulu|prime|amazon|subscription|subscription/i.test(text)) {
    return 'Subscriptions';
  }
  if (/gym|fitness|health|doctor|hospital|medical|urgent care|rx|pharmacy/i.test(text)) {
    return 'Health & Fitness';
  }
  if (/restaurant|dining|takeout|grubhub|doordash|ubereats|pizza|cafe|bar|starbucks|chipotle/i.test(text)) {
    return 'Dining Takeout';
  }
  if (/mall|shop|target|amazon|walmart|best buy|apple|nordstrom|store|shopping/i.test(text)) {
    return 'Shopping';
  }
  return 'Other';
}

function extractFallbackYear(pdfText) {
  const headerPatterns = [
    /(?:through|ending|statement date|as of|period ending|statement ending)\s+(?:[A-Za-z]{3,9}\s+\d{1,2},?\s*|\d{1,2}[\/\-.]\d{1,2}[\/\-.])?(\d{4})/i,
    /statement period[^\n]*?(\d{4})/i,
    /for the period[^\n]*?(\d{4})/i,
    /closing date[^\n]*?(\d{4})/i,
  ];

  for (const pattern of headerPatterns) {
    const match = pdfText.match(pattern);
    if (match) {
      const year = parseInt(match[1], 10);
      if (!Number.isNaN(year)) {
        return year;
      }
    }
  }

  const firstLines = pdfText
    .split(/\r?\n/)
    .slice(0, 20)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of firstLines) {
    const yearMatch = line.match(/\b(20\d{2}|19\d{2})\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      if (!Number.isNaN(year)) {
        return year;
      }
    }
  }

  return new Date().getFullYear();
}

function parsePdfTransactions(pdfText) {
  const rawLines = pdfText
    .replace(/\u00A0/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s{2,}/g, ' ').trim())
    .filter((line) => line.length > 0);

  const transactions = [];
  const debugLines = [];
  const fallbackYear = extractFallbackYear(pdfText);
  const dateRegex = /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/;
  const amountRegex = /-?\(?\$?[\d,]+\.\d{2}\)?/g;
  let lastTransaction = null;

  for (const line of rawLines) {
    const lowerLine = line.toLowerCase();
    if (/^(date|transaction date|description|amount|balance|type|memo|posting date)\b/.test(lowerLine)) {
      continue;
    }

    const dateMatch = line.match(dateRegex);
    const amountMatches = Array.from(line.matchAll(amountRegex)).map((match) => match[0]);

    if (dateMatch && amountMatches.length > 0) {
      const rawDate = dateMatch[1];
      const parsedDate = normalizeDate(rawDate, fallbackYear);
      if (!parsedDate) {
        debugLines.push({ line, reason: 'invalid date format', rawDate });
        continue;
      }

      // choose the transaction amount when multiple amounts appear (e.g. amount then running balance)
      let rawAmount = amountMatches.find((m) => /-|\(/.test(m)) || amountMatches[0];
      const amount = normalizeAmount(rawAmount);
      if (amount === null) {
        debugLines.push({ line, reason: 'invalid amount', rawAmount });
        continue;
      }

      const amountIndex = line.lastIndexOf(rawAmount);
      let description = line.slice(dateMatch.index + rawDate.length, amountIndex).trim();
      description = description.replace(/\b(debit|credit|pending|available|balance|automatic transfer|auto transfer)\b/gi, '').replace(/\s{2,}/g, ' ').trim();

      if (!description) {
        const trailingText = line.slice(amountIndex + rawAmount.length).trim();
        description = trailingText || 'Bank transaction';
      }

      const category = guessCategory(description || 'Bank transaction');
      const transaction = {
        date: parsedDate,
        description: description || 'Bank transaction',
        amount,
        category,
      };
      transactions.push(transaction);
      lastTransaction = transaction;
      continue;
    }

    if (!dateMatch && amountMatches.length === 0 && lastTransaction && /[A-Za-z]/.test(line)) {
      lastTransaction.description = `${lastTransaction.description} ${line}`.replace(/\s{2,}/g, ' ').trim();
      continue;
    }

    if (line.trim().length > 0) {
      debugLines.push({ line, reason: 'unrecognized format' });
    }
  }

  return { transactions, debugLines, totalLines: rawLines.length };
}

function isPdfFile(file) {
  const filename = file.originalname.toLowerCase();
  return file.mimetype === 'application/pdf' || filename.endsWith('.pdf');
}

function isCsvFile(file) {
  const filename = file.originalname.toLowerCase();
  return file.mimetype === 'text/csv' || filename.endsWith('.csv');
}

app.post('/api/upload', authMiddleware, upload.single('statement'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!dbAvailable) {
    return res.status(503).json({ error: 'Database unavailable.' });
  }

  try {
    let transactions = [];
    const fileLower = req.file.originalname.toLowerCase();
    const isPdf = isPdfFile(req.file);
    const isCsv = isCsvFile(req.file);

    if (!isPdf && !isCsv) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Unsupported file type. Upload a CSV or PDF statement.' });
    }

    if (isPdf) {
      let pdfDebug = { debugLines: [], totalLines: 0 };
      try {
        const buffer = await fs.readFile(req.file.path);
        const parser = new PDFParse({ data: buffer });
        const parsed = await parser.getText();
        if (typeof parser.destroy === 'function') {
          await parser.destroy();
        }
        const pdfText = typeof parsed === 'string' ? parsed : parsed.text || '';
        const parsedResult = parsePdfTransactions(pdfText);
        transactions = parsedResult.transactions;
        pdfDebug = {
          debugLines: parsedResult.debugLines.slice(0, 20),
          totalLines: parsedResult.totalLines,
          parsedCount: parsedResult.transactions.length,
        };
      } catch (parseError) {
        await fs.unlink(req.file.path).catch(() => {});
        console.log('PDF parse error:', parseError);
        return res.status(400).json({ error: 'Invalid PDF file. Upload a valid bank statement PDF.' });
      }

      if (transactions.length === 0) {
        console.log('PDF parse debug:', pdfDebug);
      }
    } else {
      const contents = await fs.readFile(req.file.path, 'utf8');
      const lines = contents.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        await fs.unlink(req.file.path).catch(() => {});
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

      for (const line of lines) {
        const cells = parseCsvLine(line);
        const rawDate = cells[dateIndex];
        const rawAmount = cells[amountIndex];
        const rawCategory = cells[categoryIndex] || 'Other';
        const description = descriptionIndex !== -1 ? cells[descriptionIndex] || '' : '';

        if (!rawDate || !rawAmount) continue;
        const amount = normalizeAmount(rawAmount);
        if (amount === null) continue;

        transactions.push({
          date: rawDate,
          description,
          amount,
          category: rawCategory || 'Other',
        });
      }
    }

    await fs.unlink(req.file.path).catch(() => {});

    if (transactions.length === 0) {
      const response = { error: isPdf ? 'Invalid PDF statement. No transactions could be parsed.' : 'No valid transactions were found in the statement.' };
      if (isPdf && typeof pdfDebug !== 'undefined') {
        response.debug = {
          totalLines: pdfDebug.totalLines,
          parsedCount: pdfDebug.parsedCount,
          failedLines: pdfDebug.debugLines,
        };
      }
      return res.status(400).json(response);
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
  if (!dbAvailable) {
    return res.status(503).json({ error: 'Database unavailable.' });
  }

  try {
    const userId = req.user.sub;
    const showAll = req.query.all === 'true';
    const requestedMonth = req.query.month; // 'YYYY-MM' or undefined

    // 1. Find every distinct month that has data for this user (for the dropdown)
    const monthsResult = await query(
      `SELECT DISTINCT date_trunc('month', transaction_date) AS month_start
       FROM transactions
       WHERE user_id = $1
       ORDER BY month_start DESC`,
      [userId]
    );
    const monthOptions = monthsResult.rows.map((row) => ({
      start: row.month_start.toISOString().slice(0, 10),
      label: row.month_start.toLocaleString('default', { month: 'short' }),
    }));

    // 2. Figure out which month we're actually reporting on
    let anchorMonthStart;
    if (requestedMonth) {
      anchorMonthStart = `${requestedMonth}-01`;
    } else if (monthsResult.rows.length > 0) {
      anchorMonthStart = monthsResult.rows[0].month_start.toISOString().slice(0, 10);
    } else {
      anchorMonthStart = new Date().toISOString().slice(0, 8) + '01';
    }

    // 3. Trend: last 6 months ending at the anchor month (not necessarily "today")
    const months = [];
    const anchorDate = new Date(anchorMonthStart);
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - index, 1);
      const label = date.toLocaleString('default', { month: 'short' });
      months.push({ label, start: date.toISOString().slice(0, 10) });
    }

    const trendRows = await query(
      `SELECT date_trunc('month', transaction_date) AS month_start,
              SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend
         FROM transactions
        WHERE user_id = $1
          AND transaction_date >= $2::date - INTERVAL '5 months'
          AND transaction_date < $2::date + INTERVAL '1 month'
        GROUP BY month_start
        ORDER BY month_start`,
      [userId, anchorMonthStart]
    );
    const trendMap = new Map(trendRows.rows.map((row) => [row.month_start.toISOString().slice(0, 10), Number(row.spend || 0)]));
    const trendData = months.map((month) => ({ label: month.label, value: trendMap.get(month.start) || 0 }));

    // 4. Totals for the selected period (or all-time)
    const totalsWhere = showAll
      ? `WHERE user_id = $1`
      : `WHERE user_id = $1 AND date_trunc('month', transaction_date) = $2::date`;
    const totalsParams = showAll ? [userId] : [userId, anchorMonthStart];

    const totalsRow = await query(
      `SELECT SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend,
              SUM(amount) FILTER (WHERE amount > 0) AS income
       FROM transactions ${totalsWhere}`,
      totalsParams
    );
    const totals = totalsRow.rows[0] || { spend: 0, income: 0 };

    // 5. Previous period totals (for spendChange / incomeChange) — only meaningful when not "all time"
    let prevTotals = { spend: 0, income: 0 };
    if (!showAll) {
      const prevRow = await query(
        `SELECT SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend,
                SUM(amount) FILTER (WHERE amount > 0) AS income
         FROM transactions
        WHERE user_id = $1
          AND date_trunc('month', transaction_date) = $2::date - INTERVAL '1 month'`,
        [userId, anchorMonthStart]
      );
      prevTotals = prevRow.rows[0] || { spend: 0, income: 0 };
    }

    const calcChange = (current, previous) => {
      if (!previous || previous === 0) return current === 0 ? 0 : 100;
      return Math.round(((current - previous) / Math.abs(previous)) * 100);
    };

    // 6. Category totals for the selected period
    const categoriesWhere = showAll
      ? `WHERE user_id = $1 AND amount < 0`
      : `WHERE user_id = $1 AND date_trunc('month', transaction_date) = $2::date AND amount < 0`;
    const categoriesRows = await query(
      `SELECT category, SUM(amount) * -1 AS spend
       FROM transactions ${categoriesWhere}
       GROUP BY category
       ORDER BY spend DESC`,
      totalsParams
    );
    const categoryMap = new Map(categoriesRows.rows.map((row) => [row.category, Number(row.spend || 0)]));

    // 7. Category totals for the PREVIOUS period, so we can compute real %change per category
    let prevCategoryMap = new Map();
    if (!showAll) {
      const prevCategoriesRows = await query(
        `SELECT category, SUM(amount) * -1 AS spend
         FROM transactions
        WHERE user_id = $1
          AND date_trunc('month', transaction_date) = $2::date - INTERVAL '1 month'
          AND amount < 0
        GROUP BY category`,
        [userId, anchorMonthStart]
      );
      prevCategoryMap = new Map(prevCategoriesRows.rows.map((row) => [row.category, Number(row.spend || 0)]));
    }

    const requestedCategories = [
      'Dining Takeout', 'Shopping', 'Other', 'Groceries',
      'Transport', 'Subscriptions', 'Rent & Utilities', 'Health & Fitness',
    ];
    const categories = requestedCategories.map((name) => {
      const amount = categoryMap.get(name) || 0;
      const prevAmount = prevCategoryMap.get(name) || 0;
      return {
        name,
        amount,
        change: showAll ? 0 : calcChange(amount, prevAmount),
      };
    });

    return res.json({
      totalSpend: Number(totals.spend || 0),
      totalIncome: Number(totals.income || 0),
      spendChange: showAll ? 0 : calcChange(Number(totals.spend || 0), Number(prevTotals.spend || 0)),
      incomeChange: showAll ? 0 : calcChange(Number(totals.income || 0), Number(prevTotals.income || 0)),
      trendData,
      categories,
      monthOptions,
      anchorMonth: anchorMonthStart,
    });
  } catch (error) {
    console.error('Overview fetch failed:', error);
    return res.status(500).json({ error: 'Unable to load overview data.' });
  }
});

// Dev-only overview for user 1 (helps debugging frontend without auth).
app.get('/api/overview/debug', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!dbAvailable) {
    return res.status(503).json({ error: 'Database unavailable.' });
  }

  try {
    const userId = 1;
    const { month, all } = req.query;

    let anchorDateStr;
    if (month) {
      if (/^\d{4}-\d{2}$/.test(month)) anchorDateStr = `${month}-01`;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(month)) anchorDateStr = month;
      else anchorDateStr = new Date().toISOString().slice(0, 10);
    } else {
      const maxRow = await query('SELECT MAX(transaction_date) AS max_date FROM transactions WHERE user_id = $1', [userId]);
      const maxDate = maxRow.rows[0] && maxRow.rows[0].max_date ? maxRow.rows[0].max_date : null;
      anchorDateStr = maxDate ? maxDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    }

    const months = [];
    const anchor = new Date(anchorDateStr);
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(anchor.getFullYear(), anchor.getMonth() - index, 1);
      const label = date.toLocaleString('default', { month: 'short' });
      months.push({ label, start: date.toISOString().slice(0, 10), value: 0 });
    }

    const trendRows = await query(
      `SELECT date_trunc('month', transaction_date) AS month_start,
              SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend
         FROM transactions
        WHERE user_id = $1
          AND transaction_date >= date_trunc('month', $2::date) - INTERVAL '5 months'
        GROUP BY month_start
        ORDER BY month_start`,
      [userId, anchorDateStr]
    );

    const trendMap = new Map(trendRows.rows.map((row) => [row.month_start.toISOString().slice(0, 10), Number(row.spend || 0)]));
    const trendData = months.map((m) => ({ label: m.label, value: trendMap.get(m.start) || 0 }));

    let totals;
    if (all === 'true') {
      const totalsRow = await query(
        `SELECT SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend, SUM(amount) FILTER (WHERE amount > 0) AS income FROM transactions WHERE user_id = $1`,
        [userId]
      );
      totals = totalsRow.rows[0] || { spend: 0, income: 0 };
    } else {
      const totalsRow = await query(
        `SELECT SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend, SUM(amount) FILTER (WHERE amount > 0) AS income FROM transactions WHERE user_id = $1 AND date_trunc('month', transaction_date) = date_trunc('month', $2::date)`,
        [userId, anchorDateStr]
      );
      totals = totalsRow.rows[0] || { spend: 0, income: 0 };
    }

    const prevTotals = all === 'true' ? { spend: 0, income: 0 } : (await query(
      `SELECT SUM(amount) FILTER (WHERE amount < 0) * -1 AS spend, SUM(amount) FILTER (WHERE amount > 0) AS income FROM transactions WHERE user_id = $1 AND date_trunc('month', transaction_date) = (date_trunc('month', $2::date) - INTERVAL '1 month')`,
      [userId, anchorDateStr]
    )).rows[0] || { spend: 0, income: 0 };

    const categoriesRows = all === 'true'
      ? await query(`SELECT category, SUM(amount) * -1 AS spend FROM transactions WHERE user_id = $1 AND amount < 0 GROUP BY category ORDER BY spend DESC`, [userId])
      : await query(`SELECT category, SUM(amount) * -1 AS spend FROM transactions WHERE user_id = $1 AND date_trunc('month', transaction_date) = date_trunc('month', $2::date) AND amount < 0 GROUP BY category ORDER BY spend DESC`, [userId, anchorDateStr]);

    const requestedCategories = ['Dining Takeout','Shopping','Other','Groceries','Transport','Subscriptions','Rent & Utilities','Health & Fitness'];
    const categoryMap = new Map(categoriesRows.rows.map((row) => [row.category, Number(row.spend || 0)]));
    const categories = requestedCategories.map((name) => ({ name, amount: categoryMap.get(name) || 0, change: 0 }));

    return res.json({ totalSpend: Number(totals.spend || 0), totalIncome: Number(totals.income || 0), spendChange: 0, incomeChange: 0, trendData, categories, monthOptions: months, anchorMonth: anchorDateStr });
  } catch (error) {
    console.error('Debug overview fetch failed:', error);
    return res.status(500).json({ error: 'Unable to load debug overview data.' });
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
