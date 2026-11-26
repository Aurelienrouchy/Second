/**
 * Article Firestore triggers (search index + user stats)
 * Firebase Functions v7 - using onDocumentWritten
 */
import { isDeepStrictEqual } from 'node:util';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import {
  generateSearchKeywords,
  calculatePopularityScore,
} from '../utils/search';
import { debounceUpdate } from '../utils/debounce';
import { articlePrivacyWithdrawn } from '../utils/publicProfile';

/** Compteurs dont le changement SEUL ne justifie ni réindexation immédiate ni recalcul. */
const METRIC_FIELDS = new Set([
  'views',
  'likes',
  'likedBy',
  'favoritesCount',
  'popularityScore',
  'updatedAt',
]);

/** Vrai quand, d'un état à l'autre, seuls des compteurs ont bougé. */
function onlyMetricsChanged(
  before: FirebaseFirestore.DocumentData | undefined,
  after: FirebaseFirestore.DocumentData
): boolean {
  if (!before) return false;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (!METRIC_FIELDS.has(key) && !isDeepStrictEqual(before[key], after[key])) return false;
  }
  return true;
}

/** Champs de l'index dont le seul changement ne justifie pas une écriture. */
const VOLATILE_INDEX_FIELDS = new Set(['views', 'likes', 'popularityScore', 'lastIndexed']);

