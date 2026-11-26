import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {functions} from '@/config/firebaseConfig';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {productReviewDocumentId} from '@/services/productReviewService';
import {CONNECT_IDENTITY_RECOVERY_CAPABILITY, type ConnectIdentityRecoveryContext, type ConnectIdentityRecoveryResponse} from '@/types/connectIdentityRecovery';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uid = (v: unknown): v is string => typeof v === 'string' && v.length <= 128 && productReviewDocumentId(v) && !/[\u0000-\u001f\u007f]/.test(v);
const failure = () => new Error('La référence Connect doit être relue depuis la session et le dossier actuels. Aucune configuration n’est recréée.');
export function connectRecoveryReference(value: unknown): string | null {return hash(value) ? value : null;}
export function parseConnectIdentityRecovery(value: unknown, actorId: string, context: ConnectIdentityRecoveryContext): ConnectIdentityRecoveryResponse {
  if (!object(value) || !exact(value, ['protocol', 'actorId', 'scope', 'ownerId', 'action', 'state', 'recoveryReference', 'claim', 'newEffectAuthorized', 'sourceQualification', 'financialSettlement', 'absenceProvesNoProviderEffect', 'readAt']) ||
    value.protocol !== CONNECT_IDENTITY_RECOVERY_CAPABILITY || value.actorId !== actorId || value.scope !== context.scope || value.ownerId !== context.ownerId || value.action !== context.action ||
    !['claim_recorded_outcome_unqualified', 'no_external_claim_observed'].includes(String(value.state)) || !(value.recoveryReference === null || hash(value.recoveryReference)) || context.recoveryReference !== null && value.recoveryReference !== context.recoveryReference ||
    value.newEffectAuthorized !== false || value.sourceQualification !== 'independent_qualification_required' || value.financialSettlement !== 'not_asserted' || value.absenceProvesNoProviderEffect !== false ||
    typeof value.readAt !== 'string' || !Number.isFinite(Date.parse(value.readAt)) || new Date(value.readAt).toISOString() !== value.readAt) throw failure();
  const claim = value.claim;
  if (value.state === 'no_external_claim_observed' ? claim !== null || value.recoveryReference !== null : !hash(value.recoveryReference) || !object(claim) ||
    !exact(claim, ['commandId', 'epoch', 'action', 'accountId', 'parentHash', 'requestHash']) || typeof claim.commandId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claim.commandId) || typeof claim.epoch !== 'string' || !/^[A-Za-z0-9_.:-]{1,180}$/.test(claim.epoch) ||
    claim.action !== context.action || !(claim.accountId === null || typeof claim.accountId === 'string' && /^acct_[A-Za-z0-9_]{1,190}$/.test(claim.accountId)) || !hash(claim.parentHash) || !hash(claim.requestHash)) throw failure();
  return value as unknown as ConnectIdentityRecoveryResponse; // All closed fields and exact owner/source references are qualified above.
}
export const ConnectIdentityRecoveryService = {
  async read(actorId: string, context: ConnectIdentityRecoveryContext, guard: () => void) {
    if (!uid(actorId) || !uid(context.ownerId) || !['own', 'admin'].includes(context.scope) || !['create', 'delete'].includes(context.action) || context.recoveryReference !== null && !hash(context.recoveryReference) || context.scope === 'own' && context.ownerId !== actorId) throw failure();
    const session = captureTradeSession(actorId), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    const {data} = await httpsCallable<Record<string, unknown>, unknown>(functions, 'readSupportRequests')({capability: CONNECT_IDENTITY_RECOVERY_CAPABILITY, expectedUid: actorId, mode: 'read', ...context}); current();
    const parsed = parseConnectIdentityRecovery(data, actorId, context); current(); return parsed;
  },
};
