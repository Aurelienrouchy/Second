import {providerSecretsForDeployment} from '../config/phase1Deployment';
import {activeLocalAgreementScope,assertLocalAgreementReadable} from '../utils/localAgreement';
import { financialRecoverySourceFields } from "../utils/financialRecoverySources";
import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import {PHASE1_CONTRACT} from '../utils/phase1LegacyFence';
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { financialRecoveryWalletFields } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
import {assertInventoryAvailable,inventoryEngagementMatches,planInventoryAcquire,planInventoryFinish,type InventoryPlan} from '../utils/inventoryUnit';
/**
 * Swap callable functions
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * ============================================================
 * SWAP ZONE MODEL — single permanent generalist zone
 * ============================================================
 * The Swap Zone is ONE permanent, generalist, always-open zone. There is no
 * join/leave model, no participants, no theme, no time window. Any authenticated
 * user can deposit an item, browse, and propose a swap. The zone document lives
 * at a deterministic id (see GENERALIST_ZONE_ID) and is bootstrapped idempotently
 * via ensureGeneralistZone.
 *
 * cashTopUp (money adjustment) is paid for real via Stripe with the SAME buyer
 * protection fee as a normal purchase (0% seller commission). The plumbing is
 * calqued on the purchase flow (createStripeCheckout / stripeWebhook):
 *  - proposeMultiSwap persists cashTopUp { amount (cents), payerId }
 *  - acceptSwap on a top-up swap transitions to 'payment_pending'
 *  - createSwapTopUpCheckout journals a direct platform PaymentIntent with
 *    manual server confirmation; the client only handles the required 3DS step
 *  - stripeWebhook (payment_intent.succeeded, type=swap_topup) advances the swap
 *    to 'accepted' (exchange mode flow) and credits the payee wallet pendingBalance
 *  - confirmSwapReception moves the payee funds pending → held with a 7-day
 *    release deadline (topUpFundsReleaseAt), EXACTLY like a delivered purchase —
 *    NOT straight to withdrawable balance
 *  - releaseHeldFunds (scheduled) moves held → balance once the window elapses
 *    and stamps topUpReleasedAt
 *  - cancel/dispute BEFORE release (topUpReleasedAt unset: funds in pending OR
 *    held) refund the payer via Stripe (charge.refunded webhook claws the
 *    complement back from the right bucket). This makes the POST-RECEPTION
 *    dispute window effective.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue, storage } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { assertNewPaymentsEnabled } from '../config/featureFlags';
import { SWAP_DISPUTE_REVIEW_CAPABILITY, handleSwapDisputeReview } from '../utils/swapDisputeReview';
import {captureSwapProofObjects} from '../utils/swapProofMedia';
import { storageObjectPath } from '../utils/articleMedia';
import { readPendingSwapTopUp } from '../utils/swapHeldFunds';
import {historicalReviewBody, prepareVisibleRating} from '../utils/reviewVisibility';
import { prepareOperationalNotices, readOperationalNoticeReceipts, type OperationalNoticeInput } from '../utils/notifications';
import { createHash } from 'node:crypto';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { captureServerEvent } from '../lib/analytics';
import { assertAccountRelationshipNewPair } from '../utils/accountRelationshipReview';
import { SWAP_TOPUP_MANUAL_CAPABILITY, handleSwapTopUpCheckout } from '../utils/swapTopUpCheckout';
import {requestSwapTopUpRefund} from '../utils/swapTopUpRefund';
import { assertArticleNotModerationRestricted, assertArticleChildSafetyAdmitted } from '../utils/tradeAdmission';
import { assertArticleHygieneAdmitted } from '../utils/articleHygiene';
import { assertArticleSaleDeclaration, saleDeclarationContent } from '../utils/articleSaleDeclaration';
import { articleHygieneRequirement } from '../shared/articleHygiene';
import { shippingItemProjection } from '../utils/shippingSourceIdentity';
import { publicProfileImage, articlePrivacyWithdrawn } from '../utils/publicProfile';
import { SWAP_LAUNCH_POLICY_VERSION } from '../shared/eligibility';
import { assertArticleNotSwapEngaged } from '../utils/articleSwapEngagement';
import { recordOwnAdmissionRefusal, throwRecordedAdmissionRefusal } from '../utils/admissionDecision';
import { assertNewSwapAdmission, captureSwapSellerActivities, assertSwapExpectedUid, assertProvidedSwapExpectedUid, swapArticleIds, swapArrangements, swapAgreementSource,
  assertSwapAgreementExpected, swapAcknowledgementValid, hasUnreservedSwapProposal, SWAP_AGREEMENT_PROTOCOL, SWAP_EXCHANGE_TERMS_VERSION, SWAP_EXCHANGE_TERMS } from '../utils/swapLaunchPolicy';

/** Rate-limit sliding window (1 min), aligned with payments.ts. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Deterministic document id for the single permanent generalist Swap Zone.
 * Using a fixed id guarantees uniqueness (a second zone can never be created by
 * accident) and gives O(1) reads instead of a query.
 */
export const GENERALIST_ZONE_ID = 'generalist';
const GENERALIST_ZONE_NAME = 'Le Troc';

/** Strip undefined values (Firestore rejects undefined) */
const stripUndefined = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

const recordedSwapDate = (value: unknown): value is Timestamp => value instanceof Timestamp &&
  Number.isFinite(value.toMillis()) && value.toMillis() > 0 && value.toMillis() <= Date.now();

/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap: any, side: 'initiator' | 'receiver'): any[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}
const sameProposalContent = (left: unknown, right: unknown) => JSON.stringify(left, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value) ===
  JSON.stringify(right, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const DECLARATION_WITNESS_FIELDS = ['schemaVersion', 'version', 'scope', 'source', 'accepted', 'articleId', 'actorUid',
  'quantity', 'contentHash', 'requestHash', 'previousContentHash', 'saleUnit'] as const;
const declarationWitnessFields = (declaration: any): readonly string[] => declaration?.version === 'personal_item_v3'
  ? [...DECLARATION_WITNESS_FIELDS, 'counterfeitStatus'] : DECLARATION_WITNESS_FIELDS;
function sameProposedSaleDeclaration(proposed: any, current: any): boolean {
  return proposed?.declaredAt instanceof Timestamp && current?.declaredAt instanceof Timestamp && proposed.declaredAt.isEqual(current.declaredAt) &&
    declarationWitnessFields(current).every(key => proposed[key] === current[key]);
}

/**
 * Validate that all articles in a list are available (exist, isActive, not isSold)
 * AND, when `expectedOwnerId` is provided, that each article belongs to that user
 * (article.sellerId === expectedOwnerId).
 *
 * The ownership check is a HARD financial/integrity invariant: a swap engages a
 * party's OWN items only. Without it, the initiator could stage someone else's
 * articles on either side (privilege escalation / corruption of third-party
 * articles when the swap completes and marks them sold, plus spoofed reviews on
 * an unrelated user). The article's `sellerId` is the sole source of truth for
 * ownership — never the client-supplied item payload.
 *
 * Must be called inside a transaction; reads via the transaction handle.
 */
async function validateArticlesAvailable(
  tx: FirebaseFirestore.Transaction,
  items: { articleId: string; title?: string }[],
  label: string,
  expectedOwnerId?: string,
  snapshots?: Record<string, Record<string, unknown>>,
  requireProposalWitness = false,
  ownSwapId?: string,
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const item of items) {
    const articleRef = db.collection('articles').doc(item.articleId);
    const articleSnap = await tx.get(articleRef);

    if (!articleSnap.exists) {
      throw new HttpsError(
        'not-found',
        `${label} : l'article "${item.title || item.articleId}" n'existe plus`
      );
    }

    const data = articleSnap.data()!;
    // Ownership invariant — checked against the article's authoritative sellerId,
    // not the client payload. Use the same 'not-found' wording as a missing item
    // so an attacker cannot probe which articles belong to which user.
    if (expectedOwnerId != null && data.sellerId !== expectedOwnerId) {
      throw new HttpsError(
        'permission-denied',
        `${label} : l'article "${item.title || item.articleId}" n'appartient pas au participant attendu`
      );
    }
    if(ownSwapId) {
      if(!await inventoryEngagementMatches(tx,item.articleId,data,{kind:'swap',id:ownSwapId,sourceArticleId:item.articleId}))throw new HttpsError('failed-precondition','Le verrou de cet exemplaire diffère du Troc.',{reason:'inventory_unit_engagement_conflict'});
    } else await assertInventoryAvailable(tx,item.articleId,data);
    assertArticleNotModerationRestricted(data);
    assertArticleHygieneAdmitted(data);
    assertArticleSaleDeclaration(item.articleId, data);
    await assertArticleChildSafetyAdmitted(tx, item.articleId, data);
    const proposed = item as Record<string, unknown>;
    const witness = proposed.saleDeclarationProposalWitness as any;
    if (requireProposalWitness && (!witness || witness.schemaVersion !== 1 || witness.source !== 'native_article_at_proposal' ||
        witness.articleId !== item.articleId || witness.sellerId !== data.sellerId || witness.contentHash !== data.saleDeclaration.contentHash ||
        !sameProposedSaleDeclaration(witness.declaration, data.saleDeclaration) || !sameProposalContent(witness.content, saleDeclarationContent(data)))) {
      throw new HttpsError('failed-precondition', 'Le contenu ou la déclaration de cet exemplaire diffère de la proposition, ou sa preuve manque. Examinez une nouvelle proposition avant de l’accepter.',
        { reason: 'swap_sale_declaration_proposal_stale', action: 'reviewNewSwapProposal' });
    }
    if (requireProposalWitness && (articleHygieneRequirement(data.categoryIds) !== 'none'
        || (proposed.hygieneDeclaration != null && articleHygieneRequirement(proposed.categoryIds) !== 'none'))) {
      const keys = ['categoryIds', 'condition', 'hygieneDeclaration'];
      if (keys.some(key => JSON.stringify(proposed[key]) !== JSON.stringify(data[key]))) {
        throw new HttpsError('failed-precondition', 'La déclaration d’hygiène de cet article a changé ou manque à la proposition. Examinez une nouvelle proposition avant de l’accepter.',
          { reason: 'swap_hygiene_proposal_stale', action: 'reviewNewSwapProposal' });
      }
    }
    // Explicit null also replaces any forged client declaration on an article
    // that has no applicable hygiene rule.
    if (snapshots) snapshots[item.articleId] = { ...shippingItemProjection(data), hygieneDeclaration: data.hygieneDeclaration ?? null,
      saleDeclarationProposalWitness: { schemaVersion: 1, source: 'native_article_at_proposal', articleId: item.articleId,
        sellerId: data.sellerId, contentHash: data.saleDeclaration.contentHash,
        declaration: { ...Object.fromEntries(declarationWitnessFields(data.saleDeclaration).filter(key => data.saleDeclaration[key] !== undefined)
          .map(key => [key, data.saleDeclaration[key]])), declaredAt: data.saleDeclaration.declaredAt },
        content: saleDeclarationContent(data) } };
    if (data.isActive === false) {
      throw new HttpsError(
        'failed-precondition',
        `${label} : l'article "${item.title || item.articleId}" n'est plus actif`
      );
    }
    if (data.isSold === true && !ownSwapId) {
      throw new HttpsError(
        'failed-precondition',
        `${label} : l'article "${item.title || item.articleId}" a déjà été vendu`
      );
    }
    // Authoritative server price — never the client payload (P1-6).
    prices[item.articleId] = typeof data.price === 'number' ? data.price : 0;
  }
  return prices;
}

// ============================================================
// GENERALIST ZONE BOOTSTRAP
// ============================================================

/**
 * Idempotently ensure the single permanent generalist Swap Zone exists.
 *
 * Upserts ONE document at the deterministic id GENERALIST_ZONE_ID. Counters
 * (itemsCount, swapsCount) are NEVER overwritten if the document already exists
 * — the upsert only sets descriptive fields + updatedAt. This makes the call
 * safe to invoke repeatedly (e.g. on app boot) without resetting live counters.
 *
 * No theme / startDate / endDate / status / participantsCount: the zone is
 * generalist, permanent and open to all.
 *
 * Returns { id } so the client can route to the zone without a query.
 */
