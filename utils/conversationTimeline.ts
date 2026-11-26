import type {Message, MessageOfferWithMeetup, Transaction} from '@/types';
import {toDate} from '@/utils/firestoreDate';

export type ConversationTimelineEntry =
  | {kind: 'message'; key: string; at: Date | null; message: Message}
  | {kind: 'notice'; key: string; at: Date | null; title: string; offerMessageId?: string; orderId?: string}
  | {kind: 'offer-actions'; key: string; at: null; message: Message}
  | {kind: 'order-current'; key: string; at: null; order: Transaction};
type Ranked = {entry: ConversationTimelineEntry; time: number; rank: number};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Historical evidence only. A later refund does not erase an earlier capture,
 * and this predicate grants no new payment, shipping or withdrawal action. */
export function hasRecordedOrderPayment(order: Transaction): boolean {
  const total = Math.round(order.totalAmount * 100), wallet = order.walletAmountUsed ?? 0;
  if (!Number.isSafeInteger(total) || total <= 0 || !cents(wallet) || !toDate(order.paidAt) || order.currency != null && order.currency !== 'CAD') return false;
  if (order.paidVia === 'wallet') {
    const p = order.walletPayment;
    return wallet === total && p?.schemaVersion === 1 && p.state === 'committed' && p.actorUid === order.buyerId &&
      p.amountCents === total && p.currency === 'CAD' && text(p.ledgerId) && !!toDate(p.committedAt) &&
      text(p.quoteId) && p.quoteId === order.shippingQuoteId && text(p.rateId) && p.rateId === order.shipEngineRateId;
  }
  return typeof order.stripeChargeId === 'string' && /^ch_[A-Za-z0-9]+$/.test(order.stripeChargeId) &&
    typeof order.stripePaymentIntentId === 'string' && /^pi_[A-Za-z0-9]+$/.test(order.stripePaymentIntentId) &&
    cents(order.capturedCardCents) && order.capturedCardCents > 0 && order.capturedCardCents + wallet === total &&
    (wallet === 0 || order.paidVia === 'mixed' || order.paidVia === 'wallet_and_card');
}
export function hasRecordedOrderLabel(order: Transaction): boolean {
  const raw = order as unknown as Record<string, unknown>, p = raw.labelPurchase, s = raw.shippingSnapshot;
  if (!record(p) || !record(s) || !record(s.rate) || !record(p.qualification)) return false;
  return p.schemaVersion === 1 && p.state === 'committed' && p.transactionId === order.id &&
    p.buyerId === order.buyerId && p.sellerId === order.sellerId && text(p.attemptId) &&
    typeof p.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(p.sourceHash) &&
    text(order.shipEngineLabelId) && p.providerLabelId === order.shipEngineLabelId && !!toDate(p.committedAt) &&
    !!toDate(order.labelCreatedAt) && s.schemaVersion === 1 && s.provider === 'shipengine' && s.currency === 'CAD' &&
    s.priceAcceptedBy === order.buyerId && !!toDate(s.validatedAt) && !!toDate(s.acceptanceValidatedAt) &&
    text(s.shipmentId) && s.rate.shipmentId === s.shipmentId && p.shipmentId === s.shipmentId &&
    text(order.shipEngineRateId) && p.rateId === order.shipEngineRateId && s.rate.rateId === order.shipEngineRateId &&
    p.qualification.schemaVersion === 1 && p.qualification.currency === 'CAD' &&
    p.qualification.requestedRateId === order.shipEngineRateId &&
    ['request_path', 'filtered_lookup'].includes(String(p.qualification.rateIdentitySource));
}

/** A projection of native documents, never synthetic member messages or a
 * ledger. Unknown dates are undated beside their source, never stamped now. */
