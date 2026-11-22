import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { NexconnConfigurationError, NexconnRequestError } from './nexconn.js';
import { isDatabaseUnavailable } from './database.js';

const USER_SESSION_DAYS = 7;
const COOKIE_NAME = 'nexconn_session';
const LEGACY_COOKIE_NAME = 'nas_session';
const JWT_ISSUER = 'nexconn-chat';
const JWT_AUDIENCE = 'nexconn-chat-web';
const LEGACY_JWT_ISSUER = 'nas-on';
const LEGACY_JWT_AUDIENCE = 'nas-on-web';
const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email.').max(254, 'Username or email must be 254 characters or fewer.'),
  password: z.string().min(1, 'Enter your password.').max(72, 'Password must be 72 characters or fewer.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be no more than 72 UTF-8 bytes.'),
});
const usernameSchema = z.string().trim()
  .min(3, 'Username must be at least 3 characters.')
  .max(24, 'Username must be 24 characters or fewer.')
  .superRefine((value, ctx) => {
  const chars = Array.from(value);
  const invalidIndex = chars.findIndex((char) => !/^[a-zA-Z0-9_.-]$/.test(char));
  if (invalidIndex === -1) return;
  const codePoint = chars[invalidIndex].codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  ctx.addIssue({
    code: 'custom',
    message: `Username has an unsupported character at position ${invalidIndex + 1} (U+${codePoint}). Use ASCII letters, numbers, dots, underscores, or hyphens.`,
  });
});
const registrationSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().max(254, 'Email must be 254 characters or fewer.')
    .email('Enter a valid email address.'),
  password: z.string().min(10, 'Password must be at least 10 characters.')
    .max(72, 'Password must be 72 characters or fewer.')
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be no more than 72 UTF-8 bytes.'),
});
const profileSchema = z.object({ userIds: z.array(z.string().min(1).max(64)).max(100) });
const favoriteSchema = z.object({
  channelType: z.enum(['direct', 'group']),
  channelId: z.string().trim().min(1).max(128).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Invalid conversation ID.'),
}).strict();
const isSafeAvatarUrl = (value) => {
  if (!value) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
};
const accountProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  avatarUrl: z.string().trim().max(1024).refine(isSafeAvatarUrl, 'Avatar URL must use HTTPS.'),
});

function validationFailure(error) {
  const fieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return { error: 'Please correct the highlighted field.', fieldErrors };
}

async function registrationConflict(db, username, email) {
  if ((await db.query('SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1', [username])).rowCount) {
    const message = 'This username is already taken. Choose another.';
    return { error: message, fieldErrors: { username: message } };
  }
  if ((await db.query('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [email])).rowCount) {
    const message = 'This email is already registered. Use another email or log in.';
    return { error: message, fieldErrors: { email: message } };
  }
  return null;
}

const safeUser = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  displayName: row.display_name || row.username,
  avatarUrl: row.avatar_url || '',
  createdAt: row.created_at,
});

