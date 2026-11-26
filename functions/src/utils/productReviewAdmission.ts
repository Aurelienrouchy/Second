/** A native child-safety source decision. It never activates a listing or certifies a product. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {articlePrivacyWithdrawn} from './publicProfile';
import {readArticleChildSafetySource} from './articleChildSafety';
import {prepareOperationalNotices} from './notifications';
import {PRODUCT_REVIEW_EFFECTS, productReviewCaseId, productReviewCaseRef, productReviewContext, productReviewSourceView,
  type ProductReviewContext} from './productReviewSource';
import {readProductReviewDocumentarySet, type EvidenceReference, type Reference} from './productReviewWorkflow';
import {supportAdmin, supportCurrentAdminSession, supportHash, supportObject, supportRequestId, supportRevision,
  supportSourceHash, supportText, supportUid} from './supportRequest';

const HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const documentId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 &&
  !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const actorId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && !v.includes('/');
export const PRODUCT_ADMISSION_ACTIONS = ['allow_listing_for_sources', 'retain_review', 'refuse_listing'] as const;
export const PRODUCT_ADMISSION_CRITERIA = ['use_and_regulatory_scope', 'flammability_requirements', 'label_and_care_information',
  'condition_alterations_and_sale_unit', 'hazards_and_recall_information', 'documentation_limits'] as const;
export const PRODUCT_ADMISSION_DOCUMENTS = [
  {id: 'sleepwear_regulations', url: 'https://laws-lois.justice.gc.ca/fra/reglements/DORS-2016-169/TexteComplet.html'},
  {id: 'hc_sleepwear_guidance', url: 'https://www.canada.ca/en/health-canada/services/consumer-product-safety/legislation-guidelines/guidelines-policies/guide-children-sleepwear-flammability-requirement.html'},
  {id: 'hc_second_hand_guidance', url: 'https://www.canada.ca/en/health-canada/services/consumer-product-safety/reports-publications/industry-professionals/industry-guide-second-hand-products-including-children-products/guidance-document.html'},
] as const;
const referenceSet = {protocol: 'product_review_child_safety_references_v1', documents: PRODUCT_ADMISSION_DOCUMENTS,
  criteria: PRODUCT_ADMISSION_CRITERIA, exhaustiveLegalGuidanceVerified: false, contentFetchedNow: false};
type Assessment = {criterion: typeof PRODUCT_ADMISSION_CRITERIA[number]; assessment: 'documented' | 'unresolved' | 'not_applicable'; reason: string};
type Command = {context: ProductReviewContext; sourceHash: string; childSourceHash: string; statementHash: string | null;
  action: typeof PRODUCT_ADMISSION_ACTIONS[number]; motivation: string; ownerSummary: string; referenceSetHash: string;
  documentsConsidered: string[]; assessments: Assessment[]; acknowledged: true;
  documentaryCorpus: {hash: string; membersHash: string; contributionReferences: Reference[]; evidenceReferences: EvidenceReference[]}};
const decisionId = (uid: string, requestId: string) => 'pa_' + supportHash([uid, requestId]);
const commandRef = (uid: string, requestId: string) => db.collection('product_review_admission_commands').doc(supportHash([uid, requestId]));
function contextInput(value: unknown) {
  const context = productReviewContext(value);
  if (context.kind !== 'article_listing') throw new HttpsError('invalid-argument', 'Contexte natif de prépublication requis.');
  return context;
}
function input(value: unknown): Command {
  const c = supportObject(value, ['context', 'sourceHash', 'childSourceHash', 'statementHash', 'action', 'motivation', 'ownerSummary',
    'referenceSetHash', 'documentsConsidered', 'assessments', 'acknowledged', 'documentaryCorpus']);
  const corpus = supportObject(c.documentaryCorpus, ['hash', 'membersHash', 'contributionReferences', 'evidenceReferences']);
  if (![c.sourceHash, c.childSourceHash, c.referenceSetHash, corpus.hash, corpus.membersHash].every(h => HASH.test(h ?? '')) ||
      c.statementHash !== null && !HASH.test(c.statementHash ?? '') || !(PRODUCT_ADMISSION_ACTIONS as readonly unknown[]).includes(c.action) ||
      c.acknowledged !== true || !Array.isArray(c.documentsConsidered) || c.documentsConsidered.length > 3 ||
      new Set(c.documentsConsidered).size !== c.documentsConsidered.length || c.documentsConsidered.some((id: unknown) => !PRODUCT_ADMISSION_DOCUMENTS.some(d => d.id === id)) ||
      !Array.isArray(c.assessments) || c.assessments.length !== PRODUCT_ADMISSION_CRITERIA.length)
    throw new HttpsError('invalid-argument', 'Décision, sources et examen motivé explicites requis.');
  const assessments = c.assessments.map((value: unknown) => {
    const a = supportObject(value, ['criterion', 'assessment', 'reason']);
    if (!(PRODUCT_ADMISSION_CRITERIA as readonly unknown[]).includes(a.criterion) || !['documented', 'unresolved', 'not_applicable'].includes(a.assessment))
      throw new HttpsError('invalid-argument', 'Critère documentaire invalide.');
    return {...a, reason: supportText(a.reason, 'Motivation du critère', 2000)} as Assessment;
  });
  if (new Set(assessments.map((a: Assessment) => a.criterion)).size !== PRODUCT_ADMISSION_CRITERIA.length)
    throw new HttpsError('invalid-argument', 'Tous les critères documentaires sont requis.');
  if (![corpus.contributionReferences, corpus.evidenceReferences].every(r => Array.isArray(r) && r.length <= 100))
    throw new HttpsError('invalid-argument', 'Références du corpus bornées requises.');
  const contributionReferences = corpus.contributionReferences.map((value: unknown) => {
    const r = supportObject(value, ['id', 'contentHash']);
    if (!documentId(r.id) || !HASH.test(r.contentHash ?? '')) throw new HttpsError('invalid-argument', 'Référence de contribution invalide.');
    return r as Reference;
  });
  const evidenceReferences = corpus.evidenceReferences.map((value: unknown) => {
    const r = supportObject(value, ['id', 'contentHash', 'actorId', 'actorRole', 'contributionId', 'contributionHash', 'sourceHash',
      'generation', 'crc32c', 'sha256', 'typeDeclared', 'state', 'receiptHash']);
    if (typeof r.id !== 'string' || !/^pf_[a-f0-9]{64}$/.test(r.id) || !actorId(r.actorId) || r.actorRole !== 'seller' ||
        typeof r.contributionId !== 'string' || !/^pc_[a-f0-9]{64}$/.test(r.contributionId) ||
        !['contentHash', 'contributionHash', 'sourceHash', 'sha256', 'receiptHash'].every(k => HASH.test(r[k] ?? '')) ||
        typeof r.generation !== 'string' || !/^\d+$/.test(r.generation) || typeof r.crc32c !== 'string' || !/^[A-Za-z0-9+/]{6}==$/.test(r.crc32c) ||
        !['received_item_photo', 'supporting_document_image', 'expertise_image'].includes(r.typeDeclared) || !['received', 'stored_requires_review'].includes(r.state))
      throw new HttpsError('invalid-argument', 'Référence native de pièce invalide.');
    return r as EvidenceReference;
  });
  if ([contributionReferences, evidenceReferences].some(refs => new Set(refs.map((r: Reference) => r.id)).size !== refs.length))
    throw new HttpsError('invalid-argument', 'Référence documentaire en double.');
  return {context: contextInput(c.context), sourceHash: c.sourceHash, childSourceHash: c.childSourceHash, statementHash: c.statementHash,
    action: c.action, motivation: supportText(c.motivation, 'Motivation privée'), ownerSummary: supportText(c.ownerSummary, 'Synthèse adressée au vendeur'),
    referenceSetHash: c.referenceSetHash, documentsConsidered: [...c.documentsConsidered].sort(),
    assessments: assessments.sort((a: Assessment, b: Assessment) => a.criterion < b.criterion ? -1 : a.criterion > b.criterion ? 1 : 0), acknowledged: true,
    documentaryCorpus: {hash: corpus.hash, membersHash: corpus.membersHash, contributionReferences, evidenceReferences}};
}
type Set = Awaited<ReturnType<typeof readProductReviewDocumentarySet>>;
/** Only our own case-version/publication writes are excluded. Every observed
 * contribution, communication, file and intent remains in this native digest. */
