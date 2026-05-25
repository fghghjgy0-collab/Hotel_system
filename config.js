import 'dotenv/config';

const DEFAULT_PORT = 3000;
const DEFAULT_ADMIN_PIN = '0000';
const DEFAULT_RECEPTIONIST_PIN = '1234';
const DEFAULT_JWT_SECRET = 'hotel-system-dev-secret-change-me';

function normalizePort(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return DEFAULT_PORT;
}

function readEnv(name, fallback) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return fallback;
}

export const config = {
  port: normalizePort(process.env.PORT),
  adminPin: readEnv('ADMIN_PIN', DEFAULT_ADMIN_PIN),
  receptionistPin: readEnv('RECEPTIONIST_PIN', DEFAULT_RECEPTIONIST_PIN),
  jwtSecret: readEnv('JWT_SECRET', DEFAULT_JWT_SECRET),
  anthropicApiKey: readEnv('ANTHROPIC_API_KEY', ''),
  nodeEnv: readEnv('NODE_ENV', 'development')
};

export function getStartupWarnings() {
  const warnings = [];

  if (process.env.PORT && config.port === DEFAULT_PORT && process.env.PORT !== String(DEFAULT_PORT)) {
    warnings.push(`Invalid PORT "${process.env.PORT}" ignored; using ${DEFAULT_PORT}.`);
  }

  if (!process.env.JWT_SECRET) {
    warnings.push('JWT_SECRET is not set; using a development fallback. Set JWT_SECRET before production use.');
  }

  if (!process.env.ADMIN_PIN) {
    warnings.push(`ADMIN_PIN is not set; using default ${DEFAULT_ADMIN_PIN}.`);
  }

  if (!process.env.RECEPTIONIST_PIN) {
    warnings.push(`RECEPTIONIST_PIN is not set; using default ${DEFAULT_RECEPTIONIST_PIN}.`);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    warnings.push('ANTHROPIC_API_KEY is not set; AI order parsing and suggestions will return safe fallbacks.');
  }

  return warnings;
}
