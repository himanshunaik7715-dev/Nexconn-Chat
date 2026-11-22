const SAFE_DIAGNOSTIC_KEYS = new Set([
  'status', 'httpStatus', 'code', 'requestId', 'authenticated', 'identityMatches',
  'tokenPresent', 'areaCode', 'attempt', 'durationMs', 'reason',
  'appWarningVisible', 'connectingIndicatorVisible', 'chatUiConnectionStatusIndicatorEnabled',
]);

export function diagnostic(event: string, metadata: Record<string, string | number | boolean | undefined> = {}) {
  if (!import.meta.env.DEV) return;
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => SAFE_DIAGNOSTIC_KEYS.has(key) && value !== undefined),
  );
  console.info(`[Nexconn] ${event}`, safeMetadata);
}
