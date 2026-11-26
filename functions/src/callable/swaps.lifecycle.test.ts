import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import type {MockFirestore} from '../utils/testHelpers/firestoreMock';

const holder = await vi.hoisted(async () => {
  const {createFirestoreMock} = await import('../utils/testHelpers/firestoreMock');
  return {fs: createFirestoreMock({enforceReadBeforeWrite: true}) as MockFirestore};
});
const fs = holder.fs;
vi.mock('../config/firebase', async () => {
  const {Timestamp: NativeTimestamp} = await import('firebase-admin/firestore');
  return {get db() {return holder.fs!.db;}, get FieldValue() {return {...holder.fs!.FieldValue, serverTimestamp: () => NativeTimestamp.now()};},
    storage: {bucket: () => ({name: 'test-bucket', file: () => ({getMetadata: async () => [{contentType: 'image/jpeg', size: 200,generation:'11',crc32c:'AAAAAA==',cacheControl:'private, no-store',metadata:{}}]})})}};
});
// These tests exercise the actual callable, unit locks, snapshots and ledger.
// External control/session admission has its own targeted contract suites.
vi.mock('../utils/privateAccountSession', () => ({withPrivateAccountSession: async (_r: unknown, fn: () => unknown) => fn(), assertPrivateAccountSession: async () => ({})}));
vi.mock('../utils/financialRecoveryInterlock', async original => ({...await original<typeof import('../utils/financialRecoveryInterlock')>(),
  withFinancialRecoveryScope: async (_scope: unknown, fn: () => unknown) => fn()}));
vi.mock('../utils/financialRecoverySources', () => ({
  financialRecoveryCommitCheckpoint: () => async () => undefined,
  financialRecoverySourceFields: async (_domain: unknown, _ref: unknown, _before: unknown, fields: unknown) => fields,
  financialRecoveryWalletFields: async (_ref: unknown, _before: unknown, fields: unknown) => fields,
  prepareFinancialRecoverySource: async () => ({}), prepareFinancialRecoveryNewSource: async () => ({}),
  inventoryRecoverySourceFields: async () => ({financialRecoveryWitness:{}}),
}));
vi.mock('../utils/swapLaunchPolicy', async original => ({...await original<typeof import('../utils/swapLaunchPolicy')>(),
  assertNewSwapAdmission: async () => undefined, captureSwapSellerActivities: async () => ({})}));
vi.mock('../utils/accountRelationshipReview', () => ({assertAccountRelationshipNewPair: async () => undefined}));
vi.mock('../utils/admissionDecision', () => ({recordOwnAdmissionRefusal: async () => null}));
vi.mock('../utils/tradeAdmission', () => ({assertArticleNotModerationRestricted: () => undefined, assertArticleChildSafetyAdmitted: async () => undefined}));
vi.mock('../utils/rateLimit', () => ({checkRateLimit: async () => undefined, resolveCallerKey: (r: any) => ({callerKey: r.auth.uid, isAuthenticated: true})}));
vi.mock('../lib/analytics', () => ({captureServerEvent: async () => undefined}));
vi.mock('firebase-functions/v2/https', async original => ({...await original<typeof import('firebase-functions/v2/https')>(), onCall: (_o: unknown, fn: unknown) => fn}));
vi.mock('firebase-functions/v2/firestore', () => ({onDocumentCreated: (_o: unknown, fn: unknown) => fn, onDocumentUpdated: (_o: unknown, fn: unknown) => fn}));
vi.mock('firebase-functions/v2/scheduler', () => ({onSchedule: (_o: unknown, fn: unknown) => fn}));
vi.mock('firebase-functions/logger', () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}));

