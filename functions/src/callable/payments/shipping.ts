import { FinancialRecoveryBlocked } from "../../utils/financialRecoveryInterlock";
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
import {assertPrivateAccountSession, withPrivateAccountSession} from '../../utils/privateAccountSession';
import {TRANSPORT_CONTACT_CAPABILITY,readTransportContactSource,readTransportContactHistory,previewTransportContact,commandTransportContact} from '../../utils/transportContactReview';
import {TRANSPORT_CARRIER_CAPABILITY,readTransportCarrierSource,readTransportCarrierHistory,previewTransportCarrier,commandTransportCarrier} from '../../utils/transportCarrierReview';
/**
 * Paiement — Tarifs ShipEngine, points relais et suivi de colis.
 *
 * Éclaté depuis functions/src/callable/payments.ts (3881 lignes).
 * `callable/payments.ts` reste la façade : index.ts et sweepPendingLabels
 * importent depuis là, inchangés.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../../config/firebase';
import { getShipEngine, ShipEngineClient, trackingIdentity, providerUtc, savedLifecycleLabelIdentity, unqualifiedServicePointLookup,
  type ServicePointLookupInput, type CurrentLabelDocumentIdentity, type CurrentLabelDocument, type TrackingLeg } from '../../config/shipEngine';
import { checkRateLimit, resolveCallerKey } from '../../utils/rateLimit';
import { applyTrackingOutcome, readQualifiedTracking } from '../../utils/trackingTransition';
import { CA_PROVINCE_CODES, canadianCountry, normalizeCanadianPostal, postalMatchesProvince } from '../../shared/canadianAddress';
import { RATE_LIMIT_WINDOW_MS } from './feeReduction';
import { purchasePolicyTimeline, PURCHASE_PREPARATION_CAPABILITY, purchasePreparationObservation,acceptedOrderPurchasePolicy,acceptedQuotePurchasePolicy } from '../../utils/purchasePolicy';
import {qualifiedOrderTransportQuote,shippingTransportSummary} from '../../config/shippingTransportPolicy';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { exactCents, providerId } from '../../utils/shippingPurchaseRate';
import { committedReturnReceipt } from '../../utils/returnRequest';
import { supportSourceHash } from '../../utils/supportRequest';
import { readTrackingHistory } from '../../utils/trackingHistory';
import { readLateTransportIncidents } from '../../utils/lateTransportIncident';
import { commandReturnToSender, readReturnToSenderSource, readReturnToSenderCases } from '../../utils/returnToSenderCase';
import { readFraudReview } from '../../utils/fraudReviewReader';
import { previewFraudReviewDecision, commandFraudReviewDecision } from '../../utils/fraudReviewDecision';
import { readTransportReviewSource, readTransportReviews, previewTransportReview, commandTransportReview, readEffectivePurchasePolicy } from '../../utils/transportReview';
import { LABEL_LIFECYCLE_DISPATCH_ENABLED, readLabelLifecycleSource, previewLabelLifecycle, commandLabelLifecycle,
  readLabelLifecycleHistory, readLabelLifecycleAdminQueue, labelLifecycleIdentityQualified } from '../../utils/labelLifecycle';
import {RETURN_DEPOSIT_DEADLINE_CAPABILITY, handleReturnDepositDeadline, returnDocumentFurnished} from '../../utils/returnDepositDeadline';

export const getShippingEstimate = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/shipping.getShippingEstimate"}, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, { functionName: 'getShippingEstimate', maxCallsAuthenticated: 30,
    maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
  const { fromAddress, toAddress, weight, dimensions } = request.data ?? {};
  const requiredFields: string[] = [];
  const zone = (raw: any, path: string) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !canadianCountry(raw.country)) throw new HttpsError('invalid-argument', 'Une zone canadienne est requise.');
    const postalCode = normalizeCanadianPostal(raw.postalCode);
    if (!postalCode) throw new HttpsError('invalid-argument', 'Code postal canadien invalide.');
    for (const field of ['street', 'city', 'province']) if (raw[field] != null && typeof raw[field] !== 'string') throw new HttpsError('invalid-argument', 'Les coordonnées doivent être des chaînes.');
    const city = typeof raw.city === 'string' ? raw.city.trim() : '';
    const province = typeof raw.province === 'string' ? raw.province.trim().toUpperCase() : '';
    if (!city) requiredFields.push(path + '.city');
    if (!province) requiredFields.push(path + '.province');
    if (province && (!CA_PROVINCE_CODES.has(province) || !postalMatchesProvince(postalCode, province))) throw new HttpsError('invalid-argument', 'Province et code postal incohérents.');
    // This endpoint only describes NEW paid shipping, never a historical return.
    if (!/^[GHJ]/.test(postalCode) || (province && province !== 'QC')) throw new HttpsError('failed-precondition', 'Les nouvelles expéditions payées sont réservées au Québec.');
    return { country: 'CA' as const, postalCode, city, province };
  };
  const from = zone(fromAddress, 'fromAddress'), to = zone(toAddress, 'toAddress');
  if (weight === undefined) requiredFields.push('weight');
  else if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 100) throw new HttpsError('invalid-argument', 'Poids réel requis pour estimer.');
  let parcelDimensions;
  if (dimensions !== undefined) {
    if (!dimensions || !['length', 'width', 'height'].every(field => typeof dimensions[field] === 'number' && Number.isFinite(dimensions[field]) && dimensions[field] > 0 && dimensions[field] <= 300)) throw new HttpsError('invalid-argument', 'Dimensions invalides.');
    parcelDimensions = { length: dimensions.length, width: dimensions.width, height: dimensions.height, unit: 'centimeter' as const };
  }
  if (requiredFields.length) return { success: false, estimateOnly: true, usableForPurchase: false,
    status: 'estimate_information_required', requiredFields, rates: [] };
  const shipEngine = getShipEngine();
  if (!shipEngine) throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
  const estimateForDate = new Date().toISOString();
  try {
    const rates = await shipEngine.getRateEstimates(from, to, { weight: { value: weight, unit: 'kilogram' },
      ...(parcelDimensions ? { dimensions: parcelDimensions } : {}) }, estimateForDate);
    return { success: true, estimateOnly: true, usableForPurchase: false, estimateForDate, requiredFields: [],
      rates: rates.sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount).slice(0, 5).map(rate => ({
        rateId: null, carrier: rate.carrierFriendlyName, carrierCode: rate.carrierCode, serviceName: rate.serviceType,
        deliveryDays: rate.estimatedDeliveryDays > 0 ? String(rate.estimatedDeliveryDays) + ' jours ouvrables' : null,
        amount: rate.shippingAmount.amount, currency: rate.shippingAmount.currency, deliveryType: rate.deliveryType,
      })) };
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.error('Shipping estimate unavailable', { error: error instanceof Error ? error.message : 'unknown' });
    throw new HttpsError('unavailable', 'L’estimation est indisponible. Aucune étiquette ou commande n’a été créée.');
  }

    });
  });

// =============================================================================
// GET SERVICE FEE — Returns fee info for client display
// =============================================================================


export const findPickupPoints = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/shipping.findPickupPoints"}, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  // Rate limit: PUDO search hits the paid ShipEngine API on every call.
  // Unauthenticated cap stays at 0; authenticated callers get a browsing rate.
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, {
    functionName: 'findPickupPoints',
    maxCallsAuthenticated: 30,
    maxCallsUnauthenticated: 0,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  const data = request.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpsError('invalid-argument', 'Recherche invalide.');
  // No current client uses this callable. Preserve a truthful response to the
  // former postal-only envelope, without choosing a provider implicitly.
  if (Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, 'postalCode')) {
    if (!normalizeCanadianPostal(data.postalCode)) throw new HttpsError('invalid-argument', 'Code postal canadien invalide.');
    return unqualifiedServicePointLookup('selection_required');
  }
  const allowed = data.mode === 'detail' ? ['capability', 'mode', 'carrierId', 'serviceCode', 'countryCode', 'servicePointId'] :
    ['capability', 'mode', 'carrierId', 'serviceCode', 'countryCode', 'postalCode', 'radiusKm'];
  if (Object.keys(data).some(key => !allowed.includes(key)) || data.capability !== 'service_point_lookup_v1' ||
      (data.mode !== 'list' && data.mode !== 'detail') || !providerId(data.carrierId) || data.carrierId.length > 100 ||
      typeof data.serviceCode !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.serviceCode) || data.countryCode !== 'CA') {
    throw new HttpsError('invalid-argument', 'Transporteur, service et mode explicites requis.');
  }
  let input: ServicePointLookupInput;
  if (data.mode === 'list') {
    const postalCode = normalizeCanadianPostal(data.postalCode), radiusKm = data.radiusKm === undefined ? 10 : data.radiusKm;
    if (!postalCode || !Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 100) throw new HttpsError('invalid-argument', 'Zone de recherche invalide.');
    input = {mode: 'list', carrierId: data.carrierId, serviceCode: data.serviceCode, countryCode: 'CA', postalCode, radiusKm};
  } else {
    if (typeof data.servicePointId !== 'string' || !data.servicePointId.trim() || data.servicePointId !== data.servicePointId.trim() ||
        data.servicePointId.length > 200 || /[\u0000-\u001f\u007f]/.test(data.servicePointId)) throw new HttpsError('invalid-argument', 'Identifiant de point invalide.');
    input = {mode: 'detail', carrierId: data.carrierId, serviceCode: data.serviceCode, countryCode: 'CA', servicePointId: data.servicePointId};
  }
  const shipEngine = getShipEngine();
  return shipEngine ? shipEngine.findPUDOLocations(input) :
    unqualifiedServicePointLookup('provider_not_configured', input.mode === 'list' ? input.radiusKm : null);

    });
  });

// =============================================================================
// CHECK TRACKING STATUS — Via ShipEngine
// =============================================================================

type LabelPurchaseQualification = 'native_committed' | 'historical_unknown' | 'unqualified';
const own = (value: unknown, key: string) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const documentText = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() &&
  value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

/** The native receipt qualifies a past purchase, never current permission to
 * ship, carrier acceptance, or a right to buy/void another label. */
