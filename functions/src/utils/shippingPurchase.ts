import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoverySourceFields } from './financialRecoverySources';
import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import {assertInventoryAvailable,planInventoryAcquire} from './inventoryUnit';
import { createHash, randomUUID } from 'node:crypto';
import { shippingItemProjection, shippingSourceFingerprint, SHIPPING_PURCHASE_PRICING_VERSION, shippingTaxSourceHash, qualifiedQuoteTaxSnapshot } from './shippingSourceIdentity';
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { getShipEngine, type ShipEngineAddress, type ShipEngineParcel } from '../config/shipEngine';
import { normalizeCanadianAddress } from '../shared/canadianAddress';
import { counterpartEligibilityRefusal, evaluateCurrentSellerEligibility, eligibilityVersion } from '../shared/eligibility';
import { readEligibilityEvidence, assertOwnPublicationEligibility } from './eligibility';
import { assertOwnTradingEligibility, assertArticleNotModerationRestricted, assertArticleChildSafetyAdmitted } from './tradeAdmission';
import { assertAccountRelationshipNewPair } from './accountRelationshipReview';
import { assertArticleHygieneAdmitted } from './articleHygiene';
import { captureConnectObservationBarrier, observeConnectAccount } from './connectEligibility';
import { hasUnrestrictedStripeChargeCapability } from './stripeAccount';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';
import { hasBlockedUser } from './meetupOffers';
import { reductionForShopDoc } from '../callable/payments/feeReduction';
import { calculateServiceFee, buildServiceFeeTaxCapture, type ServiceFeeTaxSnapshot } from './fees';
import {type ServiceFeeTaxAdmission} from '../config/operatorServiceTax';
import { consistentRateDetails, hasCurrentRateQualification, exactCents, type PurchaseRate, type PurchaseRates } from './shippingPurchaseRate';
import { assertNewPaymentsEnabled, isShippingEnabled } from '../config/featureFlags';
import { buildPurchasePolicy, assertPurchasePolicyAccepted, buildPurchasePolicyAcceptance, buildPendingPaymentPolicyWindow,acceptedOrderPurchasePolicy,acceptedQuotePurchasePolicy } from './purchasePolicy';
import { assertArticleSaleDeclaration } from './articleSaleDeclaration';
import { assertArticleNotSwapEngaged } from './articleSwapEngagement';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { assertNewPaidShippingCoverageQualified, declaredOrdinaryAddressSource, qualifiedOrdinaryAddressSource,
  qualifiedShippingAddressAdmission, shippingAddressAdmission, ordinaryShippingSourceHash, ordinaryAddressUseSummary,
  type OrdinaryAddressSource, type ShippingAddressAdmission } from './shippingLaunchAdmission';
import {captureShippingTransport,shippingTransportLeg,shippingTransportSummary,transportSourceHash,qualifiedOrderTransportQuote,shippingTransportHash,
  type ShippingTransportAdmission,type ShippingTransportPolicy} from '../config/shippingTransportPolicy';
import { readAcceptedShippingOffer, shippingPriceSourceHash, type ShippingPriceAgreement } from './shippingOffers';
import { automaticParcelSource, automaticParcelFamilySource, automaticShippingParcel, isShippingProfileSize, parcelProvenanceHash,
  qualifiedAutomaticParcelSource, shippingParcelRecommendation, type AutomaticParcelSource } from './automaticShippingParcel';
import {automaticShippingFamilyProfile, isAutomaticShippingFamily} from '../shared/automaticShippingEstimate';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Explicit private caller checkpoint; server-only callers may omit it. */
type PurchaseSessionGuard = (tx?: FirebaseFirestore.Transaction) => Promise<unknown>;
export const SHIPPING_QUOTE_SCHEMA = 1;
/** Application acceptance policy, never a carrier rate-expiration guarantee. */
const QUOTE_ACCEPTANCE_POLICY = 1;
const QUOTE_ACCEPTANCE_MS = 15 * 60 * 1000;
export const requireId = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !v || v.length > 200 || v.includes('/')) throw new HttpsError('invalid-argument', `${field} invalide`);
  return v;
};
const reQuote = (stage?:string) => new HttpsError('aborted', 'Les renseignements ou le prix ont changé. Demandez un nouveau devis.',
  { reason: 'shipping_quote_stale', action: 'quoteShippingPurchase',...(stage?{stage}:{}) });
const expiredQuote = () => new HttpsError('aborted', 'Le délai d’acceptation de ce devis est terminé. Demandez et acceptez un nouveau devis.',
  { reason: 'shipping_quote_expired', action: 'quoteShippingPurchase', paymentPermissionGranted: false });
/** Applies only before a new reservation. Missing legacy deadlines require a
 * new quote; a claimed quote is recovered before this check by every caller. */
function assertQuoteAcceptanceWindow(quote: FirebaseFirestore.DocumentData, now = Date.now()): void {
  if (quote.acceptancePolicyVersion !== QUOTE_ACCEPTANCE_POLICY || !(quote.issuedAt instanceof Timestamp) ||
      !(quote.validUntil instanceof Timestamp)) throw expiredQuote();
  const issued = quote.issuedAt.toMillis(), deadline = quote.validUntil.toMillis();
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(deadline) || issued < 0 ||
      deadline - issued !== QUOTE_ACCEPTANCE_MS || now < issued || now >= deadline) throw expiredQuote();
}
const unavailableSeller = () => { const refusal = counterpartEligibilityRefusal('new_paid_shipping'); return new HttpsError('failed-precondition', refusal.message, refusal); };
function assertRail() {
  assertNewPaymentsEnabled();
  if (!isShippingEnabled()) throw new HttpsError('failed-precondition', 'La livraison n’est pas disponible pour le moment.');
  assertNewPaidShippingCoverageQualified();
}
function text(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new HttpsError('invalid-argument', `${field} invalide`);
  return v.trim();
}
/** Explicit complete CA/QC destination, including a real recipient name. No
 * phone/name/country is borrowed from a seller or invented from a locality. */
