/**
 * `approveShop` — l'approbation d'une boutique et les articles déjà publiés.
 *
 * `shopId` n'est posé qu'à la création de l'article : un vendeur qui publie
 * pendant l'examen de sa boutique voyait ces articles rester dehors pour
 * toujours, aucune édition ne les rattrapant.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  pushes: [] as unknown[][],
}));
const fs: MockFirestore = createFirestoreMock({enforceReadBeforeWrite:true});
const run=fs.db.runTransaction.bind(fs.db);
fs.db.runTransaction=(fn:any)=>run((tx:any)=>fn(new Proxy(tx,{get(target,key){if(key==='get')return async(ref:any)=>{
  const snap=await target.get(ref),annotate=(row:any)=>({...row,updateTime:row.exists?Timestamp.fromMillis(1700000000000+fs.writeOps.findLastIndex(op=>op.path===row.ref.path)):undefined});
  return snap.docs?{...snap,docs:snap.docs.map(annotate)}:annotate(snap);};return Reflect.get(target,key);}})));
holder.fs = fs;

vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin1' } }) },
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return {...holder.fs!.FieldValue,serverTimestamp:()=>Timestamp.now()};
  },
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));
vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { onCall: (_opts: unknown, handler: unknown) => handler, HttpsError: _HttpsError };
});
vi.mock('../utils/notifications', async original => ({...await original<typeof import('../utils/notifications')>(),
  sendPushNotification: async (...args: unknown[]) => {
    holder.pushes.push(args);
    return { success: true, sentCount: 1 };
  },
}));

import { approveShop } from './shopModeration';

type Req = { auth?: { uid: string; token: Record<string, unknown> } | null; data?: unknown };
const approve = approveShop as unknown as (r: Req) => Promise<{ ok: true; shopId: string }>;
const ADMIN = { uid: 'admin1', token: { auth_time: Math.floor(Date.now() / 1000), admin: true } };

beforeEach(() => {
  fs.reset();
  holder.pushes.length = 0;
  fs.setDoc('users/u1',{displayName:'Synthetic owner'});
  fs.setDoc('shops/s1', { ownerId: 'u1', name: 'Chez Alice', status: 'pending' });
});

describe('approveShop — les articles publiés avant l’approbation (P12)', () => {
  it('rattache à la boutique les articles que le vendeur avait déjà publiés', async () => {
    fs.setDoc('articles/a1', { sellerId: 'u1', title: 'Robe', isActive: true, isSold: false });
    await approve({ auth: ADMIN, data: { expectedUid: ADMIN.uid, shopId: 's1' } });
    expect(fs.getDoc('articles/a1')!.shopId).toBe('s1');
  });

  it('ne touche pas les articles d’un autre vendeur', async () => {
    fs.setDoc('articles/a2', { sellerId: 'u2', title: 'Veste' });
    await approve({ auth: ADMIN, data: { expectedUid: ADMIN.uid, shopId: 's1' } });
    expect(fs.getDoc('articles/a2')!.shopId).toBeUndefined();
  });

  it('n’écrit rien sur un article déjà rattaché', async () => {
    fs.setDoc('articles/a3', { sellerId: 'u1', shopId: 's1' });
    await approve({ auth: ADMIN, data: { expectedUid: ADMIN.uid, shopId: 's1' } });
    expect(fs.countWrites((op) => op.path === 'articles/a3')).toBe(0);
  });

  it('une seconde approbation ne réécrit rien', async () => {
    fs.setDoc('articles/a1', { sellerId: 'u1', title: 'Robe' });
    await approve({ auth: ADMIN, data: { expectedUid: ADMIN.uid, shopId: 's1' } });
    const writes = fs.countWrites((op) => op.path === 'articles/a1');
    await approve({ auth: ADMIN, data: { expectedUid: ADMIN.uid, shopId: 's1' } });
    expect(fs.countWrites((op) => op.path === 'articles/a1')).toBe(writes);
  });
});
