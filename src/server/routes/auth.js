import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { signToken, requireAuth, cookieOptions, COOKIE_NAME } from '../middleware/auth.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
  // Behind Cloudflare + Apache every request arrives from 127.0.0.1, which would
  // make this a single global bucket anyone could exhaust; key on the visitor IP
  // Cloudflare reports instead.
  keyGenerator: (req) => req.get('cf-connecting-ip') || req.ip,
  validate: { xForwardedForHeader: false },
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.cookie(COOKIE_NAME, signToken(user), cookieOptions);
  res.json({ id: user.id, username: user.username });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(user);
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const valid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  // Bumping token_version signs out every other device; this one gets a fresh cookie.
  db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  res.cookie(COOKIE_NAME, signToken(updated), cookieOptions);
  res.json({ ok: true });
});

export default router;
