/** Explicit parcel claim through the existing order problem journal. No refund or possession inference. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid, supportObject, supportId, supportRequestId, supportHash, supportSourceHash, supportText} from './supportRequest';
import {productReviewCaseRef, productReviewCaseId, readProductReviewSource} from './productReviewSource';
import {readProductReviewContributionProof} from './productReviewContributions';
import {assertProductParcelNewOpen, productParcelRequested} from './productReviewParcel';
import {prepareOperationalNotices, readOperationalNoticeReceipts} from './notifications';
import {effectivePurchaseReleaseAt} from './purchasePolicy';
import {committedReturnReceipt} from './returnRequest';
import {hasUnsettledRefund} from './refundState';
import {exactCents} from './shippingPurchaseRate';

const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export type ProductParcelProblemReference = {caseId: string; caseVersion: number; caseSourceHash: string; contributionId: string; contributionHash: string;
  sourceHash: string; topic: 'parcel_delivery'; parcelCapability: 'product_review_parcel_v1'; actorRole: 'buyer'|'seller'; leg: 'forward'|'return'};
function reference(v: unknown): ProductParcelProblemReference {
  const r = supportObject(v, ['caseId', 'caseVersion', 'caseSourceHash', 'contributionId', 'contributionHash', 'sourceHash', 'topic', 'parcelCapability', 'actorRole', 'leg']);
  if (!/^pr_[a-f0-9]{64}$/.test(r.caseId ?? '') || !/^pc_[a-f0-9]{64}$/.test(r.contributionId ?? '') ||
      !Number.isSafeInteger(r.caseVersion) || r.caseVersion < 1 || ![r.caseSourceHash, r.contributionHash, r.sourceHash].every(hash) ||
      r.topic !== 'parcel_delivery' || r.parcelCapability !== 'product_review_parcel_v1' ||
      !['buyer', 'seller'].includes(r.actorRole) || !['forward', 'return'].includes(r.leg))
    throw new HttpsError('invalid-argument', 'Contribution et portée du recours colis natifs requis.');
  return {caseId: r.caseId, caseVersion: r.caseVersion, caseSourceHash: r.caseSourceHash, contributionId: r.contributionId,
    contributionHash: r.contributionHash, sourceHash: r.sourceHash, topic: r.topic, parcelCapability: r.parcelCapability, actorRole: r.actorRole, leg: r.leg};
}
const context = (id: string) => ({kind: 'order' as const, id});
async function origin(tx: FirebaseFirestore.Transaction, id: string, uid: string, contributionId: string) {
  const row = (await tx.get(productReviewCaseRef(context(id)).collection('contributions').doc(contributionId))).data();
  const proof = await readProductReviewContributionProof(tx, context(id), contributionId, row), p = proof?.command.parcelStatement;
  return proof?.actorId === uid && proof.topic === 'parcel_delivery' && p && ['buyer', 'seller'].includes(proof.actorRole) ? {proof, hash: row!.contentHash, statement: p} : null;
}
/** Exact sale-attributed movement; an aggregate wallet never supplies its ownership. */
async function heldPayment(tx: FirebaseFirestore.Transaction, id: string, order: FirebaseFirestore.DocumentData) {
  const total = exactCents(order.totalAmount), walletCents = ['wallet', 'mixed', 'wallet_and_card'].includes(order.paidVia) ? order.walletAmountUsed : 0;
  if (order.currency !== 'CAD' || total === null || total < 1 || !(order.paidAt instanceof Timestamp) || order.paidAt.toMillis() < 0 || order.paidAt.toMillis() > Date.now() ||
      !Number.isSafeInteger(walletCents) || walletCents < 0 || walletCents > total || order.fundsReleasedAt != null || order.refund != null ||
      order.refundedAt != null || order.disputeId != null || order.bankDispute != null || hasUnsettledRefund(order)) return null;
  if (total > walletCents && (!/^pi_[A-Za-z0-9_]+$/.test(order.stripePaymentIntentId ?? '') || order.capturedCardCents !== total - walletCents)) return null;
  if (walletCents > 0) {
    const rows = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', id).limit(101));
    const debit = rows.docs.filter(r => r.data().type === 'purchase_debit');
    if (rows.size > 100 || debit.length !== 1 || debit[0].data().amount !== walletCents ||
        !(debit[0].data().createdAt instanceof Timestamp) || debit[0].data().createdAt.toMillis() < 0 || debit[0].data().createdAt.toMillis() > Date.now() || rows.docs.some(r => r.data().type === 'refund_credit')) return null;
    if (order.paidVia === 'wallet' && (walletCents !== total || order.walletPayment?.state !== 'committed' ||
        order.walletPayment.actorUid !== order.buyerId || order.walletPayment.ledgerId !== debit[0].id || order.walletPayment.amountCents !== total)) return null;
  }
  const rows = await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').where('transactionId', '==', id).limit(101));
  if (rows.empty || rows.size > 100 || rows.docs.some(r => !['sale_credit', 'funds_held', 'debt_repayment'].includes(r.data().type) ||
      !Number.isSafeInteger(r.data().amount) || r.data().amount < 0 || !(r.data().createdAt instanceof Timestamp) || r.data().createdAt.toMillis() < 0 || r.data().createdAt.toMillis() > Date.now())) return null;
  const held = rows.docs.filter(r => r.data().type === 'funds_held'), pending = rows.docs.filter(r => r.data().type === 'sale_credit' && r.data().status === 'pending');
  const row = held.length === 1 ? held[0] : held.length === 0 && pending.length === 1 ? pending[0] : null;
  const amount = held.length ? order.sellerHeldCreditCents : order.sellerPendingCreditCents;
  if (!row || !Number.isSafeInteger(amount) || amount < 1 || row.data().amount !== amount) return null;
  const wallet = (await tx.get(db.collection('wallets').doc(order.sellerId))).data(), bucket = held.length ? wallet?.heldBalance : wallet?.pendingBalance;
  if (!Number.isSafeInteger(bucket) || bucket < amount) return null;
  return {qualification: 'native_sale_attributed_pending_or_held', amountCents: amount, ledgerId: row.id, bucket: held.length ? 'held' : 'pending',
    buyerPaymentCents: total, currentBalanceOwnershipInferred: false};
}
async function current(tx: FirebaseFirestore.Transaction, id: string, uid: string, contributionId: string) {
  const source = await readProductReviewSource(tx, context(id), false, true), root = source.caseSnap.data(), own = await origin(tx, id, uid, contributionId);
  if (!own || source.document.nativeActors[`${own.proof.actorRole as 'buyer'|'seller'}Id`] !== uid || root?.protocol !== 'product_review_case_v1' ||
      root.caseId !== productReviewCaseId(context(id)) || !(root.createdAt instanceof Timestamp) || root.createdAt.toMillis() < 0 || root.createdAt.toMillis() > Date.now() ||
      !Number.isSafeInteger(root.version) || root.version < 1 || root.version >= Number.MAX_SAFE_INTEGER - 1) return null;
  const ref: ProductParcelProblemReference = {caseId: source.caseId, caseVersion: root.version, caseSourceHash: supportSourceHash(root),
    contributionId, contributionHash: own.hash, sourceHash: source.sourceHash, topic: 'parcel_delivery', parcelCapability: 'product_review_parcel_v1',
    actorRole: own.proof.actorRole, leg: own.statement.leg};
  return {source, own, ref};
}
const notices = (id: string, disputeId: string, r: ProductParcelProblemReference, buyerId: string, sellerId: string) => [buyerId, sellerId].map(userId => ({
  eventKey: `product_parcel_problem_v1:${disputeId}`, userId, type: 'product_review_update', title: 'Constat colis et recours',
  message: 'Un constat déclaré a été relié à cette commande pour examen humain. Il ne prouve ni la remise, ni la perte, ni une responsabilité et ne décide pas du remboursement ou des frais.',
  data: {ownerId: userId, transactionId: id, productReviewCaseId: r.caseId, contextKind: 'order', contextId: id}}));
