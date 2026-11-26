/**
 * BR01 — une marque lue par l'IA mais absente du catalogue n'etait inscrite
 * nulle part : le rapprochement renvoyait « none » et chaque vendeur devait la
 * ressaisir a la main. Elle est desormais ajoutee au referentiel, sous reserve
 * qu'elle ressemble vraiment a une marque : le catalogue est partage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

import { ensureBrandDocument, isPlausibleBrandName } from './brands';

beforeEach(() => {
  fs.reset();
});

describe('isPlausibleBrandName', () => {
  it('accepte un nom de marque ordinaire', () => {
    expect(isPlausibleBrandName('Maison Kitsune')).toBe(true);
    expect(isPlausibleBrandName('A.P.C.')).toBe(true);
    expect(isPlausibleBrandName('ba&sh')).toBe(true);
  });

  it('refuse ce que le modele ecrit quand il ne sait pas', () => {
    expect(isPlausibleBrandName('unknown')).toBe(false);
    expect(isPlausibleBrandName('Sans marque')).toBe(false);
    expect(isPlausibleBrandName('n/a')).toBe(false);
  });

  it('refuse le vide, le trop court et le trop long', () => {
    expect(isPlausibleBrandName(null)).toBe(false);
    expect(isPlausibleBrandName('  ')).toBe(false);
    expect(isPlausibleBrandName('x')).toBe(false);
    expect(isPlausibleBrandName('M'.repeat(41))).toBe(false);
  });

  it('refuse un nombre seul et une chaine qui n\'est pas un nom', () => {
    expect(isPlausibleBrandName('1234')).toBe(false);
    expect(isPlausibleBrandName('<script>')).toBe(false);
  });
});

describe('ensureBrandDocument', () => {
  it('inscrit la marque absente sous l\'identifiant du catalogue', async () => {
    const created = await ensureBrandDocument('maison kitsune');

    expect(created).toEqual({
      id: 'maison-kitsune',
      name: 'Maison Kitsune',
      aliases: [],
      popularity: 0,
    });

    const written = fs.getDoc('brands/maison-kitsune');
    // Les deux contrats de la collection doivent etre servis : la recherche
    // dans l'app lit label/value/searchKey, le rapprochement IA lit name.
    expect(written).toMatchObject({
      label: 'Maison Kitsune',
      value: 'maison kitsune',
      searchKey: 'maison kitsune',
      name: 'Maison Kitsune',
      aliases: [],
      popularity: 0,
      isCustom: true,
      source: 'ai',
    });
  });

  it('n\'ecrit rien pour un nom qui ne peut pas etre une marque', async () => {
    expect(await ensureBrandDocument('unknown')).toBeNull();
    expect(fs.writeOps).toHaveLength(0);
  });

  it('n\'ecrase pas une entree deja au catalogue', async () => {
    fs.setDoc('brands/zara', {
      label: 'Zara',
      value: 'zara',
      searchKey: 'zara',
      name: 'Zara',
      aliases: ['zara home'],
      popularity: 42,
    });

    const known = await ensureBrandDocument('ZARA');

    expect(known).toEqual({
      id: 'zara',
      name: 'Zara',
      aliases: ['zara home'],
      popularity: 42,
    });
    expect(fs.writeOps).toHaveLength(0);
  });
});