export const ensureGeneralistZone = onCall(
  // 512MiB: same reason as getActiveSwapPartyInfo — 256MiB OOMs on cold start
  // with the grown shared bundle (this is why its first deploy failed readiness).
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async () => {
    return withFinancialRecoveryScope({operation: "callable/swaps.ensureGeneralistZone"}, async () => {
    const zoneRef = db.collection('swapParties').doc(GENERALIST_ZONE_ID);

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(zoneRef);
        await financialRecoveryCommitCheckpoint()({refs:[zoneRef.path]});

        if (!snap.exists) {
          // First-time creation: initialise counters to zero.
          tx.set(zoneRef, {
            name: GENERALIST_ZONE_NAME,
            isGeneralist: true,
            itemsCount: 0,
            swapsCount: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          return;
        }

        // Idempotent upsert: refresh descriptive fields + ensure isGeneralist,
        // but DO NOT touch itemsCount / swapsCount (live counters).
        tx.set(
          zoneRef,
          {
            name: GENERALIST_ZONE_NAME,
            isGeneralist: true,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      logger.info('Generalist swap zone ensured', { id: GENERALIST_ZONE_ID });
      return { id: GENERALIST_ZONE_ID };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error ensuring generalist swap zone', { error: message });
      throw new HttpsError('internal', 'Failed to ensure swap zone: ' + message);
    }

    });
  }
);

/**
 * Get the single, always-on generalist Swap Zone for the homepage.
 *
 * Reads the deterministic generalist document directly (O(1)). If the document
 * does not exist yet, it is created on the fly (idempotent bootstrap) so the
 * feature can never be "dead" because the seeder was never run.
 *
 * Exposes only live counters — no theme / startDate / endDate / status /
 * participantsCount. The front derives "nouveautés cette semaine" from the
 * items themselves.
 */
export const getActiveSwapPartyInfo = onCall(
  // 512MiB: the shared functions bundle grew (Stripe/ShipEngine/scheduled), so a
  // 256MiB instance now OOMs (~312MiB) on cold start → readiness fails → 500.
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async () => {
    return withFinancialRecoveryScope({operation: "callable/swaps.getActiveSwapPartyInfo"}, async () => {
    try {
      const zoneRef = db.collection('swapParties').doc(GENERALIST_ZONE_ID);
      let snap = await zoneRef.get();

      // Self-healing bootstrap: create the zone if it is missing.
      if (!snap.exists) {
        await db.runTransaction(async (tx) => {
          const current = await tx.get(zoneRef);
          if (current.exists) return;
          await financialRecoveryCommitCheckpoint()({refs:[zoneRef.path]});
          tx.create(zoneRef, {
            name: GENERALIST_ZONE_NAME,
            isGeneralist: true,
            itemsCount: 0,
            swapsCount: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
        snap = await zoneRef.get();
      }

      const data = snap.data()!;
      return {
        hasActiveParty: true,
        party: {
          id: snap.id,
          name: !data.name || data.name === 'Swap Zone' ? GENERALIST_ZONE_NAME : data.name,
          itemsCount: data.itemsCount || 0,
          swapsCount: data.swapsCount || 0,
        },
      };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting active swap party info', { error: message });
      throw new HttpsError('internal', 'Failed to get swap party info: ' + message);
    }

    });
  }
);

// ============================================================
// PROPOSE / ACCEPT
// ============================================================

function swapParticipantId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 128) throw new HttpsError('invalid-argument', 'Participant invalide.');
  return value;
}
function swapTopUpInput(value: any, initiatorId: string, receiverId: string) {
  if (value == null) return null;
  assertNewPaymentsEnabled();
  if (typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.amount) || value.amount <= 0 || value.amount > 500000 ||
      ![initiatorId, receiverId].includes(value.payerId)) throw new HttpsError('invalid-argument', 'Complément monétaire invalide.');
  return { amount: value.amount as number, payerId: value.payerId as string };
}
function nativeSwapItems(ids: string[], snapshots: Record<string, Record<string, unknown>>) {
  return ids.map(articleId => ({ articleId, ...snapshots[articleId],
    imageUrl: ((snapshots[articleId].images as any[])?.[0]?.url as string | undefined) ?? null }));
}
async function readNewSwapSource(tx: FirebaseFirestore.Transaction, uid: string, data: any, deferAdmission = false) {
  const receiverId = swapParticipantId(data.receiverId);
  if (receiverId === uid) throw new HttpsError('invalid-argument', 'Impossible de proposer un échange avec soi-même.');
  const initiatorIds = swapArticleIds(data.initiatorItems), receiverIds = swapArticleIds(data.receiverItems);
  if (new Set([...initiatorIds, ...receiverIds]).size !== initiatorIds.length + receiverIds.length) {
    throw new HttpsError('invalid-argument', 'Un article ne peut figurer qu’une fois dans le Troc.');
  }
  const terms = swapArrangements(data.exchangeMode, data.arrangements);
  if (data.message != null && (typeof data.message !== 'string' || data.message.length > 2000)) throw new HttpsError('invalid-argument', 'Message invalide.');
  const message = typeof data.message === 'string' ? data.message.trim() || null : null;
  const cashTopUp = swapTopUpInput(data.cashTopUp, uid, receiverId);
  if (!deferAdmission) {
    await assertNewSwapAdmission(tx, uid, [uid, receiverId], true);
    await assertAccountRelationshipNewPair(tx, uid, receiverId);
  }
  const snapshots: Record<string, Record<string, unknown>> = {};
  await validateArticlesAvailable(tx, initiatorIds.map(articleId => ({ articleId })), 'Article proposé', uid, snapshots);
  await validateArticlesAvailable(tx, receiverIds.map(articleId => ({ articleId })), 'Article demandé', receiverId, snapshots);
  const unitIds:string[]=[];
  for(const articleId of [...initiatorIds,...receiverIds]) {const article=(await tx.get(db.collection('articles').doc(articleId))).data()!;unitIds.push(await assertInventoryAvailable(tx,articleId,article));}
  if(unitIds.some(unit=>!unit) || new Set(unitIds).size!==unitIds.length)throw new HttpsError('failed-precondition','Un même exemplaire ne peut figurer plusieurs fois dans un Troc.',{reason:'inventory_unit_duplicate_in_swap'});
  for (const articleId of [...initiatorIds, ...receiverIds]) await assertArticleNotSwapEngaged(tx, articleId);
  return swapAgreementSource({ scope: 'new_proposal', initiatorId: uid, receiverId,
    initiatorItems: nativeSwapItems(initiatorIds, snapshots), receiverItems: nativeSwapItems(receiverIds, snapshots), cashTopUp, message, ...terms });
}
function storedSwapSource(swap: any, terms = swapArrangements(swap.exchangeAgreement?.exchangeMode, swap.exchangeAgreement?.arrangements),
  scope: 'new_proposal' | 'legacy_preparation' = swap.exchangeAgreement?.scope) {
  const agreement = swap.exchangeAgreement;
  if (agreement != null && (agreement.protocol !== SWAP_AGREEMENT_PROTOCOL || !['new_proposal', 'legacy_preparation'].includes(agreement.scope) ||
      agreement.termsVersion !== SWAP_EXCHANGE_TERMS_VERSION || agreement.termsText !== SWAP_EXCHANGE_TERMS[terms.exchangeMode])) {
    throw new HttpsError('failed-precondition', 'La source des modalités nécessite un examen. Contactez notre équipe.', { reason: 'swap_agreement_unqualified' });
  }
  if (scope === 'legacy_preparation') {
    const items = [...getSwapItems(swap, 'initiator'), ...getSwapItems(swap, 'receiver')];
    const provenance = swap.articleDeclarationProposalVersion === 1 && swap.articleDeclarationProposalRecordedAt instanceof Timestamp &&
      getSwapItems(swap, 'initiator').length > 0 && getSwapItems(swap, 'receiver').length > 0 && items.every(item => {
        const witness = item.saleDeclarationProposalWitness;
        return typeof item.articleId === 'string' && witness?.schemaVersion === 1 && witness.source === 'native_article_at_proposal' &&
          witness.articleId === item.articleId && witness.declaration?.declaredAt instanceof Timestamp &&
          witness.sellerId === (getSwapItems(swap, 'initiator').includes(item) ? swap.initiatorId : swap.receiverId) &&
          typeof witness.contentHash === 'string' && witness.content && typeof witness.content === 'object';
      });
    if (!provenance) throw new HttpsError('failed-precondition',
      'Les articles enregistrés de ce Troc nécessitent un examen. Contactez notre équipe pour sa préparation.',
      { reason: 'swap_agreement_source_unknown', action: 'contactSupport' });
  }
  return swapAgreementSource({ scope, initiatorId: swap.initiatorId, receiverId: swap.receiverId,
    initiatorItems: getSwapItems(swap, 'initiator'), receiverItems: getSwapItems(swap, 'receiver'), cashTopUp: swap.cashTopUp ?? null,
    message: typeof swap.message === 'string' ? swap.message.trim() || null : null, ...terms });
}
function assertSwapFulfilmentAgreement(swap: FirebaseFirestore.DocumentData) {
  const agreement = swap.exchangeAgreement, source = storedSwapSource(swap);
  if (source.sourceHash !== agreement?.sourceHash || swap.exchangeMode !== source.exchangeMode ||
      !swapAcknowledgementValid(agreement?.initiatorAcknowledgement, swap.initiatorId, source.sourceHash) ||
      !swapAcknowledgementValid(agreement?.receiverAcknowledgement, swap.receiverId, source.sourceHash)) {
    throw new HttpsError('failed-precondition', 'Confirmez les modalités de votre troc avant de poursuivre.', {reason: 'swap_agreement_unqualified'});
  }
}
/** Existing owner reader dispatches here. Never writes a proposal, receipt or
 * draft, and unknown/old reader DTOs cannot be mistaken for a consent preview. */
export async function readSwapAgreementPreview(tx: FirebaseFirestore.Transaction, uid: string, data: any) {
  assertSwapExpectedUid(data.expectedUid, uid);
  if (data.operation === 'swap_proposal_preview') {
    if (!Array.isArray(data.initiatorArticleIds) || !Array.isArray(data.receiverArticleIds)) throw new HttpsError('invalid-argument', 'Articles requis.');
    return readNewSwapSource(tx, uid, { ...data,
      initiatorItems: data.initiatorArticleIds.map((articleId: unknown) => ({ articleId })),
      receiverItems: data.receiverArticleIds.map((articleId: unknown) => ({ articleId })) });
  }
  const swap = (await tx.get(db.collection('swaps').doc(swapParticipantId(data.swapId)))).data();
  if (!swap || ![swap.initiatorId, swap.receiverId].includes(uid)) throw new HttpsError('permission-denied', 'Ce Troc ne vous est pas accessible.');
  if (swap.status !== 'accepted') throw new HttpsError('failed-precondition', 'Cet échange n’attend pas de préparation.');
  const terms = swapArrangements(data.exchangeMode, data.arrangements);
  if (swap.exchangeMode != null && swap.exchangeMode !== terms.exchangeMode) throw new HttpsError('failed-precondition', 'Le mode déjà engagé doit être conservé.');
  if (swap.exchangeAgreement?.protocol === SWAP_AGREEMENT_PROTOCOL) {
    const source = storedSwapSource(swap);
    if (source.sourceHash !== swap.exchangeAgreement.sourceHash || terms.exchangeMode !== source.exchangeMode || terms.arrangements !== source.arrangements) {
      throw new HttpsError('failed-precondition', 'Les modalités déjà confirmées doivent être conservées.', { reason: 'swap_agreement_stale' });
    }
    return source;
  }
  return storedSwapSource(swap, terms, 'legacy_preparation');
}

/**
 * Propose a multi-article swap.
 * Supports swapping multiple items on each side, plus an optional cashTopUp
 * (money adjustment paid via Stripe). Uses runTransaction to atomically verify
 * article availability before creating the swap.
 *
 * cashTopUp: { amount: number (CENTS, > 0), payerId: string }
 *   - payerId MUST be either initiatorId or receiverId.
 *   - The payer pays `amount` + buyer protection fee via Stripe to the OTHER
 *     party (the payee). Nothing is charged at proposal time — the charge
 *     happens after acceptance via createSwapTopUpCheckout.
 */
export const proposeMultiSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.proposeMultiSwap"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const {
      initiatorId,
      initiatorName,
      initiatorImage,
      initiatorItems,
      receiverItems,
      receiverId,
      receiverName,
      receiverImage,
      cashTopUp,
      partyId,
    } = request.data;
    assertSwapExpectedUid(request.data.expectedUid, request.auth.uid);
    const clientRequestId = request.data.clientRequestId;
    if (typeof clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(clientRequestId)) {
      throw new HttpsError('invalid-argument', 'Une référence de proposition est requise.');
    }

    // Auth: initiatorId must match the authenticated user
    if (initiatorId !== request.auth.uid) {
      throw new HttpsError(
        'permission-denied',
        'L\'initiateur doit correspondre à l\'utilisateur authentifié'
      );
    }

    // Validate required fields
    if (!initiatorId || !initiatorName || !receiverId || !receiverName) {
      throw new HttpsError('invalid-argument', 'Missing required user information');
    }

    if (initiatorId === receiverId) {
      throw new HttpsError('invalid-argument', 'Impossible de proposer un échange avec soi-même');
    }

    if (!Array.isArray(initiatorItems) || initiatorItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Initiator must provide at least one item');
    }

    if (!Array.isArray(receiverItems) || receiverItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Receiver must provide at least one item');
    }

    // --- Validate cashTopUp (optional) -------------------------------------
    let validatedTopUp: { amount: number; payerId: string } | null = null;
    if (cashTopUp != null) {
      if (typeof cashTopUp !== 'object') {
        throw new HttpsError('invalid-argument', 'cashTopUp doit être un objet { amount, payerId }');
      }
      const { amount, payerId } = cashTopUp;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        throw new HttpsError('invalid-argument', 'cashTopUp.amount doit être un entier de cents > 0');
      }
      // Sanity cap: $5000 = 500000 cents (mirrors offer ceiling in messages rules)
      if (amount > 500000) {
        throw new HttpsError('invalid-argument', 'cashTopUp.amount dépasse le plafond autorisé');
      }
      if (typeof payerId !== 'string' || (payerId !== initiatorId && payerId !== receiverId)) {
        throw new HttpsError(
          'invalid-argument',
          'cashTopUp.payerId doit être l\'initiateur ou le destinataire'
        );
      }
      validatedTopUp = { amount, payerId };
    }

    const terms = swapArrangements(request.data.exchangeMode, request.data.arrangements);
    const proposalRequestHash = createHash('sha256').update(JSON.stringify([
      'swap_proposal_request_v1', initiatorId, receiverId, swapArticleIds(initiatorItems), swapArticleIds(receiverItems),
      validatedTopUp, terms.exchangeMode, terms.arrangements,
      typeof request.data.message === 'string' ? request.data.message.trim() || null : request.data.message ?? null,
      partyId ?? null, request.data.agreementProtocol, request.data.expectedSourceHash,
    ])).digest('hex');
    const newSwapRef = db.collection('swaps').doc('swap_' + createHash('sha256')
      .update(JSON.stringify(['swap_proposal_request_v1', initiatorId, clientRequestId])).digest('hex'));

    try {
      // Atomically verify all articles and create the swap.
      // OWNERSHIP: the initiator may only engage articles they own; the items
      // requested from the receiver must actually belong to the receiver.
      const proposalResult = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const newSwapSnapshot = await tx.get(newSwapRef);
        if (newSwapSnapshot.exists) {
          const prior = newSwapSnapshot.data()!;
          if (prior.initiatorId !== initiatorId || prior.proposalRequestId !== clientRequestId || prior.proposalRequestHash !== proposalRequestHash ||
              prior.exchangeAgreement?.sourceHash !== request.data.expectedSourceHash ||
              storedSwapSource(prior).sourceHash !== prior.exchangeAgreement.sourceHash) {
            throw new HttpsError('failed-precondition', 'Cette proposition ne correspond plus à cet envoi. Relisez les articles avant de poursuivre.');
          }
          return {swapId: newSwapRef.id}; // The same committed proposal remains recoverable without new admission or locks.
        }
        // The mutator proves native ownership and the exact agreed source
        // before recording its own refusal. GET previews remain read-only.
        const source = await readNewSwapSource(tx, initiatorId, request.data, true);
        assertSwapAgreementExpected(request.data, source.sourceHash);
        await assertPrivateAccountSession(request, tx);
        const admissionRefusal = await recordOwnAdmissionRefusal(tx, { request, ownerId: initiatorId, operation: 'proposeMultiSwap', scope: 'swap',
          sourceContext: { kind: 'swap_proposal', agreementSourceHash: source.sourceHash,
            ownArticleIds: source.initiatorItems.map(item => item.articleId) } });
        if (admissionRefusal) return admissionRefusal;
        await assertNewSwapAdmission(tx, initiatorId, [initiatorId, receiverId]);
        await assertAccountRelationshipNewPair(tx, initiatorId, receiverId);
        const allArticleIds = [...source.initiatorItems, ...source.receiverItems].map(item => item.articleId);
        const initiatorTotalValue = source.initiatorItems.reduce((sum: number, item: any) => sum + (item.price || 0), 0);
        const receiverTotalValue = source.receiverItems.reduce((sum: number, item: any) => sum + (item.price || 0), 0);

        const activityProposal=await captureSwapSellerActivities(tx,newSwapRef.id,[initiatorId,receiverId],'proposal',source.sourceHash);
        const swapData = stripUndefined({
          sellerActivityAdmissions:{proposal:activityProposal},
          proposalRequestId: clientRequestId,
          proposalRequestHash,
          inventoryReservationStage: 'on_acceptance_v1',
          initiatorId,
          initiatorName,
          initiatorImage,
          initiatorItems: source.initiatorItems,
          initiatorTotalValue,
          receiverId,
          receiverName,
          receiverImage,
          receiverItems: source.receiverItems,
          receiverTotalValue,
          // Denormalized flat article-id list powering the engagement lock query
          // (array-contains). Both sides combined.
          articleIds: allArticleIds,
          status: 'proposed',
          // Native root marker cannot be supplied through arbitrary item fields
          // on old proposals. Missing history never becomes a new consent.
          articleDeclarationProposalVersion: 1,
          articleDeclarationProposalRecordedAt: Timestamp.now(),
          swapLaunchPolicyVersion: SWAP_LAUNCH_POLICY_VERSION,
          exchangeMode: source.exchangeMode,
          exchangeAgreement: { protocol: source.protocol, scope: source.scope, sourceHash: source.sourceHash,
            termsVersion: source.termsVersion, termsText: source.termsText, exchangeMode: source.exchangeMode, arrangements: source.arrangements,
            initiatorAcknowledgement: { actorUid: initiatorId, sourceHash: source.sourceHash, recordedAt: Timestamp.now() },
            receiverAcknowledgement: null },
          message: source.message,
          cashTopUp: validatedTopUp,
          partyId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        await assertPrivateAccountSession(request, tx);
        await recoveryCommit({refs: [(newSwapRef).path]});
    tx.set(newSwapRef, await financialRecoverySourceFields('swap',newSwapRef,newSwapSnapshot,swapData));

        return { swapId: newSwapRef.id };
      });
      if ('admissionRefused' in proposalResult) return await throwRecordedAdmissionRefusal(proposalResult);
      const swapId = proposalResult.swapId;

      logger.info('Swap proposal created', {
        swapId, initiatorId, receiverId, hasTopUp: !!validatedTopUp,
      });

      return {
        swapId,
        success: true,
        message: 'Swap proposal created successfully',
      };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error proposing multi-swap', { error: errMsg, initiatorId, receiverId });
      throw new HttpsError('internal', 'Failed to propose swap: ' + errMsg);
    }
  }))
);

