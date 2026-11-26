import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoverySourceFields, financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
import { promoteArticleImages, storageObjectPath, retiredArticleMediaRef, rejectRetiredArticleMedia } from '../utils/articleMedia';
import { preserveArticleReportEvidenceBeforeDeletion } from '../utils/reportEvidence';
import { publicProfileImage, articlePrivacyWithdrawn } from '../utils/publicProfile';
/**
 * Product callable functions
 * Firebase Functions v7 - using onCall
 */
import { createHash } from 'node:crypto';
import { inventoryUnitView, inventoryUnitReceipt, planNewArticleInventory, planArticleInventoryForEdit, planInventoryManualSale } from '../utils/inventoryUnit';
import {lateTransportRecoveryOwnReviewQualified} from '../utils/lateTransportRecovery';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, storage, FieldValue } from '../config/firebase';
import { matchBrand, BRAND_MATCHING } from '../services/brands';
import { brandDisplay } from '../utils/normalizeBrand';
import { ARTICLE_BLOCKING_TX_STATUSES, ARTICLE_BRAND_STATUSES, articleRequiresSize, sanitizeArticleSize,
  parseArticleAlterationDisclosure, isValidArticlePrice } from '../shared/article';
import { readEligibilityEvidence, assertOwnPublicationEligibility } from '../utils/eligibility';
import { recordOwnAdmissionRefusal, throwRecordedAdmissionRefusal, type RecordedAdmissionRefusal } from '../utils/admissionDecision';
import { assertArticleNotModerationRestricted, assertArticleChildSafetyAdmitted, commercialRequestHash, PUBLICATION_INPUT_FIELDS, PUBLICATION_V2_INPUT_FIELDS, PUBLICATION_V5_INPUT_FIELDS, PUBLICATION_V6_INPUT_FIELDS, LEGACY_PUBLICATION_INPUT_FIELDS } from '../utils/tradeAdmission';
import { assertSingleArticleInput, recordArticleListingContent, articleSaleDeclarationView,
  saleDeclarationContentHash, mergeSaleDeclarationContent, qualifiedArticleSaleDeclaration, assertArticleSaleDeclaration, isListingContentVersion } from '../utils/articleSaleDeclaration';
import { hasActiveBankDispute } from '../utils/bankDispute';
import { hasUnsettledRefund, refundInventoryRequiresReview } from '../utils/refundState';
import { cashReservationCanBeReused } from '../utils/cashMeetup';
import { isOwnBucketImageUrl } from '../utils/storagePaths';
import { canOfferShipping } from '../config/featureFlags';
import { articleHygieneRequirement } from '../shared/articleHygiene';
import { assertArticleHygieneAdmitted, declaredArticleHygiene } from '../utils/articleHygiene';
import { childSafetyCategory } from '../shared/articleChildSafety';
import { declaredArticleChildSafety, childSafetyContentHash, childSafetyPreparation, isChildSafetyPreparationEditable } from '../utils/articleChildSafety';
import { handleArticleChildSafetyPublication } from '../utils/articleChildSafetyPublication';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';

function articleChildSafetyEdit(articleId: string, existing: FirebaseFirestore.DocumentData, updates: Record<string, unknown>, uid: string): Record<string, unknown> {
  if (isChildSafetyPreparationEditable(articleId, existing) && updates.isActive === true) throw new HttpsError('failed-precondition',
    'Cette préparation nécessite une décision d’admission dédiée avant publication.', { reason: 'article_child_safety_review_required' });
  const resulting = mergeSaleDeclarationContent(existing, updates);
  if (childSafetyContentHash(articleId, existing) === childSafetyContentHash(articleId, resulting) && !('childSafetyDeclaration' in updates)) return {};
  const category = childSafetyCategory(resulting.categoryIds);
  if (category === 'not_child_clothing' && !Object.prototype.hasOwnProperty.call(existing, 'childSafetyPreparation')) {
    if (updates.childSafetyDeclaration != null) declaredArticleChildSafety(articleId, resulting, uid, updates.childSafetyDeclaration);
    return Object.prototype.hasOwnProperty.call(existing, 'childSafetyDeclaration') || 'childSafetyDeclaration' in updates
      ? { childSafetyDeclaration: FieldValue.delete() } : {};
  }
  const declaration = declaredArticleChildSafety(articleId, resulting, uid, updates.childSafetyDeclaration);
  const payload: Record<string, unknown> = { childSafetyDeclaration: declaration };
  Object.assign(payload, childSafetyPreparation(articleId, { ...resulting, ...payload }));
  return payload;
}

function articleHygieneEdit(existing: FirebaseFirestore.DocumentData, updates: Record<string, unknown>, uid: string): Record<string, unknown> {
  const categoryIds = 'categoryIds' in updates ? updates.categoryIds : existing.categoryIds;
  const condition = 'condition' in updates ? updates.condition : existing.condition;
  const categoryChanged = JSON.stringify(categoryIds) !== JSON.stringify(existing.categoryIds);
  // Correcting text/photos does not attest to hygiene or create a sale. Keep
  // an absent or unresolved legacy declaration unchanged; every new trade and
  // relist still passes the authoritative hygiene admission guard.
  if (!categoryChanged && condition === existing.condition && !('hygieneDeclaration' in updates)) return {};
  if (categoryChanged && !('hygieneDeclaration' in updates)
      && (articleHygieneRequirement(existing.categoryIds) !== 'none' || articleHygieneRequirement(categoryIds) !== 'none')) {
    throw new HttpsError('invalid-argument', 'Confirmez la nature et la déclaration d’hygiène après le changement de catégorie.',
      { reason: 'article_hygiene_category_reconfirmation_required', field: 'hygieneDeclaration' });
  }
  const payload = 'hygieneDeclaration' in updates
    ? { hygieneDeclaration: declaredArticleHygiene(categoryIds, condition, updates.hygieneDeclaration, uid) } : {};
  assertArticleHygieneAdmitted({ ...existing, categoryIds, condition, ...payload });
  return payload;
}

/**
 * Normalise a raw brand string for storage.
 *
 * Strategy: canonical-otherwise-Title-Case.
 *  - If the brand matches a known entry in the `brands` collection (exact, or
 *    fuzzy with confidence >= strongThreshold), store the canonical name.
 *  - Otherwise store a clean Title Case version (handling DS exceptions like
 *    COS, A.P.C.).
 * Result is trimmed and truncated to 100 chars, as before.
 */
async function resolveBrand(rawBrand: string): Promise<string> {
  const trimmed = rawBrand.trim();
  if (trimmed.length === 0) return '';

  let resolved: string;
  try {
    const brandMatch = await matchBrand(trimmed);
    // Seule une correspondance que le service ne demande PAS de confirmer
    // remplace la saisie du vendeur. La bande « à confirmer » (0,75-0,90)
    // contient autant de vraies corrections que de substitutions absurdes
    // (Lolita → Ippolita) : dans le doute, on garde ce que le vendeur a écrit.
    if (
      brandMatch.brandName &&
      (brandMatch.matchType === 'exact' ||
        brandMatch.confidence >= BRAND_MATCHING.autoSelectThreshold)
    ) {
      // Use the canonical name from the brands collection.
      resolved = brandMatch.brandName;
    } else {
      // No confident match → clean Title Case.
      resolved = brandDisplay(trimmed);
    }
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    // Never block article create/update on brand matching failures.
    logger.warn('resolveBrand: matchBrand failed, falling back to Title Case', {
      rawBrand: trimmed,
      error: error instanceof Error ? error.message : String(error),
    });
    resolved = brandDisplay(trimmed);
  }

  return resolved.substring(0, 100);
}

/**
 * Meetup neighborhood shape persisted on an article (mirrors the client
 * `MeetupNeighborhood` type: { id, name, borough }).
 */
interface MeetupNeighborhood {
  id: string;
  name: string;
  borough: string;
}

/**
 * Validate + normalise a single neighborhood entry (P2-8).
 *
 * Returns a clean `{ id, name, borough }` object (trimmed, length-bounded) or
 * `null` when the input is not a well-formed neighborhood. Callers reject the
 * whole request on `null` rather than silently dropping the field. This guards
 * against arbitrary/garbage meetup data; a full catalogue-ID allowlist is
 * tracked separately (needs a server-side catalogue in functions/src).
 */
function sanitizeNeighborhood(raw: unknown): MeetupNeighborhood | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;
  const id = typeof n.id === 'string' ? n.id.trim() : '';
  const name = typeof n.name === 'string' ? n.name.trim() : '';
  const borough = typeof n.borough === 'string' ? n.borough.trim() : '';
  if (!id || !name || !borough) return null;
  return {
    id: id.substring(0, 100),
    name: name.substring(0, 100),
    borough: borough.substring(0, 100),
  };
}

/** Check reservations within the same transaction that changes the article.
 * Reading and writing the article serializes this guard with acceptance. Treat
 * unknown/legacy nonterminal statuses as active instead of maintaining a stale
 * allowlist of historical shipping names.
 */
