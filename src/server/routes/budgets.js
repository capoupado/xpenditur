import express from 'express';
import { requireAuth } from '../middleware/auth.js';

// Phase 3 seam — budgets endpoints are implemented in a later phase.
const router = express.Router();
router.use(requireAuth);

router.use((req, res) => {
  res.status(501).json({ error: 'Budgets are not implemented yet (Phase 3)' });
});

export default router;