async function readSwapInventoryFinish(tx:FirebaseFirestore.Transaction,swapId:string,swap:FirebaseFirestore.DocumentData,consume=false) {
  const plans:InventoryPlan[]=[],legacyRefs:{ref:FirebaseFirestore.DocumentReference;fields:FirebaseFirestore.DocumentData}[]=[];
  if(!consume && (swap.status!=='proposed'||Object.prototype.hasOwnProperty.call(swap,'acceptedAt')||
      ['initiatorPhotos','receiverPhotos','initiatorShippedAt','receiverShippedAt','initiatorReceivedAt','receiverReceivedAt','completedAt',
        'topUpPaidAt','topUpPaymentIntentId','topUpChargeId','paymentIntentId','stripePaymentIntentId','bankDispute','disputeId','refund'].some(k=>Object.prototype.hasOwnProperty.call(swap,k))))
    throw new HttpsError('failed-precondition','La progression ou le financement de ce Troc doit être examiné avant de libérer ses exemplaires.');
  if (!consume && hasUnreservedSwapProposal(swap)) return {commit: () => undefined};
  const seen=new Set<string>();
  for(const side of ['initiator','receiver'] as const)for(const item of getSwapItems(swap,side)) {
    if(typeof item.articleId!=='string'||item.articleId.includes('/')||seen.has(item.articleId))throw new HttpsError('failed-precondition','L’identité des exemplaires du Troc doit être rapprochée.');
    seen.add(item.articleId);const ref=db.collection('articles').doc(item.articleId),article=(await tx.get(ref)).data();
    if(!article||article.sellerId!==swap[side+'Id'])throw new HttpsError('failed-precondition','La source des exemplaires du Troc doit être rapprochée.');
    const plan=await planInventoryFinish(tx,item.articleId,article,{kind:'swap',id:swapId,sourceArticleId:item.articleId},consume);
    if(Object.prototype.hasOwnProperty.call(article,'inventoryUnit')&&!plan)throw new HttpsError('failed-precondition','Le verrou d’un exemplaire nécessite un rapprochement.',{reason:'inventory_unit_engagement_conflict'});
    if(plan)plans.push(plan);else if(consume)legacyRefs.push({ref,fields:await financialRecoverySourceFields('inventory_article',ref,article,{isSold:true,isActive:false,updatedAt:FieldValue.serverTimestamp()})});
  }
  return {commit:()=>{for(const plan of plans)plan.commit();for(const legacy of legacyRefs)tx.update(legacy.ref,legacy.fields);}};
}

/** Read zone rows before writes, then commit with the native guarded accord. */
async function markPartyItemsPending(
  tx: FirebaseFirestore.Transaction,
  partyId: string,
  sellerId: string,
  items: { articleId?: string }[],
): Promise<{ commit: () => void }> {
  const partyItemsRef = db.collection('swapPartyItems');
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const item of items) {
    if (!item?.articleId) continue;
    const q = await tx.get(partyItemsRef
      .where('partyId', '==', partyId)
      .where('articleId', '==', item.articleId)
      .where('sellerId', '==', sellerId));
    for (const d of q.docs) refs.set(d.ref.path, d.ref);
  }
  return { commit: () => { for (const ref of refs.values()) tx.update(ref, { isPending: true }); } };
}

/**
 * Accept a swap — callable by the receiver only.
 * Atomically verifies the swap is 'proposed' and all articles are still
 * available, then transitions.
 *
 * If the swap carries a cashTopUp, it transitions to 'payment_pending' (the
 * payer must complete the Stripe payment via createSwapTopUpCheckout before the
 * exchange proceeds). Otherwise it transitions to 'accepted' (unchanged flow).
 */
