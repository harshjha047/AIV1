import { randomUUID } from 'node:crypto';
import express from 'express';
import { createAuth } from './auth/middleware.js';
import { AuthError, describeError } from './errors.js';
import { createAdminModeRouter } from './routes/adminMode.js';
import { createMeRouter } from './routes/me.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function createApp({
  clients,
  employees,
  replay,
  limiter,
  cipher,
  clock,
  mode,
  runNow,
  logger,
  requireSignature = true,
  bodyLimit = '256kb'
}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('etag', false);

  app.use((req, res, next) => {
    const presented = req.get('x-request-id');
    req.id = presented && REQUEST_ID.test(presented) ? presented : randomUUID();
    res.set('X-Request-Id', req.id);
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  const auth = createAuth({ clients, employees, replay, limiter, cipher, clock, requireSignature, logger });
  const internal = express.Router();

  internal.use((req, _res, next) => {
    if (req.get('origin')) throw new AuthError(403, 'browser_not_allowed', 'Browser access is not allowed');
    next();
  });
  internal.use(auth.identifyApp);
  internal.use(auth.guardBody);
  internal.use(express.json({ limit: bodyLimit, strict: true, verify: auth.captureRaw }));
  internal.use(auth.verifySigned);
  internal.use(auth.resolveActor);
  internal.use(auth.throttle);
  internal.use(createMeRouter());
  internal.use(createAdminModeRouter({ mode, runNow, limiter }));
  internal.use((_req, _res, next) => next(new AuthError(404, 'not_found', 'Not found')));

  app.use('/internal/v1', internal);
  app.use((_req, _res, next) => next(new AuthError(404, 'not_found', 'Not found')));

  app.use((error, req, res, _next) => {
    const described = describeError(error);
    if (described.status >= 500) logger?.error?.({ err: error?.message, requestId: req.id }, 'request failed');
    for (const [name, value] of Object.entries(described.headers)) res.set(name, value);
    res.status(described.status).json({ error: { code: described.code, message: described.message, requestId: req.id } });
  });

  return app;
}
