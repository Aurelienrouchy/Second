import {productParcelRequested, assertProductParcelNewOpen, parseProductParcelAssessment, operatorProductParcelSources, parcelLocationComparisonQualified} from './productReviewParcel';
/** Addressed review exchanges. A documentary outcome never authorizes money, stock or shipment. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {prepareOperationalNotices} from './notifications';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {readProductReviewContributionProof} from './productReviewContributions';
import {readProductReviewEvidenceIntentProof, readProductReviewEvidenceProof} from './productReviewEvidence';
import {supportAdmin, supportHash, supportObject, supportRequestId,
  supportRevision, supportSourceHash, supportText, supportUid} from './supportRequest';
import {PRODUCT_REVIEW_EFFECTS, productReviewCaseId, productReviewCaseRef, productReviewContext,
  productReviewRoles, productReviewSourceView, readProductReviewSource,
  type ProductReviewContext, type ProductReviewRole} from './productReviewSource';

import {productMaterialRequested, assertProductMaterialNewOpen} from './productReviewMaterial';
import {assertRecentAccountAuthentication} from './eligibility';
import {LABEL_ROUTE_AMENDMENT_CAPABILITY} from './labelRouteAmendment';
import type {CommercialReturnContestReference} from './productCommercialReturn';

export type Reference = {id: string; contentHash: string};
export type EvidenceReference = Reference & {actorId: string; actorRole: ProductReviewRole; contributionId: string; contributionHash: string;
  sourceHash: string; generation: string; crc32c: string; sha256: string; typeDeclared: 'received_item_photo' | 'supporting_document_image' | 'expertise_image';
  state: 'received' | 'stored_requires_review'; receiptHash: string};
type DocumentaryCorpus = {hash: string; evidenceReferences: EvidenceReference[]};
type Kind = 'ask_details' | 'communicate_summary' | 'issue_outcome' | 'respond' | 'contest';
type Command = {context: ProductReviewContext; sourceHash: string; kind: Kind; text: string;
  targetRoles: ProductReviewRole[]; privateNote: string | null; result: 'information_incomplete' | 'review_documented' | 'additional_action_required' | null;
  contributionReferences: Reference[]; parent: Reference | null; acknowledged: boolean; documentaryCorpus?: DocumentaryCorpus; parcelAssessment?: ReturnType<typeof parseProductParcelAssessment>; commercialReturnInstruction?: CommercialReturnContestReference};
const HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const documentId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 &&
  !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const actorId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && !v.includes('/');
const requestIdentity = (v: unknown): v is string => actorId(v) && v.length >= 16;
const operatorKind = (kind: Kind) => ['ask_details', 'communicate_summary', 'issue_outcome'].includes(kind);
const eventId = (uid: string, requestId: string) => 'pe_' + supportHash([uid, requestId]);
const commandRef = (uid: string, requestId: string) => db.collection('product_review_workflow_commands').doc(supportHash([uid, requestId]));
function documentaryOptIn(raw: any) {
  if (raw.documentaryCapability != null && raw.documentaryCapability !== 'product_review_corpus_v1')
    throw new HttpsError('invalid-argument', 'Version du corpus documentaire invalide.');
  return raw.documentaryCapability === 'product_review_corpus_v1';
}
function reference(value: unknown): Reference {
  const r = supportObject(value, ['id', 'contentHash']);
  if (!documentId(r.id) || !HASH.test(r.contentHash ?? '')) throw new HttpsError('invalid-argument', 'Référence versionnée invalide.');
  return {id: r.id, contentHash: r.contentHash};
}
function evidenceReference(value: unknown): EvidenceReference {
  const r = supportObject(value, ['id', 'contentHash', 'actorId', 'actorRole', 'contributionId', 'contributionHash', 'sourceHash',
    'generation', 'crc32c', 'sha256', 'typeDeclared', 'state', 'receiptHash']);
  if (typeof r.id !== 'string' || !/^pf_[a-f0-9]{64}$/.test(r.id) || !actorId(r.actorId) ||
      !['buyer', 'seller', 'reporter'].includes(r.actorRole) || typeof r.contributionId !== 'string' || !/^pc_[a-f0-9]{64}$/.test(r.contributionId) ||
      !['contentHash', 'contributionHash', 'sourceHash', 'sha256', 'receiptHash'].every(k => HASH.test(r[k] ?? '')) ||
      typeof r.generation !== 'string' || !/^\d+$/.test(r.generation) || typeof r.crc32c !== 'string' || !/^[A-Za-z0-9+/]{6}==$/.test(r.crc32c) ||
      !['received_item_photo', 'supporting_document_image', 'expertise_image'].includes(r.typeDeclared) ||
      !['received', 'stored_requires_review'].includes(r.state)) throw new HttpsError('invalid-argument', 'Référence native de pièce invalide.');
  return r as EvidenceReference;
}
export const parseProductReviewEvidenceReference = evidenceReference;
function corpusInput(value: unknown): DocumentaryCorpus {
  const c = supportObject(value, ['hash', 'evidenceReferences']);
  if (!HASH.test(c.hash ?? '') || !Array.isArray(c.evidenceReferences) || c.evidenceReferences.length > 100)
    throw new HttpsError('invalid-argument', 'Corpus documentaire borné requis.');
  const refs = c.evidenceReferences.map(evidenceReference);
  if (new Set(refs.map((r: EvidenceReference) => r.id)).size !== refs.length) throw new HttpsError('invalid-argument', 'Pièce en double.');
  return {hash: c.hash, evidenceReferences: refs};
}
function commercialReturnReference(value: unknown): CommercialReturnContestReference {
  const r = supportObject(value, ['instructionId', 'contentHash', 'caseVersion']);
  if (!/^pri_[a-f0-9]{64}$/.test(r.instructionId ?? '') || !HASH.test(r.contentHash ?? '') ||
      !Number.isSafeInteger(r.caseVersion) || r.caseVersion < 1) throw new HttpsError('invalid-argument', 'Instruction commerciale versionnée exacte requise.');
  return {instructionId: r.instructionId, contentHash: r.contentHash, caseVersion: r.caseVersion};
}
async function commercialReturnProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, reference: CommercialReturnContestReference) {
  if (context.kind !== 'order') return null;
  const {readProductCommercialReturnInstructionProof} = await import('./productCommercialReturn');
  return readProductCommercialReturnInstructionProof(tx, context.id, reference);
}
function input(value: unknown): Command {
  const c = supportObject(value, ['context', 'sourceHash', 'kind', 'text', 'targetRoles', 'privateNote', 'result', 'contributionReferences', 'parent', 'acknowledged', 'documentaryCorpus', 'parcelAssessment', 'commercialReturnInstruction']);
  const corpus = Object.prototype.hasOwnProperty.call(c, 'documentaryCorpus') ? corpusInput(c.documentaryCorpus) : null;
  const commercialReturnInstruction = c.commercialReturnInstruction === undefined ? null : commercialReturnReference(c.commercialReturnInstruction);
  if (commercialReturnInstruction && (c.kind !== 'contest' || c.context?.kind !== 'order' || c.parent !== null))
    throw new HttpsError('invalid-argument', 'Une instruction commerciale exacte peut être contestée sur sa commande.');
  const parcelAssessment = c.parcelAssessment === undefined ? null : parseProductParcelAssessment(c.parcelAssessment);
  if (parcelAssessment && (c.kind !== 'issue_outcome' || !corpus)) throw new HttpsError('invalid-argument', 'L’examen colis appartient à une issue liée au corpus exact.');
  if (!HASH.test(c.sourceHash ?? '') || !['ask_details', 'communicate_summary', 'issue_outcome', 'respond', 'contest'].includes(c.kind))
    throw new HttpsError('invalid-argument', 'Source et action d’examen explicites requises.');
  const admin = operatorKind(c.kind);
  if (!Array.isArray(c.targetRoles) || c.targetRoles.length > 3 || new Set(c.targetRoles).size !== c.targetRoles.length ||
      c.targetRoles.some((r: unknown) => !['buyer', 'seller', 'reporter'].includes(r as string)) ||
      admin && (!c.targetRoles.length || c.acknowledged !== true) || !admin && (c.targetRoles.length !== 0 || c.privateNote != null || c.acknowledged !== false) ||
      c.kind === 'ask_details' && c.targetRoles.length !== 1) throw new HttpsError('invalid-argument', 'Destinataires et confirmation invalides.');
  if (c.kind === 'issue_outcome' ? !['information_incomplete', 'review_documented', 'additional_action_required'].includes(c.result) : c.result != null)
    throw new HttpsError('invalid-argument', 'Issue documentaire invalide.');
  if (!Array.isArray(c.contributionReferences) || c.contributionReferences.length > (corpus ? 100 : 20))
    throw new HttpsError('invalid-argument', 'Références de contribution hors limite.');
  const refs = c.contributionReferences.map(reference);
  if (new Set(refs.map((r: Reference) => r.id)).size !== refs.length) throw new HttpsError('invalid-argument', 'Référence en double.');
  if (admin && c.parent != null || !admin && !commercialReturnInstruction && c.parent == null) throw new HttpsError('invalid-argument', 'Référence de demande ou d’issue exacte requise.');
  return {context: productReviewContext(c.context), sourceHash: c.sourceHash, kind: c.kind, text: supportText(c.text, 'Texte communicable', 4000),
    targetRoles: [...c.targetRoles].sort(), privateNote: admin ? supportText(c.privateNote, 'Motivation privée', 4000) : null,
    result: c.kind === 'issue_outcome' ? c.result : null, contributionReferences: refs,
    parent: admin || commercialReturnInstruction ? null : reference(c.parent), acknowledged: admin, ...(corpus ? {documentaryCorpus: corpus} : {}), ...(parcelAssessment ? {parcelAssessment} : {}), ...(commercialReturnInstruction ? {commercialReturnInstruction} : {})};
}
function qualifiedRoot(root: any, context: ProductReviewContext) {
  return root?.protocol === 'product_review_case_v1' && root.caseId === productReviewCaseId(context) &&
    supportHash(root.context) === supportHash(context) && Number.isSafeInteger(root.version) && root.version >= 1 && native(root.createdAt);
}
const corpusRef = (context: ProductReviewContext, hash: string) => productReviewCaseRef(context).collection('documentary_captures').doc(hash);
async function documentaryCaptureProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, command: Command) {
  if (!command.documentaryCorpus) return null;
  const value = (await tx.get(corpusRef(context, command.documentaryCorpus.hash))).data(), d = value?.document;
  if (value?.protocol !== 'product_review_documentary_capture_v1' || value.hash !== command.documentaryCorpus.hash ||
      !native(value.capturedAt) || !d || d.protocol !== 'product_review_documentary_corpus_v1' ||
      d.caseId !== productReviewCaseId(context) || supportHash(d.context) !== supportHash(context) ||
      d.sourceHash !== command.sourceHash || supportSourceHash(d) !== value.hash ||
      !Array.isArray(d.evidence) || !Array.isArray(d.contributions) || !Array.isArray(d.communications) || !Array.isArray(d.intents) ||
      [d.evidence, d.contributions, d.communications, d.intents].some(rows => rows.length > 100)) return null;
  for (const r of command.documentaryCorpus.evidenceReferences) {
    if (!d.evidence.some((row: any) => row?.reference && supportHash(row.reference) === supportHash(r))) return null;
  }
  for (const r of command.contributionReferences) {
    if (!d.contributions.some((row: any) => row?.id === r.id && row.contentHash === r.contentHash)) return null;
  }
  if (command.kind === 'issue_outcome' && command.result === 'review_documented' &&
      (d.documentaryComplete !== true || supportHash(command.documentaryCorpus.evidenceReferences) !== supportHash(d.evidence.map((r: any) => r.reference)) ||
       supportHash(command.contributionReferences) !== supportHash(d.contributions.map((r: any) => ({id: r.id, contentHash: r.contentHash}))))) return null;
  return value;
}
async function captureProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, sourceHash: unknown) {
  if (typeof sourceHash !== 'string' || !HASH.test(sourceHash)) return null;
  const capture = (await tx.get(productReviewCaseRef(context).collection('source_captures').doc(sourceHash))).data();
  if (capture?.protocol !== 'product_review_source_capture_v1' || capture.sourceHash !== sourceHash || !native(capture.capturedAt) ||
      !capture.document || supportHash(capture.document.context) !== supportHash(context) || supportSourceHash(capture.document) !== sourceHash) return null;
  return capture;
}
async function contributionProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, id: string, data: any) {
  if (!await readProductReviewContributionProof(tx, context, id, data)) return null;
  const d = data?.document;
  if (data?.protocol !== 'product_review_contribution_v1' || !d || d.protocol !== data.protocol || data.contributionId !== id ||
      !actorId(d.actorId) || !requestIdentity(d.requestId) ||
      d.contributionId !== id || id !== 'pc_' + supportHash([d.actorId, d.requestId]) || d.caseId !== productReviewCaseId(context) ||
      supportHash(d.context) !== supportHash(context) || !native(d.recordedAt) || !HASH.test(d.payloadHash ?? '') ||
      supportHash(d.command) !== d.payloadHash || supportSourceHash(d) !== data.contentHash) return null;
  const receipt = (await tx.get(db.collection('product_review_commands').doc(supportHash([d.actorId, d.requestId])))).data();
  const capture = await captureProof(tx, context, d.sourceHash);
  return receipt?.protocol === 'product_review_command_v1' && receipt.state === 'committed' && receipt.contributionId === id &&
    receipt.actorId === d.actorId && receipt.requestId === d.requestId && receipt.payloadHash === d.payloadHash &&
    native(receipt.recordedAt) && receipt.recordedAt.isEqual(d.recordedAt) && capture?.document.nativeActors?.[`${d.actorRole}Id`] === d.actorId
    ? d : null;
}
/** The immutable receipt/capture supplies historical origin, not a mutable current pointer. */
export async function eventProof(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, id: string, value: any) {
  const d = value?.document;
  if (value?.protocol !== 'product_review_workflow_event_v1' || !d || d.protocol !== value.protocol || value.eventId !== id || d.eventId !== id ||
      !actorId(d.actorId) || !requestIdentity(d.requestId) ||
      id !== eventId(d.actorId, d.requestId) || d.caseId !== productReviewCaseId(context) || supportHash(d.context) !== supportHash(context) ||
      !native(d.recordedAt) || !HASH.test(d.payloadHash ?? '') || supportHash(d.command) !== d.payloadHash ||
      supportSourceHash(d) !== value.contentHash || !Number.isSafeInteger(d.caseVersion) || d.caseVersion < 1 ||
      !Array.isArray(d.addressedTo) || d.addressedTo.length < 1 || d.addressedTo.length > 3 ||
      Object.entries(PRODUCT_REVIEW_EFFECTS).some(([k, v]) => d[k] !== v)) return null;
  let parsed: Command;
  try {parsed = input(d.command);} catch {return null;}
  if (supportHash(parsed) !== d.payloadHash || d.kind !== parsed.kind || d.sourceHash !== parsed.sourceHash) return null;
  const receipt = (await tx.get(commandRef(d.actorId, d.requestId))).data(), capture = await captureProof(tx, context, d.sourceHash);
  if (receipt?.protocol !== 'product_review_workflow_command_v1' || receipt.state !== 'committed' || receipt.eventId !== id ||
      receipt.actorId !== d.actorId || receipt.requestId !== d.requestId || receipt.payloadHash !== d.payloadHash ||
      !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt) || !capture) return null;
  if (parsed.documentaryCorpus && !await documentaryCaptureProof(tx, context, parsed)) return null;
  if (parsed.parcelAssessment && capture.document.protocol !== 'product_review_source_v4') return null;
  if (parsed.commercialReturnInstruction) {
    const instruction = await commercialReturnProof(tx, context, parsed.commercialReturnInstruction);
    if (capture.document.protocol !== 'product_review_source_v4' || d.actorRole !== 'seller' || !instruction ||
        instruction.recordedAt.toMillis() > d.recordedAt.toMillis() ||
        instruction.sellerId !== d.actorId || instruction.sellerId !== capture.document.nativeActors?.sellerId ||
        instruction.buyerId !== capture.document.nativeActors?.buyerId) return null;
  }
  if (!Array.isArray(value.recipientIds) || supportHash(value.recipientIds) !== supportHash([...new Set(d.addressedTo.map((r: any) => r?.uid))].sort())) return null;
  if (operatorKind(parsed.kind)) {
    if (d.actorRole !== 'operator' || d.operatorAuthority?.protocol !== 'current_product_review_operator_v1' ||
        d.operatorAuthority.actorId !== d.actorId || d.operatorAuthority.authorityQualifiedAtCommit !== true ||
        !Number.isSafeInteger(d.operatorAuthority.authTime) || d.operatorAuthority.authTime < 1 ||
        d.addressedTo.length !== parsed.targetRoles.length || new Set(d.addressedTo.map((r: any) => r?.role)).size !== parsed.targetRoles.length ||
        d.addressedTo.some((r: any) => !parsed.targetRoles.includes(r?.role) || capture.document.nativeActors?.[`${r.role}Id`] !== r?.uid)) return null;
  } else if (capture.document.nativeActors?.[`${d.actorRole}Id`] !== d.actorId || d.addressedTo.some((r: any) => r?.uid !== d.actorId || r.role !== d.actorRole)) return null;
  return d;
}
function eventView(d: any, admin: boolean, documentary = false, uid?: string) {
  return {protocol: d.command.parcelAssessment || d.command.commercialReturnInstruction ? 'product_review_parcel_communication_v1' : documentary ? 'product_review_communication_v2' : 'product_review_communication_v1', eventId: d.eventId, kind: d.kind, contentHash: supportSourceHash(d),
    caseVersion: d.caseVersion, text: d.command.text, result: d.command.result, parent: d.command.parent,
    sourceHash: d.sourceHash, actorRole: d.actorRole, recordedAt: d.recordedAt.toDate().toISOString(),
    privateNote: admin ? d.command.privateNote : null, contributionReferences: admin ? d.command.contributionReferences : [],
    ...(documentary ? {documentaryCorpusHash: d.command.documentaryCorpus?.hash ?? null,
      evidenceReferences: (d.command.documentaryCorpus?.evidenceReferences ?? []).filter((r: EvidenceReference) => admin || r.actorId === uid),
      documentaryEvidenceBoundAtCommit: d.command.documentaryCorpus != null} : {}),
    ...(d.command.parcelAssessment ? {parcelAssessment: admin ? d.command.parcelAssessment : null, parcelAssessmentState: 'available_sources_examined',
      responsibilityEstablished: false, indemnityGranted: false, costDecisionGranted: false} : {}),
    ...(d.command.commercialReturnInstruction ? {commercialReturnInstruction: d.command.commercialReturnInstruction} : {}),
    appliesToCurrentCaseVerified: false, originalsAccessGranted: false, ...PRODUCT_REVIEW_EFFECTS};
}
export async function readProductReviewDocumentarySet(tx: FirebaseFirestore.Transaction, context: ProductReviewContext, material = false, parcel = false) {
  const source = await readProductReviewSource(tx, context, material, parcel), root = source.caseSnap.data();
  if (root && !qualifiedRoot(root, context)) throw new HttpsError('failed-precondition', 'Le dossier doit être rapproché.');
  const ref = productReviewCaseRef(context);
  const contributions = await tx.get(ref.collection('contributions').orderBy('__name__').limit(101));
  const communications = await tx.get(ref.collection('communications').orderBy('__name__').limit(101));
  const evidence = await tx.get(ref.collection('evidence').orderBy('__name__').limit(101));
  const intents = await tx.get(db.collection('product_review_evidence_commands').where('caseId', '==', source.caseId).orderBy('__name__').limit(101));
  const contributionRows = [], communicationRows = [];
  let complete = contributions.size <= 100 && communications.size <= 100;
  for (const snap of contributions.docs.slice(0, 100)) {
    const proof = await contributionProof(tx, context, snap.id, snap.data());
    if (!proof) complete = false;
    contributionRows.push({id: snap.id, contentHash: proof ? supportSourceHash(proof) : null, proof});
  }
  for (const snap of communications.docs.slice(0, 100)) {
    const proof = await eventProof(tx, context, snap.id, snap.data());
    if (!proof) complete = false;
    communicationRows.push({id: snap.id, contentHash: proof ? supportSourceHash(proof) : null, proof});
  }
  const evidenceRows: {id: string; rawHash: string; reference: EvidenceReference | null}[] = [];
  const intentRows: {id: string; rawHash: string; reference: {evidenceId: string; state: string; receiptHash: string} | null}[] = [];
  let documentaryComplete = complete && contributions.size > 0 && evidence.size > 0 && evidence.size <= 100 && intents.size <= 100;
  let parcelIntegrityQualified = complete && contributions.size > 0 && evidence.size <= 100 && intents.size <= 100;
  for (const snap of evidence.docs.slice(0, 100)) {
    const proof = await readProductReviewEvidenceProof(tx, context, snap.id, snap.data());
    const c = proof ? contributionRows.find(r => r.id === proof.command.contributionId) : null;
    const capture = proof ? await captureProof(tx, context, proof.command.sourceHash) : null;
    const qualified = proof && c?.proof && c.contentHash === proof.command.contributionHash &&
      c.proof.actorId === proof.document.actorId && c.proof.actorRole === proof.document.actorRole &&
      capture?.document.nativeActors?.[`${proof.document.actorRole}Id`] === proof.document.actorId &&
      readProductReviewEvidenceIntentProof(proof.intent, context, supportHash([proof.document.actorId, proof.document.requestId]));
    const r: EvidenceReference | null = qualified ? {id: snap.id, contentHash: snap.data().contentHash,
      actorId: proof.document.actorId, actorRole: proof.document.actorRole, contributionId: proof.command.contributionId,
      contributionHash: proof.command.contributionHash, sourceHash: proof.command.sourceHash,
      generation: proof.document.storageProof.generation, crc32c: proof.document.storageProof.crc32c,
      sha256: proof.document.storageProof.sha256, typeDeclared: proof.command.typeDeclared,
      state: proof.intent.state, receiptHash: supportSourceHash(proof.intent)} : null;
    if (!r || r.state !== 'received') documentaryComplete = false;
    if (!r || r.state !== 'received') parcelIntegrityQualified = false;
    evidenceRows.push({id: snap.id, rawHash: supportSourceHash(snap.data()), reference: r});
  }
  for (const snap of intents.docs.slice(0, 100)) {
    const proof = readProductReviewEvidenceIntentProof(snap.data(), context, snap.id), value = proof?.intent;
    const r = value ? {evidenceId: value.evidenceId, state: value.state, receiptHash: supportSourceHash(value)} : null;
    if (!value || value.state !== 'not_executed' && (value.state !== 'received' ||
        !evidenceRows.some(row => row.reference?.id === value.evidenceId && row.reference?.receiptHash === supportSourceHash(value)))) {documentaryComplete = false; parcelIntegrityQualified = false;}
    intentRows.push({id: snap.id, rawHash: supportSourceHash(snap.data()), reference: r});
  }
  if (contributionRows.some(c => !evidenceRows.some(e => e.reference?.state === 'received' && e.reference?.contributionId === c.id))) documentaryComplete = false;
  const manifest = {protocol: 'product_review_documentary_corpus_v1', context, caseId: source.caseId, sourceHash: source.sourceHash,
    contributions: contributionRows.map((r, i) => ({id: r.id, contentHash: r.contentHash, rawHash: supportSourceHash(contributions.docs[i].data())})),
    communications: communicationRows.map((r, i) => ({id: r.id, contentHash: r.contentHash, rawHash: supportSourceHash(communications.docs[i].data())})),
    evidence: evidenceRows, intents: intentRows, documentaryComplete,
    ...(parcel ? {parcelReview: {protocol: 'product_parcel_corpus_review_v1', integrityQualified: parcelIntegrityQualified,
      availableEvidenceComplete: documentaryComplete, evidenceAvailability: contributionRows.map(c => ({contributionId: c.id,
        declared: c.proof?.command.parcelStatement?.evidenceAvailability ?? 'unknown',
        nativeFileReceived: evidenceRows.some(e => e.reference?.state === 'received' && e.reference.contributionId === c.id)})),
      photoAbsenceDoesNotProveNonreceipt: true, observationsRemainUnverified: true}} : {}),
    lookahead: {contributions: contributions.docs[100] ? {id: contributions.docs[100].id, rawHash: supportSourceHash(contributions.docs[100].data())} : null,
      communications: communications.docs[100] ? {id: communications.docs[100].id, rawHash: supportSourceHash(communications.docs[100].data())} : null,
      evidence: evidence.docs[100] ? {id: evidence.docs[100].id, rawHash: supportSourceHash(evidence.docs[100].data())} : null,
      intents: intents.docs[100] ? {id: intents.docs[100].id, rawHash: supportSourceHash(intents.docs[100].data())} : null}};
  return {source, root, contributionRows, communicationRows, evidenceRows, intentRows, documentaryComplete,
    ...(parcel ? {parcelReview: manifest.parcelReview} : {}),
    manifest, corpusHash: supportSourceHash(manifest), complete: documentaryComplete,
    coverage: {contributionsInspected: contributionRows.length, communicationsInspected: communicationRows.length, limitPerSource: 100,
      contributionsHasMore: contributions.size > 100, communicationsHasMore: communications.size > 100,
      completeCurrentCaseSet: documentaryComplete, exhaustiveHistoryVerified: false},
    documentaryCoverage: {evidenceInspected: evidenceRows.length, intentsInspected: intentRows.length,
      evidenceHasMore: evidence.size > 100, intentsHasMore: intents.size > 100, documentaryCompleteCurrentCaseSet: documentaryComplete}};
}
async function currentOperator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  const session = await assertPrivateAccountSession(request, tx), claim = session.currentAdminClaim;
  await supportAdmin(tx, uid, claim);
  const role = await tx.get(db.collection('users').doc(uid));
  return {protocol: 'current_product_review_operator_v1', actorId: uid, authTime: request.auth.token.auth_time,
    authorityQualifiedAtCommit: true, nativeAdminClaimObserved: claim,
    privateRoleRevision: supportRevision(role), privateRoleSourceHash: supportSourceHash(role.data() ?? null)};
}

