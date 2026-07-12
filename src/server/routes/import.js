// Bank statement file import (CSV / PDF). The client reads the chosen file
// and posts it as base64 JSON — no multipart handling needed. Parsed rows land
// in pending_transactions for review; nothing touches the ledger directly.

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { importStatementFile } from '../services/statement-import.js';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const router = express.Router();
router.use(requireAuth);

router.post('/statement', async (req, res) => {
  const { filename, contentBase64 } = req.body || {};
  if (typeof filename !== 'string' || !filename.trim()) {
    return res.status(400).json({ error: 'filename is required' });
  }
  if (typeof contentBase64 !== 'string' || !contentBase64) {
    return res.status(400).json({ error: 'contentBase64 is required' });
  }

  let buffer;
  try {
    buffer = Buffer.from(contentBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'contentBase64 is not valid base64' });
  }
  if (buffer.length === 0) return res.status(400).json({ error: 'The uploaded file is empty' });
  if (buffer.length > MAX_FILE_BYTES) {
    return res.status(400).json({ error: 'File too large (max 15 MB)' });
  }

  try {
    const result = await importStatementFile({ filename: filename.trim(), buffer });
    res.json(result);
  } catch (err) {
    console.error('[import] statement import failed:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