function members(set: Set) {
  return membersFromCapture(set.manifest);
}
function membersFromCapture(d: Set['manifest']) {
  return {protocol: 'product_review_admission_members_v1', caseId: d.caseId, context: d.context,
    contributions: d.contributions, communications: d.communications, evidence: d.evidence, intents: d.intents,
    documentaryComplete: d.documentaryComplete, lookahead: d.lookahead};
}
/** Conservative upper bound for the known string/map/array/Timestamp DTOs.
 * Per-value/entry overhead and the 900k cap leave room below Firestore's 1MiB
 * document limit. Unknown types or depth never become a truncated capture. */
function documentFits(value: unknown) {
  let bytes = 4096, nodes = 0;
  const count = (v: any, depth: number): boolean => {
    if (depth > 30 || ++nodes > 20_000) return false;
    bytes += 64;
    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || v instanceof Timestamp) return bytes <= 900_000;
    if (typeof v === 'string') {bytes += Buffer.byteLength(v, 'utf8'); return bytes <= 900_000;}
    if (Array.isArray(v)) return v.every(child => count(child, depth + 1));
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
    return Object.entries(v).every(([key, child]) => {
      bytes += Buffer.byteLength(key, 'utf8') + 64;
      return bytes <= 900_000 && count(child, depth + 1);
    });
  };
  return count(value, 0);
}
function ready(child: ReturnType<typeof readArticleChildSafetySource>, article: any, set: Set) {
  return child.requirement === 'human_review_required' && ['native_current', 'not_applicable'].includes(child.statementQualification) &&
    set.documentaryComplete && !articlePrivacyWithdrawn(article) && article.childSafetyPreparation?.state !== 'withdrawn' &&
    (!Object.prototype.hasOwnProperty.call(article, 'childSafetyPreparation') ||
      article.childSafetyPreparation?.protocol === 'article_child_safety_preparation_v1' && article.childSafetyPreparation.articleId === child.articleId &&
      article.childSafetyPreparation.sellerId === child.sellerId && article.childSafetyPreparation.sourceHash === child.sourceHash &&
      article.childSafetyPreparation.state === 'awaiting_review' && native(article.childSafetyPreparation.submittedAt));
}
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  const claim = await supportCurrentAdminSession(request);
  await supportAdmin(tx, uid, claim);
  const user = await tx.get(db.collection('users').doc(uid));
  return {protocol: 'current_product_admission_operator_v1', actorId: uid, authTime: request.auth.token.auth_time,
    authorityQualifiedAtCommit: true, nativeAdminClaimObserved: claim, privateRoleRevision: supportRevision(user), privateRoleSourceHash: supportSourceHash(user.data() ?? null)};
}
async function decisionProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, id: string, value: any) {
  const d = value?.document;
  if (value?.protocol !== 'product_review_admission_decision_v1' || !d || d.protocol !== value.protocol || value.decisionId !== id || d.decisionId !== id ||
      !actorId(d.actorId) || !actorId(d.sellerId) || !actorId(d.requestId) || d.requestId.length < 16 ||
      id !== decisionId(d.actorId, d.requestId) || value.sellerId !== d.sellerId ||
      d.caseId !== productReviewCaseId(context) || !native(d.recordedAt) || supportSourceHash(d) !== value.contentHash ||
      !Number.isSafeInteger(d.caseVersion) || d.caseVersion < 1 || d.scope !== 'child_safety_sources_only' || d.listingActivated !== false ||
      d.operatorAuthority?.protocol !== 'current_product_admission_operator_v1' || d.operatorAuthority.actorId !== d.actorId ||
      d.operatorAuthority.authorityQualifiedAtCommit !== true || !Number.isSafeInteger(d.operatorAuthority.authTime) || d.operatorAuthority.authTime < 1 ||
      Object.entries(PRODUCT_REVIEW_EFFECTS).some(([k, v]) => d[k] !== v)) return null;
  let command: Command;
  try {command = input(d.command);} catch {return null;}
  if (supportHash(command.context) !== supportHash(context) || supportHash(command) !== d.payloadHash) return null;
  if (!d.corpusCapture || ![d.corpusCapture.contributions, d.corpusCapture.communications,
    d.corpusCapture.evidence, d.corpusCapture.intents].every(rows => Array.isArray(rows) && rows.length <= 100) ||
      d.corpusCapture.caseId !== productReviewCaseId(context) || supportHash(d.corpusCapture.context) !== supportHash(context) ||
      d.referenceSetCapture?.protocol !== 'product_review_child_safety_references_v1' ||
      supportHash(d.referenceSetCapture) !== command.referenceSetHash) return null;
  const memberCapture = membersFromCapture(d.corpusCapture), membersHash = supportSourceHash(memberCapture);
  // Preserve real receipts from the earlier local duplicate-capture variant.
  // Its extra copy must match exactly; absence in the compact variant is valid.
  if (membersHash !== command.documentaryCorpus.membersHash || Object.prototype.hasOwnProperty.call(d, 'memberCapture') &&
      supportSourceHash(d.memberCapture) !== membersHash) return null;
  const receipt = (await tx.get(commandRef(d.actorId, d.requestId))).data();
  const capture = (await tx.get(productReviewCaseRef(context).collection('source_captures').doc(command.sourceHash))).data();
  if (receipt?.protocol !== 'product_review_admission_command_v1' || receipt.state !== 'committed' || receipt.decisionId !== id ||
      receipt.actorId !== d.actorId || receipt.requestId !== d.requestId || receipt.payloadHash !== d.payloadHash ||
      supportHash(receipt.command) !== d.payloadHash || receipt.caseVersion !== d.caseVersion || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt) ||
      capture?.protocol !== 'product_review_source_capture_v1' || capture.sourceHash !== command.sourceHash ||
      !native(capture.capturedAt) || supportSourceHash(capture.document) !== command.sourceHash ||
      supportHash(capture.document.context) !== supportHash(context) || capture.document.nativeActors?.sellerId !== d.sellerId ||
      capture.document.listingSubmission?.childSafety?.sourceHash !== command.childSourceHash ||
      (capture.document.listingSubmission.childSafety.declaration?.statementHash ?? null) !== command.statementHash ||
      d.corpusCapture?.protocol !== 'product_review_documentary_corpus_v1' || d.corpusCapture.sourceHash !== command.sourceHash ||
      supportSourceHash(d.corpusCapture) !== command.documentaryCorpus.hash) return null;
  if (command.action === 'allow_listing_for_sources' && (memberCapture.documentaryComplete !== true || command.assessments.some(a => a.assessment === 'unresolved') ||
      command.documentsConsidered.length !== PRODUCT_ADMISSION_DOCUMENTS.length ||
      supportHash(command.documentaryCorpus.contributionReferences) !== supportHash(d.corpusCapture.contributions.map((r: any) => ({id: r.id, contentHash: r.contentHash}))) ||
      supportHash(command.documentaryCorpus.evidenceReferences) !== supportHash(d.corpusCapture.evidence.map((r: any) => r.reference)))) return null;
  return {document: d, command, contentHash: value.contentHash};
}
/** Consumer API: true historical decision FIRST, then current semantic source
 * and exact native members. This exception grants no other business authority. */
