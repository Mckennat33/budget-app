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

// Movements between the user's own accounts are not income or spending. Tagging them
// here keeps them out of both totals (they are excluded from the overview queries) and
// out of the category breakdown, which only lists the eight spending categories.
const TRANSFER_PATTERN = /\btransfer\s+(from|to)\b|venmo\s+cashout|\bzelle\b|\bwire\s+transfer\b/i;

function isTransfer(description) {
  return TRANSFER_PATTERN.test(description || '');
}

// Raw statement lines carry processor noise ("Card Purchase 05/27 ... Card 3413",
// "PPD ID: 9086732000"). Strip it so the category drill-down reads as merchant names.
function prettyDescription(description) {
  if (!description) return 'Transaction';
  const text = String(description)
    .replace(/^(recurring\s+)?card purchase(\s+with pin)?\s*/i, '')
    .replace(/^\d{1,2}\/\d{1,2}\s*/, '')
    .replace(/\s*card\s+\d{4}\b.*$/i, '')
    .replace(/\s*(ppd|web|arc|ccd)\s+id:\s*\S+/gi, '')
    .replace(/\s*transaction#:\s*\S+/gi, '')
    .replace(/\s*-?\s*[\d,]+\.\d{2}\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text || String(description).slice(0, 60);
}

function guessCategory(description) {
  const text = description.toLowerCase();
  if (isTransfer(text)) {
    return 'Transfer';
  }
  if (/robinhood|fidelity|vanguard|schwab|etrade|e\*trade|coinbase|betterment|wealthfront|acorns|stash|brokerage|\binvest(ing|ment)?\b|\bira\b|401k/i.test(text)) {
    return 'Investing';
  }
  if (/groc|supermarket|whole foods|costco|walmart|aldi|trader joe|instacart|safeway|kroger|publix|sprouts/i.test(text)) {
    return 'Groceries';
  }
  // Word boundaries matter here: a bare "bus" matched "business" in statement
  // boilerplate, and "uber" must not steal Uber Eats from Dining.
  if (/\buber\b(?!\s*eats)|\blyft\b|\btaxis?\b|\bbus\b|\btrain\b|divvy|transit|\bmetra\b|\bmetro\b|\btram\b|parking|\btoll\b/i.test(text)) {
    return 'Transport';
  }
  if (/rent|mortgage|landlord|apartment|utility|utilities|electric|water|gas|internet|comcast|verizon|xfinity|comed|peoples gas|ameren|duke energy|con ?edison|national grid/i.test(text)) {
    return 'Rent & Utilities';
  }
  if (/netflix|spotify|hulu|prime|amazon|subscription|subscription/i.test(text)) {
    return 'Subscriptions';
  }
  if (/gym|fitness|health|doctor|hospital|medical|urgent care|rx|pharmacy/i.test(text)) {
    return 'Health & Fitness';
  }
  // Restaurants and bars mostly arrive as venue names, not the word "restaurant", so
  // match the payment-processor prefixes (Toast bills as "Tst*", Square as "Sq *") and
  // the words that actually show up in bar and restaurant names.
  if (
    /tst\*|\bsq \*/i.test(text)
    || /restaur|dining|takeout|grubhub|doordash|ubereats|seamless|postmates/i.test(text)
    || /\bbars?\b|barra\b|tavern|public hous|saloon|brewing|brewery|\bpub\b|liquors?|spirits|snacks|lounge|cantina/i.test(text)
    || /pizza|cafe|coffee|espresso|taqueria|\btacos?\b|burger|sandwich|deli\b|bakery|bagel|sushi|ramen|noodle|\bbbq\b|wings|grill|kitchen|bistro|eatery|diner\b|creamery|ice cream|gelato/i.test(text)
    || /starbucks|chipotle|levy@|emporium/i.test(text)
  ) {
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
  // Statements often render debits as "- 10.86" (space after the sign). Without the
  // optional whitespace the sign is dropped and the debit is stored as income.
  const amountRegex = /-?\s*\(?\$?[\d,]+\.\d{2}\)?/g;
  let lastTransaction = null;

  for (const line of rawLines) {
    const lowerLine = line.toLowerCase();
    if (/^(date|transaction date|description|amount|balance|type|memo|posting date)\b/.test(lowerLine)) {
      continue;
    }

    // Statement footers and legal boilerplate can contain both a date and a dollar
    // figure, which otherwise parse into a bogus transaction. Real ledger lines are short.
    if (line.length > 200) {
      debugLines.push({ line: line.slice(0, 120), reason: 'line too long to be a transaction' });
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
          category: isTransfer(description) ? 'Transfer' : rawCategory || 'Other',
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
    const anchorDate = parseLocalDate(anchorMonthStart);
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - index, 1);
      const label = date.toLocaleString('default', { month: 'short' });
      months.push({ label, start: date.toISOString().slice(0, 10) });
    }

    const trendRows = await query(
      `SELECT date_trunc('month', transaction_date) AS month_start,
              SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend
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
      `SELECT SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend,
              SUM(amount) FILTER (WHERE amount > 0 AND category <> 'Transfer') AS income
       FROM transactions ${totalsWhere}`,
      totalsParams
    );
    const totals = totalsRow.rows[0] || { spend: 0, income: 0 };

    // 5. Previous period totals (for spendChange / incomeChange) — only meaningful when not "all time"
    let prevTotals = { spend: 0, income: 0 };
    if (!showAll) {
      const prevRow = await query(
        `SELECT SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend,
                SUM(amount) FILTER (WHERE amount > 0 AND category <> 'Transfer') AS income
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
      'Transport', 'Subscriptions', 'Rent & Utilities', 'Health & Fitness', 'Investing',
    ];
    // Individual charges behind each category, for the expandable drill-down.
    const itemsRows = await query(
      `SELECT category, transaction_date, description, amount
       FROM transactions ${categoriesWhere}
       ORDER BY transaction_date DESC, id DESC`,
      totalsParams
    );
    const itemsByCategory = new Map();
    for (const row of itemsRows.rows) {
      const list = itemsByCategory.get(row.category) || [];
      if (list.length < 200) {
        list.push({
          date: row.transaction_date.toISOString().slice(0, 10),
          description: prettyDescription(row.description),
          amount: Math.abs(Number(row.amount || 0)),
        });
      }
      itemsByCategory.set(row.category, list);
    }

    const categories = requestedCategories.map((name) => {
      const amount = categoryMap.get(name) || 0;
      const prevAmount = prevCategoryMap.get(name) || 0;
      return {
        name,
        amount,
        change: showAll ? 0 : calcChange(amount, prevAmount),
        items: itemsByCategory.get(name) || [],
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
    const anchor = parseLocalDate(anchorDateStr);
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(anchor.getFullYear(), anchor.getMonth() - index, 1);
      const label = date.toLocaleString('default', { month: 'short' });
      months.push({ label, start: date.toISOString().slice(0, 10), value: 0 });
    }

    const trendRows = await query(
      `SELECT date_trunc('month', transaction_date) AS month_start,
              SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend
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
        `SELECT SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend, SUM(amount) FILTER (WHERE amount > 0 AND category <> 'Transfer') AS income FROM transactions WHERE user_id = $1`,
        [userId]
      );
      totals = totalsRow.rows[0] || { spend: 0, income: 0 };
    } else {
      const totalsRow = await query(
        `SELECT SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend, SUM(amount) FILTER (WHERE amount > 0 AND category <> 'Transfer') AS income FROM transactions WHERE user_id = $1 AND date_trunc('month', transaction_date) = date_trunc('month', $2::date)`,
        [userId, anchorDateStr]
      );
      totals = totalsRow.rows[0] || { spend: 0, income: 0 };
    }

    const prevTotals = all === 'true' ? { spend: 0, income: 0 } : (await query(
      `SELECT SUM(amount) FILTER (WHERE amount < 0 AND category <> 'Transfer') * -1 AS spend, SUM(amount) FILTER (WHERE amount > 0 AND category <> 'Transfer') AS income FROM transactions WHERE user_id = $1 AND date_trunc('month', transaction_date) = (date_trunc('month', $2::date) - INTERVAL '1 month')`,
      [userId, anchorDateStr]
    )).rows[0] || { spend: 0, income: 0 };

    const categoriesRows = all === 'true'
      ? await query(`SELECT category, SUM(amount) * -1 AS spend FROM transactions WHERE user_id = $1 AND amount < 0 GROUP BY category ORDER BY spend DESC`, [userId])
      : await query(`SELECT category, SUM(amount) * -1 AS spend FROM transactions WHERE user_id = $1 AND date_trunc('month', transaction_date) = date_trunc('month', $2::date) AND amount < 0 GROUP BY category ORDER BY spend DESC`, [userId, anchorDateStr]);

    const requestedCategories = ['Dining Takeout','Shopping','Other','Groceries','Transport','Subscriptions','Rent & Utilities','Health & Fitness','Investing'];
    const categoryMap = new Map(categoriesRows.rows.map((row) => [row.category, Number(row.spend || 0)]));

    const itemsRows = all === 'true'
      ? await query(`SELECT category, transaction_date, description, amount FROM transactions WHERE user_id = $1 AND amount < 0 ORDER BY transaction_date DESC, id DESC`, [userId])
      : await query(`SELECT category, transaction_date, description, amount FROM transactions WHERE user_id = $1 AND date_trunc('month', transaction_date) = date_trunc('month', $2::date) AND amount < 0 ORDER BY transaction_date DESC, id DESC`, [userId, anchorDateStr]);
    const itemsByCategory = new Map();
    for (const row of itemsRows.rows) {
      const list = itemsByCategory.get(row.category) || [];
      if (list.length < 200) {
        list.push({
          date: row.transaction_date.toISOString().slice(0, 10),
          description: prettyDescription(row.description),
          amount: Math.abs(Number(row.amount || 0)),
        });
      }
      itemsByCategory.set(row.category, list);
    }

    const categories = requestedCategories.map((name) => ({
      name,
      amount: categoryMap.get(name) || 0,
      change: 0,
      items: itemsByCategory.get(name) || [],
    }));

    return res.json({ totalSpend: Number(totals.spend || 0), totalIncome: Number(totals.income || 0), spendChange: 0, incomeChange: 0, trendData, categories, monthOptions: months, anchorMonth: anchorDateStr });
  } catch (error) {
    console.error('Debug overview fetch failed:', error);
    return res.status(500).json({ error: 'Unable to load debug overview data.' });
  }
});

/* ---------------------------------------------------------------------------
 * Goals
 *
 * Everything here derives from the newest month that has data, the same anchor
 * the overview uses. Money you do not control week to week (rent, utilities,
 * subscriptions, automatic investing) is taken off the top; savings goals take
 * their cut next; whatever survives becomes the weekly allowance.
 * ------------------------------------------------------------------------- */

// Recurring commitments rather than day-to-day choices. Investing sits here
// because the Robinhood/Acorns deposits are automatic - it still counts toward
// total spend on the overview, it just is not part of the weekly allowance.
const FIXED_CATEGORIES = new Set(['Rent & Utilities', 'Subscriptions', 'Investing']);
const SAVINGS_TRANSFER_PATTERN = /transfer\s+to\s+sav/i;
const MAX_SAVINGS_GOALS = 2;

// '2026-07-01' through the Date constructor is parsed as UTC midnight, which is the
// previous day - and so the previous month - anywhere west of Greenwich. Every
// calendar calculation here has to go through this instead.
function parseLocalDate(value) {
  if (value instanceof Date) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00`);
}

// Rent is written by check and carries no label, so it is identified by shape rather
// than by a declared amount: the largest check in the month. Reading the real cleared
// amount means a discounted month lands at its true value on its own. Any smaller
// checks stay in discretionary, where an ordinary one-off check belongs.
function detectRentRow(rows) {
  let best = null;
  for (const row of rows) {
    if (!/\bcheck\b/i.test(row.description || '')) continue;
    const amount = Math.abs(Number(row.amount));
    if (best === null || amount > best.amount) {
      best = { id: row.id, amount };
    }
  }
  return best;
}

function monthsUntil(anchorMonthStart, targetDate) {
  if (!targetDate) return null;
  const anchor = parseLocalDate(anchorMonthStart);
  const target = parseLocalDate(targetDate);
  const diff = (target.getFullYear() - anchor.getFullYear()) * 12
    + (target.getMonth() - anchor.getMonth());
  return Math.max(1, diff);
}

async function buildGoalsPayload(userId) {
  const settingsRow = await query(
    'SELECT declared_rent, reduction_percent FROM goal_settings WHERE user_id = $1',
    [userId]
  );
  const settings = settingsRow.rows[0] || { declared_rent: 0, reduction_percent: 0 };
  const declaredRent = Number(settings.declared_rent || 0);
  const reductionPercent = Number(settings.reduction_percent || 0);

  const monthsResult = await query(
    `SELECT DISTINCT date_trunc('month', transaction_date) AS month_start
       FROM transactions WHERE user_id = $1 ORDER BY month_start DESC`,
    [userId]
  );

  const goalsRows = await query(
    `SELECT id, name, target_amount, target_date, created_at
       FROM savings_goals WHERE user_id = $1 ORDER BY id ASC`,
    [userId]
  );

  if (monthsResult.rows.length === 0) {
    return {
      hasData: false,
      declaredRent,
      reductionPercent,
      savingsGoals: goalsRows.rows.map((row) => ({
        id: row.id,
        name: row.name,
        targetAmount: Number(row.target_amount),
        targetDate: row.target_date ? row.target_date.toISOString().slice(0, 10) : null,
        saved: 0,
        remaining: Number(row.target_amount),
        monthsRemaining: null,
        perMonth: 0,
        perWeek: 0,
        percentComplete: 0,
      })),
    };
  }

  const anchorMonthStart = monthsResult.rows[0].month_start.toISOString().slice(0, 10);
  const anchorDate = parseLocalDate(anchorMonthStart);
  const daysInMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();

  // Every non-transfer movement in the anchor month, classified in JS so the rent
  // check cannot be counted as both a category total and a fixed cost.
  const monthRows = await query(
    `SELECT id, transaction_date, description, amount, category
       FROM transactions
      WHERE user_id = $1
        AND date_trunc('month', transaction_date) = $2::date
        AND category <> 'Transfer'
      ORDER BY transaction_date ASC, id ASC`,
    [userId, anchorMonthStart]
  );

  const spendRows = monthRows.rows.filter((row) => Number(row.amount) < 0);
  const monthIncome = monthRows.rows
    .filter((row) => Number(row.amount) > 0)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const rent = detectRentRow(spendRows);

  const fixedBreakdown = [];
  const fixedByLabel = new Map();
  let fixedTotal = 0;
  let discretionaryTotal = 0;
  const discretionaryRows = [];

  for (const row of spendRows) {
    const amount = Math.abs(Number(row.amount));
    const isRent = rent !== null && row.id === rent.id;
    if (isRent || FIXED_CATEGORIES.has(row.category)) {
      const label = isRent ? 'Rent' : row.category;
      fixedByLabel.set(label, (fixedByLabel.get(label) || 0) + amount);
      fixedTotal += amount;
    } else {
      discretionaryTotal += amount;
      discretionaryRows.push({ date: row.transaction_date, amount });
    }
  }
  for (const [label, amount] of fixedByLabel) {
    fixedBreakdown.push({ label, amount: Number(amount.toFixed(2)) });
  }
  fixedBreakdown.sort((a, b) => b.amount - a.amount);

  // Savings actually set aside: explicit transfers out to savings beat any
  // inference from surplus, and the statements already carry them.
  const transferRows = await query(
    `SELECT transaction_date, ABS(amount) AS amount
       FROM transactions
      WHERE user_id = $1 AND amount < 0 AND description ~* $2
      ORDER BY transaction_date ASC`,
    [userId, SAVINGS_TRANSFER_PATTERN.source]
  );
  const savedPool = transferRows.rows.reduce((sum, row) => sum + Number(row.amount), 0);

  // Each transfer is credited only to the goals that already existed when it
  // happened, split between them in proportion to their targets. Walking the
  // transfers one at a time is what stops a new goal from inheriting savings that
  // predate it, and stops adding a second goal from stripping progress off the first.
  const goalStartMonth = new Map();
  for (const row of goalsRows.rows) {
    const created = parseLocalDate(row.created_at.toISOString().slice(0, 10));
    goalStartMonth.set(row.id, new Date(created.getFullYear(), created.getMonth(), 1));
  }

  const accrued = new Map(goalsRows.rows.map((row) => [row.id, 0]));
  for (const transfer of transferRows.rows) {
    const when = parseLocalDate(transfer.transaction_date);
    const active = goalsRows.rows.filter((row) => when >= goalStartMonth.get(row.id));
    if (active.length === 0) continue;
    const activeTargetSum = active.reduce((sum, row) => sum + Number(row.target_amount), 0);
    for (const row of active) {
      const share = activeTargetSum > 0 ? Number(row.target_amount) / activeTargetSum : 0;
      accrued.set(row.id, accrued.get(row.id) + Number(transfer.amount) * share);
    }
  }

  const savingsGoals = goalsRows.rows.map((row) => {
    const targetAmount = Number(row.target_amount);
    const saved = Math.min(targetAmount, Number(accrued.get(row.id).toFixed(2)));
    const remaining = Math.max(0, Number((targetAmount - saved).toFixed(2)));
    const targetDate = row.target_date ? row.target_date.toISOString().slice(0, 10) : null;
    const monthsRemaining = monthsUntil(anchorMonthStart, row.target_date);
    // Dividing what is left by the months that are left is the rollover: a missed
    // month raises the rate automatically and the target date never moves.
    const perMonth = monthsRemaining ? Number((remaining / monthsRemaining).toFixed(2)) : 0;
    return {
      id: row.id,
      name: row.name,
      targetAmount,
      targetDate,
      saved,
      remaining,
      monthsRemaining,
      perMonth,
      perWeek: Number((perMonth / 4.3).toFixed(2)),
      percentComplete: targetAmount > 0 ? Math.min(100, Math.round((saved / targetAmount) * 100)) : 0,
    };
  });

  const savingsCommitment = savingsGoals.reduce((sum, goal) => sum + goal.perMonth, 0);
  const reductionAmount = Number((discretionaryTotal * (reductionPercent / 100)).toFixed(2));
  const monthlyTarget = Math.max(0, Number((discretionaryTotal - savingsCommitment - reductionAmount).toFixed(2)));

  // Four buckets of whole days, each measured against its own slice of the target
  // so a 10-day final bucket is not judged against a 7-day allowance.
  const bucketBounds = [[1, 7], [8, 14], [15, 21], [22, daysInMonth]];
  const scorecard = bucketBounds.map(([from, to], index) => {
    const spent = discretionaryRows
      .filter((row) => {
        const day = new Date(row.date).getDate();
        return day >= from && day <= to;
      })
      .reduce((sum, row) => sum + row.amount, 0);
    const days = to - from + 1;
    const bucketTarget = Number((monthlyTarget * (days / daysInMonth)).toFixed(2));
    return {
      label: `Week ${index + 1}`,
      range: `${from}–${to}`,
      spent: Number(spent.toFixed(2)),
      target: bucketTarget,
      delta: Number((spent - bucketTarget).toFixed(2)),
      over: spent > bucketTarget,
    };
  });

  // What the month actually did with the money: earned, spent, moved to savings, and
  // the remainder sitting in checking. A cheap rent month shows up here as a wider
  // gap rather than as savings, because nothing was moved.
  const anchorMonthPrefix = anchorMonthStart.slice(0, 7);
  const savedThisMonth = transferRows.rows
    .filter((row) => row.transaction_date.toISOString().slice(0, 7) === anchorMonthPrefix)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const monthSpend = fixedTotal + discretionaryTotal;
  const unallocated = monthIncome - monthSpend - savedThisMonth;

  return {
    hasData: true,
    anchorMonth: anchorMonthStart,
    anchorLabel: anchorDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
    declaredRent,
    reductionPercent,
    rentDetected: rent ? Number(rent.amount.toFixed(2)) : null,
    monthIncome: Number(monthIncome.toFixed(2)),
    savedThisMonth: Number(savedThisMonth.toFixed(2)),
    unallocated: Number(unallocated.toFixed(2)),
    totalSpend: Number((fixedTotal + discretionaryTotal).toFixed(2)),
    fixedTotal: Number(fixedTotal.toFixed(2)),
    fixedBreakdown,
    discretionary: Number(discretionaryTotal.toFixed(2)),
    savingsCommitment: Number(savingsCommitment.toFixed(2)),
    reductionAmount,
    monthlyTarget,
    weeklyAllowance: Number((monthlyTarget / 4.3).toFixed(2)),
    dailyAllowance: Number((monthlyTarget / daysInMonth).toFixed(2)),
    savedPool: Number(savedPool.toFixed(2)),
    savingsGoals,
    scorecard,
    maxGoals: MAX_SAVINGS_GOALS,
  };
}

app.get('/api/goals', authMiddleware, async (req, res) => {
  if (!dbAvailable) return res.status(503).json({ error: 'Database unavailable.' });
  try {
    return res.json(await buildGoalsPayload(req.user.sub));
  } catch (error) {
    console.error('Goals fetch failed:', error);
    return res.status(500).json({ error: 'Unable to load goals.' });
  }
});

app.put('/api/goals/settings', authMiddleware, async (req, res) => {
  if (!dbAvailable) return res.status(503).json({ error: 'Database unavailable.' });
  // Rent is detected from the statement now, so the column is only still here to
  // avoid a migration; callers no longer send it.
  const declaredRent = Number(req.body?.declaredRent ?? 0);
  const reductionPercent = Number(req.body?.reductionPercent);

  if (!Number.isFinite(declaredRent) || declaredRent < 0) {
    return res.status(400).json({ error: 'Rent must be a positive number.' });
  }
  if (!Number.isFinite(reductionPercent) || reductionPercent < 0 || reductionPercent > 50) {
    return res.status(400).json({ error: 'Reduction must be between 0 and 50 percent.' });
  }

  try {
    await query(
      `INSERT INTO goal_settings (user_id, declared_rent, reduction_percent, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET declared_rent = EXCLUDED.declared_rent,
             reduction_percent = EXCLUDED.reduction_percent,
             updated_at = NOW()`,
      [req.user.sub, declaredRent, Math.round(reductionPercent)]
    );
    return res.json(await buildGoalsPayload(req.user.sub));
  } catch (error) {
    console.error('Goal settings save failed:', error);
    return res.status(500).json({ error: 'Unable to save settings.' });
  }
});

app.post('/api/goals/savings', authMiddleware, async (req, res) => {
  if (!dbAvailable) return res.status(503).json({ error: 'Database unavailable.' });
  const name = String(req.body?.name || '').trim();
  const targetAmount = Number(req.body?.targetAmount);
  const targetDate = req.body?.targetDate || null;

  if (!name) return res.status(400).json({ error: 'Give the goal a name.' });
  if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
    return res.status(400).json({ error: 'Target amount must be greater than zero.' });
  }
  if (targetDate && Number.isNaN(new Date(targetDate).getTime())) {
    return res.status(400).json({ error: 'Target date is not a valid date.' });
  }

  try {
    const countRow = await query('SELECT COUNT(*) AS count FROM savings_goals WHERE user_id = $1', [req.user.sub]);
    if (Number(countRow.rows[0].count) >= MAX_SAVINGS_GOALS) {
      return res.status(400).json({ error: `You can track ${MAX_SAVINGS_GOALS} savings goals at a time. Remove one to add another.` });
    }

    await query(
      'INSERT INTO savings_goals (user_id, name, target_amount, target_date) VALUES ($1, $2, $3, $4)',
      [req.user.sub, name, targetAmount, targetDate]
    );
    return res.json(await buildGoalsPayload(req.user.sub));
  } catch (error) {
    console.error('Savings goal create failed:', error);
    return res.status(500).json({ error: 'Unable to create the goal.' });
  }
});

app.delete('/api/goals/savings/:id', authMiddleware, async (req, res) => {
  if (!dbAvailable) return res.status(503).json({ error: 'Database unavailable.' });
  try {
    await query('DELETE FROM savings_goals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.sub]);
    return res.json(await buildGoalsPayload(req.user.sub));
  } catch (error) {
    console.error('Savings goal delete failed:', error);
    return res.status(500).json({ error: 'Unable to remove the goal.' });
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
