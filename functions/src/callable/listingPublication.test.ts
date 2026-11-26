/** New listing contract: real publication/edit, identity, admission and stock
 * code; only Auth/Storage/operational-control I/O is substituted. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, promotions: 0, afterPromotion: null as (() => void) | null }));
vi.mock('../config/firebase', async () => {
  const { createFirestoreMock } = await import('../utils/testHelpers/firestoreMock');
  const { FieldValue } = await import('firebase-admin/firestore');
  h.fs = createFirestoreMock({ enforceReadBeforeWrite: true });
  const run = h.fs.db.runTransaction.bind(h.fs.db);
  h.fs.db.runTransaction = callback => run(async tx => callback({ ...tx, get: (async (target: any) => {
    const snap = await (tx.get as any)(target);
    return target.path && snap.exists ? { ...snap, updateTime: Timestamp.now() } : snap;
  }) as typeof tx.get }));
  // Preserve the native delete command used by the content merge while
  // letting the in-memory Firestore adapter apply that command on commit.
  h.fs.FieldValue.delete = () => Object.assign(FieldValue.delete(), { __sentinel: 'delete' as const });
  return {
  get db() { return h.fs!.db; }, get FieldValue() { return h.fs!.FieldValue; },
  auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString() }) },
  };
});
vi.mock('../config/recoveryControl', async original => ({
  ...await original<typeof import('../config/recoveryControl')>(),
  readFinancialRecoveryControl: async () => ({
    control: { mode: 'normal', financialEnvironment: 'unconfigured', installationId: 'listing-test', epoch: 'test-epoch',
      businessAdmission: { protocol: 'business_admission_control_v1', state: 'open', planId: null } },
    installation: { prefix: 'listing-test' }, generation: '1', sha256: 'a'.repeat(64),
  }),
  createRecoveryEvidence: async () => {},
}));
vi.mock('../utils/articleMedia', async original => ({
  ...await original<typeof import('../utils/articleMedia')>(),
  promoteArticleImages: async (images: unknown) => { h.promotions++; h.afterPromotion?.(); return images; },
}));
vi.mock('../services/brands', () => ({ matchBrand: async () => ({ brandName: null }), BRAND_MATCHING: { autoSelectThreshold: 1 } }));
vi.mock('firebase-functions/v2/https', async original => ({
  ...await original<typeof import('firebase-functions/v2/https')>(), onCall: (_options: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));

import { createArticle, updateArticle, toggleArticleSold } from './products';
import { assertArticleSaleDeclaration, articleSaleDeclarationView, declaredArticleSale, recordArticleListingContent, saleDeclarationContent, saleDeclarationContentHash } from '../utils/articleSaleDeclaration';
import { planInventoryAcquire } from '../utils/inventoryUnit';
import { withFinancialRecoveryScope } from '../utils/financialRecoveryInterlock';
import { assertNewMeetupAdmission, commercialRequestHash, LEGACY_PUBLICATION_INPUT_FIELDS, PUBLICATION_V2_INPUT_FIELDS, PUBLICATION_INPUT_FIELDS, PUBLICATION_V5_INPUT_FIELDS } from '../utils/tradeAdmission';
import { ELIGIBILITY_POLICY_VERSION, ELIGIBILITY_REASON_MESSAGES, SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
import { shippingItemProjection } from '../utils/shippingSourceIdentity';
import { convenienceReturnTerms } from '../utils/convenienceReturn';
import { frozenReturnContext } from '../utils/returnRequest';
import { admissionDecisionView, supportSourceHash } from '../utils/supportRequest';
import { canOfferShipping, isShippingEnabled, isPaymentsEnabled } from '../config/featureFlags';
import { ownerEligibilityDto } from '../utils/eligibility';
const uid = 'seller';
const fs = h.fs!;
const auth = () => ({ uid, token: { email_verified: true, auth_time: Math.floor(Date.now() / 1000) } });
const call = (handler: unknown, data: Record<string, unknown>) =>
  (handler as (request: unknown) => Promise<any>)({ auth: auth(), data });
const input = () => ({ clientRequestId: 'listing-without-questionnaires', quantity: 1,
  title: 'Pull en coton', description: 'Un pull en coton bleu.', price: 25,
  images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-dev.firebasestorage.app/o/drafts%2Fseller%2Fd%2Fa.jpg?alt=media' }],
  categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'],
  condition: 'très bon état', size: { value: 'M', system: 'EU' },
  brand: null,
  isHandDelivery: true, isShipping: false, neighborhoods: [{ id: 'n', name: 'Plateau', borough: 'Montréal' }] });
const removed = ['saleUnit', 'counterfeitStatus', 'brandStatus', 'hasAlterations', 'alterationsDescription', 'hasKnownDefects', 'defectsDescription'];

beforeEach(() => {
  fs.reset(); h.promotions = 0; h.afterPromotion = null;
  vi.stubEnv('GCLOUD_PROJECT', 'seconde-dev');
  vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'seconde-dev' }));
  fs.setDoc('users/seller', { displayName: 'Vendeur', dateOfBirth: '1990-01-01', isActive: true });
  fs.setDoc('users/buyer', { dateOfBirth: '1990-01-01', isActive: true });
  fs.setDoc('eligibility_profiles/seller', { version: 1, activityDeclaration: { kind: 'personal', actorUid: uid,
    declarationVersion: 1, recordedAt: Timestamp.now(), statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION,
    statement: SELLER_ACTIVITY_STATEMENTS.personal } });
});

describe('frozen return source after removal of the sale-unit question', () => {
  const order = (articleSnapshot: Record<string, unknown>) => ({ articleId: 'article', buyerId: 'buyer', sellerId: 'seller', articleSnapshot,
    shipEngineRateId: 'se-rate', shipEngineLabelId: 'se-label', shippingSnapshot: { schemaVersion: 1, provider: 'shipengine', currency: 'CAD',
      priceAcceptedBy: 'buyer', validatedAt: Timestamp.now(), acceptanceValidatedAt: Timestamp.now(), measurementSource: 'seller_declared',
      measurementVerified: false, parcelVersion: 1, shipmentId: 'se-shipment',
      rate: { shipmentId: 'se-shipment', rateId: 'se-rate', carrierId: 'se-carrier', carrierCode: 'canada_post', serviceCode: 'expedited' },
      parcel: { weight: { value: 1, unit: 'kilogram' }, dimensions: { length: 10, width: 10, height: 10, unit: 'centimeter' } },
      origin: { name: 'Vendeur', street: '123 rue Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A1', country: 'CA' },
      destination: { name: 'Acheteur', street: '456 rue Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A2', country: 'CA' } } });
  it('uses the frozen new listing marker without inventing an article or set answer', () => {
    const item = shippingItemProjection({ title: 'Annonce', description: 'Contenu entier.', saleDeclaration: { version: 'listing_content_v1' } });
    expect(item).toEqual({ title: 'Annonce', description: 'Contenu entier.', listingContentVersion: 'listing_content_v1' });
    expect(convenienceReturnTerms('sale',order(item))?.terms.article).toEqual(item);
    const v2 = shippingItemProjection({ ...item, hasKnownDefects: true, defectsDescription: 'Donnée obsolète', saleDeclaration: {version:'listing_content_v2'} });
    expect(v2).toEqual({ title:'Annonce', description:'Contenu entier.', listingContentVersion:'listing_content_v2' });
    expect(convenienceReturnTerms('sale',order(v2))?.terms.article).toEqual(v2);
  });
  it('keeps an incomplete historical snapshot unknown instead of assigning a new marker', () => {
    const item = shippingItemProjection({ title: 'Ancienne annonce', description: 'Contenu historique.' });
    expect(item).not.toHaveProperty('listingContentVersion');
    expect(convenienceReturnTerms('sale',order(item))).toBeNull();
  });
  it('preserves the exact old snapshot, return terms and source hash', () => {
    const item = { title: 'Ancien ensemble', description: 'Contenu entier.', saleUnit: 'set_as_one' };
    expect(shippingItemProjection(item)).toEqual(item);
    const source = order(item), { externalShipmentId: _externalShipmentId, ...route } = frozenReturnContext('sale',
      { ...source, returnRequest: { requestId: 'convenience_source_v1' } })!;
    const terms = { protocol: 'convenience_return_terms_v1', transactionId: 'sale', buyerId: 'buyer', sellerId: 'seller', reason: 'change_of_mind',
      articleId: 'article', article: item, route, scope: 'whole_transaction', costs: 'instruction_required', refund: 'not_decided',
      itemConformity: 'buyer_declared_conforming', physicalConditionVerified: false };
    const sourceHash = supportSourceHash([terms, Object.fromEntries(['articleSnapshot', 'shippingSnapshot', 'shippingAddress',
      'shipEngineLabelId', 'shipEngineRateId', 'deliveredAt', 'fundsReleaseAt', 'deliveryCorrection', 'currency', 'amount', 'totalAmount', 'sellerPayout']
      .map(key => [key, (source as any)[key] ?? null]))]);
    expect(convenienceReturnTerms('sale',source)).toEqual({ terms, sourceHash });
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('canonical catalogue publication and new local trade admission', () => {
  // The adapter supplies updateTime from Timestamp.now() at each read.
  // Freeze server time so observe/set compares one stable native revision.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-26T16:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['Affiches', ['home', 'home_decor', 'home_decor_wall', 'home_decor_wall_posters']],
    ['Baskets', ['men', 'men_shoes', 'men_shoes_sneakers']],
  ])('publishes, edits, relists and admits a new meetup for %s', async (title, categoryIds) => {
    const { articleId } = await call(createArticle, { ...input(), title, categoryIds });
    expect(fs.getDoc('articles/' + articleId)).toMatchObject({ categoryIds, sellerId: uid, isActive: true });
    await call(updateArticle, { articleId, updates: { price: 24 } });
    for (const [desiredIsSold, requestId] of [[true, 'catalogue-sold'], [false, 'catalogue-relist']] as const) {
      const observed = await call(toggleArticleSold, { operation: 'observe', articleId });
      await call(toggleArticleSold, { operation: 'set', articleId, desiredIsSold, requestId,
        expectedIsSold: observed.isSold, expectedRevision: observed.revision });
    }
    await expect(withFinancialRecoveryScope({ operation: 'callable/products.updateArticle' }, () => fs.db.runTransaction(tx =>
      assertNewMeetupAdmission(tx as any, 'buyer', uid, 'buyer', articleId)))).resolves.toMatchObject({ categoryIds, price: 24 });
    expect(fs.getDoc('articles/' + articleId)?.hygieneDeclaration ?? null).toBeNull();
    expect(fs.getDoc('articles/' + articleId)?.childSafetyDeclaration ?? null).toBeNull();
  });

  it('requires new sealed cosmetics before publication, then rechecks their witness for a new meetup', async () => {
    const categoryIds = ['men', 'men_grooming', 'men_grooming_perfume'];
    const data = { ...input(), title: 'Parfum homme scellé', categoryIds, condition: 'neuf' };
    await expect(call(createArticle, data)).rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'article_hygiene_declaration_required' } });
    expect(fs.writeOps.some(op => op.path.startsWith('articles/'))).toBe(false);
    const { articleId } = await call(createArticle, { ...data, hygieneDeclaration: { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: true } });
    await expect(withFinancialRecoveryScope({ operation: 'callable/products.updateArticle' }, () => fs.db.runTransaction(tx =>
      assertNewMeetupAdmission(tx as any, 'buyer', uid, 'buyer', articleId)))).resolves.toMatchObject({ categoryIds });
    const article = fs.getDoc('articles/' + articleId)!;
    fs.setDoc('articles/' + articleId, { ...article, hygieneDeclaration: { ...article.hygieneDeclaration, isSealed: false } });
    await expect(withFinancialRecoveryScope({ operation: 'callable/products.updateArticle' }, () => fs.db.runTransaction(tx =>
      assertNewMeetupAdmission(tx as any, 'buyer', uid, 'buyer', articleId)))).rejects.toMatchObject({
      code: 'failed-precondition', details: { reason: 'article_hygiene_declaration_required' },
    });
  });

  it('keeps child clothing publication behind its explicit seller safety statement', async () => {
    await expect(call(createArticle, { ...input(), categoryIds: ['kids', 'kids_girls', 'kids_girls_tops', 'kids_girls_tops_tshirts'] }))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'article_child_safety_statement_required' } });
    expect(fs.writeOps.some(op => op.path.startsWith('articles/'))).toBe(false);
  });
});

describe('publication without a seller activity declaration', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T16:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  async function markSold(articleId: string, desiredIsSold: boolean, requestId: string) {
    const observed = await call(toggleArticleSold, { operation: 'observe', articleId });
    return call(toggleArticleSold, { operation: 'set', articleId, desiredIsSold, requestId,
      expectedIsSold: observed.isSold, expectedRevision: observed.revision });
  }

  it.each(['missing', 'obsolete'])('creates, edits and relists with %s activity, without declaring anything for the owner', async source => {
    const profile = source === 'missing' ? null : { version: 1, activityDeclaration: {
      kind: 'personal', statementVersion: 'old', statement: 'ancienne déclaration', declarationVersion: 1 } };
    fs.setDoc('eligibility_profiles/seller', profile);
    const dto = ownerEligibilityDto({ ownerId: uid, user: fs.getDoc('users/seller')!, profile });
    expect(dto.publication).toMatchObject({ allowed: true, scope: 'sell', evaluationStage: 'foundations' });
    // Current publication eligibility no longer requires the removed activity
    // questionnaire. This does not manufacture an activity declaration receipt.
    expect(dto.decisions.sell.allowed).toBe(true);
    const { articleId } = await call(createArticle, input());
    await call(updateArticle, { articleId, updates: { price: 24 } });
    await markSold(articleId, true, 'mark-sold');
    await markSold(articleId, false, 'relist');
    expect(fs.getDoc('articles/' + articleId)).toMatchObject({ isSold: false, price: 24 });
    expect(fs.getDoc('eligibility_profiles/seller') ?? null).toEqual(profile);
    expect(fs.writeOps.filter(op => /^(users|eligibility_profiles|eligibility_audit|automatic_decisions_log)\//.test(op.path))).toHaveLength(0);
    // The simplified private-member policy also admits this adult counterpart.
    // This read checks eligibility only: the test's catalogue scope does not
    // qualify a real meetup effect in an unconfigured financial installation.
    await expect(withFinancialRecoveryScope({operation:'callable/products.updateArticle'}, () => fs.db.runTransaction(tx =>
      assertNewMeetupAdmission(tx as any, uid, uid, 'buyer', articleId)))).resolves.toMatchObject({ sellerId: uid });
    expect(fs.getDoc('eligibility_profiles/seller') ?? null).toEqual(profile);
    expect(fs.writeOps.filter(op => /^(users|eligibility_profiles|eligibility_audit|automatic_decisions_log)\//.test(op.path))).toHaveLength(0);
  });

  it.each([
    ['professional incomplete', { version: 1, activityDeclaration: { kind: 'professional' } }, null, 'professional_declared'],
    ['underage', null, { dateOfBirth: '2010-01-01', isActive: true }, 'underage'],
    ['sell review', { activeReviews: { review: { active: true, scope: 'sell' } } }, null, 'review_required'],
    ['account closure', { accountClosure: { phase: 'paused' } }, null, 'account_closing'],
  ])('still refuses %s and records the publication criteria without an activity requirement', async (_label, profile, user, reason) => {
    fs.setDoc('eligibility_profiles/seller', profile as Record<string, unknown> | null);
    if (user) fs.setDoc('users/seller', user as Record<string, unknown>);
    await expect(call(createArticle, input())).rejects.toMatchObject({ code: 'permission-denied' });
    const refused = fs.writeOps.find(op => op.path.startsWith('automatic_decisions_log/'))!.data;
    expect(refused.reasons).toContain(reason);
    expect(refused.reasons).not.toContain('activity_missing');
    expect(refused.reasons).not.toContain('activity_version_required');
    expect(refused.criteria).toMatchObject({ activityRequirement: 'not_required', sellerRestriction: 'no_declared_professionals' });
    expect(admissionDecisionView({ id: 'refusal', updateTime: Timestamp.now(), data: () => refused } as any).criteria)
      .toMatchObject({ activityRequirement: 'not_required', sellerRestriction: 'no_declared_professionals' });
    expect(fs.writeOps.some(op => op.path.startsWith('articles/'))).toBe(false);
    expect(h.promotions).toBe(0);
  });

  it('keeps suspended accounts closed to new publication', async () => {
    fs.setDoc('eligibility_profiles/seller', null);
    fs.setDoc('users/seller', { dateOfBirth: '1990-01-01', isActive: false });
    expect(ownerEligibilityDto({ ownerId: uid, user: fs.getDoc('users/seller')!, profile: null }).publication)
      .toMatchObject({ allowed: false, reasons: ['account_unavailable'] });
    await expect(call(createArticle, input())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps.some(op => op.path.startsWith('articles/'))).toBe(false);
  });

  it('rechecks publication after media work before committing the listing', async () => {
    fs.setDoc('eligibility_profiles/seller', null);
    h.afterPromotion = () => fs.setDoc('eligibility_profiles/seller', { activityDeclaration: { kind: 'professional' } });
    await expect(call(createArticle, input())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(h.promotions).toBe(1);
    expect(fs.writeOps.some(op => op.path.startsWith('articles/'))).toBe(false);
    expect(fs.writeOps.find(op => op.path.startsWith('automatic_decisions_log/'))?.data.reasons).toEqual(['professional_declared']);
  });

  it.each(['updateArticle', 'relistArticle'])('reads the native %s refusal with the publication-specific restriction', async operation => {
    const { articleId } = await call(createArticle, input());
    if (operation === 'relistArticle') await markSold(articleId, true, 'sold-before-refusal');
    fs.setDoc('eligibility_profiles/seller', { activityDeclaration: { kind: 'professional' } });
    const attempt = operation === 'updateArticle' ? call(updateArticle, { articleId, updates: { price: 23 } })
      : markSold(articleId, false, 'refused-relist');
    await expect(attempt).rejects.toMatchObject({ code: 'permission-denied' });
    const refused = fs.writeOps.find(op => op.path.startsWith('automatic_decisions_log/'))!.data;
    expect(admissionDecisionView({ id: 'refusal', updateTime: Timestamp.now(), data: () => refused } as any))
      .toMatchObject({ operation, criteria: { activityRequirement: 'not_required', sellerRestriction: 'no_declared_professionals' } });
  });

  async function publicationRefusal() {
    fs.setDoc('eligibility_profiles/seller', { activityDeclaration: { kind: 'professional' } });
    await call(createArticle, input()).catch(() => undefined);
    return fs.writeOps.find(op => op.path.startsWith('automatic_decisions_log/'))!.data;
  }

  it('preserves historical publication refusals without manufacturing the new criterion', async () => {
    const data = await publicationRefusal();
    const { sellerRestriction: _sellerRestriction, ...criteria } = data.criteria as Record<string, unknown>;
    const historical = { ...data, policyVersion: ELIGIBILITY_POLICY_VERSION, criteria: { ...criteria, activityRequirement: 'personal' },
      reasons: ['activity_missing'], messages: [ELIGIBILITY_REASON_MESSAGES.activity_missing] };
    const view = admissionDecisionView({ id: 'historical-refusal', updateTime: Timestamp.now(), data: () => historical } as any);
    expect(view.criteria.activityRequirement).toBe('personal');
    expect(view.criteria).not.toHaveProperty('sellerRestriction');
    expect(view.reasons).toEqual(['activity_missing']);
  });

  it('rejects a publication policy transplanted to a different operation, scope, protocol, version or contradictory criterion', async () => {
    const data = await publicationRefusal(), criteria = data.criteria as Record<string, unknown>;
    const malformed = [
      { operation: 'acceptMeetupOffer', sourceContext: { kind: 'meetup_offer', chatId: 'chat', messageId: 'offer', articleId: 'article', offerSourceHash: 'a'.repeat(64) } },
      { scope: 'buy' }, { protocol: 'admission_refused_v2' }, { policyVersion: ELIGIBILITY_POLICY_VERSION },
      { criteria: { ...criteria, activityRequirement: 'personal' } },
      { criteria: { ...criteria, sellerRestriction: 'all_sellers' } },
      { criteria: { ...criteria, sellerRestriction: undefined } },
      { reasons: ['activity_missing'], messages: [ELIGIBILITY_REASON_MESSAGES.activity_missing] },
    ];
    for (const override of malformed) expect(() => admissionDecisionView({ id: 'refusal', updateTime: Timestamp.now(),
      data: () => ({ ...data, ...override }) } as any)).toThrow();
  });
});

describe('published listing content without seller questionnaires', () => {
  it('publishes without the removed DTO fields, records content and atomically reserves its stock', async () => {
    const result = await call(createArticle,input()), article = fs.getDoc('articles/' + result.articleId)!;
    for (const field of removed) expect(article).not.toHaveProperty(field);
    expect(article).not.toHaveProperty('brand');
    expect(article.saleDeclaration).toMatchObject({ version: 'listing_content_v2', source: 'seller_publication', scope: 'single_listing' });
    for (const field of ['accepted', 'saleUnit', 'counterfeitStatus']) expect(article.saleDeclaration).not.toHaveProperty(field);
    expect(result.saleDeclarationView.qualification).toBe('matching_listing_content');
    expect(() => assertArticleSaleDeclaration(result.articleId,article)).not.toThrow();
    const writes = fs.writeOps.length;
    expect(await call(createArticle,input())).toMatchObject({ articleId: result.articleId, replayed: true });
    expect(fs.writeOps.length).toBe(writes); expect(h.promotions).toBe(1);
    await withFinancialRecoveryScope({operation:'callable/products.updateArticle'}, () => fs.db.runTransaction(async tx => {
      const admitted = await assertNewMeetupAdmission(tx as any,'buyer',uid,'buyer',result.articleId);
      (await planInventoryAcquire(tx as any,result.articleId,admitted,
        { kind: 'purchase', id: 'purchase', sourceArticleId: result.articleId })).commit();
    }));
    await expect(fs.db.runTransaction(tx => planInventoryAcquire(tx as any,result.articleId,fs.getDoc('articles/' + result.articleId)!,
      { kind: 'purchase', id: 'duplicate', sourceArticleId: result.articleId }))).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(call(updateArticle,{ articleId: result.articleId, updates: { price: 24 } })).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('edits a brand alone without a brand status, and resumes the same technical edit', async () => {
    const { articleId } = await call(createArticle,input());
    const before = fs.getDoc('articles/' + articleId)!;
    const updates = { brand: 'zara', description:'Le même pull, décrit plus précisément.', condition:'bon état',
      expectedSaleDeclarationContentHash: saleDeclarationContentHash(articleId,before) };
    const result = await call(updateArticle,{ articleId, updates });
    expect(fs.getDoc('articles/' + articleId)).toMatchObject({ brand: 'Zara' });
    expect(result.saleDeclarationView.qualification).toBe('matching_listing_content');
    const writes = fs.writeOps.length;
    expect(await call(updateArticle,{ articleId, updates })).toMatchObject({ replayed: true });
    expect(fs.writeOps.length).toBe(writes);
    for (const field of removed) expect(fs.getDoc('articles/' + articleId)).not.toHaveProperty(field);
    await expect(call(updateArticle,{ articleId, updates: { ...updates, brand: 'Nike' } }))
      .rejects.toMatchObject({ code: 'aborted' });
  });

  it.each([1,2,3,4,5])('keeps an exact historical publication V%s receipt before current validation', async version => {
    const data = { ...input(), saleDeclaration: { version: 'personal_item_v3', accepted: true, saleUnit: 'single_article', counterfeitStatus: 'not_counterfeit' },
      brandStatus: 'known', brand: 'Zara', hasAlterations: false, alterationsDescription: null,
      hasKnownDefects:false, defectsDescription:null, inventoryUnitDeclaration: { kind: 'new_unit' } };
    const articleId = createHash('sha256').update(`${uid}:${data.clientRequestId}`).digest('hex').slice(0,20);
    const fields = version === 5 ? PUBLICATION_V5_INPUT_FIELDS : version === 4 ? [...PUBLICATION_INPUT_FIELDS,'inventoryUnitDeclaration'] : version === 3 ? PUBLICATION_INPUT_FIELDS :
      version === 2 ? PUBLICATION_V2_INPUT_FIELDS : LEGACY_PUBLICATION_INPUT_FIELDS;
    fs.setDoc('articles/' + articleId,{ sellerId: uid, title: data.title, publicationRequestVersion: version,
      publicationRequestHash: commercialRequestHash(data,fields) });
    expect(await call(createArticle,data)).toMatchObject({ articleId, replayed: true });
    expect(h.promotions).toBe(0); expect(fs.writeOps).toHaveLength(0);
    await expect(call(createArticle,{ ...data, title: 'Autre contenu' })).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('binds the technical receipt to current content without claiming authenticity', () => {
    const article = { sellerId: uid, ...input() };
    const receipt = recordArticleListingContent('a',article,uid,'a'.repeat(64),null);
    const native = { ...article, saleDeclaration: receipt };
    expect(articleSaleDeclarationView('a',native).qualification).toBe('matching_listing_content');
    expect(() => assertArticleSaleDeclaration('a',{ ...native, title: 'Contenu remplacé' })).toThrow();
    expect(() => assertArticleSaleDeclaration('a',{ ...native, saleDeclaration: { ...receipt, accepted: true } })).toThrow();
  });

  it('recovers an actual legacy V3 edit with child-safety input without a requestVersion flag', async () => {
    const saleDeclaration = {version:'personal_item_v3',accepted:true,saleUnit:'single_article',counterfeitStatus:'not_counterfeit'};
    const article = { ...input(), sellerId:uid, saleUnit:'single_article',counterfeitStatus:'not_counterfeit',isActive:true,isSold:false };
    const updates = { title:article.title, childSafetyDeclaration:null, saleDeclaration, expectedSaleDeclarationContentHash:'b'.repeat(64) };
    const requestHash = commercialRequestHash(updates,[...PUBLICATION_INPUT_FIELDS,'expectedSaleDeclarationContentHash','isActive']);
    expect(requestHash).not.toBe(commercialRequestHash(updates,[...PUBLICATION_V2_INPUT_FIELDS,'expectedSaleDeclarationContentHash','isActive']));
    const receipt = declaredArticleSale('legacy',article,uid,saleDeclaration,requestHash,updates.expectedSaleDeclarationContentHash);
    expect(receipt).not.toHaveProperty('requestVersion');
    fs.setDoc('articles/legacy',{...article,saleDeclaration:receipt});
    expect(await call(updateArticle,{articleId:'legacy',updates})).toMatchObject({replayed:true,
      saleDeclarationView:{qualification:'matching_seller_statement',declaration:{version:'personal_item_v3',requestHash}}});
    expect(fs.writeOps).toHaveLength(0);
    expect(fs.getDoc('articles/legacy')?.saleDeclaration).toEqual(receipt);
  });

  it('preserves V1 defect content and its native V5 edit receipt while new edits retire the questionnaire', async () => {
    const article = {...input(),sellerId:uid,isActive:true,isSold:false,hasKnownDefects:true,defectsDescription:'Marque sur la manche.'};
    const previousContentHash = 'b'.repeat(64);
    const updates = {description:article.description,hasKnownDefects:true,defectsDescription:article.defectsDescription,
      expectedSaleDeclarationContentHash:previousContentHash};
    const requestHash = commercialRequestHash(updates,[...PUBLICATION_V5_INPUT_FIELDS,'expectedSaleDeclarationContentHash','isActive']);
    const receipt = {schemaVersion:1,version:'listing_content_v1',scope:'single_listing',source:'seller_publication',
      articleId:'legacy',actorUid:uid,quantity:1,declaredAt:Timestamp.now(),requestHash,previousContentHash,
      contentHash:saleDeclarationContentHash('legacy',article,'listing_content_v1')};
    const native = {...article,saleDeclaration:receipt};
    const legacyContent = saleDeclarationContent(native);
    expect(legacyContent).toMatchObject({hasKnownDefects:true,defectsDescription:article.defectsDescription});
    expect(shippingItemProjection(native)).toMatchObject({hasKnownDefects:true,defectsDescription:article.defectsDescription,listingContentVersion:'listing_content_v1'});
    fs.setDoc('articles/legacy',native);
    expect(await call(updateArticle,{articleId:'legacy',updates})).toMatchObject({replayed:true,
      saleDeclarationView:{qualification:'matching_listing_content',declaration:{version:'listing_content_v1',requestHash}}});
    expect(fs.writeOps).toHaveLength(0);
    expect(saleDeclarationContent(fs.getDoc('articles/legacy')!)).toEqual(legacyContent);
  });

  it('permits delivery listings only on Dev while financial rails stay shut and meetup cannot replace shipping', async () => {
    vi.stubEnv('SECONDE_ENV','development'); vi.stubEnv('SHIPPING_ENABLED','false'); vi.stubEnv('PAYMENTS_ENABLED','false');
    const shippingInput = {...input(),isHandDelivery:false,isShipping:true,packageSize:'medium'};
    vi.stubEnv('FUNCTIONS_EMULATOR','true'); expect(canOfferShipping()).toBe(false);
    vi.stubEnv('FUNCTIONS_EMULATOR','false');
    expect(canOfferShipping()).toBe(true);
    const {articleId} = await call(createArticle,shippingInput);
    expect(fs.getDoc('articles/'+articleId)).toMatchObject({isHandDelivery:false,isShipping:true});
    expect(isShippingEnabled()).toBe(false); expect(isPaymentsEnabled()).toBe(false);
    await expect(fs.db.runTransaction(tx=>assertNewMeetupAdmission(tx as any,'buyer',uid,'buyer',articleId)))
      .rejects.toMatchObject({code:'failed-precondition'});
    const edited = await call(createArticle,{...input(),clientRequestId:'listing-to-edit'});
    await call(updateArticle,{articleId:edited.articleId,updates:{isHandDelivery:false,isShipping:true,packageSize:'medium'}});
    expect(fs.getDoc('articles/'+edited.articleId)).toMatchObject({isHandDelivery:false,isShipping:true});
    vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6'); vi.stubEnv('FIREBASE_CONFIG',JSON.stringify({projectId:'seconde-b47a6'}));
    vi.stubEnv('SECONDE_ENV','production');
    expect(canOfferShipping()).toBe(false);
    await expect(call(createArticle,{...shippingInput,clientRequestId:'new-production-listing',images:[{
      url:shippingInput.images[0].url.replace('seconde-dev.firebasestorage.app','seconde-b47a6.firebasestorage.app')}]}))
      .rejects.toMatchObject({code:'failed-precondition'});
    await expect(call(updateArticle,{articleId:edited.articleId,updates:{isHandDelivery:false,isShipping:true}}))
      .rejects.toMatchObject({code:'failed-precondition'});
  });
});