function setSessionCookie(response, token, config) {
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: USER_SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(response, config) {
  const options = { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' };
  response.clearCookie(COOKIE_NAME, options);
  response.clearCookie(LEGACY_COOKIE_NAME, options);
}

function createSession(user, config, now = Date.now()) {
  const sid = randomUUID();
  const expiresAt = now + USER_SESSION_DAYS * 24 * 60 * 60 * 1000;
  const token = jwt.sign({ sid }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: `${USER_SESSION_DAYS}d`,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  return { sid, token, expiresAt, createdAt: now };
}

function checkRequestOrigin(req, res, next, config) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return res.status(403).json({ error: 'Request origin rejected.' });

  const origin = req.get('origin');
  if (!origin || origin !== config.appOrigin) return res.status(403).json({ error: 'Request origin rejected.' });
  next();
}

function createAuthMiddleware(db, config, clock, { optional = false } = {}) {
  return asyncRoute(async (req, res, next) => {
    const token = req.cookies?.[COOKIE_NAME] || req.cookies?.[LEGACY_COOKIE_NAME];
    const unauthenticated = () => optional ? next() : res.status(401).json({ error: 'Please sign in to continue.' });
    if (!token) return unauthenticated();

    let claims;
    try {
      claims = jwt.verify(token, config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: [JWT_ISSUER, LEGACY_JWT_ISSUER],
        audience: [JWT_AUDIENCE, LEGACY_JWT_AUDIENCE],
      });
    } catch { return unauthenticated(); }
    if (!claims || typeof claims === 'string' || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return unauthenticated();

    const result = await db.query(`
      SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at, u.id,
             u.username, u.email, u.display_name, u.avatar_url, u.created_at, u.nexconn_user_id
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2
    `, [claims.sid, claims.sub]);
    const session = result.rows[0];
    if (!session || session.revoked_at !== null || Number(session.expires_at) <= clock()) return unauthenticated();
    req.auth = { claims, session, user: safeUser(session), nexconnUserId: session.nexconn_user_id };
    return next();
  });
}

function publicNexconnConfig(config) {
  return {
    appKey: config.nexconnAppKey,
    areaCode: config.nexconnAreaCode,
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createApp({ db, config, nexconn, clock = Date.now, staticFiles = config.nodeEnv === 'production' } = {}) {
  if (!db || !config || !nexconn) throw new Error('Database, configuration, and Nexconn service are required.');
  const app = express();
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https:', 'wss:'],
        mediaSrc: ["'self'", 'blob:', 'https:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use((req, res, next) => checkRequestOrigin(req, res, next, config));

  const authMiddleware = createAuthMiddleware(db, config, clock);
  const optionalAuthMiddleware = createAuthMiddleware(db, config, clock, { optional: true });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many registration or sign-in attempts from this network. Please wait 15 minutes and try again.' },
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/auth/register', authLimiter, asyncRoute(async (req, res) => {
    const parsed = registrationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationFailure(parsed.error));

    const username = parsed.data.username;
    const email = parsed.data.email.toLowerCase();
    const conflict = await registrationConflict(db, username, email);
    if (conflict) return res.status(409).json(conflict);

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = {
      id: randomUUID(),
      username,
      email,
      display_name: username,
      avatar_url: '',
      password_hash: passwordHash,
      nexconn_user_id: randomBytes(18).toString('hex'),
      created_at: new Date(clock()).toISOString(),
    };

    let issued;
    try {
      issued = await nexconn.issueToken({ userId: user.nexconn_user_id, name: user.username });
    } catch (error) {
      if (error instanceof NexconnConfigurationError) return res.status(503).json({ error: 'Messaging sign-up is not configured on this server.' });
      if (error instanceof NexconnRequestError) return res.status(502).json({ error: 'Could not finish messaging account setup. Please try again.' });
      throw error;
    }

    try {
      const session = createSession(user, config, clock());
      await db.transaction(async (tx) => {
        await tx.query(`INSERT INTO users (id, username, email, display_name, avatar_url, password_hash, nexconn_user_id, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [user.id, user.username, user.email, user.display_name, user.avatar_url, user.password_hash, user.nexconn_user_id, user.created_at]);
        await tx.query('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)', [session.sid, user.id, session.expiresAt, session.createdAt]);
      });
      setSessionCookie(res, session.token, config);
      return res.status(201).json({ user: safeUser(user), nexconn: { ...publicNexconnConfig(config), userId: issued.userId, token: issued.accessToken } });
    } catch (error) {
      if (error?.code === '23505') return res.status(409).json(await registrationConflict(db, username, email) || { error: 'This account conflicts with an existing registration.' });
      throw error;
    }
  }));

  app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(validationFailure(parsed.error));
    const identifier = parsed.data.identifier.trim();
    const user = (await db.query('SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2) LIMIT 1', [identifier, identifier])).rows[0];
    const validPassword = user ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
    if (!validPassword || !user) return res.status(401).json({ error: 'Username/email or password is incorrect.' });

    let issued;
    try {
      issued = await nexconn.issueToken({ userId: user.nexconn_user_id, name: user.username });
    } catch (error) {
      if (error instanceof NexconnConfigurationError) return res.status(503).json({ error: 'Messaging sign-in is not configured on this server.' });
      if (error instanceof NexconnRequestError) return res.status(502).json({ error: 'Could not connect your messaging account. Please try again.' });
      throw error;
    }

    const session = createSession(user, config, clock());
    await db.query('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)', [session.sid, user.id, session.expiresAt, session.createdAt]);
    setSessionCookie(res, session.token, config);
    return res.json({ user: safeUser(user), nexconn: { ...publicNexconnConfig(config), userId: issued.userId, token: issued.accessToken } });
  }));

  app.get('/api/auth/session', optionalAuthMiddleware, asyncRoute(async (req, res) => {
    if (!req.auth) return res.json({ authenticated: false });
    const legacyToken = req.cookies?.[LEGACY_COOKIE_NAME];
    if (legacyToken && !req.cookies?.[COOKIE_NAME]) {
      setSessionCookie(res, legacyToken, config);
      res.clearCookie(LEGACY_COOKIE_NAME, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' });
    }
    try {
      const issued = await nexconn.issueToken({ userId: req.auth.nexconnUserId, name: req.auth.user.username });
      return res.json({ user: req.auth.user, nexconn: { ...publicNexconnConfig(config), userId: issued.userId, token: issued.accessToken } });
    } catch (error) {
      if (error instanceof NexconnConfigurationError) return res.status(503).json({ error: 'Messaging sign-in is not configured on this server.' });
      if (error instanceof NexconnRequestError) return res.status(502).json({ error: 'Could not reconnect your messaging account. Please try again.' });
      throw error;
    }
  }));

  app.post('/api/auth/logout', asyncRoute(async (req, res) => {
    const token = req.cookies?.[COOKIE_NAME] || req.cookies?.[LEGACY_COOKIE_NAME];
    let sessionId;
    if (token) {
      try {
        const claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: [JWT_ISSUER, LEGACY_JWT_ISSUER], audience: [JWT_AUDIENCE, LEGACY_JWT_AUDIENCE] });
        if (claims && typeof claims !== 'string' && typeof claims.sid === 'string') sessionId = claims.sid;
      } catch { /* Clear invalid or expired session cookies too. */ }
    }
    if (sessionId) await db.query('UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL', [clock(), sessionId]);
    clearSessionCookie(res, config);
    return res.status(204).end();
  }));

  app.get('/api/users', authMiddleware, asyncRoute(async (req, res) => {
    const query = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (query.length < 2 || query.length > 80) return res.json({ users: [] });
    const escapedQuery = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const matches = (await db.query(`
      SELECT id, username, email, display_name, nexconn_user_id
      FROM users
      WHERE id <> $1 AND (username ILIKE $2 ESCAPE '\\' OR display_name ILIKE $2 ESCAPE '\\' OR email ILIKE $2 ESCAPE '\\')
      ORDER BY lower(username), username
      LIMIT 25
    `, [req.auth.user.id, escapedQuery])).rows;
    return res.json({ users: matches.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name || row.username, nexconnUserId: row.nexconn_user_id })) });
  }));

  app.put('/api/account/profile', authMiddleware, asyncRoute(async (req, res) => {
    const parsed = accountProfileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Check your profile details.' });
    await db.query('UPDATE users SET display_name = $1, avatar_url = $2 WHERE id = $3', [parsed.data.displayName, parsed.data.avatarUrl, req.auth.user.id]);
    const updated = (await db.query('SELECT * FROM users WHERE id = $1', [req.auth.user.id])).rows[0];
    return res.json({ user: safeUser(updated) });
  }));

  app.post('/api/users/profiles', authMiddleware, asyncRoute(async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid profile request.' });
    if (!parsed.data.userIds.length) return res.json({ profiles: [] });
    const placeholders = parsed.data.userIds.map((_, index) => `$${index + 1}`).join(',');
    const rows = (await db.query(`SELECT nexconn_user_id, display_name, avatar_url FROM users WHERE nexconn_user_id IN (${placeholders})`, parsed.data.userIds)).rows;
    const byId = new Map(rows.map((row) => [row.nexconn_user_id, row]));
    return res.json({ profiles: parsed.data.userIds.filter((userId) => byId.has(userId)).map((userId) => ({ userId, name: byId.get(userId).display_name, avatarUrl: byId.get(userId).avatar_url || undefined })) });
  }));

  app.get('/api/favorites', authMiddleware, asyncRoute(async (req, res) => {
    const favorites = (await db.query('SELECT channel_type AS "channelType", channel_id AS "channelId" FROM favorites WHERE user_id = $1 ORDER BY created_at, channel_type, channel_id', [req.auth.user.id])).rows;
    return res.json({ favorites });
  }));

  app.post('/api/favorites', authMiddleware, asyncRoute(async (req, res) => {
    const parsed = favoriteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a valid direct or group conversation.' });
    await db.query(`INSERT INTO favorites (user_id, channel_type, channel_id, created_at)
      VALUES ($1, $2, $3, $4) ON CONFLICT(user_id, channel_type, channel_id) DO NOTHING`,
    [req.auth.user.id, parsed.data.channelType, parsed.data.channelId, new Date(clock()).toISOString()]);
    return res.status(204).end();
  }));

  app.delete('/api/favorites', authMiddleware, asyncRoute(async (req, res) => {
    const parsed = favoriteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose a valid direct or group conversation.' });
    await db.query('DELETE FROM favorites WHERE user_id = $1 AND channel_type = $2 AND channel_id = $3', [req.auth.user.id, parsed.data.channelType, parsed.data.channelId]);
    return res.status(204).end();
  }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));

  if (staticFiles) {
    const dist = path.resolve(APP_ROOT, 'dist');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (req, res, next) => {
      if (req.accepts('html')) return res.sendFile(path.join(dist, 'index.html'));
      next();
    });
  }

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request.' });
    if (isDatabaseUnavailable(error)) return res.status(503).json({ error: 'The account store is temporarily unavailable. Please retry.' });
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
  });
  return app;
}