function view(receipt: any, replay: boolean) {
  const {notificationIds: _notificationIds, adminAlert: _adminAlert, ...publicReceipt} = receipt;
  return {...publicReceipt, replay};
}
/** Historical ownership comes from the original claim, command receipt and permanent notice receipts. */
export async function qualifiedClaim(tx: FirebaseFirestore.Transaction, id: string, uid: string, claimId: string,
    claim: FirebaseFirestore.DocumentData | undefined, r: ProductParcelProblemReference) {
  if (!claim || claim.transactionId !== id || claim.reportOwnerId !== uid ||
      typeof claim.reportRequestId !== 'string' || claim[`${r.actorRole}Id`] !== uid ||
      typeof claim.buyerId !== 'string' || !claim.buyerId || claim.buyerId.includes('/') ||
      typeof claim.sellerId !== 'string' || !claim.sellerId || claim.sellerId.includes('/') || claim.buyerId === claim.sellerId ||
      !['not_received_despite_delivered', 'not_as_described', 'damaged', 'other'].includes(claim.reason) ||
      !(claim.createdAt instanceof Timestamp) || claim.createdAt.toMillis() < 0 || claim.createdAt.toMillis() > Date.now()) return false;
  let original: ProductParcelProblemReference;
  try {supportRequestId(claim.reportRequestId); original = reference(claim.productReview);} catch {return false;}
  if (claimId !== 'problem_' + supportHash([uid, id, claim.reportRequestId]) || original.caseId !== r.caseId ||
      original.contributionId !== r.contributionId || original.contributionHash !== r.contributionHash ||
      original.actorRole !== r.actorRole || original.leg !== r.leg ||
      claim.details !== undefined && (typeof claim.details !== 'string' || !claim.details || claim.details.trim() !== claim.details || claim.details.length > 1000)) return false;
  const originalHash = supportHash({reason: claim.reason, details: claim.details ?? null, productReview: original});
  const receipt = (await tx.get(db.collection('transactions').doc(id).collection('problem_requests').doc(supportHash([uid, claim.reportRequestId])))).data();
  if (!receipt || receipt.protocol !== 'transaction_parcel_report_v1' || receipt.ownerId !== uid || receipt.transactionId !== id ||
      receipt.requestId !== claim.reportRequestId || receipt.payloadHash !== originalHash || claim.reportPayloadHash !== originalHash ||
      receipt.state !== 'committed' || receipt.committed !== true || receipt.disputeId !== claimId || receipt.reason !== null ||
      receipt.admissionVerified !== false || receipt.financialEffect !== 'none' || receipt.externalRecourseDeadlineExtended !== false ||
      !['parcel_investigation', 'buyer_delivery', 'seller_return_parcel'].includes(receipt.recourseScope) || receipt.recourseScope !== claim.recourseScope ||
      receipt.freezeCommitted !== (receipt.recourseScope === 'parcel_investigation' || original.actorRole === 'buyer' && original.leg === 'forward') ||
      supportHash(receipt.productReview) !== supportHash(original) || receipt.reportedAt !== claim.createdAt.toDate().toISOString() ||
      !Array.isArray(receipt.notificationIds) || receipt.notificationIds.length !== 2 ||
      receipt.adminAlert?.id !== `product_parcel_problem_${claimId}` || !hash(receipt.adminAlert?.contentHash)) return false;
  const noticeReceipts = await readOperationalNoticeReceipts(tx, notices(id, claimId, original, claim.buyerId, claim.sellerId));
  return noticeReceipts.every((p, i) => !!p && p.notificationId === receipt.notificationIds[i]);
}
export async function productParcelReport(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['expectedUid', 'transactionId', 'requestId', 'reason', 'details', 'mode', 'capability',
    'parcelCapability', 'materialCapability', 'productReview', 'contributionId', 'accepted']);
  const id = supportId(raw.transactionId);
  if (raw.capability !== 'product_parcel_report_v1' || !productParcelRequested(raw) ||
      raw.materialCapability !== undefined && raw.materialCapability !== 'product_review_material_v1') throw new HttpsError('invalid-argument', 'Version du recours colis explicite requise.');
  if (raw.mode === 'source_observe') {
    assertProductParcelNewOpen(true);
    if (!/^pc_[a-f0-9]{64}$/.test(raw.contributionId ?? '') || ['requestId', 'reason', 'details', 'productReview', 'accepted'].some(k => raw[k] !== undefined))
      throw new HttpsError('invalid-argument', 'Lecture propre de contribution colis requise.');
    return db.runTransaction(async tx => ({protocol: 'product_parcel_report_source_v1', ownerId: uid, transactionId: id,
      productReview: (await current(tx, id, uid, raw.contributionId))?.ref ?? null, physicalReceiptVerified: false, faultEstablished: false, financialEffect: 'none', freezePermissionGranted: false}));
  }
  const r = reference(raw.productReview), requestId = supportRequestId(raw.requestId), details = raw.details == null ? null : supportText(raw.details, 'Constat', 1000);
  if (!['execute', 'observe', 'neutralize'].includes(raw.mode) || !['not_received_despite_delivered', 'not_as_described', 'damaged', 'other'].includes(raw.reason) ||
      raw.mode !== 'observe' && raw.accepted !== true || raw.contributionId !== undefined) throw new HttpsError('invalid-argument', 'Recours et accord explicites requis.');
  const payloadHash = supportHash({reason: raw.reason, details, productReview: r}), ref = db.collection('transactions').doc(id).collection('problem_requests').doc(supportHash([uid, requestId]));
  const disputeId = 'problem_' + supportHash([uid, id, requestId]);
  return db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data();
    if (prior) {
      if (prior.protocol !== 'transaction_parcel_report_v1' || prior.ownerId !== uid || prior.requestId !== requestId || prior.transactionId !== id ||
          prior.payloadHash !== payloadHash || supportHash(prior.productReview) !== supportHash(r) || !['committed', 'not_executed'].includes(prior.state) ||
          prior.committed !== (prior.state === 'committed') || typeof prior.reportedAt !== 'string' || !Number.isSafeInteger(Date.parse(prior.reportedAt)) ||
          Date.parse(prior.reportedAt) < 0 || Date.parse(prior.reportedAt) > Date.now() || prior.financialEffect !== 'none' || prior.externalRecourseDeadlineExtended !== false ||
          prior.state === 'not_executed' && (prior.disputeId !== null || prior.freezeCommitted !== false || typeof prior.reason !== 'string')) throw new HttpsError('already-exists', 'Cette référence désigne une autre intention.');
      if (prior.state === 'committed') {
        const claim = (await tx.get(db.collection('disputes').doc(disputeId))).data();
        if (!claim || prior.disputeId !== disputeId || prior.reason !== null || prior.freezeCommitted !== (prior.recourseScope === 'parcel_investigation' || r.actorRole === 'buyer' && r.leg === 'forward') || claim.transactionId !== id ||
            claim.reportOwnerId !== uid || claim.reportRequestId !== requestId || claim.reportPayloadHash !== payloadHash || claim[`${r.actorRole}Id`] !== uid ||
            typeof claim.buyerId !== 'string' || !claim.buyerId || typeof claim.sellerId !== 'string' || !claim.sellerId || claim.buyerId === claim.sellerId ||
            supportHash(claim.productReview) !== supportHash(r) || !(claim.createdAt instanceof Timestamp) || claim.createdAt.toMillis() !== Date.parse(prior.reportedAt) ||
            !Array.isArray(prior.notificationIds) || prior.notificationIds.length !== 2 || prior.adminAlert?.id !== `product_parcel_problem_${disputeId}` || !hash(prior.adminAlert?.contentHash)) throw new HttpsError('unavailable', 'Liaison du recours à rapprocher.');
        const receipts = await readOperationalNoticeReceipts(tx, notices(id, disputeId, r, claim.buyerId, claim.sellerId));
        if (receipts.some((p, i) => !p || p.notificationId !== prior.notificationIds[i])) throw new HttpsError('unavailable', 'Avis natifs à retrouver.');
      }
      return view(prior, true);
    }
    const own = await origin(tx, id, uid, r.contributionId);
    if (!own || own.hash !== r.contributionHash || own.proof.actorRole !== r.actorRole || own.statement.leg !== r.leg) throw new HttpsError('permission-denied', 'Votre contribution native exacte est requise.');
    const now = Timestamp.now(), base = {protocol: 'transaction_parcel_report_v1', ownerId: uid, transactionId: id, requestId, payloadHash, productReview: r,
      recourseScope: 'unknown', admissionVerified: false, financialEffect: 'none', externalRecourseDeadlineExtended: false};
    if (raw.mode === 'observe') return {...base, state: 'unrecorded', committed: false, disputeId: null, reportedAt: null, freezeCommitted: false, reason: null, replay: false};
    const reject = (reason: string) => {const receipt = {...base, state: 'not_executed', committed: false, disputeId: null, reportedAt: now.toDate().toISOString(), freezeCommitted: false, reason}; tx.create(ref, receipt); return view(receipt, false);};
    if (raw.mode === 'neutralize') return reject('requester_neutralized');
    // Same native contribution/actor/leg is one claim, independently of mutable case/source versions.
    const originRef = db.collection('transactions').doc(id).collection('parcel_problem_origins').doc(supportHash([uid, r.contributionId, r.leg]));
    const savedOrigin = (await tx.get(originRef)).data();
    if (savedOrigin) {
      if (savedOrigin.protocol !== 'product_parcel_problem_origin_v1' || savedOrigin.ownerId !== uid || savedOrigin.transactionId !== id ||
          savedOrigin.contributionId !== r.contributionId || savedOrigin.contributionHash !== r.contributionHash || savedOrigin.leg !== r.leg ||
          !(savedOrigin.recordedAt instanceof Timestamp) || savedOrigin.recordedAt.toMillis() < 0 || savedOrigin.recordedAt.toMillis() > now.toMillis() ||
          typeof savedOrigin.disputeId !== 'string' || !/^problem_[a-f0-9]{64}$/.test(savedOrigin.disputeId)) return reject('parcel_claim_deduplication_requires_review');
      const claim = (await tx.get(db.collection('disputes').doc(savedOrigin.disputeId))).data();
      return reject(await qualifiedClaim(tx, id, uid, savedOrigin.disputeId, claim, r) ? 'parcel_claim_already_recorded' : 'parcel_claim_deduplication_requires_review');
    }
    // Compatibility with genuine claims recorded before the deterministic origin pointer existed.
    const oldClaims = await tx.get(db.collection('disputes').where('productReview.contributionId', '==', r.contributionId).limit(2));
    if (!oldClaims.empty) {
      if (oldClaims.size !== 1 || !await qualifiedClaim(tx, id, uid, oldClaims.docs[0].id, oldClaims.docs[0].data(), r)) return reject('parcel_claim_deduplication_requires_review');
      tx.create(originRef, {protocol: 'product_parcel_problem_origin_v1', ownerId: uid, transactionId: id,
        contributionId: r.contributionId, contributionHash: r.contributionHash, leg: r.leg, disputeId: oldClaims.docs[0].id, recordedAt: now});
      return reject('parcel_claim_already_recorded');
    }
    try {assertProductParcelNewOpen(true);} catch {return reject('product_parcel_review_not_exposed');}
    const quotaRef = db.collection('rate_limits').doc('product_parcel_claim_' + supportHash(uid));
    const quota = (await tx.get(quotaRef)).data();
    if (quota && (quota.protocol !== 'product_parcel_claim_quota_v1' || quota.ownerId !== uid ||
        !(quota.windowStartedAt instanceof Timestamp) || quota.windowStartedAt.toMillis() < 0 || quota.windowStartedAt.toMillis() > now.toMillis() ||
        !Number.isSafeInteger(quota.count) || quota.count < 1 || quota.count > 5)) return reject('new_parcel_claim_quota_requires_review');
    const sameWindow = quota && now.toMillis() - quota.windowStartedAt.toMillis() < 60_000;
    if (sameWindow && quota.count >= 5) return reject('new_parcel_claim_quota_exhausted');
    const nextQuota = {protocol: 'product_parcel_claim_quota_v1', ownerId: uid,
      windowStartedAt: sameWindow ? quota.windowStartedAt : now, count: sameWindow ? quota.count + 1 : 1};
    const orderRef = db.collection('transactions').doc(id), order = (await tx.get(orderRef)).data();
    if (!order || order[`${r.actorRole}Id`] !== uid) return reject('native_party_changed');
    const source = await current(tx, id, uid, r.contributionId);
    if (!source || supportHash(source.ref) !== supportHash(r)) return reject('product_review_source_changed');
    const release = effectivePurchaseReleaseAt(order, id), leg = 'parcelSources' in source.source.document ? source.source.document.parcelSources?.legs.find(l => l.leg === r.leg) : null;
    const binding = leg?.qualification === 'native_current_label' && leg.identity?.labelId === own.statement.labelId;
    const buyer = r.actorRole === 'buyer' && r.leg === 'forward';
    const investigation = r.leg === 'forward' && order.status !== 'delivered' || r.actorRole === 'seller' && r.leg === 'forward' || r.actorRole === 'buyer' && r.leg === 'return';
    if (!binding || order.deliveryType !== 'shipping' || order.cashAgreement != null || order.swapId != null || order.paidVia === 'cash') return reject('parcel_source_unqualified');
    const funding = investigation ? await heldPayment(tx, id, order) : null;
    if (investigation && (!funding || !['paid', 'label_created', 'shipped', 'delivery_failed', 'lost', 'delivered', 'return_requested'].includes(order.status))) return reject('native_payment_or_hold_requires_review');
    if (buyer && !investigation && (order.status !== 'delivered' || order.fundsReleasedAt != null || !(release instanceof Timestamp) || now.toMillis() >= release.toMillis())) return reject('recourse_window_unqualified_or_closed');
    // A current carrier DE qualifies the claim's parcel leg, never the seller's physical receipt or its contents.
    if (!investigation && !buyer && (!committedReturnReceipt(id, order) || !(order.returnDeliveredAt instanceof Timestamp) ||
        leg?.observation.qualification !== 'native_current_observation' || leg.observation.statusCode !== 'DE')) return reject('return_receipt_requires_review');
    if ((await tx.get(db.collection('disputes').doc(disputeId))).exists) return reject('claim_without_receipt_requires_review');
    const alertId = `product_parcel_problem_${disputeId}`, alertRef = db.collection('admin_alerts').doc(alertId);
    if ((await tx.get(alertRef)).exists) return reject('claim_without_receipt_requires_review');
    const prepared = await prepareOperationalNotices(tx, notices(id, disputeId, r, order.buyerId, order.sellerId));
    const freezeCommitted = buyer || investigation;
    const recourseScope = investigation ? 'parcel_investigation' : buyer ? 'buyer_delivery' : 'seller_return_parcel';
    tx.update(productReviewCaseRef(context(id)), {version: source.source.caseSnap.data()!.version + 1, state: 'awaiting_review', latestRecourseAt: now});
    const alert = {type: 'product_parcel_recourse', refId: disputeId, transactionId: id, status: 'open', severity: 'warning', createdAt: now,
      message: 'Recours colis explicite à examiner sur ses sources natives. Ni perte, ni remise, ni responsabilité ne sont certifiées.'};
    tx.create(alertRef, alert);
    tx.create(db.collection('disputes').doc(disputeId), {transactionId: id, buyerId: order.buyerId, sellerId: order.sellerId, articleId: order.articleId ?? null,
      reason: raw.reason, ...(details ? {details} : {}), status: 'open', createdAt: now, reportRequestId: requestId, reportOwnerId: uid, reportPayloadHash: payloadHash,
      productReview: r, recourseScope,
      ...(investigation ? {parcelTreatment: {protocol: 'parcel_investigation_treatment_v1', funding, nativeCreatedAt: now, commercialStatusChanged: false,
        deliveryClockQualified: release instanceof Timestamp, responsibilityEstablished: false, refundPermissionGranted: false}} : {}), physicalReceiptVerified: false, faultEstablished: false});
    const report = {protocol: base.protocol, reason: raw.reason, ...(details ? {details} : {}), requestId, disputeId, payloadHash, productReview: r, reportedAt: now};
    if (investigation) tx.update(orderRef, {disputed: true, parcelRecourseGuard: {protocol: 'parcel_investigation_guard_v1', transactionId: id,
      disputeId, ownerId: uid, productReview: r, payloadHash, recordedAt: now, currentHeldSource: funding,
      financialEffectAuthorized: false, inventoryEffectAuthorized: false, carrierLossVerified: false}});
    else if (buyer) tx.update(orderRef, {status: hasUnsettledRefund(order) ? order.status : 'disputed', statusBeforeDispute: order.status,
      disputed: true, disputedAt: now, buyerReport: report, ...(order.bankDispute ? {'bankDispute.commercialDisputedBeforeOpen': true} : {})});
    else tx.update(orderRef, {sellerParcelReport: report});
    const receipt = {...base, recourseScope, state: 'committed', committed: true, disputeId, reportedAt: now.toDate().toISOString(), freezeCommitted, reason: null,
      notificationIds: prepared.notificationIds, adminAlert: {id: alertId, contentHash: supportSourceHash(alert)}};
    tx.create(originRef, {protocol: 'product_parcel_problem_origin_v1', ownerId: uid, transactionId: id,
      contributionId: r.contributionId, contributionHash: r.contributionHash, leg: r.leg, disputeId, recordedAt: now});
    tx.set(quotaRef, nextQuota);
    tx.create(ref, receipt); prepared.commit(); return view(receipt, false);
  });
}
