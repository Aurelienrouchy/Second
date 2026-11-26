/** Explicit servicing of already owed available cents during a paused closure.
 * This context is a read-only identity, never permission to debit or erase. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';

export const SMALL_BALANCE_CLOSURE_PROTOCOL = 'small_balance_closure_v1';
export const STANDARD_WITHDRAWAL_MINIMUM_CENTS = 1000;
type Data = FirebaseFirestore.DocumentData;
export type SmallBalanceClosureRequest = {protocol:typeof SMALL_BALANCE_CLOSURE_PROTOCOL;sourceHash:string};
const own=(value:Data,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
/** Missing legacy buckets retain their established zero default. Explicit null,
 * malformed or nonzero buckets are NOT zero. L04 must still qualify the entire
 * original wallet, including these absences, before its balance is debited. */
export function smallBalanceClosureAmount(wallet:Data|undefined):number|null {
  if (!wallet || wallet.status!=='active' || typeof wallet.currency!=='string' || wallet.currency.toUpperCase()!=='CAD' ||
      !Number.isSafeInteger(wallet.balance) || wallet.balance<1 || wallet.balance>=STANDARD_WITHDRAWAL_MINIMUM_CENTS ||
      ['pendingBalance','heldBalance','sellerDebt'].some(key=>own(wallet,key) && (!Number.isSafeInteger(wallet[key]) || wallet[key]!==0))) return null;
  return wallet.balance;
}
export function smallBalanceClosureSource(ownerId:string,closure:Data|undefined) {
  const at=closure?.requestedAt;
  if (!closure || closure.schemaVersion!==1 || closure.ownerId!==ownerId || closure.phase!=='paused' ||
      closure.requiresOperator===true || closure.providerDeletionStartedAt!=null || closure.providerAccountDeleted===true ||
      closure.authDeletedAt!=null || typeof closure.leaseUntilMs!=='number' || !Number.isSafeInteger(closure.leaseUntilMs) ||
      closure.leaseUntilMs<0 || closure.leaseUntilMs>Date.now() || !(at instanceof Timestamp) || at.toMillis()<1 || at.toMillis()>Date.now()) return null;
  return {protocol:SMALL_BALANCE_CLOSURE_PROTOCOL,sourceHash:createHash('sha256')
    .update(JSON.stringify([SMALL_BALANCE_CLOSURE_PROTOCOL,ownerId,closure.schemaVersion,at.seconds,at.nanoseconds])).digest('hex'),
    requestedAt:at.toDate().toISOString()};
}
export function parseSmallBalanceClosureRequest(value:unknown):SmallBalanceClosureRequest|null {
  if (value===undefined) return null;
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==2 ||
      Object.keys(value).some(key=>!['protocol','sourceHash'].includes(key)) ||
      (value as any).protocol!==SMALL_BALANCE_CLOSURE_PROTOCOL || typeof (value as any).sourceHash!=='string' || !/^[a-f0-9]{64}$/.test((value as any).sourceHash)) {
    throw new HttpsError('invalid-argument','Le contexte natif de restitution du petit solde est requis.');
  }
  return value as SmallBalanceClosureRequest;
}
export function assertSmallBalanceClosure(ownerId:string,closure:Data|undefined,expected:SmallBalanceClosureRequest) {
  const current=smallBalanceClosureSource(ownerId,closure);
  if (!current || current.sourceHash!==expected.sourceHash) throw new HttpsError('failed-precondition',
    'La fermeture mise en pause doit être relue avant de restituer ce petit solde.',
    {reason:'small_balance_closure_changed',action:'refreshClosure'});
  return current;
}
export function assertSmallBalanceClosureAmount(wallet:Data|undefined,amount:number) {
  if (smallBalanceClosureAmount(wallet)!==amount) throw new HttpsError('failed-precondition',
    'La restitution doit porter sur tout le petit solde disponible, sans montant en attente, retenu ou dû.',
    {reason:'small_balance_closure_wallet_changed',action:'refreshWallet'});
}
/** Caller supplies the current private session guard. A native post-commit
 * read is essential: a serverTimestamp placeholder is never a closure source. */
export async function readSmallBalanceClosureContext(tx:FirebaseFirestore.Transaction,ownerId:string) {
  const profile=(await tx.get(db.collection('eligibility_profiles').doc(ownerId))).data();
  const wallet=(await tx.get(db.collection('wallets').doc(ownerId))).data();
  const source=smallBalanceClosureSource(ownerId,profile?.accountClosure),amountCents=smallBalanceClosureAmount(wallet);
  return source && amountCents!==null ? {...source,amountCents,currency:'CAD' as const,
    withdrawalPermissionGranted:false as const,accountDeletionPermissionGranted:false as const} : null;
}