export async function assertNoLiveArticleTransaction(
  tx: FirebaseFirestore.Transaction,
  articleId: string,
  article: FirebaseFirestore.DocumentData,
): Promise<void> {
  const terminal = new Set(['cancelled', 'refunded', 'completed', 'meetup_completed']);
  const reservations = await tx.get(db.collection('transactions').where('articleId', '==', articleId).limit(101));
  if (reservations.size >= 101) throw new HttpsError('failed-precondition', 'L’historique des réservations doit être rapproché avant de modifier cet article.');
  for (const reservation of reservations.docs) {
    if (!refundInventoryRequiresReview(reservation.data())) continue;
    const nativeRecovery = await lateTransportRecoveryOwnReviewQualified(tx, reservation.id, reservation.data(), article);
    if (refundInventoryRequiresReview(reservation.data(), nativeRecovery)) throw new HttpsError('failed-precondition',
      'La récupération physique de cet article doit être instruite avant sa remise en vente.',
      { reason: 'refund_inventory_review_required', inventoryPermissionGranted: false });
  }
  for (const reservation of reservations.docs) {
    if (((reservation.data().cashReservationRelease != null || !terminal.has(reservation.data().status)) && !await cashReservationCanBeReused(tx, reservation.id, reservation.data())) ||
        hasActiveBankDispute(reservation.data()) || hasUnsettledRefund(reservation.data())) {
      throw new HttpsError('failed-precondition', 'Une transaction est en cours sur cet article. Annulez cet accord explicitement avant de modifier l’annonce.');
    }
  }
  // A legacy link may have lost its articleId index data. Do not clear an
  // unresolved link merely because the query above is empty.
  if (article.activeTransactionId != null) {
    if (typeof article.activeTransactionId !== 'string' || !article.activeTransactionId || article.activeTransactionId.includes('/')) {
      throw new HttpsError('failed-precondition', 'Le lien de réservation doit être examiné.');
    }
    const linked = await tx.get(db.collection('transactions').doc(article.activeTransactionId));
    if (!linked.exists || linked.data()!.articleId !== articleId) throw new HttpsError('failed-precondition', 'La source du lien de réservation doit être rapprochée.');
    if (linked.exists && refundInventoryRequiresReview(linked.data()!,
      refundInventoryRequiresReview(linked.data()!) && await lateTransportRecoveryOwnReviewQualified(tx, linked.id, linked.data()!, article))) {
      throw new HttpsError('failed-precondition', 'La récupération physique de cet article doit être instruite avant sa remise en vente.',
        { reason: 'refund_inventory_review_required', inventoryPermissionGranted: false });
    }
    if (!linked.exists || ((linked.data()!.cashReservationRelease != null || !terminal.has(linked.data()!.status)) && !await cashReservationCanBeReused(tx, linked.id, linked.data()!)) || hasActiveBankDispute(linked.data()!) || hasUnsettledRefund(linked.data()!)) {
      throw new HttpsError('failed-precondition', 'Un accord est encore lié à cet article.');
    }
  }
}

async function assertArticleEditable(
  tx: FirebaseFirestore.Transaction, articleId: string, uid: string, checkAdmission = true,
): Promise<FirebaseFirestore.DocumentData> {
  const snap = await tx.get(db.collection('articles').doc(articleId));
  if (!snap.exists) throw new HttpsError('not-found', 'Article introuvable');
  const existing = snap.data()!;
  if (existing.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre article');
  if (articlePrivacyWithdrawn(existing)) throw new HttpsError('failed-precondition', 'Annonce retirée pour confidentialité.');
  const childPreparation = isChildSafetyPreparationEditable(articleId, existing);
  if (!childPreparation) assertArticleNotModerationRestricted(existing);
  await assertNoLiveArticleTransaction(tx, articleId, existing);
  if (existing.isSold === true) {
    throw new HttpsError('failed-precondition', 'Impossible de modifier un article vendu');
  }
  if (existing.isActive === false && !childPreparation) {
    throw new HttpsError('failed-precondition', 'Impossible de modifier un article desactive');
  }
  if (checkAdmission) await assertOwnPublicationEligibility(await readEligibilityEvidence(tx, uid), tx, uid);
  return existing;
}

function publicationReplay(article: FirebaseFirestore.DocumentData, uid: string, data: Record<string, unknown>, hash: string, articleId: string) {
  if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
  if (!article.publicationRequestHash) throw new HttpsError('failed-precondition',
    'Cette publication existe déjà. Consultez l’annonce enregistrée pour vérifier son état.',
    { reason: 'legacy_publication_review', action: 'openExistingArticle', articleId });
  if (article.publicationRequestVersion != null && ![1, 2, 3, 4, 5, 6].includes(article.publicationRequestVersion))
    throw new HttpsError('failed-precondition', 'La preuve historique de cette publication doit être rapprochée.');
  const expectedHash = article.publicationRequestVersion === 6 ? hash : commercialRequestHash(data,
    article.publicationRequestVersion === 5 ? PUBLICATION_V5_INPUT_FIELDS : article.publicationRequestVersion === 4 ? [...PUBLICATION_INPUT_FIELDS, 'inventoryUnitDeclaration'] :
      article.publicationRequestVersion === 3 ? PUBLICATION_INPUT_FIELDS : article.publicationRequestVersion === 2 ? PUBLICATION_V2_INPUT_FIELDS : LEGACY_PUBLICATION_INPUT_FIELDS);
  if (article.publicationRequestHash !== expectedHash) throw new HttpsError('already-exists', 'Cette requête désigne déjà une publication avec d’autres données.');
}
async function publicationView(article: FirebaseFirestore.DocumentData, articleId: string, replayed: boolean, uid: string, tx: FirebaseFirestore.Transaction, request:any) {
  await assertPrivateAccountSession(request,tx);
  if (!article || article.sellerId !== uid) throw new HttpsError('unavailable', 'Le reçu de publication doit être relu.');
  const defects = article.publicationRequestVersion !== 6 && typeof article.hasKnownDefects === 'boolean' ? { hasKnownDefects: article.hasKnownDefects,
    defectsDescription: typeof article.defectsDescription === 'string' ? article.defectsDescription : null } : {};
  const inventoryReceipt = [4, 5, 6].includes(article.publicationRequestVersion)?await inventoryUnitReceipt(tx,articleId,article):null;
  return { articleId, replayed, saleDeclarationView: articleSaleDeclarationView(articleId, article), ...defects,
    ...(inventoryReceipt?{inventoryUnitReceipt:inventoryReceipt,inventoryUnitView:await inventoryUnitView(tx,articleId,article)}:{}),
    ...([5, 6].includes(article.publicationRequestVersion) ? { brand: typeof article.brand === 'string' ? article.brand : null } : {
      ...(parseArticleAlterationDisclosure(article) ?? {}),
      ...((ARTICLE_BRAND_STATUSES as readonly string[]).includes(article.brandStatus) ? { brandStatus: article.brandStatus,
      ...(article.brandStatus === 'known' && typeof article.brand === 'string' ? { brand: article.brand } : {}) } : {}) }) };
}

/**
 * Retire les balises HTML — et elles seules. La forme précédente,
 * `/<[^>]*>/g`, dévorait tout ce qui se trouvait entre un « < » et un « > » :
 * « Tour de taille <70 cm, longueur >90 cm » devenait « Tour de taille 90 cm ».
 */
function stripHtml(s: string): string {
  return s.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
}

/** Quartiers de rencontre qu'un article peut porter. */
const MAX_MEETUP_NEIGHBORHOODS = 10;

/**
 * Chemin de catégorie : 1 à 6 identifiants non vides (le catalogue a
 * 5 niveaux). `null` si la forme est invalide. Rien ne validait le contenu :
 * un article pouvait se ranger dans toutes les catégories à la fois, et un
 * identifiant non-chaîne passait tel quel dans l'index.
 */
function sanitizeCategoryIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 6) return null;
  const ids = raw.map((v) => (typeof v === 'string' ? v.trim() : ''));
  if (ids.some((id) => id.length === 0 || id.length > 100)) return null;
  return ids;
}

/** Le libellé de catégorie alimente les mots-clés de recherche : nettoyé et borné. */
function sanitizeCategoryLabel(raw: unknown): string {
  return typeof raw === 'string' ? stripHtml(raw).substring(0, 100) : '';
}

/**
 * Une baisse de prix ne compte — et ne remet l'article en tête du rail
 * « Baisses de prix » — qu'à partir de 5 % du prix courant. En deçà, un
 * centime par jour suffisait à y garder la première place.
 */
const MIN_PRICE_DROP_RATIO = 0.05;

/**
 * Increment article view count
 */
export const incrementProductView = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/products.incrementProductView"}, async () => withPrivateAccountSession(request, async () => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { productId } = request.data;

  if (!productId) {
    throw new HttpsError('invalid-argument', 'Product ID is required');
  }

  const viewerId = request.auth.uid;

  try {
    const articleRef = db.collection('articles').doc(productId);
    const searchIndexRef = db.collection('search_index').doc(productId);
    // One view per person, per article and per day. The counter is the only
    // input of the popularity score — the only server order of keyword
    // search — and any signed-in account could bump it in a loop. `expireAt`
    // lets a Firestore TTL policy purge these marks.
    const day = new Date().toISOString().slice(0, 10);
    const markRef = db.collection('article_views').doc(`${productId}_${viewerId}_${day}`);

    await db.runTransaction(async (transaction) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await assertPrivateAccountSession(request, transaction);
      const articleDoc = await transaction.get(articleRef);

      if (!articleDoc.exists) {
        throw new HttpsError('not-found', 'Article not found');
      }

      // The seller looking at their own listing does not count.
      if (articleDoc.data()?.sellerId === viewerId) return;

      const mark = await transaction.get(markRef);
      if (mark.exists) return;

      const currentViews = articleDoc.data()?.views || 0;
      const newViews = currentViews + 1;

      await assertPrivateAccountSession(request, transaction);

      // Update article views
      await recoveryCommit({refs: [(articleRef).path]});
    transaction.update(articleRef, { views: newViews });

      // Update search index views (set+merge in case doc doesn't exist yet)
      await recoveryCommit({refs: [(searchIndexRef).path]});
    transaction.set(searchIndexRef, { views: newViews }, { merge: true });

      await recoveryCommit({refs: [(markRef).path]});
    transaction.set(markRef, {
        articleId: productId,
        viewerId,
        day,
        expireAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      });
    });

    return { success: true, message: 'View count incremented' };
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    // « Article introuvable » was rewritten as an internal error.
    if (error instanceof HttpsError) throw error;
    logger.error('Error incrementing article view:', error);
    throw new HttpsError('internal', 'Failed to increment view count');
  }
})));

