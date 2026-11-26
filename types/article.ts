/**
 * Types — Article mis en vente : photos, taille, dimensions.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

import type { MeetupNeighborhood, MeetupSpot } from './meetup';
import type { ArticleHygieneDeclarationInput } from '@/functions/src/shared/articleHygiene';
import type { ArticleChildSafetyDeclaration } from './articleChildSafety';
import type { ArticleInventoryAvailability } from '@/utils/articleAvailability';

/** Metadata is supplied by the server; a seller statement is not physical certification. */
export type ArticleHygieneDeclaration = ArticleHygieneDeclarationInput & Partial<{
  declaredBy: string;
  declaredAt: unknown;
  categoryIds: string[];
}>;

export interface ArticleImage {
  url: string;
  blurhash?: string;
}
export type ArticleSaleUnit = 'single_article' | 'set_as_one';
export type ArticleCounterfeitStatus = 'not_counterfeit' | 'declared_counterfeit';
export type ArticleInventoryUnitDeclaration = {kind: 'new_unit'} | {kind: 'same_unit'; articleId: string};
export type ArticleInventoryUnitChoice = {kind: 'new_unit'} | {kind: 'same_unit'; articleId: string | null};
export interface ArticleInventoryUnitView {
  protocol: 'article_inventory_unit_view_v1'; articleId: string; qualification: 'native_current' | 'legacy_missing' | 'review_required';
  revision: string; inventoryUnitId: string | null; memberArticleIds: string[]; availability: 'available' | 'engaged' | 'consumed' | 'unknown';
}
export interface ArticleInventoryUnitReceipt {
  protocol: 'article_inventory_unit_receipt_v1'; articleId: string; unitId: string; requestHash: string; previousRevision: string | null; recordedAt: string;
}
export type ArticleSaleDeclarationInput = {version: 'personal_item_v1'; accepted: true} | {version: 'personal_item_v2'; accepted: true; saleUnit: ArticleSaleUnit}
  | {version: 'personal_item_v3'; accepted: true; saleUnit: ArticleSaleUnit; counterfeitStatus: ArticleCounterfeitStatus};
export interface ArticleListingContentReceipt {
  schemaVersion: 1; version: 'listing_content_v1' | 'listing_content_v2'; scope: 'single_listing'; source: 'seller_publication';
  articleId: string; actorUid: string; quantity: 1; contentHash: string; declaredAt: unknown;
  requestHash: string; previousContentHash: string | null;
}
export interface ArticleSaleDeclarationView {
  schemaVersion: 1; articleId: string; ownerId: string; currentContentHash: string; content: Record<string, unknown>;
  quantity: 1 | null; qualification: 'missing' | 'matching_seller_statement' | 'matching_listing_content' | 'unqualified';
  declaration: ({actorUid: string; contentHash: string; declaredAtMs: number; requestHash: string; previousContentHash: string | null} &
    ({version: 'listing_content_v1' | 'listing_content_v2'; scope: 'single_listing'} | {version: 'personal_item_v1'; scope: 'single_personal_specimen_and_listing'} | {version: 'personal_item_v2'; scope: 'single_personal_sale_unit_and_listing'; saleUnit: ArticleSaleUnit}
    | {version: 'personal_item_v3'; scope: 'single_personal_sale_unit_and_listing'; saleUnit: ArticleSaleUnit; counterfeitStatus: ArticleCounterfeitStatus})) | null;
  platformVerificationGranted: false; commonPhysicalIdentityProven: false;
}

export interface ArticleDimensions {
  length: number; // cm
  width: number; // cm
  height: number; // cm
}

/** Sizing system. Single source of truth — data/sizes.ts re-exports this. */
export type SizeSystem = 'US' | 'EU';

/**
 * Article size, carrying its sizing system so US/EU values never collide.
 * Stored on the article and copied verbatim into swaps.
 */
export interface ArticleSize {
  value: string;
  system: SizeSystem;
}

