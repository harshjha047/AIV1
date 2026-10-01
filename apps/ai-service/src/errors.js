export class AuthError extends Error {
  constructor(status, code, message = code, headers = {}) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const MODE_STATUS = Object.freeze({
  PRODUCTION_LOCKED: 409,
  MODE_ENV_MISMATCH: 409,
  RUN_NOW_DISABLED: 409,
  RUN_IN_PROGRESS: 409,
  NO_REFERENCE_DATE: 409,
  REASON_REQUIRED: 400,
  INVALID_REFERENCE_DATE: 400,
  REFERENCE_IN_FUTURE: 400,
  REFERENCE_CONFLICT: 400,
  INVALID_MODE: 400
});

export function describeError(error) {
  if (error instanceof AuthError || error instanceof HttpError) {
    return { status: error.status, code: error.code, message: error.message, headers: error.headers ?? {} };
  }
  if (error?.name === 'ModeError') {
    return { status: MODE_STATUS[error.code] ?? 400, code: String(error.code).toLowerCase(), message: error.message, headers: {} };
  }
  if (error?.type === 'entity.too.large') return { status: 413, code: 'payload_too_large', message: 'Payload too large', headers: {} };
  if (error?.type === 'entity.parse.failed') return { status: 400, code: 'invalid_json', message: 'Invalid JSON', headers: {} };
  if (error?.type === 'charset.unsupported' || error?.type === 'encoding.unsupported') {
    return { status: 415, code: 'unsupported_media_type', message: 'Unsupported encoding', headers: {} };
  }
  return { status: 500, code: 'internal_error', message: 'Internal error', headers: {} };
}