export const acceptSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.acceptSwap"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId } = request.data ?? {};
    assertSwapExpectedUid(request.data?.expectedUid, request.auth.uid);
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        // Only the receiver can accept
        if (swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Seul le destinataire peut accepter cet échange');
        }

        // Exact committed acknowledgement recovery precedes NEW admission.
        if (swap.status !== 'proposed' && swap.exchangeAgreement?.protocol === SWAP_AGREEMENT_PROTOCOL &&
            swap.exchangeAgreement.scope === 'new_proposal' && request.data.agreementProtocol === SWAP_AGREEMENT_PROTOCOL &&
            request.data.expectedSourceHash === swap.exchangeAgreement.sourceHash &&
            swapAcknowledgementValid(swap.exchangeAgreement.receiverAcknowledgement, request.auth!.uid, swap.exchangeAgreement.sourceHash) &&
            storedSwapSource(swap).sourceHash === swap.exchangeAgreement.sourceHash) {
          return { hasTopUp: swap.status === 'payment_pending', newStatus: swap.status, replay: true };
        }

        // Status must be 'proposed'
        if (swap.status !== 'proposed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'accepter un échange en statut "${swap.status}"`
          );
        }
        if (swap.swapLaunchPolicyVersion !== SWAP_LAUNCH_POLICY_VERSION || swap.exchangeAgreement?.protocol !== SWAP_AGREEMENT_PROTOCOL ||
            swap.exchangeAgreement.scope !== 'new_proposal') throw new HttpsError('failed-precondition',
          'Cette ancienne proposition doit être annulée et refaite avec des modalités confirmées avant acceptation.',
          { reason: 'swap_agreement_unqualified', action: 'reviewNewSwapProposal' });
        const source = storedSwapSource(swap);
        assertSwapAgreementExpected(request.data, source.sourceHash);
        if (source.sourceHash !== swap.exchangeAgreement.sourceHash || swap.exchangeMode !== source.exchangeMode ||
            !swapAcknowledgementValid(swap.exchangeAgreement.initiatorAcknowledgement, swap.initiatorId, source.sourceHash)) {
          throw new HttpsError('failed-precondition', 'La confirmation du proposant ne correspond plus à cette proposition.', { reason: 'swap_agreement_stale' });
        }
        if (swap.articleDeclarationProposalVersion !== 1 || !(swap.articleDeclarationProposalRecordedAt instanceof Timestamp) ||
            !Number.isFinite(swap.articleDeclarationProposalRecordedAt.toMillis()) || swap.articleDeclarationProposalRecordedAt.toMillis() <= 0 ||
            swap.articleDeclarationProposalRecordedAt.toMillis() > Date.now() + 60_000 || !(swap.createdAt instanceof Timestamp) ||
            swap.articleDeclarationProposalRecordedAt.toMillis() > swap.createdAt.toMillis()) {
          throw new HttpsError('failed-precondition', 'Cette ancienne proposition ne contient pas la preuve du contenu examiné. Examinez une nouvelle proposition avant de l’accepter.',
            { reason: 'swap_sale_declaration_proposal_unqualified', action: 'reviewNewSwapProposal' });
        }

        // Validate ALL articles on both sides are still available AND still owned
        // by the expected participant. Re-checking ownership at accept time closes
        // the window where an article changed hands (or never belonged to the
        // claimed party) between proposal and acceptance.
        await assertPrivateAccountSession(request, tx);
        const admissionRefusal = await recordOwnAdmissionRefusal(tx, { request, ownerId: request.auth!.uid, operation: 'acceptSwap', scope: 'swap',
          sourceContext: { kind: 'swap', swapId, agreementSourceHash: source.sourceHash } });
        if (admissionRefusal) return admissionRefusal;
        await assertNewSwapAdmission(tx, request.auth!.uid, [swap.initiatorId, swap.receiverId]);
        await assertAccountRelationshipNewPair(tx, swap.initiatorId, swap.receiverId);
        const initiatorItems = getSwapItems(swap, 'initiator');
        const receiverItems = getSwapItems(swap, 'receiver');
        const initiatorIds = swapArticleIds(initiatorItems), receiverIds = swapArticleIds(receiverItems);
        const currentSnapshots: Record<string, Record<string, unknown>> = {};
        const reserveNow = hasUnreservedSwapProposal(swap);
        if (swap.inventoryReservationStage != null && !reserveNow) throw new HttpsError('failed-precondition', 'La réservation de cette proposition nécessite une vérification.');
        await validateArticlesAvailable(tx, initiatorItems, 'Article du proposant', swap.initiatorId, currentSnapshots, true, reserveNow ? undefined : swapId);
        await validateArticlesAvailable(tx, receiverItems, 'Votre article', swap.receiverId, currentSnapshots, true, reserveNow ? undefined : swapId);
        const inventoryPlans: InventoryPlan[] = [];
        let inventoryUnitCommitments: Record<string, unknown>[] | null = null;
        const commitments=swap.inventoryUnitCommitments;
        if(!reserveNow && (!Array.isArray(commitments)||commitments.length!==initiatorIds.length+receiverIds.length||new Set(commitments.map((v:any)=>v.unitId)).size!==commitments.length))
          throw new HttpsError('failed-precondition','La preuve commune des exemplaires proposés doit être rapprochée.',{reason:'inventory_unit_swap_commitments_unknown'});
        const seenUnits = new Set<unknown>();
        if (reserveNow) inventoryUnitCommitments = [];
        for(const articleId of [...initiatorIds,...receiverIds]) {const article=(await tx.get(db.collection('articles').doc(articleId))).data()!;
          if (reserveNow) {
            await assertArticleNotSwapEngaged(tx, articleId);
            const plan = await planInventoryAcquire(tx, articleId, article, {kind: 'swap', id: swapId, sourceArticleId: articleId});
            if (seenUnits.has(plan.commitment.unitId)) throw new HttpsError('failed-precondition', 'Un même exemplaire ne peut figurer plusieurs fois dans un Troc.');
            seenUnits.add(plan.commitment.unitId); inventoryPlans.push(plan);
            inventoryUnitCommitments!.push({articleId, ...plan.commitment});
          } else {
            const capture=commitments.find((v:any)=>v.articleId===articleId);
            if(!capture||!await inventoryEngagementMatches(tx,articleId,article,{kind:'swap',id:swapId,sourceArticleId:articleId},capture))
              throw new HttpsError('failed-precondition','Le verrou commun d’un exemplaire a changé.',{reason:'inventory_unit_engagement_conflict'});
          }}
        const currentSource = swapAgreementSource({ scope: 'new_proposal', initiatorId: swap.initiatorId, receiverId: swap.receiverId,
          initiatorItems: nativeSwapItems(initiatorIds, currentSnapshots), receiverItems: nativeSwapItems(receiverIds, currentSnapshots),
          cashTopUp: swap.cashTopUp ?? null, message: source.message, exchangeMode: source.exchangeMode, arrangements: source.arrangements });
        if (currentSource.sourceHash !== source.sourceHash) throw new HttpsError('failed-precondition',
          'Les articles ont changé. Examinez une nouvelle proposition avant de l’accepter.', { reason: 'swap_agreement_stale' });

        const hasTopUp = swap.cashTopUp != null && typeof swap.cashTopUp.amount === 'number';
        if (hasTopUp) assertNewPaymentsEnabled();
        // Postal terms and both parties' acknowledgements are already bound to
        // this native proposal. Do not ask for a third confirmation just to
        // make the immutable before-shipping photo path available.
        const newStatus = hasTopUp ? 'payment_pending' : source.exchangeMode === 'shipping' ? 'photos_pending' : 'accepted';
        const activityAcceptance=await captureSwapSellerActivities(tx,swapId,[swap.initiatorId,swap.receiverId],'acceptance',source.sourceHash);
        const partyPlans = swap.partyId ? [await markPartyItemsPending(tx, swap.partyId, swap.initiatorId, initiatorItems),
          await markPartyItemsPending(tx, swap.partyId, swap.receiverId, receiverItems)] : [];

        await assertPrivateAccountSession(request, tx);
        for (const plan of inventoryPlans) plan.commit();
        for (const plan of partyPlans) plan.commit();
        await recoveryCommit({refs: [(swapRef).path]});
    tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,{
          'sellerActivityAdmissions.acceptance':activityAcceptance,
          ...(inventoryUnitCommitments ? {inventoryUnitCommitments} : {}),
          status: newStatus,
          // Preserve the proposed snapshots. Current listings are qualification
          // sources only, never replacements for content already examined.
          acceptedAt: FieldValue.serverTimestamp(),
          'exchangeAgreement.receiverAcknowledgement': { actorUid: request.auth!.uid, sourceHash: source.sourceHash, recordedAt: Timestamp.now() },
          updatedAt: FieldValue.serverTimestamp(),
        }));

        return { hasTopUp, newStatus, replay: false };
      });

      if ('admissionRefused' in result) return await throwRecordedAdmissionRefusal(result);
      logger.info('Swap accepted', {
        swapId, receiverId: request.auth.uid, newStatus: result.newStatus,
      });

      return { success: true, status: result.newStatus, requiresPayment: result.hasTopUp, replay: result.replay };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error accepting swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'acceptation: ' + errMsg);
    }
  }))
);

// ============================================================
// CASH TOP-UP CHECKOUT (Stripe)
// ============================================================

/** Existing endpoint, explicitly versioned manual confirmation and servicing.
 * No automatic client confirmation capability is returned to an older caller.
 * The native journal precedes each new provider operation; exact receipts and
 * GET-only recovery stay accessible while the new payment stage is closed.
 */
export const createSwapTopUpCheckout = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async request => {
    return withFinancialRecoveryScope({operation: "callable/swaps.createSwapTopUpCheckout"}, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise');
    if (request.data?.capability === SWAP_TOPUP_MANUAL_CAPABILITY) return handleSwapTopUpCheckout(request);
    // Installed clients must never receive another automatic confirmation
    // capability. Native historical GET/receipts use the explicit servicing mode.
    throw new HttpsError('failed-precondition', 'Le complément doit être examiné dans le parcours de confirmation serveur.',
      {reason:'swap_topup_manual_required',action:'reviewSwapPayment',paymentPermissionGranted:false});

    });
  }
);

// ============================================================
// POST-ACCEPTANCE SWAP LIFECYCLE CALLABLES
// ============================================================
// These operations MUST run server-side because firestore.rules only allows
// a narrow set of status transitions for client writes on swaps. All other
// field writes (exchangeMode, photos, shipping, reception, rating, payment
// transitions) go through the Admin SDK here.
// ============================================================

/** Prepare zone metadata in the same guarded transaction as the native swap.
 * These rows never authorize the private inventory lock. All reads precede the
 * caller's writes, including a concurrent containment's retry. */
async function readSwapPartyFinish(tx: FirebaseFirestore.Transaction, swap: FirebaseFirestore.DocumentData,
  completed = false) {
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  if (!swap.partyId || !completed && hasUnreservedSwapProposal(swap)) return { commit: () => undefined };
  for (const side of ['initiator', 'receiver'] as const) {
    for (const item of getSwapItems(swap, side)) {
      if (!item.articleId) continue;
      const rows = await tx.get(db.collection('swapPartyItems')
        .where('partyId', '==', swap.partyId)
        .where('articleId', '==', item.articleId)
        .where('sellerId', '==', swap[side + 'Id']));
      for (const row of rows.docs) refs.set(row.ref.path, row.ref);
    }
  }
  const partyRef = db.collection('swapParties').doc(swap.partyId);
  const partyExists = completed && (await tx.get(partyRef)).exists;
  return { commit: () => {
    for (const ref of refs.values()) tx.update(ref, completed ? { isSwapped: true, isPending: false } : { isPending: false });
    if (partyExists) tx.update(partyRef, { swapsCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
  } };
}

/**
 * Issue a Stripe refund for a paid top-up and release the payer.
 * Refund reconciliation of the payee wallet happens via the charge.refunded
 * webhook (calqued on purchase refunds).
 *
 * Exported so the scheduled expiration job (scheduled/swaps.ts) can reuse the
 * SAME idempotent refund (key rf_swap_${swapId}) — never duplicate this logic.
 */
export async function refundSwapTopUpIfPaid(swap: FirebaseFirestore.DocumentData, swapId: string): Promise<void> {
  if (!swap.cashTopUp || !swap.topUpPaidAt || typeof swap.topUpPaymentIntentId !== 'string') return;
  // The stale callable snapshot is only an identifier hint: the shared engine
  // re-reads current status, parties, captured amount and attributed movements.
  await requestSwapTopUpRefund(swapId, 'cancelled_native', swap.topUpPaymentIntentId);
}

/**
 * Decline a swap — either participant can decline while status is 'proposed'.
 * (Top-up swaps are never paid at 'proposed' stage, so no refund needed.)
 */
export const declineSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.declineSwap"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    assertProvidedSwapExpectedUid(request.data, request.auth.uid);

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        if (swap.initiatorId !== request.auth!.uid && swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status === 'declined' && swap.declinedBy === request.auth!.uid && recordedSwapDate(swap.declinedAt)) return swap;

        if (swap.status !== 'proposed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de décliner un échange en statut "${swap.status}"`
          );
        }

        const inventory=await readSwapInventoryFinish(tx,swapId,swap);
        const party = await readSwapPartyFinish(tx, swap);
        await assertPrivateAccountSession(request, tx);
        inventory.commit();party.commit();await recoveryCommit({refs: [(swapRef).path]});
    tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,{
          status: 'declined',
          declinedBy: request.auth!.uid,
          declinedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }));

        return swap;
      });

      logger.info('Swap declined', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error declining swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors du refus: ' + errMsg);
    }
  }))
);