export type ArticleBrandStatus = 'known' | 'unbranded' | 'unknown';

export interface Article {
  favoritesCount?: number;
  id: string;
  title: string;
  description: string;
  price: number;
  images: ArticleImage[];
  /** @deprecated Use categoryIds instead */
  category: string;
  categoryIds: string[]; // IDs hiérarchiques ex: ['home', 'home_decoration', 'home_decoration_vases']
  size?: ArticleSize | null;
  brand?: string;
  brandStatus?: ArticleBrandStatus;
  color?: string;
  colors?: string[];
  material?: string;
  materials?: string[];
  pattern?: string;
  condition: 'neuf' | 'neuf sans étiquette' | 'très bon état' | 'bon état' | 'satisfaisant';
  quantity?: number;
  stock?: number;
  /** Derived from the native explicit seller declaration; never inferred from quantity. */
  saleUnit?: ArticleSaleUnit;
  /** Seller's explicit statement; absence is never an authenticity assertion. */
  counterfeitStatus?: ArticleCounterfeitStatus;
  /** Per-listing opaque reference; group, members and receipt require the private owner reader. */
  inventoryUnit?: {protocol: 'seller_inventory_article_v1'; identity: string};
  /** Native seller statement only; absence is not a declaration or platform verification. */
  saleDeclaration?: ArticleListingContentReceipt | (ArticleSaleDeclarationInput & Partial<{schemaVersion: 1; actorUid: string; contentHash: string; declaredAt: unknown;
    requestHash: string; previousContentHash: string | null; scope: 'single_personal_specimen_and_listing' | 'single_personal_sale_unit_and_listing'}>);
  /** Absence on a historical listing does not establish its hygiene eligibility. */
  hygieneDeclaration?: ArticleHygieneDeclaration | null;
  childSafetyDeclaration?: ArticleChildSafetyDeclaration | null;
  /** Presence only requests a native preparation read; it grants no editing/publication permission. */
  childSafetyPreparation?: unknown;
  /** Absent on historical listings: absence is not a defect-free declaration. */
  hasKnownDefects?: boolean;
  defectsDescription?: string | null;
  /** null means the seller explicitly does not know; absence is undeclared. */
  hasAlterations?: boolean | null;
  alterationsDescription?: string | null;
  sellerId: string;
  sellerName: string;
  sellerImage?: string;
  /**
   * ID de la boutique propriétaire (Paid shop model). Présent uniquement sur
   * les articles publiés par une boutique ; omis (jamais écrit) pour les
   * particuliers. Indexé pour la requête shopService.getShopArticles.
   */
  shopId?: string;
  createdAt: Date;
  isActive: boolean;
  isSold: boolean;
  /** Server inventory projection; isSold alone can be a reservation lock. */
  inventoryAvailability?: ArticleInventoryAvailability;
  likes: number;
  views: number;
  location?: string; // Ville ou code postal (legacy)
  neighborhood?: MeetupNeighborhood; // Quartier pour meetup
  neighborhoods?: MeetupNeighborhood[]; // Quartiers multiples pour meetup
  preferredMeetupSpots?: MeetupSpot[]; // Lieux de rencontre préférés du vendeur
  weight?: number; // Poids en kg
  dimensions?: ArticleDimensions; // Dimensions calculées automatiquement selon catégorie
  isHandDelivery?: boolean;
  isShipping?: boolean;
  packageSize?: 'small' | 'medium' | 'large';
  // Price drop tracking
  originalPrice?: number;         // Prix avant la premiere baisse
  lastPriceDropAt?: Date;         // Date de la derniere baisse
  priceDropPercent?: number;      // Pourcentage de reduction
  promotionActive?: boolean;      // Promo activee manuellement par le vendeur
}

// Extended Article with location data used in search results
export interface ArticleWithLocation extends Omit<Article, 'location'> {
  location?: {
    lat: number;
    lon: number;
    distance?: number; // in km
    address?: string;
  };
}
