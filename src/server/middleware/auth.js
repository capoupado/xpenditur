import jwt from 'jsonwebtoken';
import db from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET;

export const COOKIE_NAME = 'xpenditur_token';

// Tokens carry the user's token_version; bumping it (password change) revokes
// every session issued before, on every device.
export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, tv: user.token_version ?? 0 },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.id);
  if (!user || user.token_version !== (decoded.tv ?? 0)) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  req.user = decoded;
  next();
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};
