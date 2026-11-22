import { createHash, randomBytes, randomUUID } from 'node:crypto';

export class NexconnConfigurationError extends Error {
  constructor() {
    super('Nexconn server credentials are not configured.');
    this.name = 'NexconnConfigurationError';
  }
}

export class NexconnRequestError extends Error {
  constructor() {
    super('Nexconn could not issue a user token.');
    this.name = 'NexconnRequestError';
  }
}

export function createNexconnService(config, fetchImpl = fetch) {
  const validApiBaseUrl = () => {
    try {
      const url = new URL(config.nexconnApiBaseUrl);
      return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/';
    } catch { return false; }
  };
  return {
    isConfigured() {
      return Boolean(config.nexconnAppKey && config.nexconnAppSecret && validApiBaseUrl());
    },

    async issueToken({ userId, name }) {
      if (!this.isConfigured()) throw new NexconnConfigurationError();

      const requestId = randomUUID();
      const startedAt = Date.now();
      config.diagnostic?.('NEXCONN_TOKEN_REQUEST_STARTED', { requestId });
      const nonce = randomBytes(9).toString('hex');
      const timestamp = String(Date.now());
      const signature = createHash('sha1')
        .update(`${config.nexconnAppSecret}${nonce}${timestamp}`)
        .digest('hex');
      const url = new URL('/v4/auth/access-token/issue', config.nexconnApiBaseUrl);

      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'App-Key': config.nexconnAppKey,
            Nonce: nonce,
            Timestamp: timestamp,
            Signature: signature,
            'X-Request-ID': requestId,
          },
          body: JSON.stringify({ userId, name }),
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        config.diagnostic?.('NEXCONN_TOKEN_REQUEST_FAILED', { requestId, reason: 'network', durationMs: Date.now() - startedAt });
        throw new NexconnRequestError();
      }

      if (!response.ok) {
        config.diagnostic?.('NEXCONN_TOKEN_REQUEST_FAILED', { requestId, httpStatus: response.status, reason: 'http', durationMs: Date.now() - startedAt });
        throw new NexconnRequestError();
      }
      let body;
      try { body = await response.json(); } catch {
        config.diagnostic?.('NEXCONN_TOKEN_REQUEST_FAILED', { requestId, httpStatus: response.status, reason: 'invalid_json', durationMs: Date.now() - startedAt });
        throw new NexconnRequestError();
      }
      const identityMatches = body?.result?.userId === userId;
      const tokenIsValid = typeof body?.result?.accessToken === 'string' && Boolean(body.result.accessToken) && Buffer.byteLength(body.result.accessToken, 'utf8') <= 256;
      if (body?.code !== 0 || !identityMatches || !tokenIsValid) {
        config.diagnostic?.('NEXCONN_TOKEN_REQUEST_FAILED', { requestId, httpStatus: response.status, code: Number.isInteger(body?.code) ? body.code : undefined, identityMatches, reason: 'invalid_response', durationMs: Date.now() - startedAt });
        throw new NexconnRequestError();
      }

      config.diagnostic?.('NEXCONN_TOKEN_RECEIVED', { requestId, httpStatus: response.status, code: body.code, identityMatches, tokenBytes: Buffer.byteLength(body.result.accessToken, 'utf8'), durationMs: Date.now() - startedAt });
      return { userId, accessToken: body.result.accessToken };
    },
  };
}
