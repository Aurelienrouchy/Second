/**
 * Construit la charge envoyée à `updateArticle` depuis le formulaire d'édition.
 *
 * Extrait de app/article/edit/[id].tsx : ce bloc porte deux sémantiques
 * d'effacement (marque vidée, taille vidée) et la garde F138, qu'aucun test ne
 * tenait.
 */

import { SHIPPING_ENABLED, SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import type { ArticleImage, MeetupNeighborhood, SizeSystem } from '@/types';
import type { ArticleBrandStatus, ArticleSaleDeclarationInput } from '@/types/article';
import { parseArticleDefectDisclosure, parseArticleAlterationDisclosure } from '@/functions/src/shared/article';
import { evaluateArticleHygieneInput, type ArticleHygieneDeclarationInput } from '@/functions/src/shared/articleHygiene';
import { childSafetyCategory } from '@/functions/src/shared/articleChildSafety';
import { articleChildSafetyInput, articleChildSafetyEditKey } from '@/utils/articleChildSafetyInput';
import type { ArticleChildSafetyDraft } from '@/types/articleChildSafety';

interface LegacyArticleUpdateFields {
  title: string;
  description: string;
  categoryIds: string[];
  categoryDisplay: { name: string };
  condition: string;
  hygieneDeclaration?: ArticleHygieneDeclarationInput | null;
  hygieneKind?: ArticleHygieneDeclarationInput['kind'] | null;
  hygieneChanged?: boolean;
  hygieneCategorySource?: string;
  hygieneConditionSource?: string;
  colors: string[];
  colorsSource?: string;
  materials: string[];
  materialsSource?: string;
  quantity?: number;
  stock?: number;
  quantityChanged?: boolean;
  saleDeclaration?: ArticleSaleDeclarationInput;
  childSafetyDeclaration?: ArticleChildSafetyDraft | null;
  childSafetyChanged?: boolean;
  childSafetyContentSource?: string;
  childSafetyRequired?: boolean;
  expectedSaleDeclarationContentHash?: string;
  size: string | null;
  sizeSystem: SizeSystem;
  /** false leaves a legacy size untouched; old journals omitted this flag. */
  sizeChanged?: boolean;
  brand: string;
  brandStatus?: ArticleBrandStatus | null;
  /** Only an explicit brand edit may introduce or change the declaration. */
  brandChanged?: boolean;
  hasKnownDefects?: boolean | null;
  defectsDescription?: string | null;
  defectsChanged?: boolean;
  /** Description/condition observed when the form was loaded and reviewed. */
  defectReviewSource?: string;
  defectsReviewedFor?: string;
  hasAlterations?: boolean | null;
  alterationsDescription?: string | null;
  alterationsChanged?: boolean;
  price: number;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhoods: MeetupNeighborhood[];
  packageSize: 'small' | 'medium' | 'large' | null;
}

/** Current writes have no seller questionnaire; legacy fields are read only by journal validation. */
export type ArticleUpdateFields = Omit<LegacyArticleUpdateFields,
  'saleDeclaration' | 'brandStatus' | 'hasAlterations' | 'alterationsDescription' | 'alterationsChanged' | 'quantityChanged'
  | 'hasKnownDefects' | 'defectsDescription' | 'defectsChanged' | 'defectReviewSource' | 'defectsReviewedFor'>;
export function getArticleBrandEditError(fields: Pick<ArticleUpdateFields, 'brand'>): string | null {
  return fields.brand.trim().length > 100 ? 'La marque doit contenir au plus 100 caractères.' : null;
}
export function buildArticleUpdates(fields: ArticleUpdateFields, finalImages: ArticleImage[]): Record<string, unknown> {
  const error = getArticleBrandEditError(fields);
  if (error) throw new Error(error);
  const updates = buildLegacyArticleUpdates({...fields, brandChanged: false, alterationsChanged: false,
    saleDeclaration: undefined, quantityChanged: false, defectsChanged: false, defectReviewSource: undefined,
    defectsReviewedFor: undefined}, finalImages);
  if (SHIPPING_LISTINGS_ENABLED) {
    updates.isHandDelivery = fields.isHandDelivery;
    updates.isShipping = fields.isShipping;
    if (fields.packageSize) updates.packageSize = fields.packageSize;
  }
  if (fields.brandChanged !== false) updates.brand = fields.brand.trim() || null;
  if (fields.expectedSaleDeclarationContentHash !== undefined) updates.expectedSaleDeclarationContentHash = fields.expectedSaleDeclarationContentHash;
  return updates;
}

interface StoredDelivery {
  isHandDelivery?: boolean;
  isShipping?: boolean;
}

export function getLegacyArticleBrandEditError(fields: Pick<LegacyArticleUpdateFields, 'brand' | 'brandStatus' | 'brandChanged'>): string | null {
  if (fields.brandChanged !== true) return null;
  if (!fields.brandStatus || !['known', 'unbranded', 'unknown'].includes(fields.brandStatus)) {
    return 'Choisissez « Marque connue », « Sans marque » ou « Marque non identifiée » pour cette modification.';
  }
  if (fields.brandStatus === 'known' && !fields.brand.trim()) {
    return 'Renseignez le nom de la marque, ou choisissez « Sans marque » ou « Marque non identifiée ».';
  }
  if (fields.brandStatus !== 'known' && fields.brand.trim()) {
    return 'Une marque absente ou non identifiée doit être déclarée sans nom.';
  }
  return null;
}

/** Match server description cleaning before deciding whether a review is due. */
function cleanArticleDescription(description: string): string {
  return description.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim().substring(0, 5000);
}
export function getArticleDefectReviewKey(description: string, condition: string): string {
  return JSON.stringify([cleanArticleDescription(description), condition]);
}

export function getArticleDisclosureEditError(fields: LegacyArticleUpdateFields): string | null {
  const current = getArticleDefectReviewKey(fields.description, fields.condition);
  const changedDescription = fields.defectReviewSource !== undefined && fields.defectReviewSource !== current;
  if ((changedDescription && fields.defectsChanged !== true)
      || (fields.defectsChanged === true && fields.defectsReviewedFor !== undefined && fields.defectsReviewedFor !== current)) {
    return 'Réexaminez l’article et choisissez à nouveau les défauts connus après avoir modifié sa description ou son état.';
  }
  if (fields.defectsChanged === true && !parseArticleDefectDisclosure({
    hasKnownDefects: fields.hasKnownDefects, defectsDescription: fields.defectsDescription,
  })) return 'Choisissez les défauts connus et décrivez-les en 2 000 caractères maximum, ou effacez leur description si aucun défaut n’est connu.';
  if (fields.alterationsChanged === true && !parseArticleAlterationDisclosure({
    hasAlterations: fields.hasAlterations, alterationsDescription: fields.alterationsDescription,
  })) return 'Choisissez les retouches et décrivez-les en 2 000 caractères maximum, ou effacez leur description pour les autres choix.';
  return null;
}

/** Unrelated legacy edits preserve an absent statement; category changes require a new choice. */
export function getArticleHygieneEditError(fields: LegacyArticleUpdateFields): string | null {
  const categoryChanged = fields.hygieneCategorySource !== undefined
    && fields.hygieneCategorySource !== JSON.stringify(fields.categoryIds);
  const conditionChanged = fields.hygieneConditionSource !== undefined && fields.hygieneConditionSource !== fields.condition;
  if (!categoryChanged && !conditionChanged && fields.hygieneChanged !== true && fields.hygieneDeclaration == null) return null;
  const decision = evaluateArticleHygieneInput(fields.categoryIds, fields.condition, fields.hygieneDeclaration);
  return decision.allowed ? null : decision.message ?? 'Confirmez à nouveau la règle d’hygiène de cet article.';
}

export function buildLegacyArticleUpdates(
  fields: LegacyArticleUpdateFields,
  finalImages: ArticleImage[],
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    title: fields.title.trim(),
    description: fields.defectReviewSource === undefined ? fields.description.trim()
      : cleanArticleDescription(fields.description),
    categoryIds: fields.categoryIds,
    category: fields.categoryDisplay.name,
    condition: fields.condition,
    price: fields.price,
  };

  // Couleurs et matières — toujours propagées, null efface côté serveur.
  if (fields.colorsSource === undefined || fields.colorsSource !== JSON.stringify(fields.colors)) {
    updates.colors = fields.colors;
    updates.color = fields.colors.length > 0 ? fields.colors[0] : null;
  }

  if (fields.materialsSource === undefined || fields.materialsSource !== JSON.stringify(fields.materials)) {
    updates.materials = fields.materials;
    updates.material = fields.materials.length > 0 ? fields.materials[0] : null;
  }
  if (fields.quantityChanged || fields.saleDeclaration) {
    updates.quantity = fields.quantity;
    if (fields.stock !== undefined) updates.stock = fields.stock;
  }
  if (fields.saleDeclaration) {
    updates.saleDeclaration = fields.saleDeclaration;
    updates.expectedSaleDeclarationContentHash = fields.expectedSaleDeclarationContentHash;
  }

  // Le système de taille d'origine est préservé : une taille US ne repart
  // jamais en EU. null efface.
  if (fields.sizeChanged !== false) updates.size = fields.size ? { value: fields.size, system: fields.sizeSystem } : null;

  if (fields.brandChanged === true) {
    const brandError = getLegacyArticleBrandEditError(fields);
    if (brandError) throw new Error(brandError);
    updates.brand = fields.brandStatus === 'known' ? fields.brand.trim() : null;
    updates.brandStatus = fields.brandStatus;
  }

  const disclosureError = getArticleDisclosureEditError(fields);
  if (disclosureError) throw new Error(disclosureError);
  const hygieneError = getArticleHygieneEditError(fields);
  if (hygieneError) throw new Error(hygieneError);
  if (fields.hygieneChanged === true || (fields.hygieneCategorySource !== undefined
      && fields.hygieneCategorySource !== JSON.stringify(fields.categoryIds))) {
    updates.hygieneDeclaration = evaluateArticleHygieneInput(fields.categoryIds, fields.condition, fields.hygieneDeclaration).declaration;
  }
  if (fields.defectsChanged === true) Object.assign(updates, parseArticleDefectDisclosure({
    hasKnownDefects: fields.hasKnownDefects, defectsDescription: fields.defectsDescription,
  }));
  if (fields.alterationsChanged === true) Object.assign(updates, parseArticleAlterationDisclosure({
    hasAlterations: fields.hasAlterations, alterationsDescription: fields.alterationsDescription,
  }));

  // F138 — expédition coupée, le formulaire force la main propre et charge une
  // annonce ancienne en isShipping:false. Réécrire ces valeurs forcées
  // effacerait en silence sa configuration d'expédition (isShipping +
  // packageSize), irrécupérable à la réouverture du drapeau. Tant qu'il est
  // éteint, on ne touche à aucun de ces champs.
  if (SHIPPING_ENABLED) {
    updates.isHandDelivery = fields.isHandDelivery;
    updates.isShipping = fields.isShipping;
    if (fields.packageSize) updates.packageSize = fields.packageSize;
  }

  // Les quartiers restent modifiables dans les deux cas — c'est le seul réglage
  // de remise que le formulaire expose quand le drapeau est éteint.
  if (fields.neighborhoods.length > 0) {
    updates.neighborhoods = fields.neighborhoods;
    updates.neighborhood = fields.neighborhoods[0];
  }

  updates.images = finalImages;
  const childRequired = fields.childSafetyRequired === true || ['child_clothing', 'canonical_sleepwear'].includes(childSafetyCategory(fields.categoryIds));
  const childChanged = fields.childSafetyChanged === true || fields.childSafetyContentSource !== undefined &&
    (fields.childSafetyContentSource !== articleChildSafetyEditKey(fields as unknown as Record<string, unknown>, finalImages) || fields.saleDeclaration !== undefined && childRequired);
  if (childChanged) {
    const declaration = articleChildSafetyInput(fields.childSafetyDeclaration);
    if (childRequired && !declaration) throw new Error('Déclarez l’usage, l’étiquette et vos observations de sécurité sur le contenu modifié.');
    updates.childSafetyDeclaration = childRequired ? declaration : null;
  }

  return updates;
}

/**
 * Options de livraison telles que l'annonce les portera vraiment, pour
 * l'analytique : ce qui vient d'être écrit, sinon ce qui est stocké. Rapporter
 * l'état du formulaire faisait remonter la constante du drapeau.
 */
export function resolveTrackedDelivery(
  updates: Record<string, unknown>,
  article: StoredDelivery,
): { is_hand_delivery: boolean; is_shipping: boolean } {
  return {
    is_hand_delivery:
      'isHandDelivery' in updates ? updates.isHandDelivery === true : article.isHandDelivery === true,
    is_shipping: 'isShipping' in updates ? updates.isShipping === true : article.isShipping === true,
  };
}
