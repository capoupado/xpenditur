import express from 'express';
import { requireAuth } from '../middleware/auth.js';

// Phase 4 seam — recurring transactions endpoints are implemented in a later phase.
const router = express.Router();
router.use(requireAuth);

router.use((req, res) => {
  res.status(501).json({ error: 'Recurring transactions are not implemented yet (Phase 4)' });
});

export default router;