/**
 * Cancel a swap — ONLY the initiator can cancel.
 * Cancellable while status is 'proposed' or 'payment_pending'. If a top-up has
 * already been paid (i.e. the swap reached 'accepted' via webhook), cancellation
 * is NOT allowed here — the exchange is in progress; use the dispute flow.
 * For a paid-but-still-payment_pending edge case the refund helper is invoked.
 */
const SWAP_CANCELLATION_PROTOCOL = 'swap_initiator_cancellation_v1';
const swapCancellationDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, part) =>
  part && typeof part === 'object' && !Array.isArray(part)
    ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part)).digest('hex');
/** Frozen native cancellation permits recovery after a crash between the
 * terminal commit and refund preparation. Refund progress fields are excluded:
 * an existing authorized refund must remain observable without another effect. */
function swapCancellationSourceHash(swapId: string, swap: FirebaseFirestore.DocumentData, status: string) {
  return swapCancellationDigest([SWAP_CANCELLATION_PROTOCOL, swapId,
    swap.initiatorId, swap.receiverId, status, swap.createdAt ?? null, swap.acceptedAt ?? null,
    swap.cashTopUp ?? null, swap.topUpPaymentIntentId ?? null, swap.topUpPaidAt ?? null,
    swap.topUpFee ?? null, swap.topUpTax ?? null, swap.inventoryUnitCommitments ?? null,
    swap.sellerActivityAdmissions ?? null]);
}
function swapCancellationReceiptHash(receipt: FirebaseFirestore.DocumentData) {
  return swapCancellationDigest([receipt.protocol, receipt.swapId, receipt.actorUid,
    receipt.statusBeforeCancellation, receipt.sourceHash, receipt.cancelledAt]);
}
function exactSwapCancellation(swapId: string, swap: FirebaseFirestore.DocumentData, uid: string) {
  const receipt = swap.initiatorCancellation;
  return swap.status === 'cancelled' && swap.cancelReason === 'cancelled_by_initiator' &&
    receipt && Object.keys(receipt).sort().join(',') ===
      'actorUid,cancelledAt,protocol,receiptHash,sourceHash,statusBeforeCancellation,swapId' &&
    receipt.protocol === SWAP_CANCELLATION_PROTOCOL && receipt.swapId === swapId &&
    receipt.actorUid === uid && swap.initiatorId === uid &&
    ['proposed', 'payment_pending'].includes(receipt.statusBeforeCancellation) &&
    receipt.cancelledAt instanceof Timestamp && receipt.cancelledAt.toMillis() > 0 && receipt.cancelledAt.toMillis() <= Date.now() &&
    receipt.sourceHash === swapCancellationSourceHash(swapId, swap, receipt.statusBeforeCancellation) &&
    receipt.receiptHash === swapCancellationReceiptHash(receipt);
}
export const cancelSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.cancelSwap"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    assertProvidedSwapExpectedUid(request.data, request.auth.uid);

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      const swapData = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        if (swap.initiatorId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Seul l\'initiateur peut annuler cet échange');
        }

        // This is recovery of the original native cancellation, never another
        // cancellation or inventory release. The existing refund engine alone
        // may prepare its missing first work, or observe an authorized refund.
        if (exactSwapCancellation(swapId, swap, request.auth!.uid)) return swap;

        if (swap.status !== 'proposed' && swap.status !== 'payment_pending') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'annuler un échange en statut "${swap.status}"`
          );
        }

        const inventory=swap.status==='proposed' && swap.acceptedAt==null && !swap.topUpPaidAt && !swap.paymentIntentId && !swap.stripePaymentIntentId
          ?await readSwapInventoryFinish(tx,swapId,swap):null;
        const party = await readSwapPartyFinish(tx, swap);
        const cancellation = { protocol: SWAP_CANCELLATION_PROTOCOL, swapId, actorUid: request.auth!.uid,
          statusBeforeCancellation: swap.status as string, sourceHash: swapCancellationSourceHash(swapId, swap, swap.status),
          cancelledAt: Timestamp.now() };
        await assertPrivateAccountSession(request, tx);
        inventory?.commit();if (inventory) party.commit();await recoveryCommit({refs: [(swapRef).path]});
    tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,{
          ...(inventory?{}:{inventoryReconciliationRequired:true}),
          status: 'cancelled',
          cancelReason: 'cancelled_by_initiator',
          initiatorCancellation: { ...cancellation, receiptHash: swapCancellationReceiptHash(cancellation) },
          updatedAt: FieldValue.serverTimestamp(),
        }));

        return swap;
      });

      // Refund any paid top-up (rare edge: paid while still payment_pending)
      await assertPrivateAccountSession(request);
      await refundSwapTopUpIfPaid(swapData, swapId);
      await assertPrivateAccountSession(request);

      logger.info('Swap cancelled', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error cancelling swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'annulation: ' + errMsg);
    }
  }))
);

/**
 * Set exchange mode for an accepted swap.
 * Transitions status from 'accepted' to 'photos_pending'.
 */
export const setSwapExchangeMode = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.setSwapExchangeMode"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, exchangeMode } = request.data ?? {};
    assertSwapExpectedUid(request.data?.expectedUid, request.auth.uid);
    if (!swapId || typeof swapId !== 'string' || swapId.includes('/')) {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (exchangeMode !== 'hand_delivery' && exchangeMode !== 'shipping') {
      throw new HttpsError('invalid-argument', 'Mode d’échange invalide');
    }

    try {
      const result = await db.runTransaction(async (tx) => {
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;

        if (swap.initiatorId !== request.auth!.uid && swap.receiverId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status === 'photos_pending' && swap.exchangeAgreement?.protocol === SWAP_AGREEMENT_PROTOCOL &&
            request.data.agreementProtocol === SWAP_AGREEMENT_PROTOCOL && request.data.expectedSourceHash === swap.exchangeAgreement.sourceHash &&
            exchangeMode === swap.exchangeAgreement.exchangeMode && request.data.arrangements?.trim() === swap.exchangeAgreement.arrangements &&
            swapAcknowledgementValid(swap.exchangeAgreement.initiatorAcknowledgement, swap.initiatorId, swap.exchangeAgreement.sourceHash) &&
            swapAcknowledgementValid(swap.exchangeAgreement.receiverAcknowledgement, swap.receiverId, swap.exchangeAgreement.sourceHash) &&
            storedSwapSource(swap).sourceHash === swap.exchangeAgreement.sourceHash) return { status: 'photos_pending', waitingForCounterpart: false };

        if (swap.status !== 'accepted') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de définir le mode d'échange en statut "${swap.status}"`
          );
        }
        // No new age/residence admission for an already accepted exchange.
        // Existing accepted legacy mode is immutable but is not, by itself,
        // evidence that both parties agreed on its documentary arrangements.
        const terms = swapArrangements(exchangeMode, request.data.arrangements);
        if (swap.exchangeMode != null && swap.exchangeMode !== exchangeMode) throw new HttpsError('failed-precondition', 'Le mode déjà engagé doit être conservé.');
        const existing = swap.exchangeAgreement;
        const source = existing?.protocol === SWAP_AGREEMENT_PROTOCOL ? storedSwapSource(swap) : storedSwapSource(swap, terms, 'legacy_preparation');
        assertSwapAgreementExpected(request.data, source.sourceHash);
        if (terms.exchangeMode !== source.exchangeMode || terms.arrangements !== source.arrangements ||
            existing?.protocol === SWAP_AGREEMENT_PROTOCOL && existing.sourceHash !== source.sourceHash) {
          throw new HttpsError('failed-precondition', 'Les modalités déjà confirmées doivent être conservées.', { reason: 'swap_agreement_stale' });
        }
        const initValid = swapAcknowledgementValid(existing?.initiatorAcknowledgement, swap.initiatorId, source.sourceHash);
        const receiverValid = swapAcknowledgementValid(existing?.receiverAcknowledgement, swap.receiverId, source.sourceHash);
        if (source.scope === 'new_proposal' && (!initValid || !receiverValid)) throw new HttpsError('failed-precondition',
          'Les confirmations de cette proposition nécessitent un examen.', { reason: 'swap_agreement_unqualified' });
        const acknowledgement = { actorUid: request.auth!.uid, sourceHash: source.sourceHash, recordedAt: Timestamp.now() };
        const initiatorAcknowledgement = initValid ? existing.initiatorAcknowledgement : request.auth!.uid === swap.initiatorId ? acknowledgement : null;
        const receiverAcknowledgement = receiverValid ? existing.receiverAcknowledgement : request.auth!.uid === swap.receiverId ? acknowledgement : null;
        const ready = !!initiatorAcknowledgement && !!receiverAcknowledgement;
        await assertPrivateAccountSession(request, tx);
        tx.update(swapRef, {
          // The first legacy acknowledgement fixes a documentary draft, never
          // rewrites the contract or marks the mode agreed by the other party.
          ...(ready ? { exchangeMode, status: 'photos_pending' } : {}),
          exchangeAgreement: { protocol: source.protocol, scope: source.scope, sourceHash: source.sourceHash,
            termsVersion: source.termsVersion, termsText: source.termsText, exchangeMode: source.exchangeMode,
            arrangements: source.arrangements, initiatorAcknowledgement, receiverAcknowledgement },
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { status: ready ? 'photos_pending' : 'accepted', waitingForCounterpart: !ready };
      });

      logger.info('Swap exchange mode set', { swapId, exchangeMode, userId: request.auth.uid });
      return { success: true, ...result };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error setting swap exchange mode', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la définition du mode: ' + errMsg);
    }
  }))
);

/**
 * Upload photo proof for a swap. Transitions to 'shipping' when both sides have
 * uploaded.
 */
function assertCanSubmitSwapPhotos(snapshot: FirebaseFirestore.DocumentSnapshot, uid: string, photoPaths: string[], bucketName: string) {
  if (!snapshot.exists) throw new HttpsError('not-found', 'Swap introuvable');
  const swap = snapshot.data()!;
  if (swap.initiatorId !== uid && swap.receiverId !== uid) {
    throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
  }
  const isInitiator = swap.initiatorId === uid;
  const proof = isInitiator ? swap.initiatorPhotos : swap.receiverPhotos;
  if (proof) {
    if (proof.userId === uid && recordedSwapDate(proof.uploadedAt) && Array.isArray(proof.photos) &&
        proof.photos.length === photoPaths.length && proof.photos.every((url: unknown, index: number) =>
          typeof url === 'string' && storageObjectPath(url, bucketName) === photoPaths[index])) return {swap, isInitiator, replay: true};
    throw new HttpsError('failed-precondition', 'Ces preuves sont déjà enregistrées et ne peuvent plus être remplacées');
  }
  if (swap.status !== 'photos_pending') {
    throw new HttpsError('failed-precondition', 'Cet échange n’attend pas de photos');
  }
  assertSwapFulfilmentAgreement(swap);
  return { swap, isInitiator, replay: false };
}