/**
 * Toggle article like/unlike.
 *
 * Canonical write contract (P1-3 / P1-4): the `favorites/{userId}.articleIds`
 * array is the single source of truth. The `onArticleFavorited` trigger reacts
 * to changes on that array and is the ONLY writer of the article engagement
 * counters (`favoritesCount` / `likes`) and the `search_index` likes, via
 * `FieldValue.increment`. This callable therefore mutates ONLY the favorites
 * doc — writing the counters here too would double-count against the trigger.
 *
 * The standard client path is `toggleFavorite` (which writes the same favorites
 * doc directly). This callable is kept as a server-side equivalent and must
 * stay aligned with that contract.
 */
export const toggleProductLike = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => withFinancialRecoveryScope({operation: "callable/products.toggleProductLike"}, async () => withPrivateAccountSession(request, async () => {
  const { productId, isLiked } = request.data;

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  if (!productId || typeof isLiked !== 'boolean') {
    throw new HttpsError(
      'invalid-argument',
      'Product ID and like status are required'
    );
  }

  const userId = request.auth.uid;

  try {
    const favoritesRef = db.collection('favorites').doc(userId);

    // The private barrier joins this mutation's read set. Array transforms
    // retain their historical idempotence; the trigger still owns counters.
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await assertPrivateAccountSession(request, tx);
      await recoveryCommit({refs: [(favoritesRef).path]});
    tx.set(favoritesRef,
      {
        userId,
        articleIds: isLiked
          ? FieldValue.arrayUnion(productId)
          : FieldValue.arrayRemove(productId),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
      );
    });

    return { success: true, message: 'Like status updated' };
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    if (error instanceof HttpsError) throw error;
    logger.error('Error toggling article like:', error);
    throw new HttpsError('internal', 'Failed to update like status');
  }
})));

/**
 * Create article server-side with validation and sanitisation.
 *
 * The client uploads images to Storage first, then passes the download URLs
 * here. This callable validates every field, sanitises text inputs (strip
 * HTML, trim, enforce length bounds), and creates the article atomically.
 *
 * Returns { articleId: string }.
 */