export async function readProductReviewAdmission(tx: FirebaseFirestore.Transaction, articleId: string, article: FirebaseFirestore.DocumentData) {
  const child = readArticleChildSafetySource(articleId, article), context: ProductReviewContext = {kind: 'article_listing', id: articleId};
  const base = {protocol: 'product_review_admission_guard_v1', allowed: false, currentSourceHash: child.sourceHash,
    qualification: 'no_current_allow' as 'native_current_allow' | 'no_current_allow' | 'unknown', decisionId: null as string | null};
  const root = (await tx.get(productReviewCaseRef(context))).data(), pointer = root?.latestAdmission;
  if (root && (root.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context) ||
      supportHash(root.context) !== supportHash(context) || !Number.isSafeInteger(root.version) || root.version < 1 || !native(root.createdAt)))
    return {...base, qualification: 'unknown' as const};
  if (pointer == null) return base;
  if (typeof pointer.decisionId !== 'string' || !/^pa_[a-f0-9]{64}$/.test(pointer.decisionId) || !HASH.test(pointer.contentHash ?? '')) return {...base, qualification: 'unknown' as const};
  let proof: Awaited<ReturnType<typeof decisionProof>>;
  try {proof = await decisionProof(tx, context, pointer.decisionId, (await tx.get(productReviewCaseRef(context).collection('admission_decisions').doc(pointer.decisionId))).data());}
  catch (error) {
    if (!(error instanceof HttpsError) || !['failed-precondition', 'invalid-argument'].includes(error.code)) throw error;
    return {...base, qualification: 'unknown' as const};
  }
  if (!proof || proof.contentHash !== pointer.contentHash || pointer.caseVersion !== proof.document.caseVersion || root!.version < pointer.caseVersion)
    return {...base, qualification: 'unknown' as const};
  const result = {...base, decisionId: pointer.decisionId};
  if (proof.command.action !== 'allow_listing_for_sources' || proof.document.sellerId !== child.sellerId ||
      proof.command.childSourceHash !== child.sourceHash || proof.command.statementHash !== (child.declaration?.statementHash ?? null) ||
      proof.command.referenceSetHash !== supportHash(referenceSet)) return result;
  let set: Set;
  try {set = await readProductReviewDocumentarySet(tx, context);} catch (error) {
    if (!(error instanceof HttpsError) || !['failed-precondition', 'invalid-argument'].includes(error.code)) throw error;
    return {...result, qualification: 'unknown' as const};
  }
  const current = 'listingSubmission' in set.source.document ? set.source.document.listingSubmission.childSafety : null;
  if (!current || current.sourceHash !== child.sourceHash || !ready(child, article, set) ||
      supportSourceHash(members(set)) !== proof.command.documentaryCorpus.membersHash) return result;
  return {...result, allowed: true, qualification: 'native_current_allow' as const};
}

