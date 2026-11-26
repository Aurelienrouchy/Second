/**
 * `onUserProfileUpdated` et le réglage « afficher ma photo de profil ».
 *
 * `createArticle` respecte le réglage à la publication. Le trigger de profil,
 * lui, recopiait la nouvelle photo sur TOUS les articles au premier changement
 * d'avatar, et ne réagissait pas au réglage lui-même : la photo que le vendeur
 * croyait masquée restait publiée sur ses annonces.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';
import {installFinancialSubjectTransactions} from '../utils/financialSubjectTransaction';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;
const db=fs.db as any;
db.doc=(path:string)=>{const a=path.split('/');let r:any=db.collection(a[0]).doc(a[1]);for(let i=2;i<a.length;i+=2)r=r.collection(a[i]).doc(a[i+1]);return r;};
installFinancialSubjectTransactions(db);

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: (_opts: unknown, handler: unknown) => handler,
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
  onDocumentDeleted: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));
vi.mock('../utils/profileMediaPrivacy',()=>({synchronizeProfileMediaVisibility:vi.fn()}));

import { onUserProfileUpdated } from './users';

const run = onUserProfileUpdated as unknown as (event: unknown) => Promise<void>;

function profile(profileImage: string | null, showProfilePhoto?: boolean) {
  return {
    displayName: 'Alice',
    profileImage,
    ...(showProfilePhoto === undefined
      ? {}
      : { preferences: { privacy: { showProfilePhoto } } }),
  };
}

function update(before: Record<string, unknown>, after: Record<string, unknown>) {
  fs.setDoc('users/u1',after);
  return run({
    params: { uid: 'u1' },
    data: { before: { data: () => before }, after: { data: () => after } },
  });
}

beforeEach(() => {
  fs.reset();
  fs.setDoc('articles/a1', { sellerId: 'u1', sellerName: 'Alice', sellerImage: null });
});

describe('onUserProfileUpdated — photo de profil masquée', () => {
  it('ne recopie pas la nouvelle photo sur les articles quand le vendeur l’a masquée', async () => {
    await update(profile('https://x/old.jpg', false), profile('https://x/new.jpg', false));
    expect(fs.getDoc('articles/a1')!.sellerImage).toBeNull();
  });

  it('retire la photo des articles au moment où le vendeur la masque', async () => {
    fs.setDoc('articles/a1', { sellerId: 'u1', sellerName: 'Alice', sellerImage: 'https://x/p.jpg' });
    await update(profile('https://x/p.jpg', true), profile('https://x/p.jpg', false));
    expect(fs.getDoc('articles/a1')!.sellerImage).toBeNull();
  });

  it('la remet quand il la ré-affiche', async () => {
    await update(profile('https://x/p.jpg', false), profile('https://x/p.jpg', true));
    expect(fs.getDoc('articles/a1')!.sellerImage).toBe('https://x/p.jpg');
  });

  it('recopie toujours une nouvelle photo affichée', async () => {
    await update(profile('https://x/old.jpg',true), profile('https://x/new.jpg',true));
    expect(fs.getDoc('articles/a1')!.sellerImage).toBe('https://x/new.jpg');
  });
  it('garde une photo privée lorsque le consentement explicite est absent',async()=>{
    await update(profile('https://x/old.jpg'),profile('https://x/new.jpg'));
    expect(fs.getDoc('articles/a1')!.sellerImage).toBeNull();
  });
});
