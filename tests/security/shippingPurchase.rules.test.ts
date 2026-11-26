import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { beforeAll, beforeEach, afterAll, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';
beforeAll(getTestEnv); afterAll(teardownTestEnv);
beforeEach(async () => {
  const env = await getTestEnv(); await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const c of ['shipping_quotes', 'shipping_packages']) await setDoc(doc(ctx.firestore(), `${c}/private`), { ownerId: 'owner', sellerId: 'seller', source: { origin: 'PRIVATE', dobHash: 'PRIVATE' } });
    await setDoc(doc(ctx.firestore(), 'transactions/order'), { buyerId: 'owner', sellerId: 'seller', status: 'pending_payment', shippingQuoteId: 'private', shippingSnapshot: { origin: 'AUTHORIZED_CONTRACT' } });
  });
});
it.each(['shipping_quotes', 'shipping_packages'])('%s owner/other/anonymous reads and enumeration are denied; admin can inspect', async name => {
  const env = await getTestEnv();
  for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('seller'), env.authenticatedContext('other'), env.unauthenticatedContext()]) {
    await assertFails(getDoc(doc(ctx.firestore(), `${name}/private`))); await assertFails(getDocs(query(collection(ctx.firestore(), name), where('ownerId', '==', 'owner'))));
  }
  await assertSucceeds(getDoc(doc(env.authenticatedContext('admin', { admin: true }).firestore(), `${name}/private`)));
});
it.each(['shipping_quotes', 'shipping_packages'])('%s cannot be forged/replaced/deleted even by client admin', async name => {
  const env = await getTestEnv();
  for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('admin', { admin: true })]) {
    await assertFails(setDoc(doc(ctx.firestore(), `${name}/fresh`), { ownerId: 'owner', allowed: true }));
    await assertFails(updateDoc(doc(ctx.firestore(), `${name}/private`), { source: {}, state: 'ready', version: 100 }));
    await assertFails(deleteDoc(doc(ctx.firestore(), `${name}/private`)));
  }
});
it.each(['shippingQuoteId', 'shippingSnapshot', 'articleSnapshot', 'totalAmount'])('contract field %s is protected; authorized order remains privately readable', async field => {
  const env = await getTestEnv(), buyer = env.authenticatedContext('owner').firestore();
  await assertFails(updateDoc(doc(buyer, 'transactions/order'), { [field]: 'FORGED' }));
  await assertSucceeds(getDoc(doc(buyer, 'transactions/order')));
  await assertFails(getDoc(doc(env.authenticatedContext('other').firestore(), 'transactions/order')));
});
