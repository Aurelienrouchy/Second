/** Operator compilation of recorded native facts. No provider GET, accounting
 * snapshot, activity threshold, professional/fraud classification or new effect. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid, supportObject, supportId, supportRevision, supportSourceHash,
  supportAdmin} from './supportRequest';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {exactCents} from './shippingPurchaseRate';
import {qualifiedRefundNoticeSource} from './refundState';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';

type Data = FirebaseFirestore.DocumentData;
type Money = {qualification: 'native_order_amount' | 'native_recorded_effect' | 'unknown';
  amountCents: number | null; currency: 'CAD' | null; reason: string | null};
type Clock = {qualification: 'native_timestamp' | 'unknown'; at: string | null; reason: string | null};
type Row = {id: string; data: Data};
const LIMIT = 20;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}:\d{1,9}$/.test(v);
const docId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 &&
  !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const uidId = (v: unknown): v is string => docId(v) && v.length <= 128;
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const cad = (v: unknown): v is string => typeof v === 'string' && v.toUpperCase() === 'CAD';
const native = (v: unknown, now: number): v is Timestamp => v instanceof Timestamp && Number.isFinite(v.toMillis()) && v.toMillis() >= 0 && v.toMillis() <= now;
const statuses = new Set(['pending', 'pending_payment', 'paid', 'label_created', 'shipped', 'delivered', 'completed', 'cancelled',
  'disputed', 'return_requested', 'refund_in_progress', 'refund_action_required', 'refunded', 'delivery_failed', 'lost',
  'meetup_pending', 'meetup_confirmed', 'meetup_completed']);
const noAuthority = {fraudEstablished: false, financialPermissionGranted: false, inventoryPermissionGranted: false,
  restrictionPermissionGranted: false, professionalClassification: null, activityAssessment: 'not_provided', bankArrivalVerified: false} as const;
const fail = () => new HttpsError('failed-precondition', 'La commande sélectionnée a changé. Actualisez le contexte de lecture.');
const unknown = (reason: string, currency: 'CAD' | null): Money => ({qualification: 'unknown', amountCents: null, currency, reason});
const money = (amountCents: number, qualification: Exclude<Money['qualification'], 'unknown'>): Money =>
  ({qualification, amountCents, currency: 'CAD', reason: null});
function clock(value: unknown, now: number, reason = 'native_timestamp_missing_or_unqualified'): Clock {
  return native(value, now) ? {qualification: 'native_timestamp', at: value.toDate().toISOString(), reason: null} :
    {qualification: 'unknown', at: null, reason};
}
function sourceInput(value: unknown) {
  const v = supportObject(value, ['transactionId', 'sellerId', 'orderRevision', 'orderSourceHash', 'scopeHash']);
  if (!docId(v.transactionId) || !uidId(v.sellerId) || !revision(v.orderRevision) || !hash(v.orderSourceHash) || !hash(v.scopeHash)) throw fail();
  return v;
}
async function ledger(tx: FirebaseFirestore.Transaction, ownerId: string, transactionId: string) {
  // Exact order equality only; neither the complete ledger nor wallet balances
  // are read. Saturation makes effect qualification unknown, never zero.
  const page = await tx.get(db.collection('wallets').doc(ownerId).collection('ledger')
    .where('transactionId', '==', transactionId).orderBy('__name__').limit(LIMIT + 1));
  const inspected = page.docs.slice(0, LIMIT);
  return {rows: inspected.map(s => ({id: s.id, data: s.data()})), complete: page.size <= LIMIT,
    public: {inspected: inspected.length, limit: LIMIT, hasMore: page.size > LIMIT,
      sources: inspected.map(s => ({id: s.id, revision: supportRevision(s), sourceHash: supportSourceHash(s.data())}))}};
}
type Ledger = Awaited<ReturnType<typeof ledger>>;
function exactRows(rows: Row[], transactionId: string, now: number) {
  return rows.every(r => r.data.transactionId === transactionId && cents(r.data.amount) && native(r.data.createdAt, now) &&
    (r.data.currency == null || cad(r.data.currency)));
}
function oneEffect(rows: Row[], amount: number, transactionId: string, now: number) {
  return rows.length === 1 && rows[0].data.amount === amount && exactRows(rows, transactionId, now);
}
function effects(transactionId: string, order: Data, buyer: Ledger, seller: Ledger, now: number, uniquePayment: boolean) {
  const currency = cad(order.currency) ? 'CAD' : null;
  const total = currency ? exactCents(order.totalAmount) : null, article = currency ? exactCents(order.amount) : null;
  const gross = currency ? exactCents(order.sellerPayout) : null;
  const orderQualified = total !== null && total > 0 && article !== null && article > 0 && article <= total &&
    gross !== null && gross > 0 && gross <= article;
  const unqualified = (reason: string) => unknown(reason, currency);
  const debits = buyer.rows.filter(r => r.data.type === 'purchase_debit');
  const wallet = order.walletAmountUsed == null ? 0 : order.walletAmountUsed, mixed = ['mixed', 'wallet_and_card'].includes(order.paidVia);
  const split = orderQualified && cents(wallet) && wallet <= total! &&
    (order.paidVia === 'wallet' ? wallet === total && order.stripePaymentIntentId == null && order.stripeChargeId == null && order.capturedCardCents == null :
      mixed ? wallet > 0 && wallet < total! : wallet === 0 && (order.paidVia == null || order.paidVia === 'card'));
  const walletProof = order.walletPayment;
  const walletReceipt = order.paidVia !== 'wallet' || walletProof?.schemaVersion === 1 && walletProof.state === 'committed' &&
    walletProof.actorUid === order.buyerId && walletProof.amountCents === wallet && walletProof.currency === 'CAD' &&
    native(walletProof.committedAt, now) && walletProof.ledgerId === debits[0]?.id;
  const walletQualified = split && wallet > 0 && buyer.complete && oneEffect(debits, wallet, transactionId, now) &&
    native(order.paidAt, now) && walletReceipt;
  // A local capture needs the native PI, charge, exact split and recorded
  // captured cents. status='paid' or a planned PI alone is never evidence.
  const cardQualified = split && uniquePayment && wallet < total! && /^pi_[A-Za-z0-9_]{1,190}$/.test(order.stripePaymentIntentId ?? '') &&
    /^ch_[A-Za-z0-9_]{1,190}$/.test(order.stripeChargeId ?? '') && order.capturedCardCents === total! - wallet &&
    native(order.paidAt, now) && (wallet === 0 ? buyer.complete && debits.length === 0 : walletQualified);
  const credits = seller.rows.filter(r => r.data.type === 'sale_credit');
  const debts = seller.rows.filter(r => r.data.type === 'debt_repayment' && r.data.description === 'Vente — régularisation du solde dû');
  const pendingCredit = credits.length === 1 ? credits[0].data.amount : credits.length === 0 ? 0 : NaN;
  const debt = debts.length === 1 ? debts[0].data.amount : debts.length === 0 ? 0 : NaN;
  const creditQualified = orderQualified && seller.complete && cents(pendingCredit) && cents(debt) &&
    exactRows([...credits, ...debts], transactionId, now) && credits.length + debts.length > 0 &&
    pendingCredit + debt === gross && order.sellerCreditedCents === gross &&
    order.sellerPendingCreditCents === pendingCredit && order.sellerDebtRepaidCents === debt;
  const releases = seller.rows.filter(r => r.data.type === 'funds_released' || r.data.type === 'sale_released');
  const releaseQualified = creditQualified && cents(order.sellerReleasedCents) && order.sellerReleasedCents <= gross! &&
    native(order.fundsReleasedAt, now) && oneEffect(releases, order.sellerReleasedCents, transactionId, now) &&
    releases[0].data.type === 'funds_released' && releases[0].data.createdAt.isEqual(order.fundsReleasedAt);
  const refund = order.refund, refundSource = refund && qualifiedRefundNoticeSource(order, refund);
  const refundCredits = buyer.rows.filter(r => r.data.type === 'refund_credit');
  const refundDebits = seller.rows.filter(r => r.data.type === 'refund_debit');
  // The latest fragment is NOT the history of negotiated refunds. Keep it
  // unknown rather than summing intentions or presenting a last fragment total.
  const refundQualified = orderQualified && !order.refundAllocationState && !refund?.allocation && refundSource &&
    refund.state === 'succeeded' && native(refund.fundsAppliedAt, now) && refund.outstandingCardCents === 0 &&
    native(refund.requestedAt, now) && refund.requestedAt.toMillis() <= refund.fundsAppliedAt.toMillis() &&
    refund.requestedAtMs === refund.requestedAt.toMillis() && refund.cardAmountCents + refund.walletAmountCents === total &&
    buyer.complete && seller.complete && (refund.walletAmountCents === 0 ? refundCredits.length === 0 : walletQualified && refund.walletAmountCents === wallet &&
      oneEffect(refundCredits, refund.walletAmountCents, transactionId, now) && refundCredits[0].id === `refund_credit_${refund.intentId}` &&
      refundCredits[0].data.refundIntentId === refund.intentId && refundCredits[0].data.createdAt.isEqual(refund.fundsAppliedAt)) &&
    (refund.sellerDebitCents === 0 ? refundDebits.length === 0 : creditQualified && refund.sellerDebitCents === gross &&
      refundDebits.length === 1 && exactRows(refundDebits, transactionId, now) &&
      refundDebits[0].id === `refund_debit_${refund.intentId}` && refundDebits[0].data.refundIntentId === refund.intentId &&
      cents(refundDebits[0].data.debtRecorded) && refundDebits[0].data.amount + refundDebits[0].data.debtRecorded === refund.sellerDebitCents &&
      refundDebits[0].data.createdAt.isEqual(refund.fundsAppliedAt)) &&
    (refund.cardAmountCents === 0 ? refund.paymentIntentId == null : cardQualified &&
      refund.paymentIntentId === order.stripePaymentIntentId && refund.cardAmountCents === order.capturedCardCents &&
      refund.stripeRefundId === order.stripeRefundId && /^re_[A-Za-z0-9_]{1,190}$/.test(refund.stripeRefundId ?? ''));
  const refundReason = order.refundAllocationState || refund?.allocation ? 'refund_fragment_not_complete_history' : 'native_refund_effect_unqualified';
  return {amounts: {
    orderTotal: orderQualified ? money(total!, 'native_order_amount') : unqualified('native_order_amounts_unqualified'),
    articlePrice: orderQualified ? money(article!, 'native_order_amount') : unqualified('native_order_amounts_unqualified'),
    sellerGross: orderQualified ? money(gross!, 'native_order_amount') : unqualified('native_order_amounts_unqualified'),
    cardCaptured: cardQualified ? money(order.capturedCardCents, 'native_recorded_effect') : unqualified('native_card_capture_unqualified'),
    walletDebited: walletQualified ? money(wallet, 'native_recorded_effect') : unqualified('native_wallet_debit_unqualified'),
    // The gross original credit includes its debt allocation. Release is a
    // later movement of those same funds: these fields must never be added.
    sellerCredit: creditQualified ? money(gross!, 'native_recorded_effect') : unqualified('native_original_seller_credit_unqualified'),
    release: releaseQualified ? money(order.sellerReleasedCents, 'native_recorded_effect') : unqualified('native_release_unqualified'),
    nativeRefund: {total: refundQualified ? money(total!, 'native_recorded_effect') : unqualified(refundReason),
      card: refundQualified ? money(refund.cardAmountCents, 'native_recorded_effect') : unqualified(refundReason),
      wallet: refundQualified ? money(refund.walletAmountCents, 'native_recorded_effect') : unqualified(refundReason)}},
    paidAt: clock(cardQualified || walletQualified ? order.paidAt : null, now, 'native_payment_effect_unqualified'),
    releasedAt: clock(releaseQualified ? order.fundsReleasedAt : null, now, 'native_release_unqualified')};
}

/** Shared native read phase. No permission is inferred from sellerId: callers
 * must derive it from an authorised native anchor before invoking this helper. */
