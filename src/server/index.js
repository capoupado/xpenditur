import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb } from './db.js';
import { registerCronJobs } from './cron.js';
import { checkEncryptedSettingsDecryptable } from './services/settings-store.js';

import authRoutes from './routes/auth.js';
import categoriesRoutes from './routes/categories.js';
import transactionsRoutes from './routes/transactions.js';
import statsRoutes from './routes/stats.js';
import budgetsRoutes from './routes/budgets.js';
import recurringRoutes from './routes/recurring.js';
import pendingRoutes from './routes/pending.js';
import settingsRoutes from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure required secrets exist before we do anything else.
if (!process.env.JWT_SECRET) {
  console.error('[startup] JWT_SECRET is not set. Refusing to start — set it in your .env file.');
  process.exit(1);
}

initDb();

// Surface a clear message (not an opaque crypto error) if ENCRYPTION_KEY
// changed and stored IMAP/DeepSeek secrets can no longer be decrypted.
checkEncryptedSettingsDecryptable();

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/budgets', budgetsRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/pending', pendingRoutes);
app.use('/api/settings', settingsRoutes);

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
