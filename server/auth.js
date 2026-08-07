import express from 'express';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const JWT_EXPIRES_IN = '2h';

const mockUser = {
  id: 1,
  email: 'user@example.com',
  password: 'Password123!',
  name: 'Budget User',
};

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (email !== mockUser.email || password !== mockUser.password) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const payload = { sub: mockUser.id, email: mockUser.email };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return res.json({ token, user: { email: mockUser.email, name: mockUser.name } });
});

export default router;
