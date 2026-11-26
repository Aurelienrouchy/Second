import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { auth, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { ProductReviewArticleText, ProductReviewAttempt, ProductReviewCommunication, ProductReviewCommunications,
  ProductReviewContext, ProductReviewContribution, ProductReviewContributions, ProductReviewCursor, ProductReviewFacts,
  ProductReviewIdentity, ProductReviewPreview, ProductReviewReceipt, ProductReviewReference, ProductReviewScope,
  ProductReviewSource, ProductReviewWorkflowPreview, ProductReviewWorkflowPreviewV2, ProductReviewCommunicationView, ProductReviewCommunicationsV2,
  ProductCommercialReturnContestReference } from '@/types/productReview';
import type { ProductReviewEvidenceReference } from '@/types/productReviewEvidence';
import { isArticleChildSafetySource } from '@/utils/articleChildSafetyInput';
import { isProductMaterialSources, isProductMaterialStatement, productMaterialScopeMatchesRole, PRODUCT_MATERIAL_REASONS, PRODUCT_MATERIAL_QUALIFICATION } from '@/utils/productMaterialStatement';
import { isProductCommercialReturnCommand, isProductCommercialReturnReference } from '@/utils/productCommercialReturnContract';
import { PRODUCT_ROUTING_QUALIFICATION, isProductRoutingStatement } from '@/utils/productRoutingStatement';
import {PRODUCT_MIXED_ORDERS_QUALIFICATION,isProductMixedOrderStatement} from '@/utils/productMixedOrderStatement';
import { isProductParcelAssessment, isProductParcelCorpusReview, isProductParcelOperatorRoutes, isProductParcelSources, isProductParcelStatement, productParcelRoleMatches, PRODUCT_PARCEL_QUALIFICATION, PRODUCT_PARCEL_REASONS,PRODUCT_PARCEL_MIXED_REASON } from '@/utils/productParcelStatement';

export const PRODUCT_REVIEW_TOPICS = ['authenticity', 'recall', 'child_safety', 'hygiene', 'animal_material'] as const;
export const PRODUCT_REVIEW_ROLES = ['buyer', 'seller', 'reporter'] as const;
export const PRODUCT_REVIEW_FACT_LIMITS = {brand: 300, model: 300, productReference: 300, lot: 300, category: 500, intendedUse: 1000,
  recallReference: 1000, officialSourceDeclared: 1000, childSafetyObservation: 2000, hygieneObservation: 2000, conditionObserved: 1000,
  sealOrUseObservation: 1000, species: 300, provenance: 2000, expertiseSummary: 2000} as const;
const EFFECTS = ['authenticityVerified', 'recallApplicabilityVerified', 'childSafetyVerified', 'hygieneVerified',
  'speciesOrProvenanceVerified', 'financialEffectAuthorized', 'inventoryEffectAuthorized', 'shippingPermissionGranted',
  'physicalContentsVerified', 'legalDeadlineEstablished'];
const KINDS = ['ask_details', 'communicate_summary', 'issue_outcome', 'respond', 'contest'];
const OUTCOMES = ['information_incomplete', 'review_documented', 'additional_action_required'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const none = (v: Record<string, unknown>) => EFFECTS.every(k => v[k] === false);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uid = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 128 && !v.includes('/');
const text = (v: unknown, max: number, trimmed = false): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && (!trimmed || v.trim() === v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const date = (v: unknown) => v === null || iso(v);
const count = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const revision = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}:\d{1,9}$/.test(v) && Number.isSafeInteger(Number(v.split(':')[0])) &&
  Number(v.split(':')[0]) <= 253402300799 && Number(v.split(':')[1]) < 1_000_000_000;
export function productReviewDocumentId(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.includes('/') || ['.', '..'].includes(v) || /^__.*__$/.test(v)) return false;
  try {return encodeURIComponent(v).replace(/%[a-f0-9]{2}/gi, '_').length <= 1500;} catch {return false;}
}
export const isProductReviewContext = (v: unknown): v is ProductReviewContext => object(v) && exact(v, ['kind', 'id']) &&
  ['order', 'article_report', 'article_listing'].includes(String(v.kind)) && typeof v.id === 'string' && v.id.length <= 128 && v.id === v.id.trim() && productReviewDocumentId(v.id);
const nativeId = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export const productReviewEqual = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const productReviewHash = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
const failure = () => new Error('Le dossier privé et ses sources doivent être relus. Les déclarations ne certifient aucun fait matériel.');
function identity(v: unknown): v is ProductReviewIdentity {
  return object(v) && exact(v, ['present', 'revision', 'sourceHash']) && typeof v.present === 'boolean' &&
    (v.revision === null || revision(v.revision)) && (v.sourceHash === null || hash(v.sourceHash)) &&
    (v.present || v.revision === null && v.sourceHash === null);
}
function article(v: unknown): v is ProductReviewArticleText {
  const limits = {title: 500, description: 8000, condition: 200, brand: 300, brandStatus: 100, category: 300, model: 300,
    lot: 300, productReference: 300, species: 300, provenance: 2000};
  return object(v) && exact(v, [...Object.keys(limits), 'categoryIds', 'materials', 'imageCountRecorded', 'imagesAreReceivedItemEvidence']) &&
    Object.entries(limits).every(([k, max]) => v[k] === null || text(v[k], max)) && ['categoryIds', 'materials'].every(k => v[k] === null ||
      Array.isArray(v[k]) && v[k].length <= 20 && v[k].every(s => text(s, 200))) &&
    (v.imageCountRecorded === null || count(v.imageCountRecorded, 100)) && v.imagesAreReceivedItemEvidence === false;
}
const roleArray = (v: unknown): v is ProductReviewSource['actorRoles'] => Array.isArray(v) && v.length <= 3 && new Set(v).size === v.length &&
  v.every(r => PRODUCT_REVIEW_ROLES.includes(r));
export function isProductReviewSource(v: unknown, expectedUid: string, context: ProductReviewContext, caseId: string, scope: ProductReviewScope, material = false, parcel = false): v is ProductReviewSource {
  const listing = context.kind === 'article_listing';
  if (!object(v) || !exact(v, ['protocol', 'context', 'articleId', 'contextSource', 'articleSource', 'caseSource', 'sources', 'caseId', 'sourceHash',
    'actorId', 'actorRoles', 'readAt', 'originalsAccessGranted', 'exhaustiveHistoryVerified', ...(listing ? ['listingSubmission'] : []), ...(material || parcel ? ['materialAttributes'] : []), ...(parcel ? ['parcelSources'] : []), ...EFFECTS]) ||
    v.protocol !== (parcel ? 'product_review_source_v4' : material ? 'product_review_source_v3' : listing ? 'product_review_source_v2' : 'product_review_source_v1') || (material || parcel) && (context.kind !== 'order' || !isProductMaterialSources(v.materialAttributes)) || parcel && !isProductParcelSources(v.parcelSources) ||
    !productReviewEqual(v.context, context) || v.caseId !== caseId || v.actorId !== expectedUid || !roleArray(v.actorRoles) ||
    scope === 'own' && !v.actorRoles.length || !hash(v.sourceHash) || !iso(v.readAt) || v.articleId !== null && !uid(v.articleId) ||
    !identity(v.contextSource) || v.contextSource.present !== true || !identity(v.articleSource) || !identity(v.caseSource) ||
    v.originalsAccessGranted !== false || v.exhaustiveHistoryVerified !== false || !none(v) || !object(v.sources) ||
    !exact(v.sources, ['contractSnapshot', 'currentListing', 'reportedListing', 'receivedItem'])) return false;
  if (listing && (v.articleId !== context.id || !object(v.listingSubmission) || !exact(v.listingSubmission, ['moderationStatus', 'isActive', 'childSafety', 'admissionPermissionGranted']) ||
    !(v.listingSubmission.moderationStatus === null || text(v.listingSubmission.moderationStatus, 100)) || !(v.listingSubmission.isActive === null || typeof v.listingSubmission.isActive === 'boolean') ||
    !isArticleChildSafetySource(v.listingSubmission.childSafety, context.id) || scope === 'own' && (v.listingSubmission.childSafety.sellerId !== expectedUid || !productReviewEqual(v.actorRoles, ['seller'])) ||
    v.listingSubmission.admissionPermissionGranted !== false || !object(v.sources.contractSnapshot) || v.sources.contractSnapshot.qualification !== 'unknown' || !object(v.sources.reportedListing) || v.sources.reportedListing.qualification !== 'unknown')) return false;
  const c = v.sources.contractSnapshot, l = v.sources.currentListing, r = v.sources.reportedListing, received = v.sources.receivedItem;
  return object(c) && exact(c, ['qualification', 'content', 'executedAgreementVerified']) &&
    ['native_order_snapshot_recorded', 'unknown'].includes(String(c.qualification)) && c.executedAgreementVerified === false && article(c.content) &&
    object(l) && exact(l, ['qualification', 'content']) && ['current_listing_recorded', 'unknown'].includes(String(l.qualification)) && article(l.content) &&
    object(r) && exact(r, ['qualification', 'articleRevision', 'contentHash', 'capturedAt', 'mediaCount', 'content']) && article(r.content) &&
    (r.qualification === 'native_report_capture' ? revision(r.articleRevision) && hash(r.contentHash) && iso(r.capturedAt) && count(r.mediaCount, 100) :
      r.qualification === 'unknown' && r.articleRevision === null && r.contentHash === null && r.capturedAt === null && r.mediaCount === null) &&
    object(received) && exact(received, ['qualification', 'source', 'physicalContentsVerified']) && received.qualification === 'unknown' &&
    received.source === 'requires_separate_participant_declaration' && received.physicalContentsVerified === false;
}
const source = isProductReviewSource;
function facts(v: unknown): v is ProductReviewFacts {
  return object(v) && exact(v, Object.keys(PRODUCT_REVIEW_FACT_LIMITS)) && Object.entries(PRODUCT_REVIEW_FACT_LIMITS)
    .every(([k, max]) => v[k] === null || text(v[k], max, true));
}
const reference = (v: unknown): v is ProductReviewReference => object(v) && exact(v, ['id', 'contentHash']) && productReviewDocumentId(v.id) && hash(v.contentHash);
export const isProductCommercialReturnContestReference = (v: unknown): v is ProductCommercialReturnContestReference => object(v) && exact(v, ['instructionId', 'contentHash', 'caseVersion']) &&
  nativeId(v.instructionId, 'pri') && hash(v.contentHash) && count(v.caseVersion, Number.MAX_SAFE_INTEGER) && v.caseVersion > 0;
function references(v: unknown, max = 20): v is ProductReviewReference[] {
  return Array.isArray(v) && v.length <= max && v.every(reference) && new Set(v.map(r => r.id)).size === v.length;
}
export function isProductReviewEvidenceReference(v: unknown): v is ProductReviewEvidenceReference {
  return object(v) && exact(v, ['id', 'contentHash', 'actorId', 'actorRole', 'contributionId', 'contributionHash', 'sourceHash', 'generation', 'crc32c', 'sha256', 'typeDeclared', 'state', 'receiptHash']) &&
    nativeId(v.id, 'pf') && uid(v.actorId) && PRODUCT_REVIEW_ROLES.includes(v.actorRole as 'buyer') && nativeId(v.contributionId, 'pc') &&
    ['contentHash', 'contributionHash', 'sourceHash', 'sha256', 'receiptHash'].every(k => hash(v[k])) && typeof v.generation === 'string' && /^\d{1,20}$/.test(v.generation) &&
    typeof v.crc32c === 'string' && /^[A-Za-z0-9+/]{6}==$/.test(v.crc32c) && ['received_item_photo', 'supporting_document_image', 'expertise_image'].includes(String(v.typeDeclared)) &&
    ['received', 'stored_requires_review'].includes(String(v.state));
}
function corpus(v: unknown): boolean {
  return object(v) && exact(v, ['hash', 'evidenceReferences']) && hash(v.hash) && Array.isArray(v.evidenceReferences) && v.evidenceReferences.length <= 100 &&
    v.evidenceReferences.every(isProductReviewEvidenceReference) && new Set(v.evidenceReferences.map(r => r.id)).size === v.evidenceReferences.length;
}
export function isProductReviewAttempt(v: unknown, expectedUid: string): v is ProductReviewAttempt {
  const material = object(v) && Object.prototype.hasOwnProperty.call(v, 'materialCapability');
  const parcel = object(v) && Object.prototype.hasOwnProperty.call(v, 'parcelCapability');
  const route = object(v) && Object.prototype.hasOwnProperty.call(v, 'routeAmendmentCapability');
  const routing = object(v) && Object.hasOwn(v, 'routingCapability');
  const mixed=object(v)&&Object.hasOwn(v,'mixedOrdersCapability');
  if (!object(v) || !exact(v, ['version', 'uid', 'requestId', 'context', 'type', 'command', ...(material ? ['materialCapability'] : []), ...(parcel ? ['parcelCapability'] : []), ...(route ? ['routeAmendmentCapability'] : []), ...(routing ? ['routingCapability'] : []),...(mixed?['mixedOrdersCapability']:[])]) || mixed&&(!parcel||v.type!=='contribution'||v.mixedOrdersCapability!=='product_review_mixed_orders_v1') || routing && (!parcel || v.type !== 'contribution' || v.routingCapability !== 'product_review_routing_v1') || route && (!parcel || v.type !== 'workflow' || v.routeAmendmentCapability !== 'label_route_amendment_v1') || parcel && v.parcelCapability !== 'product_review_parcel_v1' ||
    material && v.materialCapability !== 'product_review_material_v1' || v.version !== 1 || v.uid !== expectedUid || !uid(expectedUid) ||
    typeof v.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) || !isProductReviewContext(v.context) || !object(v.command)) return false;
  const c = v.command;
  if (v.type === 'commercial_return') return material && v.context.kind === 'order' && isProductCommercialReturnCommand(c, isProductReviewEvidenceReference) && c.transactionId === v.context.id && parcel === (c.parcelCapability === 'product_review_parcel_v1');
  if (!productReviewEqual(c.context, v.context) || !hash(c.sourceHash) || (material || parcel) && v.context.kind !== 'order') return false;
  const materialStatement = Object.prototype.hasOwnProperty.call(c, 'materialStatement');
  const parcelStatement = Object.prototype.hasOwnProperty.call(c, 'parcelStatement');
  const routingStatement = Object.hasOwn(c, 'routingStatement');
  const mixedStatement=Object.hasOwn(c,'mixedOrderStatement');
  if (v.type === 'contribution') return exact(c, ['context', 'sourceHash', 'actorRole', 'topic', 'statement', 'facts', 'observedAt', ...(materialStatement ? ['materialStatement'] : []), ...(parcelStatement ? ['parcelStatement'] : []), ...(routingStatement ? ['routingStatement'] : []),...(mixedStatement?['mixedOrderStatement']:[])]) && routing === routingStatement &&mixed===mixedStatement&&
    (!mixedStatement||parcelStatement&&isProductMixedOrderStatement(c.mixedOrderStatement)&&isProductParcelStatement(c.parcelStatement,mixed&&mixedStatement&&isProductMixedOrderStatement(c.mixedOrderStatement))&&c.mixedOrderStatement.leg===c.parcelStatement.leg&&c.mixedOrderStatement.labelId===c.parcelStatement.labelId)&&
    (!routingStatement || parcelStatement && isProductRoutingStatement(c.routingStatement) && isProductParcelStatement(c.parcelStatement,mixed&&mixedStatement&&isProductMixedOrderStatement(c.mixedOrderStatement)) && c.routingStatement.leg === c.parcelStatement.leg && c.routingStatement.labelId === c.parcelStatement.labelId) &&
    PRODUCT_REVIEW_ROLES.includes(c.actorRole as 'buyer') && (parcelStatement ? parcel && !materialStatement && c.topic === 'parcel_delivery' && c.actorRole !== 'reporter' && isProductParcelStatement(c.parcelStatement,mixed&&mixedStatement&&isProductMixedOrderStatement(c.mixedOrderStatement)) && productParcelRoleMatches(c.parcelStatement, String(c.actorRole)) : materialStatement ? material && c.topic === 'nonconformity' && c.actorRole !== 'reporter' && isProductMaterialStatement(c.materialStatement) && productMaterialScopeMatchesRole(c.materialStatement, String(c.actorRole)) : PRODUCT_REVIEW_TOPICS.includes(c.topic as 'authenticity')) &&
    text(c.statement, 4000, true) && facts(c.facts) && date(c.observedAt) && (c.observedAt === null || Date.parse(c.observedAt) <= Date.now());
  const documentary = Object.prototype.hasOwnProperty.call(c, 'documentaryCorpus');
  const parcelAssessment = Object.prototype.hasOwnProperty.call(c, 'parcelAssessment');
  const commercial = Object.prototype.hasOwnProperty.call(c, 'commercialReturnInstruction');
  if (v.type !== 'workflow' || !exact(c, ['context', 'sourceHash', 'kind', 'text', 'targetRoles', 'privateNote', 'result', 'contributionReferences', 'parent', 'acknowledged', ...(documentary ? ['documentaryCorpus'] : []), ...(parcelAssessment ? ['parcelAssessment'] : []), ...(commercial ? ['commercialReturnInstruction'] : [])]) ||
    parcelAssessment && (!parcel || !documentary || c.kind !== 'issue_outcome' || !isProductParcelAssessment(c.parcelAssessment)) ||
    commercial && (!parcel || v.context.kind !== 'order' || c.kind !== 'contest' || c.parent !== null || !isProductCommercialReturnContestReference(c.commercialReturnInstruction)) ||
    !KINDS.includes(String(c.kind)) || !text(c.text, 4000, true) || !roleArray(c.targetRoles) ||
    !productReviewEqual(c.targetRoles, [...c.targetRoles].sort()) || !references(c.contributionReferences, documentary ? 100 : 20) || documentary && !corpus(c.documentaryCorpus)) return false;
  const admin = ['ask_details', 'communicate_summary', 'issue_outcome'].includes(String(c.kind));
  return (c.kind === 'issue_outcome' ? OUTCOMES.includes(String(c.result)) : c.result === null) &&
    (admin ? c.targetRoles.length > 0 && (c.kind !== 'ask_details' || c.targetRoles.length === 1) && c.acknowledged === true && text(c.privateNote, 4000, true) && c.parent === null :
      c.targetRoles.length === 0 && c.acknowledged === false && c.privateNote === null && (commercial ? c.parent === null : reference(c.parent)));
}
function contribution(v: unknown, expectedUid: string, scope: ProductReviewScope, material = false, parcel = false, routing = false,mixed=false): v is ProductReviewContribution {
  const declared = object(v) && v.protocol === 'product_review_material_contribution_v1';
  const parcelDeclared = object(v) && v.protocol === 'product_review_parcel_contribution_v1';
  const routed = object(v) && Object.hasOwn(v, 'routingStatement');
  const mixedDeclared=object(v)&&Object.hasOwn(v,'mixedOrderStatement');
  return object(v) && (!declared || material || parcel) && (!parcelDeclared || parcel) && (!routed || routing && parcelDeclared) &&(!mixedDeclared||mixed&&parcelDeclared)&& exact(v, ['protocol', 'contributionId', 'actorId', 'actorRole', 'topic', 'statement', 'facts', 'observedAt', 'observedAtQualification',
    'origin', 'sourceHash', 'payloadHash', 'recordedAt', 'statementQualification', 'originalsState', 'officialSourceFetched', 'expertiseVerified', ...(declared ? ['materialStatement', ...Object.keys(PRODUCT_MATERIAL_QUALIFICATION)] : []), ...(parcelDeclared ? ['parcelStatement', ...Object.keys(PRODUCT_PARCEL_QUALIFICATION)] : []), ...(routed ? ['routingStatement', ...Object.keys(PRODUCT_ROUTING_QUALIFICATION)] : []),...(mixedDeclared?['mixedOrderStatement',...Object.keys(PRODUCT_MIXED_ORDERS_QUALIFICATION).filter(k=>!routed||!Object.keys(PRODUCT_ROUTING_QUALIFICATION).includes(k))]:[]), ...EFFECTS]) &&
    (!mixedDeclared||isProductMixedOrderStatement(v.mixedOrderStatement)&&isProductParcelStatement(v.parcelStatement,mixed&&mixedDeclared&&isProductMixedOrderStatement(v.mixedOrderStatement))&&v.mixedOrderStatement.leg===v.parcelStatement.leg&&v.mixedOrderStatement.labelId===v.parcelStatement.labelId&&Object.entries(PRODUCT_MIXED_ORDERS_QUALIFICATION).every(([k,value])=>v[k]===value))&&
    v.protocol === (parcelDeclared ? 'product_review_parcel_contribution_v1' : declared ? 'product_review_material_contribution_v1' : 'product_review_contribution_v1') && nativeId(v.contributionId, 'pc') && uid(v.actorId) && (scope === 'admin' || v.actorId === expectedUid) &&
    (!routed || isProductRoutingStatement(v.routingStatement) && isProductParcelStatement(v.parcelStatement,mixed&&mixedDeclared&&isProductMixedOrderStatement(v.mixedOrderStatement)) && v.routingStatement.leg === v.parcelStatement.leg && v.routingStatement.labelId === v.parcelStatement.labelId && Object.entries(PRODUCT_ROUTING_QUALIFICATION).every(([key,value]) => v[key] === value)) &&
    PRODUCT_REVIEW_ROLES.includes(v.actorRole as 'buyer') && (parcelDeclared ? v.topic === 'parcel_delivery' && v.actorRole !== 'reporter' && isProductParcelStatement(v.parcelStatement,mixed&&mixedDeclared&&isProductMixedOrderStatement(v.mixedOrderStatement)) && productParcelRoleMatches(v.parcelStatement, String(v.actorRole)) && Object.entries(PRODUCT_PARCEL_QUALIFICATION).every(([key, value]) => v[key] === value) : declared ? v.topic === 'nonconformity' && v.actorRole !== 'reporter' && isProductMaterialStatement(v.materialStatement) &&
      productMaterialScopeMatchesRole(v.materialStatement, String(v.actorRole)) && Object.entries(PRODUCT_MATERIAL_QUALIFICATION).every(([key, value]) => v[key] === value) : PRODUCT_REVIEW_TOPICS.includes(v.topic as 'authenticity')) && text(v.statement, 4000, true) && facts(v.facts) && date(v.observedAt) &&
    v.observedAtQualification === (v.observedAt === null ? 'unknown' : 'actor_declaration') &&
    v.origin === (v.actorRole === 'buyer' ? 'received_item_declaration' : v.actorRole === 'seller' ? 'offered_item_declaration' : 'reporter_observation_declaration') &&
    hash(v.sourceHash) && hash(v.payloadHash) && iso(v.recordedAt) && v.statementQualification === 'native_actor_declaration' &&
    v.originalsState === 'not_submitted_in_this_contribution' && v.officialSourceFetched === false && v.expertiseVerified === false && none(v);
}
function communication(v: unknown, scope: ProductReviewScope, expectedUid: string, documentary = false, parcel = false): v is ProductReviewCommunicationView {
  const assessed = object(v) && Object.prototype.hasOwnProperty.call(v, 'parcelAssessment');
  const commercial = object(v) && Object.prototype.hasOwnProperty.call(v, 'commercialReturnInstruction');
  if (!object(v) || !exact(v, ['protocol', 'eventId', 'kind', 'contentHash', 'caseVersion', 'text', 'result', 'parent', 'sourceHash', 'actorRole',
    'recordedAt', 'privateNote', 'contributionReferences', 'appliesToCurrentCaseVerified', 'originalsAccessGranted', ...(documentary ? ['documentaryCorpusHash', 'evidenceReferences', 'documentaryEvidenceBoundAtCommit'] : []), ...(assessed ? ['parcelAssessment', 'parcelAssessmentState', 'responsibilityEstablished', 'indemnityGranted', 'costDecisionGranted'] : []), ...(commercial ? ['commercialReturnInstruction'] : []), ...EFFECTS]) ||
    (assessed || commercial) && (!parcel || !documentary) || v.protocol !== ((assessed || commercial) && parcel && documentary ? 'product_review_parcel_communication_v1' : documentary ? 'product_review_communication_v2' : 'product_review_communication_v1') || assessed && (v.kind !== 'issue_outcome' || v.parcelAssessmentState !== 'available_sources_examined' || v.responsibilityEstablished !== false || v.indemnityGranted !== false || v.costDecisionGranted !== false || (scope === 'admin' ? !isProductParcelAssessment(v.parcelAssessment) : v.parcelAssessment !== null)) ||
    commercial && (v.kind !== 'contest' || v.actorRole !== 'seller' || v.parent !== null || !isProductCommercialReturnContestReference(v.commercialReturnInstruction)) || !nativeId(v.eventId, 'pe') || !KINDS.includes(String(v.kind)) || !hash(v.contentHash) ||
    !count(v.caseVersion, Number.MAX_SAFE_INTEGER) || v.caseVersion < 1 || !text(v.text, 4000, true) || !hash(v.sourceHash) || !iso(v.recordedAt) ||
    (v.kind === 'issue_outcome' ? !OUTCOMES.includes(String(v.result)) : v.result !== null) || !references(v.contributionReferences, documentary ? 100 : 20) ||
    v.appliesToCurrentCaseVerified !== false || v.originalsAccessGranted !== false || !none(v)) return false;
  const admin = ['ask_details', 'communicate_summary', 'issue_outcome'].includes(String(v.kind));
  if (documentary && (!Array.isArray(v.evidenceReferences) || v.evidenceReferences.length > 100 || !v.evidenceReferences.every(r => isProductReviewEvidenceReference(r) && (scope === 'admin' || r.actorId === expectedUid)) ||
    new Set(v.evidenceReferences.map(r => r.id)).size !== v.evidenceReferences.length || (v.documentaryEvidenceBoundAtCommit === true ? !hash(v.documentaryCorpusHash) :
      v.documentaryEvidenceBoundAtCommit !== false || v.documentaryCorpusHash !== null || v.evidenceReferences.length !== 0))) return false;
  return (admin ? v.actorRole === 'operator' && v.parent === null && (scope === 'own' ? v.privateNote === null : text(v.privateNote, 4000, true)) :
    PRODUCT_REVIEW_ROLES.includes(v.actorRole as 'buyer') && (commercial ? v.parent === null : reference(v.parent)) && v.privateNote === null) &&
    (scope === 'admin' || v.contributionReferences.length === 0);
}
async function rpc(expectedUid: string, endpoint: 'submitReport' | 'triageReport', input: Record<string, unknown>, assertContext: () => void) {
  const session = captureTradeSession(expectedUid); assertContext();
  const context = input.context ?? (object(input.command) ? input.command.context : null);
  if (input.routingCapability === 'product_review_routing_v1'||input.mixedOrdersCapability==='product_review_mixed_orders_v1') {const user = auth.currentUser; if (!user || user.uid !== expectedUid) throw failure(); await user.getIdToken(); assertTradeSessionCurrent(session); assertContext();}
  const result = await httpsCallable<unknown, unknown>(functions, endpoint)({...input, expectedUid, capability: 'product_review_v1',
    ...(object(context) && context.kind === 'article_listing' ? {listingCapability: 'product_review_article_listing_v1'} : {})});
  assertTradeSessionCurrent(session); assertContext(); return result.data;
}
const sessionGuard = (expectedUid: string, callback: () => void) => {
  const session = captureTradeSession(expectedUid); callback();
  return () => {assertTradeSessionCurrent(session); callback();};
};
async function nativeCaseId(context: ProductReviewContext, assertContext: () => void) {
  if (!isProductReviewContext(context)) throw failure();
  const id = `pr_${await productReviewHash([context.kind, context.id])}`; assertContext(); return id;
}
/** A notice opens its native context only; the destination must requalify private access. */
export async function productReviewNotificationContext(data: unknown, expectedUid: string, assertContext: () => void): Promise<ProductReviewContext | null> {
  const session = captureTradeSession(expectedUid); assertContext();
  if (!object(data) || data.ownerId !== expectedUid) return null;
  const context = {kind: data.contextKind, id: data.contextId}; if (!isProductReviewContext(context)) return null;
  if (data.productReviewEventId !== undefined && !nativeId(data.productReviewEventId, 'pe') || data.productReviewEvidenceId !== undefined && !nativeId(data.productReviewEvidenceId, 'pf')) return null;
  if (data.productReviewAdmissionId !== undefined && !nativeId(data.productReviewAdmissionId, 'pa')) return null;
  if (data.productPhysicalInstructionId !== undefined && (context.kind !== 'order' || !nativeId(data.productPhysicalInstructionId, 'pi')) || data.productPhysicalSignalId !== undefined && (context.kind !== 'order' || !nativeId(data.productPhysicalSignalId, 'ps'))) return null;
  const caseId = await nativeCaseId(context, assertContext); assertTradeSessionCurrent(session); assertContext();
  return data.productReviewCaseId === caseId ? context : null;
}
export const ProductReviewService = {
  async preview(expectedUid: string, context: ProductReviewContext, assertContext: () => void, material = false, parcel = false, routing = false,mixed=false): Promise<ProductReviewPreview> {
    assertContext = sessionGuard(expectedUid, assertContext);
    if(mixed&&!parcel)throw failure();
    const caseId = await nativeCaseId(context, assertContext), v = await rpc(expectedUid, 'submitReport', {operation: 'productReviewPreview', context, ...(routing ? {routingCapability: 'product_review_routing_v1'} : {}),...(mixed?{mixedOrdersCapability:'product_review_mixed_orders_v1'}:{}), ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})}, assertContext);
    if (!object(v) || !exact(v, ['protocol', 'source', 'topics', 'factKeys', 'contributionPermissionGranted', 'receivedItemImagesSupported', 'originalExpertiseUploadSupported', ...(material ? ['materialReasons', ...Object.keys(PRODUCT_MATERIAL_QUALIFICATION)] : []), ...(parcel ? ['parcelReasons', ...Object.keys(PRODUCT_PARCEL_QUALIFICATION)] : []), ...(routing ? ['routingCapability', ...Object.keys(PRODUCT_ROUTING_QUALIFICATION)] : []),...(mixed?['mixedOrdersCapability',...Object.keys(PRODUCT_MIXED_ORDERS_QUALIFICATION).filter(k=>!routing||!Object.keys(PRODUCT_ROUTING_QUALIFICATION).includes(k))]:[]), ...EFFECTS]) ||
      v.protocol !== (parcel ? 'product_review_parcel_preview_v1' : material ? 'product_review_material_preview_v1' : 'product_review_preview_v1') || !source(v.source, expectedUid, context, caseId, 'own', material, parcel) || !productReviewEqual(v.topics, parcel ? [...PRODUCT_REVIEW_TOPICS, 'nonconformity', 'parcel_delivery'] : material ? [...PRODUCT_REVIEW_TOPICS, 'nonconformity'] : PRODUCT_REVIEW_TOPICS) ||
      routing && (!parcel || v.routingCapability !== 'product_review_routing_v1' || !Object.entries(PRODUCT_ROUTING_QUALIFICATION).every(([key,value]) => v[key] === value)) ||
      mixed&&(v.mixedOrdersCapability!=='product_review_mixed_orders_v1'||!Object.entries(PRODUCT_MIXED_ORDERS_QUALIFICATION).every(([k,value])=>v[k]===value))||
      parcel && (!productReviewEqual(v.parcelReasons, [...PRODUCT_PARCEL_REASONS,...(mixed?[PRODUCT_PARCEL_MIXED_REASON]:[])]) || !Object.entries(PRODUCT_PARCEL_QUALIFICATION).every(([key, value]) => v[key] === value)) ||
      material && (!productReviewEqual(v.materialReasons, PRODUCT_MATERIAL_REASONS) || !Object.entries(PRODUCT_MATERIAL_QUALIFICATION).every(([key, value]) => v[key] === value)) ||
      !productReviewEqual(v.factKeys, Object.keys(PRODUCT_REVIEW_FACT_LIMITS)) || v.contributionPermissionGranted !== false || v.receivedItemImagesSupported !== false ||
      v.originalExpertiseUploadSupported !== false || !none(v)) throw failure(); return v as unknown as ProductReviewPreview;
  },
  async workflowPreview<D extends boolean = false>(expectedUid: string, context: ProductReviewContext, scope: ProductReviewScope, parent: ProductReviewReference | null,
    assertContext: () => void, documentary = false as D, material = false, parcel = false, commercialReturnInstruction: ProductCommercialReturnContestReference | null = null, routeAmendment = false): Promise<D extends true ? ProductReviewWorkflowPreviewV2 : ProductReviewWorkflowPreview> {
    assertContext = sessionGuard(expectedUid, assertContext);
    if (routeAmendment && (!parcel || !documentary || context.kind !== 'order') || parent !== null && !reference(parent) || commercialReturnInstruction !== null && (!parcel || !documentary || context.kind !== 'order' || parent !== null || !isProductCommercialReturnContestReference(commercialReturnInstruction))) throw failure();
    const caseId = await nativeCaseId(context, assertContext), v = await rpc(expectedUid, scope === 'admin' ? 'triageReport' : 'submitReport',
      {operation: 'productReviewWorkflowPreview', context, scope, parent, ...(documentary ? {documentaryCapability: 'product_review_corpus_v1'} : {}), ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {}), ...(commercialReturnInstruction ? {commercialReturnInstruction} : {}), ...(routeAmendment ? {routeAmendmentCapability: 'label_route_amendment_v1'} : {})}, assertContext);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'source', 'caseVersion', 'parent', 'contributionReferences', 'communicationReferences', 'recipientRoles', 'coverage', 'options', 'decisionPermissionGranted',
      ...(documentary ? ['documentaryCorpusHash', 'evidenceReferences', 'documentaryEvidenceBoundAtPreview'] : []), ...(parcel ? ['parcelReview', ...(scope === 'admin' ? ['operatorParcelRoutes'] : [])] : []), ...(commercialReturnInstruction ? ['commercialReturnInstruction'] : []), ...EFFECTS]) ||
      v.protocol !== (parcel ? 'product_review_parcel_workflow_preview_v1' : documentary ? 'product_review_workflow_preview_v2' : 'product_review_workflow_preview_v1') || parcel && (!documentary || !isProductParcelCorpusReview(v.parcelReview)) || v.actorId !== expectedUid || v.scope !== scope || !source(v.source, expectedUid, context, caseId, scope, material, parcel) ||
      !count(v.caseVersion, Number.MAX_SAFE_INTEGER) || (parent === null ? v.parent !== null : !communication(v.parent, scope, expectedUid, documentary, parcel) || v.parent.eventId !== parent.id || v.parent.contentHash !== parent.contentHash) ||
      !roleArray(v.recipientRoles) || !Array.isArray(v.options) || !productReviewEqual(v.options, scope === 'admin' ? KINDS.slice(0, 3) :
        commercialReturnInstruction ? ['contest'] : object(v.parent) && v.parent.kind === 'ask_details' ? ['respond'] : object(v.parent) && v.parent.kind === 'issue_outcome' ? ['contest'] : []) ||
      !Array.isArray(v.contributionReferences) || !Array.isArray(v.communicationReferences) || v.contributionReferences.length > 100 || v.communicationReferences.length > 100 ||
      !v.contributionReferences.every(r => object(r) && exact(r, ['id', 'contentHash', 'qualification']) && productReviewDocumentId(r.id) &&
        (r.qualification === 'native_contribution' ? hash(r.contentHash) : r.qualification === 'unknown' && r.contentHash === null)) ||
      !v.communicationReferences.every(r => object(r) && exact(r, ['id', 'contentHash', 'kind', 'qualification']) && productReviewDocumentId(r.id) &&
        (r.qualification === 'native_communication' ? hash(r.contentHash) && KINDS.includes(String(r.kind)) : r.qualification === 'unknown' && r.contentHash === null && r.kind === null)) ||
      scope === 'own' && (v.recipientRoles.length > 0 || v.contributionReferences.length > 0 || v.communicationReferences.length > 0) ||
      !object(v.coverage) || !exact(v.coverage, ['contributionsInspected', 'communicationsInspected', 'limitPerSource', 'contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet', 'exhaustiveHistoryVerified',
        ...(documentary ? ['evidenceInspected', 'intentsInspected', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet'] : [])]) ||
      !count(v.coverage.contributionsInspected, 100) || !count(v.coverage.communicationsInspected, 100) || v.coverage.limitPerSource !== 100 ||
      !['contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet'].every(k => typeof (v.coverage as Record<string, unknown>)[k] === 'boolean') ||
      v.coverage.completeCurrentCaseSet === true && (v.coverage.contributionsHasMore || v.coverage.communicationsHasMore) ||
      v.coverage.exhaustiveHistoryVerified !== false || v.decisionPermissionGranted !== false || !none(v)) throw failure();
    if (documentary) {
      if (!hash(v.documentaryCorpusHash) || v.documentaryEvidenceBoundAtPreview !== true || !Array.isArray(v.evidenceReferences) || v.evidenceReferences.length > 100 ||
        !count(v.coverage.evidenceInspected, 100) || !count(v.coverage.intentsInspected, 100) || !['evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet'].every(k => typeof (v.coverage as Record<string, unknown>)[k] === 'boolean') ||
        v.coverage.documentaryCompleteCurrentCaseSet !== v.coverage.completeCurrentCaseSet || !v.evidenceReferences.every(r => object(r) &&
          (r.qualification === 'native_stored_file' ? exact(r, ['qualification', 'evidence']) && isProductReviewEvidenceReference(r.evidence) && (scope === 'admin' || r.evidence.actorId === expectedUid) :
            r.qualification === 'unknown' && exact(r, ['qualification', 'evidenceId', 'evidence']) && productReviewDocumentId(r.evidenceId) && r.evidence === null)) ||
        scope === 'admin' && (v.evidenceReferences.length !== v.coverage.evidenceInspected || v.contributionReferences.length !== v.coverage.contributionsInspected || v.communicationReferences.length !== v.coverage.communicationsInspected)) throw failure();
      if (v.coverage.documentaryCompleteCurrentCaseSet && (v.coverage.evidenceHasMore || v.coverage.intentsHasMore || v.coverage.contributionsInspected === 0 || v.coverage.evidenceInspected === 0 ||
        scope === 'admin' && (v.evidenceReferences.some(r => r.qualification !== 'native_stored_file' || r.evidence.state !== 'received') || v.contributionReferences.some(r => r.qualification !== 'native_contribution') ||
          v.communicationReferences.some(r => r.qualification !== 'native_communication')))) throw failure();
    }
    if (parcel && (v.source.protocol !== 'product_review_source_v4' || !isProductParcelCorpusReview(v.parcelReview) || v.parcelReview.availableEvidenceComplete !== v.coverage.documentaryCompleteCurrentCaseSet ||
      v.parcelReview.evidenceAvailability.length !== v.coverage.contributionsInspected || scope === 'admin' && !isProductParcelOperatorRoutes(v.operatorParcelRoutes, v.source.parcelSources, v.source.sourceHash, String(v.documentaryCorpusHash), routeAmendment))) throw failure();
    if (commercialReturnInstruction) {
      const i = v.commercialReturnInstruction;
      if (!object(i) || !exact(i, ['reference', 'action', 'partyMessage', 'sourceHash', 'recordedAt', 'currentPointerMatches', 'currentInstructionVerified', ...EFFECTS]) || !productReviewEqual(i.reference, commercialReturnInstruction) || !['maintain_review', 'refuse_return', 'instruct_return'].includes(String(i.action)) || !text(i.partyMessage, 4000, true) || !hash(i.sourceHash) || !iso(i.recordedAt) || typeof i.currentPointerMatches !== 'boolean' || i.currentInstructionVerified !== false || !none(i) || v.source.protocol !== 'product_review_source_v4' || scope === 'own' && !v.source.actorRoles.includes('seller')) throw failure();
    }
    return v as unknown as D extends true ? ProductReviewWorkflowPreviewV2 : ProductReviewWorkflowPreview;
  },
  async page<T extends 'contributions' | 'communications', D extends boolean = false>(expectedUid: string, context: ProductReviewContext, scope: ProductReviewScope, type: T, cursor: ProductReviewCursor | null, assertContext: () => void, expectedSourceHash: string,
    documentary = false as D, expectedCorpusHash?: string, material = false, parcel = false, routing = false,mixed=false): Promise<T extends 'contributions' ? ProductReviewContributions : D extends true ? ProductReviewCommunicationsV2 : ProductReviewCommunications> {
    assertContext = sessionGuard(expectedUid, assertContext);
    if (!hash(expectedSourceHash)) throw failure();
    if (documentary && !hash(expectedCorpusHash)) throw failure();
    if (cursor !== null && (!object(cursor) || !exact(cursor, ['lastId']) || !productReviewDocumentId(cursor.lastId))) throw failure();
    const caseId = await nativeCaseId(context, assertContext), v = await rpc(expectedUid, scope === 'admin' ? 'triageReport' : 'submitReport',
      {operation: type === 'contributions' ? 'readProductReviewContributions' : 'readProductReviewCommunications', context, scope, cursor, ...(routing && type === 'contributions' ? {routingCapability: 'product_review_routing_v1'} : {}),...(mixed&&type==='contributions'?{mixedOrdersCapability:'product_review_mixed_orders_v1'}:{}),
        ...(documentary && type === 'communications' ? {documentaryCapability: 'product_review_corpus_v1'} : {}), ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})}, assertContext);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'caseId', 'entries', 'readAt', 'nextCursor', 'coverage', 'otherPartiesRawContributionsVisible', 'originalsAccessGranted',
      ...(type === 'communications' ? ['privateAnalysisVisible'] : []), ...EFFECTS]) || v.protocol !== (parcel ? `product_review_parcel_${type}_page_v1` : material && type === 'contributions' ? 'product_review_material_contributions_page_v1' : `product_review_${type}_page_v${documentary && type === 'communications' ? 2 : 1}`) || v.actorId !== expectedUid ||
      v.scope !== scope || v.caseId !== caseId || !iso(v.readAt) || !Array.isArray(v.entries) || v.entries.length > 20 || v.originalsAccessGranted !== false ||
      v.otherPartiesRawContributionsVisible !== (scope === 'admin') || type === 'communications' && v.privateAnalysisVisible !== (scope === 'admin') || !none(v) ||
      !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) || (!count(v.coverage.inspected, 20) || (type === 'contributions' ? v.coverage.inspected < v.entries.length : v.coverage.inspected !== v.entries.length)) || v.coverage.limit !== 20 ||
      typeof v.coverage.hasMore !== 'boolean' || v.coverage.exhaustiveHistoryVerified !== false) throw failure();
    const ids: string[] = [];
    for (const row of v.entries) {
      if (!object(row)) throw failure();
      const item = type === 'contributions' ? row.contribution : row.communication;
      if (row.qualification === 'unknown') {
        const id = type === 'contributions' ? row.contributionId : row.eventId;
        if (!exact(row, ['qualification', type === 'contributions' ? 'contributionId' : 'eventId', type === 'contributions' ? 'contribution' : 'communication']) || !productReviewDocumentId(id) || item !== null) throw failure();
        ids.push(id);
      } else {
        if (!exact(row, ['qualification', type === 'contributions' ? 'contribution' : 'communication']) ||
          (type === 'contributions' ? row.qualification !== 'native_actor_contribution' || !contribution(item, expectedUid, scope, material, parcel, routing,mixed) : row.qualification !== 'native_addressed_communication' || !communication(item, scope, expectedUid, documentary, parcel))) throw failure();
        ids.push(type === 'contributions' ? (item as ProductReviewContribution).contributionId : (item as ProductReviewCommunication).eventId);
      }
    }
    if (new Set(ids).size !== ids.length || (v.coverage.hasMore ? !object(v.nextCursor) || !exact(v.nextCursor, ['lastId']) ||
      !productReviewDocumentId(v.nextCursor.lastId) || v.nextCursor.lastId === cursor?.lastId || v.coverage.inspected !== 20 || (type === 'contributions' ? ids.some(id => id > String((v.nextCursor as {lastId: string}).lastId)) : v.nextCursor.lastId !== ids.at(-1)) : v.nextCursor !== null)) throw failure();
    const latest = documentary ? await ProductReviewService.workflowPreview(expectedUid, context, scope, null, assertContext, true, material, parcel) : scope === 'own' ? await ProductReviewService.preview(expectedUid, context, assertContext, material, parcel, routing,mixed) :
      await ProductReviewService.workflowPreview(expectedUid, context, scope, null, assertContext, false, material, parcel);
    if (latest.source.sourceHash !== expectedSourceHash || documentary && (!('documentaryCorpusHash' in latest) || latest.documentaryCorpusHash !== expectedCorpusHash)) throw failure();
    assertContext(); return v as unknown as T extends 'contributions' ? ProductReviewContributions : D extends true ? ProductReviewCommunicationsV2 : ProductReviewCommunications;
  },
  async command(attempt: ProductReviewAttempt, action: 'execute' | 'observe' | 'neutralize', assertContext: () => void): Promise<ProductReviewReceipt> {
    if (!isProductReviewAttempt(attempt, attempt.uid)) throw failure();
    const session = captureTradeSession(attempt.uid); assertContext();
    const payloadHash = await productReviewHash(attempt.command), caseId = await nativeCaseId(attempt.context, assertContext),
      expectedId = `${attempt.type === 'contribution' ? 'pc' : attempt.type === 'commercial_return' ? 'pri' : 'pe'}_${await productReviewHash([attempt.uid, attempt.requestId])}`;
    assertTradeSessionCurrent(session); assertContext();
    if (attempt.type === 'commercial_return') {
      const value = await rpc(attempt.uid, 'triageReport', {operation: 'productCommercialReturnCommand', requestId: attempt.requestId, action, command: attempt.command, materialCapability: attempt.materialCapability, ...(attempt.parcelCapability ? {parcelCapability: attempt.parcelCapability} : {})}, assertContext);
      if (!object(value) || !exact(value, ['protocol', 'actorId', 'requestId', 'payloadHash', 'caseId', 'state', 'reason', 'instructionReference', 'recordedAt', 'currentInstructionVerified', ...EFFECTS]) ||
        value.protocol !== 'product_commercial_return_command_v1' || value.actorId !== attempt.uid || value.requestId !== attempt.requestId || value.payloadHash !== payloadHash || value.caseId !== caseId ||
        value.currentInstructionVerified !== false || !none(value) || (value.state === 'committed' ? !isProductCommercialReturnReference(value.instructionReference) || value.instructionReference.instructionId !== expectedId || value.reason !== null || !iso(value.recordedAt) :
          value.instructionReference !== null || (value.state === 'not_executed' ? !iso(value.recordedAt) || !['requester_neutralized', 'reference_unqualified', 'source_changed', 'incomplete_case_history', 'product_material_review_not_exposed', ...(attempt.parcelCapability ? ['product_parcel_review_not_exposed'] : [])].includes(String(value.reason)) :
            value.state !== 'unrecorded' || value.recordedAt !== null || value.reason !== null))) throw failure();
      return value as unknown as ProductReviewReceipt;
    }
    const admin = attempt.type === 'workflow' && ['ask_details', 'communicate_summary', 'issue_outcome'].includes(attempt.command.kind);
    const v = await rpc(attempt.uid, admin ? 'triageReport' : 'submitReport', {operation: attempt.type === 'contribution' ? 'productReviewContribution' : 'productReviewWorkflowCommand',
      requestId: attempt.requestId, action, command: attempt.command, ...(attempt.type === 'workflow' && attempt.command.documentaryCorpus ? {documentaryCapability: 'product_review_corpus_v1'} : {}),
      ...(attempt.materialCapability ? {materialCapability: attempt.materialCapability} : {}), ...(attempt.parcelCapability ? {parcelCapability: attempt.parcelCapability} : {}), ...(attempt.routeAmendmentCapability ? {routeAmendmentCapability: attempt.routeAmendmentCapability} : {}), ...(attempt.routingCapability ? {routingCapability: attempt.routingCapability} : {}),...(attempt.mixedOrdersCapability?{mixedOrdersCapability:attempt.mixedOrdersCapability}:{})}, assertContext);
    const workflow = attempt.type === 'workflow', idKey = workflow ? 'eventId' : 'contributionId';
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'payloadHash', 'caseId', idKey, 'state', 'reason', 'recordedAt', 'currentSourceVerified',
      ...(workflow ? ['caseVersionAtCommit', 'currentInstructionVerified'] : []), ...EFFECTS]) || v.protocol !== (workflow ? 'product_review_workflow_command_v1' : attempt.type === 'contribution' && attempt.command.parcelStatement ? 'product_review_parcel_command_v1' : attempt.type === 'contribution' && attempt.command.materialStatement ? 'product_review_material_command_v1' : 'product_review_command_v1') ||
      v.actorId !== attempt.uid || v.requestId !== attempt.requestId || v.payloadHash !== payloadHash || v.caseId !== caseId || v.currentSourceVerified !== false ||
      workflow && v.currentInstructionVerified !== false || !none(v)) throw failure();
    if (v.state === 'committed' ? v[idKey] !== expectedId || v.reason !== null || !iso(v.recordedAt) || workflow && (!count(v.caseVersionAtCommit, Number.MAX_SAFE_INTEGER) || v.caseVersionAtCommit < 1) :
      v.state === 'not_executed' ? v[idKey] !== null || !iso(v.recordedAt) || !['requester_neutralized', 'source_changed', ...(workflow ? ['reference_unqualified', 'incomplete_case_history'] : [])].includes(String(v.reason)) || workflow && v.caseVersionAtCommit !== null :
      v.state !== 'unrecorded' || v[idKey] !== null || v.reason !== null || v.recordedAt !== null || workflow && v.caseVersionAtCommit !== null) throw failure();
    return v as unknown as ProductReviewReceipt;
  },
};
