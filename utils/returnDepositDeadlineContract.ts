import {RETURN_DEPOSIT_TERMS, RETURN_DEPOSIT_TERMS_HASH, type ReturnDepositDeadlineAttempt, type ReturnDepositDeadlineCommand, type ReturnDepositTerms} from '@/types/returnDepositDeadline';
import {APP_LOCALE} from '@/constants/locale';

export const returnDepositObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const returnDepositExact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const returnDepositId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export const returnDepositHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const returnDepositDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const returnDepositText = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v === v.trim() && v.length <= 2000;
export const RETURN_DEPOSIT_EFFECT_KEYS = ['financialEffectAuthorized', 'refundDecisionGranted', 'faultEstablished', 'shippingPermissionGranted', 'contentsReceivedConfirmed'] as const;
export const returnDepositNoEffects = (v: Record<string, unknown>) => RETURN_DEPOSIT_EFFECT_KEYS.every(k => v[k] === false);
export function isReturnDepositTerms(v: unknown): v is ReturnDepositTerms {
  return returnDepositObject(v) && returnDepositExact(v, Object.keys(RETURN_DEPOSIT_TERMS)) && Object.entries(RETURN_DEPOSIT_TERMS).every(([key, value]) => v[key] === value);
}
/** These primitive accepted terms use the existing returnHash canonical form. */
export function returnDepositTermsPair(v: Record<string, unknown>): boolean {
  const present = Object.hasOwn(v, 'depositTerms') || Object.hasOwn(v, 'depositTermsHash');
  return !present || isReturnDepositTerms(v.depositTerms) && v.depositTermsHash === RETURN_DEPOSIT_TERMS_HASH;
}
export function isReturnDepositCommand(v: unknown): v is ReturnDepositDeadlineCommand {
  if (!returnDepositObject(v) || !returnDepositExact(v, ['action', 'sourceHash', 'expectedVersion', 'expectedLabelId', 'newDueAtMs', 'motivation', 'partyMessage', 'acknowledged']) ||
      !returnDepositHash(v.sourceHash) || !returnDepositId(v.expectedLabelId) || v.acknowledged !== true || !Number.isSafeInteger(v.expectedVersion)) return false;
  if (v.action === 'make_available') return v.expectedVersion === 0 && v.newDueAtMs === null && v.motivation === null && v.partyMessage === null;
  return v.action === 'extend' && Number(v.expectedVersion) >= 1 && Number(v.expectedVersion) < 20 && Number.isSafeInteger(v.newDueAtMs) &&
    Number(v.newDueAtMs) >= 0 && Number(v.newDueAtMs) <= Date.UTC(2100, 0, 1) && returnDepositText(v.motivation) && returnDepositText(v.partyMessage);
}
export function isReturnDepositAttempt(v: unknown, uid: string, transactionId: string): v is ReturnDepositDeadlineAttempt {
  return returnDepositObject(v) && returnDepositExact(v, ['version', 'uid', 'transactionId', 'scope', 'requestId', 'capability', 'payloadHash', 'command']) &&
    v.version === 1 && v.uid === uid && returnDepositId(uid) && v.transactionId === transactionId && returnDepositId(transactionId) &&
    ['owner', 'operator'].includes(String(v.scope)) && v.capability === 'return_deposit_deadline_v1' && returnDepositId(v.requestId) && v.requestId.length >= 16 &&
    returnDepositHash(v.payloadHash) && isReturnDepositCommand(v.command);
}
export function createReturnDepositInteraction() {
  let version = 0;
  return {invalidate: () => {version++;}, capture: () => {const expected = version; return () => {if (version !== expected) throw new Error('Relisez le délai, sa source et l’instruction actuelle.');};}};
}
/** Explicit UTC input only; Toronto is a display, never an ambiguous parser. */
export function returnDepositProposedDate(value: string): number | null {
  return returnDepositDate(value) && Date.parse(value) >= 0 && Date.parse(value) <= Date.UTC(2100, 0, 1) ? Date.parse(value) : null;
}
export function formatReturnDepositDate(value: string | null): string {
  return value === null || !returnDepositDate(value) ? 'Date non qualifiée ; revue humaine nécessaire' :
    `${new Date(value).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'})} · UTC ${value}`;
}
