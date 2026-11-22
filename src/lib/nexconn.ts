import { NCEngine } from '@nexconn/chat';
import { DirectChannelIdentifier } from '@nexconn/chat';
import type { NCChatUIApplication, ServiceHooks } from '@nexconn/chatui';
import { diagnostic } from './diagnostics';
import { readApiResponse } from './api-response';
import { NexconnConnectionError, SingleFlightConnector } from './nexconn-lifecycle.mjs';

class NexconnSDK {
  private app: ReturnType<typeof NCChatUIApplication.initialize> = null;
  private currentUserId = '';
  private connection: { token: string; userId: string } | null = null;
  private status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' = 'idle';
  private connectionError = '';
  private connectionCode?: number;
  private readonly connector = new SingleFlightConnector();
  private listeners = new Set<(status: NexconnSDK['status']) => void>();

  setStatus(status: NexconnSDK['status'], code?: number) {
    const changed = this.status !== status || this.connectionCode !== code;
    this.status = status;
    if (code !== undefined) this.connectionCode = code;
    if (changed) diagnostic('NEXCONN_CONNECTION_STATUS', { status, code });
    this.listeners.forEach((listener) => listener(status));
  }
  onStatus(listener: (status: NexconnSDK['status']) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => { this.listeners.delete(listener); };
  }
  getStatus() { return this.status; }
  getConnectionError() { return this.connectionError; }
  getConnectionCode() { return this.connectionCode; }
  setCurrentUser(userId: string) { this.currentUserId = userId; }
  setConnection(token: string, userId: string) { this.connection = { token, userId }; }
  setConnectionFailure(code?: number) {
    this.connectionCode = code;
    this.connectionError = code === 31010
      ? 'This Nexconn account was signed in on another device.'
      : code === 31004 || code === 31020
        ? 'Nexconn rejected or expired the user token. Requesting a fresh token is required.'
        : Number.isInteger(code) && (code as number) >= 0
          ? `Nexconn connection failed (code ${code}).`
          : 'Nexconn connection failed. Please retry or check the service connection.';
    this.setStatus(code === 31004 || code === 31020 || code === 31010 ? 'error' : 'disconnected', code);
  }
  clearConnectionError() { this.connectionError = ''; this.connectionCode = undefined; }
  async connect(token: string, expectedUserId: string, source: 'initial' | 'manual' = 'initial') {
    if (this.status === 'connected' && this.currentUserId === expectedUserId) return;
    this.connection = { token, userId: expectedUserId };
    this.clearConnectionError();
    this.setStatus('connecting');
    const startedAt = Date.now();
    diagnostic(source === 'initial' ? 'NEXCONN_CONNECT_STARTED' : 'NEXCONN_RECONNECT_STARTED');
    try {
      const result = await this.connector.run((params) => NCEngine.connect(params), token, expectedUserId);
      this.setCurrentUser(result.userId);
      // The SDK status callback may already have reported a terminal failure.
      // Only the successful connect result or a CONNECTED event clears it.
      if (this.status === 'connecting') {
        this.clearConnectionError();
        this.setStatus('connected', result.code);
      } else if (this.status === 'connected') {
        this.clearConnectionError();
      }
      diagnostic(source === 'initial' ? 'NEXCONN_CONNECT_SUCCEEDED' : 'NEXCONN_RECONNECT_SUCCEEDED', { code: result.code, identityMatches: true, durationMs: Date.now() - startedAt });
    } catch (cause) {
      const connectionError = cause instanceof NexconnConnectionError ? cause : null;
      if (connectionError?.reason !== 'cancelled') {
        this.setConnectionFailure(connectionError?.code);
        diagnostic(source === 'initial' ? 'NEXCONN_CONNECT_FAILED' : 'NEXCONN_RECONNECT_FAILED', {
          code: connectionError?.code,
          reason: connectionError?.reason ?? 'request_rejected',
          durationMs: Date.now() - startedAt,
        });
      }
      throw cause instanceof Error ? cause : new Error('Nexconn connection failed.');
    }
  }
  async reconnect(token?: string, expectedUserId?: string) {
    if (!this.connection) throw new Error('Sign in again to reconnect messaging.');
    const { userId } = this.connection;
    if (expectedUserId && expectedUserId !== userId) throw new Error('The refreshed Nexconn token belongs to a different signed-in user.');
    return this.connect(token ?? this.connection.token, userId, 'manual');
  }
  setApp(app: ReturnType<typeof NCChatUIApplication.initialize>) { this.app = app; }
  getApp() { return this.app; }
  getUserId() { return this.currentUserId; }

  buildHooks(): ServiceHooks {
    return {
      reqUserProfiles: async (userIds) => {
        try {
          const response = await fetch('/api/users/profiles', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userIds }) });
          if (!response.ok) throw new Error('profile lookup failed');
          const result = await readApiResponse(response, 'User profile lookup') as { profiles: Array<{ userId: string; name: string; avatarUrl?: string }> };
          const profiles = new Map(result.profiles.map((profile) => [profile.userId, profile]));
          return userIds.map((userId) => ({ userId, name: profiles.get(userId)?.name || userId, avatarUrl: profiles.get(userId)?.avatarUrl }));
        } catch { return userIds.map((userId) => ({ userId, name: userId })); }
      },
      reqGroupProfiles: async (groupIds) => groupIds.map((groupId) => ({ groupId, name: groupId, memberCount: 0 })),
      reqSystemProfiles: async (systemIds) => systemIds.map((systemId) => ({ systemId, name: systemId })),
      reqGroupMembers: async () => [],
    };
  }

  async openDirect(userId: string) {
    if (!this.app?.ifReady()) throw new Error('Chat is still connecting. Please try again.');
    const result = await this.app.openChannel(new DirectChannelIdentifier(userId), true);
    if (!result.isOk) throw new Error('Could not open this conversation.');
  }

  async disconnect() {
    this.connector.cancel();
    diagnostic('NEXCONN_DISCONNECT_STARTED');
    try { await NCEngine.disconnect(); } catch { /* SDK may already be disconnected. */ }
    this.currentUserId = '';
    this.connection = null;
    this.clearConnectionError();
    // NCChatUIApplication is a page-lifetime singleton. Destroying it and
    // initializing again leaves the SDK factory with an already-ready app;
    // every pre-ready configuration call then fails on the next login.
    this.setStatus('idle');
    diagnostic('NEXCONN_DISCONNECTED');
  }
}

export const sdk = new NexconnSDK();
