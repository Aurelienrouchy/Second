import { sizing, spacing } from '@/constants/theme';
import type { AIAnalysisResult } from '@/types/ai';

// Gouttière unique de l'écran, prise dans les jetons — ScreenHeader rentre le
// contenu de la même somme. La grille était calculée sur spacing.md * 2 et
// débordait donc de 8 px à droite de tout le reste de l'écran.
export const PHOTO_GRID_GUTTER = spacing.md + spacing.xs;

// Diamètre du disque de suppression posé sur chaque vignette.
export const GRID_REMOVE_SIZE = 24;

// Le disque reste à 24 px ; c'est le hitSlop qui porte la zone tapable jusqu'à
// la cible minimale du design system.
export const GRID_REMOVE_HIT_SLOP = (sizing.minTouchTarget - GRID_REMOVE_SIZE) / 2;

export function computePhotoGridWidths(
  screenWidth: number,
  gap: number,
  gutter: number = PHOTO_GRID_GUTTER,
): { mainWidth: number; sideWidth: number } {
  const inner = screenWidth - gutter * 2 - gap;
  const mainWidth = inner * 0.62;
  return { mainWidth, sideWidth: inner - mainWidth };
}

export function countPrefilledFields(result: AIAnalysisResult | null): number {
  if (!result) return 0;
  return [
    result.title,
    result.description,
    result.brand?.detected,
    result.category?.categoryId,
    result.condition?.conditionId,
    result.size?.normalized || result.size?.detected,
    (result.colors?.colorIds?.length ?? 0) > 0,
    (result.materials?.materialIds?.length ?? 0) > 0,
  ].filter(Boolean).length;
}

// Les images déjà en ligne ne suivent le vendeur que si elles correspondent une
// pour une aux photos affichées : désalignées, elles publieraient la mauvaise
// image. Jetées, elles repartent en double vers Storage à la publication.
export function handoffStorageUrls(photos: string[], storageUrls: string[]): string[] {
  if (storageUrls.length === 0 || storageUrls.length !== photos.length) return [];
  return storageUrls;
}
