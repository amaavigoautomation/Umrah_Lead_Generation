import pino from 'pino';

// Redact known sensitive fields across all log statements
const REDACT_KEYS = [
  'password',
  'pass',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'appSecret',
  'authorization',
  'cookie',
  'authTag',
  'encryptedData',
  '*.password',
  '*.pass',
  '*.secret',
  '*.token',
  '*.apiKey',
];

export const baseLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: REDACT_KEYS,
    censor: '[REDACTED]',
  },
  base: {
    service: 'umrah360-api',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Creates a child logger tagged with tenant and request context
 */
export function createTenantLogger(tenantId?: string, extraContext: Record<string, any> = {}) {
  return baseLogger.child({
    tenantId: tenantId || 'system',
    ...extraContext,
  });
}
