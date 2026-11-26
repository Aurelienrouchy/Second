import {inventoryEngagementMatches} from './inventoryUnit';
/** Data-only canonical reader for an exact already-reserved shipping order.
 * No wallet, ledger, flag, provider IO or new reservation is authorized here.
 * Callers authenticate the buyer and classify existing financial exposure first. */
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import {Timestamp} from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { type ShipEngineAddress } from '../config/shipEngine';
import { readEligibilityEvidence } from './eligibility';
import { assertOwnTradingEligibility, assertArticleNotModerationRestricted } from './tradeAdmission';
import { assertArticleHygieneAdmitted } from './articleHygiene';
import { hasUnrestrictedStripeChargeCapability } from './stripeAccount';
import { counterpartEligibilityRefusal, eligibilityVersion, evaluateCurrentSellerEligibility } from '../shared/eligibility';
import { hasUnavailableAccountStanding } from '../shared/accountStanding';
import { canonicalParcel, canonicalShippingAddress, qualifiedShippingPackage, requireId } from './shippingPurchase';
import { parcelProvenanceHash, qualifiedAutomaticParcelSource, qualifiedShippingParcelSnapshot } from './automaticShippingParcel';
import { shippingItemProjection, shippingSourceFingerprint, SHIPPING_PURCHASE_PRICING_VERSION, shippingTaxSourceHash } from './shippingSourceIdentity';
import { hasBlockedUser } from './meetupOffers';
import { calculateServiceFee, buildServiceFeeTaxCapture } from './fees';
import {qualifiedServiceFeeTaxAdmission} from '../config/operatorServiceTax';
import { reductionForShopDoc } from '../callable/payments/feeReduction';
import { consistentRateDetails, exactCents, hasCurrentRateQualification } from './shippingPurchaseRate';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';
import { assertPurchasePreparationForNewPayment, acceptedPurchaseTaxSnapshot } from './purchasePolicy';
import { assertArticleNotSwapEngaged } from './articleSwapEngagement';
import { assertNewPaidShippingCoverageQualified, declaredOrdinaryAddressSource, qualifiedOrdinaryAddressSource,
  qualifiedShippingAddressAdmission, shippingAddressAdmission, ordinaryShippingSourceHash } from './shippingLaunchAdmission';
import {captureShippingTransport,qualifiedShippingTransportAdmission,shippingTransportHash,shippingTransportLeg,transportSourceHash} from '../config/shippingTransportPolicy';
import { readAcceptedShippingOffer, shippingPriceSourceHash } from './shippingOffers';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? "undefined").digest('hex');
const stale = () => new HttpsError('aborted', 'Les renseignements ou le prix accepté ont changé. Aucun nouveau paiement n’a été effectué.',
  { reason: 'wallet_purchase_stale', action: 'reviewPendingOrder', paymentPermissionGranted: false });
const sellerUnavailable = () => {
  const refusal = counterpartEligibilityRefusal('new_paid_shipping');
  return new HttpsError('failed-precondition', refusal.message, refusal);
};
const address = (a: Record<string, string>): ShipEngineAddress => ({ name: a.name, addressLine1: a.street, cityLocality: a.city,
  stateProvince: a.province, postalCode: a.postalCode, countryCode: a.country,
  ...(a.line2 ? { addressLine2: a.line2 } : {}), ...(a.phone ? { phone: a.phone } : {}), ...(a.email ? { email: a.email } : {}) });
export interface ReservedShippingPurchase {
  order: FirebaseFirestore.DocumentData; quote: FirebaseFirestore.DocumentData;
  articleId: string; sellerId: string; buyerId: string; totalCents: number; hash: string; revision: number; accountId: string;
  context: { shipFrom: ShipEngineAddress; shipTo: ShipEngineAddress; parcel: ReturnType<typeof canonicalParcel> };
}
/** The internal phase flag permits an account refresh before the final read.
 * Every commit of a new financial authorization requires true. */
