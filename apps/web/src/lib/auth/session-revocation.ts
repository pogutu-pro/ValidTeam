type DurableSessionActor = {
  status: 'active' | 'inactive' | 'invited';
  sessionVersion: number;
};

type RevocableUserStatus = DurableSessionActor['status'];

export function normalizeClaimedSessionVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Legacy JWTs predate the version claim and are treated as version zero. This
 * keeps existing active sessions usable after migration while guaranteeing
 * that the first revocation permanently invalidates every older token.
 */
export function isDurableSessionValid(
  actor: DurableSessionActor | null | undefined,
  claimedVersion: unknown
): boolean {
  return (
    actor?.status === 'active' &&
    actor.sessionVersion === normalizeClaimedSessionVersion(claimedVersion)
  );
}

export function shouldRotateSessionVersion(
  currentStatus: RevocableUserStatus,
  nextStatus: RevocableUserStatus | undefined
): boolean {
  return nextStatus !== undefined && nextStatus !== 'active' && nextStatus !== currentStatus;
}