import * as swaps from './swaps';
import {planNewArticleInventory, planInventoryAcquire} from '../utils/inventoryUnit';
import {recordArticleListingContent} from '../utils/articleSaleDeclaration';
import {hasUnreservedSwapProposal, SWAP_AGREEMENT_PROTOCOL} from '../utils/swapLaunchPolicy';
import {assertArticleNotSwapEngaged} from '../utils/articleSwapEngagement';
import {expireStaleProposedSwaps} from '../scheduled/swaps';
import {onSwapCreated, onSwapStatusUpdated} from '../triggers/swaps';
import {handleSwapTopUpSucceeded} from '../http/stripe/swapTopUp';

const runTransaction = fs.db.runTransaction.bind(fs.db);
fs.db.runTransaction = (fn: any) => runTransaction(async tx => {const wrapped = Object.assign(tx, {getAll: (...refs: any[]) => Promise.all(refs.map(ref => tx.get(ref)))}); return fn(wrapped);});
const invoke = (fn: unknown, uid: string, data: Record<string, unknown>) => (fn as any)({auth: {uid}, data: {...data, expectedUid: uid}});
const proofUrl = (swapId: string, uid: string, name = 'proof.jpg') => `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/${encodeURIComponent(`swaps/${swapId}/photos/${uid}/${name}`)}?alt=media`;
async function seedArticle(articleId: string, sellerId: string) {
  const article = {sellerId, title: 'Pull', price: 20, isActive: true, isSold: false, quantity: 1,
    categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'], condition: 'good',
    images: [{url: 'https://example.test/item.jpg'}], saleUnit: 'single_article'};
  const data = {...article, saleDeclaration: recordArticleListingContent(articleId, article, sellerId, 'a'.repeat(64), null)};
  await fs.db.runTransaction(async tx => {
    const plan = await planNewArticleInventory(tx as any, sellerId, articleId, data, 'b'.repeat(64));
    plan.commit(); tx.set(fs.db.collection('articles').doc(articleId), {...data, ...plan.articleFields});
  });
}
async function propose(requestId = 'gesture-1', mode = 'hand_delivery', ownIds = ['a1'], otherIds = ['b1'], cashTopUp: any = null) {
  const source = await fs.db.runTransaction(tx => swaps.readSwapAgreementPreview(tx as any, 'alice', {
    operation: 'swap_proposal_preview', expectedUid: 'alice', receiverId: 'bob', initiatorArticleIds: ownIds,
    receiverArticleIds: otherIds, exchangeMode: mode, arrangements: 'Samedi à Montréal.', message: null, cashTopUp}));
  const input = {initiatorId: 'alice', initiatorName: 'Alice', receiverId: 'bob', receiverName: 'Bob',
    initiatorItems: ownIds.map(articleId => ({articleId})), receiverItems: otherIds.map(articleId => ({articleId})),
    exchangeMode: mode, arrangements: 'Samedi à Montréal.', message: null, cashTopUp, clientRequestId: requestId,
    agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash};
  const result = await invoke(swaps.proposeMultiSwap, 'alice', input);
  return {id: result.swapId as string, input};
}
async function accept(id: string) {
  return invoke(swaps.acceptSwap, 'bob', {swapId: id, agreementProtocol: SWAP_AGREEMENT_PROTOCOL,
    expectedSourceHash: (fs.getDoc(`swaps/${id}`)!.exchangeAgreement as any).sourceHash});
}
beforeEach(async () => {
  fs.reset(); vi.stubEnv('PAYMENTS_ENABLED', 'true');
  for (const uid of ['alice', 'bob']) fs.setDoc(`users/${uid}`, {dateOfBirth: '2000-01-01', isActive: true});
  await seedArticle('a1', 'alice'); await seedArticle('b1', 'bob');
});

