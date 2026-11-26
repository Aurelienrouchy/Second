import {confidentialObject as object, confidentialExact as exact, confidentialHash as hash, confidentialId as id, confidentialDate as date} from '@/utils/supportConfidentialityContract';
import {isDeclaredSupportAccountId} from '@/utils/supportAccountIdentity';
import type {SupportPostClosureBasis} from '@/types/supportRequest';
/** Native timestamp projected to a strict UTC ISO by the callable; this documentary bridge
 * never authorizes account recreation, access or a client financial mutation. */
export function isSupportPostClosureBasis(v: unknown, ownerId: string): v is SupportPostClosureBasis {
  if (!object(v) || v.protocol !== 'exceptional_post_closure_servicing_v1' || v.qualified !== true || v.authState !== 'native_user_absent' || v.ownerId !== ownerId || !isDeclaredSupportAccountId(v.ownerId) || !hash(v.creditHash) || !object(v.lateEvent) || !date(v.lateEvent.recordedAt)) return false;
  const e = v.lateEvent;
  if (e.source === 'stripe_bank_dispute') return exact(v, ['protocol', 'qualified', 'authState', 'ownerId', 'lateEvent', 'orderHash', 'creditHash']) && hash(v.orderHash) && exact(e, ['source', 'transactionId', 'disputeId', 'kind', 'recordedAt']) && id(e.transactionId) && id(e.disputeId) && typeof e.kind === 'string' && e.kind.length > 0 && e.kind.length <= 300;
  return e.source === 'seconde_compensation' && exact(v, ['protocol', 'qualified', 'authState', 'ownerId', 'lateEvent', 'creditHash']) && exact(e, ['source', 'caseId', 'recordedAt']) && /^exception_[a-f0-9]{64}$/.test(String(e.caseId));
}