export function canonicalShippingAddress(raw: any): Record<string, string> {
  const a = normalizeCanadianAddress(raw);
  if (!a || typeof raw?.country !== 'string' || raw.country.trim().toUpperCase() !== 'CA' || a.province !== 'QC') {
    throw new HttpsError('invalid-argument', 'Une adresse complète et cohérente au Québec, Canada, est nécessaire.', { reason: 'shipping_address_required' });
  }
  const contact: Record<string, string> = { ...a, name: text(raw.name, 'Nom du destinataire', 100) };
  for (const field of ['phone', 'email']) if (raw[field] !== undefined && raw[field] !== null && raw[field] !== '') contact[field] = text(raw[field], field, field === 'phone' ? 50 : 254);
  return contact;
}
const providerAddress = (a: Record<string, string>): ShipEngineAddress => ({ name: a.name, addressLine1: a.street,
  cityLocality: a.city, stateProvince: a.province, postalCode: a.postalCode, countryCode: a.country,
  ...(a.line2 ? { addressLine2: a.line2 } : {}), ...(a.phone ? { phone: a.phone } : {}), ...(a.email ? { email: a.email } : {}) });
export function canonicalParcel(raw: any): ShipEngineParcel {
  if (raw?.weight?.unit !== 'kilogram' || raw?.dimensions?.unit !== 'centimeter' ||
    ![raw?.weight?.value, raw?.dimensions?.length, raw?.dimensions?.width, raw?.dimensions?.height]
      .every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) throw new HttpsError('invalid-argument',
    'Déclarez le poids en kilogrammes et les trois dimensions en centimètres, avec des nombres positifs.', { reason: 'shipping_parcel_required' });
  return { weight: { value: raw.weight.value, unit: 'kilogram' }, dimensions: { length: raw.dimensions.length,
    width: raw.dimensions.width, height: raw.dimensions.height, unit: 'centimeter' } };
}
/** An absent record alone has genesis version 0. Existing unknown data is
 * never normalized/reset by a setter or returned as an authoritative replay. */
