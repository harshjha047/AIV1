import { Router } from 'express';
import { createRouteLimiter } from '../auth/middleware.js';
import { HttpError } from '../errors.js';
import { ADMIN_ROLES, requireRole } from '../roles.js';

const PUT_KEYS = new Set(['referenceDate', 'referenceAuto', 'mode', 'reason']);
const RUN_KEYS = new Set(['reason', 'sources']);

function exactBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_body', 'JSON object required');
  const extra = Object.keys(body).filter((key) => !allowed.has(key));
  if (extra.length > 0) throw new HttpError(400, 'unknown_fields', `Unknown fields: ${extra.join(', ')}`);
  return body;
}

export function createAdminModeRouter({ mode, runNow, limiter }) {
  const router = Router();
  const guard = requireRole(...ADMIN_ROLES);
  const switchLimit = createRouteLimiter({ limiter, name: 'admin-mode', limit: 10 });

  router.get('/admin/mode', guard, async (_req, res) => {
    res.json(await mode.describe());
  });

  router.put('/admin/mode', guard, switchLimit, async (req, res) => {
    const body = exactBody(req.body, PUT_KEYS);
    if (body.referenceAuto !== undefined && typeof body.referenceAuto !== 'boolean') {
      throw new HttpError(400, 'invalid_body', 'referenceAuto must be boolean');
    }
    await mode.update(
      { mode: body.mode, referenceDate: body.referenceDate, referenceAuto: body.referenceAuto },
      { actorEmployeeId: req.actor.employeeId, reason: body.reason }
    );
    res.json(await mode.describe());
  });

  router.post('/admin/run-now', guard, switchLimit, async (req, res) => {
    const body = exactBody(req.body, RUN_KEYS);
    if (body.sources !== undefined && (!Array.isArray(body.sources) || body.sources.some((id) => typeof id !== 'string'))) {
      throw new HttpError(400, 'invalid_body', 'sources must be a string array');
    }
    const result = await runNow.trigger({
      actorEmployeeId: req.actor.employeeId,
      reason: body.reason,
      sources: body.sources
    });
    res.status(202).json(result);
  });

  return router;
}
