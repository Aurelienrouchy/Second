/**
 * NB01 — une marque inconnue écrite en capitales était recassée en Titre :
 * « MSGM » devenait « Msgm », côté serveur comme côté client.
 */
import { describe, expect, it } from 'vitest';
import { brandDisplay, brandDocId, brandKey } from './normalizeBrand';

describe('brandDisplay — sigles en capitales', () => {
  it('garde un sigle inconnu tel que le vendeur l’a écrit', () => {
    expect(brandDisplay('MSGM')).toBe('MSGM');
    expect(brandDisplay('IRO')).toBe('IRO');
  });

  it('garde le sigle même accolé à un autre mot', () => {
    expect(brandDisplay('MSGM paris')).toBe('MSGM Paris');
  });

  it('recasse toujours un mot ordinaire écrit en capitales', () => {
    expect(brandDisplay('MARGIELA')).toBe('Margiela');
    expect(brandDisplay('maison margiela')).toBe('Maison Margiela');
  });

  it('laisse les exceptions du catalogue décider en premier', () => {
    expect(brandDisplay('ZARA')).toBe('Zara');
    expect(brandDisplay('UNIQLO')).toBe('Uniqlo');
    expect(brandDisplay('COS')).toBe('COS');
  });

  it('ne change rien aux entrées vides', () => {
    expect(brandDisplay(null)).toBe('');
    expect(brandDisplay('   ')).toBe('');
    expect(brandKey('  MSGM ')).toBe('msgm');
  });
});

/**
 * NB02 — l'ajout d'une marque depuis l'app ecrivait sous la cle brute
 * (« louis vuitton ») alors que le catalogue importe utilise un identifiant
 * en tirets (« louis-vuitton ») : deux documents pour une meme marque.
 */
describe('brandDocId — identifiant partage avec scripts/import-brands.js', () => {
  it('remplace les espaces par des tirets', () => {
    expect(brandDocId('Louis Vuitton')).toBe('louis-vuitton');
  });

  it('remplace les barres obliques par un souligne', () => {
    expect(brandDocId('A/X Armani')).toBe('a_x-armani');
  });

  it('rend le meme identifiant quelle que soit la casse saisie', () => {
    expect(brandDocId('  MSGM ')).toBe(brandDocId('msgm'));
  });

  it('retourne une chaine vide pour une marque absente', () => {
    expect(brandDocId(null)).toBe('');
    expect(brandDocId('   ')).toBe('');
  });
});