export function qualifiedShippingPackage(data: any, articleId: string, ownerId: string): ShipEngineParcel {
  const invalid = () => new HttpsError('failed-precondition', 'La source des mesures doit être examinée. Contactez notre équipe.',
    { reason: 'shipping_parcel_review_required' });
  if (!data || data.ownerId !== ownerId || data.articleId !== articleId || data.schemaVersion !== 1 ||
    !['seller_declared', 'automatic_profile'].includes(data.source) || data.measurementVerified !== false || !Number.isSafeInteger(data.version) || data.version < 1) throw invalid();
  if (data.source === 'automatic_profile' && !qualifiedAutomaticParcelSource(data, data.parcel) ||
      data.source === 'seller_declared' && (data.profileSize != null || data.profileVersion != null || data.profileFamily != null)) throw invalid();
  try { return canonicalParcel(data.parcel); } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; throw invalid(); }
}
async function noReservation(tx: FirebaseFirestore.Transaction, articleId: string, article: any) {
  await assertArticleNotSwapEngaged(tx, articleId);
  await assertInventoryAvailable(tx,articleId,article);
  const terminal = new Set(['cancelled', 'refunded', 'completed', 'meetup_completed']);
  const live = (data: any) => returnToSenderBlocksProgress(data) || !terminal.has(data.status) || hasActiveBankDispute(data) || hasUnsettledRefund(data);
  const found = await tx.get(db.collection('transactions').where('articleId', '==', articleId).limit(101));
  if (found.size >= 101) throw new HttpsError('failed-precondition', 'L’historique des réservations doit être rapproché avant une nouvelle vente.');
  if (found.docs.some(d => live(d.data()))) throw new HttpsError('failed-precondition', 'Une commande est déjà engagée pour cet article.');
  if (article.activeTransactionId != null) {
    const id = requireId(article.activeTransactionId, 'Liaison de commande');
    const linked = await tx.get(db.collection('transactions').doc(id));
    if (!linked.exists || linked.data()!.articleId !== articleId || live(linked.data())) throw new HttpsError('failed-precondition', 'Un accord reste lié à cet article.');
  }
  if (article.isSold === true) throw new HttpsError('failed-precondition', 'Cet article est déjà réservé.');
}
/** Preparation only: own sale admission, no shipping/QC/KYC admission granted. */
export async function saveShippingParcel(uid: string, data: any, authorize?: PurchaseSessionGuard) {
  await authorize?.();
  const allowedKeys = new Set(['articleId', 'requestId', 'expectedVersion', 'expectedUid', 'parcel', 'profileSize', 'profileVersion', 'profileFamily']);
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowedKeys.has(key))) {
    throw new HttpsError('invalid-argument', 'Le format de préparation du colis est invalide.');
  }
  const articleId = requireId(data?.articleId, 'articleId'), requestId = requireId(data?.requestId, 'requestId');
  const owns = (key: string) => Object.prototype.hasOwnProperty.call(data, key);
  const automatic = ['profileSize', 'profileVersion', 'profileFamily'].some(key => Object.prototype.hasOwnProperty.call(data ?? {}, key));
  if (automatic && (Object.prototype.hasOwnProperty.call(data, 'parcel') || !isShippingProfileSize(data.profileSize) ||
      (data.profileVersion === 2 ? !isAutomaticShippingFamily(data.profileFamily) :
        owns('profileVersion') && data.profileVersion !== 1 || owns('profileFamily')))) {
    throw new HttpsError('invalid-argument', 'Choisissez un format de colis valide sans transmettre de mesures.');
  }
  const parcelSource = automatic ? data.profileVersion === 2 ? automaticParcelFamilySource(data.profileFamily) : automaticParcelSource(data.profileSize) : undefined;
  if (parcelSource && parcelSource.profileSize !== data.profileSize) throw new HttpsError('invalid-argument', 'Le format ne correspond pas à cette estimation.');
  const parcel = parcelSource?.profileVersion === 2 ? automaticShippingFamilyProfile(parcelSource.profileFamily).parcel :
    automatic ? automaticShippingParcel(data.profileSize) : canonicalParcel(data?.parcel);
  const ref = db.collection('shipping_packages').doc(articleId);
  if (!Number.isSafeInteger(data?.expectedVersion) || data.expectedVersion < 0) throw new HttpsError('invalid-argument', 'expectedVersion invalide');
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await authorize?.(tx);
    const article = (await tx.get(db.collection('articles').doc(articleId))).data();
    if (!article) throw new HttpsError('not-found', 'Article introuvable');
    if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre article');
    const previous = (await tx.get(ref)).data();
    if (previous) qualifiedShippingPackage(previous, articleId, uid);
    const recommendation = shippingParcelRecommendation(article);
    const dto = (record: any, replay: boolean) => ({ articleId, version: record.version, parcel: record.parcel,
      source: record.source, profileSize: record.profileSize ?? null, profileVersion: record.profileVersion ?? null,
      profileFamily: record.profileFamily ?? null,
      measurementVerified: false, recommendation, replay });
    if (previous?.requestId === requestId) {
      if (shippingTransportHash(previous.parcel) !== shippingTransportHash(parcel) || previous.previousVersion !== data.expectedVersion ||
          previous.source !== (parcelSource?.source ?? 'seller_declared') ||
          (previous.profileSize ?? null) !== (parcelSource?.profileSize ?? null) || (previous.profileVersion ?? null) !== (parcelSource?.profileVersion ?? null) ||
          (previous.profileFamily ?? null) !== (parcelSource?.profileVersion === 2 ? parcelSource.profileFamily : null)) {
        throw new HttpsError('already-exists', 'Cette demande correspond à un autre colis.');
      }
      return dto(previous, true);
    }
    if (parcelSource?.profileVersion === 2 && parcelSource.profileFamily !== recommendation.profileFamily) {
      throw new HttpsError('aborted', 'L’article a changé. Actualisez son format estimé.', {reason: 'shipping_estimate_changed'});
    }
    const evidence = await readEligibilityEvidence(tx, uid);
    await assertOwnPublicationEligibility(evidence, tx, uid);
    await noReservation(tx, articleId, article);
    if ((previous?.version ?? 0) !== data.expectedVersion) throw new HttpsError('aborted', 'Les mesures ont changé. Actualisez-les.');
    const version = data.expectedVersion + 1;
    if (!Number.isSafeInteger(version)) throw new HttpsError('failed-precondition', 'La version des mesures doit être examinée.');
    await authorize?.(tx);
    await recoveryCommit({refs: [(ref).path]});
    const record = { schemaVersion: 1, articleId, ownerId: uid, version, previousVersion: data.expectedVersion, parcel,
      requestId, ...(parcelSource ?? { source: 'seller_declared' }), measurementVerified: false,
      ...(parcelSource ? { selectedBy: uid, selectedAt: FieldValue.serverTimestamp() } : { declaredBy: uid, declaredAt: FieldValue.serverTimestamp() }) };
    tx.set(ref, record);
    return dto(record, false);
  });
}
/** Owner preparation/history read. No new-sale admission and no private notes. */
export async function readShippingParcel(uid: string, articleId: unknown, authorize?: PurchaseSessionGuard) {
  await authorize?.();
  const id = requireId(articleId, 'articleId');
  return db.runTransaction(async tx => {
    await authorize?.(tx);
    const article = (await tx.get(db.collection('articles').doc(id))).data();
    if (!article) throw new HttpsError('not-found', 'Article introuvable');
    if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre article');
    const data = (await tx.get(db.collection('shipping_packages').doc(id))).data();
    const recommendation = shippingParcelRecommendation(article);
    if (!data) return { articleId: id, version: 0, parcel: null, status: 'missing', source: null, profileSize: null,
      profileVersion: null, profileFamily: null, recommendation, measurementVerified: false };
    const parcel = qualifiedShippingPackage(data, id, uid);
    return { articleId: id, version: data.version, parcel, status: data.source === 'automatic_profile' ? 'estimated' : 'declared',
      source: data.source, profileSize: data.profileSize ?? null, profileVersion: data.profileVersion ?? null,
      profileFamily: data.profileFamily ?? null,
      recommendation, measurementVerified: false };
  });
}
interface Sources {
  articleId: string; sellerId: string; buyerId: string; origin: Record<string, string>; destination: Record<string, string>;
  addressAdmission: ShippingAddressAdmission;
  transportAdmission:ShippingTransportAdmission;transportPolicy:ShippingTransportPolicy;
  transportBaseHash:string;
  parcel: ShipEngineParcel; parcelVersion: number; parcelSource?: AutomaticParcelSource; item: Record<string, any>; amount: number; fee: number;
  tax: number; taxSnapshot: ServiceFeeTaxSnapshot; pricingVersion: typeof SHIPPING_PURCHASE_PRICING_VERSION;
  taxAdmission?:ServiceFeeTaxAdmission;
  pricingBaseHash: string; reduction: number; hash: string; observationRevision: number;
  shippingOffer?: ShippingPriceAgreement;
}
/** All source reads occur before any write. No provider IO inside transactions. */
async function sources(tx: FirebaseFirestore.Transaction, buyerId: string, articleId: string,
  destination: Record<string, string>, destinationDeclaration: OrdinaryAddressSource, requestedAmount?: unknown, requireObservation = true,
  offerMessageId?: unknown, offerChatId?: unknown): Promise<Sources> {
  // Canonical addresses intentionally omit declarations. Carry and requalify
  // the native buyer source explicitly on every quote/reservation source read.
  const destinationSource = qualifiedOrdinaryAddressSource(destination, destinationDeclaration, buyerId, 'buyer_declared');
  const article = (await tx.get(db.collection('articles').doc(articleId))).data();
  if (!article) throw new HttpsError('not-found', 'Article introuvable');
  const sellerId = requireId(article.sellerId, 'sellerId');
  if (sellerId === buyerId) throw new HttpsError('permission-denied', 'Vous ne pouvez pas acheter votre article.');
  await assertAccountRelationshipNewPair(tx, buyerId, sellerId);
  const buyer = await readEligibilityEvidence(tx, buyerId), seller = await readEligibilityEvidence(tx, sellerId);
  await assertOwnTradingEligibility(buyer, 'buy', tx, buyerId);
  if (!seller.user || seller.user.isActive === false || !evaluateCurrentSellerEligibility(seller, requireObservation ? 'new_paid_shipping' : 'sell').allowed) throw unavailableSeller();
  if (hasBlockedUser(buyer.user ?? undefined, sellerId) || hasBlockedUser(seller.user ?? undefined, buyerId)) throw new HttpsError('permission-denied', 'Cette relation est bloquée.');
  if (article.isActive !== true || article.isShipping !== true) throw new HttpsError('failed-precondition', 'Cet article n’est pas disponible pour une nouvelle expédition.');
  assertArticleNotModerationRestricted(article);
  assertArticleHygieneAdmitted(article);
  assertArticleSaleDeclaration(articleId, article);
  await assertArticleChildSafetyAdmitted(tx, articleId, article);
  await noReservation(tx, articleId, article);
  if (article.currency != null && article.currency !== 'CAD') throw new HttpsError('failed-precondition', 'La devise de cet article doit être examinée.');
  const shippingOffer = offerMessageId == null ? undefined : await readAcceptedShippingOffer(tx,
    { buyerId, articleId, article, messageId: offerMessageId, chatId: offerChatId });
  const amountCents = shippingOffer?.amountCents ?? exactCents(article.price);
  if (amountCents === null || amountCents <= 0) throw new HttpsError('failed-precondition', 'Le prix de cet article doit être corrigé.');
  if (requestedAmount != null && exactCents(requestedAmount) !== amountCents) throw new HttpsError('failed-precondition',
    'Un accord de rencontre ne peut pas autoriser un prix expédié. Le parcours d’offre expédiée est indisponible.', { reason: 'shipping_offer_unavailable' });
  if (typeof seller.user!.stripeAccountId !== 'string' || !/^acct_[a-zA-Z0-9]+$/.test(seller.user!.stripeAccountId) ||
      (requireObservation && !hasUnrestrictedStripeChargeCapability({ chargesEnabled: seller.user!.stripeChargesEnabled,
        status: seller.user!.stripeAccountStatus, disabledReason: seller.user!.stripeRequirementsDisabledReason,
        requirementsPastDue: seller.user!.stripeRequirementsPastDue }))) throw unavailableSeller();
  const addresses = seller.user!.addresses;
  const chosen = Array.isArray(addresses) ? addresses.find(a => a?.isDefault === true) ?? addresses[0] : null;
  let origin: Record<string, string>;
  try { origin = canonicalShippingAddress({ ...chosen, name: chosen?.name ?? seller.user!.displayName,
    ...(chosen?.phone == null && seller.user!.phoneNumber != null ? { phone: seller.user!.phoneNumber } : {}) }); } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; throw unavailableSeller(); }
  let addressAdmission: ShippingAddressAdmission;
  try { addressAdmission = shippingAddressAdmission(declaredOrdinaryAddressSource(chosen, sellerId, 'seller_declared'), destinationSource); }
  catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; throw unavailableSeller(); }
  const packageDoc = (await tx.get(db.collection('shipping_packages').doc(articleId))).data();
  let parcel: ShipEngineParcel;
  try { parcel = qualifiedShippingPackage(packageDoc, articleId, sellerId); } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; throw unavailableSeller(); }
  const parcelSource = qualifiedAutomaticParcelSource(packageDoc, parcel) ?? undefined;
  // A saved V2 family is immutable evidence, not permission to quote a new
  // product category with stale geometry. Existing reserved captures are read
  // separately against their own original quote and never silently upgraded.
  if (parcelSource?.profileVersion === 2 && parcelSource.profileFamily !== shippingParcelRecommendation(article).profileFamily) throw unavailableSeller();
  let shops: { id: string; data: any }[];
  if (article.shopId != null) {
    const id = requireId(article.shopId, 'shopId'), s = await tx.get(db.collection('shops').doc(id));
    shops = s.exists ? [{ id, data: s.data() }] : [];
    if (shops.length && shops[0].data.ownerId !== sellerId) throw unavailableSeller();
  } else {
    const result = await tx.get(db.collection('shops').where('ownerId', '==', sellerId));
    shops = result.docs.map(d => ({ id: d.id, data: d.data() }));
  }
  shops.sort((a, b) => a.id.localeCompare(b.id));
  const shop = shops.find(s => s.data.status === 'approved'), reduction = reductionForShopDoc(shop?.data);
  const amount = amountCents / 100, fee = calculateServiceFee(amount, reduction);
  const {taxSnapshot,taxAdmission}=buildServiceFeeTaxCapture(fee,{recipientUid:buyerId,source:'shipping_destination',address:destination,
    nativeSourceReference:sha(['native_shipping_destination',buyerId,articleId]),transport:'native_carrier_total'}),tax=taxSnapshot.taxTotal;
  if (exactCents(fee) === null || exactCents(tax) === null) throw new HttpsError('failed-precondition', 'Les frais doivent être examinés.');
  const item = shippingItemProjection(article);
  const observationRevision = seller.profile?.connectObservationRevision ?? 0;
  const baseHash = parcelProvenanceHash(shippingPriceSourceHash(shippingSourceFingerprint({ articleId, sellerId, buyerId, origin, destination, parcel, parcelVersion: packageDoc!.version, item, amount, fee, tax, reduction,
    buyerVersion: eligibilityVersion(buyer), sellerVersion: eligibilityVersion(seller), accountId: seller.user!.stripeAccountId,
    stripeChargesEnabled: seller.user!.stripeChargesEnabled === true, proofIdentity: seller.profile?.sellerQuebecEvidence?.identityHash ?? null,
    shops: shops.map(s => ({ id: s.id, status: s.data.status ?? null, tier: s.data.tier ?? null,
      paidUntil: typeof s.data.tierPaidUntil?.toMillis === 'function' ? s.data.tierPaidUntil.toMillis() : s.data.tierPaidUntil ?? null })) }), shippingOffer), parcelSource);
  const transport=captureShippingTransport({origin,destination,parcel,item,amount,addressAdmission});
  const transportBaseHash=ordinaryShippingSourceHash(baseHash,addressAdmission),pricingBaseHash = transportSourceHash(transportBaseHash,transport.admission), hash = shippingTaxSourceHash(pricingBaseHash, taxSnapshot,taxAdmission);
  return { articleId, sellerId, buyerId, origin, destination, addressAdmission,transportAdmission:transport.admission,transportPolicy:transport.policy,transportBaseHash, parcel, parcelVersion: packageDoc!.version,
    ...(parcelSource ? { parcelSource } : {}), item, amount, fee, tax,
    pricingVersion: SHIPPING_PURCHASE_PRICING_VERSION, pricingBaseHash, taxSnapshot,...(taxAdmission?{taxAdmission}:{}),
    ...(shippingOffer ? { shippingOffer } : {}), reduction, hash, observationRevision };
}
/** Fresh actual account, never a cached/public/payload admission. Changes in the
 * source are re-read by the observation and later order commit. */
