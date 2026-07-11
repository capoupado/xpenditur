import express from 'express';
import { requireAuth } from '../middleware/auth.js';

// Phase 5/6 seam — Discord/IMAP/DeepSeek settings endpoints implemented later.
const router = express.Router();
router.use(requireAuth);

router.use((req, res) => {
  res.status(501).json({ error: 'Settings management is not implemented yet' });
});

export default router;
