import {APP_LOCALE} from '@/constants/locale';
import {DEV_COMMERCE_TESTING_ENABLED} from '@/config/featureFlags';
import type {Transaction} from '@/types';
import type {ObservedTrackingCapture, ObservedTrackingEvent, TrackingHistoryLeg} from '@/types/trackingHistory';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sourceValue = (value: unknown) => typeof value === 'string' || typeof value === 'boolean' ||
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Only native label/read references invalidate this leg, never presentation sorting. */
export function trackingSourceFrame(transaction: Transaction, leg: TrackingHistoryLeg): string {
  const raw: unknown = transaction;
  const pointer = object(raw) ? raw[leg === 'forward' ? 'trackingHistoryCapture' : 'returnTrackingHistoryCapture'] : null;
  const read = object(raw) ? raw[leg === 'forward' ? 'trackingRead' : 'returnTrackingRead'] : null;
  return JSON.stringify([transaction.id, transaction.buyerId, transaction.sellerId, transaction.deliveryType, transaction.status, leg,
    leg === 'forward' ? transaction.shipEngineLabelId : transaction.returnLabelId,
    transaction.carrierCode, leg === 'return' ? transaction.returnCarrierCode : null,
    object(raw) ? raw[leg === 'forward' ? 'trackingStatus' : 'returnTrackingStatus'] : null,
    ...(object(pointer) ? [pointer.protocol, pointer.captureId, pointer.sourceHash, pointer.readVersion, pointer.displayHash] : []),
    ...(object(read) ? [read.schemaVersion, read.readId, read.version, read.sourceHash, read.leg] : []),
  ].map(sourceValue));
}

export function isSimulatedTracking(transaction: Transaction, leg: TrackingHistoryLeg): boolean {
  const labelId = leg === 'forward' ? transaction.shipEngineLabelId : transaction.returnLabelId;
  return DEV_COMMERCE_TESTING_ENABLED && transaction.carrierCode === 'seconde_dev' &&
    (leg === 'forward' || transaction.returnCarrierCode === 'seconde_dev') &&
    typeof labelId === 'string' && /^se-devsim-[a-f0-9]{32}$/.test(labelId);
}

const dateLabel = (utc: string) => new Date(utc).toLocaleString(APP_LOCALE, {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto',
});
function statusLabel(code: string | null, simulation: boolean): string {
  switch (code) {
    case 'NY': return 'Étiquette créée';
    case 'AC': return simulation ? 'Prise en charge simulée' : 'Colis pris en charge';
    case 'IT': return simulation ? 'Transit simulé' : 'Colis en route';
    case 'DE': return simulation ? 'Livraison simulée' : 'Colis livré';
    case 'EX': return 'Incident d’acheminement';
    case 'AT': return 'Tentative de livraison';
    case 'SP': return 'Disponible en point de collecte';
    default: return simulation ? 'Mise à jour de la simulation' : 'Mise à jour du transporteur';
  }
}

/** A provider capture is a tracking observation, never confirmation of receipt or funds. */
export function trackingPresentation(transaction: Transaction, leg: TrackingHistoryLeg,
  capture: ObservedTrackingCapture | null, events: readonly ObservedTrackingEvent[]) {
  const simulation = isSimulatedTracking(transaction, leg);
  const code = capture?.providerStatusCode ?? null;
  const delivered = code === 'DE' || events.some(event => event.statusCode === 'DE');
  const knownInRoute = ['AC', 'IT', 'AT', 'SP', 'DE'].includes(code ?? '') ||
    events.some(event => ['AC', 'IT', 'AT', 'SP', 'DE'].includes(event.statusCode ?? ''));
  const hasLabel = !!(leg === 'forward' ? transaction.shipEngineLabelId : transaction.returnLabelId);
  const rawStatus = leg === 'forward' ? transaction.trackingStatus : transaction.returnTrackingStatus;
  const waitingForCapture = !capture && (leg === 'forward' && !['pending_payment', 'paid', 'label_created'].includes(transaction.status) ||
    !!rawStatus && !['UNKNOWN', 'NY', 'UN'].includes(rawStatus));
  const uncertainProgress = waitingForCapture || !!capture && !knownInRoute && !['NY'].includes(code ?? '');
  const state = (index: number): 'complete' | 'current' | 'upcoming' => {
    const current = delivered ? 2 : knownInRoute ? 1 : 0;
    return index < current ? 'complete' : index === current ? 'current' : 'upcoming';
  };
  // Sort a copy only. Source indexes and page cursors retain their native order.
  const sorted = [...events].sort((a, b) => {
    const at = a.occurredAtQualified && a.occurredAtUtc ? Date.parse(a.occurredAtUtc) : null;
    const bt = b.occurredAtQualified && b.occurredAtUtc ? Date.parse(b.occurredAtUtc) : null;
    if (at === null || bt === null) return at === bt ? a.index - b.index : at === null ? 1 : -1;
    return bt - at || a.index - b.index;
  });
  return {
    title: capture ? statusLabel(code, simulation) : waitingForCapture ? 'Suivi en attente de mise à jour' : transaction.status === 'pending_payment' && leg === 'forward'
      ? 'En attente du paiement' : hasLabel ? 'Prêt à être déposé' : leg === 'return' ? 'Préparation du retour' : 'En préparation',
    updatedAtLabel: capture ? `Mis à jour le ${dateLabel(capture.providerReadAt)}` : null,
    estimatedDeliveryLabel: capture?.estimatedDeliveryAtUtc ? `Livraison estimée le ${dateLabel(capture.estimatedDeliveryAtUtc)}` : null,
    attention: code === 'EX' || code === 'AT',
    isSimulation: simulation,
    steps: uncertainProgress ? [] : ['Préparation', 'En route', 'Livré'].map((label, index) => ({key: label, label, state: state(index)})),
    events: sorted.map(event => ({key: `${capture?.captureId ?? 'empty'}:${event.index}`,
      title: statusLabel(event.statusCode, simulation),
      dateLabel: event.occurredAtQualified && event.occurredAtUtc ? dateLabel(event.occurredAtUtc) : null,
      locationLabel: [event.city, event.province].filter(value => value !== null && value.trim() !== '').join(', ') || null,
    })),
    emptyMessage: capture || waitingForCapture ? 'Aucune étape détaillée n’est disponible pour le moment.'
      : hasLabel ? 'Les étapes apparaîtront après les premiers scans du colis.' : 'Le suivi apparaîtra une fois l’envoi préparé.',
  };
}