export const uploadSwapPhotos = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.uploadSwapPhotos"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    assertProvidedSwapExpectedUid(request.data, request.auth.uid);

    const { swapId, photoUrls } = request.data;
    if (!swapId || typeof swapId !== 'string' || swapId.includes('/')) {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!Array.isArray(photoUrls) || photoUrls.length === 0) {
      throw new HttpsError('invalid-argument', 'photoUrls requis (tableau non vide)');
    }
    const uid = request.auth.uid;
    const bucket = storage.bucket();
    const photoPaths = photoUrls.map((url: unknown) =>
      typeof url === 'string' ? storageObjectPath(url, bucket.name) : null,
    );
    if (photoUrls.length > 10 || new Set(photoPaths).size !== photoPaths.length || photoPaths.some((path: string | null) => {
      const segments = path?.split('/');
      return !segments || segments.length !== 5 || segments[0] !== 'swaps' ||
        segments[1] !== swapId || segments[2] !== 'photos' || segments[3] !== uid;
    })) {
      throw new HttpsError('invalid-argument', 'Photos de preuve invalides');
    }

    try {
      const swapRef = db.collection('swaps').doc(swapId);
      // Authorize before Admin Storage reads, then recheck the live state in the
      // transaction after all objects are validated. Proof objects are immutable
      // to clients, so no client can replace them between validation and commit.
      await assertPrivateAccountSession(request);
      const initial = assertCanSubmitSwapPhotos(await swapRef.get(), uid, photoPaths as string[], bucket.name);
      const local=activeLocalAgreementScope();
      if(local){await financialRecoveryCommitCheckpoint()({refs:[swapRef.path]});assertLocalAgreementReadable('swap',swapRef.path,initial.swap);}
      if (initial.replay) return {success: true, replay: true};
      const objects=await captureSwapProofObjects(bucket,swapId,uid,photoPaths as string[],()=>assertPrivateAccountSession(request),async()=>{
        await assertPrivateAccountSession(request);await financialRecoveryCommitCheckpoint()({refs:[swapRef.path]});
      });

      await db.runTransaction(async (tx) => {
        await assertPrivateAccountSession(request, tx);
        const { swap, isInitiator, replay } = assertCanSubmitSwapPhotos(await tx.get(swapRef), uid, photoPaths as string[], bucket.name);
        if (replay) return;

        const photoProof = {
          userId: uid,
          photos: (photoPaths as string[]).map(path=>'https://firebasestorage.googleapis.com/v0/b/'+bucket.name+'/o/'+encodeURIComponent(path)+'?alt=media'),
          objects,
          uploadedAt: FieldValue.serverTimestamp(),
          isValidated: false,
        };

        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (isInitiator) {
          updateData.initiatorPhotos = photoProof;
        } else {
          updateData.receiverPhotos = photoProof;
        }

        const otherSideHasPhotos = isInitiator ? !!swap.receiverPhotos : !!swap.initiatorPhotos;
        if (otherSideHasPhotos) {
          updateData.status = 'shipping';
        }

        await assertPrivateAccountSession(request, tx);
        await financialRecoveryCommitCheckpoint()({refs:[swapRef.path]});
        tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,updateData));
      });

      logger.info('Swap photos uploaded', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error uploading swap photos', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'upload des photos: ' + errMsg);
    }
  }))
);

/**
 * Confirm shipping for a swap — participant confirms they sent their package.
 */
export const confirmSwapShipping = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.confirmSwapShipping"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    assertProvidedSwapExpectedUid(request.data, request.auth.uid);

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      await db.runTransaction(async (tx) => {
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        const field = swap.initiatorId === uid ? 'initiatorShippedAt' : 'receiverShippedAt';
        if (recordedSwapDate(swap[field])) return; // Recover the same declaration without changing its date.
        if (swap[field] != null) throw new HttpsError('failed-precondition', 'La déclaration de remise nécessite une vérification.');

        if (swap.status !== 'shipping') {
          throw new HttpsError('failed-precondition', 'Le swap n\'est pas en cours d\'expédition.');
        }
        if (swap.exchangeMode !== 'shipping') {
          throw new HttpsError('failed-precondition', 'Confirmez directement la réception lors de votre rencontre.');
        }
        assertSwapFulfilmentAgreement(swap);

        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };

        updateData[field] = FieldValue.serverTimestamp();

        await assertPrivateAccountSession(request, tx);
        await financialRecoveryCommitCheckpoint()({refs:[swapRef.path]});
        tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,updateData));
      });

      logger.info('Swap shipping confirmed', { swapId, userId: request.auth.uid });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming swap shipping', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la confirmation d\'envoi: ' + errMsg);
    }
  }))
);

/**
 * Buyer-protection window for a swap cash top-up after reception, mirroring the
 * purchase dispute window (scheduled/releaseHeldFunds.ts DISPUTE_WINDOW_MS).
 * The payee's top-up complement sits in heldBalance during this window so a
 * post-reception dispute can still claw it back.
 */
const SWAP_TOPUP_HOLD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Confirm reception for a swap — participant confirms they received the package.
 * When BOTH sides have received: transitions to 'completed', marks articles
 * sold, marks party items swapped + increments swapsCount, and MOVES the top-up
 * funds to the payee's heldBalance (pending → held) with a 7-day release
 * deadline — EXACTLY like a delivered purchase (applyDeliveredHeldFunds). The
 * funds are released to withdrawable `balance` by the releaseHeldFunds scheduled
 * job once the window elapses, NOT here, so openSwapDispute can still refund the
 * payer during the window (post-reception recourse).
 */
export const confirmSwapReception = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.confirmSwapReception"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    assertProvidedSwapExpectedUid(request.data, request.auth.uid);

    const { swapId } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }

    try {
      const swapData = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        const isInitiator = swap.initiatorId === uid;
        const ownField = isInitiator ? 'initiatorReceivedAt' : 'receiverReceivedAt';
        const otherField = isInitiator ? 'receiverReceivedAt' : 'initiatorReceivedAt';
        // A repeated tap or a lost response observes the exact declaration,
        // even after completion. It never consumes stock or moves funds again.
        if (recordedSwapDate(swap[ownField])) return {
          bothReceived: swap.status === 'completed' && recordedSwapDate(swap[otherField]),
          initiatorId: swap.initiatorId as string, receiverId: swap.receiverId as string, swap, replay: true,
        };
        if (swap[ownField] != null || swap[otherField] != null && !recordedSwapDate(swap[otherField])) {
          throw new HttpsError('failed-precondition', 'Les confirmations de réception nécessitent une vérification.');
        }

        const meetupReception = swap.exchangeMode === 'hand_delivery' && ['accepted', 'photos_pending', 'shipping'].includes(swap.status);
        if (!meetupReception && !(swap.status === 'shipping' && swap.exchangeMode === 'shipping')) {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de confirmer la réception en statut "${swap.status}"`
          );
        }
        if (!meetupReception && !recordedSwapDate(swap[isInitiator ? 'receiverShippedAt' : 'initiatorShippedAt'])) {
          throw new HttpsError('failed-precondition', 'L’autre membre doit d’abord confirmer l’envoi de vos articles.');
        }
        assertSwapFulfilmentAgreement(swap);

        const receptionRecordedAt = Timestamp.now();
        const otherSideReceived = recordedSwapDate(swap[otherField]);
        const bothReceived = otherSideReceived;

        const inventory=bothReceived?await readSwapInventoryFinish(tx,swapId,swap,true):null;
        const party = bothReceived ? await readSwapPartyFinish(tx, swap, true) : null;

        // Determine top-up hold target (the payee) before any writes.
        // topUpFundsHeldAt is the idempotence marker for the pending → held move
        // performed here; topUpReleasedAt (held → balance) is set LATER by the
        // releaseHeldFunds scheduled job once the 7-day window elapses.
        const pendingTopUp = bothReceived ? await readPendingSwapTopUp(tx, swapId, swap, receptionRecordedAt) : null;
        const topUpPaid = pendingTopUp !== null;
        await assertPrivateAccountSession(request, tx);

        // --- Writes ---
        inventory?.commit();
        party?.commit();
        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isInitiator) {
          updateData.initiatorReceivedAt = swap.initiatorReceivedAt instanceof Timestamp ? swap.initiatorReceivedAt : receptionRecordedAt;
        } else {
          updateData.receiverReceivedAt = swap.receiverReceivedAt instanceof Timestamp ? swap.receiverReceivedAt : receptionRecordedAt;
        }
        if (bothReceived) {
          updateData.status = 'completed';
          updateData.completedAt = receptionRecordedAt;
          if (topUpPaid) {
            // Mark the pending → held move + stamp the release deadline. NOTE:
            // we DO NOT set topUpReleasedAt here — that marks "released to
            // withdrawable balance" and is owned by releaseHeldFunds. Keeping it
            // unset is what makes the post-reception dispute window effective.
            updateData.topUpFundsHeldAt = receptionRecordedAt;
            updateData.topUpFundsReleaseAt = Timestamp.fromMillis(
              receptionRecordedAt.toMillis() + SWAP_TOPUP_HOLD_WINDOW_MS
            );
          }
        }

        // Move top-up funds pending → held on the payee wallet (delivered, inside
        // the 7-day dispute window), EXACTLY like a delivered purchase. The funds
        // become withdrawable (held → balance) only when releaseHeldFunds runs
        // after topUpFundsReleaseAt.
        if (pendingTopUp) {
          const { walletRef: payeeWalletRef, wallet: payeeWalletData, amountCents: payoutCents } = pendingTopUp;
          await recoveryCommit({refs: [(payeeWalletRef).path]});
    tx.update(payeeWalletRef, await financialRecoveryWalletFields(payeeWalletRef,payeeWalletData,{
            pendingBalance: FieldValue.increment(-payoutCents),
            heldBalance: FieldValue.increment(payoutCents),
            updatedAt: FieldValue.serverTimestamp(),
          },{pendingBalance: ((payeeWalletData)["pendingBalance"]??0) + (-payoutCents),heldBalance: ((payeeWalletData)["heldBalance"]??0) + (payoutCents)}));
          const ledgerRef = payeeWalletRef.collection('ledger').doc();
          await recoveryCommit({refs: [(ledgerRef).path]});
    tx.set(ledgerRef, {
            type: 'funds_held',
            currency: 'CAD',
            paymentIntentId: pendingTopUp.paymentIntentId,
            creditLedgerId: pendingTopUp.creditLedgerId,
            amount: payoutCents,
            balanceAfter: (payeeWalletData.heldBalance || 0) + payoutCents,
            description: 'Complément d\'échange — fonds en attente (fenêtre de litige 7 jours)',
            swapId,
            createdAt: receptionRecordedAt,
            status: 'held',
          });
        }

        await recoveryCommit({refs: [(swapRef).path]});
    tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,updateData));

        return {
          bothReceived,
          partyId: swap.partyId as string | undefined,
          initiatorId: swap.initiatorId as string,
          receiverId: swap.receiverId as string,
          swap,
          replay: false,
        };
      });

      logger.info('Swap reception confirmed', {
        swapId,
        userId: request.auth.uid,
        completed: swapData.bothReceived,
      });

      // Analytics (§12): swap_completed — distinct_id = initiator (§12; the
      // receiver side is measured by joining on swap_id).
      if (swapData.bothReceived && !swapData.replay) {
        const itemsCount =
          getSwapItems(swapData.swap, 'initiator').length +
          getSwapItems(swapData.swap, 'receiver').length;
        const hadCashTopUp = swapData.swap.cashTopUp != null;
        let daysToComplete = 0;
        const createdAt = swapData.swap.createdAt;
        if (createdAt && typeof createdAt.toMillis === 'function') {
          daysToComplete =
            Math.round(((Date.now() - createdAt.toMillis()) / (24 * 60 * 60 * 1000)) * 100) / 100;
        }
        await captureServerEvent(swapData.initiatorId, 'swap_completed', {
          swap_id: swapId,
          items_count: itemsCount,
          had_cash_top_up: hadCashTopUp,
          days_to_complete: daysToComplete,
          $insert_id: `swap_completed_${swapId}`,
        });
      }

      return { success: true, completed: swapData.bothReceived, replay: swapData.replay };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming swap reception', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la confirmation de réception: ' + errMsg);
    }
  }))
);

/**
 * Rate a completed swap — participant rates the exchange.
 */
export const rateSwap = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.rateSwap"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    assertProvidedSwapExpectedUid(request.data, request.auth.uid);

    const { swapId, score, comment } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new HttpsError('invalid-argument', 'score requis (1-5)');
    }
    if (comment != null && (typeof comment !== 'string' || comment.length > 2000)) {
      throw new HttpsError('invalid-argument', 'Le commentaire doit contenir au maximum 2 000 caractères.');
    }

    try {
      let targetUserId = '';
      let reviewerName = '';
      let reviewerImage: string | null = null;
      let articleTitle: string | null = null;
      let notificationCommitted = false;
      const trimmedComment = (comment != null && typeof comment === 'string' && comment.trim().length > 0)
        ? comment.trim()
        : null;

      await db.runTransaction(async (tx) => {
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'êtes pas participant de cet échange');
        }

        if (swap.status !== 'completed') {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de noter un échange en statut "${swap.status}"`
          );
        }

        const isInitiator = swap.initiatorId === uid;
        targetUserId = isInitiator ? swap.receiverId : swap.initiatorId;
        reviewerName = isInitiator ? swap.initiatorName : swap.receiverName;
        const reviewer = (await tx.get(db.collection('users').doc(uid))).data();
        reviewerImage = publicProfileImage(reviewer);

        const items = getSwapItems(swap, isInitiator ? 'initiator' : 'receiver');
        articleTitle = items.length > 0 ? (items[0].title || null) : null;
        if (items[0]?.articleId) {
          const reviewedArticle = (await tx.get(db.collection('articles').doc(items[0].articleId))).data();
          if (articlePrivacyWithdrawn(reviewedArticle)) articleTitle = 'Annonce retirée pour confidentialité';
        }

        const rating: Record<string, any> = { score };
        if (trimmedComment) {
          rating.comment = trimmedComment;
        }

        const updateData: Record<string, any> = {
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isInitiator) {
          updateData.initiatorRating = rating;
        } else {
          updateData.receiverRating = rating;
        }

        const reviewDocId = `${uid}_swap_${swapId}`;
        const reviewRef = db.collection('avis').doc(reviewDocId);
        const existingReview = await tx.get(reviewRef);
        // The immutable review is the notice source, not a later rating RPC.
        // A legacy review without a native receipt is never adopted as proof.
        const reviewNotice = { eventKey: `review:${reviewDocId}:created`, userId: targetUserId,
          type: 'review_received', title: 'Nouvel avis reçu',
          message: `Un participant vous a laissé un avis ${score}/5. Consultez vos évaluations.`,
          data: { reviewId: reviewDocId, reviewerId: uid } };
        const notices = !existingReview.exists ? await prepareOperationalNotices(tx, [reviewNotice]) : null;
        if (existingReview.exists) {
          const prior = await historicalReviewBody(tx, reviewDocId, existingReview.data()!);
          if (!prior || prior.reviewerId !== uid || prior.vendeurId !== targetUserId || prior.transactionId !== swapId ||
              prior.transactionType !== 'swap' || prior.note !== score || prior.text !== (trimmedComment || '')) {
            throw new HttpsError('already-exists', 'Un avis différent a déjà été enregistré pour cet échange.');
          }
          const receipts = await readOperationalNoticeReceipts(tx, [reviewNotice]);
          notificationCommitted = Boolean(receipts[0]);
          return;
        }
        const reviewData = {phase1Contract: PHASE1_CONTRACT, id: reviewDocId, reviewerId: uid, reviewerName: reviewerName || 'Utilisateur', reviewerImage,
          vendeurId: targetUserId, transactionId: swapId, transactionType: 'swap', articleId: items[0]?.articleId || null,
          articleTitle, note: score, text: trimmedComment || '', createdAt: FieldValue.serverTimestamp()};
        const visibleRating = await prepareVisibleRating(tx, targetUserId, {id: reviewDocId, data: reviewData});
        await assertPrivateAccountSession(request, tx);
        tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,updateData));
        if (!existingReview.exists) {
          tx.set(reviewRef, reviewData);
        }
        visibleRating.commit();
        notices!.commit();
        notificationCommitted = true;
      });

      logger.info('Swap rated', { swapId, score, userId: request.auth.uid, targetUserId });
      return { success: true, notificationCommitted, deviceDeliveryVerified: false, readingVerified: false };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error rating swap', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de la notation: ' + errMsg);
    }
  }))
);

