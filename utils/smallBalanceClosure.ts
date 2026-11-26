import type {SmallBalanceClosureRequest, SmallBalanceSettlement} from '@/types/wallet';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function isSmallBalanceClosureRequest(v: unknown): v is SmallBalanceClosureRequest {return object(v) && Object.keys(v).length === 2 && v.protocol === 'small_balance_closure_v1' && hash(v.sourceHash);}
export function isSmallBalanceSettlement(v: unknown): v is SmallBalanceSettlement {
  return object(v) && Object.keys(v).length === 7 && ['protocol', 'sourceHash', 'requestedAt', 'amountCents', 'currency', 'withdrawalPermissionGranted', 'accountDeletionPermissionGranted'].every(k => Object.hasOwn(v, k)) &&
    v.protocol === 'small_balance_closure_v1' && hash(v.sourceHash) && typeof v.requestedAt === 'string' && Number.isFinite(Date.parse(v.requestedAt)) && new Date(v.requestedAt).toISOString() === v.requestedAt && Date.parse(v.requestedAt) > 0 && Date.parse(v.requestedAt) <= Date.now() &&
    typeof v.amountCents === 'number' && Number.isSafeInteger(v.amountCents) && v.amountCents >= 1 && v.amountCents <= 999 && v.currency === 'CAD' && v.withdrawalPermissionGranted === false && v.accountDeletionPermissionGranted === false;
}
