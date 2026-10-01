import { Router } from 'express';

export function createMeRouter() {
  const router = Router();
  router.get('/me', (req, res) => {
    res.json({ ...req.actor, requestId: req.id });
  });
  return router;
}