export const createArticle = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/products.createArticle"}, async () => withPrivateAccountSession(request,async () => {
    // ── 1. Auth check ──
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Utilisateur non connecté');
    }
    const uid = request.auth.uid;
    const data = request.data;

    // ── 2. Validate required fields ──
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new HttpsError('invalid-argument', 'Données manquantes');
    }
    const requestId = typeof data.clientRequestId === 'string' ? data.clientRequestId.trim().slice(0, 200) : '';
    if (!requestId) throw new HttpsError('invalid-argument', 'Une intention stable de publication est requise.',
      { reason: 'publication_request_id_required', field: 'clientRequestId' });
    const inputHash = commercialRequestHash(data, PUBLICATION_V6_INPUT_FIELDS);
    const articleId = createHash('sha256').update(`${uid}:${requestId}`).digest('hex').slice(0, 20);
    const docRef = db.collection('articles').doc(articleId);
    // Exact own historical receipts precede current admission and new fields.
    const replay = await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request,tx);
      const previous = (await tx.get(docRef)).data();
      if (!previous) return null;
      publicationReplay(previous, uid, data, inputHash, articleId);
      return publicationView(previous, articleId, true, uid, tx, request);
    });
    if (replay) return replay;
    if (requestId !== data.clientRequestId || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new HttpsError('invalid-argument', 'Intention de publication invalide.');
    if (!request.auth.token.email_verified) throw new HttpsError('permission-denied', 'Veuillez verifier votre adresse e-mail avant de publier.');
    assertSingleArticleInput(data, true);

    // Title — validé APRÈS nettoyage : un titre fait de balises passait la
    // garde sur le texte brut et se publiait vide.
    const sanitizedTitle =
      typeof data.title === 'string' ? stripHtml(data.title).substring(0, 200) : '';
    if (sanitizedTitle.length < 3) {
      throw new HttpsError(
        'invalid-argument',
        'Le titre doit contenir au moins 3 caractères',
      );
    }

    // Price
    if (
      data.price == null ||
      typeof data.price !== 'number' ||
      data.price < 0.01 ||
      data.price > 10000
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Le prix doit être compris entre 0,01 $ et 10 000 $',
      );
    }

    // Images — at least one image object with a url string
    if (
      !data.images ||
      !Array.isArray(data.images) ||
      data.images.length === 0
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Au moins une image est requise',
      );
    }
    // Client limit: 5, server safety limit: 10
    if (data.images.length > 10) {
      throw new HttpsError(
        'invalid-argument',
        'Maximum 10 photos autorisées',
      );
    }
    for (const img of data.images) {
      if (!img || typeof img.url !== 'string' || img.url.trim().length === 0) {
        throw new HttpsError(
          'invalid-argument',
          'Chaque image doit avoir une URL valide',
        );
      }
      // L'image d'une annonce vit dans le bucket du projet. Une URL
      // arbitraire faisait charger, chez chaque visiteur, un serveur choisi par
      // le vendeur — et la fonction d'embeddings la téléchargeait.
      if (!isOwnBucketImageUrl(img.url.trim())) {
        throw new HttpsError('invalid-argument', 'Image non hébergée par Seconde');
      }
      const path = storageObjectPath(img.url.trim()), segments = path?.split('/');
      if (!segments || !['drafts', 'products'].includes(segments[0]) || segments[1] !== uid || segments.length < 4) {
        throw new HttpsError('permission-denied', 'Cette photo ne vous appartient pas');
      }
    }

    // Condition
    const validConditions = [
      'neuf',
      'neuf sans étiquette',
      'très bon état',
      'bon état',
      'satisfaisant',
    ];
    if (data.condition && !validConditions.includes(data.condition)) {
      throw new HttpsError(
        'invalid-argument',
        'Condition invalide',
      );
    }

    // CategoryIds (required by publish flow)
    const sanitizedCategoryIds = sanitizeCategoryIds(data.categoryIds);
    if (!sanitizedCategoryIds) {
      throw new HttpsError('invalid-argument', 'Catégorie invalide');
    }

    // Listing preferences are distinct from acquisition permissions. Dev may
    // offer delivery without opening payments, quotes or carrier labels.
    const wantsHandDelivery = data.isHandDelivery === true;
    const wantsShipping = data.isShipping === true;
    if (!wantsHandDelivery && !wantsShipping) {
      throw new HttpsError(
        'invalid-argument',
        'Au moins une option de livraison requise',
      );
    }

    // Outside the explicit Dev listing preview, shipping-only publication
    // requires the active shipping rail. New meetup admission independently
    // rejects an article that does not offer hand delivery.
    if (wantsShipping && !wantsHandDelivery && !canOfferShipping()) {
      throw new HttpsError(
        'failed-precondition',
        'La livraison est temporairement indisponible : proposez la remise en main propre.',
      );
    }

    // La remise en main propre est le seul parcours d'achat actif : sans
    // quartier, l'annonce ne dit à personne où la rencontrer.
    const hasMeetupNeighborhood =
      (Array.isArray(data.neighborhoods) && data.neighborhoods.length > 0) ||
      (!!data.neighborhood && typeof data.neighborhood === 'object');
    if (wantsHandDelivery && !hasMeetupNeighborhood) {
      throw new HttpsError(
        'invalid-argument',
        'Choisissez au moins un quartier de rencontre',
      );
    }

    // ── 3. Sanitise text fields ──
    const sanitizedDescription = typeof data.description === 'string'
      ? stripHtml(data.description).substring(0, 5000)
      : '';

    const hygieneDeclaration = declaredArticleHygiene(sanitizedCategoryIds, data.condition, data.hygieneDeclaration, uid);

    // Only a new publication acquires this stricter monetary contract. An
    // exact historical replay above remains read-only, with its original price.
    if (!isValidArticlePrice(data.price)) {
      throw new HttpsError('invalid-argument',
        'Le prix doit être compris entre 0,01 $ et 10 000 $, avec au maximum deux décimales.',
        { field: 'price', reason: 'article_price_cents_required' });
    }

    // New publications only: exact historical retries above keep their original
    // disclosure. No omitted condition or unknown defect state becomes a claim.
    if (typeof data.condition !== 'string' || !validConditions.includes(data.condition)) {
      throw new HttpsError('invalid-argument', 'Choisissez explicitement l’état de l’article.', { field: 'condition' });
    }
    if (!sanitizedDescription) {
      throw new HttpsError('invalid-argument', 'Décrivez l’article avant de publier.', { field: 'description' });
    }
    const sanitizedSize = sanitizeArticleSize(data.size);
    if ((articleRequiresSize(sanitizedCategoryIds) && !sanitizedSize)
        || (data.size != null && !sanitizedSize)) {
      throw new HttpsError('invalid-argument', 'Renseignez une taille ou une pointure valide pour cette catégorie.', { field: 'size' });
    }
    if (data.brand != null && typeof data.brand !== 'string') {
      throw new HttpsError('invalid-argument', 'Marque invalide ; laissez-la non renseignée si elle n’est pas identifiée.', { field: 'brand' });
    }
    const brandName = typeof data.brand === 'string' ? stripHtml(data.brand).substring(0, 100) : '';

    // Complete the local input checks before an OWN admission refusal can be
    // recorded. A malformed publication is not an automated eligibility log.
    const neighborhoods: MeetupNeighborhood[] = [];
    if (Array.isArray(data.neighborhoods) && data.neighborhoods.length > 0) {
      if (data.neighborhoods.length > MAX_MEETUP_NEIGHBORHOODS) throw new HttpsError('invalid-argument', 'Maximum 10 quartiers de rencontre');
      const cleaned = data.neighborhoods.map(sanitizeNeighborhood);
      if (cleaned.some((value: MeetupNeighborhood | null) => value === null)) throw new HttpsError('invalid-argument', 'Quartier invalide');
      neighborhoods.push(...cleaned as MeetupNeighborhood[]);
    } else if (data.neighborhood && typeof data.neighborhood === 'object') {
      const cleaned = sanitizeNeighborhood(data.neighborhood);
      if (cleaned === null) throw new HttpsError('invalid-argument', 'Quartier invalide');
      neighborhoods.push(cleaned);
    }
    declaredArticleChildSafety(docRef.id, { ...data, sellerId: uid, title: sanitizedTitle,
      description: sanitizedDescription, categoryIds: sanitizedCategoryIds }, uid, data.childSafetyDeclaration);
    const admissionContext = { kind: 'article_publication', articleId: docRef.id, publicationRequestId: requestId, inputHash };

    // ── 4. Read the native seller and qualify this exact NEW intent ──
    const preflight = await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request,tx);
      const existing = await tx.get(docRef);
      if (existing.exists) {
        publicationReplay(existing.data()!, uid, data, inputHash, docRef.id);
        return { replayed: true as const, user: null };
      }
      const refusal = await recordOwnAdmissionRefusal(tx, { ownerId: uid, operation: 'createArticle', scope: 'sell', sourceContext: admissionContext });
      if (refusal) return refusal;
      const evidence = await readEligibilityEvidence(tx, uid);
      await assertOwnPublicationEligibility(evidence, tx, uid);
      return { replayed: false as const, user: evidence.user };
    });
    if ('admissionRefused' in preflight) return await throwRecordedAdmissionRefusal(preflight);
    if (preflight.replayed) return db.runTransaction(async tx => publicationView((await tx.get(docRef)).data()!, docRef.id, true, uid, tx, request));
    const userData = preflight.user;

    let sellerName: string;
    if (typeof userData?.displayName === 'string' && userData.displayName.trim().length > 0) {
      sellerName = userData.displayName;
    } else {
      sellerName = 'Utilisateur';
      logger.warn('createArticle: user displayName empty', { uid });
    }
    const sellerImage = publicProfileImage(userData);

    // NOTE: Stripe Custom account creation is no longer done silently at
    // article publish. Sellers must complete full in-app onboarding via
    // createStripeConnectAccount (identity, address, bank account) before
    // their shipping articles can be purchased. The createTransaction
    // callable enforces this check at purchase time.

    // ── 4b. Link to the seller's shop (P1-2) ──
    // If this seller owns an approved shop, stamp its id on the article so it
    // shows under the shop and feeds the shop's articlesCount trigger. Resolved
    // server-side from the trusted uid (never from client input). Best-effort:
    // a lookup failure must never block publishing — the field is simply omitted
    // (no boutique linked === no shopId, never `undefined`).
    let shopId: string | null = null;
    try {
      // Single equality filter on ownerId → covered by the automatic
      // single-field index (no composite index required). Approved-status
      // filtering is done in memory to avoid a composite index.
      const shopSnap = await db
        .collection('shops')
        .where('ownerId', '==', uid)
        .get();
      const approvedShop = shopSnap.docs.find(
        (d) => d.data()?.status === 'approved',
      );
      if (approvedShop) {
        shopId = approvedShop.id;
      }
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.warn('createArticle: shop lookup failed, publishing without shopId', {
        sellerId: uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // ── 5. Build sanitised images array ──
    const sanitizedImages: { url: string; blurhash?: string }[] =
      data.images.map(
        (img: { url: string; blurhash?: string }) => {
          const entry: { url: string; blurhash?: string } = {
            url: img.url.trim(),
          };
          if (img.blurhash && typeof img.blurhash === 'string') {
            entry.blurhash = img.blurhash;
          }
          return entry;
        },
      );

    // ── 6. Build the article document ──
    // Only include defined fields (no undefined → Firestore rejects them)
    const article: Record<string, unknown> = {
      sellerId: uid,
      quantity: 1,
      ...('stock' in data ? { stock: 1 } : {}),
      sellerName,
      title: sanitizedTitle,
      description: sanitizedDescription,
      price: data.price,
      images: sanitizedImages,
      category: sanitizeCategoryLabel(data.category),
      categoryIds: sanitizedCategoryIds,
      hygieneDeclaration,
      condition: data.condition,
      isActive: sanitizedImages.length > 0,
      isSold: false,
      isHandDelivery: data.isHandDelivery === true,
      isShipping: data.isShipping === true,
      views: 0,
      likes: 0,
      favoritesCount: 0,
      moderationStatus: 'approved',
      moderationSource: 'automatic_publication',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      publicationRequestHash: inputHash,
      publicationRequestVersion: 6,
    };

    // Optional scalar fields
    if (sellerImage) article.sellerImage = sellerImage;
    // Shop link (P1-2) — only when the seller has an approved boutique.
    if (shopId) article.shopId = shopId;
    // Size — accept the ArticleSize object { value, system } (current client),
    // or a legacy plain string (back-compat → defaults to system 'EU').
    // Absent size remains absent only when the category permits it.
    if (sanitizedSize) {
      article.size = sanitizedSize;
    }
    // A brand is optional; omission does not claim the item is unbranded.
    if (brandName) {
      article.brand = await resolveBrand(brandName);
    }
    // `pattern`: legacy field, lecture seule, plus ecrit (P3-5). The pattern
    // concept was removed (data/patterns.ts has no importers); existing docs
    // keep the field for back-compat reads but new writes no longer set it.

    // Colors — multi-select + backward compat single value
    if (Array.isArray(data.colors) && data.colors.length > 0) {
      article.colors = data.colors
        .filter((c: unknown) => typeof c === 'string')
        .slice(0, 20);
      article.color = (article.colors as string[])[0] || null;
    } else if (typeof data.color === 'string' && data.color.trim()) {
      article.color = data.color.trim();
    }

    // Materials — multi-select + backward compat single value
    if (Array.isArray(data.materials) && data.materials.length > 0) {
      article.materials = data.materials
        .filter((m: unknown) => typeof m === 'string')
        .slice(0, 20);
      article.material = (article.materials as string[])[0] || null;
    } else if (typeof data.material === 'string' && data.material.trim()) {
      article.material = data.material.trim();
    }

    // Neighborhoods (meetup locations) — server-validate the MeetupNeighborhood
    // shape (P2-8). Each entry must carry non-empty id/name/borough strings;
    // anything malformed is rejected so we never persist garbage meetup data.
    if (neighborhoods.length > 0) {
      article.neighborhoods = neighborhoods;
      article.neighborhood = neighborhoods[0];
    }

    // Package size
    const validPackageSizes = ['small', 'medium', 'large'];
    if (
      typeof data.packageSize === 'string' &&
      validPackageSizes.includes(data.packageSize)
    ) {
      article.packageSize = data.packageSize;
    }

    // ── 7. Create in Firestore ──
    // Idempotent on the client's request id (its draft id). A publish whose
    // response was lost — the server wrote, the client showed an error —
    // published the same article a second time when retried. The article id
    // is derived from it, and a transaction makes the replay a no-op.
    declaredArticleChildSafety(docRef.id, article, uid, data.childSafetyDeclaration);
    article.images = await promoteArticleImages(sanitizedImages, uid, docRef.id);
    const prepared = article.images as { url: string }[];
    const promotedCount = prepared.filter((image, index) => image.url !== sanitizedImages[index]?.url).length;
    let publicationResult: boolean | RecordedAdmissionRefusal;
    try { publicationResult = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await assertPrivateAccountSession(request,tx);
      const snap = await tx.get(docRef);
      if (snap.exists) { publicationReplay(snap.data()!, uid, data, inputHash, docRef.id); return true; }
      const refusal = await recordOwnAdmissionRefusal(tx, { ownerId: uid, operation: 'createArticle', scope: 'sell', sourceContext: admissionContext });
      if (refusal) return refusal;
      const evidence = await readEligibilityEvidence(tx, uid);
      await assertOwnPublicationEligibility(evidence, tx, uid);
      const currentUser = evidence.user!;
      const payload: Record<string, unknown> = { ...article, sellerName: typeof currentUser.displayName === 'string' && currentUser.displayName.trim() ? currentUser.displayName : 'Utilisateur' };
      assertArticleHygieneAdmitted(payload);
      const childDeclaration = declaredArticleChildSafety(docRef.id, payload, uid, data.childSafetyDeclaration);
      if (childDeclaration) payload.childSafetyDeclaration = childDeclaration;
      Object.assign(payload, childSafetyPreparation(docRef.id, payload));
      payload.saleDeclaration = recordArticleListingContent(docRef.id, payload, uid, inputHash, null);
      const inventory = await planNewArticleInventory(tx,uid,docRef.id,payload,inputHash);
      Object.assign(payload,inventory.articleFields);
      delete payload.sellerImage;
      if (publicProfileImage(currentUser)) payload.sellerImage = publicProfileImage(currentUser);
      inventory.commit();await recoveryCommit({refs: [(docRef).path]});
    tx.set(docRef, payload); return false;
    }); } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.warn('createArticle: prepared media without a committed publication', { articleId: docRef.id, sellerId: uid,
        preparedImageCount: prepared.length, promotedImageCount: promotedCount, cleanupPerformed: false,
        reasonCode: error instanceof HttpsError ? error.code : 'internal' });
      throw error;
    }
    if (typeof publicationResult !== 'boolean') {
      // Prepared objects are retained. Deleting by an old draft/path here can
      // erase a concurrent successful publication or private historical copy.
      logger.warn('createArticle: prepared media retained after recorded admission refusal', { articleId: docRef.id, sellerId: uid,
        decisionId: publicationResult.decisionId, preparedImageCount: prepared.length, promotedImageCount: promotedCount,
        cleanupPerformed: false, reasonCode: 'admission_refused' });
      return await throwRecordedAdmissionRefusal(publicationResult);
    }
      if (publicationResult) {
        logger.info('createArticle replayed, returning the existing article', {
          articleId: docRef.id,
          sellerId: uid,
          unusedPreparedImageCount: promotedCount,
          cleanupPerformed: false,
        });
        return db.runTransaction(async tx => publicationView((await tx.get(docRef)).data()!, docRef.id, true, uid, tx, request));
      }

    logger.info('Article created via callable', {
      articleId: docRef.id,
      sellerId: uid,
      title: sanitizedTitle,
      imagesCount: sanitizedImages.length,
    });

    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request,tx);
      const saved = (await tx.get(docRef)).data();
      if (!saved || saved.sellerId !== uid) throw new HttpsError('unavailable', 'Le reçu de publication doit être relu.');
      return publicationView(saved, docRef.id, false, uid, tx, request);
    });
  })),
);

