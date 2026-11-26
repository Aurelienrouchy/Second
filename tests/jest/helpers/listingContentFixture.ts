import { createHash } from 'node:crypto';
import type { Article } from '@/types';
import type { ArticleSaleDeclarationView } from '@/types/article';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const requestFields = ['title', 'description', 'price', 'images', 'category', 'categoryIds', 'condition',
  'isHandDelivery', 'isShipping', 'neighborhoods', 'neighborhood', 'size', 'brand', 'colors', 'color', 'materials',
  'material', 'packageSize', 'hygieneDeclaration', 'quantity', 'stock', 'childSafetyDeclaration',
  'expectedSaleDeclarationContentHash', 'isActive'];

/** Native DTO producer for UI/IO fixtures. No session, currentness or receipt parser is mocked. */
export function fixtureListingView(article: Article): ArticleSaleDeclarationView {
  const { articleSaleDeclarationContent } = jest.requireActual<typeof import('@/services/articlesService')>('@/services/articlesService');
  const content = articleSaleDeclarationContent(article as unknown as Record<string, unknown>);
  const currentContentHash = hash([article.id, article.sellerId, content]);
  const receipt = article.saleDeclaration;
  const qualified = receipt?.version === 'listing_content_v2' && receipt.contentHash === currentContentHash;
  return { schemaVersion: 1, articleId: article.id, ownerId: article.sellerId, currentContentHash, content,
    quantity: article.quantity === 1 ? 1 : null, qualification: qualified ? 'matching_listing_content' : receipt ? 'unqualified' : 'missing',
    declaration: qualified ? { version: 'listing_content_v2', scope: 'single_listing', actorUid: article.sellerId,
      contentHash: currentContentHash, declaredAtMs: receipt.declaredAt instanceof Date ? receipt.declaredAt.getTime() : (() => {throw new Error('Fixture requires native declaration timestamp');})(), requestHash: receipt.requestHash,
      previousContentHash: receipt.previousContentHash } : null,
    platformVerificationGranted: false, commonPhysicalIdentityProven: false };
}

/** Only call at the simulated server commit, never merely when a read happens to match. */
export function fixtureCommitListingReceipt(article: Article, updates: Record<string, unknown>): Article {
  const { articleSaleDeclarationContent } = jest.requireActual<typeof import('@/services/articlesService')>('@/services/articlesService');
  const recordedAt = new Date();
  const normalized = { ...article, quantity: 1, stock: 1 };
  const content = articleSaleDeclarationContent(normalized as unknown as Record<string, unknown>, 'listing_content_v2');
  const requestHash = hash(Object.fromEntries(requestFields.filter(key => updates[key] !== undefined).map(key => [key, updates[key]])));
  return { ...normalized, saleDeclaration: {
    schemaVersion: 1, version: 'listing_content_v2', scope: 'single_listing', source: 'seller_publication',
    articleId: article.id, actorUid: article.sellerId, quantity: 1,
    contentHash: hash([article.id, article.sellerId, content]), declaredAt: recordedAt, requestHash,
    previousContentHash: typeof updates.expectedSaleDeclarationContentHash === 'string' ? updates.expectedSaleDeclarationContentHash : null,
  } };
}