function stableIndexFields(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!VOLATILE_INDEX_FIELDS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Document d'index d'un article. Extrait du trigger pour qu'on puisse
 * construire aussi celui de l'état PRÉCÉDENT et comparer les deux.
 */
function buildSearchIndexPayload(
  articleId: string,
  articleData: FirebaseFirestore.DocumentData
): Record<string, unknown> {
  // Normalize array fields (support both singular and array formats)
  const asList = (plural: unknown, singular: unknown): string[] => {
    if (Array.isArray(plural)) return plural;
    if (singular) return [singular as string];
    return [];
  };

  const brands = asList(articleData.brands, articleData.brand);
  const colors = asList(articleData.colors, articleData.color);
  const materials = asList(articleData.materials, articleData.material);

  // La description n'est pas relue depuis l'index (la carte ne l'affiche pas),
  // mais ses jetons doivent rester dans `keywords` : la recherche porte dessus.
  const brandsText = brands.join(' ');
  const searchText = `${articleData.title} ${articleData.description} ${brandsText} ${articleData.category || ''}`;

  return {
    articleId,
    title: articleData.title,
    keywords: generateSearchKeywords(searchText),

    // Filterable fields
    category: articleData.category,
    // Hierarchical category IDs — mirrored so the search_index path can
    // filter by category when a text term is present (C1).
    categoryIds: articleData.categoryIds || [],
    subcategory: articleData.subcategory || null,
    brands: brands,
    colors: colors,
    materials: materials,
    brand: brands[0] || null,
    color: colors[0] || null,
    material: materials[0] || null,
    // ArticleSize is an object { value, system }; mirror verbatim (or null).
    size: articleData.size ?? null,
    condition: articleData.condition,
    price: articleData.price,

    // Cached display data
    sellerId: articleData.sellerId,
    sellerName: articleData.sellerName,
    sellerRating: articleData.sellerRating || null,
    firstImage: articleData.images?.[0]?.url || null,

    // Status
    isActive: articleData.isActive,
    isSold: articleData.isSold,
    isPromoted: articleData.isPromoted || false,

    // Metrics for ranking
    views: articleData.views || 0,
    likes: articleData.likes || 0,
    createdAt: articleData.createdAt,

    // Search optimization
    popularityScore: calculatePopularityScore(
      articleData.views || 0,
      articleData.likes || 0,
      articleData.createdAt?.toDate?.() ?? new Date()
    ),
    lastIndexed: FieldValue.serverTimestamp(),
  };
}

/**
 * Update search index when article is created/updated/deleted
 *
 * TODO: the client currently searches via articlesService.ts client-side filtering.
 * Migrate to search_index queries for better performance.
 */
export const updateSearchIndex = onDocumentWritten(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;

    try {
      // If document was deleted, remove from search index
      if (!event.data?.after?.exists) {
        await db.collection('search_index').doc(articleId).delete();
        logger.info(`Removed article ${articleId} from search index`);
        return;
      }

      const articleData = event.data.after.data();
      if (!articleData) return;

      // Only index active, non-rejected articles.
      // IMPORTANT: legacy articles predate the `moderationStatus` field, so an
      // ABSENT value must be treated as approved (legacy). We only de-index on
      // an EXPLICIT moderation block ('pending' | 'rejected'); never on absence,
      // otherwise the pre-existing catalogue would be wiped from search at the
      // next write (R3).
      const moderationStatus = articleData.moderationStatus;
      const isModerationBlocked =
        moderationStatus === 'pending' || moderationStatus === 'rejected';
      if (!articleData.isActive || isModerationBlocked) {
        await db.collection('search_index').doc(articleId).delete();
        return;
      }

      // Sold articles must leave the search index (P3-14): drop them server-side
      // instead of relying on 100% client-side masking of `isSold` results.
      if (articleData.isSold === true) {
        await db.collection('search_index').doc(articleId).delete();
        return;
      }

      const payload = buildSearchIndexPayload(articleId, articleData);
      const isCreation = !event.data.before?.exists;
      const before = event.data.before?.exists ? event.data.before.data() : undefined;

      // On compare l'index que produirait l'état précédent à celui de l'état
      // courant : changer sa photo de profil réécrit tous les articles du
      // vendeur, et réécrivait autant de documents d'index, alors que
      // `sellerImage` n'y figure même pas.
      const indexedChanged =
        isCreation ||
        !before ||
        !isDeepStrictEqual(
          stableIndexFields(buildSearchIndexPayload(articleId, before)),
          stableIndexFields(payload)
        );

      // Seuls les compteurs passent par le debounce, perdable : sur Cloud
      // Run l'instance peut être gelée dès le retour du handler. Tout autre
      // changement — création, remise en vente, prix, titre, photo — est
      // écrit tout de suite (P1-7).
      const metricsChanged =
        !!before &&
        (before.views !== articleData.views || before.likes !== articleData.likes);

      const writeIndex = async () => {
        await db.runTransaction(async tx => {
          const current = (await tx.get(db.collection('articles').doc(articleId))).data();
          const ref = db.collection('search_index').doc(articleId);
          if (!current || articlePrivacyWithdrawn(current) || !current.isActive || current.isSold === true
              || ['pending', 'rejected'].includes(current.moderationStatus)) {
            tx.delete(ref); return;
          }
          tx.set(ref, buildSearchIndexPayload(articleId, current));
        });
      };

      if (indexedChanged) {
        await writeIndex();
        logger.info(`Indexed article ${articleId}`);
      } else if (metricsChanged) {
        debounceUpdate(`search_index_${articleId}`, async () => {
          await writeIndex();
          logger.info(`Updated search index for article ${articleId}`);
        });
      }
    } catch (error) {
      logger.error(`Error updating search index for article ${articleId}`, { error });
    }
  }
);

/**
 * Maintain `shops/{shopId}.articlesCount` (boutiques-admin P1-2).
 *
 * No writer existed for this counter — the shop read path
 * (`shopService.getShopArticles`) lists articles where
 * `shopId == X AND isActive == true AND isSold == false`, and the UI gates the
 * shop display on `articlesCount > 0`. We mirror that exact predicate: an
 * article contributes +1 to its shop's count iff it has a `shopId`, is active,
 * and is not sold.
 *
 * The trigger applies the DELTA between the before/after contributions per
 * shop, so it is correct across create, delete, sold toggle, deactivation, and
 * a `shopId` change (old shop -1, new shop +1). Increments are idempotent by
 * delta and each shop write is isolated in its own try/catch (the boutique may
 * have been deleted) so one missing shop never aborts the others.
 */