export async function previewProductReviewAdmission(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope']);
  const context = contextInput(raw.context);
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée invalide.');
  return db.runTransaction(async tx => {
    if (raw.scope === 'admin') await operator(tx, request, uid);
    const set = await readProductReviewDocumentarySet(tx, context), article = (await tx.get(db.collection('articles').doc(context.id))).data();
    if (!article) throw new HttpsError('not-found', 'Annonce native indisponible.');
    const child = readArticleChildSafetySource(context.id, article);
    if (raw.scope === 'own' && child.sellerId !== uid) throw new HttpsError('permission-denied', 'Annonce non autorisée.');
    return {protocol: 'product_review_admission_preview_v1', actorId: uid, scope: raw.scope, context, caseId: set.source.caseId,
      source: productReviewSourceView(set.source, uid), childSourceHash: child.sourceHash, statementHash: child.declaration?.statementHash ?? null,
      documentaryCorpus: {hash: set.corpusHash, membersHash: supportSourceHash(members(set)),
        contributionReferences: raw.scope === 'admin' ? set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash, qualification: r.proof ? 'native_contribution' : 'unknown'})) : [],
        evidenceReferences: raw.scope === 'admin' ? set.evidenceRows.map(r => r.reference ? {qualification: 'native_stored_file', evidence: r.reference} : {qualification: 'unknown', evidenceId: r.id, evidence: null}) : []},
      coverage: {...set.coverage, ...set.documentaryCoverage}, referenceSet, referenceSetHash: supportHash(referenceSet),
      options: raw.scope === 'admin' ? [...PRODUCT_ADMISSION_ACTIONS] : [], canAllowForCurrentSources: raw.scope === 'admin' && ready(child, article, set),
      decisionPermissionGranted: false, listingActivated: false, physicalComplianceVerified: false, platformCertificationGranted: false, ...PRODUCT_REVIEW_EFFECTS};
  });
}
function receiptView(uid: string, requestId: string, command: Command, value?: any) {
  return {protocol: 'product_review_admission_command_v1', actorId: uid, requestId, payloadHash: supportHash(command), caseId: productReviewCaseId(command.context),
    decisionId: value?.decisionId ?? null, state: value?.state ?? 'unrecorded', reason: value?.reason ?? null,
    caseVersionAtCommit: value?.caseVersion ?? null, recordedAt: native(value?.recordedAt) ? value.recordedAt.toDate().toISOString() : null,
    currentSourceVerified: false, currentAdmissionVerified: false, listingActivated: false, physicalComplianceVerified: false, platformCertificationGranted: false, ...PRODUCT_REVIEW_EFFECTS};
}
export async function commandProductReviewAdmission(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'requestId', 'action', 'command']);
  const requestId = supportRequestId(raw.requestId), command = input(raw.command), payloadHash = supportHash(command), ref = productReviewCaseRef(command.context), id = decisionId(uid, requestId);
  if (!['execute', 'observe', 'neutralize'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Action de journal invalide.');
  return db.runTransaction(async tx => {
    const receiptRef = commandRef(uid, requestId), receipt = (await tx.get(receiptRef)).data();
    if (receipt) {
      if (receipt.protocol !== 'product_review_admission_command_v1' || receipt.actorId !== uid || receipt.requestId !== requestId ||
          receipt.payloadHash !== payloadHash || supportHash(receipt.command) !== payloadHash || !native(receipt.recordedAt) || !['committed', 'not_executed'].includes(receipt.state))
        throw new HttpsError('already-exists', 'Cette intention désigne une autre décision ou un reçu inconnu.');
      if (receipt.state === 'committed') {
        const proof = await decisionProof(tx, command.context, id, (await tx.get(ref.collection('admission_decisions').doc(id))).data());
        if (!proof || receipt.decisionId !== id || proof.document.payloadHash !== payloadHash || proof.document.caseVersion !== receipt.caseVersion ||
            !proof.document.recordedAt.isEqual(receipt.recordedAt)) throw new HttpsError('failed-precondition', 'Reçu d’admission natif à rapprocher.');
      } else if (receipt.decisionId !== null || receipt.caseVersion !== null || !['requester_neutralized', 'source_changed', 'reference_unqualified', 'incomplete_case_history'].includes(receipt.reason))
        throw new HttpsError('failed-precondition', 'Non-exécution d’admission à rapprocher.');
      return receiptView(uid, requestId, command, receipt);
    }
    if (raw.action === 'observe') return receiptView(uid, requestId, command);
    const now = Timestamp.now(), noEffect = (reason: string) => {
      const value = {protocol: 'product_review_admission_command_v1', actorId: uid, requestId, command, payloadHash,
        state: 'not_executed', decisionId: null, caseVersion: null, reason, recordedAt: now};
      tx.create(receiptRef, value); return receiptView(uid, requestId, command, value);
    };
    if (raw.action === 'neutralize') return noEffect('requester_neutralized');
    const authority = await operator(tx, request, uid), set = await readProductReviewDocumentarySet(tx, command.context);
    const article = (await tx.get(db.collection('articles').doc(command.context.id))).data();
    if (!article) throw new HttpsError('not-found', 'Annonce native indisponible.');
    const child = readArticleChildSafetySource(command.context.id, article), memberCapture = members(set);
    if (command.sourceHash !== set.source.sourceHash || command.childSourceHash !== child.sourceHash || command.statementHash !== (child.declaration?.statementHash ?? null) ||
        command.documentaryCorpus.hash !== set.corpusHash || command.documentaryCorpus.membersHash !== supportSourceHash(memberCapture) ||
        command.referenceSetHash !== supportHash(referenceSet)) return noEffect('source_changed');
    if (!actorId(child.sellerId) || set.root && set.root.version >= Number.MAX_SAFE_INTEGER - 1) throw new HttpsError('failed-precondition', 'Partie ou version de l’admission à rapprocher.');
    for (const r of command.documentaryCorpus.contributionReferences) {
      if (!set.contributionRows.some(row => row.id === r.id && row.proof && row.contentHash === r.contentHash)) return noEffect('reference_unqualified');
    }
    for (const r of command.documentaryCorpus.evidenceReferences) {
      if (!set.evidenceRows.some(row => row.reference && supportHash(row.reference) === supportHash(r))) return noEffect('reference_unqualified');
    }
    if (command.action === 'allow_listing_for_sources') {
      if (!ready(child, article, set) || command.assessments.some(a => a.assessment === 'unresolved') || command.documentsConsidered.length !== PRODUCT_ADMISSION_DOCUMENTS.length)
        return noEffect('incomplete_case_history');
      if (supportHash(command.documentaryCorpus.contributionReferences) !== supportHash(set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash}))) ||
          supportHash(command.documentaryCorpus.evidenceReferences) !== supportHash(set.evidenceRows.map(r => r.reference))) return noEffect('reference_unqualified');
    }
    const captureRef = ref.collection('source_captures').doc(command.sourceHash), capture = await tx.get(captureRef);
    if (capture.exists && (capture.data()?.protocol !== 'product_review_source_capture_v1' || capture.data()?.sourceHash !== command.sourceHash ||
        supportSourceHash(capture.data()?.document) !== command.sourceHash || !native(capture.data()?.capturedAt))) throw new HttpsError('failed-precondition', 'Capture source à rapprocher.');
    const decisionRef = ref.collection('admission_decisions').doc(id), prior = await tx.get(decisionRef);
    if (prior.exists) throw new HttpsError('failed-precondition', 'Décision sans reçu à rapprocher.');
    const notices = await prepareOperationalNotices(tx, [{eventKey: `product_admission_v1:${id}`, userId: child.sellerId,
      type: 'product_review_update', title: 'Examen de l’annonce', message: command.ownerSummary,
      data: {ownerId: child.sellerId, productReviewCaseId: set.source.caseId, contextKind: 'article_listing', contextId: command.context.id, productReviewAdmissionId: id}}]);
    const caseVersion = (set.root?.version ?? 0) + 1;
    const document = {protocol: 'product_review_admission_decision_v1', decisionId: id, caseId: set.source.caseId, actorId: uid, sellerId: child.sellerId,
      requestId, command, payloadHash, caseVersion, operatorAuthority: authority, corpusCapture: set.manifest,
      referenceSetCapture: referenceSet, recordedAt: now,
      scope: 'child_safety_sources_only', listingActivated: false, physicalComplianceVerified: false, platformCertificationGranted: false, ...PRODUCT_REVIEW_EFFECTS};
    const sourceCapture = {protocol: 'product_review_source_capture_v1', sourceHash: command.sourceHash, document: set.source.document, capturedAt: now};
    if (!documentFits({protocol: document.protocol, decisionId: id, sellerId: child.sellerId, document, contentHash: '0'.repeat(64)}) ||
        !capture.exists && !documentFits(sourceCapture)) return noEffect('incomplete_case_history');
    const contentHash = supportSourceHash(document);
    if (!capture.exists) tx.create(captureRef, sourceCapture);
    tx.create(decisionRef, {protocol: document.protocol, decisionId: id, sellerId: child.sellerId, document, contentHash});
    const update = {version: caseVersion, latestAdmission: {decisionId: id, contentHash, caseVersion}, latestAdmissionAt: now};
    if (!set.root) tx.create(ref, {protocol: 'product_review_case_v1', caseId: set.source.caseId, context: command.context,
      articleId: command.context.id, nativeActors: set.source.document.nativeActors, createdAt: now, state: 'awaiting_review', ...update, ...PRODUCT_REVIEW_EFFECTS});
    else tx.update(ref, update);
    const value = {protocol: 'product_review_admission_command_v1', actorId: uid, requestId, command, payloadHash, state: 'committed',
      decisionId: id, caseVersion, reason: null, recordedAt: now};
    tx.create(receiptRef, value); notices.commit(); return receiptView(uid, requestId, command, value);
  });
}
export async function readProductReviewAdmissionDecisions(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'cursor']);
  const context = contextInput(raw.context), cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (!['own', 'admin'].includes(raw.scope) || cursor !== null && !documentId(cursor)) throw new HttpsError('invalid-argument', 'Lecteur d’admission invalide.');
  return db.runTransaction(async tx => {
    const admin = raw.scope === 'admin';
    if (admin) await operator(tx, request, uid);
    const ref = productReviewCaseRef(context), root = (await tx.get(ref)).data();
    if (!root || root.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context)) throw new HttpsError('failed-precondition', 'Dossier d’admission à rapprocher.');
    if (!admin && root.nativeActors?.sellerId !== uid) throw new HttpsError('permission-denied', 'Dossier d’admission non autorisé.');
    let query: FirebaseFirestore.Query = ref.collection('admission_decisions');
    if (!admin) query = query.where('sellerId', '==', uid);
    query = query.orderBy('__name__').limit(21);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
    for (const row of inspected) {
      const proof = await decisionProof(tx, context, row.id, row.data()), d = proof?.document, c = proof?.command;
      entries.push(proof && (admin || d.sellerId === uid) ? {qualification: 'native_admission_decision', decision: {
        protocol: 'product_review_admission_decision_view_v1', decisionId: row.id, contentHash: proof.contentHash, action: c!.action,
        caseVersionAtCommit: d.caseVersion, childSourceHash: c!.childSourceHash, documentaryCorpusHash: c!.documentaryCorpus.hash,
        membersHash: c!.documentaryCorpus.membersHash, ownerSummary: c!.ownerSummary, recordedAt: d.recordedAt.toDate().toISOString(),
        motivation: admin ? c!.motivation : null, assessments: admin ? c!.assessments : [], documentsConsidered: admin ? c!.documentsConsidered : [],
        contributionReferences: admin ? c!.documentaryCorpus.contributionReferences : [], evidenceReferences: admin ? c!.documentaryCorpus.evidenceReferences : [],
        currentAdmissionVerified: false, listingActivated: false, physicalComplianceVerified: false, platformCertificationGranted: false, ...PRODUCT_REVIEW_EFFECTS}}
        : {qualification: 'unknown', decisionId: row.id, decision: null});
    }
    return {protocol: 'product_review_admission_decisions_page_v1', actorId: uid, scope: raw.scope, context, caseId: productReviewCaseId(context), entries,
      readAt: Timestamp.now().toDate().toISOString(), nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null,
      coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false},
      privateAnalysisVisible: admin, originalsAccessGranted: false, ...PRODUCT_REVIEW_EFFECTS};
  });
}
