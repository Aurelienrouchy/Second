import { createHash } from 'node:crypto';
import {assertInventoryAvailable} from './inventoryUnit';
import { HttpsError } from 'firebase-functions/v2/https';
import { evaluateEligibility, evaluateCurrentSellerEligibility, counterpartEligibilityRefusal, type EligibilityEvidence } from '../shared/eligibility';
import { readEligibilityEvidence, assertAccountSecurityOpen, assertOwnPublicationEligibility } from './eligibility';
import { hasUnavailableAccountStanding } from '../shared/accountStanding';
import { isArticleModerationRestricted } from '../shared/article';
import { db } from '../config/firebase';
import { assertArticleHygieneAdmitted } from './articleHygiene';
import { assertArticleSaleDeclaration } from './articleSaleDeclaration';
import { readArticleChildSafetySource } from './articleChildSafety';
import { readProductReviewAdmission } from './productReviewAdmission';
import { assertAccountRelationshipNewPair } from './accountRelationshipReview';
import { assertArticleNotSwapEngaged } from './articleSwapEngagement';
import { assertNewBusinessAdmission } from './businessAdmission';

/** NEW operations only. A seller observation is not product certification.
 * Only a dedicated decision on the current native source and documentary
 * corpus can admit a human-review source. No documentary issue substitutes. */
export async function assertArticleChildSafetyAdmitted(tx: FirebaseFirestore.Transaction, articleId: string, article: FirebaseFirestore.DocumentData): Promise<void> {
  const source = readArticleChildSafetySource(articleId, article);
  if (source.requirement === 'not_required' || source.requirement === 'daywear_statement' && source.statementQualification === 'native_current') return;
  if (source.requirement === 'human_review_required') {
    const admission = await readProductReviewAdmission(tx, articleId, article);
    if (admission.allowed === true && admission.qualification === 'native_current_allow' && admission.currentSourceHash === source.sourceHash) return;
  }
  const statementMissing = source.requirement === 'seller_statement_required';
  throw new HttpsError('failed-precondition', statementMissing ? 'La déclaration du vêtement enfant doit être renseignée ou reconfirmée.'
    : 'Une décision d’admission dédiée est requise avant toute nouvelle opération sur ce vêtement enfant.',
    { reason: statementMissing ? 'article_child_safety_statement_required' : 'article_child_safety_review_required',
      action: 'reviewArticleChildSafety', physicalComplianceVerified: false, sourceHash: source.sourceHash });
}

/** Call after historical receipt recovery, before a new engagement/write. */
export function assertArticleNotModerationRestricted(article: { moderationStatus?: unknown }): void {
  if (isArticleModerationRestricted(article)) {
    throw new HttpsError('failed-precondition', 'Cette annonce ne permet pas de nouvelle opération pendant son examen.',
      { reason: 'article_moderation_restricted', action: 'reviewExistingOrderOrContactSupport' });
  }
}

function assertOwnAccountAvailable(user: FirebaseFirestore.DocumentData | null | undefined, scope: 'buy' | 'sell') {
  if (hasUnavailableAccountStanding(user)) throw new HttpsError('permission-denied', 'Votre compte ne peut pas créer une nouvelle opération.',
    { reason: 'account_unavailable', scope });
}
/** Roles/ownership must already be validated. Exact existing receipts bypass
 * this new-operation check; a new alias still checks both participants. */
export function assertMeetupAccountsAvailable(
  ownUser: FirebaseFirestore.DocumentData | null | undefined,
  otherUser: FirebaseFirestore.DocumentData | null | undefined,
  ownScope: 'buy' | 'sell',
) {
  assertOwnAccountAvailable(ownUser, ownScope);
  if (hasUnavailableAccountStanding(otherUser)) {
    const generic = counterpartEligibilityRefusal(ownScope === 'sell' ? 'buy' : 'sell');
    throw new HttpsError('failed-precondition', generic.message, generic);
  }
}
export async function assertOwnTradingEligibility(evidence: EligibilityEvidence, scope: 'buy' | 'sell',
  tx: FirebaseFirestore.Transaction, expectedUid: string, commercialAcquisition=true): Promise<void> {
  // Only a server-qualified engaged contract can use false. Current account,
  // security and eligibility guards below remain unchanged for its new debit.
  if(commercialAcquisition)await assertNewBusinessAdmission();
  await assertAccountSecurityOpen(evidence.profile, tx, expectedUid);
  assertOwnAccountAvailable(evidence.user, scope);
  const decision = evaluateEligibility(evidence, scope);
  if (!decision.allowed) throw new HttpsError('permission-denied', decision.messages[0], {
    reason: 'eligibility_required', scope, reasons: decision.reasons, messages: decision.messages,
    policyVersion: decision.policyVersion, actions: ['getMyEligibility', 'requestEligibilityReview'],
  });
}
/** Handlers must bind participants/ownership before calling. Read both current
 * sources before writes, explain the caller's own scope first, never the other's. */
