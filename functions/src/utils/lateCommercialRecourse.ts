/** Native support-to-product admission. Never a finding of liability or a money effect. */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { supportUid, supportObject, supportId, supportRequestId, supportHash, supportSourceHash, supportRevision, supportText, supportAdmin, supportCurrentAdminSession } from './supportRequest';
import {projectSupportConfidential} from './supportConfidentiality';
import { readProductReviewSource, productReviewCaseId, productReviewCaseRef } from './productReviewSource';
import { readProductReviewContributionProof } from './productReviewContributions';
import { readProductReviewDocumentarySet } from './productReviewWorkflow';
import { assertAccountSecurityOpen, assertRecentAccountAuthentication } from './eligibility';
import {assertStoredAccountSecuritySession} from './storedAccountSecuritySession';
import { prepareOperationalNotices, readOperationalNoticeReceipts } from './notifications';
import { checkRateLimit } from './rateLimit';
import {COMMERCIAL_CLAIM_REVIEW_CAPABILITY, COMMERCIAL_CLAIM_REVIEW_ENABLED, parseClaimReviewReference, readClaimReexaminationBasis} from './commercialClaimReview';
export const LATE_COMMERCIAL_CAPABILITY = 'late_commercial_recourse_v1';
export const LATE_COMMERCIAL_ENABLED: boolean = true;
const effects = { financialEffectAuthorized: false, fundsRecovered: false, faultEstablished: false,
    defectVerified: false, legalDeadlineExtended: false, inventoryPermissionGranted: false } as const;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
