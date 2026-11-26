/**
 * Article Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 *
 * Handles search_index cleanup when an article is soft-deleted
 * (isActive transitions from true to false).
 *
 * Note: The embeddings trigger (embeddings.ts) already handles
 * deactivating embeddings when isActive changes. This trigger
 * focuses on the search_index collection.
 */
import { createHash } from 'node:crypto';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { ARTICLE_BLOCKING_TX_STATUSES } from '../shared/article';
import { articlePrivacyWithdrawn } from '../utils/publicProfile';
import {isDeepStrictEqual} from 'node:util';

const FAVORITES_BATCH = 20;

function inventoryState(article:FirebaseFirestore.DocumentData|undefined):'engaged'|'consumed'|'available'|null{
  const value=article?.inventoryAvailability;
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='protocol,state'&&
    value.protocol==='inventory_article_availability_v1'&&['engaged','consumed','available'].includes(value.state)?value.state:null;
}
function sameStockSource(left:FirebaseFirestore.DocumentData,right:FirebaseFirestore.DocumentData){
  return ['sellerId','isSold','inventoryUnit','inventoryAvailability','activeTransactionId'].every(key=>isDeepStrictEqual(left[key],right[key]));
}
/** A public projection is display data, never enough to destroy a preference.
 * Join its actual unit and native agreement under the same transaction lock. */
async function nativeStockState(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData):Promise<'engaged'|'consumed'|null>{
  const state=inventoryState(article);if(article.isSold!==true||!['engaged','consumed'].includes(state??''))return null;
  const {inventoryUnitView}=await import('../utils/inventoryUnit');
  const view=await inventoryUnitView(tx,articleId,article);
  if(view.qualification!=='native_current'||view.availability!==state||!view.inventoryUnitId)return null;
  const unit=(await tx.get(db.collection('inventory_units').doc(view.inventoryUnitId))).data(),e=unit?.engagement;
  if(!e||!view.memberArticleIds.includes(e.sourceArticleId))return null;
  if(e.kind==='manual_sale')return state==='consumed'?'consumed':null;
  const parent=(await tx.get(db.collection(e.kind==='purchase'?'transactions':'swaps').doc(e.id))).data();
  if(!parent)return null;
  if(e.kind==='purchase'){
    if(parent.sellerId!==article.sellerId||parent.articleId!==e.sourceArticleId||article.activeTransactionId!==e.id)return null;
    return state==='consumed'?['meetup_completed','completed'].includes(parent.status)?'consumed':null:
      ARTICLE_BLOCKING_TX_STATUSES.includes(parent.status)?'engaged':null;
  }
  if(e.kind!=='swap'||![parent.initiatorId,parent.receiverId].includes(article.sellerId)||!parent.articleIds?.includes(e.sourceArticleId))return null;
  return state==='consumed'?parent.status==='completed'?'consumed':null:
    ['accepted','photos_pending','shipping','disputed'].includes(parent.status)?'engaged':null;
}

/**
 * Retire l'article des favoris de tous, par lots : un article très aimé
 * lançait autant d'écritures simultanées que de favoris. Chaque document est
 * traité à part ; un échec n'interrompt pas les autres.
 */
