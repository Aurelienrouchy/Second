/** Signed Radar events: GET current objects, then durable private review before ACK. */
import {beginFraudSignal, commitFraudSignal, fraudDigest, type FraudEvent, type FraudSignal} from '../../utils/fraudReview';
import {fraudIdentifier, normalizeFraudSignal, fraudObjectIdentity, lookupFraudSignal} from '../../utils/fraudProviderEvidence';
/** Only called after the dispatcher's signature verification. It never changes
 * money, a commercial status, inventory, identity or a provider resource. */
export async function handleFraudSignal(signedEvent: any): Promise<void> {
  if (!fraudIdentifier(signedEvent?.id, 'evt')) throw new Error('Fraud event ID unqualified.');
  const family: FraudSignal['family'] = signedEvent.type.startsWith('radar.early_fraud_warning.') ? 'early_fraud_warning' : 'review';
  const raw = signedEvent.data?.object, signed = normalizeFraudSignal(raw, family);
  const accountPresent = signedEvent.account != null || signedEvent.context != null;
  const event: FraudEvent = {eventId: signedEvent.id, eventType: signedEvent.type, signed,
    eventCreatedAtMs: typeof signedEvent.created === 'number' && Number.isSafeInteger(signedEvent.created * 1000) && signedEvent.created >= 0 && signedEvent.created * 1000 <= Date.now() ? signedEvent.created * 1000 : null, accountPresent,
    accountId: fraudIdentifier(signedEvent.account, 'acct') ? signedEvent.account : null,
    livemode: typeof signedEvent.livemode === 'boolean' ? signedEvent.livemode : null,
    signedIdentityQualified: fraudObjectIdentity(raw, family) && signed.id !== null,
    signedHash: fraudDigest({id: signedEvent.id, type: signedEvent.type, created: signedEvent.created ?? null,
      account: signedEvent.account ?? null, context: signedEvent.context ?? null, livemode: signedEvent.livemode ?? null, object: raw ?? null})};
  if (await beginFraudSignal(event)) return;
  const reconcile = (reason: string, current: FraudSignal | null = null) => commitFraudSignal(event, current, null, reason);
  if (!fraudObjectIdentity(raw, family) || !signed.id) {await reconcile('signed_signal_identity_unqualified'); return;}
  if (accountPresent) {await reconcile('connected_or_unknown_account_context'); return;}
  const {current, payment, reason} = await lookupFraudSignal(event);
  await commitFraudSignal(event, current, payment, reason);
}
