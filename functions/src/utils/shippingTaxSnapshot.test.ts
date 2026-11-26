/** K07 composition: real quote/reservation/readers, only provider I/O and the
 * independently closed coverage gate are simulated. No live charge or flag change. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from './testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, account: null as any, rates: null as any }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return h.fs!.db; }, get FieldValue() { return h.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: async () => h.account } }) }));
vi.mock('../config/shipEngine', async original => ({ ...await original<any>(), getShipEngine: () => ({
  getPurchaseRates: async () => h.rates, getPurchaseRatesForShipment: async () => h.rates,
}) }));
vi.mock('./shippingLaunchAdmission', async original => ({ ...await original<any>(), assertNewPaidShippingCoverageQualified: () => {} }));
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
beforeEach(() => {
  fs.reset(); vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-17T16:00:00Z'));
  vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true'); vi.stubEnv('TAX_ENABLED', 'false');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function prepare(taxEnabled: boolean, tier = 'pro') {
  vi.stubEnv('TAX_ENABLED', String(taxEnabled));
  const fixture = await import('./testHelpers/shippingPurchaseFixture'); fixture.seedPurchase(fs);
  const { ordinaryAddressContentHash } = await import('./shippingLaunchAdmission');
  const declared = (address: any) => ({ ...address, shippingUseDeclaration: { schemaVersion: 1,
    policyVersion: 'ordinary_address_2026_01', kind: 'ordinary_residential', accepted: true, addressHash: ordinaryAddressContentHash(address) } });
  const seller = fs.getDoc('users/seller')!;
  fs.setDoc('users/seller', { ...seller, addresses: seller.addresses.map(declared) });
  const { declaredArticleSale } = await import('./articleSaleDeclaration');
  const article = { ...fs.getDoc('articles/article'), quantity: 1, saleUnit: 'single_article', condition: 'good',
    categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'] };
  fs.setDoc('articles/article', { ...article, saleDeclaration: declaredArticleSale('article', article, 'seller',
    { version: 'personal_item_v2', accepted: true, saleUnit: 'single_article' }, 'a'.repeat(64), null) });
  fs.setDoc('shops/pro', { ownerId: 'seller', status: 'approved', tier, tierPaidUntil: Timestamp.fromMillis(Date.now() + 86400000) });
  h.account = fixture.purchaseAccount(); h.account.requirements.disabled_reason = null; h.rates = fixture.purchaseRates();
  const core = await import('./shippingPurchase');
  const quote: any = await core.quotePurchase('buyer', { articleId: 'article', shippingAddress: declared(fixture.purchaseAddress) });
  const input = { deliveryType: 'shipping', quoteId: quote.quoteId, rateId: quote.rates[0].rateId, expectedTotal: quote.rates[0].totalAmount,
    purchasePolicyAccepted: true, expectedPurchasePolicyVersion: quote.purchasePolicy.policyVersion, expectedPurchasePolicyHash: quote.purchasePolicy.hash };
  return { core, quote, input };
}
async function paidOrder(id: string) {
  const policy = await import('./purchasePolicy'), order = fs.getDoc(`transactions/${id}`)!, now = Timestamp.now();
  const cents = Math.round(order.totalAmount * 100), ledgerId = 'purchase-native';
  const paid = { ...order, status: 'paid', paidAt: now, paidVia: 'wallet', walletAmountUsed: cents,
    walletPayment: { schemaVersion: 1, state: 'committed', actorUid: 'buyer', ledgerId, amountCents: cents, currency: 'CAD',
      quoteId: order.shippingQuoteId, rateId: order.shipEngineRateId, committedAt: now },
    ...policy.paidPurchasePolicyUpdate(order, id, now, { kind: 'wallet_ledger', referenceId: ledgerId, amountCents: cents }) };
  fs.setDoc(`transactions/${id}`, paid);
  fs.setDoc(`wallets/buyer/ledger/${ledgerId}`, { type: 'purchase_debit', amount: cents, transactionId: id, currency: 'CAD', createdAt: now });
  return paid;
}
it.each([false, true])('K07 tax flag %s preserves reduced fee, every capture and exact refundable GST/QST', async enabled => {
  const { core, quote, input } = await prepare(enabled), snapshot = quote.taxSnapshot;
  expect(snapshot).toMatchObject({ taxableServiceFee: 2, gst: enabled ? 0.1 : 0, qst: enabled ? 0.2 : 0, taxTotal: enabled ? 0.3 : 0,
    technicalConfiguration: { enabled }, registrationStatusVerified: false });
  expect(quote.rates[0]).toMatchObject({ serviceFee: 2, taxTotal: snapshot.taxTotal, totalAmount: enabled ? 63.05 : 62.75 });
  const result = await core.reservePurchase('buyer', input), order = fs.getDoc(`transactions/${result.transactionId}`)!;
  const stored = fs.getDoc(`shipping_quotes/${quote.quoteId}`)!;
  // The in-memory harness retains the FieldValue sentinel; a real commit
  // materializes it as this native Timestamp before the next SDK read.
  stored.acceptedAt = Timestamp.now(); fs.setDoc(`shipping_quotes/${quote.quoteId}`, stored);
  for (const capture of [stored.taxSnapshot, stored.source.taxSnapshot, stored.purchasePolicyAcceptance.taxSnapshot,
    order.taxSnapshot, order.purchasePolicyAcceptance.taxSnapshot]) expect(capture).toEqual(snapshot);
  const { readReservedShippingPurchase } = await import('./reservedShippingPurchase');
  await fs.db.runTransaction(tx => readReservedShippingPurchase(tx, 'buyer', result.transactionId, order, true));
  const paid = await paidOrder(result.transactionId), { readRefundAllocationSource } = await import('./refundAllocation');
  const source = await fs.db.runTransaction(tx => readRefundAllocationSource(tx, result.transactionId, paid));
  expect(source.initial).toEqual({ articleCents: 5000, buyerFeeCents: 200, shippingCents: 1075, gstCents: enabled ? 10 : 0, qstCents: enabled ? 20 : 0 });
});
it('K07 snapshot read uses captured rates after current config changes, and rejects an unbound legacy positive split', async () => {
  const { core, input } = await prepare(true), result = await core.reservePurchase('buyer', input), paid = await paidOrder(result.transactionId);
  vi.stubEnv('TAX_ENABLED', 'false'); vi.stubEnv('GST_RATE', '0.09'); vi.resetModules();
  const { readRefundAllocationSource } = await import('./refundAllocation');
  expect((await fs.db.runTransaction(tx => readRefundAllocationSource(tx, result.transactionId, paid))).initial).toMatchObject({ gstCents: 10, qstCents: 20 });
  const legacy = { ...paid }; delete legacy.pricingVersion;
  legacy.taxSnapshot = { gst: 0.1, qst: 0.2 }; delete legacy.purchasePolicyAcceptance.pricingVersion; delete legacy.purchasePolicyAcceptance.taxSnapshot;
  const q = fs.getDoc(`shipping_quotes/${paid.shippingQuoteId}`)!;
  delete q.pricingVersion; delete q.taxSnapshot; delete q.source.pricingVersion; delete q.source.taxSnapshot;
  delete q.purchasePolicyAcceptance.pricingVersion; delete q.purchasePolicyAcceptance.taxSnapshot; fs.setDoc(`shipping_quotes/${paid.shippingQuoteId}`, q);
  await expect(fs.db.runTransaction(tx => readRefundAllocationSource(tx, result.transactionId, legacy)))
    .rejects.toMatchObject({ details: { reason: 'purchase_refund_source_unknown' } });
});
it('K07 changed tax copy blocks NEW authorization, while claimed receipt remains unchanged with flags OFF', async () => {
  const { core, quote, input } = await prepare(true), result = await core.reservePurchase('buyer', input);
  const order = fs.getDoc(`transactions/${result.transactionId}`)!; order.taxSnapshot.gst = 0.11;
  const { readReservedShippingPurchase } = await import('./reservedShippingPurchase');
  await expect(fs.db.runTransaction(tx => readReservedShippingPurchase(tx, 'buyer', result.transactionId, order, true)))
    .rejects.toMatchObject({ details: { reason: 'wallet_purchase_stale' } });
  vi.stubEnv('PAYMENTS_ENABLED', 'false'); vi.stubEnv('SHIPPING_ENABLED', 'false');
  const before = fs.getDoc(`shipping_quotes/${quote.quoteId}`), writes = fs.writeOps.length;
  expect(await core.reservePurchase('buyer', input)).toMatchObject({ replay: true, transactionId: result.transactionId });
  expect(fs.writeOps).toHaveLength(writes); expect(fs.getDoc(`shipping_quotes/${quote.quoteId}`)).toEqual(before);
});
it('K07 premium fee zero records zero taxes with enabled flag without fabricating a fee', async () => {
  const { quote } = await prepare(true, 'premium');
  expect(quote.taxSnapshot).toMatchObject({ taxableServiceFee: 0, gst: 0, qst: 0, taxTotal: 0, technicalConfiguration: { enabled: true } });
});
it('K07 immutable V1/V2 policy definitions retain their original exact hash bodies', async () => {
  const { buildPurchasePolicy, qualifiedPurchasePolicy } = await import('./purchasePolicy');
  for (const version of ['shipping_purchase_2026_01', 'shipping_purchase_2026_02'] as const) {
    const body = { schemaVersion: 1, policyVersion: version, quoteId: 'q', articleId: 'a', buyerId: 'b', sellerId: 's', sourceHash: '1'.repeat(64),
      parameters: { fundsHoldMs: 604800000, deliveryProtectionMs: 604800000, nonShipmentMs: 604800000 },
      ...(version === 'shipping_purchase_2026_02' ? { preparationTerms: { pendingPayment: { durationMs: 3600000, startEvent: 'native_shipping_acceptance_validated_at' },
        labelAbandonment: { definitiveRejections: 4, countBasis: 'attributed_native_provider_rejections' } } } : {}) };
    const policy = buildPurchasePolicy('q', { articleId: 'a', buyerId: 'b', sellerId: 's', hash: '1'.repeat(64) }, version);
    expect(policy.hash).toBe(sha(body)); expect(qualifiedPurchasePolicy(policy)).toEqual(policy);
  }
});