export const updateShopArticlesCount = onDocumentWritten(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;

    try {
      const before = event.data?.before?.exists ? event.data.before.data() ?? null : null;
      const after = event.data?.after?.exists ? event.data.after.data() ?? null : null;

      // Does this article state count toward a shop's `articlesCount`?
      // Returns the shopId it contributes to, or null if it counts for none.
      const countedShopId = (
        data: FirebaseFirestore.DocumentData | null,
      ): string | null => {
        if (!data) return null;
        const shopId = data.shopId;
        if (typeof shopId !== 'string' || shopId.length === 0) return null;
        // Mirror getShopArticles: active AND not sold.
        if (data.isActive !== true) return null;
        if (data.isSold === true) return null;
        return shopId;
      };

      const beforeShopId = countedShopId(before);
      const afterShopId = countedShopId(after);

      // No change in shop membership → nothing to do (idempotent no-op).
      if (beforeShopId === afterShopId) return;

      // Compute per-shop deltas. A shopId change yields -1 on the old shop and
      // +1 on the new one; create/delete/toggle yields a single +/-1.
      const deltas = new Map<string, number>();
      if (beforeShopId) {
        deltas.set(beforeShopId, (deltas.get(beforeShopId) || 0) - 1);
      }
      if (afterShopId) {
        deltas.set(afterShopId, (deltas.get(afterShopId) || 0) + 1);
      }

      await Promise.all(
        Array.from(deltas.entries()).map(async ([shopId, delta]) => {
          if (delta === 0) return;
          try {
            // Même garde que le compteur vendeur : un `increment(-1)` brut sur
            // une boutique disparue ou déjà à zéro laissait un compteur négatif,
            // et la page boutique masque ses sections sous zéro.
            if (delta > 0) {
              await db
                .collection('shops')
                .doc(shopId)
                .update({ articlesCount: FieldValue.increment(delta) });
            } else {
              await db.runTransaction(async (tx) => {
                const ref = db.collection('shops').doc(shopId);
                const snap = await tx.get(ref);
                if (!snap.exists) return;
                const current = snap.data()?.articlesCount || 0;
                tx.update(ref, { articlesCount: Math.max(0, current + delta) });
              });
            }
            logger.info(
              `Adjusted articlesCount for shop ${shopId} by ${delta} (article ${articleId})`,
            );
          } catch (error) {
            // Shop may have been deleted — never abort sibling updates.
            logger.warn(
              `Could not update articlesCount for shop ${shopId}`,
              { articleId, delta, error: error instanceof Error ? error.message : String(error) },
            );
          }
        }),
      );
    } catch (error) {
      logger.error(`Error updating shop articlesCount for article ${articleId}`, { error });
    }
  }
);

/**
 * Maintain `users/{sellerId}.articlesCount` — the denormalized count read by
 * `getLikedSellers` / `getFeaturedSellers` to show "N articles" on seller cards.
 *
 * No writer existed for this counter, so it stayed at 0 (or stale) and the
 * "Vendeurs suivis" screen showed "0 articles" for sellers who actually have
 * items in sale (m8). We mirror the exact predicate of the seller-articles read
 * path: an article contributes +1 to its seller's count iff it is active and not
 * sold. The DELTA between before/after contributions is applied, so it is correct
 * across create, delete, sold toggle, and deactivation. Each write is isolated so
 * a missing seller never aborts siblings.
 */
