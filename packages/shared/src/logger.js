import pino from 'pino';

const URI_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

export const redactPaths = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'uri',
  'mongoUri',
  'connectionString',
  'credentials',
  'credentialRef',
  'masterKey',
  'sourceCredMasterKey',
  'localAdminPasswordHash',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
  '*.authorization',
  '*.cookie',
  '*.uri',
  '*.mongoUri',
  '*.connectionString',
  '*.credentials',
  '*.masterKey',
  '*.sourceCredMasterKey',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-ai-key"]',
  'req.headers["x-ai-signature"]',
  'req.body',
  'res.headers["set-cookie"]',
];

export const scrubUris = (value) =>
  typeof value === 'string' ? value.replace(URI_CREDENTIALS, '$1***@') : value;

export const createLogger = ({ name, level = 'info', destination } = {}) => {
  const options = {
    name,
    level,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map(scrubUris));
      },
    },
    serializers: {
      err: (error) => {
        const serialized = pino.stdSerializers.err(error);
        return {
          ...serialized,
          message: scrubUris(serialized.message),
          stack: scrubUris(serialized.stack),
        };
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
};