export async function previewProductReviewWorkflow(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'parent', 'documentaryCapability', 'materialCapability', 'parcelCapability', 'commercialReturnInstruction', 'routeAmendmentCapability']);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw);
  const routeOptIn = raw.routeAmendmentCapability === LABEL_ROUTE_AMENDMENT_CAPABILITY;
  if (raw.routeAmendmentCapability !== undefined && !routeOptIn || routeOptIn && !parcel) throw new HttpsError('invalid-argument','Version du trajet actuel explicite requise.');
  const documentary = documentaryOptIn(raw);
  const context = productReviewContext(raw.context);
  const commercialReturnInstruction = raw.commercialReturnInstruction === undefined ? null : commercialReturnReference(raw.commercialReturnInstruction);
  if (commercialReturnInstruction && (!parcel || context.kind !== 'order' || raw.parent != null))
    throw new HttpsError('invalid-argument', 'L’instruction commerciale exige son aperçu colis explicite.');
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée invalide.');
  return withPrivateAccountSession(request, async () => {
  const result = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    if (raw.scope === 'admin') {
      await currentOperator(tx, request, uid);
      if (parcel) {assertRecentAccountAuthentication(request.auth.token); await supportAdmin(tx, uid, false);}
    }
    const set = await readProductReviewDocumentarySet(tx, context, material, parcel);
    if (raw.scope === 'own' && !productReviewRoles(set.source, uid).length) throw new HttpsError('permission-denied', 'Contexte non autorisé.');
    let commercialInstruction = null;
    if (commercialReturnInstruction) {
      const instruction = await commercialReturnProof(tx, context, commercialReturnInstruction);
      if (!instruction || instruction.buyerId !== set.source.document.nativeActors.buyerId || instruction.sellerId !== set.source.document.nativeActors.sellerId ||
          raw.scope === 'own' && instruction.sellerId !== uid) throw new HttpsError('permission-denied', 'Instruction vendeur native non qualifiée.');
      const order = (await tx.get(db.collection('transactions').doc(context.id))).data();
      commercialInstruction = {reference: instruction.reference, action: instruction.action, partyMessage: instruction.partyMessage,
        sourceHash: instruction.sourceHash, recordedAt: instruction.recordedAt.toDate().toISOString(),
        currentPointerMatches: supportHash(order?.productCommercialReturnInstruction ?? null) === supportHash({instructionId: instruction.reference.instructionId, contentHash: instruction.reference.contentHash}),
        currentInstructionVerified: false, ...PRODUCT_REVIEW_EFFECTS};
    }
    let parent = null;
    if (raw.parent != null) {
      const r = reference(raw.parent), value = (await tx.get(productReviewCaseRef(context).collection('communications').doc(r.id))).data();
      const proof = await eventProof(tx, context, r.id, value);
      if (!proof || supportSourceHash(proof) !== r.contentHash || raw.scope === 'own' && !proof.addressedTo.some((p: any) => p.uid === uid))
        throw new HttpsError('permission-denied', 'Échange adressé non qualifié.');
      if ((proof.command.parcelAssessment || proof.command.commercialReturnInstruction) && !parcel) throw new HttpsError('failed-precondition', 'Cet échange exige le lecteur explicite du constat colis.');
      if (!documentary && raw.scope === 'admin' && proof.command.contributionReferences.length > 20)
        throw new HttpsError('failed-precondition', 'Cet échange exige le lecteur explicite du corpus documentaire.');
      parent = eventView(proof, raw.scope === 'admin', documentary, uid);
    }
    return {protocol: parcel ? 'product_review_parcel_workflow_preview_v1' : documentary ? 'product_review_workflow_preview_v2' : 'product_review_workflow_preview_v1', actorId: uid, scope: raw.scope,
      source: productReviewSourceView(set.source, uid), caseVersion: set.root?.version ?? 0, parent,
      contributionReferences: raw.scope === 'admin' ? set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash, qualification: r.proof ? 'native_contribution' : 'unknown'})) : [],
      communicationReferences: raw.scope === 'admin' ? set.communicationRows.map(r => ({id: r.id, contentHash: r.contentHash, kind: r.proof?.kind ?? null, qualification: r.proof ? 'native_communication' : 'unknown'})) : [],
      recipientRoles: raw.scope === 'admin' ? (['buyer', 'seller', 'reporter'] as const).filter(r => set.source.document.nativeActors[`${r}Id`] !== null) : [],
      coverage: documentary ? {...set.coverage, ...set.documentaryCoverage} : set.coverage,
      ...(documentary ? {documentaryCorpusHash: set.corpusHash,
        evidenceReferences: set.evidenceRows.filter(r => raw.scope === 'admin' || r.reference?.actorId === uid)
          .map(r => r.reference ? {qualification: 'native_stored_file', evidence: r.reference} : {qualification: 'unknown', evidenceId: r.id, evidence: null}),
        documentaryEvidenceBoundAtPreview: true} : {}),
      ...(parcel ? {parcelReview: set.parcelReview} : {}),
      ...(parcel && raw.scope === 'admin' && 'parcelSources' in set.source.document && set.source.document.parcelSources ?
        {operatorParcelRoutes: operatorProductParcelSources(set.source.document.parcelSources, set.source.sourceHash, set.corpusHash, routeOptIn)} : {}),
      ...(commercialInstruction ? {commercialReturnInstruction: commercialInstruction} : {}),
      options: raw.scope === 'admin' ? ['ask_details', 'communicate_summary', 'issue_outcome'] :
        commercialInstruction ? ['contest'] : parent?.kind === 'ask_details' ? ['respond'] : parent?.kind === 'issue_outcome' ? ['contest'] : [],
      decisionPermissionGranted: false, ...PRODUCT_REVIEW_EFFECTS};
  });
  if (raw.scope === 'admin') await db.runTransaction(tx => currentOperator(tx, request, uid));
  return result;
  });
}