describe('native swap lifecycle contracts', () => {
  it('concurrent deposits create one deterministic row and increment the zone only once', async () => {
    fs.setDoc('swapParties/generalist', {itemsCount: 0});
    const input = {partyId: 'generalist', articleId: 'a1', title: 'Pull', price: 20};
    const [first, second] = await Promise.all([invoke(swaps.addItemToPartySecure, 'alice', input), invoke(swaps.addItemToPartySecure, 'alice', input)]);
    expect(first.itemId).toBe(second.itemId); expect(String(first.itemId)).toMatch(/^deposit_[a-f0-9]{64}$/);
    expect(fs.getDoc('swapParties/generalist')!.itemsCount).toBe(1);
    expect(fs.writeOps.filter(op => op.path.startsWith('swapPartyItems/') && op.method === 'create')).toHaveLength(1);
  });
  it('a proposal never reserves either participant and does not block a sale or another proposal', async () => {
    const {id} = await propose();
    expect(hasUnreservedSwapProposal(fs.getDoc(`swaps/${id}`)!)).toBe(true);
    expect(fs.getDoc('articles/a1')!.isSold).toBe(false); expect(fs.getDoc('articles/b1')!.isSold).toBe(false);
    await fs.db.runTransaction(tx => assertArticleNotSwapEngaged(tx as any, 'b1'));
    const another = await propose('another-deliberate-proposal'); expect(another.id).not.toBe(id);
    expect(fs.getDoc('articles/b1')!.isSold).toBe(false);
  });
  it('recovers exactly one proposal after a lost response without admitting another invocation', async () => {
    const {id, input} = await propose(); const writes = fs.writeOps.length;
    const replay = await invoke(swaps.proposeMultiSwap, 'alice', input);
    expect(replay.swapId).toBe(id); expect(fs.writeOps).toHaveLength(writes);
    await expect(invoke(swaps.proposeMultiSwap, 'alice', {...input, message: 'Different'})).rejects.toMatchObject({code: 'failed-precondition'});
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('reserves both sides only upon acceptance, once, and refuses a competing acceptance', async () => {
    const first = await propose(), second = await propose('second');
    await accept(first.id); expect(fs.getDoc('articles/b1')!.isSold).toBe(true);
    const writes = fs.writeOps.length; await accept(first.id); expect(fs.writeOps).toHaveLength(writes);
    await expect(accept(second.id)).rejects.toMatchObject({code: 'failed-precondition'});
    expect(fs.getDoc(`swaps/${second.id}`)!.status).toBe('proposed');
  });
  it('cannot accept after the requested stock was acquired by a purchase', async () => {
    const {id} = await propose();
    await fs.db.runTransaction(async tx => {const plan = await planInventoryAcquire(tx as any, 'b1', fs.getDoc('articles/b1')!,
      {kind: 'purchase', id: 'order-1', sourceArticleId: 'b1'}); plan.commit();});
    await expect(accept(id)).rejects.toMatchObject({code: 'failed-precondition'});
    expect(fs.getDoc(`swaps/${id}`)!.status).toBe('proposed');
  });
  it('preserves an older proposal that already owns its exact inventory commitments', async () => {
    const {id} = await propose('legacy'); const data = fs.getDoc(`swaps/${id}`)!; delete data.inventoryReservationStage;
    const commitments: Record<string, unknown>[] = [];
    await fs.db.runTransaction(async tx => {
      const plans = [];
      for (const articleId of ['a1', 'b1']) {
        const plan = await planInventoryAcquire(tx as any, articleId, fs.getDoc(`articles/${articleId}`)!, {kind: 'swap', id, sourceArticleId: articleId});
        commitments.push({articleId, ...plan.commitment}); plans.push(plan);
      }
      for (const plan of plans) plan.commit();
    });
    fs.setDoc(`swaps/${id}`, {...data, inventoryUnitCommitments: commitments}); await accept(id);
    expect(fs.getDoc(`swaps/${id}`)!.status).toBe('accepted'); expect(fs.getDoc('articles/b1')!.isSold).toBe(true);
  });
  it('declining an unreserved proposal never releases a different accepted exchange', async () => {
    const first = await propose(), second = await propose('second'); await accept(first.id);
    const before = fs.getDoc('articles/b1'); await invoke(swaps.declineSwap, 'bob', {swapId: second.id});
    expect(fs.getDoc('articles/b1')).toEqual(before);
    const writes = fs.writeOps.length; await invoke(swaps.declineSwap, 'bob', {swapId: second.id}); expect(fs.writeOps).toHaveLength(writes);
  });
  it('expires an old unreserved proposal without releasing another accepted stock', async () => {
    const old = await propose('old'), accepted = await propose('accepted'); await accept(accepted.id);
    const data = fs.getDoc(`swaps/${old.id}`)!; const createdAt = Timestamp.fromMillis(Date.now() - 9 * 86400000);
    fs.setDoc(`swaps/${old.id}`, {...data, createdAt, articleDeclarationProposalRecordedAt: createdAt,
      exchangeAgreement: {...data.exchangeAgreement as any, initiatorAcknowledgement: {...(data.exchangeAgreement as any).initiatorAcknowledgement, recordedAt: createdAt}}});
    const stock = fs.getDoc('articles/b1'); await (expireStaleProposedSwaps as any)();
    expect(fs.getDoc(`swaps/${old.id}`)!.status).toBe('cancelled'); expect(fs.getDoc('articles/b1')).toEqual(stock);
    expect(fs.getDoc(`swaps/${accepted.id}`)!.status).toBe('accepted');
  });
  it('completes meetup directly after two distinct receptions and replays without consuming twice', async () => {
    const {id} = await propose(); await accept(id);
    const first = await invoke(swaps.confirmSwapReception, 'alice', {swapId: id}); expect(first.completed).toBe(false);
    const date = fs.getDoc(`swaps/${id}`)!.initiatorReceivedAt;
    const writes = fs.writeOps.length; await invoke(swaps.confirmSwapReception, 'alice', {swapId: id}); expect(fs.writeOps).toHaveLength(writes);
    const second = await invoke(swaps.confirmSwapReception, 'bob', {swapId: id}); expect(second.completed).toBe(true);
    expect(fs.getDoc('articles/a1')!.isActive).toBe(false); expect(fs.getDoc(`swaps/${id}`)!.initiatorReceivedAt).toEqual(date);
    const completedWrites = fs.writeOps.length; await invoke(swaps.confirmSwapReception, 'bob', {swapId: id}); expect(fs.writeOps).toHaveLength(completedWrites);
  });
  it('postal reception needs the counterpart shipment only, and repeated shipment keeps its original date', async () => {
    const {id} = await propose('postal', 'shipping'); await accept(id);
    const data = fs.getDoc(`swaps/${id}`)!; fs.setDoc(`swaps/${id}`, {...data, status: 'shipping'});
    await expect(invoke(swaps.confirmSwapReception, 'alice', {swapId: id})).rejects.toMatchObject({code: 'failed-precondition'});
    await invoke(swaps.confirmSwapShipping, 'bob', {swapId: id}); const shipped = fs.getDoc(`swaps/${id}`)!.receiverShippedAt;
    const writes = fs.writeOps.length; await invoke(swaps.confirmSwapShipping, 'bob', {swapId: id}); expect(fs.writeOps).toHaveLength(writes);
    expect(fs.getDoc(`swaps/${id}`)!.receiverShippedAt).toEqual(shipped);
    await expect(invoke(swaps.confirmSwapReception, 'alice', {swapId: id})).resolves.toMatchObject({completed: false});
    expect(fs.getDoc(`swaps/${id}`)!.initiatorShippedAt).toBeUndefined();
  });
  it('photo submission replays the exact immutable objects but never replaces them', async () => {
    const {id} = await propose('photos', 'shipping'); await accept(id); const data = fs.getDoc(`swaps/${id}`)!;
    expect(data.status).toBe('photos_pending'); // No third review of already agreed postal terms.
    await invoke(swaps.setSwapExchangeMode, 'alice', {swapId: id, exchangeMode: 'shipping', arrangements: 'Samedi à Montréal.',
      agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: (data.exchangeAgreement as any).sourceHash});
    const input = {swapId: id, photoUrls: [proofUrl(id, 'alice')]};
    await invoke(swaps.uploadSwapPhotos, 'alice', input); const first = fs.getDoc(`swaps/${id}`)!.initiatorPhotos;
    const writes = fs.writeOps.length; await invoke(swaps.uploadSwapPhotos, 'alice', input); expect(fs.writeOps).toHaveLength(writes);
    await expect(invoke(swaps.uploadSwapPhotos, 'alice', {...input, photoUrls: [proofUrl(id, 'alice', 'different.jpg')]})).rejects.toMatchObject({code: 'failed-precondition'});
    await invoke(swaps.uploadSwapPhotos, 'bob', {swapId: id, photoUrls: [proofUrl(id, 'bob')]});
    expect(fs.getDoc(`swaps/${id}`)!.status).toBe('shipping');
    await invoke(swaps.uploadSwapPhotos, 'alice', input); expect(fs.getDoc(`swaps/${id}`)!.initiatorPhotos).toEqual(first);
  });
  it('moves only the exchange-linked pending complement to held once, preserving other pending money', async () => {
    const {id} = await propose('paid', 'hand_delivery', ['a1'], ['b1'], {amount: 5000, payerId: 'alice'}); await accept(id);
    const paidAt = Timestamp.now(); fs.setDoc(`swaps/${id}`, {...fs.getDoc(`swaps/${id}`), status: 'accepted', topUpPaidAt: paidAt, topUpPaymentIntentId: 'pi_test'});
    fs.setDoc('wallets/bob', {currency: 'CAD', balance: 100, pendingBalance: 7200, heldBalance: 0});
    fs.setDoc('wallets/bob/ledger/credit', {type: 'sale_credit', swapId: id, amount: 5000, currency: 'CAD', createdAt: paidAt, paymentIntentId: 'pi_test'});
    await invoke(swaps.confirmSwapReception, 'alice', {swapId: id}); await invoke(swaps.confirmSwapReception, 'bob', {swapId: id});
    expect(fs.getDoc('wallets/bob')).toMatchObject({pendingBalance: 2200, heldBalance: 5000, balance: 100});
    const held = fs.writeOps.filter(op => op.path.startsWith('wallets/bob/ledger/') && op.data.type === 'funds_held');
    expect(held).toHaveLength(1); expect(held[0].data).toMatchObject({creditLedgerId: 'credit', paymentIntentId: 'pi_test', currency: 'CAD'});
    const writes = fs.writeOps.length; await invoke(swaps.confirmSwapReception, 'bob', {swapId: id}); expect(fs.writeOps).toHaveLength(writes);
  });
  it.each([false, true])('postal top-up capture preserves native or historical preparation (legacy=%s) and never credits twice', async legacy => {
    const {id} = await propose('postal-paid', 'shipping', ['a1'], ['b1'], {amount: 5000, payerId: 'alice'});
    await accept(id); expect(fs.getDoc(`swaps/${id}`)!.status).toBe('payment_pending');
    const source = {...fs.getDoc(`swaps/${id}`), topUpPaymentIntentId: 'pi_route_test', topUpFee: 0};
    if (legacy) delete (source as any).exchangeAgreement;
    fs.setDoc(`swaps/${id}`, source);
    fs.setDoc('wallets/bob', {currency: 'CAD', balance: 100, pendingBalance: 0, heldBalance: 0});
    const event = {id: 'pi_route_test', currency: 'cad', amount_received: 5000, amount: 5000, status: 'succeeded', latest_charge: 'ch_route_test',
      metadata: {swapId: id, payerId: 'alice', payeeId: 'bob', topUpAmount: '5000'}};
    await handleSwapTopUpSucceeded(event); expect(fs.getDoc(`swaps/${id}`)!.status).toBe(legacy ? 'accepted' : 'photos_pending');
    expect(fs.getDoc('wallets/bob')!.pendingBalance).toBe(5000);
    const writes = fs.writeOps.length; await handleSwapTopUpSucceeded(event); expect(fs.writeOps).toHaveLength(writes);
    expect(fs.getDoc('wallets/bob')!.pendingBalance).toBe(5000);
  });
  it.each(['missing_credit', 'wrong_credit', 'insufficient_pending', 'malformed_paid_marker'])('never debits an aggregate wallet from %s', async kind => {
    const {id} = await propose('bad-paid', 'hand_delivery', ['a1'], ['b1'], {amount: 5000, payerId: 'alice'}); await accept(id);
    const paidAt = Timestamp.now(); fs.setDoc(`swaps/${id}`, {...fs.getDoc(`swaps/${id}`), status: 'accepted',
      topUpPaidAt: kind === 'malformed_paid_marker' ? true : paidAt, topUpPaymentIntentId: 'pi_test'});
    fs.setDoc('wallets/bob', {currency: 'CAD', balance: 100, pendingBalance: kind === 'insufficient_pending' ? 100 : 7200, heldBalance: 0});
    if (kind !== 'missing_credit') fs.setDoc('wallets/bob/ledger/credit', {type: 'sale_credit', swapId: id,
      amount: kind === 'wrong_credit' ? 4800 : 5000, currency: 'CAD', createdAt: paidAt, paymentIntentId: 'pi_test'});
    await invoke(swaps.confirmSwapReception, 'alice', {swapId: id}); const wallet = fs.getDoc('wallets/bob'), writes = fs.writeOps.length;
    await expect(invoke(swaps.confirmSwapReception, 'bob', {swapId: id})).rejects.toMatchObject({code: 'failed-precondition', details: {reason: 'swap_topup_credit_unqualified'}});
    expect(fs.getDoc('wallets/bob')).toEqual(wallet); expect(fs.writeOps).toHaveLength(writes);
    expect(fs.getDoc(`swaps/${id}`)!.status).toBe('accepted'); expect(fs.getDoc('articles/b1')!.isActive).toBe(true);
  });
  it('rejects malformed reception and never turns a meetup into a shipment declaration', async () => {
    const {id} = await propose(); await accept(id); const data = fs.getDoc(`swaps/${id}`)!;
    fs.setDoc(`swaps/${id}`, {...data, receiverReceivedAt: true}); const writes = fs.writeOps.length;
    await expect(invoke(swaps.confirmSwapReception, 'alice', {swapId: id})).rejects.toMatchObject({code: 'failed-precondition'});
    await expect(invoke(swaps.confirmSwapShipping, 'alice', {swapId: id})).rejects.toMatchObject({code: 'failed-precondition'});
    expect(fs.writeOps).toHaveLength(writes);
  });
  it.each([NaN, 1.5, 0, 6])('refuses an invalid rating %s before any write', async score => {
    const writes = fs.writeOps.length; await expect(invoke(swaps.rateSwap, 'alice', {swapId: 'anything', score})).rejects.toMatchObject({code: 'invalid-argument'});
    expect(fs.writeOps).toHaveLength(writes);
  });
});

describe('swap notices are durable and directed to the counterpart', () => {
  it('recovers a status-event V1 receipt produced before partial progress notices were introduced', async () => {
    const {id} = await propose('historical-notice'); const data = fs.getDoc(`swaps/${id}`)!, sourceAt = Timestamp.now(), eventId = 'historical-v1-event';
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const receipt = {protocol: 'swap_notice_event_v1', swapId: id, eventId, committedAt: sourceAt,
      sourceHash: digest([id, eventId, sourceAt.toMillis(), null, data.status, data.initiatorId, data.receiverId])};
    fs.setDoc(`swaps/${id}/notice_events/${digest(eventId)}`, receipt); const writes = fs.writeOps.length;
    await (onSwapCreated as any)({id: eventId, params: {swapId: id}, data: {data: () => data, updateTime: sourceAt}});
    expect(fs.writeOps).toHaveLength(writes);
  });
  it.each(['initiatorPhotos', 'initiatorReceivedAt'])('notifies the counterpart for the first %s without changing status', async field => {
    const {id} = await propose('partial'); await accept(id); const before = fs.getDoc(`swaps/${id}`)!;
    const date = Timestamp.now(), after = {...before, [field]: field.endsWith('Photos') ? {userId: 'alice', uploadedAt: date, photos: ['private-object']} : date};
    fs.setDoc(`swaps/${id}`, after);
    const event = {id: `native-${field}`, params: {swapId: id}, data: {before: {data: () => before}, after: {data: () => after, updateTime: Timestamp.now()}}};
    await (onSwapStatusUpdated as any)(event); const notices = fs.writeOps.filter(op => op.path.startsWith('notifications/'));
    expect(notices).toHaveLength(1); expect(notices[0].data).toMatchObject({userId: 'bob', data: {swapId: id, actorUid: 'alice', progressField: field}});
    expect((notices[0].data.data as any).deepLink).toContain(`/swap/${id}`);
    expect(`${notices[0].data.title} ${notices[0].data.message}`).not.toMatch(/envoyé|expédié/i);
    const writes = fs.writeOps.length; await (onSwapStatusUpdated as any)(event); expect(fs.writeOps).toHaveLength(writes);
  });
  it('records each partial shipment once, links the exact swap and never notifies the sender', async () => {
    const {id} = await propose('postal-notice', 'shipping'); await accept(id); const base = fs.getDoc(`swaps/${id}`)!;
    const before = {...base, status: 'shipping'}, after = {...before, initiatorShippedAt: Timestamp.now()};
    fs.setDoc(`swaps/${id}`, after);
    const event = {id: 'native-shipment-event', params: {swapId: id}, data: {before: {data: () => before}, after: {data: () => after, updateTime: Timestamp.now()}}};
    await (onSwapStatusUpdated as any)(event); const notices = fs.writeOps.filter(op => op.path.startsWith('notifications/'));
    expect(notices).toHaveLength(1); expect(notices[0].data).toMatchObject({userId: 'bob', data: {swapId: id, actorUid: 'alice'}});
    expect((notices[0].data.data as any).deepLink).toContain(`/swap/${id}`);
    const writes = fs.writeOps.length; await (onSwapStatusUpdated as any)(event); expect(fs.writeOps).toHaveLength(writes);
  });
  it('does not notify again for an updatedAt-only write or a non-shipment meetup marker', async () => {
    const {id} = await propose(); const before = fs.getDoc(`swaps/${id}`)!, after = {...before, initiatorShippedAt: Timestamp.now()};
    const writes = fs.writeOps.length;
    await (onSwapStatusUpdated as any)({id: 'no-meaningful-event', params: {swapId: id}, data: {before: {data: () => before}, after: {data: () => after, updateTime: Timestamp.now()}}});
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('proposal notification targets the recipient and trigger replay does not resurrect a dismissed notice', async () => {
    const {id} = await propose(); const data = fs.getDoc(`swaps/${id}`)!;
    const event = {id: 'native-proposal-event', params: {swapId: id}, data: {data: () => data, updateTime: Timestamp.now()}};
    await (onSwapCreated as any)(event); const notice = fs.writeOps.find(op => op.path.startsWith('notifications/'))!;
    expect(notice.data.userId).toBe('bob'); fs.setDoc(notice.path, null); const writes = fs.writeOps.length;
    await (onSwapCreated as any)(event); expect(fs.writeOps).toHaveLength(writes); expect(fs.getDoc(notice.path)).toBeUndefined();
  });
});
