/** A network/5xx error is an unknown outcome, never evidence to re-credit. */
import { getStripe } from '../config/stripe';
import { db, FieldValue } from '../config/firebase';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { prepareOperationalNotices } from './notifications';

type StripeClient = NonNullable<ReturnType<typeof getStripe>>;

/** Owner display comes from a code, never a raw internal API exception. */
export function withdrawalFailureDisplay(code: string | null, status: string): { message: string; action: string } {
  if (status === 'canceled') return { message: 'Le virement a été annulé. Le retour des fonds doit être confirmé.', action: 'refreshWithdrawals' };
  if (code && ['account_closed', 'bank_account_unusable', 'bank_ownership_changed', 'no_account', 'invalid_account_number',
    'invalid_account_number_length', 'incorrect_account_type', 'bank_account_restricted', 'invalid_currency', 'unsupported_card'].includes(code)) {
    return { message: 'Le compte bancaire ne permet pas ce virement. Vérifiez votre destination bancaire avant une nouvelle demande.', action: 'getStripeAccountStatus' };
  }
  if (code && ['account_frozen', 'declined', 'debit_not_authorized'].includes(code)) return {
    message: 'Votre banque a refusé ce virement. Contactez votre banque puis notre équipe pour vérifier la destination.', action: 'contactSupport' };
  if (code && ['incorrect_account_holder_name', 'incorrect_account_holder_address', 'incorrect_account_holder_tax_id'].includes(code)) return {
    message: 'Les renseignements du titulaire doivent être vérifiés avant une nouvelle demande de virement.', action: 'getStripeAccountStatus' };
  return { message: 'Le virement n’a pas pu être effectué. Le retour des fonds doit être vérifié par notre équipe.', action: 'contactSupport' };
}

/** This checks provider identity, not the local debit/transfer. Legacy servicing
 * can use an already-saved payout identity; it never invents the bank selected
 * at the time from today's profile. Callers must also qualify financial witnesses. */
export function matchesWithdrawalPayout(requestId: string, data: FirebaseFirestore.DocumentData, payout: any): boolean {
  const destination = typeof payout?.destination === 'string' ? payout.destination : payout?.destination?.id;
  const frozen = data.payoutDestination;
  const legacy = frozen == null && typeof data.stripePayoutId === 'string' && data.stripePayoutId === payout?.id;
  const destinationMatches = frozen != null
    ? frozen.schemaVersion === 1 && frozen.accountId === data.stripeAccountId && frozen.country === 'CA' &&
      frozen.currency === 'CAD' && typeof frozen.bankAccountId === 'string' && destination === frozen.bankAccountId
    : legacy;
  return payout?.object === 'payout' && typeof payout.id === 'string' && /^po_[A-Za-z0-9_]+$/.test(payout.id) &&
    !!requestId && requestId.length <= 200 && !requestId.includes('/') && data.createdAt instanceof Timestamp &&
    Number.isFinite(data.createdAt.toMillis()) && data.createdAt.toMillis() >= 0 && data.createdAt.toMillis() <= Date.now() &&
    typeof data.userId === 'string' && !!data.userId && !data.userId.includes('/') &&
    Number.isSafeInteger(data.amount) && data.amount > 0 && (data.currency === 'cad' || (legacy && data.currency == null)) &&
    typeof data.stripeAccountId === 'string' && /^acct_[A-Za-z0-9]+$/.test(data.stripeAccountId) &&
    (data.stripePayoutId == null || data.stripePayoutId === payout.id) && destinationMatches && /^ba_[A-Za-z0-9]+$/.test(destination ?? '') &&
    payout.amount === data.amount && payout.currency === 'cad' && payout.method === 'standard' &&
    payout.metadata?.firebaseUserId === data.userId && payout.metadata?.withdrawalRequestId === requestId;
}

/** Mandatory private owner/operator witness. No payout/transfer identity is
 * adopted and no funds move just because an event suggests a candidate. */