export async function assertNewMeetupAdmission(tx: FirebaseFirestore.Transaction, caller: string, seller: string, buyer: string,
  articleId: string) {
  await assertAccountRelationshipNewPair(tx, buyer, seller);
  const article = (await tx.get(db.collection('articles').doc(articleId))).data();
  if (!article || article.sellerId !== seller || article.isActive === false || article.isHandDelivery === false) {
    throw new HttpsError('failed-precondition', 'Cet article ne permet plus de nouvelle opération.');
  }
  await assertArticleNotSwapEngaged(tx, articleId);
  await assertInventoryAvailable(tx,articleId,article);
  assertArticleNotModerationRestricted(article);
  assertArticleHygieneAdmitted(article);
  // V2's explicit unit choice qualifies EACH listing. A meetup remains one
  // entire listed unit; a swap's separate multi-listing contract is unchanged.
  assertArticleSaleDeclaration(articleId, article);
  await assertArticleChildSafetyAdmitted(tx, articleId, article);
  const sellerEvidence = await readEligibilityEvidence(tx, seller);
  const buyerEvidence = await readEligibilityEvidence(tx, buyer);
  const callerIsSeller = caller === seller;
  assertMeetupAccountsAvailable(callerIsSeller ? sellerEvidence.user : buyerEvidence.user,
    callerIsSeller ? buyerEvidence.user : sellerEvidence.user, callerIsSeller ? 'sell' : 'buy');
  if (callerIsSeller) await assertOwnPublicationEligibility(sellerEvidence, tx, caller);
  else await assertOwnTradingEligibility(buyerEvidence, 'buy', tx, caller);
  const otherScope = callerIsSeller ? 'buy' : 'sell';
  if (!(callerIsSeller ? evaluateEligibility(buyerEvidence, 'buy') : evaluateCurrentSellerEligibility(sellerEvidence, 'sell')).allowed) {
    const generic = counterpartEligibilityRefusal(otherScope);
    throw new HttpsError('failed-precondition', generic.message, generic);
  }
  return article;
}
/** Hash only declared operation inputs, never age/profile/private metadata. */
export function commercialRequestHash(data: Record<string, unknown>, fields: readonly string[]): string {
  const selected = Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, data[field]]));
  const canonical = JSON.stringify(selected, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return createHash('sha256').update(canonical).digest('hex');
}
export const LEGACY_PUBLICATION_INPUT_FIELDS = ['title', 'description', 'price', 'images', 'category', 'categoryIds', 'condition',
  'isHandDelivery', 'isShipping', 'neighborhoods', 'neighborhood', 'size', 'brand', 'colors', 'color', 'materials', 'material', 'packageSize',
  'hasKnownDefects', 'defectsDescription', 'brandStatus', 'hasAlterations', 'alterationsDescription', 'hygieneDeclaration'] as const;
export const PUBLICATION_V2_INPUT_FIELDS = [...LEGACY_PUBLICATION_INPUT_FIELDS, 'quantity', 'stock', 'saleDeclaration'] as const;
export const PUBLICATION_INPUT_FIELDS = [...PUBLICATION_V2_INPUT_FIELDS, 'childSafetyDeclaration'] as const;
/** New publication data, without the removed seller questionnaires. Historical
 * arrays above remain immutable so exact old receipts retain their hashes. */
export const PUBLICATION_V5_INPUT_FIELDS = PUBLICATION_INPUT_FIELDS.filter(field =>
  !['brandStatus', 'hasAlterations', 'alterationsDescription', 'saleDeclaration'].includes(field));
export const PUBLICATION_V6_INPUT_FIELDS = PUBLICATION_V5_INPUT_FIELDS.filter(field =>
  !['hasKnownDefects', 'defectsDescription'].includes(field));
export const PROPOSAL_INPUT_FIELDS = ['chatId', 'amount', 'location', 'message', 'originalMessageId', 'counterKind', 'dateTime'] as const;