type Topic = 'authenticity' | 'nonconformity';
export type LateCommercialReference = {
    capability: typeof LATE_COMMERCIAL_CAPABILITY;
    admissionId: string;
    contentHash: string;
};
export type LateCommercialLink = {
    protocol: 'late_commercial_support_link_v1';
    transactionId: string;
    caseId: string;
    topic: Topic;
    contributionId: string;
    contributionHash: string;
    sourceHash: string;
    materialCapability?: 'product_review_material_v1';
    parcelCapability?: 'product_review_parcel_v1';
};
const lateClaimId = (ticket: any, id: string, transactionId: string) => 'late_' + supportHash([ticket.clockOriginSupportRequestId ?? id, transactionId]);
export function lateCommercialSupportView(ticket: any) {
    let link: LateCommercialLink | null = null;
    try {
        link = linkInput(ticket.lateCommercial);
    }
    catch { /* Malformed history remains unknown. */ }
    const origin = ticket.lateCommercialOrigin;
    if (origin?.protocol !== 'late_commercial_support_origin_v1' || origin.ownerId !== ticket.ownerId || !native(origin.recordedAt) ||
        !Number.isSafeInteger(origin.ticketVersion) || origin.ticketVersion < 1 || origin.ticketVersion > ticket.version || !hash(origin.payloadHash))
        link = null;
    return { link, qualification: link ? 'native_support_link' : 'unknown', admissionGranted: false, financialEffectAuthorized: false };
}
export function parseLateCommercialReference(value: unknown): LateCommercialReference {
    const r = supportObject(value, ['capability', 'admissionId', 'contentHash']);
    if (r.capability !== LATE_COMMERCIAL_CAPABILITY || !/^lc_[a-f0-9]{64}$/.test(r.admissionId ?? '') || !hash(r.contentHash))
        throw new HttpsError('invalid-argument', 'Référence exacte de l’admission tardive requise.');
    return { capability: LATE_COMMERCIAL_CAPABILITY, admissionId: r.admissionId, contentHash: r.contentHash };
}
function linkInput(value: unknown): LateCommercialLink {
    const r = supportObject(value, ['protocol', 'transactionId', 'caseId', 'topic', 'contributionId', 'contributionHash', 'sourceHash', 'materialCapability', 'parcelCapability']);
    if (r.protocol !== 'late_commercial_support_link_v1' || !/^pr_[a-f0-9]{64}$/.test(r.caseId ?? '') || !['authenticity', 'nonconformity'].includes(r.topic) ||
        !/^pc_[a-f0-9]{64}$/.test(r.contributionId ?? '') || !hash(r.contributionHash) || !hash(r.sourceHash) ||
        r.materialCapability !== undefined && r.materialCapability !== 'product_review_material_v1' || r.topic === 'nonconformity' && !r.materialCapability ||
        r.parcelCapability !== undefined && r.parcelCapability !== 'product_review_parcel_v1')
        throw new HttpsError('invalid-argument', 'Lien natif au constat de l’article requis.');
    return { protocol: r.protocol, transactionId: supportId(r.transactionId), caseId: r.caseId, topic: r.topic,
        contributionId: r.contributionId, contributionHash: r.contributionHash, sourceHash: r.sourceHash,
        ...(r.materialCapability ? { materialCapability: 'product_review_material_v1' as const } : {}), ...(r.parcelCapability ? { parcelCapability: 'product_review_parcel_v1' as const } : {}) };
}
export const parseLateCommercialLink = linkInput;
async function linkSource(tx: FirebaseFirestore.Transaction, uid: string, transactionId: string, contributionId: string, topic: Topic, material: boolean, parcel: boolean) {
    const context = { kind: 'order' as const, id: transactionId }, source = await readProductReviewSource(tx, context, material, parcel);
    if (source.document.nativeActors.buyerId !== uid)
        throw new HttpsError('permission-denied', 'Ce constat doit provenir de l’acheteur natif.');
    const row = await tx.get(productReviewCaseRef(context).collection('contributions').doc(contributionId));
    const proof = await readProductReviewContributionProof(tx, context, row.id, row.data());
    if (!proof || proof.actorId !== uid || proof.actorRole !== 'buyer' || proof.topic !== topic || topic === 'nonconformity' && !proof.command.materialStatement)
        throw new HttpsError('failed-precondition', 'Contribution native acheteur non qualifiée.');
    return { protocol: 'late_commercial_support_link_v1' as const, transactionId, caseId: source.caseId, topic,
        contributionId, contributionHash: row.data()!.contentHash as string, sourceHash: source.sourceHash,
        ...(material ? { materialCapability: 'product_review_material_v1' as const } : {}), ...(parcel ? { parcelCapability: 'product_review_parcel_v1' as const } : {}) };
}
/** Called during the existing support TX, before its ticket/receipt writes. */
export async function prepareLateCommercialSupportLink(tx: FirebaseFirestore.Transaction, id: string, record: any, uid: string, requestId: string, payloadHash: string, value: unknown) {
    if (value === undefined)
        return null;
    if (!LATE_COMMERCIAL_ENABLED)
        throw new HttpsError('failed-precondition', 'L’examen commercial tardif est en préparation.', { reason: 'late_commercial_recourse_not_exposed' });
    const link = linkInput(value);
    if (record.kind !== 'commercial_late' || record.transactionId !== link.transactionId || record.ownerId !== uid || record.meetupReason || record.lateTransport || record.returnToSender)
        throw new HttpsError('invalid-argument', 'Le ticket commercial et la commande doivent correspondre au constat.');
    const current = await linkSource(tx, uid, link.transactionId, link.contributionId, link.topic, link.materialCapability === 'product_review_material_v1', link.parcelCapability === 'product_review_parcel_v1');
    if (supportHash(link) !== supportHash(current))
        throw new HttpsError('failed-precondition', 'Relisez le constat avant de le joindre au support.');
    return { lateCommercial: link, lateCommercialOrigin: { protocol: 'late_commercial_support_origin_v1', supportRequestId: id,
            ownerId: uid, requestId, payloadHash, ticketVersion: record.version, recordedAt: Timestamp.now() } };
}
type Set = Awaited<ReturnType<typeof readProductReviewDocumentarySet>>;
const membersHash = (s: Set) => supportSourceHash({ contributions: s.manifest.contributions, communications: s.manifest.communications,
    evidence: s.manifest.evidence, intents: s.manifest.intents, lookahead: s.manifest.lookahead,
    documentaryComplete: s.documentaryComplete, ...('parcelReview' in s.manifest ? { parcelReview: s.manifest.parcelReview } : {}) });
