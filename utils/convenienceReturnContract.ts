import type {ConvenienceReturnAttempt, ConvenienceReturnCapability, ConvenienceReturnCommand, ConvenienceReturnTerms, ConvenienceReturnReference, ConvenienceReturnFinancialTerms, ConvenienceReturnFinancialReference, ConvenienceReturnReceptionCommand, ConvenienceReturnReceptionAttempt, ConvenienceReturnTerminal, ConvenienceReturnVariance, ConvenienceReturnVarianceResolution, ConvenienceReturnIncidentCommand, ConvenienceReturnIncidentAttempt, ConvenienceReturnIncidentPreview} from '@/types/convenienceReturn';
export const convenienceObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const convenienceExact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const convenienceHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const convenienceId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
export const convenienceDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const convenienceProposalId = (v: unknown): v is string => typeof v === 'string' && /^cr_[a-f0-9]{64}$/.test(v);
const cents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function isConvenienceReturnTerminal(v: unknown): v is ConvenienceReturnTerminal {
  if (!convenienceObject(v) || !convenienceExact(v, ['kind', 'terminalId', 'returnRequestId', 'basis', 'providerOutcome', 'platformAssumedRisk']) ||
      v.kind !== 'closed' || !convenienceId(v.terminalId) || !convenienceId(v.returnRequestId)) return false;
  return ['native_before_purchase', 'owner_intent_not_deposited'].includes(String(v.basis)) ? v.providerOutcome === 'not_invoked' && v.platformAssumedRisk === false :
    v.basis === 'native_post_validation_rejected' ? v.providerOutcome === 'validation_rejected' && v.platformAssumedRisk === false :
      v.basis === 'operator_platform_risk_assumption' && ['unknown', 'purchased_unfurnished'].includes(String(v.providerOutcome)) && v.platformAssumedRisk === true;
}
const VARIANCE_KEYS = ['actualProofHash', 'acceptedCostCents', 'actualCostCents', 'deductionCents', 'grossArticleCents', 'netRefundCents', 'platformVarianceCents', 'currency'];
function varianceMoney(v: Record<string, unknown>): boolean {
  if (!convenienceHash(v.actualProofHash) || v.currency !== 'CAD' || !VARIANCE_KEYS.filter(k => k !== 'currency' && k !== 'actualProofHash').every(k => cents(v[k]))) return false;
  const {acceptedCostCents: accepted, actualCostCents: actual, deductionCents: deduction, grossArticleCents: gross, netRefundCents: net, platformVarianceCents: variance} = v as Record<string, number>;
  return deduction === Math.min(accepted, actual) && gross > deduction && net === gross - deduction && variance === actual - deduction;
}
export function isConvenienceReturnVariance(v: unknown): v is ConvenienceReturnVariance {
  return convenienceObject(v) && convenienceExact(v, ['qualification', ...VARIANCE_KEYS]) && v.qualification === 'exact_provider_label' && varianceMoney(v);
}
export function isConvenienceReturnVarianceResolution(v: unknown): v is ConvenienceReturnVarianceResolution {
  return convenienceObject(v) && convenienceExact(v, ['kind', 'resolutionId', 'financingTermsHash', ...VARIANCE_KEYS]) &&
    v.kind === 'variance_adopted' && convenienceId(v.resolutionId) && convenienceHash(v.financingTermsHash) && varianceMoney(v);
}
export function isConvenienceReturnIncidentCommand(v: unknown): v is ConvenienceReturnIncidentCommand {
  if (!convenienceObject(v) || !convenienceExact(v, ['action', 'sourceHash', 'expectedVersion', 'returnRequestId', 'purchaseExternalId', 'quoteId', 'financingTermsHash', 'basis', 'actualProofHash', 'platformRiskAccepted', 'note', 'acknowledged']) ||
      !convenienceHash(v.sourceHash) || !cents(v.expectedVersion) || v.expectedVersion < 1 || !convenienceId(v.returnRequestId) ||
      !(v.purchaseExternalId === null || convenienceId(v.purchaseExternalId)) || !(v.quoteId === null || convenienceId(v.quoteId)) ||
      !(v.financingTermsHash === null || convenienceHash(v.financingTermsHash)) || typeof v.note !== 'string' || !v.note.trim() || v.note !== v.note.trim() || v.note.length > 2000 || v.acknowledged !== true) return false;
  return v.action === 'close_unfurnished_return' ? v.actualProofHash === null &&
    (v.basis === 'operator_platform_risk_assumption' ? v.platformRiskAccepted === true : ['native_before_purchase', 'native_post_validation_rejected'].includes(String(v.basis)) && v.platformRiskAccepted === false) :
    v.action === 'adopt_label_cost_variance' && v.basis === null && convenienceHash(v.actualProofHash) && convenienceHash(v.financingTermsHash) && v.platformRiskAccepted === true;
}
/** The UI and the composed client/server probe use this same native tuple.
 * Consent is supplied explicitly; construction never turns it on implicitly. */
