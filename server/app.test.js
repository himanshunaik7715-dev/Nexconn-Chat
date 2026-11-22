import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from './app.js';
import { createNexconnService } from './nexconn.js';
import { createIsolatedDatabase } from '../test/postgres-test-database.js';

const config = { nodeEnv: 'test', jwtSecret: 'test-only-secret-with-at-least-32-characters', appOrigin: 'http://localhost:5173', cookieSecure: false, nexconnAppKey: 'app-key-test', nexconnAppSecret: 'nexconn-secret-never-in-response', nexconnAreaCode: 'SG' };
const mockNexconn = { isConfigured: () => true, issueToken: async ({ userId }) => ({ userId, accessToken: `issued-${userId}` }) };

test('account sessions protect APIs and support two-user direct discovery', async (t) => {
  const { database: db } = await createIsolatedDatabase();
  const server = createServer(createApp({ db, config, nexconn: mockNexconn, staticFiles: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { cookie, ...options } = {}) => fetch(`${base}${path}`, {
    ...options,
    headers: { Origin: config.appOrigin, ...(options.body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...options.headers },
  });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await db.close(); });

  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  assert.equal((await request('/api/users?search=alice')).status, 401);
  assert.equal((await request('/api/users?search=alice', { cookie: 'nas_session=invalid-token' })).status, 401);
  const anonymousSession = await request('/api/auth/session');
  assert.equal(anonymousSession.status, 200);
  assert.deepEqual(await anonymousSession.json(), { authenticated: false });
  const staleSession = await request('/api/auth/session', { cookie: 'nas_session=invalid-token' });
  assert.equal(staleSession.status, 200);
  assert.deepEqual(await staleSession.json(), { authenticated: false });
  const register = async (username, email) => {
    const response = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password: 'correct horse battery' }) });
    assert.equal(response.status, 201);
    const data = await response.json();
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^nexconn_session=/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/i);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/i);
    assert.match(data.nexconn.token, /^issued-/);
    assert.equal(JSON.stringify(data).includes(config.jwtSecret), false);
    assert.equal(JSON.stringify(data).includes(config.nexconnAppSecret), false);
    return { data, cookie };
  };
  const usernameWithHiddenChar = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'Himanshu_\u200B01', email: 'hidden-char@example.test', password: 'correct horse battery' }) });
  assert.equal(usernameWithHiddenChar.status, 400);
  const hiddenCharError = await usernameWithHiddenChar.json();
  assert.equal(hiddenCharError.error, 'Please correct the highlighted field.');
  assert.match(hiddenCharError.fieldErrors.username, /position 10 \(U\+200B\)/);
  const invalidEmail = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'valid_name', email: 'not-an-email', password: 'correct horse battery' }) });
  assert.equal(invalidEmail.status, 400);
  assert.equal((await invalidEmail.json()).fieldErrors.email, 'Enter a valid email address.');
  const shortPassword = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'valid_name', email: 'short@example.test', password: 'short' }) });
  assert.equal(shortPassword.status, 400);
  assert.equal((await shortPassword.json()).fieldErrors.password, 'Password must be at least 10 characters.');
  const missingLoginFields = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: '', password: '' }) });
  assert.equal(missingLoginFields.status, 400);
  assert.equal((await missingLoginFields.json()).fieldErrors.identifier, 'Enter your username or email.');
  const validUnderscoreName = await register('Himanshu_01', 'himanshu@example.test');
  assert.equal(validUnderscoreName.data.user.username, 'Himanshu_01');
  const alice = await register('alice', 'alice@example.test');
  const validClaims = jwt.verify(alice.cookie.slice(alice.cookie.indexOf('=') + 1), config.jwtSecret, { algorithms: ['HS256'] });
  assert.equal(validClaims.iss, 'nexconn-chat');
  assert.equal(validClaims.aud, 'nexconn-chat-web');
  const legacyJwt = jwt.sign({ sid: validClaims.sid }, config.jwtSecret, { algorithm: 'HS256', subject: alice.data.user.id, expiresIn: '1h', issuer: 'nas-on', audience: 'nas-on-web' });
  const legacySession = await request('/api/auth/session', { cookie: `nas_session=${legacyJwt}` });
  assert.equal(legacySession.status, 200);
  assert.match(legacySession.headers.get('set-cookie'), /nexconn_session=/);
  assert.match(legacySession.headers.get('set-cookie'), /nas_session=;/);
  const expiredJwt = jwt.sign({ sid: validClaims.sid }, config.jwtSecret, { algorithm: 'HS256', subject: alice.data.user.id, expiresIn: -1, issuer: 'nexconn-chat', audience: 'nexconn-chat-web' });
  assert.equal((await request('/api/users?search=bob', { cookie: `nas_session=${expiredJwt}` })).status, 401);
  assert.deepEqual(await (await request('/api/auth/session', { cookie: `nas_session=${expiredJwt}` })).json(), { authenticated: false });
  const refreshed = await request('/api/auth/session', { cookie: alice.cookie });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).user.username, 'alice');
  const passwordHash = (await db.query('SELECT password_hash FROM users WHERE id = $1', [alice.data.user.id])).rows[0].password_hash;
  assert.notEqual(passwordHash, 'correct horse battery');
  assert.match(passwordHash, /^\$2[aby]\$/);
  const duplicate = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'Alice', email: 'other@example.test', password: 'correct horse battery' }) });
  assert.equal(duplicate.status, 409);
  assert.ok((await duplicate.json()).fieldErrors.username);
  const duplicateEmail = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'alice_two', email: 'alice@example.test', password: 'correct horse battery' }) });
  assert.equal(duplicateEmail.status, 409);
  assert.ok((await duplicateEmail.json()).fieldErrors.email);

  const wrong = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'alice', password: 'wrong password' }) });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, 'Username/email or password is incorrect.');
  const valid = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'ALICE@EXAMPLE.TEST', password: 'correct horse battery' }) });
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get('set-cookie'), /HttpOnly/i);

  const bob = await register('bob_user', 'bob@example.test');
  assert.equal((await request('/api/favorites')).status, 401);
  const addFavorite = await request('/api/favorites', { method: 'POST', cookie: alice.cookie, body: JSON.stringify({ channelType: 'direct', channelId: bob.data.nexconn.userId }) });
  assert.equal(addFavorite.status, 204);
  assert.equal((await request('/api/favorites', { method: 'POST', cookie: alice.cookie, body: JSON.stringify({ channelType: 'group', channelId: 'group-123' }) })).status, 204);
  assert.equal((await request('/api/favorites', { method: 'POST', cookie: alice.cookie, body: JSON.stringify({ channelType: 'group', channelId: 'group-123' }) })).status, 204);
  const aliceFavorites = await request('/api/favorites', { cookie: alice.cookie });
  assert.deepEqual((await aliceFavorites.json()).favorites, [
    { channelType: 'direct', channelId: bob.data.nexconn.userId },
    { channelType: 'group', channelId: 'group-123' },
  ]);
  assert.deepEqual((await (await request('/api/favorites', { cookie: bob.cookie })).json()).favorites, []);
  assert.equal((await request('/api/favorites', { method: 'POST', cookie: alice.cookie, body: JSON.stringify({ channelType: 'open', channelId: 'open-123' }) })).status, 400);
  assert.equal((await request('/api/favorites', { method: 'POST', cookie: alice.cookie, body: JSON.stringify({ userId: bob.data.user.id, channelType: 'direct', channelId: 'spoof' }) })).status, 400);
  assert.equal((await request('/api/favorites', { method: 'DELETE', cookie: alice.cookie, body: JSON.stringify({ channelType: 'direct', channelId: bob.data.nexconn.userId }) })).status, 204);
  assert.deepEqual((await (await request('/api/favorites', { cookie: alice.cookie })).json()).favorites, [
    { channelType: 'group', channelId: 'group-123' },
  ]);
  const found = await request('/api/users?search=bob', { cookie: alice.cookie });
  assert.equal(found.status, 200);
  const foundUsers = (await found.json()).users;
  assert.equal(foundUsers.length, 1);
  assert.equal(foundUsers[0].username, 'bob_user');
  assert.equal(foundUsers[0].email, undefined);
  assert.ok(foundUsers[0].nexconnUserId);
  const profiles = await request('/api/users/profiles', { method: 'POST', cookie: alice.cookie, body: JSON.stringify({ userIds: [bob.data.nexconn.userId] }) });
  assert.equal((await profiles.json()).profiles[0].name, 'bob_user');
  const changedProfile = await request('/api/account/profile', { method: 'PUT', cookie: bob.cookie, body: JSON.stringify({ userId: alice.data.user.id, displayName: 'Bob Example', avatarUrl: 'https://images.example.test/bob.png' }) });
  assert.equal(changedProfile.status, 200);
  assert.equal((await changedProfile.json()).user.displayName, 'Bob Example');
  const displayNameSearch = await request('/api/users?search=Bob%20Example', { cookie: alice.cookie });
  assert.equal(displayNameSearch.status, 200);
  assert.equal((await displayNameSearch.json()).users[0].username, 'bob_user');
  assert.equal((await db.query('SELECT display_name FROM users WHERE id = $1', [alice.data.user.id])).rows[0].display_name, 'alice');
  const updatedProfiles = await request('/api/users/profiles', { method: 'POST', cookie: alice.cookie, body: JSON.stringify({ userIds: [bob.data.nexconn.userId] }) });
  assert.equal((await updatedProfiles.json()).profiles[0].name, 'Bob Example');
  const unsafeAvatar = await request('/api/account/profile', { method: 'PUT', cookie: bob.cookie, body: JSON.stringify({ displayName: 'Bob Example', avatarUrl: 'http://insecure.example.test/avatar.png' }) });
  assert.equal(unsafeAvatar.status, 400);
  const csrf = await request('/api/auth/logout', { method: 'POST', cookie: alice.cookie, headers: { Origin: 'https://attacker.example' } });
  assert.equal(csrf.status, 403);
  const logout = await request('/api/auth/logout', { method: 'POST', cookie: alice.cookie });
  assert.equal(logout.status, 204);
  assert.equal((await request('/api/users?search=bob', { cookie: alice.cookie })).status, 401);

  const expiredAccount = await register('expired_user', 'expired@example.test');
  await db.query('UPDATE sessions SET expires_at = 0 WHERE user_id = $1', [expiredAccount.data.user.id]);
  assert.equal((await request('/api/users?search=bob', { cookie: expiredAccount.cookie })).status, 401);
});

