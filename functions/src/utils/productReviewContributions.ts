import {productMixedOrdersRequested, assertProductMixedOrdersNewOpen, parseProductMixedOrderStatement, prepareProductMixedOrderSignal, PRODUCT_MIXED_ORDERS_QUALIFICATION, type ProductMixedOrderStatement} from './productMixedOrders';
import {productRoutingRequested, assertProductRoutingNewOpen, parseProductRoutingStatement, prepareProductRoutingSignal, PRODUCT_ROUTING_QUALIFICATION, type ProductRoutingStatement} from './productRoutingReview';
import {productParcelRequested, assertProductParcelNewOpen, parseProductParcelStatement, PRODUCT_PARCEL_REASONS, PRODUCT_PARCEL_MIXED_REASON, PRODUCT_PARCEL_QUALIFICATION, type ProductParcelStatement} from './productReviewParcel';
/** Append-only participant evidence. No issue, payment, stock or transport authority. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {prepareOperationalNotices} from './notifications';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {supportAdmin, supportDeclaredDate, supportHash, supportObject,
  supportRequestId, supportSourceHash, supportText, supportUid} from './supportRequest';
import {PRODUCT_REVIEW_EFFECTS, PRODUCT_REVIEW_TOPICS, productReviewCaseId, productReviewCaseRef,
  productReviewContext, productReviewRoles, productReviewSourceView, readProductReviewSource,
  type ProductReviewContext, type ProductReviewRole, type ProductReviewTopic} from './productReviewSource';
import {parseProductMaterialStatement, productMaterialRequested, assertProductMaterialNewOpen, PRODUCT_MATERIAL_REASONS, PRODUCT_MATERIAL_QUALIFICATION,
  type ProductMaterialStatement} from './productReviewMaterial';

const HASH = /^[a-f0-9]{64}$/;
const FACT_LIMITS = {brand: 300, model: 300, productReference: 300, lot: 300, category: 500, intendedUse: 1000,
  recallReference: 1000, officialSourceDeclared: 1000, childSafetyObservation: 2000, hygieneObservation: 2000,
  conditionObserved: 1000, sealOrUseObservation: 1000, species: 300, provenance: 2000, expertiseSummary: 2000} as const;
type Facts = {[K in keyof typeof FACT_LIMITS]: string | null};
type Command = {context: ProductReviewContext; sourceHash: string; actorRole: ProductReviewRole;
  topic: ProductReviewTopic; statement: string; facts: Facts; observedAt: string | null; materialStatement?: ProductMaterialStatement; parcelStatement?: ProductParcelStatement; routingStatement?: ProductRoutingStatement; mixedOrderStatement?: ProductMixedOrderStatement};
function commandInput(value: unknown): Command {
  const input = supportObject(value, ['context', 'sourceHash', 'actorRole', 'topic', 'statement', 'facts', 'observedAt', 'materialStatement', 'parcelStatement', 'routingStatement', 'mixedOrderStatement']);
  const materialStatement = input.materialStatement === undefined ? null : parseProductMaterialStatement(input.materialStatement);
  const mixedOrderStatement = input.mixedOrderStatement === undefined ? null : parseProductMixedOrderStatement(input.mixedOrderStatement);
  const parcelStatement = input.parcelStatement === undefined ? null : parseProductParcelStatement(input.parcelStatement, mixedOrderStatement !== null);
  const routingStatement = input.routingStatement === undefined ? null : parseProductRoutingStatement(input.routingStatement);
  const context = productReviewContext(input.context);
  if (!HASH.test(input.sourceHash ?? '') || !['buyer', 'seller', 'reporter'].includes(input.actorRole) ||
      (parcelStatement ? materialStatement !== null || input.topic !== 'parcel_delivery' || context.kind !== 'order' || input.actorRole === 'reporter' : materialStatement ? input.topic !== 'nonconformity' || context.kind !== 'order' || input.actorRole === 'reporter' :
        !(PRODUCT_REVIEW_TOPICS as readonly unknown[]).includes(input.topic))) throw new HttpsError('invalid-argument', 'Source, rôle et motif explicites requis.');
  if (materialStatement?.receivedScope === 'return_received' && input.actorRole !== 'seller' ||
      materialStatement?.receivedScope === 'purchase_received' && input.actorRole !== 'buyer')
    throw new HttpsError('invalid-argument', 'La déclaration de réception appartient à sa partie native.');
  if (parcelStatement && parcelStatement.receipt !== 'unknown' && input.actorRole !== (parcelStatement.leg === 'return' ? 'seller' : 'buyer'))
    throw new HttpsError('invalid-argument', 'La réception ou non-réception est déclarée par le destinataire natif.');
  if (routingStatement && (!parcelStatement || routingStatement.leg !== parcelStatement.leg || routingStatement.labelId !== parcelStatement.labelId))
    throw new HttpsError('invalid-argument', 'Le constat de routage doit viser le même trajet et la même étiquette que le constat colis natif.');
  if (mixedOrderStatement && (!parcelStatement || mixedOrderStatement.leg !== parcelStatement.leg || mixedOrderStatement.labelId !== parcelStatement.labelId))
    throw new HttpsError('invalid-argument', 'Le mélange déclaré doit viser le même trajet et la même étiquette que le constat colis.');
  const supplied = supportObject(input.facts, Object.keys(FACT_LIMITS));
  const facts = Object.fromEntries(Object.entries(FACT_LIMITS).map(([key, max]) => [key,
    supplied[key] == null ? null : supportText(supplied[key], 'Information déclarée', max)])) as Facts;
  return {context, sourceHash: input.sourceHash, actorRole: input.actorRole,
    topic: input.topic, statement: supportText(input.statement, 'Déclaration', 4000), facts,
    observedAt: supportDeclaredDate(input.observedAt, Date.now()), ...(materialStatement ? {materialStatement} : {}), ...(parcelStatement ? {parcelStatement} : {}), ...(routingStatement ? {routingStatement} : {}), ...(mixedOrderStatement ? {mixedOrderStatement} : {})};
}
const nativeTime = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const documentId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 &&
  !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const contributionId = (uid: string, requestId: string) => 'pc_' + supportHash([uid, requestId]);
function rootQualified(data: any, context: ProductReviewContext) {
  return data?.protocol === 'product_review_case_v1' && data.caseId === productReviewCaseId(context) &&
    supportHash(data.context) === supportHash(context) && Number.isSafeInteger(data.version) && data.version >= 1 &&
    nativeTime(data.createdAt);
}
export async function readProductReviewContributionProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, id: string, data: any) {
  const d = data?.document;
  if (!d || data.protocol !== 'product_review_contribution_v1' || d.protocol !== data.protocol || data.contributionId !== id ||
      d.contributionId !== id || d.caseId !== productReviewCaseId(context) || supportHash(d.context) !== supportHash(context) ||
      typeof d.actorId !== 'string' || d.actorId.length < 1 || d.actorId.length > 128 || d.actorId.includes('/') ||
      typeof d.requestId !== 'string' || id !== contributionId(d.actorId, d.requestId) ||
      !HASH.test(d.payloadHash ?? '') || supportHash(d.command) !== d.payloadHash || !nativeTime(d.recordedAt) ||
      data.contentHash !== supportSourceHash(d) || !HASH.test(d.sourceHash ?? '') || d.sourceHash !== d.command?.sourceHash ||
      d.actorRole !== d.command?.actorRole || d.topic !== d.command?.topic ||
      d.financialEffectAuthorized !== false || d.inventoryEffectAuthorized !== false || d.physicalContentsVerified !== false) return null;
  let parsed: Command;
  try {parsed = commandInput(d.command);} catch {return null;}
  if (supportHash(parsed) !== d.payloadHash) return null;
  const capture = (await tx.get(productReviewCaseRef(context).collection('source_captures').doc(d.sourceHash))).data();
  if (capture?.protocol !== 'product_review_source_capture_v1' || capture.sourceHash !== d.sourceHash ||
      supportSourceHash(capture.document) !== d.sourceHash || !nativeTime(capture.capturedAt) ||
      capture.document?.nativeActors?.[`${d.actorRole}Id`] !== d.actorId ||
      supportHash(capture.document.context) !== supportHash(context)) return null;
  if (parsed.materialStatement && (!['product_review_source_v3', 'product_review_source_v4'].includes(capture.document.protocol) ||
      capture.document.materialAttributes?.protocol !== 'product_material_sources_v1')) return null;
  if (parsed.parcelStatement && (capture.document.protocol !== 'product_review_source_v4' || capture.document.parcelSources?.protocol !== 'product_parcel_sources_v1')) return null;
  return d;
}
function contributionView(document: any) {
  return {protocol: document.command.parcelStatement ? 'product_review_parcel_contribution_v1' : document.command.materialStatement ? 'product_review_material_contribution_v1' : 'product_review_contribution_v1', contributionId: document.contributionId, actorId: document.actorId,
    actorRole: document.actorRole, topic: document.topic, statement: document.command.statement, facts: document.command.facts,
    observedAt: document.command.observedAt, observedAtQualification: document.command.observedAt === null ? 'unknown' : 'actor_declaration',
    origin: document.actorRole === 'buyer' ? 'received_item_declaration' : document.actorRole === 'seller' ? 'offered_item_declaration' : 'reporter_observation_declaration',
    sourceHash: document.sourceHash, payloadHash: document.payloadHash, recordedAt: document.recordedAt.toDate().toISOString(),
    statementQualification: 'native_actor_declaration', originalsState: 'not_submitted_in_this_contribution',
    officialSourceFetched: false, expertiseVerified: false,
    ...(document.command.materialStatement ? {materialStatement: document.command.materialStatement, ...PRODUCT_MATERIAL_QUALIFICATION} : {}),
    ...(document.command.parcelStatement ? {parcelStatement: document.command.parcelStatement, ...PRODUCT_PARCEL_QUALIFICATION} : {}),
    ...(document.command.routingStatement ? {routingStatement: document.command.routingStatement, ...PRODUCT_ROUTING_QUALIFICATION} : {}),
    ...(document.command.mixedOrderStatement ? {mixedOrderStatement: document.command.mixedOrderStatement, ...PRODUCT_MIXED_ORDERS_QUALIFICATION} : {}), ...PRODUCT_REVIEW_EFFECTS};
}
function receiptView(uid: string, requestId: string, command: Command, receipt?: any) {
  return {protocol: command.parcelStatement ? 'product_review_parcel_command_v1' : command.materialStatement ? 'product_review_material_command_v1' : 'product_review_command_v1', actorId: uid, requestId, payloadHash: supportHash(command),
    caseId: productReviewCaseId(command.context), contributionId: receipt?.contributionId ?? null,
    state: receipt?.state ?? 'unrecorded', reason: receipt?.reason ?? null,
    recordedAt: nativeTime(receipt?.recordedAt) ? receipt.recordedAt.toDate().toISOString() : null,
    currentSourceVerified: false, ...PRODUCT_REVIEW_EFFECTS};
}

export async function previewProductReviewContribution(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'materialCapability', 'parcelCapability', 'routingCapability', 'mixedOrdersCapability']);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw), routing = productRoutingRequested(raw), mixedOrders = productMixedOrdersRequested(raw);
  const context = productReviewContext(raw.context);
  return withPrivateAccountSession(request, () => db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const source = await readProductReviewSource(tx, context, material, parcel);
    if (!productReviewRoles(source, uid).length) throw new HttpsError('permission-denied', 'Ce contexte n’appartient pas à votre compte.');
    if (source.caseSnap.exists && !rootQualified(source.caseSnap.data(), context))
      throw new HttpsError('failed-precondition', 'Le dossier historique doit être rapproché.');
    return {protocol: parcel ? 'product_review_parcel_preview_v1' : material ? 'product_review_material_preview_v1' : 'product_review_preview_v1', source: productReviewSourceView(source, uid),
      topics: parcel ? [...PRODUCT_REVIEW_TOPICS, 'nonconformity', 'parcel_delivery'] : material ? [...PRODUCT_REVIEW_TOPICS, 'nonconformity'] : [...PRODUCT_REVIEW_TOPICS],
      ...(material ? {materialReasons: [...PRODUCT_MATERIAL_REASONS], ...PRODUCT_MATERIAL_QUALIFICATION} : {}),
      ...(parcel ? {parcelReasons: [...PRODUCT_PARCEL_REASONS, ...(mixedOrders ? [PRODUCT_PARCEL_MIXED_REASON] : [])], ...PRODUCT_PARCEL_QUALIFICATION} : {}),
      ...(routing ? {routingCapability: 'product_review_routing_v1', ...PRODUCT_ROUTING_QUALIFICATION} : {}),
      ...(mixedOrders ? {mixedOrdersCapability: 'product_review_mixed_orders_v1', ...PRODUCT_MIXED_ORDERS_QUALIFICATION} : {}),
      factKeys: Object.keys(FACT_LIMITS), contributionPermissionGranted: false,
      receivedItemImagesSupported: false, originalExpertiseUploadSupported: false, ...PRODUCT_REVIEW_EFFECTS};
  }));
}

/** Exact receipt FIRST, including after source/party/profile changes. A
 * neutralization serializes before a late execute and never deletes evidence. */
