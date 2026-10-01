import { HttpError } from './errors.js';

export const ROLES = Object.freeze(['employee', 'manager', 'admin', 'owner']);
export const ADMIN_ROLES = Object.freeze(['admin', 'owner']);

export function isRole(value) {
  return ROLES.includes(value);
}

export function requireRole(...allowed) {
  const set = new Set(allowed);
  return (req, _res, next) => {
    if (!req.actor || !set.has(req.actor.role)) throw new HttpError(403, 'forbidden', 'Not allowed');
    next();
  };
}
