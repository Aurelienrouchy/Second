import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from './testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true });
holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
import { articleReleaseUpdate } from './articleReservation';
beforeEach(() => fs.reset());

async function release(transactionId = 'old') {
  return fs.db.runTransaction(async tx => {
    const ref = fs.db.collection('articles').doc('item');
    const data = (await tx.get(ref)).data()!;
    const update = await articleReleaseUpdate(tx as never, ref as never, data, transactionId);
    if (update) tx.update(ref, update);
    return update;
  });
}

describe('terminal transaction article ownership', () => {
  it('keeps a different pointer even if the newer document is missing', async () => {
    fs.setDoc('articles/item', { isSold: true, activeTransactionId: 'new' });
    expect(await release()).toBeNull();
    expect(fs.getDoc('articles/item')).toEqual({ isSold: true, activeTransactionId: 'new' });
  });
  it('clears its own pointer and tolerates an idempotent second release', async () => {
    fs.setDoc('articles/item', { isSold: true, activeTransactionId: 'old', soldAt: new Date() });
    fs.setDoc('transactions/old', { articleId: 'item', status: 'cancelled' });
    expect(await release()).not.toBeNull();
    expect(fs.getDoc('articles/item')).toMatchObject({ isSold: false });
    expect(fs.getDoc('articles/item')!.activeTransactionId).toBeUndefined();
    expect(await release()).not.toBeNull();
  });
  it.each(['meetup_pending', 'paid', 'meetup_completed', 'unknown'])('protects a legacy article held by another %s agreement', async status => {
    fs.setDoc('articles/item', { isSold: true });
    fs.setDoc('transactions/new', { articleId: 'item', status });
    expect(await release()).toBeNull();
    expect(fs.getDoc('articles/item')!.isSold).toBe(true);
  });
  it.each(['cancelled', 'refunded'])('allows legacy release when all other agreements are %s', async status => {
    fs.setDoc('articles/item', { isSold: true });
    fs.setDoc('transactions/new', { articleId: 'item', status });
    expect(await release()).not.toBeNull();
    expect(fs.getDoc('articles/item')!.isSold).toBe(false);
  });
});