function labelDocumentIdentity(id: string, order: FirebaseFirestore.DocumentData, direction: TrackingLeg):
  { identity: CurrentLabelDocumentIdentity | null; purchaseQualification: LabelPurchaseQualification } {
  if (own(order.labelLifecycleCurrent, direction)) {
    const current = savedLifecycleLabelIdentity(id, order, direction);
    return current ? {purchaseQualification: 'native_committed', identity: {...current, trackingNumber: current.trackingNumber!}} : {purchaseQualification: 'unqualified', identity: null};
  }
  const labelId = direction === 'forward' ? order.shipEngineLabelId : order.returnLabelId;
  const trackingNumber = direction === 'forward' ? order.trackingNumber : order.returnTrackingNumber;
  const carrierCode = direction === 'forward' ? order.carrierCode : order.returnCarrierCode;
  const snapshot = order.shippingSnapshot, purchase = order.labelPurchase, returned = order.returnRequest;
  const proof = direction === 'forward' ? purchase?.qualification : returned?.labelProof;
  const invalid = () => ({ identity: null, purchaseQualification: 'unqualified' as const });
  if (!providerId(labelId) || !documentText(labelId, 200) || !documentText(trackingNumber, 200) || typeof carrierCode !== 'string' ||
      !/^[a-z0-9_]{1,100}$/.test(carrierCode) || !documentText(order.buyerId, 128) ||
      !documentText(order.sellerId, 128) || order.buyerId === order.sellerId ||
      order.deliveryType !== 'shipping') return invalid();
  const shipmentId = direction === 'forward' ? snapshot?.shipmentId ?? null : proof?.shipmentId ?? null;
  const carrierId = direction === 'forward' ? snapshot?.rate?.carrierId ?? null : proof?.carrierId ?? null;
  const serviceCode = direction === 'forward' ? snapshot?.rate?.serviceCode ?? null : proof?.serviceCode ?? null;
  const outboundLabelId = direction === 'return' ? proof?.outboundLabelId ?? null : null;
  const rateId = direction === 'forward' ? order.shipEngineRateId ?? null : null;
  if ([shipmentId, carrierId, outboundLabelId, rateId].some(value => value !== null && (!providerId(value) || !documentText(value, 200))) ||
      serviceCode !== null && (typeof serviceCode !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(serviceCode))) return invalid();
  const providerCreatedAtMs = providerUtc(proof?.providerCreatedAt);
  const nativeClock = providerCreatedAtMs !== null && Number.isSafeInteger(providerCreatedAtMs) &&
    providerCreatedAtMs >= 0 && providerCreatedAtMs <= Date.now();
  let purchaseQualification: LabelPurchaseQualification = 'historical_unknown';
  if (direction === 'return' && own(order, 'returnRequest')) {
    if (!committedReturnReceipt(id, order) || !trackingIdentity(id, order, direction) || !nativeClock) return invalid();
    purchaseQualification = 'native_committed';
  } else if (direction === 'forward' && own(order, 'labelPurchase')) {
    const hash = createHash('sha256').update(JSON.stringify({ buyerId: order.buyerId, sellerId: order.sellerId,
      articleId: order.articleId, snapshot: order.shippingSnapshot, rateId: order.shipEngineRateId })).digest('hex');
    const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (!trackingIdentity(id, order, direction) || !documentText(purchase?.attemptId, 128) || purchase.sourceHash !== hash ||
        !(purchase.reservedAt instanceof Timestamp) || !(purchase.requestedAt instanceof Timestamp) ||
        !(purchase.committedAt instanceof Timestamp) || purchase.reservedAt.toMillis() > purchase.requestedAt.toMillis() ||
        purchase.requestedAt.toMillis() > purchase.committedAt.toMillis() || !nativeClock ||
        snapshot?.schemaVersion !== 1 || snapshot.provider !== 'shipengine' || snapshot.rate?.shipmentId !== shipmentId ||
        snapshot.rate?.rateId !== purchase.rateId || snapshot.rate?.carrierCode !== carrierCode ||
        proof?.schemaVersion !== 1 || proof.currency !== 'CAD' || proof.requestedRateId !== purchase.rateId ||
        !['request_path', 'filtered_lookup'].includes(proof.rateIdentitySource) ||
        !cents(proof.shipmentCents) || !cents(proof.insuranceCents) || !cents(proof.totalCents) ||
        proof.totalCents !== proof.shipmentCents + proof.insuranceCents ||
        exactCents(order.actualShippingCost) !== proof.totalCents || order.shippingCostCurrency !== 'CAD') return invalid();
    purchaseQualification = 'native_committed';
  }
  return { purchaseQualification, identity: { labelId, direction, trackingNumber, carrierCode, shipmentId, carrierId,
    serviceCode, outboundLabelId, rateId, providerCreatedAtMs: nativeClock ? providerCreatedAtMs : null } };
}