const transactionRef = (id: string) => db.collection('transactions').doc(id);
const entryRef = (id: string, eid: string) => transactionRef(id).collection('late_commercial_admissions').doc(eid);
const commandRef = (id: string, uid: string, rid: string) => transactionRef(id).collection('late_commercial_commands').doc(supportHash([uid, rid]));
const admissionId = (uid: string, rid: string) => 'lc_' + supportHash([uid, rid]);
async function currentBasis(tx: FirebaseFirestore.Transaction, transactionId: string, supportRequestId: string, suppliedSet?: Set) {
    const orderSnap = await tx.get(transactionRef(transactionId)), order = orderSnap.data();
    const ticketSnap = await tx.get(db.collection('support_requests').doc(supportRequestId)), ticket = ticketSnap.data();
    if (!order || !ticket || ticket.schemaVersion !== 1 || ticket.kind !== 'commercial_late' || ticket.transactionId !== transactionId ||
        ticket.ownerId !== order.buyerId || order.buyerId === order.sellerId || typeof order.sellerId !== 'string' ||
        !Number.isSafeInteger(ticket.version) || !Number.isSafeInteger(ticket.receivedAtMs) || ticket.receivedAtMs < 1 || ticket.receivedAtMs > Date.now() ||
        order.cashAgreement || order.swapId || order.paidVia === 'cash')
        throw new HttpsError('failed-precondition', 'Parties, paiement et ticket natifs à rapprocher.');
    const link = linkInput(ticket.lateCommercial), origin = ticket.lateCommercialOrigin;
    if (link.transactionId !== transactionId || link.caseId !== productReviewCaseId({ kind: 'order', id: transactionId }) ||
        origin?.protocol !== 'late_commercial_support_origin_v1' || origin.supportRequestId !== supportRequestId || origin.ownerId !== order.buyerId ||
        !native(origin.recordedAt) || !Number.isSafeInteger(origin.ticketVersion) || origin.ticketVersion > ticket.version || !hash(origin.payloadHash))
        throw new HttpsError('failed-precondition', 'Origine native du ticket non qualifiée.');
    const receipt = (await tx.get(ticketSnap.ref.collection('commands').doc(supportHash([origin.ownerId, origin.requestId])))).data();
    if (receipt?.protocol !== 'support_command_v1' || receipt.actorId !== order.buyerId || receipt.ownerId !== order.buyerId || receipt.state !== 'committed' ||
        receipt.payloadHash !== origin.payloadHash || supportHash(receipt.command) !== origin.payloadHash || receipt.resultVersion !== origin.ticketVersion ||
        receipt.supportRequestId !== supportRequestId || supportHash(receipt.command.lateCommercial) !== supportHash(link))
        throw new HttpsError('failed-precondition', 'Le vrai reçu du lien support doit être retrouvé.');
    const set = suppliedSet ?? await readProductReviewDocumentarySet(tx, { kind: 'order', id: transactionId }, link.materialCapability === 'product_review_material_v1', link.parcelCapability === 'product_review_parcel_v1');
    const selected = set.contributionRows.find(c => c.id === link.contributionId);
    if (!selected?.proof || selected.contentHash !== link.contributionHash || selected.proof.actorId !== order.buyerId || selected.proof.topic !== link.topic ||
        set.source.document.nativeActors.buyerId !== order.buyerId || set.source.document.nativeActors.sellerId !== order.sellerId)
        throw new HttpsError('failed-precondition', 'Le constat et ses acteurs doivent être rapprochés.');
    const ledger = await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
    const releases = ledger.docs.filter(r => r.data().type === 'funds_released'), releaseQualified = ledger.size <= 100 && native(order.fundsReleasedAt) && releases.length > 0 &&
        releases.every(r => Number.isSafeInteger(r.data().amount) && r.data().amount >= 0 && native(r.data().createdAt));
    const currencyQualified = typeof order.currency === 'string' && order.currency.toUpperCase() === 'CAD';
    const releasedAmount = releaseQualified && currencyQualified ? releases.reduce((n, r) => n + r.data().amount, 0) : null;
    const releaseAmountQualified = releasedAmount !== null && Number.isSafeInteger(releasedAmount) &&
        Number.isSafeInteger(order.sellerCreditedCents) && order.sellerCreditedCents >= 0 && releasedAmount <= order.sellerCreditedCents;
    const financialSituation = { releaseQualification: releaseAmountQualified ? 'native_release_movement' : 'unknown',
        releasedAt: native(order.fundsReleasedAt) ? order.fundsReleasedAt.toDate().toISOString() : null,
        releasedAmountCents: releaseAmountQualified ? releasedAmount : null,
        currency: currencyQualified ? 'CAD' : null, amountBasis: 'historical_release_movement', currentHeldAmountCents: null, currentAvailableAmountCents: null,
        withdrawalAttribution: 'unknown', bankReceiptVerified: false };
    const capture = { protocol: 'late_commercial_source_v1', transactionId, supportRequestId, buyerId: order.buyerId, sellerId: order.sellerId,
        ticketRevision: supportRevision(ticketSnap), ticketSourceHash: supportSourceHash(ticket), ticketVersion: ticket.version,
        initialReceivedAtMs: ticket.receivedAtMs, clockOriginSupportRequestId: ticket.clockOriginSupportRequestId ?? supportRequestId,
        discoveryDeclaredAt: ticket.discoveredAt ?? null, link, caseVersion: set.root?.version ?? null, caseHash: supportSourceHash(set.root ?? null),
        membersHash: membersHash(set), ledgerCoverage: ledger.size <= 100 ? 'bounded_complete' : 'unknown',
        // Only the attributed RELEASE observation is an intake fact. The engine's
        // later refund_hold is a reservation, not a new release or bank receipt.
        ledgerHash: supportSourceHash(releases.map(r => [r.id, r.data()])), ledgerHashBasis: 'attributed_release_movements', financialSituation,
        orderSemanticHash: supportSourceHash(Object.fromEntries(['buyerId', 'sellerId', 'articleId', 'articleSnapshot', 'paidVia', 'totalAmount', 'currency',
            'walletAmountUsed', 'capturedCardCents', 'stripePaymentIntentId', 'sellerCreditedCents', 'paidAt', 'fundsReleasedAt', 'deliveryCorrection']
            .map(key => [key, order[key] ?? null]))) };
    return { order, ticket, link, set, capture, sourceHash: supportSourceHash(capture) };
}
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
    await supportCurrentAdminSession(request);
    await supportAdmin(tx, uid, false);
    assertRecentAccountAuthentication(request.auth.token);
    await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
    return { actorId: uid, authTime: request.auth.token.auth_time, currentAuthorityQualified: true };
}
const notices = (id: string, eid: string, contentHash: string, buyer: string, seller: string, originalDisputeId?:string) => [buyer, seller].map(userId => ({
    eventKey: `late_commercial_recourse_v1:${eid}`, userId, type: originalDisputeId ? 'order_moderation' : 'product_review_update', title: 'Réclamation commerciale à examiner',
    message: 'Une instruction motivée est enregistrée pour cette réclamation tardive. Elle ne prouve ni défaut ni remboursement et ne reprend aucun fonds.',
    data: { ownerId: userId, transactionId: id, productReviewCaseId: productReviewCaseId({ kind: 'order', id }), contextKind: 'order', contextId: id,
        ...(originalDisputeId ? {commercialClaimReviewCapability:COMMERCIAL_CLAIM_REVIEW_CAPABILITY,originalDisputeId} :
          {lateCommercialAdmissionId: eid, lateCommercialAdmissionHash: contentHash, lateCommercialCapability: LATE_COMMERCIAL_CAPABILITY}) }
}));
async function proof(tx: FirebaseFirestore.Transaction, id: string, ref: LateCommercialReference) {
    const raw = (await tx.get(entryRef(id, ref.admissionId))).data(), d = raw?.document;
    if (raw?.protocol !== 'late_commercial_admission_v1' || !d || d.protocol !== raw.protocol || raw.contentHash !== ref.contentHash ||
        supportSourceHash(d) !== ref.contentHash || d.transactionId !== id || d.admissionId !== ref.admissionId || !native(d.recordedAt) ||
        ref.admissionId !== admissionId(d.actorId, d.requestId) || d.payloadHash !== supportHash(d.command) ||
        d.authority?.actorId !== d.actorId || d.authority.currentAuthorityQualified !== true || !Number.isSafeInteger(d.authority.authTime) || d.authority.authTime < 1 || d.authority.authTime * 1000 > d.recordedAt.toMillis() ||
        Object.entries(effects).some(([k, v]) => d[k] !== v) || !hash(d.sourceHash) || supportSourceHash(d.capture) !== d.sourceHash)
        return null;
    const r = (await tx.get(commandRef(id, d.actorId, d.requestId))).data();
    if (r?.protocol !== 'late_commercial_command_v1' || r.actorId !== d.actorId || r.requestId !== d.requestId || r.state !== 'committed' ||
        r.payloadHash !== d.payloadHash || supportHash(r.command) !== d.payloadHash || supportHash(r.reference) !== supportHash(ref) || !native(r.recordedAt) || !r.recordedAt.isEqual(d.recordedAt))
        return null;
    const n = await readOperationalNoticeReceipts(tx, notices(id, d.admissionId, ref.contentHash, d.capture.buyerId, d.capture.sellerId,d.command.claimReexamination ? d.capture.claimId : undefined));
    if (n.some((v, i) => !v || v.notificationId !== r.notificationIds?.[i]))
        return null;
    return { ...d, notificationIds: r.notificationIds };
}
/** Historical intake proof only; current permission is qualified separately. */
export const readLateCommercialAdmissionProof = proof;
export async function readLateCommercialFinancialBasis(tx: FirebaseFirestore.Transaction, id: string, order: any, claim: any, raw: LateCommercialReference, set: Set, originalDisputeId?:string) {
    if (!LATE_COMMERCIAL_ENABLED)
        throw new HttpsError('failed-precondition', 'Examen tardif en préparation.');
    const ref = parseLateCommercialReference(raw), d = await proof(tx, id, ref);
    if (!d || d.command.decision !== 'admit_examination' || (d.command.claimReexamination ? !COMMERCIAL_CLAIM_REVIEW_ENABLED || d.capture.claimId!==originalDisputeId : claim.source !== 'late_commercial_support') ||
        (d.command.claimReexamination || Object.prototype.hasOwnProperty.call(claim.lateCommercial ?? {}, 'decision')) && claim.lateCommercial?.decision !== 'admit_examination' ||
        supportHash(claim.lateCommercial?.reference) !== supportHash(ref) || claim.buyerId !== order.buyerId || claim.sellerId !== order.sellerId)
        throw new HttpsError('failed-precondition', 'Admission native exacte requise.');
    const current = d.command.claimReexamination ? await readClaimReexaminationBasis(tx,id,d.command.claimReexamination,set,
      {...d,appliedLateCommercial:{reference:ref,supportRequestId:null,sourceHash:d.sourceHash,decision:d.command.decision,claimReexamination:d.command.claimReexamination}}) :
      await currentBasis(tx, id, d.command.supportRequestId, set);
    if (current.sourceHash !== d.sourceHash || current.link.topic !== claim.productReview?.topic ||
        supportHash(claim.productReview) !== supportHash(current.link))
        throw new HttpsError('failed-precondition', 'L’admission tardive doit être renouvelée sur les sources actuelles.');
    try {
        const session = await assertStoredAccountSecuritySession(tx, d.actorId, d.authority.authTime);
        await supportAdmin(tx, d.actorId, session.currentAdminClaim);
    }
    catch (error) {
        // A revoked admission blocks NEW authority. During real-effect
        // servicing it is a stale source, not a veto of money already moved.
        if (error instanceof HttpsError && ['permission-denied', 'failed-precondition'].includes(error.code) ||
            (error as {code?: string})?.code === 'auth/user-not-found')
            throw new HttpsError('failed-precondition', 'L’autorité native de cette admission doit être réexaminée.');
        throw error;
    }
    return { reference: ref, sourceHash: d.sourceHash, initialReceivedAtMs: current.capture.initialReceivedAtMs, financialSituation: current.capture.financialSituation };
}
function entryView(d: any, ref: LateCommercialReference, admin = false) {
    return { reference: ref, decision: d.command.decision, partyMessage: d.command.partyMessage,
        ...(admin ? { reason: d.command.reason } : {}), supportRequestId: d.command.supportRequestId, caseId: d.capture.link.caseId, topic: d.capture.link.topic,
        contributionReference: { id: d.capture.link.contributionId, contentHash: d.capture.link.contributionHash },
        initialReceivedAt: new Date(d.capture.initialReceivedAtMs).toISOString(), recordedAt: d.recordedAt.toDate().toISOString(), historicalOnly: true,
        ...(d.command.claimReexamination ? {claimReexamination:d.command.claimReexamination,originalDisputeId:d.capture.claimId} : {}),...effects };
}
export async function lateCommercialRecourse(request: any) {
    const uid = supportUid(request), r = supportObject(request.data, ['expectedUid', 'capability', 'mode', 'transactionId', 'contributionId', 'topic', 'materialCapability', 'parcelCapability', 'supportRequestId', 'requestId', 'action', 'command', 'scope', 'cursor', 'noticeReference','claimReviewCapability','claimReexamination']);
    if (r.capability !== LATE_COMMERCIAL_CAPABILITY)
        throw new HttpsError('invalid-argument', 'Version du recours tardif requise.');
    const claimReview=r.claimReviewCapability===COMMERCIAL_CLAIM_REVIEW_CAPABILITY;
    if (r.claimReviewCapability!==undefined && !claimReview || r.claimReexamination!==undefined && !claimReview)
        throw new HttpsError('invalid-argument','Version explicite du réexamen requise.');
    if (r.mode === 'command') {
        const requestId = supportRequestId(r.requestId), command = supportObject(r.command, ['transactionId', 'supportRequestId', 'sourceHash', 'currentAdmission', 'decision', 'reason', 'partyMessage', 'acknowledged',...(claimReview ? ['claimReexamination'] : [])]);
        command.transactionId = supportId(command.transactionId);
        if (claimReview) {
            command.claimReexamination=parseClaimReviewReference(command.claimReexamination);
            if(command.supportRequestId!==null) throw new HttpsError('invalid-argument','Le réexamen cible la plainte originale, pas un ticket.');
        } else command.supportRequestId = supportId(command.supportRequestId);
        if (!hash(command.sourceHash) || !['admit_examination', 'retain_review', 'refuse_admission'].includes(command.decision) || command.acknowledged !== true || !['execute', 'observe', 'neutralize'].includes(r.action))
            throw new HttpsError('invalid-argument', 'Instruction exacte requise.');
        command.reason = supportText(command.reason, 'Motivation', 4000);
        command.partyMessage = supportText(command.partyMessage, 'Message aux deux parties', 4000);
        command.currentAdmission = command.currentAdmission === null ? null : parseLateCommercialReference(command.currentAdmission);
        const ref = commandRef(command.transactionId, uid, requestId), payloadHash = supportHash(command), eid = admissionId(uid, requestId);
        if (r.action === 'execute' && !(await ref.get()).exists)
            await checkRateLimit(uid, true, { functionName: 'lateCommercialRecourse', maxCallsAuthenticated: 10, maxCallsUnauthenticated: 0, windowMs: 60000 });
        return db.runTransaction(async (tx) => {
            const previous = (await tx.get(ref)).data();
            const view = (d?: any) => ({ protocol: 'late_commercial_command_v1', actorId: uid, requestId, command, payloadHash, state: d?.state ?? 'unrecorded', reason: d?.reason ?? null,
                reference: d?.reference ?? null, disputeId: d?.disputeId ?? null, recordedAt: native(d?.recordedAt) ? d.recordedAt.toDate().toISOString() : null, ...effects });
            if (previous) {
                if (previous.protocol !== 'late_commercial_command_v1' || previous.actorId !== uid || previous.requestId !== requestId || previous.payloadHash !== payloadHash || supportHash(previous.command) !== payloadHash || !native(previous.recordedAt) || !['committed', 'not_executed'].includes(previous.state))
                    throw new HttpsError('already-exists', 'Intention différente.');
                if (previous.state === 'committed' && !await proof(tx, command.transactionId, parseLateCommercialReference(previous.reference)))
                    throw new HttpsError('unavailable', 'Reçu à rapprocher.');
                return view(previous);
            }
            if (r.action === 'observe')
                return view();
            const now = Timestamp.now(), noEffect = (reason: string) => { const d = { protocol: 'late_commercial_command_v1', actorId: uid, requestId, command, payloadHash, state: 'not_executed', reason, reference: null, disputeId: null, recordedAt: now }; tx.create(ref, d); return view(d); };
            if (r.action === 'neutralize')
                return noEffect('requester_neutralized');
            if (!LATE_COMMERCIAL_ENABLED)
                return noEffect('late_commercial_recourse_not_exposed');
            if(claimReview && !COMMERCIAL_CLAIM_REVIEW_ENABLED) return noEffect('commercial_claim_review_not_exposed');
            const authority = await operator(tx, request, uid);
            let s:any;
            try {s=claimReview ? await readClaimReexaminationBasis(tx,command.transactionId,command.claimReexamination) : await currentBasis(tx, command.transactionId, command.supportRequestId);}
            catch(e) {if(claimReview && e instanceof HttpsError && e.code==='failed-precondition') return noEffect('claim_reexamination_source_changed');throw e;}
            if (s.sourceHash !== command.sourceHash)
                return noEffect('source_changed');
            if (s.capture.ledgerCoverage !== 'bounded_complete' || claimReview && !s.set.documentaryComplete || s.set.coverage.contributionsHasMore || s.set.coverage.communicationsHasMore || s.set.documentaryCoverage.evidenceHasMore || s.set.documentaryCoverage.intentsHasMore)
                return noEffect('sources_require_review');
            const disputeId = claimReview ? s.originalDisputeId : lateClaimId(s.ticket, command.supportRequestId, command.transactionId), disputeRef = db.collection('disputes').doc(disputeId), old = (await tx.get(disputeRef)).data();
            if (claimReview ? !old || old.buyerId!==s.order.buyerId || old.sellerId!==s.order.sellerId || !['open','resolved'].includes(old.status) :
                old && (old.source !== 'late_commercial_support' || old.buyerId !== s.order.buyerId || old.sellerId !== s.order.sellerId || old.status !== 'open'))
                return noEffect('claim_requires_review');
            if(!claimReview && old?.lateCommercial?.claimReexamination!==undefined) return noEffect('claim_requires_review');
            if (supportHash(old?.lateCommercial?.reference ?? null) !== supportHash(command.currentAdmission))
                return noEffect('admission_source_changed');
            if (old && (!claimReview || Object.prototype.hasOwnProperty.call(old,'lateCommercial'))) {
                let previousAdmission:LateCommercialReference;
                try {previousAdmission=parseLateCommercialReference(old.lateCommercial?.reference);} catch(e) {if(e instanceof HttpsError)return noEffect('claim_requires_review');throw e;}
                if(!await proof(tx,command.transactionId,previousAdmission)) return noEffect('claim_requires_review');
            }
            const dedup = transactionRef(command.transactionId).collection('late_commercial_observations').doc(supportHash([s.sourceHash, command.decision, command.reason, command.partyMessage]));
            if ((await tx.get(dedup)).exists)
                return noEffect('same_admission_already_recorded');
            const document = { protocol: 'late_commercial_admission_v1', admissionId: eid, transactionId: command.transactionId, actorId: uid, requestId, command, payloadHash, authority, capture: s.capture, sourceHash: s.sourceHash, recordedAt: now, ...effects };
            const contentHash = supportSourceHash(document), reference = { capability: LATE_COMMERCIAL_CAPABILITY, admissionId: eid, contentHash };
            if(Buffer.byteLength(JSON.stringify(document),'utf8')>800000) return noEffect('document_capacity_requires_review');
            const notice = await prepareOperationalNotices(tx, notices(command.transactionId, eid, contentHash, s.order.buyerId, s.order.sellerId,claimReview ? disputeId : undefined));
            if ((await tx.get(entryRef(command.transactionId, eid))).exists)
                return noEffect('entry_requires_reconciliation');
            tx.create(entryRef(command.transactionId, eid), { protocol: document.protocol, document, contentHash });
            tx.create(dedup, { reference, recordedAt: now });
            if (claimReview && command.decision === 'admit_examination') {
                // Preserve createdAt, old resolution facts and ALL order/finance fields.
                // This single operator act reopens only the original documentary case.
                tx.update(disputeRef,{status:'open',reviewedAt:now,productReview:s.link,lateCommercial:{reference,supportRequestId:null,
                  sourceHash:s.sourceHash,decision:command.decision,claimReexamination:command.claimReexamination}});
            } else if (claimReview && old?.lateCommercial?.reference) {
                // Supersede the current admission without classifying the case
                // or undoing any genuine financial effect or historical receipt.
                tx.update(disputeRef,{lateCommercial:{reference,supportRequestId:null,sourceHash:s.sourceHash,
                  decision:command.decision,claimReexamination:command.claimReexamination}});
            } else if (!claimReview && (command.decision === 'admit_examination' || old)) {
                const patch = { transactionId: command.transactionId, buyerId: s.order.buyerId, sellerId: s.order.sellerId, articleId: s.order.articleId ?? null,
                    source: 'late_commercial_support', status: 'open', reason: 'late_commercial_examination', productReview: s.link,
                    lateCommercial: { reference, supportRequestId: command.supportRequestId, sourceHash: s.sourceHash, decision: command.decision },
                    ...(!old ? { createdAt: now } : {}) };
                if (old)
                    tx.update(disputeRef, patch);
                else
                    tx.create(disputeRef, patch);
            }
            const result = { protocol: 'late_commercial_command_v1', actorId: uid, requestId, command, payloadHash, state: 'committed', reason: null, reference,
                disputeId: command.decision === 'admit_examination' ? disputeId : null, recordedAt: now, notificationIds: notice.notificationIds };
            tx.create(ref, result);
            notice.commit();
            return view(result);
        });
    }
    if (r.mode === 'source_observe') {
        const id = supportId(r.transactionId);
        if (!['authenticity', 'nonconformity'].includes(r.topic) || !/^pc_[a-f0-9]{64}$/.test(r.contributionId ?? ''))
            throw new HttpsError('invalid-argument', 'Constat natif requis.');
        if (r.materialCapability !== undefined && r.materialCapability !== 'product_review_material_v1' || r.parcelCapability !== undefined && r.parcelCapability !== 'product_review_parcel_v1' || r.topic === 'nonconformity' && !r.materialCapability)
            throw new HttpsError('invalid-argument', 'Versions documentaires explicites requises.');
        return db.runTransaction(async (tx) => ({ protocol: 'late_commercial_link_source_v1', actorId: uid, link: await linkSource(tx, uid, id, r.contributionId, r.topic, r.materialCapability === 'product_review_material_v1', r.parcelCapability === 'product_review_parcel_v1'), newAdmissionAllowed: false, ...effects }));
    }
    if (r.mode === 'preview')
        return db.runTransaction(async (tx) => {
            await operator(tx, request, uid);
            if(claimReview) {
                const claimReexamination=parseClaimReviewReference(r.claimReexamination),s=await readClaimReexaminationBasis(tx,supportId(r.transactionId),claimReexamination);
                const old=s.actual;let currentAdmission:LateCommercialReference|null=null,qualification='unrecorded';
                if(Object.prototype.hasOwnProperty.call(old,'lateCommercial')) {try {currentAdmission=parseLateCommercialReference(old.lateCommercial?.reference);qualification=await proof(tx,r.transactionId,currentAdmission) ? 'native_admission':'unknown';}catch{qualification='unknown';}}
                return {protocol:'commercial_claim_reexamination_preview_v1',actorId:uid,transactionId:r.transactionId,originalDisputeId:s.originalDisputeId,
                  claimReexamination,sourceHash:s.sourceHash,source:s.capture,currentAdmission,currentAdmissionQualification:qualification,
                  options:COMMERCIAL_CLAIM_REVIEW_ENABLED && qualification!=='unknown' ? ['admit_examination','retain_review','refuse_admission'] : [],...effects};
            }
            const supportRequestId = supportId(r.supportRequestId), ticket = (await tx.get(db.collection('support_requests').doc(supportRequestId))).data();
            const s = await currentBasis(tx, supportId(ticket?.transactionId), supportRequestId);
            const claim = (await tx.get(db.collection('disputes').doc(lateClaimId(s.ticket, supportRequestId, s.capture.transactionId)))).data();
            let currentAdmission: LateCommercialReference | null = null, qualification = 'unrecorded';
            if (claim) {
                try {
                    currentAdmission = parseLateCommercialReference(claim.lateCommercial?.reference);
                    qualification = await proof(tx, s.capture.transactionId, currentAdmission) ? 'native_admission' : 'unknown';
                }
                catch {
                    qualification = 'unknown';
                }
                if(claim.lateCommercial?.claimReexamination!==undefined) {currentAdmission=null;qualification='unknown';}
            }
            return { protocol: 'late_commercial_preview_v1', actorId: uid, transactionId: s.capture.transactionId, supportRequestId, sourceHash: s.sourceHash, source: s.capture,
                currentAdmission, currentAdmissionQualification: qualification,
                ticket: projectSupportConfidential({ version: s.ticket.version, narrative: s.ticket.narrative, latestClarification: s.ticket.latestClarification ?? null, discoveredAt: s.ticket.discoveredAt ?? null },s.ticket),
                contributionReferences: s.set.contributionRows.map(c => ({ id: c.id, contentHash: c.contentHash, qualification: c.proof ? 'native_contribution' : 'unknown' })),
                options: LATE_COMMERCIAL_ENABLED && qualification !== 'unknown' ? ['admit_examination', 'retain_review', 'refuse_admission'] : [], ...effects };
        });
    if (r.mode !== 'history_observe' || !['own', 'admin'].includes(r.scope))
        throw new HttpsError('invalid-argument', 'Lecture exacte requise.');
    const id = supportId(r.transactionId), cursor = r.cursor == null ? null : supportObject(r.cursor, ['lastId']).lastId;
    if (cursor !== null && (typeof cursor !== 'string' || Buffer.byteLength(cursor, 'utf8') > 1500 || !cursor || cursor.includes('/')))
        throw new HttpsError('invalid-argument', 'Curseur invalide.');
    return db.runTransaction(async (tx) => {
        const order = (await tx.get(transactionRef(id))).data();
        if (!order)
            throw new HttpsError('not-found', 'Commande indisponible.');
        if (r.scope === 'admin')
            await operator(tx, request, uid);
        else if (![order.buyerId, order.sellerId].includes(uid))
            throw new HttpsError('permission-denied', 'Pas votre commande.');
        let notice = null;
        if (r.noticeReference !== undefined) {
            const n = supportObject(r.noticeReference, ['admissionId', 'contentHash', 'notificationId']), reference = parseLateCommercialReference({ capability: LATE_COMMERCIAL_CAPABILITY, admissionId: n.admissionId, contentHash: n.contentHash });
            if (r.scope !== 'own' || !/^operational_[a-f0-9]{64}$/.test(n.notificationId ?? ''))
                throw new HttpsError('invalid-argument', 'Référence de votre avis requise.');
            const d = await proof(tx, id, reference), position = d?.capture.buyerId === uid ? 0 : d?.capture.sellerId === uid ? 1 : null;
            if (!d || d.command.claimReexamination && !claimReview || position === null || d.notificationIds?.[position] !== n.notificationId)
                throw new HttpsError('permission-denied', 'Avis personnel natif non qualifié.');
            notice = { qualification: 'native_owner_notice', notificationId: n.notificationId, entry: entryView(d, reference) };
        }
        let q: FirebaseFirestore.Query = transactionRef(id).collection('late_commercial_admissions').orderBy('__name__').limit(21);
        if (cursor)
            q = q.startAfter(cursor);
        const page = await tx.get(q), rows = page.docs.slice(0, 20), items = [];
        for (const row of rows) {
            if(row.data().document?.command?.claimReexamination!==undefined && !claimReview) continue;
            const reference: LateCommercialReference = { capability: LATE_COMMERCIAL_CAPABILITY, admissionId: row.id, contentHash: row.data().contentHash }, d = await proof(tx, id, reference);
            if(d?.command.claimReexamination && !claimReview) continue;
            items.push(d && (r.scope === 'admin' || [d.capture.buyerId, d.capture.sellerId].includes(uid)) ? { qualification: 'native_admission', entry: entryView(d, reference, r.scope === 'admin') } : { qualification: 'unknown', entryId: row.id, entry: null });
        }
        return { protocol: 'late_commercial_history_v1', actorId: uid, scope: r.scope, transactionId: id, items, nextCursor: page.size > 20 ? { lastId: rows.at(-1)!.id } : null,
            coverage: { inspected: rows.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false }, ...(r.noticeReference === undefined ? {} : { notice }), ...effects };
    });
}