export async function commandProductReviewContribution(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'requestId', 'action', 'command', 'materialCapability', 'parcelCapability', 'routingCapability', 'mixedOrdersCapability']);
  const requestId = supportRequestId(raw.requestId), command = commandInput(raw.command), payloadHash = supportHash(command);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw), routing = productRoutingRequested(raw), mixedOrders = productMixedOrdersRequested(raw);
  if (command.materialStatement && !material) throw new HttpsError('invalid-argument', 'La déclaration matérielle exige sa capacité explicite.');
  if (command.mixedOrderStatement && !mixedOrders) throw new HttpsError('invalid-argument', 'Le mélange déclaré exige sa capacité explicite.');
  if (command.routingStatement && !routing) throw new HttpsError('invalid-argument', 'Le constat routage exige sa capacité explicite.');
  if (command.parcelStatement && !parcel) throw new HttpsError('invalid-argument', 'Le constat colis exige sa capacité explicite.');
  if (!['execute', 'observe', 'neutralize'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Action de commande invalide.');
  const id = contributionId(uid, requestId), caseRef = productReviewCaseRef(command.context);
  const receiptRef = db.collection('product_review_commands').doc(supportHash([uid, requestId]));
  return withPrivateAccountSession(request, () => db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const receipt = (await tx.get(receiptRef)).data();
    if (receipt) {
      if (receipt.protocol !== 'product_review_command_v1' || receipt.actorId !== uid || receipt.requestId !== requestId ||
          receipt.payloadHash !== payloadHash || supportHash(receipt.command) !== payloadHash ||
          !nativeTime(receipt.recordedAt) || !['committed', 'not_executed'].includes(receipt.state))
        throw new HttpsError('already-exists', 'Cette référence correspond à une autre intention ou à un reçu non qualifié.');
      if (receipt.state === 'committed') {
        const proof = await readProductReviewContributionProof(tx, command.context, id, (await tx.get(caseRef.collection('contributions').doc(id))).data());
        if (!proof || receipt.contributionId !== id || proof.actorId !== uid || proof.payloadHash !== payloadHash || !proof.recordedAt.isEqual(receipt.recordedAt))
          throw new HttpsError('failed-precondition', 'Le reçu natif de contribution doit être rapproché.');
      } else if (receipt.contributionId !== null || !['requester_neutralized', 'source_changed'].includes(receipt.reason))
        throw new HttpsError('failed-precondition', 'La non-exécution de la contribution doit être rapprochée.');
      return receiptView(uid, requestId, command, receipt);
    }
    if (raw.action === 'observe') return receiptView(uid, requestId, command);
    const recordedAt = Timestamp.now();
    const notExecuted = (reason: string) => {
      const native = {protocol: 'product_review_command_v1', actorId: uid, requestId, payloadHash, command,
        state: 'not_executed', contributionId: null, reason, recordedAt};
      tx.create(receiptRef, native); return receiptView(uid, requestId, command, native);
    };
    if (raw.action === 'neutralize') return notExecuted('requester_neutralized');
    assertProductMaterialNewOpen(material); assertProductParcelNewOpen(parcel); assertProductRoutingNewOpen(!!command.routingStatement); assertProductMixedOrdersNewOpen(!!command.mixedOrderStatement);
    const source = await readProductReviewSource(tx, command.context, material, parcel);
    if (!productReviewRoles(source, uid).includes(command.actorRole)) throw new HttpsError('permission-denied', 'Rôle natif non autorisé.');
    if (source.sourceHash !== command.sourceHash) return notExecuted('source_changed');
    const root = source.caseSnap.data();
    if (root && (!rootQualified(root, command.context) || root.version >= Number.MAX_SAFE_INTEGER - 1))
      throw new HttpsError('failed-precondition', 'Le dossier doit être rapproché avant une nouvelle contribution.');
    const captureRef = caseRef.collection('source_captures').doc(source.sourceHash), capture = await tx.get(captureRef);
    if (capture.exists && (capture.data()?.protocol !== 'product_review_source_capture_v1' ||
        capture.data()?.sourceHash !== source.sourceHash || supportSourceHash(capture.data()?.document) !== source.sourceHash))
      throw new HttpsError('failed-precondition', 'La capture source doit être rapprochée.');
    const contributionRef = caseRef.collection('contributions').doc(id), existing = await tx.get(contributionRef);
    const alertRef = db.collection('admin_alerts').doc(`product_review_${id}`), alert = await tx.get(alertRef);
    if (existing.exists || alert.exists) throw new HttpsError('failed-precondition', 'Une contribution sans reçu doit être rapprochée.');
    // Explicit native topic + order party, never description/AI inference.
    // This conservatory witness concerns transport, not dispute or money.
    const physical = command.context.kind === 'order' && ['recall', 'hygiene'].includes(command.topic);
    const orderRef = db.collection('transactions').doc(command.context.id);
    const order = physical ? (await tx.get(orderRef)).data() : null;
    const signalId = 'ps_' + supportHash([uid, requestId]), signalRef = caseRef.collection('physical_signals').doc(signalId);
    if (physical && (!order || order.buyerId !== source.document.nativeActors.buyerId || order.sellerId !== source.document.nativeActors.sellerId ||
        !['buyer', 'seller'].includes(command.actorRole))) throw new HttpsError('failed-precondition', 'Parties du signal de sécurité à rapprocher.');
    const priorGuard = order?.productPhysicalReview;
    if (physical && Object.prototype.hasOwnProperty.call(order!, 'productPhysicalReview') && (priorGuard?.protocol !== 'product_physical_review_guard_v1' ||
        priorGuard.transactionId !== command.context.id || priorGuard.caseId !== source.caseId || priorGuard.buyerId !== order!.buyerId || priorGuard.sellerId !== order!.sellerId ||
        !Number.isSafeInteger(priorGuard.version) || priorGuard.version < 1 || priorGuard.version >= Number.MAX_SAFE_INTEGER - 1 ||
        !nativeTime(priorGuard.firstObservedAt) || !nativeTime(priorGuard.lastObservedAt) || !/^ps_[a-f0-9]{64}$/.test(priorGuard.latestSignalId ?? '')))
      throw new HttpsError('failed-precondition', 'Le témoin conservatoire existant doit être rapproché.');
    if (physical && (await tx.get(signalRef)).exists) throw new HttpsError('failed-precondition', 'Signal de sécurité sans reçu à rapprocher.');
    const routingSignal = await prepareProductRoutingSignal(tx, command.context, source, command.routingStatement);
    const mixedSignal = await prepareProductMixedOrderSignal(tx, command.context, source, command.mixedOrderStatement, uid, id);
    const inputs = [{eventKey: `product_review_contribution_v1:${id}`, userId: uid,
      type: 'product_review_update', title: 'Examen de l’article',
      message: 'Votre contribution a été enregistrée pour examen. Elle ne confirme ni l’état du produit, ni une décision de remboursement ou de livraison.',
      data: {ownerId: uid, productReviewCaseId: source.caseId, contextKind: command.context.kind, contextId: command.context.id}}];
    if (physical) for (const party of [order!.buyerId, order!.sellerId]) inputs.push({eventKey: `product_physical_signal_v1:${signalId}:${party}`, userId: party,
      type: 'product_review_update', title: 'Transport à examiner',
      message: 'Un signal explicite de sécurité a été enregistré. N’expédiez ou ne réexpédiez pas cet article avant une instruction humaine sur le trajet concerné. Les recours restent accessibles ; ce signal ne décide ni d’un remboursement ni d’un gel de fonds.',
      data: {ownerId: party, productReviewCaseId: source.caseId, contextKind: 'order', contextId: command.context.id}});
    if (routingSignal?.requiresReview) for (const party of [routingSignal.order.buyerId, routingSignal.order.sellerId]) inputs.push({eventKey: `product_routing_signal_v1:${id}:${party}`, userId: party,
      type: 'product_review_update', title: 'Routage à examiner',
      message: 'Une correction de routage, une destination contestée ou un contexte inconnu a été déclaré. La libération commerciale doit être examinée ; cela ne prouve ni perte, ni faute, ni droit à un remboursement.',
      data: {ownerId: party, productReviewCaseId: source.caseId, contextKind: 'order', contextId: command.context.id}});
    if (mixedSignal) for (const party of [mixedSignal.order.buyerId, mixedSignal.order.sellerId]) inputs.push({eventKey: `product_mixed_order_signal_v1:${id}:${party}`, userId: party,
      type: 'product_review_update', title: 'Contenu du colis à examiner',
      message: 'Un possible mélange de contenu ou d’étiquettes a été déclaré pour votre commande. Consultez votre dossier privé ; cela ne détermine ni faute, ni remboursement, ni récupération physique.',
      data: {ownerId: party, productReviewCaseId: source.caseId, contextKind: 'order', contextId: command.context.id}});
    const notices = await prepareOperationalNotices(tx, inputs);
    const document = {protocol: 'product_review_contribution_v1', contributionId: id, caseId: source.caseId,
      context: command.context, actorId: uid, actorRole: command.actorRole, requestId, payloadHash, command,
      sourceHash: source.sourceHash, topic: command.topic, recordedAt, ...PRODUCT_REVIEW_EFFECTS};
    const contributionHash = supportSourceHash(document);
    if (!capture.exists) tx.create(captureRef, {protocol: 'product_review_source_capture_v1', sourceHash: source.sourceHash,
      document: source.document, capturedAt: recordedAt});
    tx.create(contributionRef, {protocol: document.protocol, contributionId: id, document, contentHash: contributionHash});
    if (physical) {
      const signal = {protocol: 'product_physical_signal_v1', signalId, transactionId: command.context.id, caseId: source.caseId,
        buyerId: order!.buyerId, sellerId: order!.sellerId, actorId: uid, actorRole: command.actorRole, topic: command.topic,
        contributionId: id, contributionHash, sourceHash: source.sourceHash, recordedAt,
        physicalFactsVerified: false, financialEffectAuthorized: false};
      tx.create(signalRef, {protocol: signal.protocol, signalId, document: signal, contentHash: supportSourceHash(signal)});
      tx.update(orderRef, {productPhysicalReview: {protocol: 'product_physical_review_guard_v1', transactionId: command.context.id, caseId: source.caseId,
        buyerId: order!.buyerId, sellerId: order!.sellerId, version: (priorGuard?.version ?? 0) + 1, latestSignalId: signalId,
        firstObservedAt: priorGuard?.firstObservedAt ?? recordedAt, lastObservedAt: recordedAt, reviewRequired: true,
        source: 'explicit_participant_product_review'}});
    }
    routingSignal?.commit(id, contributionHash, recordedAt);
    mixedSignal?.commit(contributionHash, recordedAt);
    if (!root) tx.create(caseRef, {protocol: 'product_review_case_v1', caseId: source.caseId, context: command.context,
      articleId: source.document.articleId, nativeActors: source.document.nativeActors, version: 1,
      createdAt: recordedAt, latestContributionAt: recordedAt, state: 'awaiting_review', ...PRODUCT_REVIEW_EFFECTS});
    else tx.update(caseRef, {version: root.version + 1, latestContributionAt: recordedAt, state: 'awaiting_review'});
    tx.create(alertRef, {kind: 'product_review', severity: 'warning', refId: source.caseId, status: 'open', createdAt: recordedAt,
      message: 'Nouvelle contribution à examiner. Les déclarations ne certifient ni les faits physiques ni une autorité financière.',
      context: {caseId: source.caseId, contributionId: id, topic: command.topic}});
    const native = {protocol: 'product_review_command_v1', actorId: uid, requestId, payloadHash, command,
      state: 'committed', contributionId: id, reason: null, recordedAt};
    tx.create(receiptRef, native); notices.commit();
    return receiptView(uid, requestId, command, native);
  }));
}

