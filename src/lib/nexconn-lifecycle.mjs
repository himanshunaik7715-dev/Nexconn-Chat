export class NexconnConnectionError extends Error {
  constructor(reason, code) {
    super(reason === 'identity_mismatch'
      ? 'Nexconn authenticated a different user than the signed-in account.'
      : reason === 'cancelled'
        ? 'Nexconn connection was cancelled.'
        : Number.isInteger(code)
          ? `Nexconn connection failed (code ${code}).`
          : 'Nexconn connection request failed.');
    this.name = 'NexconnConnectionError';
    this.reason = reason;
    this.code = code;
  }
}

export class SingleFlightConnector {
  #generation = 0;
  #pending = null;

  run(connect, token, expectedUserId) {
    if (this.#pending) {
      if (this.#pending.userId !== expectedUserId) {
        return Promise.reject(new NexconnConnectionError('account_switch_in_progress'));
      }
      return this.#pending.promise;
    }

    const generation = this.#generation;
    const attempt = { userId: expectedUserId, promise: null };
    attempt.promise = Promise.resolve().then(() => connect({ token })).then((result) => {
      if (generation !== this.#generation) throw new NexconnConnectionError('cancelled');
      if (!result?.isOk) throw new NexconnConnectionError('connect_failed', result?.code);
      if (result.data?.userId !== expectedUserId) throw new NexconnConnectionError('identity_mismatch');
      return { code: result.code, userId: result.data.userId };
    }, () => {
      if (generation !== this.#generation) throw new NexconnConnectionError('cancelled');
      throw new NexconnConnectionError('request_failed');
    }).finally(() => {
      if (this.#pending === attempt) this.#pending = null;
    });
    this.#pending = attempt;
    return attempt.promise;
  }

  cancel() {
    this.#generation += 1;
  }
}

export class SdkInitializationGuard {
  #configuration = null;

  initializeOnce(configuration, initialize) {
    if (this.#configuration) {
      if (this.#configuration.appKey !== configuration.appKey || this.#configuration.areaCode !== configuration.areaCode) {
        throw new Error('Nexconn SDK configuration changed during this page session. Reload the app to switch environments.');
      }
      return false;
    }
    initialize();
    this.#configuration = { appKey: configuration.appKey, areaCode: configuration.areaCode };
    return true;
  }
}

export function shouldShowConnectionWarning(status) {
  return status === 'disconnected' || status === 'error';
}
