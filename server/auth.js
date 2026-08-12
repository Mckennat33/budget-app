import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query, dbAvailable } from './db.js';
import { authMiddleware } from './authMiddleware.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const JWT_EXPIRES_IN = '2h';
const SALT_ROUNDS = 10;
const localUsers = [];

async function findUserByEmail(email) {
  if (dbAvailable) {
    const result = await query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
    return result.rows[0];
  }
  return localUsers.find((user) => user.email === email);
}

async function findUserById(id) {
  if (dbAvailable) {
    const result = await query('SELECT id, email, name, password_hash FROM users WHERE id = $1', [id]);
    return result.rows[0];
  }
  return localUsers.find((user) => user.id === id);
}

async function insertUser(name, email, passwordHash) {
  if (dbAvailable) {
    const result = await query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
      [name, email, passwordHash]
    );
    return result.rows[0];
  }

  const user = { id: localUsers.length + 1, name, email, password_hash: passwordHash };
  localUsers.push(user);
  return { id: user.id, email: user.email, name: user.name };
}

async function updateUser(id, name, email, passwordHash) {
  if (dbAvailable) {
    const values = [name, email, id];
    let queryText = 'UPDATE users SET name = $1, email = $2';
    if (passwordHash) {
      queryText += ', password_hash = $4';
      values.push(passwordHash);
    }
    queryText += ' WHERE id = $3 RETURNING id, email, name';
    const result = await query(queryText, values);
    return result.rows[0];
  }

  const user = localUsers.find((item) => item.id === id);
  if (!user) return null;
  user.name = name;
  user.email = email;
  if (passwordHash) {
    user.password_hash = passwordHash;
  }
  return { id: user.id, email: user.email, name: user.name };
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email is already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await insertUser(name, email, passwordHash);
    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    return res.json({ token, user });
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email is already registered.' });
    }
    return res.status(500).json({ error: 'Unable to create account at this time. Please try again later.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    return res.json({ token, user: { email: user.email, name: user.name } });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to sign in at this time. Please try again later.' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await findUserById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    return res.json({ user: { email: user.email, name: user.name } });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load account.' });
  }
});

router.patch('/account', authMiddleware, async (req, res) => {
  const { name, email, currentPassword, newPassword } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  try {
    const user = await findUserById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change password.' });
      }

      const currentValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!currentValid) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
    }

    if (email !== user.email) {
      const existing = await findUserByEmail(email);
      if (existing && existing.id !== user.id) {
        return res.status(409).json({ error: 'Email is already registered.' });
      }
    }

    const passwordHash = newPassword ? await bcrypt.hash(newPassword, SALT_ROUNDS) : null;
    const updated = await updateUser(user.id, name, email, passwordHash);
    return res.json({ user: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to update account.' });
  }
});

export default router;