export async function readSellerActivitySellerPage(tx: FirebaseFirestore.Transaction, sellerId: string,
  scopeHash: string, afterId: string | null, readAt = Timestamp.now()) {
  const now = readAt.toMillis();
  const profileSnap = await tx.get(db.collection('users').doc(sellerId)), profileData = profileSnap.data();
  // users.createdAt is an immutable recorded profile field, not Auth creation.
  const profile = {source: {revision: supportRevision(profileSnap), sourceHash: supportSourceHash(profileData ?? null)},
    recordedCreatedAt: clock(profileData?.createdAt, now), authCreatedAt: {qualification: 'unknown', at: null, reason: 'auth_creation_not_read'}};
  // Document order retains missing/legacy dates. No period filter silently
  // drops unknown rows; an inspected legacy row stays explicit as unknown.
  let query = db.collection('transactions').where('sellerId', '==', sellerId).orderBy('__name__');
  if (afterId) query = query.startAfter(afterId);
  const page = await tx.get(query.limit(LIMIT)), items = [];
  for (const snap of page.docs) {
    const order = snap.data(), qualified = uidId(order.buyerId) && order.buyerId !== sellerId && order.sellerId === sellerId;
    const buyer = qualified ? await ledger(tx, order.buyerId, snap.id) : null;
    const seller = qualified ? await ledger(tx, sellerId, snap.id) : null;
    const piOrders = qualified && /^pi_[A-Za-z0-9_]{1,190}$/.test(order.stripePaymentIntentId ?? '')
      ? await tx.get(db.collection('transactions').where('stripePaymentIntentId', '==', order.stripePaymentIntentId).limit(2)) : null;
    const facts = buyer && seller ? effects(snap.id, order, buyer, seller, now, piOrders?.size === 1 && piOrders.docs[0].id === snap.id) : effects(snap.id, {},
      {rows: [], complete: false, public: {inspected: 0, limit: LIMIT, hasMore: false, sources: []}},
      {rows: [], complete: false, public: {inspected: 0, limit: LIMIT, hasMore: false, sources: []}}, now, false);
    items.push({transactionId: snap.id, qualification: qualified ? 'native_order' : 'unknown',
      source: {revision: supportRevision(snap), sourceHash: supportSourceHash(order)},
      recordedStatus: statuses.has(order.status) ? order.status : null, createdAt: clock(order.createdAt, now), ...facts,
      financialSources: {buyerLedger: buyer?.public ?? null, sellerLedger: seller?.public ?? null}});
  }
  // A full page means another page MAY exist. Its cursor always names the
  // last INSPECTED document; an eventual empty page ends this bounded scan.
  const hasMore = page.size === LIMIT, lastId = page.docs[page.size - 1]?.id ?? null;
  const pagination = {inspected: page.size, limit: LIMIT, hasMore,
    nextCursor: hasMore ? {lastId: lastId!, scopeHash: scopeHash} : null};
  const coverage = {source: 'native_transactions_for_seller', order: 'document_id', chronologicalOrderVerified: false,
    exhaustiveHistoryVerified: false, accountingSnapshot: false, globalTotalsProvided: false,
    firstInspectedId: page.docs[0]?.id ?? null, lastInspectedId: lastId, afterId: afterId ?? null};
  return {profile, items, pagination, coverage};
}