export async function markWithdrawalReconciliation(requestId: string, reason: string, evidence: Record<string, unknown> = {}): Promise<void> {
  if (!requestId || requestId.includes('/') || requestId.length > 200) throw new Error('Invalid withdrawal reference');
  const ref = db.collection('withdrawal_requests').doc(requestId);
  await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    const operation = db.collection('failed_operations').doc('withdrawal_' + createHash('sha256').update(requestId).digest('hex'));
    const prior = (await tx.get(operation)).data();
    const exceptional = await (await import('./exceptionalRestitution')).prepareExceptionalPayoutReconciliation(tx, requestId, current, reason, evidence);
    const notices = typeof current?.userId === 'string' && current.userId.length > 0 && current.userId.length <= 128 &&
      !current.userId.includes('/') && current.userId !== '.' && current.userId !== '..' && !/^__.*__$/.test(current.userId)
      ? await prepareOperationalNotices(tx, [{ eventKey: `withdrawal_review:${requestId}:${reason}`, userId: current.userId,
        type: 'withdrawal_update', title: 'Retrait en cours de vérification',
        message: 'Ce retrait doit être vérifié. Consultez son suivi dans le porte-monnaie et contactez le support avant une nouvelle demande.',
        data: { ownerId: current.userId, withdrawalRequestId: requestId, state: 'reconciliation_required', reason } }]) : null;
    if (current) tx.update(ref, { reconciliationRequired: true, reconciliationReason: reason,
      ...(current.payoutRecovery?.schemaVersion === 1 && current.payoutRecovery.state !== 'recovered' ? { 'payoutRecovery.state': 'reconciliation_required' } : {}),
      ownerMessage: 'Ce retrait doit être vérifié. Les fonds ne sont pas disponibles pour une nouvelle demande.',
      ownerAction: 'contactSupport', updatedAt: FieldValue.serverTimestamp() });
    tx.set(operation, { type: 'payout_reversal_failed', refId: requestId, payload: { kind: 'payout_identity_reconciliation', evidence },
      actionRequired: true, status: 'pending', attempts: prior?.attempts ?? 0, lastTriedAt: prior?.lastTriedAt ?? null, error: reason,
      createdAt: prior?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    exceptional.commit();
    notices?.commit();
  });
}

export function isDefinitiveStripeFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { type, statusCode } = error as { type?: string; statusCode?: number };
  return (type === 'StripeInvalidRequestError' || type === 'StripeCardError') &&
    typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 429;
}

/** Read-only recovery. Missing or ambiguous results remain unknown. Never create
 * another payout to discover whether one exists (Stripe idempotency expires).
 * The scan is bounded to 1000 recent payouts on the exact connected account.
 */
export async function resolveWithdrawalPayout(
  requestId: string,
  data: FirebaseFirestore.DocumentData,
  stripe: StripeClient
) {
  if (!requestId || requestId.includes('/') || requestId.length > 200 ||
      typeof data.stripeAccountId !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(data.stripeAccountId)) return null;
  const options = { stripeAccount: data.stripeAccountId };
  const exactDestination = (payout: any) => matchesWithdrawalPayout(requestId, data, payout);
  if (typeof data.stripePayoutId === 'string' && data.stripePayoutId) {
    if (!/^po_[A-Za-z0-9_]+$/.test(data.stripePayoutId)) return null;
    const payout = await stripe.payouts.retrieve(data.stripePayoutId, undefined, options);
    return exactDestination(payout) ? payout : null;
  }
  // Unidentified historical payouts are operator cases. Only a modern frozen
  // destination authorizes searching for a unique lost submission receipt.
  if (data.payoutDestination?.schemaVersion !== 1 || !(data.createdAt instanceof Timestamp)) return null;
  const createdAtMs = data.createdAt.toMillis();
  if (!Number.isFinite(createdAtMs) || createdAtMs < 0 || createdAtMs > Date.now()) return null;
  let cursor: string | undefined;
  let match: Awaited<ReturnType<StripeClient['payouts']['list']>>['data'][number] | null = null;
  for (let page = 0; page < 10; page++) {
    const result = await stripe.payouts.list({
      limit: 100,
      created: { gte: Math.floor(createdAtMs / 1000) - 60 },
      ...(cursor ? { starting_after: cursor } : {}),
    }, options);
    for (const payout of result.data) {
      if (payout.metadata?.withdrawalRequestId !== requestId) continue;
      if (!exactDestination(payout)) return null;
      if (payout.amount !== data.amount || payout.currency !== (data.currency ?? 'cad') ||
          payout.metadata?.firebaseUserId !== data.userId || match) return null;
      match = payout;
    }
    if (!result.has_more) return match;
    cursor = result.data[result.data.length - 1]?.id;
    if (!cursor) return null;
  }
  return null;
}
