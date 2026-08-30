import { describe, expect, it } from 'vitest';
import {
  generateSingleStepAnalysisPrompt,
  validateAndNormalizeResponse,
} from './ai';

describe('analyse IA des matières', () => {
  it('demande une liste de matières au modèle', () => {
    const prompt = generateSingleStepAnalysisPrompt();
    expect(prompt).toContain('"materials"');
    expect(prompt).toContain("Toutes les matières lisibles sur l'étiquette");
  });

  it('conserve plusieurs matières détectées dans leur ordre', async () => {
    const result = await validateAndNormalizeResponse({
      materials: ['Coton', 'Polyester'],
      confidence: 0.9,
    });

    expect(result.materials).toMatchObject({
      primaryMaterialId: 'coton',
      materialIds: ['coton', 'polyester'],
      confidence: 0.9,
    });
  });

  it('normalise l’état neuf sans étiquette', async () => {
    const prompt = generateSingleStepAnalysisPrompt();
    expect(prompt).toContain('neuf-sans-etiquette');

    const result = await validateAndNormalizeResponse({
      condition: 'Neuf sans étiquette',
      confidence: 0.9,
    });

    expect(result.condition.conditionId).toBe('neuf-sans-etiquette');
  });

  it('reste compatible avec l’ancien champ singulier composé', async () => {
    const result = await validateAndNormalizeResponse({
      material: 'Coton et Polyester',
      confidence: 0.8,
    });

    expect(result.materials).toMatchObject({
      primaryMaterialId: 'coton',
      materialIds: ['coton', 'polyester'],
    });
  });
});