function resultView(uid: string, requestId: string, command: Command, receipt?: any) {
  return {protocol: 'product_review_workflow_command_v1', actorId: uid, requestId, payloadHash: supportHash(command),
    caseId: productReviewCaseId(command.context), eventId: receipt?.eventId ?? null, state: receipt?.state ?? 'unrecorded',
    reason: receipt?.reason ?? null, caseVersionAtCommit: receipt?.caseVersion ?? null,
    recordedAt: native(receipt?.recordedAt) ? receipt.recordedAt.toDate().toISOString() : null,
    currentSourceVerified: false, currentInstructionVerified: false, ...PRODUCT_REVIEW_EFFECTS};
}

export async function commandProductReviewWorkflow(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'requestId', 'action', 'command', 'documentaryCapability', 'materialCapability', 'parcelCapability', 'routeAmendmentCapability']);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw);
  const routeOptIn = raw.routeAmendmentCapability === LABEL_ROUTE_AMENDMENT_CAPABILITY;
  if (raw.routeAmendmentCapability !== undefined && !routeOptIn || routeOptIn && !parcel) throw new HttpsError('invalid-argument','Version du trajet actuel explicite requise.');
  const documentary = documentaryOptIn(raw);
  const requestId = supportRequestId(raw.requestId), command = input(raw.command), payloadHash = supportHash(command);
  if ((command.parcelAssessment || command.commercialReturnInstruction) && !parcel) throw new HttpsError('invalid-argument', 'Version colis explicite requise pour cet examen.');
  if (!['execute', 'observe', 'neutralize'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Action de journal invalide.');
  const id = eventId(uid, requestId), receiptRef = commandRef(uid, requestId), ref = productReviewCaseRef(command.context);
  return withPrivateAccountSession(request, () => db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const receipt = (await tx.get(receiptRef)).data();
    // Exact historical origin first; source/role changes cannot create another
    // event or expose any new operator/other-party data on this replay.
    if (receipt) {
      if (receipt.protocol !== 'product_review_workflow_command_v1' || receipt.actorId !== uid || receipt.requestId !== requestId ||
          receipt.payloadHash !== payloadHash || supportHash(receipt.command) !== payloadHash || !native(receipt.recordedAt) ||
          !['committed', 'not_executed'].includes(receipt.state)) throw new HttpsError('already-exists', 'Référence d’intention différente ou inconnue.');
      if (receipt.state === 'committed') {
        const proof = await eventProof(tx, command.context, id, (await tx.get(ref.collection('communications').doc(id))).data());
        if (!proof || receipt.eventId !== id || proof.actorId !== uid || proof.payloadHash !== payloadHash ||
            proof.caseVersion !== receipt.caseVersion || !proof.recordedAt.isEqual(receipt.recordedAt))
          throw new HttpsError('failed-precondition', 'Le reçu historique de l’échange doit être rapproché.');
      } else if (receipt.eventId !== null || receipt.caseVersion !== null ||
          !['requester_neutralized', 'source_changed', 'reference_unqualified', 'incomplete_case_history'].includes(receipt.reason))
        throw new HttpsError('failed-precondition', 'La non-exécution de l’échange doit être rapprochée.');
      return resultView(uid, requestId, command, receipt);
    }
    if (raw.action === 'observe') return resultView(uid, requestId, command);
    const recordedAt = Timestamp.now();
    const noEffect = (reason: string) => {
      const value = {protocol: 'product_review_workflow_command_v1', actorId: uid, requestId, payloadHash, command,
        state: 'not_executed', eventId: null, caseVersion: null, reason, recordedAt};
      tx.create(receiptRef, value); return resultView(uid, requestId, command, value);
    };
    if (raw.action === 'neutralize') return noEffect('requester_neutralized');
    assertProductMaterialNewOpen(material); assertProductParcelNewOpen(parcel);
    const admin = operatorKind(command.kind), authority = admin ? await currentOperator(tx, request, uid) : null;
    const set = await readProductReviewDocumentarySet(tx, command.context, material, parcel), source = set.source;
    const ownRoles = productReviewRoles(source, uid);
    if (!admin && !ownRoles.length) throw new HttpsError('permission-denied', 'Participant natif non autorisé.');
    if (command.sourceHash !== source.sourceHash) return noEffect('source_changed');
    if (set.root && set.root.version >= Number.MAX_SAFE_INTEGER - 1) throw new HttpsError('failed-precondition', 'Version du dossier à rapprocher.');
    if (command.kind === 'issue_outcome' && command.result === 'review_documented' &&
        (!documentary || !command.documentaryCorpus || !set.documentaryComplete)) return noEffect('incomplete_case_history');
    if (command.documentaryCorpus) {
      if (!documentary) return noEffect('reference_unqualified');
      if (command.documentaryCorpus.hash !== set.corpusHash) return noEffect('source_changed');
      for (const r of command.documentaryCorpus.evidenceReferences) {
        const row = set.evidenceRows.find(e => e.id === r.id);
        if (!admin && row?.reference?.actorId !== uid) throw new HttpsError('permission-denied', 'Pièce privée non autorisée.');
        if (!row?.reference || supportHash(row.reference) !== supportHash(r)) return noEffect('reference_unqualified');
      }
      if (command.kind === 'issue_outcome' && command.result === 'review_documented' &&
          (supportHash(command.documentaryCorpus.evidenceReferences) !== supportHash(set.evidenceRows.map(r => r.reference)) ||
           supportHash(command.contributionReferences) !== supportHash(set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash})))))
        return noEffect('reference_unqualified');
    }
    if (command.parcelAssessment && (set.parcelReview?.integrityQualified !== true ||
        command.result === 'review_documented' && !set.documentaryComplete ||
        !('parcelSources' in set.source.document && set.source.document.parcelSources?.legs.some(l => l.leg === command.parcelAssessment!.leg &&
          (l.identity?.labelId ?? null) === command.parcelAssessment!.labelId &&
          (command.result !== 'review_documented' || l.qualification === 'native_current_label'))))) return noEffect('incomplete_case_history');
    if (command.parcelAssessment && (supportHash(command.contributionReferences) !== supportHash(set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash}))) ||
        supportHash(command.documentaryCorpus!.evidenceReferences) !== supportHash(set.evidenceRows.map(r => r.reference)))) return noEffect('reference_unqualified');
    if (command.parcelAssessment && command.parcelAssessment.locationComparison !== 'unknown' && !routeOptIn &&
        'parcelSources' in set.source.document && set.source.document.parcelSources?.legs.some(l=>l.leg===command.parcelAssessment!.leg&&Object.prototype.hasOwnProperty.call(l,'currentRoute')))
      return noEffect('incomplete_case_history');
    if (command.parcelAssessment && command.parcelAssessment.locationComparison !== 'unknown' &&
        !('parcelSources' in set.source.document && set.source.document.parcelSources && parcelLocationComparisonQualified(set.source.document.parcelSources, command.parcelAssessment.leg)))
      return noEffect('incomplete_case_history');
    let actorRole: ProductReviewRole | 'operator' = 'operator';
    if (command.commercialReturnInstruction) {
      const instruction = await commercialReturnProof(tx, command.context, command.commercialReturnInstruction);
      if (!instruction) return noEffect('reference_unqualified');
      if (!ownRoles.includes('seller') || instruction.sellerId !== uid || instruction.sellerId !== source.document.nativeActors.sellerId ||
          instruction.buyerId !== source.document.nativeActors.buyerId) throw new HttpsError('permission-denied', 'Seul le vendeur natif peut contester son instruction.');
      actorRole = 'seller';
    }
    if (command.parent) {
      const parent = await eventProof(tx, command.context, command.parent.id,
        (await tx.get(ref.collection('communications').doc(command.parent.id))).data());
      if (!parent || !parent.addressedTo.some((p: any) => p.uid === uid)) throw new HttpsError('permission-denied', 'Échange adressé non autorisé.');
      if (supportSourceHash(parent) !== command.parent.contentHash ||
          command.kind === 'respond' && parent.kind !== 'ask_details' || command.kind === 'contest' && parent.kind !== 'issue_outcome')
        return noEffect('reference_unqualified');
      actorRole = ownRoles.find(r => parent.addressedTo.some((p: any) => p.uid === uid && p.role === r))!;
      if (!actorRole) throw new HttpsError('permission-denied', 'Rôle natif de l’échange non qualifié.');
    }
    for (const r of command.contributionReferences) {
      const proof = await contributionProof(tx, command.context, r.id, (await tx.get(ref.collection('contributions').doc(r.id))).data());
      if (!admin && proof?.actorId !== uid) throw new HttpsError('permission-denied', 'Contribution privée non autorisée.');
      if (!proof || supportSourceHash(proof) !== r.contentHash) return noEffect('reference_unqualified');
    }
    const addressedTo = admin ? command.targetRoles.map(role => ({role, uid: source.document.nativeActors[`${role}Id`]})) : [{role: actorRole, uid}];
    if (addressedTo.some(p => !p.uid)) return noEffect('reference_unqualified');
    const captureRef = ref.collection('source_captures').doc(source.sourceHash), capture = await tx.get(captureRef);
    if (capture.exists && !await captureProof(tx, command.context, source.sourceHash)) throw new HttpsError('failed-precondition', 'Capture native à rapprocher.');
    const documentaryRef = command.documentaryCorpus ? corpusRef(command.context, command.documentaryCorpus.hash) : null;
    const oldDocumentary = documentaryRef ? await tx.get(documentaryRef) : null;
    if (oldDocumentary?.exists && !await documentaryCaptureProof(tx, command.context, command))
      throw new HttpsError('failed-precondition', 'Capture documentaire native à rapprocher.');
    const eventRef = ref.collection('communications').doc(id), oldEvent = await tx.get(eventRef);
    const alertRef = db.collection('admin_alerts').doc(`product_review_exchange_${id}`), oldAlert = !admin ? await tx.get(alertRef) : null;
    if (oldEvent.exists || oldAlert?.exists) throw new HttpsError('failed-precondition', 'Échange ou alerte sans reçu à rapprocher.');
    const notices = await prepareOperationalNotices(tx, [...new Set(addressedTo.map(p => p.uid as string))].map(userId => ({
      eventKey: `product_review_exchange_v1:${id}`, userId, type: 'product_review_update', title: 'Examen de l’article',
      message: admin ? 'Un échange de l’équipe vous est adressé dans le dossier de l’article. Consultez son texte et sa version ; aucun remboursement ou permis de livraison n’est confirmé par cet avis.'
        : 'Votre réponse ou contestation a été enregistrée sur la version du dossier indiquée. Son examen reste distinct des fonds et de la livraison.',
      data: {ownerId: userId, productReviewCaseId: source.caseId, contextKind: command.context.kind, contextId: command.context.id, productReviewEventId: id}})));
    const caseVersion = (set.root?.version ?? 0) + 1;
    const document = {protocol: 'product_review_workflow_event_v1', eventId: id, caseId: source.caseId, context: command.context,
      actorId: uid, actorRole, requestId, payloadHash, command, kind: command.kind, sourceHash: source.sourceHash,
      caseVersion, addressedTo, operatorAuthority: authority, recordedAt, ...PRODUCT_REVIEW_EFFECTS};
    const contentHash = supportSourceHash(document);
    if (!capture.exists) tx.create(captureRef, {protocol: 'product_review_source_capture_v1', sourceHash: source.sourceHash,
      document: source.document, capturedAt: recordedAt});
    if (documentaryRef && !oldDocumentary?.exists) tx.create(documentaryRef, {protocol: 'product_review_documentary_capture_v1',
      hash: command.documentaryCorpus!.hash, document: set.manifest, capturedAt: recordedAt});
    tx.create(eventRef, {protocol: document.protocol, eventId: id, document, contentHash,
      recipientIds: [...new Set(addressedTo.map(p => p.uid as string))].sort()});
    const state = command.kind === 'issue_outcome' && command.result === 'review_documented' ? 'documented' : 'awaiting_review';
    const outcomePointer = command.kind === 'issue_outcome' ? {latestOutcome: {eventId: id, contentHash, caseVersion}} : {};
    if (!set.root) tx.create(ref, {protocol: 'product_review_case_v1', caseId: source.caseId, context: command.context,
      articleId: source.document.articleId, nativeActors: source.document.nativeActors, version: caseVersion, createdAt: recordedAt,
      latestCommunicationAt: recordedAt, state, ...outcomePointer, ...PRODUCT_REVIEW_EFFECTS});
    else tx.update(ref, {version: caseVersion, latestCommunicationAt: recordedAt, state, ...outcomePointer});
    if (!admin) tx.create(alertRef, {kind: 'product_review', severity: 'warning', refId: source.caseId, status: 'open', createdAt: recordedAt,
      message: 'Réponse ou contestation à examiner sur sa version exacte ; aucune autorité financière ou physique n’en découle.',
      context: {caseId: source.caseId, eventId: id, parent: command.parent,
        ...(command.commercialReturnInstruction ? {commercialReturnInstruction: command.commercialReturnInstruction} : {})}});
    const value = {protocol: 'product_review_workflow_command_v1', actorId: uid, requestId, payloadHash, command,
      state: 'committed', eventId: id, caseVersion, reason: null, recordedAt};
    tx.create(receiptRef, value); notices.commit();
    return resultView(uid, requestId, command, value);
  }));
}

