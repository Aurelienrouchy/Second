import { describe, expect, it } from 'vitest';

import { aiFilledFields } from './aiBadges';

const confidence = (value: number) => ({ value, level: value >= 0.8 ? 'high' : 'low' });

describe('aiFilledFields — le badge « IA » ne marque que ce que l’IA a rempli', () => {
  it('« Remplir manuellement » ne marque aucun champ, même avec des niveaux de confiance posés', () => {
    // La fiche vide de la saisie manuelle porte des confiances à 0 dont le
    // NIVEAU (« low ») est une chaîne non vide : six badges « IA » s'allumaient
    // sur des champs vides, quand le vendeur venait justement de refuser l'IA.
    const manual = {
      title: '',
      description: '',
      category: { categoryId: '', confidence: confidence(0) },
      condition: { conditionId: 'bon-etat', confidence: confidence(0) },
      colors: { colorIds: [], primaryColorId: '', confidence: confidence(0) },
      materials: { materialIds: [], primaryMaterialId: '', confidence: confidence(0) },
      size: { detected: null, normalized: null, confidence: confidence(0) },
      brand: { detected: null, confidence: confidence(0) },
    };
    expect(Object.values(aiFilledFields(manual as never)).some(Boolean)).toBe(false);
  });

  it('marque les champs que l’IA a réellement remplis', () => {
    const analysed = {
      title: 'Robe fleurie',
      description: 'Jolie robe',
      category: { categoryId: 'women_dresses', confidence: confidence(0.9) },
      condition: { conditionId: 'tres-bon-etat', confidence: confidence(0.8) },
      colors: { colorIds: ['bleu'], primaryColorId: 'bleu', confidence: confidence(0.7) },
      materials: { materialIds: [], primaryMaterialId: '', confidence: confidence(0) },
      size: { detected: 'M', normalized: null, confidence: confidence(0.7) },
      brand: { detected: 'Zara', confidence: confidence(0.9) },
    };
    expect(aiFilledFields(analysed as never)).toEqual({
      title: true,
      description: true,
      category: true,
      condition: true,
      colors: true,
      materials: false,
      size: true,
      brand: true,
    });
  });

  it('sans résultat, rien', () => {
    expect(Object.values(aiFilledFields(null)).some(Boolean)).toBe(false);
  });
});
