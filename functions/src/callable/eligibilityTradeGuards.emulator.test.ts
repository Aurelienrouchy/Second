/** Actual admission transaction IO. Media/brand/notifications are simulated. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
const enabled = process.env.SECOND_ELIGIBILITY_TRADE_SDK_TESTS === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('Trade SDK tests require demo-second loopback.');
const recovery=await vi.hoisted(async()=>(await import('../utils/testHelpers/recoveryStorageFixture')).createRecoveryStorageFixture('demo-second'));
vi.mock('@google-cloud/storage',()=>({Storage:recovery.Storage}));
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null, duringMedia: null as (() => Promise<void>) | null, prepares: 0 }));
vi.mock('../config/firebase', () => ({auth:{getUser:async(uid:string)=>({uid,disabled:false,tokensValidAfterTime:new Date(0).toISOString()})}, get db() { return holder.db!; }, get FieldValue() { return FieldValue; }, storage: {} }));
vi.mock('../utils/articleMedia', async original => ({...await original<typeof import('../utils/articleMedia')>(),promoteArticleImages: async (images: any, _uid: string, id: string) => {
  holder.prepares++; if (holder.duringMedia) await holder.duringMedia();
  return images.map((image: any) => ({ ...image, url: `https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/articles%2F${id}%2Fsimulated.jpg?alt=media` }));
} }));
vi.mock('../services/brands', () => ({ matchBrand: async () => ({ brandName: null }), BRAND_MATCHING: { autoSelectThreshold: 1 } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { createArticle, updateArticle } from './products';
import {installFinancialSubjectTransactions} from '../utils/financialSubjectTransaction';
import { sendMeetupProposal } from './offers';
import { acceptMeetupOffer } from './payments/meetup';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
import { quebecCivilDate } from '../shared/age';
const seller = 'sdk_trade_seller', buyer = 'sdk_trade_buyer', chat = 'sdk_trade_chat';let article='sdk_trade_article';
const requestId = 'sdk_trade_publication';
const publishedId = createHash('sha256').update(`${seller}:${requestId}`).digest('hex').slice(0, 20);
const call = (fn: any, data: any, uid = seller) => fn.run({ auth: { uid, token: { auth_time:Math.floor(Date.now()/1000),email_verified: true } }, data:{expectedUid:uid,...data} });
const profile = (kind = 'personal') => ({ version: 1, activityDeclaration: { kind, actorUid: seller, recordedAt: new Date(), declarationVersion: 1,
  statement: SELLER_ACTIVITY_STATEMENTS[kind as 'personal' | 'professional'], statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION } });
const publishData = { clientRequestId: requestId,quantity:1, title: 'Article SDK',description:'Un pull en coton', price: 50, categoryIds: ['women','women_clothing','women_clothing_sweaters','women_clothing_sweaters_hoodies'],
  condition:'très bon état',size:{value:'M',system:'EU'},isShipping:false,isHandDelivery: true,
  images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/drafts%2Fsdk_trade_seller%2Fd%2Fa.jpg?alt=media' }],
  neighborhoods: [{ id: 'sdk', name: 'Lieu local', borough: 'Ville' }] };
const send = (id: string, amount = 40, uid = buyer, extra = {}) => call(sendMeetupProposal, { chatId: chat, requestId: id, amount, location: { toArrange: true }, ...extra }, uid);
describe.skipIf(!enabled)('trade admission with real Firestore transactions', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'trade-sdk-tests') : null;
  beforeAll(() => { if (app) {holder.db = getFirestore(app);installFinancialSubjectTransactions(holder.db);} });
  async function clean() {
    if (!holder.db) return;
    const units=await holder.db.collection('inventory_units').where('ownerId','==',seller).get();for(const unit of units.docs)await holder.db.recursiveDelete(unit.ref);
    for (const name of ['messages', 'meetup_offer_requests']) {
      const docs = await holder.db.collection(name).where('chatId', '==', chat).get(); for (const doc of docs.docs) await doc.ref.delete();
    }
    for (const name of ['meetup_offer_threads', 'transactions']) {
      const docs = await holder.db.collection(name).where('articleId', '==', article).get(); for (const doc of docs.docs) await doc.ref.delete();
    }
    for (const path of [`users/${seller}`, `users/${buyer}`, `eligibility_profiles/${seller}`, `eligibility_profiles/${buyer}`, `articles/${article}`, `articles/${publishedId}`, `chats/${chat}`]) await holder.db.doc(path).delete();
  }
  beforeEach(async () => {
    await clean();recovery.reset();for(const [k,v]of Object.entries(recovery.environment))vi.stubEnv(k,v);holder.prepares = 0; holder.duringMedia = null;
    await holder.db!.doc(`users/${seller}`).set({ dateOfBirth: '2000-01-01', displayName: 'Local seller', addresses: [{ province: 'ON' }] });
    await holder.db!.doc(`users/${buyer}`).set({ dateOfBirth: '2000-01-01', addresses: [{ province: 'BC' }] });
    await holder.db!.doc(`eligibility_profiles/${seller}`).set(profile());
    article=(await call(createArticle,{...publishData,clientRequestId:'sdk_trade_seed'})).articleId;holder.prepares=0;
    await holder.db!.doc(`chats/${chat}`).set({ articleId: article, participants: [seller, buyer] });
  });
  afterAll(async () => { await clean();vi.unstubAllEnvs();if (app) await deleteApp(app); });
  it.each(['minor', 'professional', 'review'])('publication re-reads %s source changed during simulated media preparation and commits nothing', async problem => {
    holder.duringMedia = async () => {
      if (problem === 'minor') await holder.db!.doc(`users/${seller}`).update({ dateOfBirth: quebecCivilDate() });
      if (problem === 'professional') await holder.db!.doc(`eligibility_profiles/${seller}`).set(profile('professional'));
      if (problem === 'review') await holder.db!.doc(`eligibility_profiles/${seller}`).update({ signals: { operator: { active: true, scope: 'sell' } } });
    };
    await expect(call(createArticle, publishData)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(holder.prepares).toBe(1); expect((await holder.db!.doc(`articles/${publishedId}`).get()).exists).toBe(false);
  });
  it('commercial media edit also refuses source changed between preflight and actual transaction', async () => {
    const before=(await holder.db!.doc(`articles/${article}`).get()).data()!;
    holder.duringMedia = async () => { await holder.db!.doc(`eligibility_profiles/${seller}`).set(profile('professional')); };
    await expect(call(updateArticle, { articleId: article, updates: { images: publishData.images } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(holder.prepares).toBe(1); expect((await holder.db!.doc(`articles/${article}`).get()).data()!.images).toEqual(before.images);
  });
  it('two concurrent exact publications create one document and replay after evidence loss without another preparation', async () => {
    const results = await Promise.all([call(createArticle, publishData), call(createArticle, publishData)]);
    expect(results.map(r => r.articleId)).toEqual([publishedId, publishedId]);
    await holder.db!.doc(`users/${seller}`).set({}); await holder.db!.doc(`eligibility_profiles/${seller}`).delete();
    const count=holder.prepares,replayed=await call(createArticle,publishData);
    expect(replayed).toMatchObject({articleId:publishedId,replayed:true});
    expect(replayed.inventoryUnitReceipt).toEqual(results[0].inventoryUnitReceipt);
    expect(replayed.inventoryUnitView).toEqual(results[0].inventoryUnitView);
    expect(replayed.saleDeclarationView).toEqual(results[0].saleDeclarationView);expect(holder.prepares).toBe(count);
    await expect(call(createArticle, { ...publishData, price: 49 })).rejects.toMatchObject({ code: 'already-exists' });
  });
  it('stored article roles permit professional adult buyer, and refusal of a changed minor is generic without new message/order', async () => {
    await holder.db!.doc(`eligibility_profiles/${buyer}`).set({ version: 1, activityDeclaration: { ...profile('professional').activityDeclaration, actorUid: buyer } });
    const initial = await send('sdk_trade_offer');
    const counter = await send('sdk_trade_counter', 45, seller, { originalMessageId: initial.messageId, counterKind: 'price' });
    await holder.db!.doc(`users/${buyer}`).update({ dateOfBirth: quebecCivilDate() });
    await expect(call(acceptMeetupOffer, { chatId: chat, messageId: counter.messageId }, buyer)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(send('sdk_trade_new', 44, seller)).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
    expect((await holder.db!.collection('transactions').where('articleId', '==', article).get()).size).toBe(0);
    expect((await holder.db!.doc('messages/sdk_trade_new').get()).exists).toBe(false);
    await holder.db!.doc(`users/${buyer}`).update({ dateOfBirth: '2000-01-01' });
    const accepted = await call(acceptMeetupOffer, { chatId: chat, messageId: counter.messageId }, buyer);
    expect((await holder.db!.doc('transactions/' + accepted.transactionId).get()).data()).toMatchObject({ buyerId: buyer, sellerId: seller, amount: 45 });
  });
});