test('Nexconn user token request uses documented signature headers and body', async () => {
  const secret = 'server-only-app-secret';
  let captured;
  const diagnostics = [];
  const service = createNexconnService({ nexconnAppKey: 'configured-key', nexconnAppSecret: secret, nexconnApiBaseUrl: 'https://api.sg-light-api.com', diagnostic: (event, metadata) => diagnostics.push({ event, metadata }) }, async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ code: 0, result: { userId: 'user-123', accessToken: 'opaque-user-token' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const issued = await service.issueToken({ userId: 'user-123', name: 'alice' });
  assert.deepEqual(issued, { userId: 'user-123', accessToken: 'opaque-user-token' });
  assert.equal(captured.url, 'https://api.sg-light-api.com/v4/auth/access-token/issue');
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body, { userId: 'user-123', name: 'alice' });
  const headers = captured.options.headers;
  const timestamp = headers.Timestamp;
  assert.equal(headers.Signature, createHash('sha1').update(`${secret}${headers.Nonce}${timestamp}`).digest('hex'));
  assert.equal(headers['App-Key'], 'configured-key');
  assert.match(headers['X-Request-ID'], /^[0-9a-f-]{36}$/i);
  assert.equal(captured.options.body.includes(secret), false);
  assert.equal(diagnostics[0].event, 'NEXCONN_TOKEN_REQUEST_STARTED');
  assert.equal(diagnostics[1].event, 'NEXCONN_TOKEN_RECEIVED');
  assert.equal(diagnostics[1].metadata.httpStatus, 200);
  assert.equal(diagnostics[1].metadata.code, 0);
  assert.equal(diagnostics[1].metadata.identityMatches, true);
  assert.equal(diagnostics[1].metadata.tokenBytes, Buffer.byteLength(issued.accessToken));
  assert.equal(JSON.stringify(diagnostics).includes(issued.accessToken), false);
});

test('Nexconn token request diagnostics retain safe HTTP failure details only', async () => {
  const diagnostics = [];
  const service = createNexconnService({ nexconnAppKey: 'configured-key', nexconnAppSecret: 'server-only-app-secret', nexconnApiBaseUrl: 'https://api.sg-light-api.com', diagnostic: (event, metadata) => diagnostics.push({ event, metadata }) }, async () => new Response('{"code":401,"message":"sensitive upstream body"}', { status: 401 }));
  await assert.rejects(service.issueToken({ userId: 'user-123', name: 'alice' }), { name: 'NexconnRequestError' });
  assert.equal(diagnostics.at(-1).event, 'NEXCONN_TOKEN_REQUEST_FAILED');
  assert.equal(diagnostics.at(-1).metadata.httpStatus, 401);
  assert.equal(diagnostics.at(-1).metadata.reason, 'http');
  assert.equal(JSON.stringify(diagnostics).includes('sensitive upstream body'), false);
});

test('Nexconn token service fails closed without server credentials or HTTPS base URL', async () => {
  const service = createNexconnService({ nexconnAppKey: 'key', nexconnAppSecret: '', nexconnApiBaseUrl: 'http://127.0.0.1:3000' });
  assert.equal(service.isConfigured(), false);
  await assert.rejects(service.issueToken({ userId: 'test-user', name: 'test' }), { name: 'NexconnConfigurationError' });
});
