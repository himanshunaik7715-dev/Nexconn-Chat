export type ConnectionReason = 'identity_mismatch' | 'cancelled' | 'connect_failed' | 'request_failed' | 'account_switch_in_progress';

export class NexconnConnectionError extends Error {
  reason: ConnectionReason;
  code?: number;
  constructor(reason: ConnectionReason, code?: number);
}

export class SingleFlightConnector {
  run(
    connect: (params: { token: string }) => Promise<{ isOk: boolean; code: number; data?: { userId?: string } }>,
    token: string,
    expectedUserId: string,
  ): Promise<{ code: number; userId: string }>;
  cancel(): void;
}

export class SdkInitializationGuard {
  initializeOnce(
    configuration: { appKey: string; areaCode: string },
    initialize: () => void,
  ): boolean;
}

export function shouldShowConnectionWarning(status: string): boolean;