/** Revision of the actual Firestore document, including every other writer.
 * Do not use toMillis(): two writes can differ only by their nanoseconds.
 */
function soldArticleRevision(articleId: string, uid: string, snap: FirebaseFirestore.DocumentSnapshot): string {
  const time = snap.updateTime;
  if (!time || !Number.isSafeInteger(time.seconds) || !Number.isInteger(time.nanoseconds)
      || time.nanoseconds < 0 || time.nanoseconds >= 1_000_000_000) {
    throw new HttpsError('failed-precondition', 'L’état de cette annonce ne peut pas être vérifié.',
      { reason: 'article_sold_state_unverifiable', action: 'refreshArticle', articleId });
  }
  return createHash('sha256').update(JSON.stringify([articleId, uid, time.seconds, time.nanoseconds])).digest('hex');
}

function soldArticleState(data: FirebaseFirestore.DocumentData, articleId: string): boolean {
  // Missing isSold is the legacy listed state; all other non-booleans fail closed.
  if (data.isSold === undefined) return false;
  if (typeof data.isSold !== 'boolean') {
    throw new HttpsError('failed-precondition', 'L’état de cette annonce ne peut pas être vérifié.',
      { reason: 'article_sold_state_unverifiable', action: 'refreshArticle', articleId });
  }
  return data.isSold;
}

/** Historical name retained for callable routing. This is an explicit intent,
 * never a toggle. Observe before confirming, then persist/retry the exact set
 * payload. A private receipt and the article commit atomically. Replays never
 * write; any later document write makes the historical receipt superseded.
 * Old articleId-only payloads are rejected instead of guessing their intent.
 */
export const toggleArticleSold = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/products.toggleArticleSold"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Utilisateur non connecté');
    }
    const input = request.data as unknown;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new HttpsError('invalid-argument', 'Une intention explicite est requise.');
    }
    const data = input as Record<string, unknown>;
    const { articleId, operation } = data;
    if (typeof articleId !== 'string' || articleId.length === 0 || articleId.includes('/')
        || articleId === '.' || articleId === '..' || /^__.*__$/.test(articleId)
        || Buffer.byteLength(articleId, 'utf8') > 1500
        || (operation !== 'observe' && operation !== 'set')) {
      throw new HttpsError('invalid-argument', 'articleId et operation valides requis');
    }
    const allowedFields = operation === 'observe' ? ['operation', 'articleId']
      : ['operation', 'articleId', 'requestId', 'desiredIsSold', 'expectedIsSold', 'expectedRevision'];
    if (Object.keys(data).some(key => !allowedFields.includes(key))) {
      throw new HttpsError('invalid-argument', 'Champ d’intention inconnu.');
    }
    const { requestId, desiredIsSold, expectedIsSold, expectedRevision } = data;
    if (operation === 'set' && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)
        || typeof desiredIsSold !== 'boolean' || typeof expectedIsSold !== 'boolean'
        || desiredIsSold === expectedIsSold || typeof expectedRevision !== 'string'
        || !/^[a-f0-9]{64}$/.test(expectedRevision))) {
      throw new HttpsError('invalid-argument', 'Une intention, une observation et un requestId valides sont requis.');
    }

    const uid = request.auth.uid;
    const articleRef = db.collection('articles').doc(articleId);
    if (operation === 'observe') {
      // Existing owner access does not require admission to a new sale.
      return db.runTransaction(async t => {
        await assertPrivateAccountSession(request, t);
        const snap = await t.get(articleRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Article introuvable');
        const article = snap.data()!;
        if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
        return { operation: 'observe' as const, articleId, isSold: soldArticleState(article, articleId),
          revision: soldArticleRevision(articleId, uid, snap) };
      });
    }

    // Fixed-order canonical primitives bind this UID/requestId to one intent,
    // including the original observation. No truncation or permissive legacy path.
    const inputHash = createHash('sha256').update(JSON.stringify(
      [articleId, requestId, desiredIsSold, expectedIsSold, expectedRevision],
    )).digest('hex');
    const receiptKey = createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex');
    const receiptRef = db.collection('article_sold_requests').doc(receiptKey);
    const result = await db.runTransaction(async (t) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await assertPrivateAccountSession(request, t);
      // All reads, including agreement and seller admission, precede both writes.
      const snap = await t.get(articleRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Article introuvable');
      const article = snap.data()!;
      if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
      const receipt = await t.get(receiptRef);
      const currentIsSold = soldArticleState(article, articleId);
      const currentRevision = soldArticleRevision(articleId, uid, snap);
      if (receipt.exists) {
        const saved = receipt.data()!;
        if (saved.inputHash !== inputHash) {
          throw new HttpsError('already-exists', 'Ce requestId désigne déjà une autre intention.');
        }
        if (saved.protocolVersion !== 1 || saved.sellerId !== uid || saved.articleId !== articleId
            || saved.requestId !== requestId || saved.desiredIsSold !== desiredIsSold) {
          throw new HttpsError('failed-precondition', 'La preuve de cette intention ne peut pas être vérifiée.',
            { reason: 'article_sold_receipt_unverifiable', action: 'refreshArticle', articleId, requestId });
        }
        // Treat equal native updateTimes as the unchanged joint-commit proof.
        // If the SDK represents that commit differently, classification is
        // conservatively superseded; this comparison never authorizes a write.
        if (currentIsSold !== desiredIsSold || currentRevision !== soldArticleRevision(articleId, uid, receipt)) {
          throw new HttpsError('failed-precondition', 'Cette intention a été appliquée, puis l’annonce a changé.',
            { reason: 'article_sold_intent_superseded', action: 'refreshArticle', articleId, requestId,
              appliedIsSold: saved.desiredIsSold, currentIsSold, currentRevision });
        }
        return { success: true as const, operation: 'set' as const, outcome: 'replayed' as const,
          articleId, requestId: requestId as string, isSold: currentIsSold, revision: currentRevision };
      }
      if (currentIsSold !== expectedIsSold || currentRevision !== expectedRevision) {
        throw new HttpsError('failed-precondition', 'L’annonce a changé depuis votre confirmation.',
          { reason: 'article_sold_observation_stale', action: 'refreshArticle', articleId, requestId,
            currentIsSold, currentRevision });
      }
      const activeTransactions = await t.get(
        db.collection('transactions').where('articleId', '==', articleId)
          .where('status', 'in', ARTICLE_BLOCKING_TX_STATUSES).limit(1),
      );
      if (!activeTransactions.empty) {
        throw new HttpsError('failed-precondition', 'Une transaction est en cours sur cet article');
      }
      await assertNoLiveArticleTransaction(t, articleId, article);
      // Closing an old listing remains possible without new selling admission.
      if (desiredIsSold === false) {
        assertArticleNotModerationRestricted(article);
        assertArticleHygieneAdmitted(article);
        assertArticleSaleDeclaration(articleId, article);
        await assertArticleChildSafetyAdmitted(t, articleId, article);
        const refusal = await recordOwnAdmissionRefusal(t, { ownerId: uid, operation: 'relistArticle', scope: 'sell',
          sourceContext: { kind: 'article_relist', articleId, articleRevision: currentRevision, requestId, inputHash } });
        if (refusal) return refusal;
        await assertOwnPublicationEligibility(await readEligibilityEvidence(t, uid), t, uid);
      }
      const inventory=await planInventoryManualSale(t,articleId,article,requestId as string,desiredIsSold as boolean);
      inventory.commit();await recoveryCommit({refs: [(articleRef).path]});
    t.update(articleRef, { isSold: desiredIsSold, updatedAt: FieldValue.serverTimestamp() });
      await recoveryCommit({refs: [(receiptRef).path]});
    t.create(receiptRef, { protocolVersion: 1, articleId, sellerId: uid, requestId,
        desiredIsSold, expectedIsSold, expectedRevision, inputHash, appliedAt: FieldValue.serverTimestamp() });
      // The commit updateTime is not available in the callback. A fresh observe
      // is required for another gesture; this result is proof of this intent only.
      return { success: true as const, operation: 'set' as const, outcome: 'applied' as const,
        articleId, requestId: requestId as string, isSold: desiredIsSold as boolean, revision: null };
    });
    if ('admissionRefused' in result) return throwRecordedAdmissionRefusal(result, () => assertPrivateAccountSession(request));
    logger.info('Article sold intent handled', { articleId, sellerId: uid, requestId, outcome: result.outcome });
    return result;
  })),
);

/**
 * Update an existing article server-side with validation and sanitisation.
 *
 * The client sends { articleId, updates } where `updates` contains only the
 * modifiable fields. This callable validates ownership, prevents editing sold
 * articles, sanitises text inputs and applies price-drop tracking when the
 * price decreases.
 *
 * Returns { success: true }.
 */
