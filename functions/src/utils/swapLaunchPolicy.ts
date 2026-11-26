import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { evaluateSwapLaunch, SWAP_LAUNCH_POLICY_VERSION, type EligibilityEvidence } from '../shared/eligibility';
import { readEligibilityEvidence, captureSellerActivityAdmission } from './eligibility';
import { userBlocks } from './blocking';
import { assertNewBusinessAdmission } from './businessAdmission';

export const SWAP_AGREEMENT_PROTOCOL = 'swap_exchange_agreement_v1';
export const SWAP_EXCHANGE_TERMS_VERSION = '2026-10-17.v1';
export const SWAP_EXCHANGE_TERMS = {
  hand_delivery: 'Les membres conviennent du lieu et du moment de la remise en main propre.',
  shipping: 'L’expédition et la réception ont lieu au Québec. Les membres conviennent de l’organisation de l’envoi et des frais avant toute expédition. Seconde ne génère aucune étiquette pour ce Troc.',
} as const;
export type SwapExchangeMode = keyof typeof SWAP_EXCHANGE_TERMS;

export function assertSwapExpectedUid(value: unknown, uid: string) {
  if (value !== uid) throw new HttpsError('permission-denied', 'La session de confirmation a changé. Relisez le Troc avec le compte connecté.',
    { reason: 'swap_session_changed' });
}
/** Legacy fulfilment keeps its old payload contract; a supplied session bound
 * by a current app must never silently execute as another authenticated user. */
export function assertProvidedSwapExpectedUid(data: unknown, uid: string) {
  if (data && typeof data === 'object' && 'expectedUid' in data) assertSwapExpectedUid(data.expectedUid, uid);
}
export function swapArticleIds(items: unknown): string[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20 || items.some(item =>
    !item || typeof item.articleId !== 'string' || !item.articleId.trim() || item.articleId.includes('/') || item.articleId.length > 128)) {
    throw new HttpsError('invalid-argument', 'Choisissez entre 1 et 20 articles par membre.');
  }
  const ids = items.map(item => item.articleId);
  if (new Set(ids).size !== ids.length) throw new HttpsError('invalid-argument', 'Un article ne peut figurer qu’une fois dans le Troc.');
  return ids;
}
export function swapArrangements(mode: unknown, value: unknown) {
  if ((mode !== 'hand_delivery' && mode !== 'shipping') || typeof value !== 'string' || !value.trim() || value.length > 2000) {
    throw new HttpsError('invalid-argument', 'Un mode et des modalités d’échange explicites sont requis.');
  }
  return { exchangeMode: mode as SwapExchangeMode, arrangements: value.trim() };
}
export function assertSwapLaunchEvidence(evidence: EligibilityEvidence) {
  const decision = evaluateSwapLaunch(evidence);
  if (!decision.allowed) throw new HttpsError('permission-denied', decision.messages[0],
    { reason: 'swap_eligibility_required', ...decision, actions: ['getMyEligibility', 'declareSellerActivity'] });
}
export async function assertNewSwapAdmission(tx: FirebaseFirestore.Transaction, caller: string, participants: string[], previewOnly=false) {
  await assertNewBusinessAdmission(previewOnly);
  const ownEvidence = await readEligibilityEvidence(tx, caller);
  assertSwapLaunchEvidence(ownEvidence);
  for (const uid of participants) {
    if (uid === caller) continue;
    const otherEvidence = await readEligibilityEvidence(tx, uid);
    if (!evaluateSwapLaunch(otherEvidence).allowed || userBlocks(ownEvidence.user, uid) || userBlocks(otherEvidence.user, caller)) throw new HttpsError('failed-precondition',
      'Ce Troc ne peut pas être poursuivi pour le moment. Vous pouvez contacter notre équipe.',
      { reason: 'counterparty_unavailable' });
  }
}
/** Separate witnesses: acceptance never replaces the proposal's observations. */
export async function captureSwapSellerActivities(tx: FirebaseFirestore.Transaction, swapId: string, participants: string[],
  phase: 'proposal'|'acceptance', sourceHash: string) {
  return captureSellerActivityAdmission(tx,participants,'swap',{kind:'swap',id:swapId,phase,sourceHash});
}
/** Native public article snapshots and explicit shared terms only. No private
 * age, residence evidence, controls, Stripe identity or address is hashed. */
