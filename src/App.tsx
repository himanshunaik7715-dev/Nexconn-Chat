import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { LoginPage, type AuthPayload } from '@/pages/LoginPage';
import { diagnostic } from '@/lib/diagnostics';
import { readApiResponse } from '@/lib/api-response';

const ChatPage = lazy(() => import('@/pages/ChatPage').then((module) => ({ default: module.ChatPage })));

type Account = AuthPayload['user'];

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = useCallback(async (payload: AuthPayload) => {
    try {
      const runtime = await import('@/lib/nexconn-runtime');
      // The Chat UI app is configured and readied once per page. Reuse that
      // ready instance after logout; the SDK factory cannot configure a second
      // instance in the same page lifecycle.
      runtime.prepareNexconn(payload.nexconn.appKey, payload.nexconn.areaCode);
      await runtime.connectNexconn(payload.nexconn.token, payload.nexconn.userId);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not initialize messaging.');
      return;
    }
    // Mount the chat UI only after the session connects. For account switches,
    // the SDK clears its previous user's channel cache on connect before any
    // old conversation rows can be rendered.
    setAccount(payload.user);
  }, []);

  const loadSession = useCallback(async () => {
    diagnostic('AUTH_SESSION_REQUEST_STARTED');
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (!response.ok) {
      diagnostic('AUTH_SESSION_FAILED', { httpStatus: response.status });
      throw new Error('Your account session could not reconnect to messaging. Check the server configuration.');
    }
    const payload = await readApiResponse<AuthPayload & { authenticated?: boolean }>(response, 'Session check');
    diagnostic('AUTH_SESSION_OK', { httpStatus: response.status, authenticated: payload.authenticated !== false });
    if (payload.authenticated === false) return;
    diagnostic('NEXCONN_TOKEN_RECEIVED', { tokenPresent: Boolean(payload.nexconn?.token) });
    await connect(payload);
  }, [connect]);

  useEffect(() => {
    let active = true;
    void loadSession().catch((cause) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setBooting(false); });
    return () => { active = false; };
  }, [loadSession]);

  const authenticate = async (path: '/api/auth/login' | '/api/auth/register', data: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
      });
      const payload = await readApiResponse<AuthPayload & { error?: string; fieldErrors?: Record<string, string> }>(response, path === '/api/auth/login' ? 'Sign in' : 'Account registration');
      if (!response.ok) {
        diagnostic('AUTH_SESSION_FAILED', { httpStatus: response.status });
        const failure = new Error(payload.error || 'Could not continue.') as Error & { fieldErrors?: Record<string, string> };
        failure.fieldErrors = payload.fieldErrors;
        throw failure;
      }
      diagnostic('AUTH_SESSION_OK', { httpStatus: response.status, authenticated: true });
      diagnostic('NEXCONN_TOKEN_RECEIVED', { tokenPresent: Boolean(payload.nexconn?.token) });
      await connect(payload as AuthPayload);
    } catch (cause) {
      throw cause instanceof Error ? cause : new Error('Could not continue.');
    } finally { setBusy(false); }
  };

  const reconnect = async () => {
    diagnostic('NEXCONN_RECONNECT_STARTED');
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (!response.ok) {
      diagnostic('NEXCONN_TOKEN_REQUEST_FAILED', { httpStatus: response.status, reason: 'session_endpoint' });
      throw new Error('Could not refresh the Nexconn connection. Please sign in again.');
    }
    const payload = await readApiResponse<AuthPayload & { authenticated?: boolean }>(response, 'Messaging reconnect');
    if (payload.authenticated === false) {
      diagnostic('AUTH_SESSION_FAILED', { httpStatus: response.status, authenticated: false });
      throw new Error('Your sign-in session expired. Please sign in again.');
    }
    diagnostic('AUTH_SESSION_OK', { httpStatus: response.status, authenticated: true });
    diagnostic('NEXCONN_TOKEN_RECEIVED', { tokenPresent: Boolean(payload.nexconn?.token) });
    const { sdk } = await import('@/lib/nexconn');
    await sdk.reconnect(payload.nexconn.token, payload.nexconn.userId);
    setError('');
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    const { sdk } = await import('@/lib/nexconn');
    await sdk.disconnect();
    setAccount(null);
  };

  if (booting) return <main className="auth-page"><p className="auth-loading">Loading your secure session…</p></main>;
  if (!account) return <LoginPage error={error} busy={busy} onAuthenticate={authenticate} />;
  return <Suspense fallback={<main className="auth-page"><p className="auth-loading">Loading your conversations…</p></main>}><ChatPage account={account} onLogout={logout} onReconnect={reconnect} /></Suspense>;
}