export async function readReservedShippingPurchase(tx: FirebaseFirestore.Transaction, uid: string, id: string,
  order: FirebaseFirestore.DocumentData, requireObservation: boolean): Promise<ReservedShippingPurchase> {
  // This reader is NEW authorization only. Callers service their native own
  // receipts, engaged intent and authentication/recovery before reaching it.
  assertNewPaidShippingCoverageQualified();
  let articleId: string, quoteId: string;
  try { articleId = requireId(order.articleId, 'articleId'); quoteId = requireId(order.shippingQuoteId, 'shippingQuoteId'); } catch { throw stale(); }
  const article = (await tx.get(db.collection('articles').doc(articleId))).data();
  const quote = (await tx.get(db.collection('shipping_quotes').doc(quoteId))).data();
  if (!article || !quote || article.sellerId !== order.sellerId || order.sellerId === uid || article.activeTransactionId !== id || article.isSold !== true ||
    article.isActive !== true || article.isShipping !== true || quote.schemaVersion !== 1 || quote.state !== 'claimed' || quote.transactionId !== id ||
    quote.ownerId !== uid || quote.articleId !== articleId || quote.sellerId !== order.sellerId || quote.acceptedRateId !== order.shipEngineRateId ||
    quote.acceptedTotal !== order.totalAmount) throw stale();
  if(!order.inventoryUnitCommitment || !await inventoryEngagementMatches(tx,articleId,article,{kind:'purchase',id,sourceArticleId:articleId},order.inventoryUnitCommitment))throw stale();
  assertArticleNotModerationRestricted(article);
  await assertArticleNotSwapEngaged(tx, articleId);
  assertArticleHygieneAdmitted(article);
  const sellerId = requireId(article.sellerId, 'sellerId');
  const buyer = await readEligibilityEvidence(tx, uid), seller = await readEligibilityEvidence(tx, sellerId);
  await assertOwnTradingEligibility(buyer, 'buy', tx, uid);
  if (!seller.user || hasUnavailableAccountStanding(seller.user) || !evaluateCurrentSellerEligibility(seller, requireObservation ? 'new_paid_shipping' : 'sell').allowed) throw sellerUnavailable();
  if (hasBlockedUser(buyer.user ?? undefined, sellerId) || hasBlockedUser(seller.user ?? undefined, uid)) throw new HttpsError('permission-denied', 'Cette relation est bloquée.');
  const accountId = seller.user.stripeAccountId;
  if (typeof accountId !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(accountId) ||
      (requireObservation && !hasUnrestrictedStripeChargeCapability({ chargesEnabled: seller.user.stripeChargesEnabled,
        status: seller.user.stripeAccountStatus, disabledReason: seller.user.stripeRequirementsDisabledReason,
        requirementsPastDue: seller.user.stripeRequirementsPastDue }))) throw sellerUnavailable();
  const chosen = Array.isArray(seller.user.addresses) ? seller.user.addresses.find((a: any) => a?.isDefault === true) ?? seller.user.addresses[0] : null;
  let origin: Record<string, string>;
  try { origin = canonicalShippingAddress({ ...chosen, name: chosen?.name ?? seller.user.displayName,
    ...(chosen?.phone == null && seller.user.phoneNumber != null ? { phone: seller.user.phoneNumber } : {}) }); } catch { throw sellerUnavailable(); }
  let destination: Record<string, string>;
  try { destination = canonicalShippingAddress(order.shippingAddress); } catch { throw stale(); }
  const addressAdmission = shippingAddressAdmission(declaredOrdinaryAddressSource(chosen, sellerId, 'seller_declared'),
    qualifiedOrdinaryAddressSource(order.shippingAddress, order.addressAdmission?.destination, uid, 'buyer_declared'));
  const pack = (await tx.get(db.collection('shipping_packages').doc(articleId))).data();
  let parcel: ReturnType<typeof canonicalParcel>;
  try {
    // Requalify the persisted preparation; never recalculate from an edited
    // listing/category or upgrade an already-reserved profile to a new version.
    parcel = qualifiedShippingPackage(pack, articleId, sellerId);
  } catch { throw sellerUnavailable(); }
  const parcelSource = qualifiedAutomaticParcelSource(pack, parcel) ?? undefined;
  const history = await tx.get(db.collection('transactions').where('articleId', '==', articleId));
  if (history.docs.some(d => d.id !== id && (!['cancelled','refunded','completed','meetup_completed'].includes(d.data().status) || hasActiveBankDispute(d.data()) || hasUnsettledRefund(d.data())))) throw stale();
  let shops: { id: string; data: any }[];
  if (article.shopId != null) {
    const s = await tx.get(db.collection('shops').doc(requireId(article.shopId, 'shopId')));
    shops = s.exists ? [{ id: s.id, data: s.data() }] : [];
    if (shops.length && shops[0].data.ownerId !== sellerId) throw sellerUnavailable();
  } else {
    const s = await tx.get(db.collection('shops').where('ownerId', '==', sellerId)); shops = s.docs.map(d => ({ id: d.id, data: d.data() }));
  }
  shops.sort((a,b) => a.id.localeCompare(b.id));
  const shippingOffer = order.shippingOffer == null ? undefined : await readAcceptedShippingOffer(tx,
    { buyerId: uid, articleId, article, messageId: order.offerMessageId, chatId: order.chatId, transactionId: id });
  if (shippingOffer && (shippingTransportHash(shippingOffer) !== shippingTransportHash(order.shippingOffer) ||
      shippingTransportHash(shippingOffer) !== shippingTransportHash(quote.source?.shippingOffer)) ||
      !shippingOffer && quote.source?.shippingOffer != null) throw stale();
  const reduction = reductionForShopDoc(shops.find(s => s.data.status === 'approved')?.data), amountCents = shippingOffer?.amountCents ?? exactCents(article.price);
  if (!amountCents || (article.currency != null && article.currency !== 'CAD')) throw stale();
  const amount = amountCents / 100, fee = calculateServiceFee(amount, reduction);
  const {taxSnapshot,taxAdmission}=buildServiceFeeTaxCapture(fee,{recipientUid:uid,source:'shipping_destination',address:destination,
    nativeSourceReference:sha(['native_shipping_destination',uid,articleId]),transport:'native_carrier_total'}),tax=taxSnapshot.taxTotal;
  const item = shippingItemProjection(article), baseHash = parcelProvenanceHash(shippingPriceSourceHash(shippingSourceFingerprint({ articleId, sellerId, buyerId: uid, origin, destination, parcel,
    parcelVersion: pack!.version, item, amount, fee, tax, reduction, buyerVersion: eligibilityVersion(buyer), sellerVersion: eligibilityVersion(seller),
    accountId, stripeChargesEnabled: seller.user.stripeChargesEnabled === true, proofIdentity: seller.profile?.sellerQuebecEvidence?.identityHash ?? null,
    shops: shops.map(s => ({ id: s.id, status: s.data.status ?? null, tier: s.data.tier ?? null,
      paidUntil: typeof s.data.tierPaidUntil?.toMillis === 'function' ? s.data.tierPaidUntil.toMillis() : s.data.tierPaidUntil ?? null })) }), shippingOffer), parcelSource);
  const transport=captureShippingTransport({origin,destination,parcel,item,amount,addressAdmission});
  const transportBaseHash=ordinaryShippingSourceHash(baseHash,addressAdmission),pricingBaseHash = transportSourceHash(transportBaseHash,transport.admission), hash = shippingTaxSourceHash(pricingBaseHash, taxSnapshot,taxAdmission);
  const baseContext = { shipFrom: address(origin), shipTo: address(destination), parcel };
  const context={...baseContext,transport:shippingTransportLeg(transport.admission,baseContext,'forward')};
  const rates = quote.rates, snap = order.shippingSnapshot;
  // Requalify every native copy, including the exact party and physical
  // address binding. Never turn a legacy untyped address into ordinary.
  try {
    for (const raw of [order.addressAdmission, quote.source?.addressAdmission, snap?.addressAdmission]) {
      if (shippingTransportHash(qualifiedShippingAddressAdmission(origin, destination, raw, sellerId, uid)) !== shippingTransportHash(addressAdmission)) throw stale();
    }
    for(const raw of [order.transportAdmission,quote.source?.transportAdmission,snap?.transportAdmission]) {
      if(shippingTransportHash(qualifiedShippingTransportAdmission(raw))!==shippingTransportHash(transport.admission))throw stale();
    }
    if(shippingTransportHash(quote.source?.transportPolicy)!==shippingTransportHash(transport.policy))throw stale();
    if(quote.source?.transportBaseHash!==transportBaseHash||order.transportBaseHash!==transportBaseHash)throw stale();
    const acceptance=order.transportTermsAcceptance,mirror=quote.transportTermsAcceptance;
    if(acceptance?.protocol!=='shipping_transport_acceptance_v1'||acceptance.termsHash!==transport.admission.termsHash||
      acceptance.acceptedBy!==uid||acceptance.quoteId!==quoteId||acceptance.rateId!==order.shipEngineRateId||acceptance.policyHash!==order.purchasePolicy?.hash||
      !(acceptance.acceptedAt instanceof Timestamp)||!acceptance.acceptedAt.isEqual(order.purchasePolicyAcceptance?.acceptedAt)||
      !(mirror?.acceptedAt instanceof Timestamp)||!mirror.acceptedAt.isEqual(acceptance.acceptedAt)||
      shippingTransportHash(acceptance)!==shippingTransportHash(mirror))throw stale();
  } catch { throw stale(); }
  const source = { articleId, sellerId, buyerId: uid, origin, destination, parcel, parcelVersion: pack!.version, item, amount, fee, tax,
    ...(parcelSource ? { parcelSource } : {}),
    pricingVersion: SHIPPING_PURCHASE_PRICING_VERSION, pricingBaseHash, taxSnapshot,...(taxAdmission?{taxAdmission}:{}),
    ...(shippingOffer ? { shippingOffer } : {}), reduction, hash };
  // Compare canonical reconstructed captures, not Firestore map ordering.
  const acceptedTax = acceptedPurchaseTaxSnapshot(order, quote);
  for(const copy of [order,quote.source]){
    const present=copy!=null&&Object.prototype.hasOwnProperty.call(copy,'taxAdmission');
    if(present!==!!taxAdmission)throw stale();
    if(present){
      const recorded=qualifiedServiceFeeTaxAdmission(copy.taxAdmission);
      if(!recorded||shippingTransportHash(recorded)!==shippingTransportHash(taxAdmission))throw stale();
    }
  }
  if (!acceptedTax || shippingTransportHash(acceptedTax) !== shippingTransportHash(taxSnapshot) || Object.keys(source).filter(key => key !== 'taxSnapshot'&&key!=='taxAdmission')
    .some(key => quote.source?.[key]===undefined || shippingTransportHash(source[key as keyof typeof source]) !== shippingTransportHash(quote.source[key])) || !hasCurrentRateQualification(rates, context) ||
    !hasCurrentRateQualification({ ...rates, qualification: quote.acceptedQualification }, context)) throw stale();
  const selected = rates.rates.find((r: any) => r.rateId === order.shipEngineRateId);
  if (!selected || !consistentRateDetails(rates.qualification, quote.acceptedQualification, selected.rateId)) throw stale();
  const totalCents = amountCents + exactCents(fee)! + exactCents(tax)! + selected.shippingCents;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || order.currency !== 'CAD' || exactCents(order.totalAmount) !== totalCents ||
    exactCents(order.amount) !== amountCents || exactCents(order.sellerPayout) !== amountCents || exactCents(order.serviceFee) !== exactCents(fee) ||
    exactCents(order.taxTotal) !== exactCents(tax) || exactCents(order.shippingCost) !== selected.shippingCents || order.buyerFeeReduction !== reduction ||
    shippingTransportHash(order.articleSnapshot) !== shippingTransportHash(item) || !snap || snap.schemaVersion !== 1 || snap.provider !== 'shipengine' || snap.currency !== 'CAD' ||
    snap.priceAcceptedBy !== uid || snap.shipmentId !== rates.shipmentId || !qualifiedShippingParcelSnapshot(snap) ||
    snap.measurementSource !== (parcelSource?.source ?? 'seller_declared') ||
    (snap.profileSize ?? null) !== (parcelSource?.profileSize ?? null) || (snap.profileVersion ?? null) !== (parcelSource?.profileVersion ?? null) ||
    (snap.profileFamily ?? null) !== (parcelSource?.profileVersion === 2 ? parcelSource.profileFamily : null) ||
    snap.parcelVersion !== pack!.version || shippingTransportHash(snap.origin) !== shippingTransportHash(origin) || shippingTransportHash(snap.destination) !== shippingTransportHash(destination) || shippingTransportHash(snap.parcel) !== shippingTransportHash(parcel) || shippingTransportHash(snap.rate) !== shippingTransportHash(selected)) throw stale();
  await assertPurchasePreparationForNewPayment(tx,id,order);
  return { order, quote, articleId, sellerId, buyerId: uid, totalCents, hash, revision: seller.profile?.connectObservationRevision ?? 0, accountId, context };
}