export async function readProductReviewCommunications(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'cursor', 'documentaryCapability', 'materialCapability', 'parcelCapability']);
  if (productMaterialRequested(raw) && raw.context?.kind !== 'order') throw new HttpsError('invalid-argument', 'Commande native requise.');
  const documentary = documentaryOptIn(raw);
  const parcel = productParcelRequested(raw);
  if (parcel && raw.context?.kind !== 'order') throw new HttpsError('invalid-argument', 'Commande native requise pour le colis.');
  const context = productReviewContext(raw.context);
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée de lecture invalide.');
  const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (cursor !== null && !documentId(cursor)) throw new HttpsError('invalid-argument', 'Page invalide.');
  return withPrivateAccountSession(request, async () => {
    const authorize = async (tx: FirebaseFirestore.Transaction) => {
      const session = await assertPrivateAccountSession(request, tx);
      if (raw.scope === 'admin') await supportAdmin(tx, uid, session.currentAdminClaim);
    };
    const result = await db.runTransaction(async tx => {
      const admin = raw.scope === 'admin';
      await authorize(tx);
      const ref = productReviewCaseRef(context), root = (await tx.get(ref)).data();
      if (!root || !qualifiedRoot(root, context)) throw new HttpsError('failed-precondition', 'Dossier natif à rapprocher.');
      if (!admin && !['buyerId', 'sellerId', 'reporterId'].some(r => root.nativeActors?.[r] === uid)) throw new HttpsError('permission-denied', 'Dossier non autorisé.');
      let query: FirebaseFirestore.Query = ref.collection('communications');
      if (!admin) query = query.where('recipientIds', 'array-contains', uid);
      query = query.orderBy('__name__').limit(21);
      if (cursor) query = query.startAfter(cursor);
      const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
      for (const snap of inspected) {
        const proof = await eventProof(tx, context, snap.id, snap.data());
        entries.push(proof && (parcel || !proof.command.parcelAssessment && !proof.command.commercialReturnInstruction) && (documentary || !admin || proof.command.contributionReferences.length <= 20) &&
          (admin || proof.addressedTo.some((p: any) => p.uid === uid))
          ? {qualification: 'native_addressed_communication', communication: eventView(proof, admin, documentary, uid)}
          : {qualification: 'unknown', eventId: snap.id, communication: null});
      }
      return {protocol: parcel ? 'product_review_parcel_communications_page_v1' : documentary ? 'product_review_communications_page_v2' : 'product_review_communications_page_v1', actorId: uid, scope: raw.scope, caseId: productReviewCaseId(context),
        entries, readAt: Timestamp.now().toDate().toISOString(), nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null,
        coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false},
        otherPartiesRawContributionsVisible: admin, privateAnalysisVisible: admin, originalsAccessGranted: false, ...PRODUCT_REVIEW_EFFECTS};
    });
    await db.runTransaction(authorize);
    return result;
  });
}
