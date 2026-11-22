import test from 'node:test';
import assert from 'node:assert/strict';
import { NexconnConnectionError, SdkInitializationGuard, shouldShowConnectionWarning, SingleFlightConnector } from '../src/lib/nexconn-lifecycle.mjs';

test('SDK connection requires an isOk result and the expected Nexconn identity', async () => {
  const connector = new SingleFlightConnector();
  const result = await connector.run(async ({ token }) => {
    assert.equal(token, 'memory-only-test-token');
    return { isOk: true, code: 0, data: { userId: 'nexconn-user-1' } };
  }, 'memory-only-test-token', 'nexconn-user-1');
  assert.deepEqual(result, { code: 0, userId: 'nexconn-user-1' });
});

test('SDK failures retain the documented error code without claiming success', async () => {
  const connector = new SingleFlightConnector();
  await assert.rejects(
    connector.run(async () => ({ isOk: false, code: 31004 }), 'opaque-test-token', 'user-1'),
    (error) => error instanceof NexconnConnectionError && error.reason === 'connect_failed' && error.code === 31004,
  );
  await assert.rejects(
    connector.run(async () => ({ isOk: true, code: 0, data: { userId: 'other-user' } }), 'opaque-test-token', 'user-1'),
    (error) => error instanceof NexconnConnectionError && error.reason === 'identity_mismatch',
  );
});

test('concurrent SDK connect requests for the same user share one attempt', async () => {
  const connector = new SingleFlightConnector();
  let finish;
  let calls = 0;
  const connect = () => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  };
  const first = connector.run(connect, 'token-1', 'user-1');
  const second = connector.run(connect, 'token-2', 'user-1');
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ isOk: true, code: 0, data: { userId: 'user-1' } });
  await Promise.all([first, second]);
});

test('logout invalidates a pending SDK result and a later user waits for cleanup', async () => {
  const connector = new SingleFlightConnector();
  let finish;
  const pending = connector.run(() => new Promise((resolve) => { finish = resolve; }), 'token-1', 'user-1');
  await Promise.resolve();
  connector.cancel();
  await assert.rejects(connector.run(async () => ({ isOk: true, code: 0, data: { userId: 'user-2' } }), 'token-2', 'user-2'), { reason: 'account_switch_in_progress' });
  finish({ isOk: true, code: 0, data: { userId: 'user-1' } });
  await assert.rejects(pending, { reason: 'cancelled' });
  const next = await connector.run(async () => ({ isOk: true, code: 0, data: { userId: 'user-2' } }), 'token-2', 'user-2');
  assert.equal(next.userId, 'user-2');
});

test('Nexconn SDK initialization runs once and rejects app configuration changes', () => {
  const guard = new SdkInitializationGuard();
  let calls = 0;
  const configuration = { appKey: 'app-key', areaCode: 'SG' };
  assert.equal(guard.initializeOnce(configuration, () => { calls += 1; }), true);
  assert.equal(guard.initializeOnce(configuration, () => { calls += 1; }), false);
  assert.equal(calls, 1);
  assert.throws(() => guard.initializeOnce({ appKey: 'other-key', areaCode: 'SG' }, () => { calls += 1; }), /configuration changed/);
  assert.equal(calls, 1);
});

test('the application banner follows actual SDK state and retains real disconnect warnings', () => {
  assert.equal(shouldShowConnectionWarning('connected'), false);
  assert.equal(shouldShowConnectionWarning('connecting'), false);
  assert.equal(shouldShowConnectionWarning('idle'), false);
  assert.equal(shouldShowConnectionWarning('disconnected'), true);
  assert.equal(shouldShowConnectionWarning('error'), true);
});