export function buildConvenienceReturnIncidentCommand(preview: ConvenienceReturnIncidentPreview,
  selection: Pick<ConvenienceReturnIncidentCommand, 'action' | 'basis' | 'platformRiskAccepted' | 'note'>): ConvenienceReturnIncidentCommand {
  const source = preview.source;
  if (!source || preview.role !== 'operator') throw new Error('L’aperçu opérateur natif doit être relu.');
  if (selection.action === 'adopt_label_cost_variance' ? !preview.canAdopt || !isConvenienceReturnVariance(preview.variance) :
      !preview.canClose || !selection.basis || !(selection.basis === 'native_before_purchase' ? preview.closeBasis.nativeBeforePurchase :
        selection.basis === 'native_post_validation_rejected' ? preview.closeBasis.nativePostValidationRejected : preview.closeBasis.operatorPlatformRiskAssumption)) throw new Error('La qualification de cette instruction doit être relue.');
  const command: ConvenienceReturnIncidentCommand = {action: selection.action, sourceHash: source.sourceHash, expectedVersion: source.version,
    returnRequestId: source.returnRequestId, purchaseExternalId: source.purchaseExternalId, quoteId: source.quoteId, financingTermsHash: source.financingTermsHash,
    basis: selection.action === 'close_unfurnished_return' ? selection.basis : null,
    actualProofHash: selection.action === 'adopt_label_cost_variance' ? preview.variance!.actualProofHash : null,
    platformRiskAccepted: selection.platformRiskAccepted, note: selection.note.trim(), acknowledged: true};
  if (!isConvenienceReturnIncidentCommand(command)) throw new Error('Le consentement explicite et les conditions exactes de cette instruction sont requis.');
  return command;
}
export function isConvenienceReturnIncidentAttempt(v: unknown, uid: string): v is ConvenienceReturnIncidentAttempt {
  return convenienceObject(v) && convenienceExact(v, ['version', 'uid', 'transactionId', 'requestId', 'capability', 'scope', 'payloadHash', 'command']) &&
    v.version === 1 && v.uid === uid && convenienceId(uid) && convenienceId(v.transactionId) && convenienceId(v.requestId) && v.requestId.length >= 16 &&
    v.capability === 'convenience_return_incident_v1' && v.scope === 'operator' && convenienceHash(v.payloadHash) && isConvenienceReturnIncidentCommand(v.command);
}
export function isConvenienceReturnReference(v: unknown): v is ConvenienceReturnReference {
  return convenienceObject(v) && convenienceExact(v, ['proposalId', 'contentHash', 'termsProtocol']) && convenienceProposalId(v.proposalId) &&
    convenienceHash(v.contentHash) && v.termsProtocol === 'convenience_return_terms_v2';
}
export function isConvenienceReturnFinancialTerms(v: unknown, transactionId: string): v is ConvenienceReturnFinancialTerms {
  return convenienceObject(v) && convenienceExact(v, ['protocol', 'transactionId', 'buyerId', 'sellerId', 'requestId', 'agreement', 'basisHash', 'cumulativeHash', 'grossArticleCents', 'returnLabelCostCents', 'netRefundCents', 'currency']) &&
    v.protocol === 'convenience_return_cost_terms_v1' && v.transactionId === transactionId && convenienceId(transactionId) && convenienceId(v.buyerId) &&
    convenienceId(v.sellerId) && v.buyerId !== v.sellerId && convenienceId(v.requestId) && isConvenienceReturnReference(v.agreement) &&
    convenienceHash(v.basisHash) && convenienceHash(v.cumulativeHash) && cents(v.grossArticleCents) && cents(v.returnLabelCostCents) && cents(v.netRefundCents) &&
    v.grossArticleCents > v.returnLabelCostCents && v.netRefundCents === v.grossArticleCents - v.returnLabelCostCents && v.currency === 'CAD';
}
export function isConvenienceReturnFinancialReference(v: unknown): v is ConvenienceReturnFinancialReference {
  return convenienceObject(v) && convenienceExact(v, ['protocol', 'proposalId', 'agreementContentHash', 'requestId', 'financingTermsHash', 'receptionRequestId', 'receptionHash']) &&
    v.protocol === 'convenience_return_financial_review_v1' && convenienceProposalId(v.proposalId) && convenienceHash(v.agreementContentHash) &&
    convenienceId(v.requestId) && convenienceHash(v.financingTermsHash) && convenienceId(v.receptionRequestId) && convenienceHash(v.receptionHash);
}
export function isConvenienceReturnReceptionCommand(v: unknown): v is ConvenienceReturnReceptionCommand {
  return convenienceObject(v) && convenienceExact(v, ['action', 'sourceHash', 'returnRequestId', 'labelId', 'financingTermsHash', 'agreement', 'contentConforming', 'conditionsAcknowledged']) &&
    v.action === 'confirm_return_received' && convenienceHash(v.sourceHash) && convenienceId(v.returnRequestId) && convenienceId(v.labelId) && convenienceHash(v.financingTermsHash) &&
    isConvenienceReturnReference(v.agreement) && v.contentConforming === true && v.conditionsAcknowledged === true;
}
export function isConvenienceReturnReceptionAttempt(v: unknown, uid: string, transactionId: string): v is ConvenienceReturnReceptionAttempt {
  return convenienceObject(v) && convenienceExact(v, ['version', 'uid', 'transactionId', 'requestId', 'capability', 'command', 'payloadHash']) &&
    v.version === 1 && v.uid === uid && convenienceId(uid) && v.transactionId === transactionId && convenienceId(transactionId) && convenienceId(v.requestId) && v.requestId.length >= 16 &&
    v.capability === 'convenience_return_v2' && isConvenienceReturnReceptionCommand(v.command) && convenienceHash(v.payloadHash);
}
export const CONVENIENCE_EFFECT_KEYS = ['fundsFrozen', 'financialEffectAuthorized', 'refundDecisionGranted', 'shippingPermissionGranted', 'costAllocation'];
export const convenienceNoEffects = (v: Record<string, unknown>, capability: ConvenienceReturnCapability): boolean => v.fundsFrozen === false && v.financialEffectAuthorized === false &&
  v.refundDecisionGranted === false && v.shippingPermissionGranted === false && v.costAllocation === (capability === 'convenience_return_v2' ? 'buyer_return_article_only' : 'instruction_required');
