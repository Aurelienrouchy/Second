import { describe, it, expect } from 'vitest';
import { parseModelJson } from './modelJson';

describe('parseModelJson — la réponse du modèle d’analyse', () => {
  it('lit un objet JSON nu', () => {
    expect(parseModelJson('{"title":"Robe"}')).toEqual({ title: 'Robe' });
  });

  it('lit un objet dans un bloc ```json', () => {
    expect(parseModelJson('```json\n{"title":"Robe"}\n```')).toEqual({ title: 'Robe' });
  });

  it('retient le premier objet d’un TABLEAU (l’ancienne extraction rendait du JSON invalide)', () => {
    expect(parseModelJson('[{"title":"Robe"},{"title":"Ceinture"}]')).toEqual({ title: 'Robe' });
  });

  it('retrouve l’objet au milieu d’un texte', () => {
    expect(parseModelJson('Voici le résultat : {"title":"Robe"} Bonne vente !')).toEqual({
      title: 'Robe',
    });
  });

  it('ne se laisse pas tromper par une accolade dans une chaîne', () => {
    expect(parseModelJson('Note {"title":"Robe {taille M}","size":"M"} fin')).toEqual({
      title: 'Robe {taille M}',
      size: 'M',
    });
  });

  it('lève sur une réponse sans objet', () => {
    expect(() => parseModelJson('')).toThrow();
    expect(() => parseModelJson('Désolé, je ne peux pas.')).toThrow();
    expect(() => parseModelJson('[1, 2]')).toThrow();
  });
});