export function conversationTimeline(messages: readonly Message[], orders: readonly Transaction[], chatId: string, uid: string): ConversationTimelineEntry[] {
  const rows = new Map<string, Ranked>();
  const add = (entry: ConversationTimelineEntry, time: number, rank: number) => rows.set(entry.key, {entry, time, rank});
  const sourceMessages = new Map(messages.filter(m => m.chatId === chatId).map(m => [m.id, m]));
  const sourceOrders = new Map(orders.filter(o => o.chatId === chatId && [o.buyerId, o.sellerId].includes(uid)).map(o => [o.id, o]));
  for (const message of sourceMessages.values()) {
    const at = toDate(message.timestamp), anchor = at?.getTime() ?? 0;
    const metadata = message as unknown as Record<string, unknown>;
    // Server-generated transport bodies used to repeat full instructions and
    // opaque references. Project only their explicit event metadata; member
    // messages and the persisted source content remain entirely unchanged.
    if (message.type === 'system' && message.senderId === 'system' && record(metadata.shippingLabel)) {
      const label = metadata.shippingLabel;
      const nativeMilestone = text(label.trackingNumber) && text(label.labelUrl) && [...sourceOrders.values()].some(order =>
        order.trackingNumber === label.trackingNumber && order.shippingLabelUrl === label.labelUrl && hasRecordedOrderLabel(order));
      if (!nativeMilestone) add({kind: 'notice', key: `message:${message.id}`, at, title: 'Mise à jour de la livraison'}, anchor, 0);
      continue;
    }
    add({kind: 'message', key: `message:${message.id}`, at, message}, anchor, 0);
    if (message.type !== 'offer' || !message.offer || message.status === 'sending') continue;
    const offer = message.offer as MessageOfferWithMeetup;
    const native = offer as unknown as Record<string, unknown>;
    const acceptedAt = toDate(native.acceptedAt), respondedAt = toDate(native.respondedAt);
    let currentTime = anchor;
    const notice = (phase: string, title: string, date: Date | null, rank: number) => {
      currentTime = Math.max(currentTime, date?.getTime() ?? anchor);
      add({kind: 'notice', key: `progress:offer:${message.id}:${phase}`, at: date, title, offerMessageId: message.id}, date?.getTime() ?? anchor, rank);
    };
    if (acceptedAt || offer.status === 'accepted') notice('accepted', 'Offre acceptée', acceptedAt ?? respondedAt, 1);
    if (offer.status === 'rejected') notice('rejected', 'Offre refusée', respondedAt, 2);
    if (offer.status === 'expired') {
      const replaced = offer.expiredReason === 'replaced' || text(native.replacedByMessageId);
      notice(replaced ? 'replaced' : 'expired', replaced ? 'Offre remplacée' : 'Offre expirée',
        replaced ? respondedAt : toDate(native.expiredAt) ?? toDate(offer.expiresAt), 2);
    } else if (['counter_price', 'counter_location', 'counter_time'].includes(offer.status)) {
      notice('replaced', 'Une contre-proposition a été envoyée', respondedAt, 2);
    }
    if (offer.meetup?.completedAt) notice('completed', 'Remise déclarée terminée', toDate(offer.meetup.completedAt), 3);
    const linked = offer.transactionId ? sourceOrders.get(offer.transactionId) : null;
    const exactOrder = linked?.offerMessageId === message.id && linked.chatId === message.chatId &&
      (!offer.buyerId || linked.buyerId === offer.buyerId) && (!offer.sellerId || linked.sellerId === offer.sellerId);
    if (offer.meetup && ['accepted', 'completed'].includes(offer.status) || !offer.meetup && offer.status === 'accepted' && !exactOrder) {
      add({kind: 'offer-actions', key: `progress:offer:${message.id}:current`, at: null, message}, currentTime, 4);
    }
  }
  for (const order of sourceOrders.values()) {
    if (order.deliveryType !== 'shipping') continue;
    const source = order.offerMessageId ? sourceMessages.get(order.offerMessageId) : null;
    const createdAt = order.createdAtKnown !== false ? toDate(order.createdAt) : null;
    let currentTime = createdAt?.getTime() ?? toDate(source?.timestamp)?.getTime() ?? 0;
    const native = order as unknown as Record<string, unknown>;
    const simulated = record(native.devShippingSimulation) && native.devShippingSimulation.realShipment === false;
    const milestone = (phase: string, title: string, date: Date | null, rank: number) => {
      if (!date) return;
      currentTime = Math.max(currentTime, date.getTime());
      add({kind: 'notice', key: `progress:order:${order.id}:${phase}`, at: date, title, orderId: order.id}, date.getTime(), rank);
    };
    if (hasRecordedOrderPayment(order)) milestone('paid', 'Paiement confirmé', toDate(order.paidAt), 5);
    if (hasRecordedOrderLabel(order)) milestone('label', simulated ? 'Étiquette de test prête' : 'Étiquette prête', toDate(order.labelCreatedAt), 6);
    milestone('shipped', simulated ? 'Envoi simulé' : 'Expédition enregistrée', toDate(order.shippedAt), 7);
    milestone('delivered', simulated ? 'Livraison simulée' : 'Livraison signalée', toDate(order.deliveredAt), 8);
    add({kind: 'order-current', key: `progress:order:${order.id}`, at: null, order}, currentTime, 9);
  }
  return [...rows.values()].sort((a, b) => a.time - b.time || a.rank - b.rank || a.entry.key.localeCompare(b.entry.key)).map(row => row.entry);
}