async function freshAccount(uid: string, articleId: string, destination: Record<string, string>, destinationDeclaration: OrdinaryAddressSource, amount?: unknown, authorize?: PurchaseSessionGuard,
  offerMessageId?: unknown, offerChatId?: unknown) {
  const pre = await db.runTransaction(async tx => { await authorize?.(tx); return sources(tx, uid, articleId, destination, destinationDeclaration, amount, false, offerMessageId, offerChatId); });
  await authorize?.();
  const user = (await db.collection('users').doc(pre.sellerId).get()).data();
  await authorize?.();
  try {
    const barrier = await captureConnectObservationBarrier(pre.sellerId, user!.stripeAccountId, authorize);
    const stripe = getStripe();
    if (!stripe) throw unavailableSeller();
    await authorize?.();
    const account = await stripe.accounts.retrieve(user!.stripeAccountId);
    await authorize?.();
    await observeConnectAccount(pre.sellerId, account, { barrier, expectedId: user!.stripeAccountId, transactionGuard: authorize });
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    await authorize?.();
    if (error instanceof HttpsError && error.code === 'aborted') throw reQuote('seller_observation_changed');
    throw unavailableSeller();
  }
  return db.runTransaction(async tx => { await authorize?.(tx); return sources(tx, uid, articleId, destination, destinationDeclaration, amount, true, offerMessageId, offerChatId); });
}
const same = (current: Sources, prior: Sources) => {
  if (current.hash !== prior.hash || current.observationRevision !== prior.observationRevision) throw reQuote();
};
/** Malformed stored context requires requote; never default or rewrite it. */
function qualifiedRates(rates: unknown, source: any): rates is PurchaseRates {
  try {
    const context={
      shipFrom: providerAddress(canonicalShippingAddress(source.origin)),
      shipTo: providerAddress(canonicalShippingAddress(source.destination)),
      parcel: canonicalParcel(source.parcel),
    };
    return hasCurrentRateQualification(rates, {...context,...(Object.prototype.hasOwnProperty.call(source,'transportAdmission')?
      {transport:shippingTransportLeg(source.transportAdmission,context,'forward')}:{})});
  } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; return false; }
}
function rateDto(source: Sources, rate: PurchaseRate) {
  const totalCents = exactCents(source.amount)! + exactCents(source.fee)! + exactCents(source.tax)! + rate.shippingCents;
  if (!Number.isSafeInteger(totalCents)) throw new HttpsError('failed-precondition', 'Le montant doit être examiné.');
  return { rateId: rate.rateId, shipmentId: rate.shipmentId, carrierId: rate.carrierId, carrierCode: rate.carrierCode,
    carrierFriendlyName: rate.carrierFriendlyName, serviceCode: rate.serviceCode, serviceType: rate.serviceType,
    componentsCents: { shipping: rate.componentsCents.shipping, insurance: rate.componentsCents.insurance, confirmation: rate.componentsCents.confirmation, other: rate.componentsCents.other },
    shippingCents: rate.shippingCents, estimatedDeliveryDays: rate.estimatedDeliveryDays, currency: 'CAD', shippingCost: rate.shippingCents / 100, amount: source.amount, serviceFee: source.fee,
    taxTotal: source.tax, totalAmount: totalCents / 100 };
}
function quoteDto(id: string, source: Sources, rates: PurchaseRates, issuedAt: Timestamp, validUntil: Timestamp) {
  return { quoteId: id, schemaVersion: SHIPPING_QUOTE_SCHEMA, articleId: source.articleId, currency: 'CAD', payable: true,
    pricingVersion: source.pricingVersion, taxSnapshot: source.taxSnapshot,
    negotiationSupported: !!source.shippingOffer, ...(source.shippingOffer ? { offer: { messageId: source.shippingOffer.messageId,
      chatId: source.shippingOffer.chatId, amount: source.shippingOffer.amountCents / 100 } } : {}),
    destination: source.destination, item: source.item, originZone: { country: 'CA', province: 'QC' },
    addressUse: ordinaryAddressUseSummary(source.addressAdmission),
    transport:shippingTransportSummary(source.transportAdmission),
    parcel: source.parcel, measurementVerified: false, measurementSource: source.parcelSource?.source ?? 'seller_declared',
    ...(source.parcelSource ? { profileSize: source.parcelSource.profileSize, profileVersion: source.parcelSource.profileVersion,
      ...(source.parcelSource.profileVersion === 2 ? {profileFamily: source.parcelSource.profileFamily} : {}) } : {}),
    rates: rates.rates.map(rate => rateDto(source, rate)),
    purchasePolicy: buildPurchasePolicy(id, source),
    acceptancePolicyVersion: QUOTE_ACCEPTANCE_POLICY, validityScope: 'new_reservation', localValidityMs: QUOTE_ACCEPTANCE_MS,
    issuedAt: issuedAt.toMillis(), validUntil: validUntil.toMillis(), serverTime: issuedAt.toMillis(),
    // These flags describe the carrier, independently of the local deadline.
    expirationKnown: false, providerFreshnessVerified: false, labelPurchaseGuaranteed: false, requiresCurrentValidation: true };
}
export async function quotePurchase(uid: string, data: any, authorize?: PurchaseSessionGuard) {
  await authorize?.();
  assertRail();
  const articleId = requireId(data?.articleId, 'articleId'), destination = canonicalShippingAddress(data?.shippingAddress);
  const destinationDeclaration = declaredOrdinaryAddressSource(data?.shippingAddress, uid, 'buyer_declared');
  const prepared = await freshAccount(uid, articleId, destination, destinationDeclaration, data?.amount, authorize, data?.offerMessageId, data?.chatId);
  const engine = getShipEngine();
  if (!engine) throw new HttpsError('unavailable', 'Le service de devis est indisponible.');
  let rates: PurchaseRates;
  await authorize?.();
  try { const context={shipFrom:providerAddress(prepared.origin),shipTo:providerAddress(destination),parcel:prepared.parcel};
    rates = await engine.getPurchaseRates(context.shipFrom,context.shipTo,context.parcel,shippingTransportLeg(prepared.transportAdmission,context,'forward')); }
  catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; await authorize?.(); throw new HttpsError('unavailable', 'Aucun tarif complet et valide en CAD ne peut être proposé.'); }
  await authorize?.();
  const id = randomUUID();
  const result = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await authorize?.(tx);
    const current = await sources(tx, uid, articleId, destination, destinationDeclaration, prepared.amount, true,
      prepared.shippingOffer?.messageId, prepared.shippingOffer?.chatId); same(current, prepared);
    const issuedAt = Timestamp.now(), validUntil = Timestamp.fromMillis(issuedAt.toMillis() + QUOTE_ACCEPTANCE_MS);
    await authorize?.(tx);
    await recoveryCommit({refs: [(db.collection('shipping_quotes').doc(id)).path]});
    tx.create(db.collection('shipping_quotes').doc(id), { schemaVersion: SHIPPING_QUOTE_SCHEMA, ownerId: uid,
      articleId, sellerId: current.sellerId, state: 'ready', source: current, rates, pricingVersion: current.pricingVersion,
      taxSnapshot: current.taxSnapshot, acceptancePolicyVersion: QUOTE_ACCEPTANCE_POLICY,
      purchasePolicy: buildPurchasePolicy(id, current), issuedAt, validUntil, createdAt: FieldValue.serverTimestamp() });
    return quoteDto(id, current, rates, issuedAt, validUntil);
  });
  return { ...result, serverTime: Date.now() };
}
async function receipt(tx: FirebaseFirestore.Transaction, uid: string, quote: any, id: string, data: any) {
  if (quote.state !== 'claimed') return null;
  const order = (await tx.get(db.collection('transactions').doc(requireId(quote.transactionId, 'transactionId')))).data();
  if (!order || order.buyerId !== uid || order.articleId !== quote.articleId || order.sellerId !== quote.sellerId ||
    order.shippingQuoteId !== id || order.shipEngineRateId !== data.rateId || order.totalAmount !== data.expectedTotal ||
    quote.acceptedRateId !== data.rateId || quote.acceptedTotal !== data.expectedTotal || order.deliveryType !== 'shipping') throw new HttpsError('failed-precondition', 'La liaison de ce devis doit être examinée.');
  let transportTermsHash:string|undefined;
  try {
    const cap=qualifiedOrderTransportQuote(order,quote,quote.transactionId),accepted=acceptedOrderPurchasePolicy(order,quote.transactionId);
    if(cap&&accepted&&acceptedQuotePurchasePolicy(order,quote.transactionId,quote)&&data.expectedTransportTermsHash===cap.termsHash)transportTermsHash=cap.termsHash;
  }catch{/* Preserve the original receipt, without certifying unknown clauses. */}
  return { success: true, transactionId: quote.transactionId, replay: true, paymentPermissionGranted: false,
    ...(transportTermsHash?{transportTermsHash}:{}) };
}
/** Reservation only; card/wallet/fulfillment guards remain subsequent sub-lots. */
export async function reservePurchase(uid: string, data: any, authorize?: PurchaseSessionGuard) {
  await authorize?.();
  if (data?.deliveryType === 'meetup') throw new HttpsError('failed-precondition', 'Proposez une rencontre dans la conversation. Le vendeur doit accepter la proposition avant de réserver cet article.');
  if (data?.existingTransactionId != null) {
    const id = requireId(data.existingTransactionId, 'existingTransactionId');
    return db.runTransaction(async tx => {
      await authorize?.(tx);
      const order = (await tx.get(db.collection('transactions').doc(id))).data();
      if (!order) throw new HttpsError('not-found', 'Commande introuvable');
      if (order.buyerId !== uid) throw new HttpsError('permission-denied', 'Pas votre commande');
      if (order.deliveryType !== 'shipping') throw new HttpsError('failed-precondition', 'Commande non expédiée');
      return { success: true, transactionId: id, replay: true, paymentPermissionGranted: false, existingOrderOnly: true };
    });
  }
  if (!data?.quoteId) throw new HttpsError('failed-precondition', 'Acceptez un devis courant avant de réserver cet article.',
    { reason: 'shipping_quote_required', action: 'quoteShippingPurchase' });
  const quoteId = requireId(data.quoteId, 'quoteId'), rateId = requireId(data.rateId, 'rateId');
  if (data.deliveryType !== 'shipping' || exactCents(data.expectedTotal) === null) throw new HttpsError('invalid-argument', 'Livraison et prix accepté requis');
  const qref = db.collection('shipping_quotes').doc(quoteId);
  const initial = await db.runTransaction(async tx => {
    await authorize?.(tx);
    const quote = (await tx.get(qref)).data();
    if (!quote) throw new HttpsError('not-found', 'Devis introuvable');
    if (quote.ownerId !== uid) throw new HttpsError('permission-denied', 'Pas votre devis');
    const replay = await receipt(tx, uid, quote, quoteId, data);
    return { quote, replay };
  });
  if (initial.replay) return initial.replay;
  assertRail();
  const quote = initial.quote;
  if (quote.schemaVersion !== SHIPPING_QUOTE_SCHEMA || quote.state !== 'ready' || !qualifiedQuoteTaxSnapshot(quote) || !qualifiedRates(quote.rates, quote.source)) throw reQuote('quote_capture_validation');
  assertQuoteAcceptanceWindow(quote);
  assertPurchasePolicyAccepted(data, quote, quoteId);
  const selected = quote.rates.rates.find((rate: PurchaseRate) => rate.rateId === rateId);
  if (!selected || rateDto(quote.source, selected).totalAmount !== data.expectedTotal) throw reQuote();
  if(data.expectedTransportTermsHash!==shippingTransportSummary(quote.source.transportAdmission).termsHash)throw reQuote();
  const destinationDeclaration = qualifiedShippingAddressAdmission(quote.source.origin, quote.source.destination,
    quote.source.addressAdmission, quote.sellerId, uid).destination;
  const prepared = await freshAccount(uid, quote.articleId, quote.source.destination, destinationDeclaration, quote.source.amount, authorize,
    quote.source.shippingOffer?.messageId, quote.source.shippingOffer?.chatId);
  if (prepared.hash !== quote.source.hash) throw reQuote('source_changed');
  const engine = getShipEngine();
  if (!engine) throw new HttpsError('unavailable', 'Le service de devis est indisponible.');
  let currentRates: PurchaseRates;
  await authorize?.();
  try { const context={shipFrom:providerAddress(prepared.origin),shipTo:providerAddress(prepared.destination),parcel:prepared.parcel};
    currentRates = await engine.getPurchaseRatesForShipment(quote.rates.shipmentId,{...context,transport:shippingTransportLeg(prepared.transportAdmission,context,'forward')}); }
  catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; await authorize?.(); throw new HttpsError('unavailable', 'Le tarif ne peut pas être vérifié. Aucun article n’a été réservé.'); }
  await authorize?.();
  if (!qualifiedRates(currentRates, prepared)) throw reQuote('rate_qualification');
  const currentRate = currentRates.rates.find(r => r.rateId === rateId);
  // These are transient value comparisons, not published source identities.
  // Firestore reorders maps; compare their canonical values with the API DTO.
  if (currentRates.shipmentId !== quote.rates.shipmentId || !currentRate || shippingTransportHash(currentRate) !== shippingTransportHash(selected) ||
    !consistentRateDetails(quote.rates.qualification, currentRates.qualification, rateId)) throw reQuote('rate_identity_changed');
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await authorize?.(tx);
    const live = (await tx.get(qref)).data();
    if (!live || live.ownerId !== uid) throw new HttpsError('permission-denied', 'Pas votre devis');
    const replay = await receipt(tx, uid, live, quoteId, data); if (replay) return replay;
    if (live.state !== 'ready' || !qualifiedQuoteTaxSnapshot(live) || shippingTransportHash(live.source) !== shippingTransportHash(quote.source) || shippingTransportHash(live.rates) !== shippingTransportHash(quote.rates)) throw reQuote('quote_concurrent_change');
    assertQuoteAcceptanceWindow(live);
    if (live.issuedAt.toMillis() !== quote.issuedAt.toMillis() || live.validUntil.toMillis() !== quote.validUntil.toMillis()) throw reQuote();
    const current = await sources(tx, uid, quote.articleId, quote.source.destination, destinationDeclaration, quote.source.amount, true,
      quote.source.shippingOffer?.messageId, quote.source.shippingOffer?.chatId); same(current, prepared);
    if (current.hash !== quote.source.hash) throw reQuote('source_changed_at_commit');
    // Recheck after all source reads, at the authorization point before writes.
    const acceptanceValidatedAt = Timestamp.now(); assertQuoteAcceptanceWindow(live, acceptanceValidatedAt.toMillis());
    const prices = rateDto(current, selected), orderRef = db.collection('transactions').doc();
    const purchasePolicy = assertPurchasePolicyAccepted(data, live, quoteId);
    const purchasePolicyAcceptance = buildPurchasePolicyAcceptance(purchasePolicy, orderRef.id, rateId,
      Math.round(prices.totalAmount * 100), acceptanceValidatedAt, current);
    const termsHash=shippingTransportSummary(current.transportAdmission).termsHash;
    if(data.expectedTransportTermsHash!==termsHash)throw reQuote();
    const transportTermsAcceptance={protocol:'shipping_transport_acceptance_v1',termsHash,acceptedBy:uid,quoteId,rateId,
      policyHash:purchasePolicy.hash,acceptedAt:acceptanceValidatedAt};
    const pendingPaymentPolicyWindow=buildPendingPaymentPolicyWindow(purchasePolicy,orderRef.id,rateId,Math.round(prices.totalAmount*100),acceptanceValidatedAt);
    const missingOrder=await tx.get(orderRef);
    const inventoryArticle=(await tx.get(db.collection('articles').doc(current.articleId))).data()!;
    const inventory=await planInventoryAcquire(tx,current.articleId,inventoryArticle,{kind:'purchase',id:orderRef.id,sourceArticleId:current.articleId});
    await authorize?.(tx);
    await recoveryCommit({refs: [(orderRef).path]});
    tx.create(orderRef, await financialRecoverySourceFields('purchase',orderRef,missingOrder,{
      ...(current.transportAdmission.testMode?{devShippingSimulation:{protocol:'seconde_dev_shipping_simulation_v1',realShipment:false,trackingSource:'member_test_action'}}:{}),
      inventoryUnitCommitment:inventory.commitment, articleId: current.articleId, buyerId: uid, sellerId: current.sellerId, amount: current.amount,
      ...(current.shippingOffer ? { shippingOffer: current.shippingOffer, offerMessageId: current.shippingOffer.messageId, chatId: current.shippingOffer.chatId } : {}),
      shippingCost: prices.shippingCost, serviceFee: current.fee, taxTotal: current.tax, buyerFeeReduction: current.reduction,
      pricingVersion: current.pricingVersion, taxSnapshot: current.taxSnapshot,
      ...(current.taxAdmission?{taxAdmission:current.taxAdmission}:{}),
      totalAmount: prices.totalAmount, sellerPayout: current.amount, currency: 'CAD', deliveryType: 'shipping', status: 'pending_payment',
      shippingAddress: current.destination, addressAdmission: current.addressAdmission,transportAdmission:current.transportAdmission,transportBaseHash:current.transportBaseHash, shipEngineRateId: rateId, shippingQuoteId: quoteId,
      purchasePolicy, purchasePolicyAcceptance,transportTermsAcceptance,...(pendingPaymentPolicyWindow?{pendingPaymentPolicyWindow}:{}),
      shippingSnapshot: { schemaVersion: 1, origin: current.origin, destination: current.destination, addressAdmission: current.addressAdmission,transportAdmission:current.transportAdmission, parcel: current.parcel,
        measurementSource: current.parcelSource?.source ?? 'seller_declared', measurementVerified: false, parcelVersion: current.parcelVersion,
        ...(current.parcelSource ? { profileSize: current.parcelSource.profileSize, profileVersion: current.parcelSource.profileVersion,
          ...(current.parcelSource.profileVersion === 2 ? {profileFamily: current.parcelSource.profileFamily} : {}) } : {}),
        provider: 'shipengine', shipmentId: currentRates.shipmentId, rate: selected, quotedAt: quote.createdAt,
        acceptancePolicyVersion: QUOTE_ACCEPTANCE_POLICY, localValidUntil: live.validUntil, acceptanceValidatedAt,
        validatedAt: FieldValue.serverTimestamp(), providerCreatedAt: quote.rates.providerCreatedAt, priceAcceptedBy: uid, currency: 'CAD' },
      articleSnapshot: current.item, createdAt: FieldValue.serverTimestamp() }));
    if (current.shippingOffer) tx.update(db.collection('messages').doc(current.shippingOffer.messageId), {
      'offer.transactionId': orderRef.id, 'offer.consumedAt': FieldValue.serverTimestamp(),
    });
    inventory.commit();await recoveryCommit({refs: [(db.collection('articles').doc(current.articleId)).path]});
    tx.update(db.collection('articles').doc(current.articleId), { isSold: true, activeTransactionId: orderRef.id });
    await recoveryCommit({refs: [(qref).path]});
    tx.update(qref, { state: 'claimed', transactionId: orderRef.id, acceptedRateId: rateId, acceptedTotal: prices.totalAmount,
      acceptedQualification: currentRates.qualification, purchasePolicyAcceptance,transportTermsAcceptance,...(pendingPaymentPolicyWindow?{pendingPaymentPolicyWindow}:{}), acceptanceValidatedAt, acceptedAt: FieldValue.serverTimestamp() });
    return { success: true, transactionId: orderRef.id, replay: false, paymentPermissionGranted: false,transportTermsHash:termsHash };
  });
}