export const updateSellerArticlesCount = onDocumentWritten(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;

    try {
      const before = event.data?.before?.exists ? event.data.before.data() ?? null : null;
      const after = event.data?.after?.exists ? event.data.after.data() ?? null : null;

      const countedSellerId = (
        data: FirebaseFirestore.DocumentData | null,
      ): string | null => {
        if (!data) return null;
        const sellerId = data.sellerId;
        if (typeof sellerId !== 'string' || sellerId.length === 0) return null;
        if (data.isActive !== true) return null;
        if (data.isSold === true) return null;
        return sellerId;
      };

      const beforeSellerId = countedSellerId(before);
      const afterSellerId = countedSellerId(after);

      if (beforeSellerId === afterSellerId) return;

      const deltas = new Map<string, number>();
      if (beforeSellerId) {
        deltas.set(beforeSellerId, (deltas.get(beforeSellerId) || 0) - 1);
      }
      if (afterSellerId) {
        deltas.set(afterSellerId, (deltas.get(afterSellerId) || 0) + 1);
      }

      await Promise.all(
        Array.from(deltas.entries()).map(async ([sellerId, delta]) => {
          if (delta === 0) return;
          try {
            // Clamp at 0 on decrement so a missing/never-seeded counter can't go
            // negative; increments are safe via FieldValue.increment.
            if (delta > 0) {
              await db
                .collection('users')
                .doc(sellerId)
                .update({ articlesCount: FieldValue.increment(delta) });
            } else {
              await db.runTransaction(async (tx) => {
                const ref = db.collection('users').doc(sellerId);
                const snap = await tx.get(ref);
                if (!snap.exists) return;
                const current = snap.data()?.articlesCount || 0;
                tx.update(ref, { articlesCount: Math.max(0, current + delta) });
              });
            }
            logger.info(
              `Adjusted articlesCount for seller ${sellerId} by ${delta} (article ${articleId})`,
            );
          } catch (error) {
            logger.warn(
              `Could not update articlesCount for seller ${sellerId}`,
              { articleId, delta, error: error instanceof Error ? error.message : String(error) },
            );
          }
        }),
      );
    } catch (error) {
      logger.error(`Error updating seller articlesCount for article ${articleId}`, { error });
    }
  }
);

/**
 * Update user stats when article is created/updated/sold
 */
export const updateUserStats = onDocumentWritten(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;

    try {
      const after = event.data?.after?.exists ? event.data.after.data() : null;

      if (!after) return; // Document deleted

      const sellerId = after.sellerId;
      if (!sellerId) return;

      // Chaque vue réécrit l'article : sans cette garde, chaque affichage de
      // fiche relisait TOUT le catalogue du vendeur pour un document de
      // statistiques qu'aucun écran ne lit.
      const before = event.data?.before?.exists ? event.data.before.data() : undefined;
      if (onlyMetricsChanged(before, after)) return;

      // Debounce user stats update
      const updateKey = `user_stats_${sellerId}`;
      debounceUpdate(
        updateKey,
        async () => {
          const userStatsRef = db.collection('stats').doc(`user_${sellerId}`);

          // Get current user articles
          const userArticlesSnapshot = await db
            .collection('articles')
            .where('sellerId', '==', sellerId)
            .get();

          let articlesListed = 0;
          let articlesActive = 0;
          let articlesSold = 0;
          let totalViews = 0;
          let totalLikes = 0;
          let totalEarnings = 0;
          let salesCount = 0;

          userArticlesSnapshot.forEach((doc) => {
            const article = doc.data();
            articlesListed++;

            if (article.isActive && !article.isSold) {
              articlesActive++;
            }

            if (article.isSold) {
              articlesSold++;
              totalEarnings += article.price || 0;
              salesCount++;
            }

            totalViews += article.views || 0;
            totalLikes += article.likes || 0;
          });

          const averageSalePrice =
            salesCount > 0 ? totalEarnings / salesCount : 0;

          // Update user stats
          await userStatsRef.set(
            {
              userId: sellerId,
              productsListed: articlesListed,
              productsActive: articlesActive,
              productsSold: articlesSold,
              productsViews: totalViews,
              productsLikes: totalLikes,
              totalEarnings,
              averageSalePrice,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          logger.info(`Updated stats for user ${sellerId}`);
        },
        10000
      ); // 10 second debounce
    } catch (error) {
      logger.error(`Error updating user stats for article ${articleId}`, { error });
    }
  }
);