async function removeFromAllFavorites(articleId: string, source: string,expectedStock?:FirebaseFirestore.DocumentData): Promise<void> {
  try {
    const favSnap = await db.collection('favorites')
      .where('articleIds', 'array-contains', articleId)
      .get();

    for (let i = 0; i < favSnap.docs.length; i += FAVORITES_BATCH) {
      await Promise.all(
        favSnap.docs.slice(i, i + FAVORITES_BATCH).map(async (favDoc) => {
          try {
            await db.runTransaction(async tx => {
              const article = (await tx.get(db.collection('articles').doc(articleId))).data();
              const favorite = (await tx.get(favDoc.ref)).data();
              if (!article || !Array.isArray(favorite?.articleIds)||!favorite.articleIds.includes(articleId)) return;
              if (source === 'onArticleSoftDeleted' && article.isActive !== false) return;
              if (source === 'onArticleSold') {
                if(!expectedStock||!sameStockSource(expectedStock,article)||await nativeStockState(tx,articleId,article)!=='consumed')return;
                const reservations = await tx.get(db.collection('transactions').where('articleId', '==', articleId));
                if (reservations.docs.some(d => !['cancelled', 'refunded', 'completed', 'meetup_completed'].includes(d.data().status))) return;
              }
              tx.update(favDoc.ref, { articleIds: favorite.articleIds.filter((id: unknown) => id !== articleId), updatedAt: FieldValue.serverTimestamp() });
            });
          } catch (error) {
            logger.error(`[${source}] Failed to remove article from favorites`, {
              articleId,
              userId: favDoc.id,
              error: error instanceof Error ? error.message : error,
            });
          }
        })
      );
    }
    if (!favSnap.empty) {
      logger.info(`[${source}] Removed article from ${favSnap.size} favorites docs`, { articleId });
    }
  } catch (error) {
    logger.error(`[${source}] Failed to query favorites`, {
      articleId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

/** A delayed trigger must not undo acceptance or a later reactivation. */
async function expirePendingArticleProposals(articleId: string, reason: 'sold' | 'inactive', eventId: string, systemMessage?: string) {
  const articleRef = db.collection('articles').doc(articleId);
  const chats = await db.collection('chats').where('articleId', '==', articleId).get();
  let total = 0;
  for (const chat of chats.docs) {
    const candidates = await db.collection('messages').where('chatId', '==', chat.id)
      .where('type', '==', 'offer').where('offer.status', '==', 'pending').get();
    const noticeId = `article_status_${createHash('sha256').update(JSON.stringify([eventId, chat.id, reason])).digest('hex')}`;
    const noticeRef = db.collection('messages').doc(noticeId);
    for (const candidate of candidates.docs) {
      const expired = await db.runTransaction(async (tx) => {
        const liveArticle = (await tx.get(articleRef)).data();
        const current = (await tx.get(candidate.ref)).data();
        if (!liveArticle || (reason === 'sold' ? liveArticle.isSold !== true : liveArticle.isActive !== false) ||
            current?.type !== 'offer' || current.chatId !== chat.id || current.offer?.status !== 'pending') return false;
        const liveChat = (await tx.get(chat.ref)).data();
        const notice = await tx.get(noticeRef);
        tx.update(candidate.ref, { 'offer.status': 'expired', 'offer.expiredReason': `article_${reason}`, 'offer.expiredAt': FieldValue.serverTimestamp() });
        if (!notice.exists && Array.isArray(liveChat?.participants)) {
          tx.set(noticeRef, { chatId: chat.id, senderId: 'system', receiverId: 'system', type: 'system',
            content: systemMessage ?? (reason === 'sold' ? 'Cet article a été vendu. Les propositions en attente ont expiré.' : 'Cet article a été retiré de la vente. Les propositions en attente ont expiré.'),
            participants: liveChat.participants, timestamp: FieldValue.serverTimestamp(), status: 'sent', isRead: true });
        }
        return true;
      });
      if (expired) total++;
    }
  }
  return total;
}

/**
 * When an article's isActive changes from true to false (soft-delete),
 * remove its corresponding search_index entry so it no longer appears
 * in search results.
 *
 * When isActive changes from false to true (reactivation), we do NOT
 * recreate the search_index entry here — that is the responsibility of
 * the products.ts trigger on the `products` collection, or a manual
 * reindex.
 */
export const onArticleSoftDeleted = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // Only act when isActive transitions from true to false
    if (before.isActive === true && after.isActive === false) {
      // 1. Remove search_index entry
      try {
        const siRef = db.collection('search_index').doc(articleId);
        await db.runTransaction(async tx => {
          const article = (await tx.get(db.collection('articles').doc(articleId))).data();
          const index = await tx.get(siRef);
          if (article?.isActive === false && index.exists) tx.delete(siRef);
        });
      } catch (error) {
        logger.error('[onArticleSoftDeleted] Failed to remove search_index', {
          articleId,
          error: error instanceof Error ? error.message : error,
        });
      }

      // 2. Un article retiré ne revient pas en vente : il quitte les favoris,
      //    comme à la vente conclue, au lieu d'occuper un emplacement de chacun.
      await removeFromAllFavorites(articleId, 'onArticleSoftDeleted');

      // 3. Expire pending offers in related chats (same logic as onArticleSold)
      try {
        await expirePendingArticleProposals(articleId, 'inactive', event.id ?? `inactive_${articleId}`);
      } catch (error) {
        logger.error('[onArticleSoftDeleted] Failed to expire pending offers', {
          articleId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }
);

/**
 * When an article is sold (isSold transitions from false to true),
 * expire all pending offers in related chats and notify participants
 * via a system message.
 *
 * This prevents buyers from seeing stale "pending" offers on articles
 * that are no longer available.
 */
export const onArticleSold = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const becameSold=before.isSold!==true&&after.isSold===true,
      becameConsumed=inventoryState(before)!=='consumed'&&inventoryState(after)==='consumed';
    if(!becameSold&&!becameConsumed)return;

    const articleId = event.params.articleId;

    // `isSold` is also the LOCK of a reservation: accepting a meetup offer sets
    // it together with a `meetup_pending` transaction, for a meetup that may
    // still fail. While a transaction is in progress nothing irreversible
    // happens: favorites are kept, and conversations read « réservé », not
    // « vendu ». When in doubt (query failure), nothing is destroyed either.
    let state:'engaged'|'consumed'|null=null;
    try {
      state=await db.runTransaction(async tx=>{
        const article=(await tx.get(db.collection('articles').doc(articleId))).data();
        return article&&sameStockSource(after,article)?nativeStockState(tx,articleId,article):null;
      });
    } catch (error) {
      logger.error('[onArticleSold] Native stock unavailable; preserving preferences', {
        articleId,
        error: error instanceof Error ? error.message : error,
      });
    }

    // Missing/incoherent projections remain unknown. A historical isSold
    // boolean or link cannot authorize destructive preference cleanup.
    if(!state)return;
    if (state==='consumed') {
      // Remove the sold article from every favoriter's list so it stops counting
      // against their cap and disappears from the Favoris screen immediately.
      // The onArticleFavorited trigger then decrements the (clamped) counters
      // for each removal.
      await removeFromAllFavorites(articleId, 'onArticleSold',after);
    }

    if(becameSold)await expirePendingArticleProposals(
      articleId, 'sold', event.id ?? `sold_${articleId}`,
      state==='engaged'
        ? 'Cet article est réservé. Les offres en attente ont été annulées.'
        : 'Cet article a été vendu. Les offres en attente ont été annulées.'
    );
  }
);

/**
 * When an article's title, first image URL, or price changes,
 * propagate the new values to all chats referencing that article.
 *
 * Denormalized fields in chats:
 *   articleTitle  <- article.title
 *   articleImage  <- article.images[0].url
 *   articlePrice  <- article.price
 *
 * Uses batch writes (max 500 ops per batch).
 */
export const onArticleInfoUpdated = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;
    // Historical private conversations retain their original text. Their old
    // media URL is replaced in presentation by the authenticated evidence API.
    if (articlePrivacyWithdrawn(after)) return;

    // Detect changes in the three denormalized fields
    const titleChanged = before.title !== after.title;
    const priceChanged = before.price !== after.price;

    const beforeImage =
      Array.isArray(before.images) && before.images.length > 0
        ? before.images[0].url
        : null;
    const afterImage =
      Array.isArray(after.images) && after.images.length > 0
        ? after.images[0].url
        : null;
    const imageChanged = beforeImage !== afterImage;

    if (!titleChanged && !priceChanged && !imageChanged) return;

    // Build the update payload (only changed fields).
    //
    // PAS de `updatedAt` : la liste des conversations est triée dessus
    // (`listenToUserChats`). Le pousser ici remontait en tête TOUTES les
    // conversations liées à l'article dès que le vendeur en changeait le prix,
    // le titre ou la photo — chez les deux parties, sans qu'aucun message n'ait
    // été envoyé. L'acheteur voyait une conversation « remonter », l'ouvrait, et
    // n'y trouvait rien de neuf. `updatedAt` doit dater l'activité du fil, pas la
    // propagation d'un instantané.
    const chatUpdate: Record<string, unknown> = {};
    if (titleChanged) chatUpdate.articleTitle = after.title || null;
    if (imageChanged) chatUpdate.articleImage = afterImage;
    if (priceChanged) chatUpdate.articlePrice = after.price ?? null;

    logger.info('[onArticleInfoUpdated] Propagating article changes to chats', {
      articleId,
      titleChanged,
      imageChanged,
      priceChanged,
    });

    // Find all chats related to this article
    const chatsSnap = await db.collection('chats')
      .where('articleId', '==', articleId)
      .get();

    if (chatsSnap.empty) {
      logger.info('[onArticleInfoUpdated] No chats found for article', { articleId });
      return;
    }

    let chatsUpdated = 0;

    for (const chatDoc of chatsSnap.docs) {
      await db.runTransaction(async tx => {
        const current = (await tx.get(db.collection('articles').doc(articleId))).data();
        const chat = (await tx.get(chatDoc.ref)).data();
        if (!current || articlePrivacyWithdrawn(current) || !chat || chat.articleId !== articleId) return;
        const currentUpdate: Record<string, unknown> = {};
        if ('articleTitle' in chatUpdate) currentUpdate.articleTitle = current.title || null;
        if ('articleImage' in chatUpdate) currentUpdate.articleImage = current.images?.[0]?.url ?? null;
        if ('articlePrice' in chatUpdate) currentUpdate.articlePrice = current.price ?? null;
        tx.update(chatDoc.ref, currentUpdate);
        chatsUpdated++;
      });
    }

    logger.info('[onArticleInfoUpdated] Propagation complete', {
      articleId,
      chatsUpdated,
    });
  }
);
