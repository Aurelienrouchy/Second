import type {Message, Transaction} from '@/types';
import {conversationTimeline} from '@/utils/conversationTimeline';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 12, minute));
const offer = (native: Record<string, unknown> = {}): Message => ({id: 'offer', chatId: 'chat', senderId: 'buyer', receiverId: 'seller',
  type: 'offer', content: 'Offre', timestamp: at(0), status: 'sent', isRead: true,
  offer: {amount: 32, status: 'accepted', deliveryType: 'shipping', acceptedAt: at(1), ...native},
} as Message);

it('keeps acceptance and later expiry as separate dated messages, with stable IDs and no stale action', () => {
  const native = offer({status: 'expired', expiredAt: at(3)});
  const legacy = {...native, id: 'system', type: 'system', content: 'Paiement confirmé', timestamp: at(2)} as Message;
  const rows = conversationTimeline([native, native, legacy], [], 'chat', 'seller');
  expect(rows.map(row => row.key)).toEqual(['message:offer', 'progress:offer:offer:accepted', 'message:system', 'progress:offer:offer:expired']);
  expect(rows.filter(row => row.kind === 'offer-actions')).toHaveLength(0);
  expect(rows.filter(row => row.kind === 'notice').map(row => row.at)).toEqual([at(1), at(3)]);
  expect(conversationTimeline([legacy, native], [], 'chat', 'seller').map(row => row.key)).toEqual(rows.map(row => row.key));
});

it('records proven order milestones once and gives the current action its own exact order reference', () => {
  const order = {id: 'order', chatId: 'chat', offerMessageId: 'offer', articleId: 'article', buyerId: 'buyer', sellerId: 'seller',
    deliveryType: 'shipping', status: 'delivered', createdAt: at(2), totalAmount: 37, currency: 'CAD',
    paidAt: at(3), stripeChargeId: 'ch_test', stripePaymentIntentId: 'pi_test', capturedCardCents: 3700,
    shipEngineRateId: 'rate', shipEngineLabelId: 'label', labelCreatedAt: at(4), shippedAt: at(5), deliveredAt: at(6),
    labelPurchase: {schemaVersion: 1, state: 'committed', transactionId: 'order', buyerId: 'buyer', sellerId: 'seller', attemptId: 'attempt',
      sourceHash: 'a'.repeat(64), providerLabelId: 'label', committedAt: at(4), shipmentId: 'shipment', rateId: 'rate',
      qualification: {schemaVersion: 1, currency: 'CAD', requestedRateId: 'rate', rateIdentitySource: 'request_path'}},
    shippingSnapshot: {schemaVersion: 1, provider: 'shipengine', currency: 'CAD', priceAcceptedBy: 'buyer', validatedAt: at(2),
      acceptanceValidatedAt: at(2), shipmentId: 'shipment', rate: {rateId: 'rate', shipmentId: 'shipment'}},
    devShippingSimulation: {realShipment: false},
  } as unknown as Transaction;
  const rows = conversationTimeline([offer({transactionId: 'order'})], [order, order], 'chat', 'seller');
  expect(rows.filter(row => row.kind === 'offer-actions')).toHaveLength(0);
  expect(rows.filter(row => row.kind === 'notice').map(row => row.title)).toEqual([
    'Offre acceptée', 'Paiement confirmé', 'Étiquette de test prête', 'Envoi simulé', 'Livraison simulée',
  ]);
  expect(rows.filter(row => row.kind === 'order-current')).toEqual([{kind: 'order-current', key: 'progress:order:order', at: null, order}]);
  // A subsequent refund keeps the historical capture, without creating an old payment button.
  expect(conversationTimeline([], [{...order, status: 'refunded', refundBlocked: true}], 'chat', 'seller').some(row => row.key === 'progress:order:order:paid')).toBe(true);
  const systemLabel = {...offer(), id: 'server-label', senderId: 'system', type: 'system', timestamp: at(4),
    content: 'Commande interne : order. Consultez les conditions détaillées.',
    shippingLabel: {trackingNumber: 'TRACK123', labelUrl: 'https://labels.test/parcel.pdf'},
  } as Message;
  const deduplicated = conversationTimeline([systemLabel], [{...order, trackingNumber: 'TRACK123', shippingLabelUrl: 'https://labels.test/parcel.pdf'}], 'chat', 'seller');
  expect(deduplicated.some(row => row.key === 'message:server-label')).toBe(false);
  expect(deduplicated.filter(row => row.kind === 'notice' && row.title === 'Étiquette de test prête')).toHaveLength(1);
});

it('projects explicit server transport metadata without exposing raw references or rewriting member messages', () => {
  const source = {...offer(), id: 'server-label', senderId: 'system', type: 'system',
    content: 'Commande INTERNAL_ID. Instructions juridiques.',
    shippingLabel: {trackingNumber: 'TRACK123', labelUrl: 'https://labels.test/parcel.pdf'},
  } as Message;
  const rows = conversationTimeline([source], [], 'chat', 'seller');
  expect(rows).toEqual([{kind: 'notice', key: 'message:server-label', at: at(0), title: 'Mise à jour de la livraison'}]);
  expect(source.content).toContain('INTERNAL_ID');
  const member = {...source, id: 'member', senderId: 'buyer', type: 'text'} as Message;
  expect(conversationTimeline([member], [], 'chat', 'seller')).toEqual([{kind: 'message', key: 'message:member', at: at(0), message: member}]);
});

it('does not invent legacy event dates, payment or label proof, and distinguishes replacement from expiry', () => {
  const message = offer({acceptedAt: undefined, respondedAt: undefined});
  const rows = conversationTimeline([message], [], 'chat', 'seller');
  expect(rows.find(row => row.key === 'progress:offer:offer:accepted')?.at).toBeNull();
  const replacement = conversationTimeline([offer({status: 'expired', expiredReason: 'replaced', respondedAt: at(2), replacedByMessageId: 'next'})], [], 'chat', 'seller');
  expect(replacement.some(row => row.kind === 'notice' && row.title === 'Offre remplacée' && row.at?.getTime() === at(2).getTime())).toBe(true);
  expect(replacement.some(row => row.key.endsWith(':expired'))).toBe(false);
  const unknown = {id: 'order', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', deliveryType: 'shipping', status: 'paid',
    createdAt: at(2), paidAt: at(3), totalAmount: 37, labelCreatedAt: at(4)} as Transaction;
  expect(conversationTimeline([], [unknown], 'chat', 'seller').filter(row => row.kind === 'notice')).toEqual([]);
});
