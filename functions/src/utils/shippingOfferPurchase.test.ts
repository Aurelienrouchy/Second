/** Real quote/reservation/new-payment readers, with isolated Dev carrier output.
 * Only provider account IO, security/control infrastructure are substituted. */
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
const h = await vi.hoisted(async () => {
  const { createFirestoreMock } = await import('./testHelpers/firestoreMock');
  return { fs: createFirestoreMock({ enforceReadBeforeWrite: true }), account: null as any };
});
const fs = h.fs;
vi.mock('../config/firebase', () => ({ get db() { return h.fs.db; }, get FieldValue() {
  return { ...h.fs.FieldValue, serverTimestamp: () => Timestamp.now() };
} }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: async () => h.account } }) }));
vi.mock('./connectEligibility', () => ({ captureConnectObservationBarrier: async () => ({}), observeConnectAccount: async () => {} }));
vi.mock('./businessAdmission', () => ({ assertNewBusinessAdmission: async () => {} }));
vi.mock('./privateAccountSession', () => ({ assertPrivateAccountSession: async () => {}, withPrivateAccountSession: async (_r: unknown, fn: () => unknown) => fn() }));
vi.mock('./financialRecoveryInterlock', async original => ({ ...await original<any>(), withFinancialRecoveryScope: async (_d: unknown, fn: () => unknown) => fn() }));
vi.mock('./financialRecoverySources', () => ({
  financialRecoveryCommitCheckpoint: () => async () => {},
  prepareFinancialRecoverySource: async () => ({}), prepareFinancialRecoveryNewSource: async () => ({}),
  inventoryRecoverySourceFields: async () => ({financialRecoveryWitness:{}}),
  financialRecoverySourceFields: async (_d: unknown, _r: unknown, _p: unknown, patch: unknown) => patch,
}));
vi.mock('./rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
import { quotePurchase, reservePurchase, readShippingParcel, saveShippingParcel } from './shippingPurchase';
import { automaticShippingParcel } from './automaticShippingParcel';
import {automaticShippingFamilyProfile} from '../shared/automaticShippingEstimate';
import {getCategoryPath} from '../shared/categories';
import { frozenReturnContext } from './returnRequest';
import { readReservedShippingPurchase } from './reservedShippingPurchase';
import { recordArticleListingContent } from './articleSaleDeclaration';
import { planNewArticleInventory } from './inventoryUnit';
import { ordinaryAddressContentHash } from './shippingLaunchAdmission';
import { sendShippingOffer, respondShippingOffer } from '../callable/shippingOffers';
import { purchaseAccount, purchaseAddress, purchaseParcel } from './testHelpers/shippingPurchaseFixture';
import { stripeAccountFirestoreFields, deriveStripeAccountState } from './stripeAccount';
const call = (fn: any, data: any, uid = 'buyer') => fn.run({ auth: { uid, token: {} }, data });
const declared = (a: any) => ({ ...a, shippingUseDeclaration: { schemaVersion: 1, policyVersion: 'ordinary_address_2026_01',
  kind: 'ordinary_residential', accepted: true, addressHash: ordinaryAddressContentHash(a) } });
beforeEach(async () => {
  fs.reset();
  for (const [key, value] of Object.entries({ GCLOUD_PROJECT: 'seconde-dev', SECONDE_ENV: 'development', SECONDE_COMMERCE_TEST_MODE: 'true',
    FINANCIAL_RECOVERY_ENVIRONMENT: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', SHIPENGINE_API_KEY: 'TEST_fixture',
    SHIPENGINE_SANDBOX_ENABLED: 'true', SHIPENGINE_ACCOUNT_ENVIRONMENT: 'sandbox', PAYMENTS_ENABLED: 'true', SHIPPING_ENABLED: 'true', TAX_ENABLED: 'false' })) vi.stubEnv(key, value);
  for (const key of ['FUNCTIONS_EMULATOR','SHIPENGINE_BASE_URL','SHIPENGINE_TRANSPORT_POLICY_JSON','OPERATOR_SERVICE_TAX_POLICY_JSON']) vi.stubEnv(key, undefined);
  const data = { sellerId: 'seller', price: 50, title: 'Manteau', description: 'Article personnel', images: ['image'], quantity: 1,
    categoryIds: ['women','women_clothing','women_clothing_sweaters','women_clothing_sweaters_hoodies'],
    condition: 'good', isActive: true, isSold: false, isShipping: true };
  const article = { ...data, saleDeclaration: recordArticleListingContent('article', data, 'seller', 'a'.repeat(64), null) };
  fs.setDoc('articles/article', article);
  await fs.db.runTransaction(async tx => {
    const plan = await planNewArticleInventory(tx as never, 'seller', 'article', article, 'a'.repeat(64));
    plan.commit(); tx.update(fs.db.collection('articles').doc('article'), plan.articleFields);
  });
  fs.setDoc('users/buyer', { isActive: true, dateOfBirth: '2000-01-01' });
  h.account = purchaseAccount(); h.account.requirements.disabled_reason = null;
  fs.setDoc('users/seller', { isActive: true, displayName: 'Vendeur', dateOfBirth: '2000-01-01', stripeAccountId: h.account.id,
    ...stripeAccountFirestoreFields(deriveStripeAccountState(h.account)), addresses: [declared({ ...purchaseAddress, street: '999 Origine privée' })] });
  fs.setDoc('eligibility_profiles/seller', { connectObservationRevision: 1, sellerQuebecEvidence: { schemaVersion: 1, ownerId: 'seller', status: 'observed',
    source: 'stripe_account_observed', residenceVerified: false, accountId: h.account.id, providerDateOfBirth: '2000-01-01',
    profileDateOfBirth: '2000-01-01', country: 'CA', province: 'QC', address: { ...purchaseAddress }, observedAtMs: Date.now(), identityHash: 'a'.repeat(64) } });
  fs.setDoc('shipping_packages/article', { schemaVersion: 1, ownerId: 'seller', articleId: 'article', version: 1, source: 'seller_declared', measurementVerified: false, parcel: purchaseParcel });
  fs.setDoc('chats/chat1', { articleId: 'article', participants: ['buyer','seller'] });
});
afterEach(() => vi.unstubAllEnvs());
async function accepted(counter = false) {
  await call(sendShippingOffer, { chatId: 'chat1', requestId: 'offer1', amount: 40 });
  if (counter) await call(sendShippingOffer, { chatId: 'chat1', requestId: 'counter1', amount: 45, originalMessageId: 'offer1' }, 'seller');
  const messageId = counter ? 'counter1' : 'offer1';
  await call(respondShippingOffer, { chatId: 'chat1', messageId, action: 'accept' }, counter ? 'buyer' : 'seller');
  return messageId;
}
function acceptQuote(q: any) { return { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount,
  purchasePolicyAccepted: true, expectedPurchasePolicyVersion: q.purchasePolicy.policyVersion, expectedPurchasePolicyHash: q.purchasePolicy.hash,
  expectedTransportTermsHash: q.transport.termsHash }; }
it('reads a suggestion without writing, saves a server-only estimate and keeps exact replay/CAS semantics', async () => {
  const initialWrites = fs.writeOps.length;
  expect(await readShippingParcel('seller', 'article')).toMatchObject({ version: 1, source: 'seller_declared',
    recommendation: { source: 'automatic_profile', profileSize: 'medium', profileVersion: 2, profileFamily: 'knitwear' } });
  expect(fs.writeOps).toHaveLength(initialWrites);
  const request = { articleId: 'article', requestId: 'automatic-preparation', expectedVersion: 1, profileSize: 'medium' };
  const result = await saveShippingParcel('seller', request);
  expect(result).toMatchObject({ version: 2, source: 'automatic_profile', profileSize: 'medium', profileVersion: 1,
    parcel: automaticShippingParcel('medium'), measurementVerified: false, replay: false });
  expect(await readShippingParcel('seller', 'article')).toMatchObject({ articleId: 'article', status: 'estimated', version: 2,
    source: 'automatic_profile', profileSize: 'medium', profileVersion: 1, parcel: automaticShippingParcel('medium'),
    recommendation: { source: 'automatic_profile', profileSize: 'medium', profileVersion: 2, profileFamily: 'knitwear', recommendationBasis: 'category_family' }, measurementVerified: false });
  const writeCount = fs.writeOps.length;
  expect(await saveShippingParcel('seller', request)).toMatchObject({ version: 2, replay: true });
  expect(fs.writeOps).toHaveLength(writeCount);
  await expect(saveShippingParcel('seller', { ...request, profileSize: 'large' })).rejects.toMatchObject({ code: 'already-exists' });
  await expect(saveShippingParcel('seller', { ...request, requestId: 'other' })).rejects.toMatchObject({ code: 'aborted' });
  await expect(saveShippingParcel('seller', { ...request, parcel: purchaseParcel })).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(saveShippingParcel('buyer', { ...request, requestId: 'foreign' })).rejects.toMatchObject({ code: 'permission-denied' });
  expect(fs.writeOps).toHaveLength(writeCount);
});
it('binds the actual V2 family through quote/payment/return and rejects a stale or forged new family', async () => {
  const request = {articleId: 'article', requestId: 'family-preparation', expectedVersion: 1,
    profileVersion: 2, profileFamily: 'knitwear', profileSize: 'medium'};
  const initialWrites = fs.writeOps.length;
  for (const extra of [{measurementVerified: true}, {source: 'seller_declared'}, {extra: {}}, {parcel: purchaseParcel}]) {
    await expect(saveShippingParcel('seller', {...request, ...extra})).rejects.toMatchObject({code: 'invalid-argument'});
  }
  for (const extra of [{profileVersion: null}, {profileFamily: null}, {profileVersion: 1, profileFamily: null}]) {
    await expect(saveShippingParcel('seller', {articleId: 'article', requestId: 'invalid-v1', expectedVersion: 1, profileSize: 'medium', ...extra}))
      .rejects.toMatchObject({code: 'invalid-argument'});
  }
  await expect(saveShippingParcel('seller', {...request, profileFamily: 'light_clothing', profileSize: 'small'}))
    .rejects.toMatchObject({code: 'aborted', details: {reason: 'shipping_estimate_changed'}});
  expect(fs.writeOps).toHaveLength(initialWrites);
  const expectedParcel = automaticShippingFamilyProfile('knitwear').parcel;
  expect(await saveShippingParcel('seller', request)).toMatchObject({profileVersion: 2, profileFamily: 'knitwear', parcel: expectedParcel});
  const q: any = await quotePurchase('buyer', {articleId: 'article', shippingAddress: declared(purchaseAddress)});
  expect(q).toMatchObject({profileVersion: 2, profileFamily: 'knitwear', parcel: expectedParcel, measurementVerified: false});
  const input = acceptQuote(q), reservation = await reservePurchase('buyer', input);
  const order = fs.getDoc(`transactions/${reservation.transactionId}`)!;
  expect(order.shippingSnapshot).toMatchObject({profileVersion: 2, profileFamily: 'knitwear', parcel: expectedParcel});
  const proof = await fs.db.runTransaction(tx => readReservedShippingPurchase(tx as never, 'buyer', reservation.transactionId, order, true));
  expect(proof.context.parcel).toEqual(expectedParcel);
  const invalid = {...order, shippingSnapshot: {...order.shippingSnapshot, profileFamily: 'unknown'}};
  await expect(fs.db.runTransaction(tx => readReservedShippingPurchase(tx as never, 'buyer', reservation.transactionId, invalid, true))).rejects.toBeDefined();
  const returned = {...order, shipEngineLabelId: 'se-outbound-label', returnRequest: {requestId: 'return-v2'}};
  expect(frozenReturnContext(reservation.transactionId, returned)?.parcel).toEqual(expectedParcel);
  const writes = fs.writeOps.length;
  fs.setDoc('articles/article', {...fs.getDoc('articles/article'), packageSize: 'small', categoryIds: getCategoryPath('women_clothing_tops_tshirts')});
  expect(await saveShippingParcel('seller', request)).toMatchObject({replay: true, profileFamily: 'knitwear', parcel: expectedParcel});
  expect(frozenReturnContext(reservation.transactionId, returned)?.parcel).toEqual(expectedParcel);
  expect(frozenReturnContext(reservation.transactionId, {...returned, shippingSnapshot: invalid.shippingSnapshot})).toBeNull();
  expect(fs.writeOps).toHaveLength(writes);
});
it('freezes automatic provenance through quote, reservation, payment preparation and exact replay', async () => {
  const request = { articleId: 'article', requestId: 'automatic-preparation', expectedVersion: 1, profileSize: 'large' };
  await saveShippingParcel('seller', request);
  const q: any = await quotePurchase('buyer', { articleId: 'article', shippingAddress: declared(purchaseAddress) });
  expect(q).toMatchObject({ measurementSource: 'automatic_profile', profileSize: 'large', profileVersion: 1,
    parcel: automaticShippingParcel('large'), measurementVerified: false });
  const input = acceptQuote(q), reservation = await reservePurchase('buyer', input);
  const order = fs.getDoc(`transactions/${reservation.transactionId}`)!;
  expect(order.shippingSnapshot).toMatchObject({ measurementSource: 'automatic_profile', profileSize: 'large', profileVersion: 1,
    parcel: automaticShippingParcel('large'), measurementVerified: false });
  const proof = await fs.db.runTransaction(tx => readReservedShippingPurchase(tx as never, 'buyer', reservation.transactionId, order, true));
  expect(proof.context.parcel).toEqual(automaticShippingParcel('large'));
  const writes = fs.writeOps.length;
  await expect(saveShippingParcel('seller', { ...request, requestId: 'replace-reserved', expectedVersion: 2, profileSize: 'small' }))
    .rejects.toMatchObject({ code: 'failed-precondition' });
  expect(await saveShippingParcel('seller', request)).toMatchObject({ version: 2, replay: true });
  expect(await reservePurchase('buyer', input)).toMatchObject({ replay: true, transactionId: reservation.transactionId });
  expect(fs.writeOps).toHaveLength(writes);
  const altered = { ...order, shippingSnapshot: { ...order.shippingSnapshot, profileSize: 'small' } };
  await expect(fs.db.runTransaction(tx => readReservedShippingPurchase(tx as never, 'buyer', reservation.transactionId, altered, true))).rejects.toBeDefined();
  const returnOrder = { ...order, shipEngineLabelId: 'se-outbound-label', returnRequest: { requestId: 'return1' } };
  const frozen = frozenReturnContext(reservation.transactionId, returnOrder);
  expect(frozen?.parcel).toEqual(automaticShippingParcel('large'));
  fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), packageSize: 'small' });
  expect(frozenReturnContext(reservation.transactionId, returnOrder)?.parcel).toEqual(automaticShippingParcel('large'));
  expect(frozenReturnContext(reservation.transactionId, { ...returnOrder, shippingSnapshot: altered.shippingSnapshot })).toBeNull();
});
it('keeps the recovery projection unchanged while its already-bound purchase policy captures the profile identity', async () => {
  const { financialRecoverySourceHash } = await vi.importActual<typeof import('./financialRecoverySources')>('./financialRecoverySources');
  const old = { buyerId: 'buyer', sellerId: 'seller', shippingSnapshot: { measurementSource: 'seller_declared', measurementVerified: false } };
  const legacy = financialRecoverySourceHash('purchase', old);
  expect(financialRecoverySourceHash('purchase', { ...old, shippingSnapshot: { ...old.shippingSnapshot, profileSize: 'large', profileVersion: 1 } })).toBe(legacy);
  const automatic = { ...old, purchasePolicy: { sourceHash: 'a'.repeat(64) },
    shippingSnapshot: { ...old.shippingSnapshot, measurementSource: 'automatic_profile', profileSize: 'large', profileVersion: 1 } };
  const original = financialRecoverySourceHash('purchase', automatic);
  expect(original).not.toBe(legacy);
  // These descriptive fields are requalified against frozen geometry and the
  // quote on new authorization (covered above), not new financial hash paths.
  expect(financialRecoverySourceHash('purchase', { ...automatic, shippingSnapshot: { ...automatic.shippingSnapshot, profileSize: 'small' } })).toBe(original);
  expect(financialRecoverySourceHash('purchase', { ...automatic, purchasePolicy: { sourceHash: 'b'.repeat(64) } })).not.toBe(original);
});
it.each([false,true])('keeps the exact accepted price through quote, inventory reservation and new financial authorization (counter=%s)', async counter => {
  const offerMessageId = await accepted(counter), amount = counter ? 45 : 40;
  const q: any = await quotePurchase('buyer', { articleId: 'article', shippingAddress: declared(purchaseAddress), offerMessageId, chatId: 'chat1' });
  expect(q).toMatchObject({ negotiationSupported: true, offer: { messageId: offerMessageId, chatId: 'chat1', amount } });
  expect(q.rates[0].amount).toBe(amount);
  const input = acceptQuote(q), reservation = await reservePurchase('buyer', input), order = fs.getDoc(`transactions/${reservation.transactionId}`)!;
  expect(order).toMatchObject({ amount, sellerPayout: amount, offerMessageId, chatId: 'chat1', shippingOffer: { amountCents: amount * 100 } });
  expect((fs.getDoc(`messages/${offerMessageId}`)!.offer as any).transactionId).toBe(reservation.transactionId);
  const proof = await fs.db.runTransaction(tx => readReservedShippingPurchase(tx as never, 'buyer', reservation.transactionId, order, true));
  expect(proof.totalCents).toBe(Math.round(q.rates[0].totalAmount * 100));
  expect(await reservePurchase('buyer', input)).toMatchObject({ replay: true, transactionId: reservation.transactionId });
});
it('rejects a free discounted amount, replaced agreement, and concurrent buyer taking the stock', async () => {
  await expect(quotePurchase('buyer', { articleId: 'article', shippingAddress: declared(purchaseAddress), amount: 1 })).rejects.toMatchObject({ details: { reason: 'shipping_offer_unavailable' } });
  const offerMessageId = await accepted();
  const q: any = await quotePurchase('buyer', { articleId: 'article', shippingAddress: declared(purchaseAddress), offerMessageId, chatId: 'chat1' });
  const a = fs.getDoc('articles/article')!; fs.setDoc('articles/article', { ...a, isSold: true, activeTransactionId: 'other' });
  await expect(reservePurchase('buyer', acceptQuote(q))).rejects.toBeDefined();
  expect(fs.getDoc(`shipping_quotes/${q.quoteId}`)!.state).toBe('ready');
  expect((fs.getDoc(`messages/${offerMessageId}`)!.offer as any).transactionId).toBeUndefined();
});