/** Read-only TX, private role and native Auth/cutoff checked on every retry.
 * The caller selects an ORDER, never an authoritative seller UID. */
export async function readSellerActivityFacts(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data,
    ['mode', 'capability', 'expectedUid', 'expectedAdminUid', 'transactionId', 'expectedSource', 'cursor']);
  if (raw.mode !== 'seller_activity_facts_observe' || raw.capability !== 'seller_activity_facts_v1')
    throw new HttpsError('invalid-argument', 'Version du lecteur requise.');
  if (!uidId(uid) || raw.expectedAdminUid !== uid) throw new HttpsError('permission-denied', 'La session administrative a changé.');
  const transactionId = supportId(raw.transactionId), expected = raw.expectedSource == null ? null : sourceInput(raw.expectedSource);
  const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId', 'scopeHash']);
  if (cursor && (!docId(cursor.lastId) || !hash(cursor.scopeHash) || !expected || cursor.scopeHash !== expected.scopeHash))
    throw new HttpsError('invalid-argument', 'Le curseur exige le contexte sélectionné.');
  return withPrivateAccountSession(request, async () => {
    const result = await db.runTransaction(async tx => {
      const session = await assertPrivateAccountSession(request, tx); await supportAdmin(tx, uid, session.currentAdminClaim);
      assertRecentAccountAuthentication(request.auth.token);
      await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
      const readAt = Timestamp.now();
      const anchorSnap = await tx.get(db.collection('transactions').doc(transactionId)), anchor = anchorSnap.data();
      if (!anchor || !uidId(anchor.sellerId) || !uidId(anchor.buyerId) || anchor.buyerId === anchor.sellerId || !supportRevision(anchorSnap))
        throw new HttpsError('permission-denied', 'Commande native non qualifiée.');
      const base = {transactionId, sellerId: anchor.sellerId, orderRevision: supportRevision(anchorSnap)!, orderSourceHash: supportSourceHash(anchor)};
      const source = {...base, scopeHash: supportSourceHash({protocol: 'seller_activity_facts_v1', actorId: uid, ...base})};
      if (expected && Object.keys(source).some(k => expected[k] !== source[k as keyof typeof source]) || cursor && cursor.scopeHash !== source.scopeHash) throw fail();
      const {profile, items, pagination, coverage} = await readSellerActivitySellerPage(tx, anchor.sellerId,
        source.scopeHash, cursor?.lastId ?? null, readAt);
      return {protocol: 'seller_activity_facts_v1', actorId: uid, anchorTransactionId: transactionId, sellerId: anchor.sellerId,
        readAt: readAt.toDate().toISOString(), source, profile, items, pagination, coverage,
        pageHash: supportSourceHash({source, profile, items, pagination, coverage, readAt}), ...noAuthority};
    });
    await db.runTransaction(async tx => {const session = await assertPrivateAccountSession(request, tx); await supportAdmin(tx, uid, session.currentAdminClaim);});
    return result;
  });
}