export async function readProductReviewContributions(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'cursor', 'materialCapability', 'parcelCapability', 'routingCapability', 'mixedOrdersCapability']);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw), routing = productRoutingRequested(raw), mixedOrders = productMixedOrdersRequested(raw);
  const context = productReviewContext(raw.context);
  if (material && context.kind !== 'order') throw new HttpsError('invalid-argument', 'Une commande native est requise pour le lecteur matériel.');
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée de lecture invalide.');
  const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (cursor !== null && !documentId(cursor)) throw new HttpsError('invalid-argument', 'Page invalide.');
  return withPrivateAccountSession(request, async () => {
    const authorize = async (tx: FirebaseFirestore.Transaction) => {
      const session = await assertPrivateAccountSession(request, tx);
      if (raw.scope === 'admin') await supportAdmin(tx, uid, session.currentAdminClaim);
    };
    const result = await db.runTransaction(async tx => {
      await authorize(tx);
      const ref = productReviewCaseRef(context), root = (await tx.get(ref)).data();
      if (!root || !rootQualified(root, context)) throw new HttpsError('failed-precondition', 'Le dossier natif doit être rapproché.');
      if (raw.scope === 'own' && !['buyerId', 'sellerId', 'reporterId'].some(role => root.nativeActors?.[role] === uid))
        throw new HttpsError('permission-denied', 'Ce dossier n’appartient pas à votre compte.');
      let query: FirebaseFirestore.Query = ref.collection('contributions');
      if (raw.scope === 'own') query = query.where('document.actorId', '==', uid);
      query = query.orderBy('__name__').limit(21);
      if (cursor) query = query.startAfter(cursor);
      const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
      for (const snap of inspected) {
        const proof = await readProductReviewContributionProof(tx, context, snap.id, snap.data());
        // New typed rows are invisible to old strict readers; cursor still follows inspected rows.
        if (proof?.command.routingStatement && !routing || proof?.command.mixedOrderStatement && !mixedOrders) continue;
        entries.push(proof && (material || parcel || !proof.command.materialStatement) && (parcel || !proof.command.parcelStatement) && (raw.scope === 'admin' || proof.actorId === uid)
          ? {qualification: 'native_actor_contribution', contribution: contributionView(proof)}
          : {qualification: 'unknown', contributionId: snap.id, contribution: null});
      }
      return {protocol: parcel ? 'product_review_parcel_contributions_page_v1' : material ? 'product_review_material_contributions_page_v1' : 'product_review_contributions_page_v1', actorId: uid, scope: raw.scope, caseId: productReviewCaseId(context),
        entries, readAt: Timestamp.now().toDate().toISOString(),
        nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null,
        coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false},
        otherPartiesRawContributionsVisible: raw.scope === 'admin', originalsAccessGranted: false, ...PRODUCT_REVIEW_EFFECTS};
    });
    await db.runTransaction(authorize);
    return result;
  });
}