export const updateArticle = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/products.updateArticle"}, async () => withPrivateAccountSession(request, async () => {
    // ── 1. Auth check ──
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Utilisateur non connecté');
    }

    const uid = request.auth.uid;
    const { articleId, updates, mode } = request.data ?? {};

    if (mode === 'child_safety_publication') return handleArticleChildSafetyPublication(request, { assertNoLiveArticleTransaction, assertArticleEditable });

    if (!articleId || typeof articleId !== 'string' || articleId.includes('/')) {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }
    if (mode === 'inventory_unit') {
      if(request.data.expectedUid!==uid)throw new HttpsError('permission-denied','Le compte propriétaire a changé.');
      return db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const article=(await tx.get(db.collection('articles').doc(articleId))).data();
        if(!article || article.sellerId!==uid)throw new HttpsError('permission-denied','Pas votre annonce.');
        return inventoryUnitView(tx,articleId,article);});
    }
    if (mode === 'declaration_observe') {
      if (request.data.expectedUid !== uid) throw new HttpsError('permission-denied', 'Le compte propriétaire a changé.');
      return db.runTransaction(async tx => {
        await assertPrivateAccountSession(request, tx);
        const article = (await tx.get(db.collection('articles').doc(articleId))).data();
        if (!article) throw new HttpsError('not-found', 'Article introuvable.');
        if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre annonce.');
        return articleSaleDeclarationView(articleId, article);
      });
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new HttpsError('invalid-argument', 'updates requis');
    }
    assertSingleArticleInput(updates);
    // Existing journals can recover their exact OLD native receipts. This is
    // read-only: it neither requires nor creates a new seller questionnaire.
    if ('saleDeclaration' in updates || 'inventoryUnitDeclaration' in updates) {
      const replay = await db.runTransaction(async tx => {
        await assertPrivateAccountSession(request,tx);
        const article = (await tx.get(db.collection('articles').doc(articleId))).data();
        if (!article) throw new HttpsError('not-found','Article introuvable.');
        if (article.sellerId !== uid) throw new HttpsError('permission-denied','Pas votre annonce.');
        if ('inventoryUnitDeclaration' in updates) {
          const receipt = await inventoryUnitReceipt(tx,articleId,article);
          const historicalHash = commercialRequestHash(updates,[...PUBLICATION_INPUT_FIELDS,'expectedSaleDeclarationContentHash',
            'isActive','inventoryUnitDeclaration','expectedInventoryUnitRevision']);
          if (receipt?.requestHash === historicalHash && receipt.previousRevision === updates.expectedInventoryUnitRevision)
            return {success:true,replayed:true,saleDeclarationView:articleSaleDeclarationView(articleId,article),
              inventoryUnitReceipt:receipt,inventoryUnitView:await inventoryUnitView(tx,articleId,article)};
        } else {
          // Both historical request projections are immutable. The native
          // receipt hash identifies its actual format; an optional metadata
          // flag must never be needed to recover that receipt.
          const historicalHashes = [PUBLICATION_V2_INPUT_FIELDS, PUBLICATION_INPUT_FIELDS].map(fields =>
            commercialRequestHash(updates,[...fields,'expectedSaleDeclarationContentHash','isActive']));
          if (!isListingContentVersion(article.saleDeclaration?.version) && qualifiedArticleSaleDeclaration(articleId,article) &&
              historicalHashes.includes(article.saleDeclaration.requestHash) && article.saleDeclaration.previousContentHash === updates.expectedSaleDeclarationContentHash)
            return {success:true,replayed:true,saleDeclarationView:articleSaleDeclarationView(articleId,article)};
        }
        return null;
      });
      if (replay) return replay;
    }
    const observesContent = 'expectedSaleDeclarationContentHash' in updates;
    if (observesContent && (typeof updates.expectedSaleDeclarationContentHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(updates.expectedSaleDeclarationContentHash)))
      throw new HttpsError('invalid-argument', 'La version observée de l’annonce est invalide.', { field: 'expectedSaleDeclarationContentHash' });
    const declarationRequestHash = commercialRequestHash(updates, [...PUBLICATION_V6_INPUT_FIELDS, 'expectedSaleDeclarationContentHash', 'isActive']);
    if (observesContent) {
      const replay = await db.runTransaction(async tx => {
        await assertPrivateAccountSession(request,tx);
        const article = (await tx.get(db.collection('articles').doc(articleId))).data();
        if (!article) throw new HttpsError('not-found', 'Article introuvable.');
        if (article.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre annonce.');
        const nativeRequestHash = article.saleDeclaration?.version === 'listing_content_v1'
          ? commercialRequestHash(updates,[...PUBLICATION_V5_INPUT_FIELDS,'expectedSaleDeclarationContentHash','isActive']) : declarationRequestHash;
        if (isListingContentVersion(article.saleDeclaration?.version) && article.saleDeclaration.requestHash === nativeRequestHash &&
            article.saleDeclaration.previousContentHash === updates.expectedSaleDeclarationContentHash) {
          assertArticleSaleDeclaration(articleId, article);
          return { success: true, replayed: true, saleDeclarationView: articleSaleDeclarationView(articleId,article) };
        }
        return null;
      });
      if (replay) return replay;
    }
    // Before brand/media work. Exact standalone removal remains a historical
    // operation; commercial edits must re-read admission again at final commit.
    const preflightArticle = Object.keys(updates).length === 1 && updates.isActive === false
      ? null : await db.runTransaction(async tx => {
        await assertPrivateAccountSession(request, tx);
        return assertArticleEditable(tx, articleId, uid, false);
      });
    if (preflightArticle) articleHygieneEdit(preflightArticle, updates, uid);
    if (preflightArticle) articleChildSafetyEdit(articleId, preflightArticle, updates, uid);

    // ── 3. Validate individual fields from `updates` ──
    const sanitized: Record<string, unknown> = {};
    if ('quantity' in updates) sanitized.quantity = 1;
    if ('stock' in updates) sanitized.stock = 1;
    // Marker only; the final transaction binds the declaration to its current
    // category, authenticated author and native commit-attempt date.
    if ('hygieneDeclaration' in updates) sanitized.hygieneDeclaration = updates.hygieneDeclaration;
    if ('childSafetyDeclaration' in updates) sanitized.childSafetyDeclaration = updates.childSafetyDeclaration;
    let promotedImageCount = 0;

    if ('brand' in updates) {
      if (updates.brand !== null && typeof updates.brand !== 'string')
        throw new HttpsError('invalid-argument', 'Marque invalide.', { field: 'brand' });
      const brandName = typeof updates.brand === 'string' ? stripHtml(updates.brand).substring(0,100) : '';
      sanitized.brand = brandName ? await resolveBrand(brandName) : FieldValue.delete();
    }

    // Title
    if ('title' in updates) {
      const title =
        typeof updates.title === 'string' ? stripHtml(updates.title).substring(0, 200) : '';
      if (title.length < 3) {
        throw new HttpsError(
          'invalid-argument',
          'Le titre doit contenir au moins 3 caractères',
        );
      }
      sanitized.title = title;
    }

    // Description
    if ('description' in updates) {
      if (typeof updates.description !== 'string') {
        throw new HttpsError('invalid-argument', 'Description invalide');
      }
      sanitized.description = stripHtml(updates.description).substring(0, 5000);
    }

    // Price
    if ('price' in updates) {
      if (!isValidArticlePrice(updates.price)) {
        throw new HttpsError(
          'invalid-argument',
          'Le prix doit être compris entre 0,01 $ et 10 000 $, avec au maximum deux décimales.',
          { field: 'price', reason: 'article_price_cents_required' },
        );
      }
      sanitized.price = updates.price;
    }

    // Condition
    const validConditions = [
      'neuf',
      'neuf sans étiquette',
      'très bon état',
      'bon état',
      'satisfaisant',
    ];
    if ('condition' in updates) {
      if (!validConditions.includes(updates.condition)) {
        throw new HttpsError('invalid-argument', 'Condition invalide');
      }
      sanitized.condition = updates.condition;
    }

    // CategoryIds
    if ('categoryIds' in updates) {
      const categoryIds = sanitizeCategoryIds(updates.categoryIds);
      if (!categoryIds) {
        throw new HttpsError('invalid-argument', 'Catégorie invalide');
      }
      sanitized.categoryIds = categoryIds;
    }

    // Category (string)
    if ('category' in updates) {
      if (typeof updates.category === 'string') {
        sanitized.category = sanitizeCategoryLabel(updates.category);
      }
    }

    // Images
    if ('images' in updates) {
      if (
        !Array.isArray(updates.images) ||
        updates.images.length === 0
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Au moins une image est requise',
        );
      }
      if (updates.images.length > 10) {
        throw new HttpsError(
          'invalid-argument',
          'Maximum 10 photos autorisées',
        );
      }
      for (const img of updates.images) {
        if (!img || typeof img.url !== 'string' || img.url.trim().length === 0) {
          throw new HttpsError(
            'invalid-argument',
            'Chaque image doit avoir une URL valide',
          );
        }
      }
      sanitized.images = updates.images.map(
        (img: { url: string; blurhash?: string }) => {
          const entry: { url: string; blurhash?: string } = {
            url: img.url.trim(),
          };
          if (img.blurhash && typeof img.blurhash === 'string') {
            entry.blurhash = img.blurhash;
          }
          return entry;
        },
      );
    }

    // Optional scalar fields
    // Size — only touch when the caller sent the key. Accept the ArticleSize
    // object { value, system } with an explicit US/EU system, a legacy plain
    // string (keeps the stored US/EU system at commit; defaults to EU only when
    // no valid stored system exists), or null (explicit erasure). An invalid
    // object system is rejected; an empty/malformed value otherwise stays
    // untouched, never written as undefined.
    if ('size' in updates) {
      if (updates.size !== null && typeof updates.size === 'object'
          && (!updates.size || !['US', 'EU'].includes(updates.size.system))) {
        throw new HttpsError('invalid-argument', 'Choisissez explicitement le système de taille US ou EU.', { field: 'size' });
      }
      const sanitizedSize = sanitizeArticleSize(updates.size);
      if (sanitizedSize !== undefined) {
        sanitized.size = sanitizedSize; // ArticleSize object or null (erasure)
      }
    }
    // `pattern`: legacy field, lecture seule, plus ecrit (P3-5). Updates that
    // carry a `pattern` key are intentionally ignored (the concept was removed).

    // Colors
    if ('colors' in updates && Array.isArray(updates.colors)) {
      sanitized.colors = updates.colors
        .filter((c: unknown) => typeof c === 'string')
        .slice(0, 20);
      sanitized.color = (sanitized.colors as string[])[0] || null;
    } else if ('color' in updates && typeof updates.color === 'string') {
      sanitized.color = updates.color.trim();
    }

    // Materials
    if ('materials' in updates && Array.isArray(updates.materials)) {
      sanitized.materials = updates.materials
        .filter((m: unknown) => typeof m === 'string')
        .slice(0, 20);
      sanitized.material = (sanitized.materials as string[])[0] || null;
    } else if ('material' in updates && typeof updates.material === 'string') {
      sanitized.material = updates.material.trim();
    }

    // Delivery options
    if ('isHandDelivery' in updates) {
      sanitized.isHandDelivery = updates.isHandDelivery === true;
    }
    if ('isShipping' in updates) {
      sanitized.isShipping = updates.isShipping === true;
    }

    // Package size
    const validPackageSizes = ['small', 'medium', 'large'];
    if (
      'packageSize' in updates &&
      typeof updates.packageSize === 'string' &&
      validPackageSizes.includes(updates.packageSize)
    ) {
      sanitized.packageSize = updates.packageSize;
    }

    // Neighborhoods — same shape validation as create (P2-8). An empty array is
    // a legitimate erasure (no meetup neighborhoods); a non-empty array with any
    // malformed entry is rejected. Erasure removes the fields entirely
    // (FieldValue.delete), mirroring how colors/materials clear (P3-15), rather
    // than leaving an empty array / null behind.
    if ('neighborhoods' in updates && Array.isArray(updates.neighborhoods)) {
      if (updates.neighborhoods.length === 0) {
        sanitized.neighborhoods = FieldValue.delete();
        sanitized.neighborhood = FieldValue.delete();
      } else {
        if (updates.neighborhoods.length > MAX_MEETUP_NEIGHBORHOODS) {
          throw new HttpsError('invalid-argument', 'Maximum 10 quartiers de rencontre');
        }
        const cleaned = updates.neighborhoods.map(sanitizeNeighborhood);
        if (cleaned.some((n: MeetupNeighborhood | null) => n === null)) {
          throw new HttpsError('invalid-argument', 'Quartier invalide');
        }
        sanitized.neighborhoods = cleaned;
        sanitized.neighborhood = cleaned[0];
      }
    }

    // isActive — la désactivation est la suppression de l'app. La
    // réactivation d'un article désactivé reste refusée plus bas.
    if ('isActive' in updates && typeof updates.isActive === 'boolean') {
      sanitized.isActive = updates.isActive;
    }

    // Check we have at least one field to update
    if (Object.keys(sanitized).length === 0) {
      throw new HttpsError('invalid-argument', 'Aucune modification valide à enregistrer');
    }

    // A locally valid commercial intent is bound to the owner's actual native
    // source before a refusal can be committed. No malformed/foreign request
    // creates a decision, and no media is promoted for a refused admission.
    const deactivationOnly = Object.keys(sanitized).length === 1 && sanitized.isActive === false;
    if (!deactivationOnly) {
      sanitized.quantity = 1;
      // An actual edit retires questionnaire fields from the live listing;
      // already captured orders, swaps and historical receipts are untouched.
      for (const field of ['saleUnit', 'counterfeitStatus', 'brandStatus', 'hasAlterations', 'alterationsDescription', 'hasKnownDefects', 'defectsDescription'])
        sanitized[field] = FieldValue.delete();
    }
    const editAdmission = async (tx: FirebaseFirestore.Transaction, snap: FirebaseFirestore.DocumentSnapshot) => {
      const existing = snap.data()!;
      if (existing.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre annonce.');
      if (deactivationOnly) return null;
      assertSingleArticleInput(existing);
      await planArticleInventoryForEdit(tx,uid,articleId,existing,declarationRequestHash);
      const proposed = { ...sanitized };
      // Match the commit's legacy size adapter exactly: a plain string keeps
      // the current native US/EU system instead of predicting an EU change.
      if (typeof updates.size === 'string' && sanitized.size && typeof sanitized.size === 'object' &&
          ['US', 'EU'].includes(existing.size?.system))
        proposed.size = { ...(sanitized.size as { value: string; system: string }), system: existing.size.system };
      Object.assign(proposed, articleHygieneEdit(existing, proposed, uid));
      Object.assign(proposed, articleChildSafetyEdit(articleId, existing, proposed, uid));
      const resulting = mergeSaleDeclarationContent(existing, proposed);
      const previousContentHash = saleDeclarationContentHash(articleId, existing);
      if (observesContent && previousContentHash !== updates.expectedSaleDeclarationContentHash) throw new HttpsError('aborted',
        'Le contenu de l’annonce a changé. Relisez-le avant de modifier.', { reason: 'article_sale_declaration_observation_stale' });
      const contentReceipt = recordArticleListingContent(articleId,resulting,uid,declarationRequestHash,previousContentHash);
      assertArticleSaleDeclaration(articleId,{...resulting,saleDeclaration:contentReceipt});
      if ('isHandDelivery' in sanitized || 'isShipping' in sanitized) {
        const hand = 'isHandDelivery' in sanitized ? sanitized.isHandDelivery === true : existing.isHandDelivery === true;
        const shipping = 'isShipping' in sanitized ? sanitized.isShipping === true : existing.isShipping === true;
        if (!hand && !shipping) throw new HttpsError('invalid-argument', 'Au moins une option de livraison requise');
        if (shipping && !hand && !canOfferShipping()) throw new HttpsError('failed-precondition',
          'La livraison est temporairement indisponible : proposez la remise en main propre.');
      }
      return recordOwnAdmissionRefusal(tx, { ownerId: uid, operation: 'updateArticle', scope: 'sell', sourceContext: {
        kind: 'article_edit', articleId, articleRevision: soldArticleRevision(articleId, uid, snap), inputHash: declarationRequestHash } });
    };
    const preflightRefusal = await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const snap = await tx.get(db.collection('articles').doc(articleId));
      if (!snap.exists) throw new HttpsError('not-found', 'Article introuvable.');
      if (snap.data()!.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre annonce.');
      if (deactivationOnly) return null;
      await assertArticleEditable(tx, articleId, uid, false);
      const refusal = await editAdmission(tx, snap);
      if (!refusal) await assertOwnPublicationEligibility(await readEligibilityEvidence(tx, uid), tx, uid);
      return refusal;
    });
    if (preflightRefusal) return throwRecordedAdmissionRefusal(preflightRefusal, () => assertPrivateAccountSession(request));
    if (Array.isArray(sanitized.images)) {
      const prepared = sanitized.images as { url: string; blurhash?: string }[];
      sanitized.images = await promoteArticleImages(prepared, uid, articleId, true);
      promotedImageCount = (sanitized.images as { url: string }[]).filter((image, index) => image.url !== prepared[index]?.url).length;
    }

    // ── 5. Transaction: ownership + sold/active check + price drop + write ──
    const articleRef = db.collection('articles').doc(articleId);
    // Storage paths of the images this edit removes (last attempt wins).
    let removedImagePaths: string[] = [];

    let editResult: RecordedAdmissionRefusal | null;
    try { editResult = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await assertPrivateAccountSession(request, tx);
      const snap = await tx.get(articleRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Article introuvable');
      }

      const existing = snap.data()!;
      if (existing.sellerId !== uid) throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
      if (articlePrivacyWithdrawn(existing)) throw new HttpsError('failed-precondition', 'Annonce retirée pour confidentialité.');
      await assertNoLiveArticleTransaction(tx, articleId, existing);

      // Charge de CET essai. Firestore rejoue le callback quand la transaction
      // entre en contention : muter `sanitized` ici faisait hériter un essai
      // du suivi de baisse calculé par le précédent, sur un prix périmé.
      const payload: Record<string, unknown> = { ...sanitized };
      // An older editor can submit only a size value. Keep an existing valid
      // system instead of turning a stored US size into EU by the legacy default.
      if (typeof updates.size === 'string' && sanitized.size && typeof sanitized.size === 'object'
          && ['US', 'EU'].includes(existing.size?.system)) {
        payload.size = { ...(sanitized.size as { value: string; system: string }), system: existing.size.system };
      }

      // Ownership check
      if (existing.sellerId !== uid) {
        throw new HttpsError('permission-denied', 'Cet article ne vous appartient pas');
      }

      // La désactivation SEULE — le « Supprimer » de l'app — reste permise
      // sur un article vendu ou déjà désactivé. Le menu la proposait sur un
      // article vendu et le serveur la refusait toujours ; une seconde
      // suppression affichait une erreur alors que la première avait réussi.
      const isDeactivationOnly =
        Object.keys(sanitized).length === 1 && sanitized.isActive === false;
      if (!isDeactivationOnly) {
        // Requalify all source guards before recording the final-attempt refusal.
        await assertArticleEditable(tx, articleId, uid, false);
        const refusal = await editAdmission(tx, snap);
        if (refusal) return refusal;
        await assertOwnPublicationEligibility(await readEligibilityEvidence(tx, uid), tx, uid);
      }
      const childPreparation = isChildSafetyPreparationEditable(articleId, existing);
      if (isDeactivationOnly && childPreparation) payload.childSafetyPreparation = { ...existing.childSafetyPreparation, state: 'withdrawn', withdrawnAt: FieldValue.serverTimestamp() };
      if (!isDeactivationOnly && !childPreparation) assertArticleNotModerationRestricted(existing);
      if (!isDeactivationOnly) Object.assign(payload, articleHygieneEdit(existing, sanitized, uid));
      if (!isDeactivationOnly) Object.assign(payload, articleChildSafetyEdit(articleId, existing, payload, uid));
      // Repeat against this transaction attempt, never the earlier snapshot:
      // contention may have changed the description while media was prepared.

      // Block editing sold articles
      if (existing.isSold === true && !isDeactivationOnly) {
        throw new HttpsError(
          'failed-precondition',
          'Impossible de modifier un article vendu',
        );
      }

      // Block editing deactivated articles (task #14)
      if (existing.isActive === false && !isDeactivationOnly && !childPreparation) {
        throw new HttpsError(
          'failed-precondition',
          'Impossible de modifier un article retiré de la vente',
        );
      }

      // Canonical object paths, not access tokens/query parameters. Changing a
      // download URL cannot turn an object still listed into a removed photo.
      removedImagePaths = [];
      const retiredMarkers: Array<{ ref: FirebaseFirestore.DocumentReference; path: string }> = [];
      if (Array.isArray(sanitized.images)) {
        if (Array.isArray(existing.images) && existing.images.length > 10) throw new HttpsError('failed-precondition',
          'Les anciennes photos de cette annonce doivent être examinées avant leur remplacement.', { reason: 'article_media_history_review_required' });
        const bucketName = storage.bucket().name;
        const kept = new Set((sanitized.images as { url: string }[]).map(img => storageObjectPath(img.url, bucketName))
          .filter((path): path is string => path !== null));
        for (const img of Array.isArray(existing.images) ? existing.images : []) {
          const url = typeof img === 'string' ? img : img?.url;
          if (typeof url !== 'string') continue;
          const path = storageObjectPath(url, bucketName);
          if (path && !kept.has(path)) removedImagePaths.push(path);
        }
        removedImagePaths = [...new Set(removedImagePaths)];
        // All reads precede the retirement + article write. Reading a missing
        // marker also contends with another edit which retires that same path.
        for (const path of kept) if ((await tx.get(retiredArticleMediaRef(articleId, path))).exists) rejectRetiredArticleMedia();
        for (const path of removedImagePaths) {
          if (!path.startsWith(`drafts/${uid}/`) && !path.startsWith(`articles/${articleId}/`)) continue;
          const ref = retiredArticleMediaRef(articleId, path);
          if (!(await tx.get(ref)).exists) retiredMarkers.push({ ref, path });
        }
      }

      // Une NOUVELLE image doit venir du bucket du projet. Celles que
      // l'article porte déjà passent telles quelles : des articles anciens
      // ont des URL d'une autre forme, et l'édition les renvoie intactes.
      if (Array.isArray(sanitized.images)) {
        const current = new Set(
          (Array.isArray(existing.images) ? existing.images : [])
            .map((img: { url?: unknown }) => img?.url)
            .filter((u: unknown): u is string => typeof u === 'string'),
        );
        for (const img of sanitized.images as { url: string }[]) {
          if (!current.has(img.url) && !isOwnBucketImageUrl(img.url)) {
            throw new HttpsError('invalid-argument', 'Image non hébergée par Seconde');
          }
        }
      }

      // Delivery options (P3-7): the resulting article must keep at least one
      // delivery mode. We only need to re-check when the caller actually touched
      // a delivery flag; the merged state (sanitized overrides existing) must
      // not leave both modes off. Symmetric to the createArticle guard.
      if ('isHandDelivery' in sanitized || 'isShipping' in sanitized) {
        const resultHandDelivery =
          'isHandDelivery' in sanitized
            ? sanitized.isHandDelivery === true
            : existing.isHandDelivery === true;
        const resultShipping =
          'isShipping' in sanitized
            ? sanitized.isShipping === true
            : existing.isShipping === true;
        if (!resultHandDelivery && !resultShipping) {
          throw new HttpsError(
            'invalid-argument',
            'Au moins une option de livraison requise',
          );
        }
        // Même garde qu'à la publication : un article existant ne bascule pas
        // en « livraison seule » tant que le rail est fermé.
        if (resultShipping && !resultHandDelivery && !canOfferShipping()) {
          throw new HttpsError(
            'failed-precondition',
            'La livraison est temporairement indisponible : proposez la remise en main propre.',
          );
        }
      }

      // Price drop tracking
      if (typeof payload.price === 'number') {
        const newPrice = payload.price;
        const oldPrice = existing.price;
        if (newPrice > oldPrice) {
          // Toute HAUSSE annule la baisse en cours. La garde ne regardait que
          // le prix d'origine : une hausse restée en dessous laissait l'article
          // dans le rail « Baisses de prix » alors que son prix montait.
          // (delete() est sans effet sur un champ absent.)
          payload.originalPrice = FieldValue.delete();
          payload.priceDropPercent = FieldValue.delete();
          payload.lastPriceDropAt = FieldValue.delete();
        } else if (newPrice <= oldPrice * (1 - MIN_PRICE_DROP_RATIO)) {
          // Une vraie baisse : enregistrée (ou rafraîchie) contre la référence.
          const originalPrice =
            typeof existing.originalPrice === 'number' ? existing.originalPrice : oldPrice;
          payload.originalPrice = originalPrice;
          payload.priceDropPercent = Math.round(
            ((originalPrice - newPrice) / originalPrice) * 100,
          );
          payload.lastPriceDropAt = FieldValue.serverTimestamp();
        } else if (typeof existing.originalPrice === 'number' && newPrice < oldPrice) {
          // Petite baisse sous une baisse déjà affichée : le pourcentage suit
          // le prix, mais l'article ne remonte pas en tête du rail.
          payload.priceDropPercent = Math.round(
            ((existing.originalPrice - newPrice) / existing.originalPrice) * 100,
          );
        }
      }

      // Always set updatedAt
      if (!isDeactivationOnly) {
        assertSingleArticleInput(existing);
        const resulting = mergeSaleDeclarationContent(existing, payload);
        const previousContentHash = saleDeclarationContentHash(articleId, existing);
        if (observesContent && previousContentHash !== updates.expectedSaleDeclarationContentHash)
          throw new HttpsError('aborted', 'Le contenu de l’annonce a changé. Relisez-le avant de modifier.',
            { reason: 'article_sale_declaration_observation_stale', action: 'reviewArticleSaleDeclaration' });
        payload.saleDeclaration = recordArticleListingContent(articleId,resulting,uid,declarationRequestHash,previousContentHash);
        assertArticleSaleDeclaration(articleId, { ...resulting, saleDeclaration: payload.saleDeclaration });
      }
      const inventory = !isDeactivationOnly ? await planArticleInventoryForEdit(tx,uid,articleId,existing,declarationRequestHash) : null;
      if(inventory)Object.assign(payload,inventory.articleFields);
      payload.updatedAt = FieldValue.serverTimestamp();

      // Never overwrite/delete a retirement witness. The source becomes
      // non-reintroducible in the same commit that removes its listing link.
      for (const marker of retiredMarkers) { await recoveryCommit({refs: [(marker.ref).path]}); tx.create(marker.ref, { schemaVersion: 1, articleId, ownerId: uid,
        sourcePath: marker.path, state: 'retired', retiredAt: FieldValue.serverTimestamp() }); }
      inventory?.commit();await recoveryCommit({refs: [(articleRef).path]});
    tx.update(articleRef, Object.prototype.hasOwnProperty.call(existing,'localCatalogueWitness')||['isActive','isSold','activeTransactionId','inventoryUnit','inventoryAvailability'].some(key=>Object.prototype.hasOwnProperty.call(payload,key)) ? await financialRecoverySourceFields('inventory_article',articleRef,existing,payload) : payload);
      return null;
    }); } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if ('images' in sanitized) logger.warn('updateArticle: prepared media edit was not committed', { articleId, sellerId: uid,
        preparedImageCount: (sanitized.images as unknown[]).length, promotedImageCount, cleanupPerformed: false,
        reasonCode: error instanceof HttpsError ? error.code : 'internal' });
      throw error;
    }
    if (editResult) return throwRecordedAdmissionRefusal(editResult, () => assertPrivateAccountSession(request));

    // Removing a listing link does not end evidentiary or privacy retention.
    // Keep report preservation, but no physical erasure is authorized without
    // a qualified cross-service disposal policy. A Firestore pre-read followed
    // by a Storage DELETE would not make this operation atomic.
    const ownedPrefixes = [`drafts/${uid}/`, `articles/${articleId}/`];
    const ownedRemovedPaths = removedImagePaths.filter(path => ownedPrefixes.some(prefix => path.startsWith(prefix)));
    await preserveArticleReportEvidenceBeforeDeletion(articleId, ownedRemovedPaths);
    if (ownedRemovedPaths.length) logger.info('updateArticle: removed media retained', {
      articleId, sellerId: uid, removedImageCount: ownedRemovedPaths.length,
      physicalDeletionPerformed: false, reason: 'cross_service_retention_authority_unqualified',
    });

    logger.info('Article updated via callable', {
      articleId,
      sellerId: uid,
      updatedFields: Object.keys(sanitized).filter((k) => k !== 'updatedAt'),
    });

    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const article = (await tx.get(articleRef)).data();
      if (!article || article.sellerId !== uid) throw new HttpsError('unavailable', 'Le reçu de modification doit être relu.');
      return { success: true, replayed: false, saleDeclarationView: articleSaleDeclarationView(articleId, article),
        inventoryUnitReceipt:await inventoryUnitReceipt(tx,articleId,article),inventoryUnitView:await inventoryUnitView(tx,articleId,article) };
    });
  })),
);

/**
 * Mark saved search as viewed (resets newItemsCount)
 */
export const markSavedSearchViewed = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => withFinancialRecoveryScope({operation: "callable/products.markSavedSearchViewed"}, async () => withPrivateAccountSession(request, async () => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { searchId } = request.data;
  if (!searchId) {
    throw new HttpsError('invalid-argument', 'Search ID is required');
  }

  const userId = request.auth.uid;

  try {
    const searchRef = db
      .collection('users')
      .doc(userId)
      .collection('savedSearches')
      .doc(searchId);
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      await assertPrivateAccountSession(request, tx);
      const saved = await tx.get(searchRef);
      if (!saved.exists) throw new Error('Saved search not found');
      await assertPrivateAccountSession(request, tx);
      await recoveryCommit({refs: [(searchRef).path]});
    tx.update(searchRef, {
        newItemsCount: 0,
      });
    });

    return { success: true };
  } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    if (error instanceof HttpsError) throw error;
    logger.error('Error marking saved search as viewed:', error);
    throw new HttpsError('internal', 'Failed to update saved search');
  }
})));
