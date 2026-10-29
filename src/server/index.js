import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb } from './db.js';
import { registerCronJobs } from './cron.js';
import {
  checkEncryptedSettingsDecryptable,
  migrateLegacyDeepseekSetting,
  migrateLegacyNotificationSettings,
} from './services/settings-store.js';
import { ensureVapidKeys } from './services/push.js';

import authRoutes from './routes/auth.js';
import categoriesRoutes from './routes/categories.js';
import transactionsRoutes from './routes/transactions.js';
import statsRoutes from './routes/stats.js';
import budgetsRoutes from './routes/budgets.js';
import recurringRoutes from './routes/recurring.js';
import pendingRoutes from './routes/pending.js';
import settingsRoutes from './routes/settings.js';
import importRoutes from './routes/import.js';
import bankRoutes from './routes/bank.js';
import insightsRoutes from './routes/insights.js';
import pushRoutes from './routes/push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure required secrets exist before we do anything else.
if (!process.env.JWT_SECRET) {
  console.error('[startup] JWT_SECRET is not set. Refusing to start — set it in your .env file.');
  process.exit(1);
}

initDb();

// One-time move of the legacy deepseek_api_key into the AI provider settings.
migrateLegacyDeepseekSetting();
migrateLegacyNotificationSettings();

// Surface a clear message (not an opaque crypto error) if ENCRYPTION_KEY
// changed and stored AI provider / bank secrets can no longer be decrypted.
checkEncryptedSettingsDecryptable();

// Web Push keypair for PWA notifications (generated once, kept in settings).
ensureVapidKeys();

const app = express();
app.disable('x-powered-by');

// Behind a TLS-terminating reverse proxy (VPS deployment), trust the first
// proxy hop so req.protocol honours X-Forwarded-Proto (correct https redirect
// URL derivation for the bank callback) and rate limiting sees real client IPs.
if (String(process.env.TRUST_PROXY).toLowerCase() === 'true') {
  app.set('trust proxy', 1);
}
// 25mb: statement file imports (/api/import) arrive as base64 JSON.
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/pending', pendingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/push', pushRoutes);

// Public, unauthenticated Privacy Policy and Terms of Service pages — Enable
// Banking requires (and verifies) reachable privacy/terms URLs on a production
// application, so this instance serves its own at /privacy and /terms.
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '..', '..', 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

registerCronJobs();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[xPenditur] Server listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
