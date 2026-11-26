import { describe, expect, it } from 'vitest';

import { sizing, spacing } from '@/constants/theme';
import {
  GRID_REMOVE_HIT_SLOP,
  GRID_REMOVE_SIZE,
  PHOTO_GRID_GUTTER,
  computePhotoGridWidths,
  countPrefilledFields,
  handoffStorageUrls,
} from './photosReview';

const GRID_GAP = 3;

describe('GRID_REMOVE_HIT_SLOP — la croix de suppression reste atteignable', () => {
  it('atteint la cible tactile minimale du design system', () => {
    expect(GRID_REMOVE_SIZE + GRID_REMOVE_HIT_SLOP * 2).toBe(sizing.minTouchTarget);
  });
});

describe('computePhotoGridWidths — la grille tient dans la gouttière de l’écran', () => {
  it('la gouttière vient des jetons, pas d’une valeur magique', () => {
    expect(PHOTO_GRID_GUTTER).toBe(spacing.md + spacing.xs);
  });

  it.each([375, 393, 430])('occupe exactement la largeur du contenu sur %i pt', (screenWidth) => {
    const { mainWidth, sideWidth } = computePhotoGridWidths(screenWidth, GRID_GAP);
    expect(mainWidth + GRID_GAP + sideWidth).toBe(screenWidth - PHOTO_GRID_GUTTER * 2);
  });

  it('ne déborde pas à droite du contenu', () => {
    const screenWidth = 393;
    const { mainWidth, sideWidth } = computePhotoGridWidths(screenWidth, GRID_GAP);
    const rightEdge = PHOTO_GRID_GUTTER + mainWidth + GRID_GAP + sideWidth;
    expect(rightEdge).toBe(screenWidth - PHOTO_GRID_GUTTER);
  });
});

describe('handoffStorageUrls — les images déjà en ligne suivent le vendeur', () => {
  it('transmet les URLs quand elles correspondent une pour une aux photos', () => {
    const photos = ['file://a.jpg', 'file://b.jpg'];
    const urls = ['https://storage/a.jpg', 'https://storage/b.jpg'];
    expect(handoffStorageUrls(photos, urls)).toEqual(urls);
  });

  it('ne transmet rien quand le nombre d’URLs ne suit plus celui des photos', () => {
    const photos = ['file://a.jpg', 'file://b.jpg', 'file://c.jpg'];
    expect(handoffStorageUrls(photos, ['https://storage/a.jpg'])).toEqual([]);
  });

  it('ne transmet rien sans URL téléversée', () => {
    expect(handoffStorageUrls(['file://a.jpg'], [])).toEqual([]);
  });
});

describe('countPrefilledFields — un seul comptage pour l’écran et pour la mesure', () => {
  const analysed = {
    title: 'Robe fleurie',
    description: 'Jolie robe',
    brand: { detected: 'Zara' },
    category: { categoryId: 'women_dresses' },
    condition: { conditionId: 'tres-bon-etat' },
    size: { detected: 'M', normalized: null },
    colors: { colorIds: ['bleu'] },
    materials: { materialIds: [] },
  } as unknown as AIAnalysisResultLike;

  it('compte les champs réellement remplis', () => {
    expect(countPrefilledFields(analysed as never)).toBe(7);
  });

  it('sans résultat, zéro', () => {
    expect(countPrefilledFields(null)).toBe(0);
  });

  it('un champ vide ou une liste vide ne compte pas', () => {
    const empty = {
      title: '',
      description: '',
      brand: { detected: null },
      category: { categoryId: '' },
      condition: { conditionId: '' },
      size: { detected: null, normalized: null },
      colors: { colorIds: [] },
      materials: { materialIds: [] },
    };
    expect(countPrefilledFields(empty as never)).toBe(0);
  });
});

type AIAnalysisResultLike = Record<string, unknown>;