export function swapAgreementSource(source: {
  scope: 'new_proposal' | 'legacy_preparation'; initiatorId: string; receiverId: string;
  initiatorItems: any[]; receiverItems: any[]; cashTopUp: unknown; message: string | null;
  exchangeMode: SwapExchangeMode; arrangements: string;
}) {
  const content = { protocol: SWAP_AGREEMENT_PROTOCOL, termsVersion: SWAP_EXCHANGE_TERMS_VERSION,
    termsText: SWAP_EXCHANGE_TERMS[source.exchangeMode], ...source };
  const canonical = JSON.stringify(content, (_key, value) => value instanceof Timestamp
    ? { seconds: value.seconds, nanoseconds: value.nanoseconds }
    : value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return { ...content, sourceHash: createHash('sha256').update(canonical).digest('hex') };
}
export function assertSwapAgreementExpected(data: any, sourceHash: string) {
  if (data.agreementProtocol !== SWAP_AGREEMENT_PROTOCOL || data.expectedSourceHash !== sourceHash) {
    throw new HttpsError('failed-precondition', 'Relisez le contenu et les modalités actuels avant de confirmer ce Troc.',
      { reason: 'swap_agreement_stale', action: 'reviewSwapAgreement' });
  }
}
export function swapAcknowledgementValid(value: any, uid: string, sourceHash: string): boolean {
  return value?.actorUid === uid && value.sourceHash === sourceHash && value.recordedAt instanceof Timestamp;
}
/** Servicing proof for an already accepted native agreement. A bare accepted
 * status, client flag or an old payment intent never substitutes for the two
 * exact contractual acknowledgements and the immutable proposal contents. */
export function hasNativeAcceptedSwapAgreement(swap:FirebaseFirestore.DocumentData):boolean{
  const a=swap.exchangeAgreement;
  const after=(left:Timestamp,right:Timestamp)=>left.seconds>right.seconds||left.seconds===right.seconds&&left.nanoseconds>right.nanoseconds;
  if(!a||a.protocol!==SWAP_AGREEMENT_PROTOCOL||a.scope!=='new_proposal'||a.termsVersion!==SWAP_EXCHANGE_TERMS_VERSION||
    !['hand_delivery','shipping'].includes(swap.exchangeMode)||a.exchangeMode!==swap.exchangeMode||
    a.termsText!==SWAP_EXCHANGE_TERMS[swap.exchangeMode as SwapExchangeMode]||typeof a.arrangements!=='string'||!a.arrangements.trim()||
    a.arrangements!==a.arrangements.trim()||!(swap.createdAt instanceof Timestamp)||!(swap.acceptedAt instanceof Timestamp)||
    swap.acceptedAt.toMillis()<=0||swap.acceptedAt.toMillis()>Date.now()||after(swap.createdAt,swap.acceptedAt)||
    swap.articleDeclarationProposalVersion!==1||!(swap.articleDeclarationProposalRecordedAt instanceof Timestamp)||
    after(swap.articleDeclarationProposalRecordedAt,swap.createdAt)||
    !swapAcknowledgementValid(a.initiatorAcknowledgement,swap.initiatorId,a.sourceHash)||
    !swapAcknowledgementValid(a.receiverAcknowledgement,swap.receiverId,a.sourceHash)||
    after(a.initiatorAcknowledgement.recordedAt,swap.createdAt)||
    after(a.receiverAcknowledgement.recordedAt,swap.acceptedAt))return false;
  for(const side of ['initiator','receiver'] as const){const items=swap[side+'Items'];
    if(!Array.isArray(items)||!items.length||items.length>20||items.some(item=>!item||typeof item.articleId!=='string'||!item.articleId||
      item.saleDeclarationProposalWitness?.schemaVersion!==1||item.saleDeclarationProposalWitness.source!=='native_article_at_proposal'||
      item.saleDeclarationProposalWitness.articleId!==item.articleId||item.saleDeclarationProposalWitness.sellerId!==swap[side+'Id']))return false;
  }
  return swapAgreementSource({scope:'new_proposal',initiatorId:swap.initiatorId,receiverId:swap.receiverId,
    initiatorItems:swap.initiatorItems,receiverItems:swap.receiverItems,cashTopUp:swap.cashTopUp??null,
    message:typeof swap.message==='string'?swap.message.trim()||null:null,exchangeMode:swap.exchangeMode,arrangements:a.arrangements}).sourceHash===a.sourceHash;
}

/** Only a native proposed mode fixed before the receiver's acceptance may be
 * ignored as an expiry-progress marker. Unknown/legacy agreements stay held. */
export function hasNativeUnacceptedSwapAgreement(data: FirebaseFirestore.DocumentData): boolean {
  const agreement = data.exchangeAgreement;
  if (data.status !== 'proposed' || data.swapLaunchPolicyVersion !== SWAP_LAUNCH_POLICY_VERSION ||
      !agreement || agreement.protocol !== SWAP_AGREEMENT_PROTOCOL || agreement.scope !== 'new_proposal' ||
      agreement.termsVersion !== SWAP_EXCHANGE_TERMS_VERSION ||
      !['hand_delivery', 'shipping'].includes(data.exchangeMode) || agreement.exchangeMode !== data.exchangeMode ||
      agreement.termsText !== SWAP_EXCHANGE_TERMS[data.exchangeMode as SwapExchangeMode] ||
      typeof agreement.arrangements !== 'string' || !agreement.arrangements.trim() || agreement.arrangements !== agreement.arrangements.trim() ||
      agreement.receiverAcknowledgement !== null ||
      !swapAcknowledgementValid(agreement.initiatorAcknowledgement, data.initiatorId, agreement.sourceHash) ||
      !(data.createdAt instanceof Timestamp) || agreement.initiatorAcknowledgement.recordedAt.toMillis() <= 0 ||
      agreement.initiatorAcknowledgement.recordedAt.toMillis() > data.createdAt.toMillis()) return false;
  for (const side of ['initiator', 'receiver'] as const) {
    const items = data[side + 'Items'];
    if (!Array.isArray(items) || items.length < 1 || items.length > 20 || items.some(item => {
      const witness = item?.saleDeclarationProposalWitness;
      return !item || typeof item.articleId !== 'string' || !item.articleId || witness?.schemaVersion !== 1 ||
        witness.source !== 'native_article_at_proposal' || witness.articleId !== item.articleId || witness.sellerId !== data[side + 'Id'] ||
        !(witness.declaration?.declaredAt instanceof Timestamp) || typeof witness.contentHash !== 'string' || !witness.content;
    })) return false;
  }
  const source = swapAgreementSource({ scope: 'new_proposal', initiatorId: data.initiatorId, receiverId: data.receiverId,
    initiatorItems: data.initiatorItems, receiverItems: data.receiverItems, cashTopUp: data.cashTopUp ?? null,
    message: typeof data.message === 'string' ? data.message.trim() || null : null,
    exchangeMode: data.exchangeMode, arrangements: agreement.arrangements });
  return source.sourceHash === agreement.sourceHash;
}

/** New proposals are invitations, never a unilateral lock of either member's
 * stock. The protected version and native unaccepted agreement are both
 * required; older proposals may already own locks and cannot be reclassified. */
export function hasUnreservedSwapProposal(data: FirebaseFirestore.DocumentData): boolean {
  if (data.inventoryReservationStage !== 'on_acceptance_v1' ||
      !['proposed', 'cancelled', 'declined'].includes(data.status) ||
      Object.prototype.hasOwnProperty.call(data, 'inventoryUnitCommitments') ||
      Object.keys(data).some(key => ['acceptedAt', 'initiatorPhotos', 'receiverPhotos', 'initiatorShippedAt', 'receiverShippedAt',
        'initiatorReceivedAt', 'receiverReceivedAt', 'completedAt', 'statusBeforeDispute', 'paymentIntentId',
        'stripePaymentIntentId', 'stripeChargeId', 'bankDispute'].includes(key) || /^(topup|refund|dispute)/i.test(key))) return false;
  return hasNativeUnacceptedSwapAgreement({...data, status: 'proposed'});
}
