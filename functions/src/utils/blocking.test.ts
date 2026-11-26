/**
 * Le blocage est lu de façon SYMÉTRIQUE et sur les DEUX formes de stockage.
 *
 * `firestore.rules` ne lit que `blockedUserIds` ; un profil qui ne porterait que
 * l'ancienne forme `blockedUsers` verrait donc ses messages ACCEPTÉS par les
 * règles et DÉTRUITS par le serveur. Tant que les deux formes coexistent, tout
 * lecteur serveur doit lire les deux.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from './testHelpers/firestoreMock';
import type { MockFirestore } from './testHelpers/firestoreMock';

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

import { areUsersBlocked } from './blocking';

beforeEach(() => {
  fs.reset();
});

describe('areUsersBlocked', () => {
  it('faux quand personne ne bloque', async () => {
    fs.setDoc('users/alice', {});
    fs.setDoc('users/bob', {});
    expect(await areUsersBlocked('alice', 'bob')).toBe(false);
  });

  it('vrai via la liste plate, dans les deux sens', async () => {
    fs.setDoc('users/alice', { blockedUserIds: ['bob'] });
    fs.setDoc('users/bob', {});
    expect(await areUsersBlocked('alice', 'bob')).toBe(true);
    expect(await areUsersBlocked('bob', 'alice')).toBe(true);
  });

  it('vrai via l’ancienne forme objet seule (profil non migré)', async () => {
    fs.setDoc('users/alice', {
      blockedUsers: [{ userId: 'bob', userName: 'Bob', blockedAt: '2026-01-01' }],
    });
    fs.setDoc('users/bob', {});
    expect(await areUsersBlocked('alice', 'bob')).toBe(true);
  });

  it('tolère une forme plate sur blockedUsers', async () => {
    fs.setDoc('users/alice', { blockedUsers: ['bob'] });
    fs.setDoc('users/bob', {});
    expect(await areUsersBlocked('alice', 'bob')).toBe(true);
  });

  it('ne bloque pas une personne avec elle-même, ni sur un uid vide', async () => {
    fs.setDoc('users/alice', { blockedUserIds: ['alice'] });
    expect(await areUsersBlocked('alice', 'alice')).toBe(false);
    expect(await areUsersBlocked('', 'bob')).toBe(false);
  });

  it('documents absents : pas de blocage, pas de levée', async () => {
    expect(await areUsersBlocked('fantome1', 'fantome2')).toBe(false);
  });
});