/** GET-only servicing. Both reads are native transactions, without order,
 * tracking, ledger, notice, label-intention, refund or cancellation writes. */
async function observeLabelDocument(ownerId: string, input: Record<string, any>) {
  const { transactionId, expectedUid, direction, expectedLabelId, operation, expectedSourceHash, expectedSourceRevision } = input;
  if (expectedUid !== ownerId) throw new HttpsError('permission-denied', 'La session a changé.');
  if (!documentText(transactionId, 200) || transactionId.includes('/') || !['forward', 'return'].includes(direction) ||
      !(expectedLabelId === null || providerId(expectedLabelId) && documentText(expectedLabelId, 200))) {
    throw new HttpsError('invalid-argument', 'Commande, trajet et étiquette exacts requis.');
  }
  if (operation !== undefined && operation !== 'source_check') throw new HttpsError('invalid-argument', 'Opération de lecture inconnue.');
  if (operation === 'source_check' && (typeof expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSourceHash) ||
      typeof expectedSourceRevision !== 'string' || !/^\d{1,20}:\d{1,9}$/.test(expectedSourceRevision))) {
    throw new HttpsError('invalid-argument', 'Empreinte et révision exactes de la lecture requises.');
  }
  const leg = direction as TrackingLeg, ref = db.collection('transactions').doc(transactionId);
  const read = async (tx: FirebaseFirestore.Transaction) => {
    const snapshot = await tx.get(ref), order = snapshot.data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (order.buyerId !== ownerId && order.sellerId !== ownerId) throw new HttpsError('permission-denied', 'Pas votre commande.');
    if ((leg === 'forward' ? order.sellerId : order.buyerId) !== ownerId) {
      throw new HttpsError('permission-denied', 'Ce document est réservé à la personne qui expédie ce trajet.');
    }
    const currentId = leg === 'forward' ? order.shipEngineLabelId : order.returnLabelId;
    const labelMatches = (currentId ?? null) === expectedLabelId;
    if (!labelMatches && operation !== 'source_check') throw new HttpsError('failed-precondition',
      'L’étiquette de ce trajet a changé. Actualisez la commande.', { reason: 'label_document_source_changed' });
    const sourceRevision = snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;
    const sourceHash = supportSourceHash({ transactionId, direction: leg, order });
    const furnishingQualified = leg !== 'return' || await returnDocumentFurnished(tx, transactionId, order);
    const qualification = furnishingQualified && await labelLifecycleIdentityQualified(tx, transactionId, order, leg) ? labelDocumentIdentity(transactionId, order, leg) :
      {identity: null, purchaseQualification: 'unqualified' as const};
    let unique = false;
    if (qualification.identity) {
      const [forward, returned] = await Promise.all([
        tx.get(db.collection('transactions').where('shipEngineLabelId', '==', currentId).limit(2)),
        tx.get(db.collection('transactions').where('returnLabelId', '==', currentId).limit(2)),
      ]);
      unique = forward.size + returned.size === 1 && (leg === 'forward' ? forward : returned).docs[0]?.id === transactionId;
    }
    return { sourceRevision, sourceHash, ...qualification, unique, labelMatches };
  };
  const before = await db.runTransaction(read);
  // Native tuple check just before the client opens the freshly read URL.
  // Return before quota, provider configuration or any external I/O. No URL is
  // accepted/returned here, and a changed source cannot bless a cached link.
  if (operation === 'source_check') {
    const sourceMatches = before.labelMatches && before.identity !== null && before.unique &&
      before.purchaseQualification !== 'unqualified' && before.sourceRevision !== null &&
      before.sourceRevision === expectedSourceRevision && before.sourceHash === expectedSourceHash;
    return { protocol: 'label_document_source_check_v1', transactionId, ownerId, direction: leg,
      labelId: expectedLabelId, sourceRevision: before.sourceRevision, sourceHash: before.sourceHash,
      purchaseQualification: before.purchaseQualification,
      observation: sourceMatches ? 'source_matches' : 'source_changed', documentUrl: null, newPurchaseAuthorized: false };
  }
  let observed: CurrentLabelDocument = { observation: 'needs_review', providerStatus: null, providerVoided: null,
    providerRevision: null, providerCreatedAtMs: null, observedAtMs: Date.now(), documentUrl: null,
    reason: before.identity ? 'saved_label_owner_ambiguous' : 'saved_label_source_unqualified' };
  if (before.identity && before.unique && before.sourceRevision !== null) {
    // Quota only: no mutation of the order or its servicing/financial witnesses.
    await checkRateLimit(ownerId, true, { functionName: 'labelDocumentObserve', maxCallsAuthenticated: 10,
      maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    const engine = getShipEngine();
    observed = engine ? await engine.readCurrentLabelDocument(before.identity) : { ...observed,
      observation: 'unknown', reason: 'current_label_provider_unavailable', observedAtMs: Date.now() };
  }
  const current = await db.runTransaction(read);
  if (current.sourceRevision !== before.sourceRevision || current.sourceHash !== before.sourceHash ||
      current.purchaseQualification !== before.purchaseQualification || current.unique !== before.unique) {
    observed = { observation: 'needs_review', providerStatus: null, providerVoided: null, providerRevision: null,
      providerCreatedAtMs: null, observedAtMs: Date.now(), documentUrl: null, reason: 'label_document_source_changed' };
  }
  return { protocol: 'label_document_observation_v1', transactionId, ownerId, direction: leg,
    labelId: expectedLabelId, sourceRevision: current.sourceRevision, sourceHash: current.sourceHash,
    purchaseQualification: current.purchaseQualification, ...observed,
    labelUsability: observed.observation === 'provider_voided' ? 'provider_voided' : 'not_certified',
    newPurchaseAuthorized: false };
}


export const checkTrackingStatus = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'] }, async (request) => {
    return withFinancialRecoveryScope({operation: "callable/payments/shipping.checkTrackingStatus"}, async () => {
  return withPrivateAccountSession(request, async () => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { transactionId, mode } = request.data ?? {};
  if (request.data?.capability === RETURN_DEPOSIT_DEADLINE_CAPABILITY) return handleReturnDepositDeadline(request, async (tx, id) => {
    const snapshot = await tx.get(db.collection('transactions').doc(id)), order = snapshot.data();
    if (!order) return {snapshot, identity: null, unique: false};
    const qualification = await labelLifecycleIdentityQualified(tx, id, order, 'return') ? labelDocumentIdentity(id, order, 'return') : null;
    const identity = qualification?.purchaseQualification === 'native_committed' ? qualification.identity : null;
    if (!identity) return {snapshot, identity: null, unique: false};
    const [forward, returned] = await Promise.all([
      tx.get(db.collection('transactions').where('shipEngineLabelId', '==', identity.labelId).limit(2)),
      tx.get(db.collection('transactions').where('returnLabelId', '==', identity.labelId).limit(2)),
    ]);
    return {snapshot, identity, unique: forward.size + returned.size === 1 && returned.docs[0]?.id === id};
  });

  if (request.data?.capability === TRANSPORT_CARRIER_CAPABILITY) {
    if (mode === 'transport_review_source_observe') return readTransportCarrierSource(request);
    if (mode === 'transport_reviews_observe') return readTransportCarrierHistory(request);
    if (mode === 'transport_review_preview') return previewTransportCarrier(request);
    if (mode === 'transport_review_command') return commandTransportCarrier(request);
    throw new HttpsError('invalid-argument', 'Mode du dossier coût/indemnité inconnu.');
  }

  if (request.data?.capability === TRANSPORT_CONTACT_CAPABILITY) {
    if (mode === 'transport_review_source_observe') return readTransportContactSource(request);
    if (mode === 'transport_reviews_observe') return readTransportContactHistory(request);
    if (mode === 'transport_review_preview') return previewTransportContact(request);
    if (mode === 'transport_review_command') return commandTransportContact(request);
    throw new HttpsError('invalid-argument', 'Mode du dossier collecte/refus inconnu.');
  }

  if (['label_lifecycle_source_observe', 'label_lifecycle_preview', 'label_lifecycle_command', 'label_lifecycle_history_observe', 'label_lifecycle_admin_queue_observe'].includes(mode)) {
    if (request.data?.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'La session de l’étiquette a changé.');
    if (request.data?.capability !== 'label_lifecycle_v1') throw new HttpsError('invalid-argument', 'Version du cycle de vie de l’étiquette requise.');
    // Its helper resolves the SDK's exact receipt/neutralization FIRST; a
    // closed stage grants no source reader, role grant or provider operation.
    if (mode === 'label_lifecycle_command') return commandLabelLifecycle(request);
    if (!LABEL_LIFECYCLE_DISPATCH_ENABLED) throw new HttpsError('failed-precondition', 'Le cycle de vie des étiquettes est en préparation.', {reason: 'label_lifecycle_not_exposed'});
    if (mode === 'label_lifecycle_source_observe') return readLabelLifecycleSource(request);
    if (mode === 'label_lifecycle_preview') return previewLabelLifecycle(request);
    if (mode === 'label_lifecycle_history_observe') return readLabelLifecycleHistory(request);
    return readLabelLifecycleAdminQueue(request);
  }

  if (mode === 'fraud_admin_decision_preview') return previewFraudReviewDecision(request);
  if (mode === 'fraud_admin_decision_command') return commandFraudReviewDecision(request);
  if (['fraud_cases_observe', 'fraud_case_observe', 'fraud_admin_cases_observe', 'fraud_admin_case_observe', 'seller_activity_facts_observe'].includes(mode)) return readFraudReview(request);
  if (mode === 'label_document_observe') return observeLabelDocument(request.auth.uid, request.data);
  if (mode === 'tracking_history_observe') return readTrackingHistory(request.auth.uid, request.data);
  if (mode === 'late_transport_incidents_observe') return readLateTransportIncidents(request);
  if (mode === 'return_to_sender_source_observe') return readReturnToSenderSource(request.auth.uid, request.data);
  if (mode === 'return_to_sender_command') return commandReturnToSender(request);
  if (mode === 'return_to_sender_cases_observe') return readReturnToSenderCases(request);
  if (mode === 'transport_review_source_observe') return readTransportReviewSource(request);
  if (mode === 'transport_reviews_observe') return readTransportReviews(request);
  if (mode === 'transport_review_preview') return previewTransportReview(request);
  if (mode === 'transport_review_command') return commandTransportReview(request);
  if (mode !== undefined && mode !== 'policy_observe') throw new HttpsError('invalid-argument', 'Mode de lecture inconnu.');

  if (mode === 'policy_observe') {
    if (request.data?.capability === 'effective_delivery_window_v1') return readEffectivePurchasePolicy(request);
    const transport=request.data?.capability==='shipping_transport_terms_v1';
    const preparation=request.data?.capability===PURCHASE_PREPARATION_CAPABILITY;
    if (request.data?.capability !== undefined&&!preparation&&!transport) throw new HttpsError('invalid-argument', 'Capacité de lecture inconnue.');
    if(transport&&Object.keys(request.data??{}).some(k=>!['transactionId','expectedUid','mode','capability'].includes(k)))throw new HttpsError('invalid-argument','Lecture des seules conditions acceptées requise.');
    const ownerId = request.auth.uid;
    if (request.data?.expectedUid !== ownerId || typeof transactionId !== 'string' || !transactionId ||
        transactionId.length > 200 || transactionId.includes('/')) throw new HttpsError('invalid-argument', 'Compte et commande exacts requis.');
    return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
      const order = (await tx.get(db.collection('transactions').doc(transactionId))).data();
      if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
      if (order.buyerId !== ownerId && order.sellerId !== ownerId) throw new HttpsError('permission-denied', 'Pas votre commande.');
      if(transport) {
        const accepted=acceptedOrderPurchasePolicy(order,transactionId),has=(v:any,k:string)=>v!=null&&Object.prototype.hasOwnProperty.call(v,k);
        const result=(qualification:'accepted_snapshot'|'historical_terms_not_recorded'|'unknown',terms:ReturnType<typeof shippingTransportSummary>|null)=>({
          protocol:'shipping_transport_terms_observation_v1',transactionId,ownerId,qualification,terms,purchasePolicyHash:accepted?.hash??null});
        const recorded=['transportAdmission','transportBaseHash','transportTermsAcceptance'].some(k=>has(order,k))||has(order.shippingSnapshot,'transportAdmission');
        if(!recorded&&!accepted)return result('historical_terms_not_recorded',null);
        if(!accepted||typeof order.shippingQuoteId!=='string'||!order.shippingQuoteId||order.shippingQuoteId.includes('/'))return result('unknown',null);
        const quote=(await tx.get(db.collection('shipping_quotes').doc(order.shippingQuoteId))).data();
        if(!quote||quote.state!=='claimed'||quote.transactionId!==transactionId||quote.ownerId!==order.buyerId||quote.sellerId!==order.sellerId||
          quote.articleId!==order.articleId||quote.acceptedRateId!==order.shipEngineRateId||quote.acceptedTotal!==order.totalAmount||!acceptedQuotePurchasePolicy(order,transactionId,quote))return result('unknown',null);
        try {
          const cap=qualifiedOrderTransportQuote(order,quote,transactionId);
          if(!cap)return result('historical_terms_not_recorded',null);
          return result('accepted_snapshot',shippingTransportSummary(cap));
        }catch{return result('unknown',null);}
      }
      if(preparation)return purchasePreparationObservation(tx,transactionId,ownerId,order);
      return { transactionId, ownerId, purchasePolicy: purchasePolicyTimeline(order, transactionId) };
    });
  }

  if (!transactionId) {
    throw new HttpsError('invalid-argument', 'Transaction ID is required');
  }

  try {
    const transactionDoc = await db.collection('transactions').doc(transactionId).get();

    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transaction = transactionDoc.data()!;

    // SECURITY: only the buyer or seller can trigger tracking status checks.
    // Without this, any authenticated user could force DELIVERED status and
    // trigger fund transfer to the seller.
    const callerUid = request.auth.uid;
    if (transaction.buyerId !== callerUid && transaction.sellerId !== callerUid) {
      throw new HttpsError(
        'permission-denied',
        'You are not authorized for this transaction'
      );
    }

    if (!transaction.trackingNumber) {
      throw new HttpsError('failed-precondition', 'No tracking number available');
    }

    const shipEngine = getShipEngine();
    if (!shipEngine) {
      throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
    }

    const tracking = await readQualifiedTracking(transactionId, transaction, 'forward');

    const trackingStatus = ShipEngineClient.mapStatus(tracking.statusCode);

    // The shared transaction preserves terminal/refund states. It also records
    // a current qualified scan on an existing delivery without moving its funds
    // or deadline, so later observations have a native chronology witness.
    // Apply the tracking outcome via the shared state-machine helper:
    //  - DELIVERED -> pendingBalance -> heldBalance + fundsReleaseAt (+7d)
    //  - FAILURE   -> delivery_failed, funds frozen, both parties notified
    //  - TRANSIT   -> label_created becomes 'shipped' (first carrier scan)
    //  - else      -> trackingStatus refresh only
    const transition = await applyTrackingOutcome(transactionId, trackingStatus, 'manual', tracking.proof, tx => assertPrivateAccountSession(request, tx));
    const committed = (await transactionDoc.ref.get()).data();

    return {
      success: true,
      trackingStatus: committed?.trackingStatus ?? 'UNKNOWN',
      observedTrackingStatus: trackingStatus,
      observationKind: tracking.proof.providerEventAtMs == null ? 'current_snapshot' : 'qualified_scan',
      transitionApplied: 'changed' in transition && transition.changed,
      trackingHistory: tracking.events || [],
    };
  } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    if (error instanceof HttpsError) throw error;
    if (error instanceof Error && error.message === 'tracking_read_superseded') throw new HttpsError('unavailable',
      'Le suivi a été actualisé pendant cette lecture. Actualisez son état.', {reason: 'tracking_read_superseded', action: 'refreshTrackingStatus'});
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error checking tracking status:', error);
    throw new HttpsError('internal', `Failed to check tracking: ${message}`);
  }

  });

    });
  });

