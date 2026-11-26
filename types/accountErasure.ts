/** Public account-erasure wire contract. No server runtime is imported by RN. */
export const ACCOUNT_ERASURE_PROTOCOL = 'account_erasure_v1' as const;
export const ACCOUNT_ERASURE_RECEIPT = 'account_erasure_receipt_v1' as const;
export const ACCOUNT_ERASURE_STATES = ['requested', 'inspecting', 'awaiting_obligations', 'awaiting_review',
  'awaiting_apple_authorization', 'erasing', 'auth_deletion_pending', 'completed', 'needs_attention', 'not_executed'] as const;
export type AccountErasureState = typeof ACCOUNT_ERASURE_STATES[number];
export interface AccountErasureReceipt {
  kind: typeof ACCOUNT_ERASURE_RECEIPT;
  commandId: string;
  requestId: string;
  state: AccountErasureState;
  version: number;
  accountAccessClosed: boolean;
  deletionComplete: boolean;
  appleAuthorizationRequired: boolean;
  progress: {completedSteps: number; totalSteps: number};
  reasons: string[];
  updatedAt: string;
  completedAt: string | null;
  retentionPolicyVersion: string;
  observationExpiresAt: string | null;
  success: boolean;
  status: 'incomplete' | 'complete';
  newOperationsBlocked: true;
}

/** Renderable local reference. The private observation key is deliberately
 * absent; only the secure journal can construct the transport payload. */
export interface AccountErasureAttempt {
  protocol: typeof ACCOUNT_ERASURE_PROTOCOL;
  ownerId: string;
  requestId: string;
  commandId: string;
  preparedAt: number;
  phase: 'prepared' | 'submitted';
  receipt: AccountErasureReceipt | null;
}
export interface AccountErasureRecoveryAttempt {
  protocol: typeof ACCOUNT_ERASURE_PROTOCOL;
  ownerId: string;
  recoveryId: string;
  preparedAt: number;
  phase: 'prepared' | 'submitted';
}
export type AccountErasureLocalAttempt = AccountErasureAttempt | AccountErasureRecoveryAttempt;
export type AccountErasureOperation = 'request' | 'observe' | 'resume' | 'authorize_apple';
export interface AccountErasurePayload {
  capability: typeof ACCOUNT_ERASURE_PROTOCOL;
  mode: 'delete';
  operation: AccountErasureOperation;
  requestId: string;
  commandId: string;
  observationKey: string;
  expectedUid?: string;
  confirmed?: true;
  appleAuthorizationCode?: string;
  appleAuthorizationFlow?: 'ios_native' | 'web_code';
}
export interface AccountErasureRecoveryPayload {
  capability: typeof ACCOUNT_ERASURE_PROTOCOL;
  mode: 'delete';
  operation: 'recover_owner' | 'observe_recovery';
  recoveryId: string;
  observationKey: string;
  expectedUid?: string;
}
export type AccountErasureTransportPayload = AccountErasurePayload | AccountErasureRecoveryPayload;

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const erasureIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const erasureDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const keys = ['kind', 'commandId', 'requestId', 'state', 'version', 'accountAccessClosed', 'deletionComplete',
  'appleAuthorizationRequired', 'progress', 'reasons', 'updatedAt', 'completedAt', 'retentionPolicyVersion',
  'observationExpiresAt', 'success', 'status', 'newOperationsBlocked'];

/** A response containing identifiers, content or provider details is rejected
 * rather than adopted into the anonymous tracking screen or its journal. */
export function isAccountErasureReceipt(value: unknown, identity?: Pick<AccountErasureAttempt, 'commandId' | 'requestId'>): value is AccountErasureReceipt {
  if (!plain(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
      value.kind !== ACCOUNT_ERASURE_RECEIPT || !erasureDigest(value.commandId) || !erasureIdentifier(value.requestId) ||
      value.requestId.length < 16 || !(ACCOUNT_ERASURE_STATES as readonly unknown[]).includes(value.state) ||
      !Number.isSafeInteger(value.version) || (value.version as number) < 1 ||
      typeof value.accountAccessClosed !== 'boolean' || typeof value.deletionComplete !== 'boolean' ||
      typeof value.appleAuthorizationRequired !== 'boolean' || typeof value.success !== 'boolean' || value.newOperationsBlocked !== true ||
      !date(value.updatedAt) || typeof value.retentionPolicyVersion !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.retentionPolicyVersion)) return false;
  if (identity && (identity.commandId !== value.commandId || identity.requestId !== value.requestId)) return false;
  if (!plain(value.progress) || Object.keys(value.progress).sort().join(',') !== 'completedSteps,totalSteps' ||
      !Number.isSafeInteger(value.progress.completedSteps) || !Number.isSafeInteger(value.progress.totalSteps) ||
      (value.progress.completedSteps as number) < 0 || (value.progress.totalSteps as number) < 1 ||
      (value.progress.completedSteps as number) > (value.progress.totalSteps as number)) return false;
  if (!Array.isArray(value.reasons) || value.reasons.length > 3 || new Set(value.reasons).size !== value.reasons.length ||
      value.reasons.some(reason => !['review_pending', 'action_required', 'authorization_required'].includes(String(reason)))) return false;
  if (value.appleAuthorizationRequired !== (value.state === 'awaiting_apple_authorization')) return false;
  if (value.state === 'completed') {
    if (!value.deletionComplete || !value.success || value.status !== 'complete' || !value.accountAccessClosed ||
        !date(value.completedAt) || !date(value.observationExpiresAt) ||
        Date.parse(value.completedAt) > Date.parse(value.updatedAt) ||
        Date.parse(value.observationExpiresAt) !== Date.parse(value.completedAt) + 30 * 86_400_000) return false;
  } else if (value.deletionComplete || value.success || value.status !== 'incomplete' ||
      value.completedAt !== null || value.observationExpiresAt !== null) return false;
  return true;
}

export function isAccountErasureAttempt(value: unknown, ownerId?: string): value is AccountErasureAttempt {
  if (!plain(value) || Object.keys(value).sort().join(',') !==
      'commandId,ownerId,phase,preparedAt,protocol,receipt,requestId' ||
      value.protocol !== ACCOUNT_ERASURE_PROTOCOL || !erasureIdentifier(value.ownerId) || (ownerId && value.ownerId !== ownerId) ||
      !erasureIdentifier(value.requestId) || value.requestId.length < 16 || !erasureDigest(value.commandId) ||
      !Number.isSafeInteger(value.preparedAt) || (value.preparedAt as number) < 1 ||
      !['prepared', 'submitted'].includes(String(value.phase))) return false;
  return value.receipt === null || value.phase === 'submitted' && isAccountErasureReceipt(value.receipt,
    {commandId: value.commandId, requestId: value.requestId});
}
export function isAccountErasureRecoveryAttempt(value: unknown, ownerId?: string): value is AccountErasureRecoveryAttempt {
  return plain(value) && Object.keys(value).sort().join(',') === 'ownerId,phase,preparedAt,protocol,recoveryId' &&
    value.protocol === ACCOUNT_ERASURE_PROTOCOL && erasureIdentifier(value.ownerId) && (!ownerId || value.ownerId === ownerId) &&
    erasureIdentifier(value.recoveryId) && value.recoveryId.length >= 16 && Number.isSafeInteger(value.preparedAt) &&
    (value.preparedAt as number) > 0 && ['prepared', 'submitted'].includes(String(value.phase));
}
