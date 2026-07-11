import express from 'express';
import { requireAuth } from '../middleware/auth.js';

// Phase 6 seam — pending transactions (email extraction) endpoints implemented later.
const router = express.Router();
router.use(requireAuth);

router.use((req, res) => {
  res.status(501).json({ error: 'Pending transactions are not implemented yet (Phase 6)' });
});

export default router;
