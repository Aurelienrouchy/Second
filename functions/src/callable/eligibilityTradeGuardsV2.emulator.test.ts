/** Actual SDK guards; only ancillary notification/rate-limit/analytics IO is simulated. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const enabled = process.env.SECOND_ELIGIBILITY_TRADE_SDK_TESTS === '1';
if (enabled && (process.env.GCLOUD_PROJECT !== 'demo-second' || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''))) throw new Error('03B1 V2 SDK requires demo-second loopback.');
const recovery=await vi.hoisted(async()=>(await import('../utils/testHelpers/recoveryStorageFixture')).createRecoveryStorageFixture('demo-second'));
vi.mock('@google-cloud/storage',()=>({Storage:recovery.Storage}));
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null }));
vi.mock('../config/firebase', () => ({auth:{getUser:async(uid:string)=>({uid,disabled:false,tokensValidAfterTime:new Date(0).toISOString()})}, get db() { return holder.db!; }, get FieldValue() { return FieldValue; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import {createArticle} from './products';
import {installFinancialSubjectTransactions} from '../utils/financialSubjectTransaction';
vi.mock('../utils/articleMedia',async original=>({...await original<typeof import('../utils/articleMedia')>(),promoteArticleImages:async(images:any)=>images}));
import { sendMeetupProposal } from './offers';
import { acceptMeetupOffer } from './payments/meetup';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
const seller = 'sdk_trade_v2_seller', buyer = 'sdk_trade_v2_buyer', chat = 'sdk_trade_v2_chat';let article='sdk_trade_v2_article';
const call = (fn: any, data: any, uid: string) => fn.run({ auth: { uid, token: { auth_time:Math.floor(Date.now()/1000),email_verified: true } }, data:{expectedUid:uid,...data} });
const send = (uid: string, id: string, extra = {}) => call(sendMeetupProposal, { chatId: chat, requestId: id, amount: 40, location: { toArrange: true }, ...extra }, uid);
describe.skipIf(!enabled)('03B1 V2 actual transaction availability, replay and privacy', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'trade-v2-sdk') : null;
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
    for (const path of ['users/' + seller, 'users/' + buyer, 'eligibility_profiles/' + seller, 'articles/' + article,
      'chats/' + chat, 'wallets/' + seller, 'wallets/' + buyer]) await holder.db.doc(path).delete();
  }
  beforeEach(async () => {
    await clean();recovery.reset();for(const [k,v]of Object.entries(recovery.environment))vi.stubEnv(k,v);const db = holder.db!;
    await db.doc('users/' + seller).set({ dateOfBirth: '2000-01-01', isActive: true });
    await db.doc('users/' + buyer).set({ dateOfBirth: '2000-01-01', isActive: true });
    await db.doc('eligibility_profiles/' + seller).set({ version: 1, activityDeclaration: { kind: 'personal', actorUid: seller,
      declarationVersion: 1, recordedAt: new Date(), statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS.personal } });
    article=(await call(createArticle,{clientRequestId:'sdk_trade_v2_seed',quantity:1,title:'Article SDK',description:'Pull en coton',price:50,
      categoryIds:['women','women_clothing','women_clothing_sweaters','women_clothing_sweaters_hoodies'],condition:'très bon état',size:{value:'M',system:'EU'},
      isHandDelivery:true,isShipping:false,neighborhoods:[{id:'sdk',name:'Quartier',borough:'Montréal'}],
      images:[{url:'https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/'+encodeURIComponent('drafts/'+seller+'/fixture/a.jpg')+'?alt=media'}]},seller)).articleId;
    await db.doc('chats/' + chat).set({ articleId: article, participants: [buyer, seller] });
    await db.doc('wallets/' + seller).set({ balance: 1234 }); await db.doc('wallets/' + buyer).set({ balance: 4321 });
  });
  afterAll(async () => { await clean();vi.unstubAllEnvs();if (app) await deleteApp(app); });
  for (const uid of [buyer, seller]) {
    const other = uid === seller ? buyer : seller, scope = uid === seller ? 'sell' : 'buy';
    it(uid + ' inactive actor: real pending counter survives, new send/accept refused, exact receipt remains readable', async () => {
      const original = await send(uid, 'sdk_v2_original');
      const counter = await send(other, 'sdk_v2_counter', { originalMessageId: original.messageId, counterKind: 'price', amount: 39 });
      await holder.db!.doc('users/' + uid).update({ isActive: false });
      const before = (await holder.db!.doc('messages/' + counter.messageId).get()).data();
      await expect(send(uid, 'sdk_v2_new')).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      const refusal=await call(acceptMeetupOffer, {chatId:chat,messageId:counter.messageId},uid).catch(e=>e);
      expect(refusal).toMatchObject({code:'permission-denied',details:{reason:'admission_refused',admissionGranted:false,financialEffect:'none'}});
      const decision=(await holder.db!.doc('automatic_decisions_log/'+refusal.details.decisionId).get()).data();
      expect(decision).toMatchObject({ownerId:uid,scope,operation:'acceptMeetupOffer'});expect(decision!.reasons).toContain('account_unavailable');
      expect(await send(uid, 'sdk_v2_original')).toMatchObject({ messageId: original.messageId, reused: true });
      expect((await holder.db!.doc('messages/' + counter.messageId).get()).data()).toEqual(before);
      expect((await holder.db!.collection('transactions').where('articleId', '==', article).get()).size).toBe(0);
      expect((await holder.db!.doc('messages/sdk_v2_new').get()).exists).toBe(false);
      expect((await holder.db!.doc('wallets/' + seller).get()).data()).toEqual({ balance: 1234 });
      expect((await holder.db!.doc('wallets/' + buyer).get()).data()).toEqual({ balance: 4321 });
    });
    it(uid + ' inactive counterpart remains a generic refusal in real send and acceptance transactions', async () => {
      const sent = await send(other, 'sdk_v2_offer'); await holder.db!.doc('users/' + other).update({ isActive: false });
      for (const run of [() => send(uid, 'sdk_v2_new'), () => call(acceptMeetupOffer, { chatId: chat, messageId: sent.messageId }, uid)]) {
        const error = await run().catch(e => e);
        expect(error).toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
        expect(JSON.stringify(error.details)).not.toMatch(/account_unavailable|dateOfBirth|isActive|2000/);
      }
      expect((await holder.db!.doc('messages/' + sent.messageId).get()).data()!.offer.status).toBe('pending');
      expect((await holder.db!.collection('transactions').where('articleId', '==', article).get()).size).toBe(0);
      expect((await holder.db!.doc('messages/sdk_v2_new').get()).exists).toBe(false);
      expect((await holder.db!.doc('wallets/' + seller).get()).data()).toEqual({ balance: 1234 });
      expect((await holder.db!.doc('wallets/' + buyer).get()).data()).toEqual({ balance: 4321 });
    });
  }
});