const text = (v: unknown, limit: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= limit;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
function address(v: unknown): boolean {
  if (!convenienceObject(v) || !['name', 'addressLine1', 'cityLocality', 'stateProvince', 'postalCode', 'countryCode'].every(k => text(v[k], 500)) ||
      Object.keys(v).some(k => !['name', 'addressLine1', 'addressLine2', 'cityLocality', 'stateProvince', 'postalCode', 'countryCode', 'phone', 'email'].includes(k)) ||
      v.countryCode !== 'CA') return false;
  return ['addressLine2', 'phone', 'email'].every(k => !Object.hasOwn(v, k) || text(v[k], 500));
}
export function isConvenienceTerms(v: unknown, transactionId: string): v is ConvenienceReturnTerms {
  if (!convenienceObject(v)) return false;
  const priced = v.protocol === 'convenience_return_terms_v2';
  if (!convenienceExact(v, ['protocol', 'transactionId', 'buyerId', 'sellerId', 'reason', 'articleId', 'article', 'route', 'scope', 'costs', 'refund', 'itemConformity', 'physicalConditionVerified', ...(priced ? ['financing', 'sellerReturnLabelDebitAuthorized'] : [])]) ||
      !['convenience_return_terms_v1', 'convenience_return_terms_v2'].includes(String(v.protocol)) || v.transactionId !== transactionId || !convenienceId(v.buyerId) || !convenienceId(v.sellerId) || v.buyerId === v.sellerId ||
      !convenienceId(v.articleId) || v.reason !== 'change_of_mind' || v.scope !== 'whole_transaction' ||
      (priced ? !pricedTerms(v) : v.costs !== 'instruction_required' || v.refund !== 'not_decided') || v.itemConformity !== 'buyer_declared_conforming' || v.physicalConditionVerified !== false ||
      !convenienceObject(v.article) || !text(v.article.title, 1000) || !text(v.article.description, 10000) ||
      !(convenienceExact(v.article, ['title', 'description', 'listingContentVersion']) && ['listing_content_v1', 'listing_content_v2'].includes(String(v.article.listingContentVersion)) ||
        convenienceExact(v.article, ['title', 'description', 'saleUnit']) && ['single_article', 'set_as_one'].includes(String(v.article.saleUnit))) || !convenienceObject(v.route)) return false;
  const r = v.route, p = r.parcel;
  return convenienceExact(r, ['isReturn', 'shipFrom', 'shipTo', 'parcel', 'carrierId', 'carrierCode', 'serviceCode', 'outboundLabelId']) && r.isReturn === true &&
    address(r.shipFrom) && address(r.shipTo) && ['carrierId', 'carrierCode', 'serviceCode', 'outboundLabelId'].every(k => text(r[k], 200)) &&
    convenienceObject(p) && convenienceExact(p, ['weight', 'dimensions']) && convenienceObject(p.weight) && convenienceExact(p.weight, ['value', 'unit']) &&
    p.weight.unit === 'kilogram' && positive(p.weight.value) && convenienceObject(p.dimensions) && convenienceExact(p.dimensions, ['length', 'width', 'height', 'unit']) &&
    p.dimensions.unit === 'centimeter' && ['length', 'width', 'height'].every(k => positive((p.dimensions as Record<string, unknown>)[k]));
}
function pricedTerms(v: Record<string, unknown>): boolean {
  const r = v.refund;
  if (v.costs !== 'buyer_pays_return' || v.financing !== 'instruction_required' || v.sellerReturnLabelDebitAuthorized !== false ||
      !convenienceObject(r) || !convenienceExact(r, ['basis', 'currency', 'originalArticleCents', 'alreadyAllocatedArticleCents', 'maximumRemainingArticleCents', 'excluded', 'paymentAllocation', 'execution']) ||
      r.basis !== 'article_price_only' || r.currency !== 'CAD' || r.paymentAllocation !== 'original_payment_sources_required' || r.execution !== 'separate_native_instruction_required' ||
      !['originalArticleCents', 'alreadyAllocatedArticleCents', 'maximumRemainingArticleCents'].every(k => typeof r[k] === 'number' && Number.isSafeInteger(r[k]) && r[k] >= 0) ||
      !convenienceObject(r.excluded) || !convenienceExact(r.excluded, ['outboundShippingCents', 'serviceFeeCents', 'serviceTaxCents'])) return false;
  return (r.originalArticleCents as number) > 0 && (r.alreadyAllocatedArticleCents as number) + (r.maximumRemainingArticleCents as number) === r.originalArticleCents &&
    ['outboundShippingCents', 'serviceFeeCents', 'serviceTaxCents'].every(k => typeof (r.excluded as Record<string, unknown>)[k] === 'number' && Number.isSafeInteger((r.excluded as Record<string, unknown>)[k]) && ((r.excluded as Record<string, unknown>)[k] as number) >= 0);
}
export function isConvenienceCommand(v: unknown): v is ConvenienceReturnCommand {
  return convenienceObject(v) && convenienceExact(v, ['action', 'sourceHash', 'expectedVersion', 'proposalId', 'conditionsAcknowledged', ...(Object.hasOwn(v, 'termsProtocol') ? ['termsProtocol'] : [])]) &&
    (!Object.hasOwn(v, 'termsProtocol') || v.termsProtocol === 'convenience_return_terms_v2') &&
    convenienceHash(v.sourceHash) && v.conditionsAcknowledged === true &&
    (v.action === 'request' ? v.expectedVersion === 0 && v.proposalId === null :
      ['accept', 'refuse'].includes(String(v.action)) && v.expectedVersion === 1 && convenienceProposalId(v.proposalId));
}
export function isConvenienceAttempt(v: unknown, uid: string, transactionId: string): v is ConvenienceReturnAttempt {
  return convenienceObject(v) && convenienceExact(v, ['version', 'uid', 'transactionId', 'requestId', 'capability', 'payloadHash', 'command']) &&
    v.version === 1 && v.uid === uid && convenienceId(v.uid) && v.transactionId === transactionId && convenienceId(transactionId) && convenienceId(v.requestId) &&
    v.requestId.length >= 16 && ['convenience_return_v1', 'convenience_return_v2'].includes(String(v.capability)) && convenienceHash(v.payloadHash) && isConvenienceCommand(v.command) &&
    (v.capability === 'convenience_return_v2' ? v.command.termsProtocol === 'convenience_return_terms_v2' : !Object.hasOwn(v.command, 'termsProtocol'));
}
export function createConvenienceInteraction() {
  let revision = 0;
  return {invalidate: () => {revision++;}, capture: () => {const expected = revision; return () => {if (expected !== revision) throw new Error('Les conditions affichées ont changé. Relisez la demande.');};}};
}