/**
 * Statuses from which a participant may OPEN a swap dispute.
 *  - 'accepted' / 'photos_pending': post-payment, pre-shipping. Closes F51 — a
 *    payer whose top-up cleared but whose counterparty went silent now has an
 *    in-app recourse instead of being stranded forever.
 *  - 'shipping': the exchange is in transit.
 *  - 'completed': only WITHIN the 7-day post-reception window (topUpReleasedAt
 *    unset). After release the case is out of scope for self-service — admin
 *    moderation handles it.
 */
const DISPUTABLE_SWAP_STATUSES = ['accepted', 'photos_pending', 'shipping', 'completed'] as const;

/**
 * Open a dispute on a swap (F48 — hardened).
 *
 * A dispute FREEZES the exchange; it does NOT refund anything by itself. The
 * money decision is reserved for the admin callable resolveSwapDispute. This
 * closes the original exploit where openSwapDispute auto-refunded the payer
 * unconditionally inside the window — a malicious payer could confirm reception,
 * dispute, claw back 100% of the top-up AND keep the received article.
 *
 * Freezing is implicit: the shared article commitment guard rejects 'disputed'
 * and it is excluded from releaseSwapTopUpHeldFunds (status == 'completed'
 * filter), so the payee's complement can never auto-release while a dispute is
 * open. The funds sit wherever they were (pendingBalance pre-reception, or
 * heldBalance inside the window) until an admin rules.
 *
 * Guards: participant only, status in DISPUTABLE_SWAP_STATUSES, and for
 * 'completed' the window must still be open (topUpReleasedAt unset). Exact local
 * actor/reason replays return the same episode; other disputes stay rejected.
 */
export const openSwapDispute = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.openSwapDispute"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    assertProvidedSwapExpectedUid(request.data, request.auth.uid);

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'openSwapDispute',
      maxCallsAuthenticated: 10,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { swapId, reason } = request.data;
    if (!swapId || typeof swapId !== 'string') {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'reason requis (texte non vide)');
    }

    const trimmedReason = reason.trim().substring(0, 1000);

    try {
      await db.runTransaction(async (tx) => {
        await assertPrivateAccountSession(request, tx);
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);

        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }

        const swap = swapSnap.data()!;
        const uid = request.auth!.uid;

        if (swap.initiatorId !== uid && swap.receiverId !== uid) {
          throw new HttpsError('permission-denied', 'Vous n\'etes pas participant de cet echange');
        }

        const local=activeLocalAgreementScope();
        if(local){
          if(request.data.expectedUid!==uid)throw new HttpsError('permission-denied','Le compte de cette déclaration a changé.');
          await financialRecoveryCommitCheckpoint()({refs:[swapRef.path]});
          assertLocalAgreementReadable('swap',swapRef.path,swap);
          if(swap.status==='disputed'&&swap.disputeOpenedBy===uid&&swap.disputeReason===trimmedReason)return;
        }
        if (!(DISPUTABLE_SWAP_STATUSES as readonly string[]).includes(swap.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Impossible d'ouvrir un litige sur un echange en statut "${swap.status}"`
          );
        }

        // Bound the post-completion window: once the top-up has been released to
        // the payee's withdrawable balance, the self-service dispute window is
        // closed (admin moderation only).
        if (swap.status === 'completed' && swap.topUpReleasedAt) {
          throw new HttpsError(
            'failed-precondition',
            'La fenetre de litige (7 jours) est ecoulee. Contactez le support.'
          );
        }

        await assertPrivateAccountSession(request, tx);
        const patch={
          status: 'disputed',
          statusBeforeDispute: swap.status,
          disputeReason: trimmedReason,
          disputeOpenedBy: uid,
          disputeOpenedAt: local?Timestamp.now():FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        tx.update(swapRef,local?await financialRecoverySourceFields('swap',swapRef,swap,patch):patch);
      });

      logger.info('Swap dispute opened (frozen, awaiting admin)', {
        swapId, userId: request.auth.uid,
      });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error opening swap dispute', { error: errMsg, swapId });
      throw new HttpsError('internal', 'Erreur lors de l\'ouverture du litige: ' + errMsg);
    }
  }))
);

/** Legacy historical receipts remain observable; all NEW decisions use the
 * source-bound documentary protocol. Neither protocol grants financial or
 * inventory permission. */
const swapDecisionDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function swapDisputeSourceHash(swapId: string, swap: FirebaseFirestore.DocumentData) {
  return swapDecisionDigest([swapId, swap.initiatorId, swap.receiverId, 'disputed',
    swap.disputeOpenedAt instanceof Timestamp ? swap.disputeOpenedAt.toMillis() : null,
    swap.disputeOpenedBy ?? null, swap.disputeReason ?? null, swap.cashTopUp?.amount ?? null,
    swap.cashTopUp?.payerId ?? null, swap.cashTopUp?.paymentIntentId ?? null]);
}

/** Native documentary observation only. Absence is never proof that an
 * external instruction did not execute, nor permission to execute it again. */
async function observeSwapDisputeDecision(tx: FirebaseFirestore.Transaction, swapId: string,
  swap: FirebaseFirestore.DocumentData | undefined, adminUid: string,
  issue: 'refund_payer' | 'release_payee', trimmedNote: string | null,
  mode: 'resolve' | 'observe', replay: boolean) {
  const noteHash = swapDecisionDigest(trimmedNote);
  const empty = {
    mode, observationState: (swap?.disputeResolutionNotice != null || swap?.disputeResolvedAt != null ||
      swap?.disputeOutcome != null || (swap && swap.status !== 'disputed') ? 'historical_unqualified' : 'unrecorded') as
      'unrecorded' | 'recorded' | 'historical_unqualified',
    success: false, swapId, adminUid, issue, noteHash, protocol: null as string | null,
    sourceHash: null as string | null, decisionKey: null as string | null,
    initiatorId: null as string | null, receiverId: null as string | null,
    committedAt: null as string | null, notificationIds: null as string[] | null,
    movedCents: null as number | null, financialInstruction: null as 'refund_payer' | 'release_payee' | null,
    decisionCommitted: false, notificationCommitted: false, refundConfirmed: false as const,
    deviceDeliveryVerified: false as const, readingVerified: false as const, nonExecutionVerified: false as const, replay,
  };
  const prior = swap?.disputeResolutionNotice;
  if (!swap || !prior || prior.protocol !== 'swap_dispute_notice_v1' || prior.swapId !== swapId ||
      prior.actorUid !== adminUid || prior.issue !== issue || prior.noteHash !== noteHash ||
      prior.initiatorId !== swap.initiatorId || prior.receiverId !== swap.receiverId ||
      ![prior.initiatorId, prior.receiverId].every(uid => typeof uid === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(uid)) ||
      prior.initiatorId === prior.receiverId || prior.refundConfirmed !== false ||
      !(prior.committedAt instanceof Timestamp) || !(swap.disputeResolvedAt instanceof Timestamp) ||
      !prior.committedAt.isEqual(swap.disputeResolvedAt) || swap.disputeResolvedBy !== adminUid || swap.disputeOutcome !== issue ||
      !/^[a-f0-9]{64}$/.test(prior.sourceHash ?? '') || prior.sourceHash !== swapDisputeSourceHash(swapId, swap) ||
      prior.decisionKey !== swapDecisionDigest([prior.sourceHash, adminUid, issue, trimmedNote]) ||
      !Number.isSafeInteger(prior.movedCents) || prior.movedCents < 0 ||
      !Array.isArray(prior.notificationIds) || prior.notificationIds.length !== 2 ||
      !Array.isArray(prior.notificationInputs) || prior.notificationInputs.length !== 2) return empty;
  const parties = [prior.initiatorId, prior.receiverId];
  const inputs = prior.notificationInputs as OperationalNoticeInput[];
  if (inputs.some((input, index) => !input || input.userId !== parties[index] || input.type !== 'swap_update' ||
      input.eventKey !== `swap_dispute_decision:${swapId}:${prior.decisionKey}` ||
      typeof input.title !== 'string' || !input.title || typeof input.message !== 'string' || !input.message ||
      !input.data || typeof input.data !== 'object' || Array.isArray(input.data) ||
      Object.entries(input.data).some(([key, value]) => !key || typeof value !== 'string') ||
      input.data.ownerId !== parties[index] || input.data.swapId !== swapId || input.data.actorUid !== adminUid ||
      input.data.decisionKey !== prior.decisionKey || input.data.financialInstruction !== issue ||
      input.data.decisionCommitted !== 'true' || input.data.refundConfirmed !== 'false')) return empty;
  let receipts;
  try { receipts = await readOperationalNoticeReceipts(tx, inputs); }
  catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    if (error instanceof Error && error.message === 'Operational notification receipt mismatch') return empty;
    throw error; // An unavailable read remains an unknown result, never an absence proof.
  }
  if (receipts.some((receipt, index) => !receipt || receipt.notificationId !== prior.notificationIds[index] ||
      receipt.committedAt !== prior.committedAt.toDate().toISOString())) return empty;
  return { ...empty, success: true, observationState: 'recorded' as const,
    protocol: prior.protocol as string, sourceHash: prior.sourceHash as string, decisionKey: prior.decisionKey as string,
    initiatorId: prior.initiatorId as string, receiverId: prior.receiverId as string,
    committedAt: prior.committedAt.toDate().toISOString(), notificationIds: [...prior.notificationIds] as string[],
    movedCents: prior.movedCents as number, financialInstruction: issue, decisionCommitted: true, notificationCommitted: true };
}