// =============================================================================
// ACCEPT MEETUP OFFER — Seller accepts a buyer's meetup offer (atomic)
// =============================================================================

/**
 * P1-4 / P1-7 — server-authoritative meetup offer acceptance.
 *
 * Previously the offer accept + meetup transaction creation lived entirely on
 * the client (chatService.acceptOffer → createMeetupTransaction), which trusted
 * client-supplied buyerId/sellerId. Worse, any path deriving buyer/seller from
 * `request.auth.uid` would mislabel the seller (the accepter) as the buyer.
 *
 * F9 — buyer/seller are derived from the ARTICLE, never from the offer sender:
 *   - sellerId = article.sellerId (the article owner is always the seller),
 *   - buyerId  = the OTHER chat participant.
 * Deriving the buyer from `message.senderId` broke seller counter-offers: when
 * the seller emits a counter-offer, senderId is the seller, so the old code
 * mislabelled the seller as buyer and threw permission-denied. The caller must
 * be the participant who did NOT emit the offer (the accepter) — so either side
 * can accept the other side's offer/counter-offer.
 *
 * In ONE runTransaction it:
 *   1. re-reads the offer message (must be a pending meetup offer in this chat),
 *   2. re-reads the article (must exist, seller-owned),
 *   3. flips `offer.status` to 'accepted',
 *   4. marks the article sold,
 *   5. creates the linked `meetup_pending` transaction (NO platform fee).
 *
 * F8 — idempotency for the direct-checkout meetup flow. checkout/meetup
 * pre-creates the meetup_pending tx (locking the article) THEN sends the offer,
 * so acceptMeetupOffer would otherwise reject on `isSold === true` — a 48h
 * dead-end. If a non-cancelled meetup transaction already exists for this
 * chat+buyer+article, we accept the offer and return THAT transaction id
 * instead of rejecting / creating a duplicate (no re-lock, no second tx).
 */
