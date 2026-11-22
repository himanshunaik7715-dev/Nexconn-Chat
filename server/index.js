import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { createNexconnService } from './nexconn.js';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret = process.env.JWT_SECRET || (nodeEnv === 'production' ? '' : randomBytes(48).toString('base64url'));
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
const production = nodeEnv === 'production';
const appOrigin = process.env.APP_ORIGIN || (production ? '' : 'http://localhost:5173');
const databaseUrl = process.env.DATABASE_URL || '';
const nexconnAppKey = process.env.NEXCONN_APP_KEY || '';
const nexconnAppSecret = process.env.NEXCONN_APP_SECRET || '';
const nexconnApiBaseUrl = process.env.NEXCONN_API_BASE_URL || '';
const nexconnAreaCode = process.env.NEXCONN_AREA_CODE || 'SG';
const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined ? 0 : Number(process.env.TRUST_PROXY_HOPS);
const port = Number(process.env.PORT || '3001');

if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 8) {
  throw new Error('TRUST_PROXY_HOPS must be a whole number from 0 to 8.');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');

if (production) {
  let origin;
  let nexconnApi;
  try {
    origin = new URL(appOrigin);
    nexconnApi = new URL(nexconnApiBaseUrl);
  } catch {
    throw new Error('Production requires valid APP_ORIGIN and NEXCONN_API_BASE_URL URLs.');
  }
  if (origin.protocol !== 'https:' || origin.origin !== appOrigin || origin.pathname !== '/') {
    throw new Error('Production APP_ORIGIN must be the exact public HTTPS origin.');
  }
  if (nexconnApi.protocol !== 'https:' || nexconnApi.username || nexconnApi.password || nexconnApi.pathname !== '/' || nexconnApi.search || nexconnApi.hash) {
    throw new Error('Production NEXCONN_API_BASE_URL must be an HTTPS origin without credentials or a path.');
  }
  if (!['BJ', 'SG', 'NA', 'SA', 'OM'].includes(nexconnAreaCode)) {
    throw new Error('Production NEXCONN_AREA_CODE must be a supported SDK region code.');
  }
  if (!databaseUrl) throw new Error('Production requires a server-side PostgreSQL DATABASE_URL.');
  let databaseOrigin;
  try { databaseOrigin = new URL(databaseUrl); }
  catch { throw new Error('Production DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(databaseOrigin.protocol)
    || !['require', 'verify-ca', 'verify-full'].includes(databaseOrigin.searchParams.get('sslmode'))) {
    throw new Error('Production DATABASE_URL must be PostgreSQL and require TLS (sslmode=require).');
  }
  if (!nexconnAppKey || !nexconnAppSecret) throw new Error('Production requires Nexconn server credentials.');
}

const config = {
  nodeEnv,
  jwtSecret,
  appOrigin,
  cookieSecure: production,
  port,
  trustProxyHops,
  databaseUrl,
  nexconnAppKey,
  nexconnAppSecret,
  nexconnApiBaseUrl,
  nexconnAreaCode,
  diagnostic: nodeEnv === 'development' ? (event, metadata = {}) => {
    const allowed = new Set(['requestId', 'httpStatus', 'code', 'identityMatches', 'authenticated', 'tokenBytes', 'reason', 'durationMs']);
    const safe = Object.fromEntries(Object.entries(metadata).filter(([key, value]) => allowed.has(key) && value !== undefined));
    process.stdout.write(`[Nexconn] ${JSON.stringify({ event, timestamp: new Date().toISOString(), ...safe })}\n`);
  } : undefined,
};

let db;
try {
  db = await openDatabase(config.databaseUrl);
} catch {
  process.stderr.write('Could not initialize the PostgreSQL database. Check the server-side DATABASE_URL and database availability.\n');
  process.exit(1);
}
const app = createApp({ db, config, nexconn: createNexconnService(config) });
const server = app.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Nexconn server listening on port ${config.port}\n`);
});

function shutdown() {
  server.close(async () => {
    try { await db.close(); }
    finally { process.exit(0); }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