export const resolveSwapDispute = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: providerSecretsForDeployment(['STRIPE_SECRET_KEY']) },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/swaps.resolveSwapDispute"}, async () => withPrivateAccountSession(request,async () => {
    if (request.data?.swapDisputeCapability === SWAP_DISPUTE_REVIEW_CAPABILITY) return handleSwapDisputeReview(request);
    if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured')throw new HttpsError('failed-precondition',
      'Utilisez la revue documentaire de cet échange.',{reason:'phase1_documentary_review_required',financialEffectAuthorized:false,stockEffectAuthorized:false});
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { swapId, issue, note, mode = 'resolve', expectedAdminUid } = request.data ?? {};
    if (!swapId || typeof swapId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(swapId)) {
      throw new HttpsError('invalid-argument', 'swapId requis');
    }
    if (mode !== 'resolve' && mode !== 'observe') throw new HttpsError('invalid-argument', 'mode invalide');
    if (issue !== 'refund_payer' && issue !== 'release_payee') {
      throw new HttpsError('invalid-argument', 'issue doit etre "refund_payer" ou "release_payee"');
    }
    const adminUid = request.auth.uid;
    const trimmedNote =
      typeof note === 'string' && note.trim().length > 0 ? note.trim().substring(0, 500) : null;

    // The observation rail performs only private native reads: no rate-limit
    // write, notice creation, analytics, item cleanup or financial helper.
    if (mode === 'observe') {
      if (expectedAdminUid !== adminUid) throw new HttpsError('permission-denied', 'Le compte administrateur a changé.');
      return db.runTransaction(async tx => {
        const swap = (await tx.get(db.collection('swaps').doc(swapId))).data();
        return observeSwapDisputeDecision(tx, swapId, swap, adminUid, issue, trimmedNote, 'observe', false);
      });
    }

    try {
      const result = await db.runTransaction(async (tx) => {
        const swapRef = db.collection('swaps').doc(swapId);
        const swapSnap = await tx.get(swapRef);
        if (!swapSnap.exists) {
          throw new HttpsError('not-found', 'Swap introuvable');
        }
        const swap = swapSnap.data()!;

        const priorNotice = swap.disputeResolutionNotice;
        if (swap.status !== 'disputed' && priorNotice?.protocol === 'swap_dispute_notice_v1') {
          const documentary = await observeSwapDisputeDecision(tx, swapId, swap, adminUid, issue, trimmedNote, 'resolve', true);
          if (documentary.observationState !== 'recorded') throw new HttpsError('failed-precondition', 'La décision historique doit être rapprochée.');
          return { swap, movedCents: priorNotice.movedCents, payerId: swap.cashTopUp?.payerId, replay: true,
            decisionKey: priorNotice.decisionKey, documentary };
        }

        // This legacy payload has no source CAS or durable command identity.
        // Preserve exact native receipts above, but never authorize new money,
        // stock or terminal-state changes from an unqualified legacy intention.
        throw new HttpsError('failed-precondition', 'Cette décision nécessite une nouvelle revue documentaire qualifiée.',
          {reason:'swap_dispute_documentary_review_required',financialEffectAuthorized:false,stockEffectAuthorized:false});
      });
      return result.documentary;

    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[resolveSwapDispute] failed', { swapId, error: errMsg });
      throw new HttpsError('internal', 'Erreur lors de la resolution du litige: ' + errMsg);
    }

    }));
  }
);

// ============================================================
// SWAP ZONE ITEM MANAGEMENT (no participants — open to all)
// ============================================================
// Depositing / removing an item only requires authentication + ownership of the
// article (sellerId == uid, not sold, active). No join/leave model.
// itemsCount on the zone is kept in sync atomically.
// ============================================================

/**
 * Add an item to the Swap Zone — atomic item creation + itemsCount increment.
 * Requires only: auth + ownership of the article (no participant check).
 */
export const addItemToPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.addItemToPartySecure"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId, articleId, title, price } = request.data;
    assertSwapExpectedUid(request.data?.expectedUid, request.auth.uid);

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }
    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }
    if (!title || typeof title !== 'string') {
      throw new HttpsError('invalid-argument', 'title requis');
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      throw new HttpsError('invalid-argument', 'price invalide');
    }

    const userId = request.auth.uid;

    try {
      const itemId = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Espace Le Troc introuvable');
        }

        // Verify the article exists and belongs to the user
        const articleRef = db.collection('articles').doc(articleId);
        const articleSnap = await tx.get(articleRef);
        if (!articleSnap.exists) {
          throw new HttpsError('not-found', 'Article introuvable');
        }
        const articleData = articleSnap.data()!;
        const ownerData = (await tx.get(db.collection('users').doc(userId))).data();
        if (articleData.sellerId !== userId) {
          throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
        }
        if (articlePrivacyWithdrawn(articleData) || articleData.isSold === true || articleData.isActive === false) {
          throw new HttpsError('failed-precondition', 'Cet article n\'est plus disponible.');
        }

        // Duplicate guard (inside tx to prevent race conditions)
        const duplicateQuery = await tx.get(db
          .collection('swapPartyItems')
          .where('partyId', '==', partyId)
          .where('articleId', '==', articleId)
          .limit(101));
        if (duplicateQuery.size >= 101) throw new HttpsError('failed-precondition', 'Les dépôts de cet article nécessitent une vérification.');
        // FR15 : un dépôt fait par un compte qui n'est PAS le vendeur de
        // l'article — possible tant que la règle ne vérifiait pas
        // l'appartenance — privait le vrai vendeur de son emplacement, cette
        // garde refusant ensuite son dépôt. Ces documents n'ont jamais été
        // comptés dans itemsCount : on les efface, sans décompte.
        const squatters = duplicateQuery.docs.filter((d) => d.data().sellerId !== userId);
        const ownDeposit = duplicateQuery.docs.find(d => d.data().sellerId === userId);
        if (ownDeposit) return ownDeposit.id;
        const itemRef = db.collection('swapPartyItems').doc('deposit_' + createHash('sha256')
          .update(JSON.stringify([partyId, articleId, userId])).digest('hex'));
        if ((await tx.get(itemRef)).exists) throw new HttpsError('failed-precondition', 'Le dépôt de cet article nécessite une vérification.');
        await assertNewSwapAdmission(tx, userId, [userId]);
        await assertArticleNotSwapEngaged(tx, articleId);
        await assertInventoryAvailable(tx, articleId, articleData);
        assertArticleNotModerationRestricted(articleData);
        assertArticleHygieneAdmitted(articleData);
        assertArticleSaleDeclaration(articleId, articleData);
        await assertArticleChildSafetyAdmitted(tx, articleId, articleData);
        await assertPrivateAccountSession(request, tx);
        for (const squatter of squatters) {
          logger.warn('Removing swap zone item deposited by a non-owner', {
            partyId,
            articleId,
            itemId: squatter.id,
          });
          await recoveryCommit({refs: [(squatter.ref).path]});
    tx.delete(squatter.ref);
        }

        const itemData: Record<string, any> = {
          phase1Contract: PHASE1_CONTRACT,
          partyId,
          articleId,
          sellerId: userId,
          sellerName: ownerData?.displayName || articleData.sellerName || '',
          title: articleData.title,
          price: articleData.price,
          categoryIds: articleData.categoryIds,
          condition: articleData.condition,
          ...(articleData.hygieneDeclaration != null ? { hygieneDeclaration: articleData.hygieneDeclaration } : {}),
          isSwapped: false,
          isPending: false,
          addedAt: FieldValue.serverTimestamp(),
        };
        itemData.sellerImage = publicProfileImage(ownerData);
        itemData.imageUrl = articleData.images?.[0]?.url ?? null;
        await recoveryCommit({refs: [(itemRef).path]});
    tx.create(itemRef, itemData);

        await recoveryCommit({refs: [(partyRef).path]});
    tx.update(partyRef, {
          itemsCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return itemRef.id;
      });

      logger.info('Item added to swap zone', { partyId, articleId, userId });
      return { itemId, success: true };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error adding item to swap zone', { error: errMsg, partyId, articleId, userId });
      throw new HttpsError('internal', 'Erreur lors de l\'ajout: ' + errMsg);
    }
  }))
);

/**
 * Remove an item from the Swap Zone — atomic item deletion + itemsCount
 * decrement. Requires only: auth + ownership of the item.
 */
export const removeItemFromPartySecure = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/swaps.removeItemFromPartySecure"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    const { partyId, articleId } = request.data;

    if (!partyId || typeof partyId !== 'string') {
      throw new HttpsError('invalid-argument', 'partyId requis');
    }
    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }

    const userId = request.auth.uid;

    try {
      await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const partyRef = db.collection('swapParties').doc(partyId);
        const partySnap = await tx.get(partyRef);
        if (!partySnap.exists) {
          throw new HttpsError('not-found', 'Espace Le Troc introuvable');
        }

        const itemQuery = await tx.get(db
          .collection('swapPartyItems')
          .where('partyId', '==', partyId)
          .where('articleId', '==', articleId)
          .where('sellerId', '==', userId));

        if (itemQuery.empty) {
          // Item not found — no-op (idempotent)
          return;
        }

        await assertPrivateAccountSession(request, tx);
        await recoveryCommit({refs: [(itemQuery.docs[0].ref).path]});
    tx.delete(itemQuery.docs[0].ref);

        await recoveryCommit({refs: [(partyRef).path]});
    tx.update(partyRef, {
          itemsCount: FieldValue.increment(-1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      logger.info('Item removed from swap zone', { partyId, articleId, userId });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error removing item from swap zone', { error: errMsg, partyId, articleId, userId });
      throw new HttpsError('internal', 'Erreur lors du retrait: ' + errMsg);
    }
  }))
);

/**
 * Get swap leaderboard (top swappers) for the zone.
 */
export const getSwapPartyLeaderboard = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB' },
  async (request) => {
    return withFinancialRecoveryScope({operation: "callable/swaps.getSwapPartyLeaderboard"}, async () => {
    const { partyId, limit: limitParam = 10 } = request.data;

    if (!partyId) {
      throw new HttpsError('invalid-argument', 'partyId is required');
    }

    try {
      const userSwapCounts: Record<string, { count: number; name: string; image?: string }> = {};

      // F58: bound the scan. An unfiltered .get() over ALL completed swaps in a
      // party (potentially thousands) loads everything into memory → OOM/timeout.
      // Paginate with a cursor up to a safety cap; a leaderboard tolerates a hard
      // ceiling on the swaps it aggregates.
      const LEADERBOARD_PAGE_SIZE = 500;
      const LEADERBOARD_SCAN_CAP = 5000;
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let scanned = 0;
      while (scanned < LEADERBOARD_SCAN_CAP) {
        let q = db
          .collection('swaps')
          .where('partyId', '==', partyId)
          .where('status', '==', 'completed')
          .orderBy('__name__')
          .limit(LEADERBOARD_PAGE_SIZE);
        if (cursor) q = q.startAfter(cursor);
        const page = await q.get();
        if (page.empty) break;

        page.docs.forEach((doc) => {
          const swap = doc.data();
          if (!userSwapCounts[swap.initiatorId]) {
            userSwapCounts[swap.initiatorId] = {
              count: 0,
              name: swap.initiatorName,
              image: swap.initiatorImage,
            };
          }
          userSwapCounts[swap.initiatorId].count++;

          if (!userSwapCounts[swap.receiverId]) {
            userSwapCounts[swap.receiverId] = {
              count: 0,
              name: swap.receiverName,
              image: swap.receiverImage,
            };
          }
          userSwapCounts[swap.receiverId].count++;
        });

        scanned += page.size;
        cursor = page.docs[page.docs.length - 1];
        if (page.size < LEADERBOARD_PAGE_SIZE) break;
      }

      const leaderboard = Object.entries(userSwapCounts)
        .map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limitParam);

      return { leaderboard };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting swap leaderboard', { error: message });
      throw new HttpsError('internal', 'Failed to get leaderboard: ' + message);
    }

    });
  }
);
