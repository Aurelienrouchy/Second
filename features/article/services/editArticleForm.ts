/**
 * Règles pures du formulaire de modification d'annonce.
 *
 * Extraites de app/article/edit/[id].tsx : le bouton « Enregistrer » et les
 * messages d'erreur se contredisaient, chacun ayant sa propre condition.
 */

import { SHIPPING_ENABLED, SHIPPING_LISTINGS_ENABLED } from '@/config/featureFlags';
import { isValidArticlePrice } from '@/functions/src/shared/article';
import { isSizeValidForCategory } from '@/data/sizes';
import type { MeetupNeighborhood, SizeSystem } from '@/types';

export interface ArticleEditFormFields {
  title: string;
  description: string;
  categoryIds: string[];
  price: number;
  isHandDelivery: boolean;
  isShipping: boolean;
  neighborhoods: MeetupNeighborhood[];
  packageSize: 'small' | 'medium' | 'large' | null;
}

export type ArticleEditValidationError =
  | 'title_too_short'
  | 'description_required'
  | 'category_required'
  | 'price_too_low'
  | 'price_too_high'
  | 'price_invalid_precision'
  | 'no_delivery'
  | 'neighborhoods_required'
  | 'package_size_required'
  | 'images_required';

export interface ArticleEditValidationFailure {
  error: ArticleEditValidationError;
  message: string;
}

interface StoredDelivery {
  isHandDelivery?: boolean;
  isShipping?: boolean;
}

/** Options de livraison telles que le formulaire doit les afficher au chargement. */
export function resolveDeliveryFromArticle(article: StoredDelivery): {
  isHandDelivery: boolean;
  isShipping: boolean;
} {
  if (!SHIPPING_LISTINGS_ENABLED) {
    // Expédition coupée : le formulaire ne décide plus rien de la livraison, il
    // reflète l'annonce. Basculer de force une annonce ancienne en main propre
    // lui réclamait un quartier qui ne servira jamais.
    return { isHandDelivery: article.isHandDelivery !== false, isShipping: false };
  }
  return {
    isHandDelivery: article.isHandDelivery ?? !SHIPPING_ENABLED,
    isShipping: article.isShipping ?? SHIPPING_ENABLED,
  };
}

/** Taille à conserver après un changement de catégorie — la grille en dépend. */
export function resolveSizeAfterCategoryChange(
  size: string | null,
  categoryIds: string[],
  system: SizeSystem = 'EU',
): string | null {
  if (!size) return null;
  return isSizeValidForCategory(size, categoryIds, system) ? size : null;
}

export function validateArticleEditForm(
  fields: ArticleEditFormFields,
  imageCount: number,
): ArticleEditValidationFailure | null {
  if (fields.title.trim().length < 3) {
    return { error: 'title_too_short', message: 'Le titre doit faire au moins 3 caractères' };
  }

  if (!fields.description.trim()) {
    return { error: 'description_required', message: 'La description est requise' };
  }

  if (fields.categoryIds.length === 0) {
    return { error: 'category_required', message: 'Sélectionnez une catégorie' };
  }

  if (fields.price < 0.01) {
    return { error: 'price_too_low', message: 'Le prix doit être supérieur à 0' };
  }

  if (fields.price > 10000) {
    return { error: 'price_too_high', message: 'Le prix maximum est de 10 000 $' };
  }
  if (!isValidArticlePrice(fields.price)) {
    return { error: 'price_invalid_precision', message: 'Indiquez un prix entre 0,01 $ et 10 000 $, avec au plus deux décimales. Aucun arrondi automatique ne sera appliqué.' };
  }

  // Expédition coupée : aucun mode de remise n'est décidable ici, une annonce
  // ancienne en expédition doit rester enregistrable.
  if (SHIPPING_LISTINGS_ENABLED && !fields.isHandDelivery && !fields.isShipping) {
    return { error: 'no_delivery', message: 'Sélectionnez au moins une option de livraison' };
  }

  if (fields.isHandDelivery && fields.neighborhoods.length === 0) {
    return {
      error: 'neighborhoods_required',
      message: 'Sélectionnez au moins un quartier pour la remise en main propre',
    };
  }

  if (fields.isShipping && !fields.packageSize) {
    return {
      error: 'package_size_required',
      message: 'Sélectionnez une taille de colis pour l\'expédition',
    };
  }

  // Le serveur refuse une annonce sans photo ; l'écran sautait alors la clé
  // `images`, gardait les anciennes et annonçait « Succès ».
  if (imageCount === 0) {
    return { error: 'images_required', message: 'Ajoutez au moins une photo' };
  }

  return null;
}
