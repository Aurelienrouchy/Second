/**
 * FR15 — un article déposé dans la Swap Zone par quelqu'un qui n'en est pas le
 * vendeur privait son vrai propriétaire : la garde anti-doublon
 * (partyId, articleId) refusait ensuite SON dépôt. La règle Firestore ferme
 * désormais la porte ; restent les documents déjà déposés en production.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';
import { Timestamp } from 'firebase-admin/firestore';
import { declaredArticleSale } from '../utils/articleSaleDeclaration';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION, QUEBEC_RESIDENCE_DECLARATION_VERSION, QUEBEC_RESIDENCE_STATEMENT, evaluateSwapLaunch } from '../shared/eligibility';
import { SWAP_AGREEMENT_PROTOCOL } from '../utils/swapLaunchPolicy';
import { assertArticleNotSwapEngaged } from '../utils/articleSwapEngagement';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as StripeMock | null,
  promote: null as null | (() => void),
  promotions: 0,
}));
const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
holder.fs = fs;
holder.stripe = stripeMock;

vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) },
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));
vi.mock('../config/stripe', () => ({ getStripe: () => holder.stripe!.client }));
vi.mock('../utils/fees', () => ({
  calculateFees: () => ({ serviceFee: 0, serviceFeePercent: 0, buyerTotal: 0 }),
}));
vi.mock('../utils/articleMedia', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/articleMedia')>(),
  promoteArticleImages: async (images: unknown) => { holder.promotions++; holder.promote?.(); return images; },
}));
vi.mock('../services/brands', () => ({ matchBrand: async () => ({ brandName: null }), BRAND_MATCHING: { autoSelectThreshold: 1 } }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('./wallet', () => ({ getOrCreateSellerWallet: async () => ({}) }));
vi.mock('./reviews', () => ({ updateUserRating: async () => {} }));
vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {},
  prepareOperationalNotices: async (...args: any[]) => {
    const actual = await vi.importActual<typeof import('../utils/notifications')>('../utils/notifications');
    return actual.prepareOperationalNotices(args[0], args[1]);
  } }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_options: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));
vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string, public details?: unknown) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  }
  return { onCall: (_opts: unknown, handler: unknown) => handler, HttpsError: _HttpsError };
});

type Callable = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
let handlers: typeof import('./swaps');
let eligibilityHandlers: typeof import('./eligibility');
let proposalCanAutoExpire: typeof import('../scheduled/swaps')['proposalCanAutoExpire'];
let assertNewMeetupAdmission: typeof import('../utils/tradeAdmission')['assertNewMeetupAdmission'];
beforeAll(async () => {
  handlers = await import('./swaps'); eligibilityHandlers = await import('./eligibility');
  ({ proposalCanAutoExpire } = await import('../scheduled/swaps'));
  ({ assertNewMeetupAdmission } = await import('../utils/tradeAdmission'));
});
const call: Callable = request => (handlers.addItemToPartySecure as unknown as Callable)(request);

const ALICE = 'alice';

const publicationInput = () => ({ clientRequestId: 'native-publication-k19', title: 'Un pull personnel', description: 'Pull en coton porté une fois.',
  quantity: 1, price: 20, condition: 'très bon état', size: { value: 'M', system: 'EU' }, brandStatus: 'unknown',
  hasKnownDefects: false, defectsDescription: null, hasAlterations: false, alterationsDescription: null,
  images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Falice%2Fd%2Fa.jpg?alt=media' }],
  categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'],
  isHandDelivery: true, isShipping: false, neighborhoods: [{ id: 'n', name: 'Quartier', borough: 'Ville' }],
  saleDeclaration: { version: 'personal_item_v2', accepted: true, saleUnit: 'single_article' } });
const publishK19 = async (extra = {}) => {
  const { createArticle } = await import('./products');
  return (createArticle as any)({ auth: { uid: ALICE, token: { auth_time: Math.floor(Date.now() / 1000), email_verified: true } }, data: { expectedUid: ALICE, ...publicationInput(), ...extra } });
};

describe('K19 publication refusals', () => {
  it('records and deduplicates the exact own preflight refusal without copying images', async () => {
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01', isActive: true });
    const first = await publishK19().catch(error => error);
    expect(first).toMatchObject({ details: { reason: 'admission_refused' } });
    const logs = fs.writeOps.filter(op => op.path.startsWith('automatic_decisions_log/'));
    expect(logs).toHaveLength(1); expect(holder.promotions).toBe(0);
    expect(logs[0].data).toMatchObject({ operation: 'createArticle', scope: 'sell', sourceContext: {
      kind: 'article_publication', publicationRequestId: 'native-publication-k19' } });
    expect(JSON.stringify(logs[0].data)).not.toMatch(/Un pull personnel|coton|https|drafts|2010-01-01/);
    const writes = fs.writeOps.length;
    await expect(publishK19()).rejects.toMatchObject({ details: { decisionId: first.details.decisionId } });
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('does not journal malformed publication inputs or another owner’s photo namespace', async () => {
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01', isActive: true });
    await expect(publishK19({ description: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(publishK19({ neighborhoods: [{ id: 'n' }] })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(publishK19({ images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fbob%2Fd%2Fa.jpg?alt=media' }] }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(0); expect(holder.promotions).toBe(0);
  });
  it('commits a final refusal after preparation, retains prepared media, and never returns a publication success', async () => {
    holder.promote = () => fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01', isActive: true });
    await expect(publishK19()).rejects.toMatchObject({ details: { reason: 'admission_refused' } });
    expect(holder.promotions).toBe(1);
    const log = fs.writeOps.find(op => op.path.startsWith('automatic_decisions_log/'))!;
    expect(log).toBeDefined();
    const articleId = (log.data.sourceContext as any).articleId;
    expect(fs.getDoc('articles/' + articleId)).toBeUndefined();
    expect(fs.writeOps.some(op => op.method === 'delete')).toBe(false);
    holder.promote = null; fs.setDoc('users/' + ALICE, { dateOfBirth: '2000-01-01', isActive: true });
    const created = await publishK19(); expect(created.articleId).toBe(articleId);
    fs.setDoc('users/' + ALICE, null); fs.setDoc('eligibility_profiles/' + ALICE, null);
    const writes = fs.writeOps.length, copies = holder.promotions;
    await expect(publishK19()).resolves.toMatchObject({ articleId });
    expect(fs.writeOps).toHaveLength(writes); expect(holder.promotions).toBe(copies);
    expect(fs.getDoc(log.path)).toEqual(log.data);
  });
  it('rejects contradictory native age criteria rather than treating an underage refusal as adult', async () => {
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01', isActive: true });
    await publishK19().catch(() => undefined);
    const log = fs.writeOps.find(op => op.path.startsWith('automatic_decisions_log/'))!;
    const { admissionDecisionView } = await import('../utils/supportRequest');
    const source = { id: log.path.split('/')[1], updateTime: Timestamp.now(), data: () => log.data } as any;
    expect(admissionDecisionView(source).criteria.ageCondition).toBe('under18');
    for (const override of [{ ageCondition: 'adult_declared' }, { activityRequirement: 'personal' }, { residenceRequirement: 'quebec_owner_declaration' }]) {
      expect(() => admissionDecisionView({ ...source, data: () => ({ ...log.data, criteria: { ...(log.data.criteria as any), ...override } }) })).toThrow();
    }
  });
});

const seedReleaseK19 = () => {
  const due = Timestamp.fromMillis(Date.now() - 10_000), delivered = Timestamp.fromMillis(Date.now() - 8 * 86_400_000);
  fs.setDoc('transactions/k19-sale', { articleId: 'a1', sellerId: ALICE, buyerId: 'bob', status: 'delivered', currency: 'CAD',
    amount: 45, sellerPayout: 45, sellerCreditedCents: 4500, sellerPendingCreditCents: 4500, sellerHeldCreditCents: 4500,
    deliveredAt: delivered, fundsReleaseAt: due, disputed: false });
  fs.setDoc('wallets/' + ALICE, { currency: 'CAD', balance: 100, pendingBalance: 0, heldBalance: 4500, sellerDebt: 500 });
  fs.setDoc('wallets/' + ALICE + '/ledger/k19-held', { transactionId: 'k19-sale', type: 'funds_held', amount: 4500, currency: 'CAD', createdAt: delivered });
  return due;
};
async function releaseK19(options: { failDecision?: boolean; changeOnOrderRead?: (count: number) => void } = {}) {
  const collection = fs.db.collection.bind(fs.db), run = fs.db.runTransaction.bind(fs.db);
  // This old harness lacks endAt/getAll/native revisions. The controlled
  // fixture contains one order, so its inclusive upper ID bound is that order.
  const bounded = (value: any): any => new Proxy(value, { get(target, key) {
    if (key === 'endAt') return () => bounded(target);
    const property = target[key];
    return typeof property !== 'function' ? property : ['where', 'orderBy', 'limit', 'startAfter'].includes(String(key))
      ? (...args: any[]) => bounded(property(...args)) : property.bind(target);
  } });
  fs.db.collection = name => bounded(collection(name));
  let reads = 0;
  fs.db.runTransaction = fn => run(async tx => {
    const get = async (target: any) => {
      if (target.path === 'transactions/k19-sale') options.changeOnOrderRead?.(++reads);
      const snap = await tx.get(target);
      return target.path && 'exists' in snap && snap.exists ? { ...snap, updateTime: Timestamp.now() } : snap;
    };
    return fn({ ...tx, get: get as typeof tx.get, getAll: (...refs: any[]) => Promise.all(refs.map(get)),
      create: (ref: any, value: any) => {
        if (options.failDecision && ref.path.startsWith('automatic_decisions_log/')) throw new Error('Simulated decision write failure');
        tx.create(ref, value);
      } } as any);
  });
  try {
    const { releaseHeldFunds } = await import('../scheduled/releaseHeldFunds');
    await (releaseHeldFunds as unknown as () => Promise<void>)();
  } finally { fs.db.collection = collection; fs.db.runTransaction = run; }
}
describe('K19 release journal atomicity', () => {
  it('commits the native explanation with money, order and notices, once only', async () => {
    const oldDue = seedReleaseK19(), newDue = Timestamp.fromMillis(oldDue.toMillis() + 1000);
    await releaseK19({ changeOnOrderRead: count => {
      if (count === 2) fs.setDoc('transactions/k19-sale', { ...fs.getDoc('transactions/k19-sale'), fundsReleaseAt: newDue });
    } });
    expect(fs.getDoc('wallets/' + ALICE)).toMatchObject({ balance: 4100, heldBalance: 0, sellerDebt: 0 });
    expect(fs.getDoc('transactions/k19-sale')).toMatchObject({ status: 'completed', sellerReleasedCents: 4500 });
    const logs = fs.writeOps.filter(op => op.path.startsWith('automatic_decisions_log/'));
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toMatchObject({ transactionId: 'k19-sale', userId: ALICE, decisionType: 'funds_released',
      criteria: { status: 'delivered', disputed: false, fundsReleaseAt: newDue.toDate().toISOString(), releasedCents: 4500 } });
    expect(fs.writeOps.filter(op => op.path.startsWith('operational_notice_receipts/'))).toHaveLength(2);
    expect(JSON.stringify(logs[0].data)).not.toMatch(/sellerDebt|debtRepayment|toBalance/);
    await releaseK19();
    expect(fs.writeOps.filter(op => op.path.startsWith('automatic_decisions_log/'))).toHaveLength(1);
  });
  it('a failed decision write rolls back money, status and notices; an ordinary retry commits the whole effect', async () => {
    seedReleaseK19();
    await releaseK19({ failDecision: true });
    expect(fs.getDoc('wallets/' + ALICE)).toMatchObject({ balance: 100, heldBalance: 4500, sellerDebt: 500 });
    expect(fs.getDoc('transactions/k19-sale')!.status).toBe('delivered');
    expect(fs.writeOps.some(op => op.path.startsWith('automatic_decisions_log/') || op.path.startsWith('operational_notice_receipts/'))).toBe(false);
    await releaseK19();
    expect(fs.getDoc('wallets/' + ALICE)).toMatchObject({ balance: 4100, heldBalance: 0, sellerDebt: 0 });
    expect(fs.writeOps.filter(op => op.path.startsWith('automatic_decisions_log/'))).toHaveLength(1);
  });
});

beforeEach(() => {
  fs.reset();
  holder.promote = null; holder.promotions = 0;
  fs.setDoc('swapParties/zone-1', { itemsCount: 1, isActive: true });
  for (const uid of [ALICE, 'bob']) {
    fs.setDoc('users/' + uid, { dateOfBirth: '2000-01-01', isActive: true });
    fs.setDoc('eligibility_profiles/' + uid, { version: 1,
      activityDeclaration: { kind: 'personal', actorUid: uid, recordedAt: Timestamp.now(), declarationVersion: 1,
        statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS.personal },
      quebecResidenceDeclaration: { version: QUEBEC_RESIDENCE_DECLARATION_VERSION, country: 'CA', province: 'QC',
        ownerId: uid, actorUid: uid, source: 'owner_declaration', residenceVerified: false, accepted: true,
        statement: QUEBEC_RESIDENCE_STATEMENT, recordedAt: Timestamp.now(), recordedAtMs: Date.now() } });
  }
  for (const [id, sellerId] of [['a1', ALICE], ['b1', 'bob']]) {
    const article = { sellerId, isActive: true, isSold: false, title: 'Pull', price: 20, images: [{ url: 'https://example.test/item.jpg' }],
      categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'], condition: 'good', quantity: 1, saleUnit: 'single_article' };
    fs.setDoc('articles/' + id, { ...article, saleDeclaration: declaredArticleSale(id, article, sellerId,
      { version: 'personal_item_v2', accepted: true, saleUnit: 'single_article' }, 'a'.repeat(64), null) });
  }
});

const invoke = (fn: unknown, data: Record<string, unknown>, uid = ALICE) => (fn as Callable)({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid }, data });
const previewInput = (extra = {}) => ({ operation: 'swap_proposal_preview', expectedUid: ALICE, receiverId: 'bob',
  initiatorArticleIds: ['a1'], receiverArticleIds: ['b1'], exchangeMode: 'hand_delivery', arrangements: 'Samedi à Québec.', message: 'Bonjour', ...extra });
async function preview(extra = {}) {
  const result = await invoke(eligibilityHandlers.getMyEligibility, previewInput(extra));
  return result.swapProposalPreview as any;
}
async function propose(extra = {}) {
  const source = await preview(extra);
  const result = await invoke(handlers.proposeMultiSwap, { initiatorId: ALICE, initiatorName: 'Alice', receiverId: 'bob', receiverName: 'Bob',
    initiatorItems: [{ articleId: 'a1', title: 'Forgé', price: 999 }], receiverItems: [{ articleId: 'b1' }], expectedUid: ALICE,
    exchangeMode: source.exchangeMode, arrangements: source.arrangements, message: source.message,
    agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash, ...extra });
  const swapId = result.swapId as string, persisted = fs.getDoc('swaps/' + swapId)!;
  // This harness represents serverTimestamp as a sentinel. The production
  // source marker check expects the actual committed Admin Timestamp.
  fs.setDoc('swaps/' + swapId, { ...persisted, createdAt: Timestamp.now() });
  return { source, swapId };
}

describe('Troc launch admission and immutable agreement', () => {
  it('uses the Québec civil birthday and rejects missing/invalid DOB, professional, inactive and unbound declarations', () => {
    const now = new Date('2026-10-18T02:00:00Z'); // still Oct17 in Québec
    const evidence = { ownerId: ALICE, user: fs.getDoc('users/' + ALICE)!, profile: fs.getDoc('eligibility_profiles/' + ALICE)! };
    expect(evaluateSwapLaunch({ ...evidence, user: { ...evidence.user, dateOfBirth: '2008-10-17' } }, now).allowed).toBe(true);
    for (const dateOfBirth of ['2008-10-18', null, '2000-02-30', '2027-01-01']) expect(evaluateSwapLaunch({ ...evidence,
      user: { ...evidence.user, dateOfBirth } }, now).allowed).toBe(false);
    expect(evaluateSwapLaunch({ ...evidence, user: { ...evidence.user, isActive: false } }, now).allowed).toBe(false);
    expect(evaluateSwapLaunch({ ...evidence, user: null }, now).allowed).toBe(false);
    expect(evaluateSwapLaunch({ ...evidence, profile: { ...evidence.profile, activityDeclaration: { ...evidence.profile.activityDeclaration,
      kind: 'professional', statement: SELLER_ACTIVITY_STATEMENTS.professional } } }, now).allowed).toBe(false);
    expect(evaluateSwapLaunch({ ...evidence, profile: { ...evidence.profile, activityDeclaration: { ...evidence.profile.activityDeclaration, actorUid: 'bob' } } }, now).allowed).toBe(false);
    expect(evaluateSwapLaunch({ ...evidence, profile: { ...evidence.profile, quebecResidenceDeclaration: null,
      sellerQuebecEvidence: { status: 'observed', source: 'stripe_account_observed', province: 'QC' } } }, now).allowed).toBe(false);
  });
  it('previews without writes and binds the exact native articles, message and arrangements', async () => {
    const source = await preview();
    expect(fs.writeOps).toHaveLength(0);
    expect(source).toMatchObject({ protocol: SWAP_AGREEMENT_PROTOCOL, scope: 'new_proposal', message: 'Bonjour' });
    expect((await preview({ message: 'Différent' })).sourceHash).not.toBe(source.sourceHash);
    expect((await preview({ arrangements: 'Dimanche' })).sourceHash).not.toBe(source.sourceHash);
    const { swapId } = await propose();
    expect((fs.getDoc('swaps/' + swapId)!.initiatorItems as any[])[0]).toMatchObject({ title: 'Pull', price: 20 });
    expect(fs.getDoc('swaps/' + swapId)!.exchangeAgreement).toMatchObject({ sourceHash: source.sourceHash, receiverAcknowledgement: null });
  });
  it('rejects session changes, duplicate items and more than twenty items before writing', async () => {
    await expect(preview({ expectedUid: 'bob' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(preview({ initiatorArticleIds: ['a1', 'a1'] })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(preview({ initiatorArticleIds: Array.from({ length: 21 }, (_, i) => String(i)) })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('commits one own proposal refusal, deduplicates it, and preserves it after admission becomes favourable', async () => {
    const source = await preview(), data = { initiatorId: ALICE, initiatorName: 'Alice', receiverId: 'bob', receiverName: 'Bob',
      initiatorItems: [{ articleId: 'a1' }], receiverItems: [{ articleId: 'b1' }], expectedUid: ALICE,
      exchangeMode: source.exchangeMode, arrangements: source.arrangements, message: source.message,
      agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash };
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01', isActive: true });
    const first = await invoke(handlers.proposeMultiSwap, data).catch(error => error);
    expect(first).toMatchObject({ code: 'permission-denied', details: { reason: 'admission_refused', automated: true } });
    const logs = fs.writeOps.filter(op => op.path.startsWith('automatic_decisions_log/'));
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toMatchObject({ protocol: 'admission_refused_v1', ownerId: ALICE, userId: ALICE,
      transactionId: null, operation: 'proposeMultiSwap', reasons: ['underage'], financialEffect: 'none' });
    expect(JSON.stringify(logs[0].data)).not.toMatch(/2010-01-01|quebecResidenceDeclaration|internalNote/);
    expect(fs.writeOps.some(op => op.path.startsWith('swaps/'))).toBe(false);
    const written = fs.writeOps.length;
    await expect(invoke(handlers.proposeMultiSwap, data)).rejects.toMatchObject({ details: { decisionId: first.details.decisionId } });
    expect(fs.writeOps).toHaveLength(written);
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2000-01-01', isActive: true });
    await expect(invoke(handlers.proposeMultiSwap, data)).resolves.toMatchObject({ success: true });
    expect(fs.getDoc(logs[0].path)).toEqual(logs[0].data);
  });
  it('never journals an unowned proposal source, a stale acknowledgement, or a read-only refusal', async () => {
    const source = await preview(), data = { initiatorId: ALICE, initiatorName: 'Alice', receiverId: 'bob', receiverName: 'Bob',
      initiatorItems: [{ articleId: 'a1' }], receiverItems: [{ articleId: 'b1' }], expectedUid: ALICE,
      exchangeMode: source.exchangeMode, arrangements: source.arrangements, message: source.message,
      agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash };
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01', isActive: true });
    await expect(preview()).rejects.toMatchObject({ details: { reason: 'swap_eligibility_required' } });
    await expect(invoke(handlers.proposeMultiSwap, { ...data, expectedSourceHash: '0'.repeat(64) })).rejects.toMatchObject({ details: { reason: 'swap_agreement_stale' } });
    await expect(invoke(handlers.proposeMultiSwap, { ...data, initiatorItems: [{ articleId: 'b1' }], receiverItems: [{ articleId: 'a1' }] })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it.each([['missing', null, 'missing'], ['invalid', { dateOfBirth: '2000-02-30' }, 'invalid']] as const)(
    'does not label an own %s birth-date source as adult', async (_name, user, ageCondition) => {
      const source = await preview(), data = { initiatorId: ALICE, initiatorName: 'Alice', receiverId: 'bob', receiverName: 'Bob',
        initiatorItems: [{ articleId: 'a1' }], receiverItems: [{ articleId: 'b1' }], expectedUid: ALICE,
        exchangeMode: source.exchangeMode, arrangements: source.arrangements, message: source.message,
        agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash };
      fs.setDoc('users/' + ALICE, user);
      await expect(invoke(handlers.proposeMultiSwap, data)).rejects.toMatchObject({ details: { reason: 'admission_refused' } });
      const log = fs.writeOps.find(op => op.path.startsWith('automatic_decisions_log/'))!.data;
      expect(log.criteria).toMatchObject({ ageCondition, ageVerified: false });
    });
  it('journals receiver admission before any new acceptance, but exact accepted history stays readable without a profile', async () => {
    const { source, swapId } = await propose(), data = { swapId, expectedUid: 'bob', agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash };
    fs.setDoc('users/bob', { dateOfBirth: '2010-01-01', isActive: true });
    await expect(invoke(handlers.acceptSwap, data, 'bob')).rejects.toMatchObject({ details: { reason: 'admission_refused' } });
    expect(fs.getDoc('swaps/' + swapId)!.status).toBe('proposed');
    expect(fs.writeOps.filter(op => op.path.startsWith('automatic_decisions_log/'))).toHaveLength(1);
    fs.setDoc('users/bob', { dateOfBirth: '2000-01-01', isActive: true });
    await expect(invoke(handlers.acceptSwap, data, 'bob')).resolves.toMatchObject({ status: 'accepted', replay: false });
    const written = fs.writeOps.length;
    fs.setDoc('users/bob', null); fs.setDoc('eligibility_profiles/bob', null);
    await expect(invoke(handlers.acceptSwap, data, 'bob')).resolves.toMatchObject({ status: 'accepted', replay: true });
    expect(fs.writeOps).toHaveLength(written);
  });
  it('keeps own admission logs and exact review available without a profile, with no access for the counterpart', async () => {
    const { source, swapId } = await propose(), data = { swapId, expectedUid: 'bob', agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash };
    fs.setDoc('users/bob', { dateOfBirth: '2010-01-01', isActive: true });
    const refusal = await invoke(handlers.acceptSwap, data, 'bob').catch(error => error);
    const id = refusal.details.decisionId, log = fs.getDoc('automatic_decisions_log/' + id)!;
    fs.setDoc('users/bob', null); fs.setDoc('eligibility_profiles/bob', null);
    const { getAutomatedDecisionLog } = await import('./automatedDecisions');
    await expect(invoke(getAutomatedDecisionLog, { expectedUid: ALICE, operation: 'owner_admission_refusals', decisionId: id }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(invoke(getAutomatedDecisionLog, { expectedUid: 'bob', operation: 'owner_admission_refusals', decisionId: id }, 'bob'))
      .resolves.toMatchObject({ ownerId: 'bob', entries: [{ ownerId: 'bob', transactionId: null, operation: 'acceptSwap' }], completeHistory: false });
    const { decisionView } = await import('../utils/supportRequest'), revision = Timestamp.now();
    const view = decisionView({ id, data: () => log, updateTime: revision } as any)!;
    const { executeSupportOwnerCommand } = await import('./supportRequests'), real = fs.db.runTransaction.bind(fs.db);
    fs.db.runTransaction = fn => real(async tx => fn({ ...tx, get: (async (target: any) => {
      const snap = await tx.get(target);
      return target.path === 'automatic_decisions_log/' + id ? { ...snap, updateTime: revision } : snap;
    }) as typeof tx.get }));
    try {
      const payload = { expectedUid: 'bob', requestId: 'admission-review-owner-0001', mode: 'execute', command: {
        action: 'submit', kind: 'automated_decision_review', transactionId: null,
        decision: { id, revision: view.revision, sourceHash: view.sourceHash }, narrative: 'Je demande l’examen de ma date déclarée.', evidence: [] } };
      const receipt = await executeSupportOwnerCommand({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'bob' }, data: { expectedUid: 'bob', ...(payload) } });
      expect(receipt).toMatchObject({ state: 'committed', admissionVerified: false, rightsRestored: false, financialEffect: 'none',
        request: { ownerId: 'bob', transactionId: null, decision: { id, sourceHash: view.sourceHash } } });
      const written = fs.writeOps.length;
      await expect(executeSupportOwnerCommand({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'bob' }, data: { expectedUid: 'bob', ...payload, mode: 'observe' } })).resolves.toMatchObject({ state: 'committed', replay: true });
      expect(fs.writeOps).toHaveLength(written);
    } finally { fs.db.runTransaction = real; }
  });
  it('records a genuine own cash acceptance refusal without accepting, reserving or exposing the counterpart', async () => {
    const { acceptMeetupOffer } = await import('./payments/meetup');
    fs.setDoc('chats/cash-chat', { participants: [ALICE, 'bob'], articleId: 'a1' });
    fs.setDoc('messages/cash-offer', { type: 'offer', chatId: 'cash-chat', senderId: 'bob',
      offer: { amount: 20, status: 'pending', meetup: { location: { toArrange: true } }, expiresAt: Timestamp.fromMillis(Date.now() + 60_000) } });
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01', isActive: true });
    await expect(invoke(acceptMeetupOffer, { chatId: 'cash-chat', messageId: 'cash-offer' })).rejects.toMatchObject({ details: { reason: 'admission_refused' } });
    const logs = fs.writeOps.filter(op => op.path.startsWith('automatic_decisions_log/'));
    expect(logs).toHaveLength(1);
    expect(logs[0].data).toMatchObject({ operation: 'acceptMeetupOffer', ownerId: ALICE, scope: 'sell',
      sourceContext: { kind: 'meetup_offer', articleId: 'a1', messageId: 'cash-offer', chatId: 'cash-chat' } });
    expect(fs.getDoc('messages/cash-offer')).toMatchObject({ offer: { status: 'pending' } });
    expect(fs.getDoc('articles/a1')!.isSold).toBe(false);
    expect(fs.getDoc('transactions/meetup_cash-offer')).toBeUndefined();
    // A new refusal caused solely by the other participant stays generic and
    // does not manufacture an own decision to contest.
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2000-01-01', isActive: true });
    fs.setDoc('users/bob', { dateOfBirth: '2010-01-01', isActive: true });
    const written = fs.writeOps.length;
    await expect(invoke(acceptMeetupOffer, { chatId: 'cash-chat', messageId: 'cash-offer' })).rejects.toMatchObject({ details: { reason: 'counterparty_unavailable' } });
    expect(fs.writeOps).toHaveLength(written);
  });
  it.each(['hand_delivery', 'shipping'])('requires both parties on the same %s source and prepares without changing it', async exchangeMode => {
    const { source, swapId } = await propose({ exchangeMode });
    const acceptData = { swapId, expectedUid: 'bob', agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash };
    await expect(invoke(handlers.acceptSwap, acceptData, 'bob')).resolves.toMatchObject({ success: true, status: 'accepted', replay: false });
    const before = fs.getDoc('swaps/' + swapId)!.exchangeAgreement;
    const prepare = { swapId, expectedUid: ALICE, exchangeMode, arrangements: source.arrangements,
      agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash };
    await expect(invoke(handlers.setSwapExchangeMode, prepare)).resolves.toMatchObject({ status: 'photos_pending', waitingForCounterpart: false });
    expect(fs.getDoc('swaps/' + swapId)!.exchangeAgreement).toEqual(before);
    const writes = fs.writeOps.length;
    // SDK exact acknowledgement recovery remains possible after profile loss.
    fs.setDoc('users/' + ALICE, null); fs.setDoc('users/bob', null);
    await expect(invoke(handlers.acceptSwap, acceptData, 'bob')).resolves.toMatchObject({ success: true, status: 'photos_pending', replay: true });
    await expect(invoke(handlers.setSwapExchangeMode, prepare)).resolves.toMatchObject({ status: 'photos_pending' });
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('rechecks the current counterpart privately before accepting a new source', async () => {
    const { source, swapId } = await propose();
    fs.setDoc('users/' + ALICE, { dateOfBirth: '2010-01-01' });
    const writes = fs.writeOps.length;
    await expect(invoke(handlers.acceptSwap, { swapId, expectedUid: 'bob', agreementProtocol: SWAP_AGREEMENT_PROTOCOL,
      expectedSourceHash: source.sourceHash }, 'bob')).rejects.toMatchObject({ details: { reason: 'counterparty_unavailable' } });
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('refuses stale native snapshots and unilateral mode changes', async () => {
    const { source, swapId } = await propose();
    fs.setDoc('articles/a1', { ...fs.getDoc('articles/a1'), price: 25 });
    await expect(invoke(handlers.acceptSwap, { swapId, expectedUid: 'bob', agreementProtocol: SWAP_AGREEMENT_PROTOCOL,
      expectedSourceHash: source.sourceHash }, 'bob')).rejects.toMatchObject({ details: { reason: 'swap_agreement_stale' } });
    expect(fs.getDoc('swaps/' + swapId)!.status).toBe('proposed');
  });
  it('keeps historical accepted source and needs two confirmations without new residence/DOB admission', async () => {
    const { swapId } = await propose();
    const legacy = { ...fs.getDoc('swaps/' + swapId)! };
    delete legacy.exchangeAgreement; delete legacy.swapLaunchPolicyVersion;
    fs.setDoc('swaps/' + swapId, { ...legacy, status: 'accepted', exchangeMode: 'shipping' });
    fs.setDoc('articles/a1', null); fs.setDoc('articles/b1', null); fs.setDoc('users/' + ALICE, null); fs.setDoc('users/bob', null);
    const p = await invoke(eligibilityHandlers.getMyEligibility, { operation: 'swap_exchange_preview', expectedUid: ALICE,
      swapId, exchangeMode: 'shipping', arrangements: 'Nous convenons de l’envoi Québec à Québec et des frais dans le chat.' });
    const source = p.swapProposalPreview as any;
    const data = { swapId, exchangeMode: source.exchangeMode, arrangements: source.arrangements,
      agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash, expectedUid: ALICE };
    await expect(invoke(handlers.setSwapExchangeMode, data)).resolves.toMatchObject({ status: 'accepted', waitingForCounterpart: true });
    await expect(invoke(handlers.setSwapExchangeMode, { ...data, expectedUid: 'bob', exchangeMode: 'hand_delivery' }, 'bob')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('swaps/' + swapId)!.status).toBe('accepted');
    await expect(invoke(handlers.setSwapExchangeMode, { ...data, expectedUid: 'bob' }, 'bob')).resolves.toMatchObject({ status: 'photos_pending', waitingForCounterpart: false });
    expect(fs.getDoc('swaps/' + swapId)!.initiatorItems).toEqual(legacy.initiatorItems);
  });
  it('keeps new top-ups closed and blocks deposit without a residence declaration', async () => {
    await expect(preview({ cashTopUp: { amount: 100, payerId: ALICE } })).rejects.toMatchObject({ code: 'failed-precondition' });
    fs.setDoc('eligibility_profiles/' + ALICE, { ...fs.getDoc('eligibility_profiles/' + ALICE), quebecResidenceDeclaration: null });
    await expect(deposit()).rejects.toMatchObject({ details: { reason: 'swap_eligibility_required' } });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('records explicit residence withdrawal with a bound session and preserves it when old declarations omit the field', async () => {
    const owner = await invoke(eligibilityHandlers.getMyEligibility, {});
    const declaration = { kind: 'personal', statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, personalDeclarationAccepted: true,
      expectedVersion: owner.version, requestId: 'withdraw-residence',
      quebecResidenceDeclaration: { version: QUEBEC_RESIDENCE_DECLARATION_VERSION, country: 'CA', province: 'QC', accepted: false } };
    await expect(invoke(eligibilityHandlers.declareSellerActivity, declaration)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(0);
    const result = await invoke(eligibilityHandlers.declareSellerActivity, { ...declaration, expectedUid: ALICE });
    expect(result.eligibility).toMatchObject({ swapLaunch: { allowed: false }, quebecResidenceDeclaration: { accepted: false, residenceVerified: false } });
    const proof = fs.getDoc('eligibility_profiles/' + ALICE)!.quebecResidenceDeclaration;
    await invoke(eligibilityHandlers.declareSellerActivity, { kind: 'personal', statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION,
      personalDeclarationAccepted: true, expectedVersion: (result.eligibility as any).version, requestId: 'old-declaration' });
    expect(fs.getDoc('eligibility_profiles/' + ALICE)!.quebecResidenceDeclaration).toEqual(proof);
  });
  it.each([
    ['alice', { blockedUserIds: ['bob'] }], ['bob', { blockedUserIds: ['alice'] }],
    ['alice', { blockedUsers: [{ userId: 'bob' }] }], ['bob', { blockedUsers: ['alice'] }],
  ])('refuses NEW preview and accept using the transactional block on %s %j', async (uid, fields) => {
    const { source, swapId } = await propose();
    fs.setDoc('users/' + uid, { ...fs.getDoc('users/' + uid), ...(fields as object) });
    const writes = fs.writeOps.length;
    await expect(preview()).rejects.toMatchObject({ details: { reason: 'counterparty_unavailable' } });
    await expect(invoke(handlers.acceptSwap, { swapId, expectedUid: 'bob', agreementProtocol: SWAP_AGREEMENT_PROTOCOL,
      expectedSourceHash: source.sourceHash }, 'bob')).rejects.toMatchObject({ details: { reason: 'counterparty_unavailable' } });
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('refuses a block committed after the outside proposal precheck and before the native transaction', async () => {
    const source = await preview(), real = fs.db.runTransaction.bind(fs.db);
    fs.db.runTransaction = async fn => {
      fs.setDoc('users/bob', { ...fs.getDoc('users/bob'), blockedUserIds: [ALICE] });
      return real(fn);
    };
    try {
      await expect(invoke(handlers.proposeMultiSwap, { initiatorId: ALICE, initiatorName: 'Alice', receiverId: 'bob', receiverName: 'Bob',
        initiatorItems: [{ articleId: 'a1' }], receiverItems: [{ articleId: 'b1' }], expectedUid: ALICE,
        exchangeMode: source.exchangeMode, arrangements: source.arrangements, message: source.message,
        agreementProtocol: SWAP_AGREEMENT_PROTOCOL, expectedSourceHash: source.sourceHash }))
        .rejects.toMatchObject({ details: { reason: 'counterparty_unavailable' } });
      expect(fs.writeOps).toHaveLength(0);
    } finally { fs.db.runTransaction = real; }
  });
  it.each(['hand_delivery', 'shipping'])('only a native never-accepted %s proposal can expire with its precontractual mode', async exchangeMode => {
    const { swapId } = await propose({ exchangeMode });
    const now = Date.now(), old = Timestamp.fromMillis(now - 8 * 24 * 60 * 60 * 1000), cutoff = now - 7 * 24 * 60 * 60 * 1000;
    const proposal = fs.getDoc('swaps/' + swapId)! as any;
    const native = { ...proposal, createdAt: old, articleDeclarationProposalRecordedAt: old,
      exchangeAgreement: { ...proposal.exchangeAgreement,
        initiatorAcknowledgement: { ...proposal.exchangeAgreement.initiatorAcknowledgement, recordedAt: old } } };
    expect(proposalCanAutoExpire(native, cutoff, now)).toBe(true);
    for (const patch of [{ status: 'accepted' }, { acceptedAt: null }, { initiatorPhotos: null }, { topUpPaidAt: null },
      { exchangeAgreement: { ...native.exchangeAgreement, receiverAcknowledgement: undefined } },
      { exchangeAgreement: { ...native.exchangeAgreement, receiverAcknowledgement: { actorUid: 'bob', sourceHash: native.exchangeAgreement.sourceHash, recordedAt: old } } },
      { exchangeAgreement: { ...native.exchangeAgreement, sourceHash: 'a'.repeat(64) } }, { swapLaunchPolicyVersion: 'unknown' },
      { exchangeAgreement: undefined }, { initiatorItems: [] }]) {
      expect(proposalCanAutoExpire({ ...native, ...patch }, cutoff, now)).toBe(false);
    }
    const legacy = { ...native }; delete legacy.exchangeAgreement; delete legacy.swapLaunchPolicyVersion;
    expect(proposalCanAutoExpire(legacy, cutoff, now)).toBe(false); // unknown legacy mode
    delete legacy.exchangeMode;
    expect(proposalCanAutoExpire(legacy, cutoff, now)).toBe(true); // old native unaccepted proposal
  });
  it.each(['declineSwap', 'cancelSwap', 'uploadSwapPhotos', 'confirmSwapShipping', 'confirmSwapReception', 'rateSwap', 'openSwapDispute'] as const)(
    'refuses a supplied foreign session before IO on historical %s', async endpoint => {
      await expect(invoke(handlers[endpoint], { swapId: 'missing', expectedUid: 'bob' })).rejects.toMatchObject({ details: { reason: 'swap_session_changed' } });
      expect(fs.writeOps).toHaveLength(0);
    });
  it('preserves old historical payloads and profile-free decline with a matching session', async () => {
    fs.setDoc('users/' + ALICE, null); fs.setDoc('users/bob', null);
    for (const [swapId, extra] of [['legacy-old', {}], ['legacy-new', { expectedUid: ALICE }]] as const) {
      fs.setDoc('swaps/' + swapId, { initiatorId: ALICE, receiverId: 'bob', status: 'proposed' });
      await expect(invoke(handlers.declineSwap, { swapId, ...extra })).resolves.toEqual({ success: true });
      expect(fs.getDoc('swaps/' + swapId)!.status).toBe('declined');
    }
  });
  it('allows a new cash admission without a Troc, refuses after engagement, and permits a natively cancelled proposal', async () => {
    const admit = () => fs.db.runTransaction(tx => assertNewMeetupAdmission(tx as unknown as FirebaseFirestore.Transaction,
      ALICE, ALICE, 'bob', 'a1'));
    await expect(admit()).resolves.toMatchObject({ sellerId: ALICE });
    const { swapId } = await propose();
    const writes = fs.writeOps.length;
    await expect(admit()).rejects.toMatchObject({ details: { reason: 'article_swap_engaged' } });
    expect(fs.writeOps).toHaveLength(writes);
    await invoke(handlers.cancelSwap, { swapId, expectedUid: ALICE });
    fs.setDoc('swaps/' + swapId, { ...fs.getDoc('swaps/' + swapId), updatedAt: Timestamp.now() });
    await expect(admit()).resolves.toMatchObject({ sellerId: ALICE });
  });
  it.each(['accepted', 'payment_pending', 'photos_pending', 'shipping', 'disputed', 'unknown', 'completed', 'cancelled'])(
    'blocks a new purchase on active, consumed or unqualified swap history %s', async status => {
      const { swapId } = await propose();
      fs.setDoc('swaps/' + swapId, { ...fs.getDoc('swaps/' + swapId), status });
      await expect(fs.db.runTransaction(tx => assertArticleNotSwapEngaged(tx as unknown as FirebaseFirestore.Transaction, 'a1')))
        .rejects.toMatchObject({ code: 'failed-precondition' });
    });
  it('also blocks a legacy single-item engagement and a saturated native history', async () => {
    const check = () => fs.db.runTransaction(tx => assertArticleNotSwapEngaged(tx as unknown as FirebaseFirestore.Transaction, 'a1'));
    fs.setDoc('swaps/legacy', { status: 'accepted', initiatorId: ALICE, receiverId: 'bob', initiatorItem: { articleId: 'a1' } });
    await expect(check()).rejects.toMatchObject({ details: { reason: 'article_swap_engaged' } });
    fs.setDoc('swaps/legacy', null);
    fs.setDoc('swaps/legacy-array', { status: 'accepted', initiatorId: ALICE, receiverId: 'bob', initiatorItems: [{ articleId: 'a1' }], receiverItems: [{ articleId: 'b1' }] });
    await expect(check()).rejects.toMatchObject({ details: { reason: 'article_swap_engaged' } });
    fs.setDoc('swaps/legacy-array', null);
    for (let i = 0; i < 101; i++) fs.setDoc('swaps/saturation-' + i, { status: 'cancelled', articleIds: ['a1'] });
    await expect(check()).rejects.toMatchObject({ details: { reason: 'article_swap_history_review_required' } });
  });
  it('refuses a new Troc when completion has not yet projected isSold', async () => {
    const { swapId } = await propose();
    fs.setDoc('swaps/' + swapId, { ...fs.getDoc('swaps/' + swapId), status: 'completed' });
    expect(fs.getDoc('articles/a1')!.isSold).toBe(false);
    const writes = fs.writeOps.length;
    await expect(preview()).rejects.toMatchObject({ details: { reason: 'article_swap_consumed' } });
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('does not release a native cancelled proposal carrying an unknown past dispute marker', async () => {
    const { swapId } = await propose();
    await invoke(handlers.cancelSwap, { swapId, expectedUid: ALICE });
    fs.setDoc('swaps/' + swapId, { ...fs.getDoc('swaps/' + swapId), updatedAt: Timestamp.now(), statusBeforeDispute: null });
    await expect(fs.db.runTransaction(tx => assertArticleNotSwapEngaged(tx as unknown as FirebaseFirestore.Transaction, 'a1')))
      .rejects.toMatchObject({ details: { reason: 'article_swap_engaged' } });
  });
});

function deposit(uid = ALICE) {
  return call({
    auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid },
    data: { partyId: 'zone-1', articleId: 'a1', title: 'Robe fleurie', price: 20, expectedUid: uid },
  });
}

describe('addItemToPartySecure — dépôt squatté (FR15)', () => {
  it('efface le dépôt d’un compte qui n’est pas le vendeur et laisse passer le vrai', async () => {
    fs.setDoc('swapPartyItems/squat', { partyId: 'zone-1', articleId: 'a1', sellerId: 'mallory' });
    const result = await deposit();
    expect(result.success).toBe(true);
    expect(fs.getDoc('swapPartyItems/squat')).toBeUndefined();
    // Le squat n'a jamais été compté : le compteur ne se décrémente pas.
    expect(fs.getDoc('swapParties/zone-1')!.itemsCount).toBe(2);
  });

  it('refuse toujours un vrai doublon du même vendeur', async () => {
    fs.setDoc('swapPartyItems/mine', { partyId: 'zone-1', articleId: 'a1', sellerId: ALICE });
    await expect(deposit()).rejects.toMatchObject({ code: 'already-exists' });
    expect(fs.getDoc('swapPartyItems/mine')).toBeDefined();
  });
});

describe('setSwapExchangeMode — modes connus seulement', () => {
  const setMode: Callable = request => (handlers.setSwapExchangeMode as unknown as Callable)(request);

  it.each(['courier', '', null])('refuse le mode %s sans modifier l’accord', async exchangeMode => {
    fs.setDoc('swaps/s1', { status: 'accepted', initiatorId: ALICE, receiverId: 'bob' });
    await expect(setMode({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: ALICE }, data: { swapId: 's1', exchangeMode, expectedUid: ALICE } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(fs.getDoc('swaps/s1')).toEqual({ status: 'accepted', initiatorId: ALICE, receiverId: 'bob' });
  });

  it('refuse une requête sans données', async () => {
    await expect(setMode({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: ALICE } })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it.each(['hand_delivery', 'shipping'])('ne fabrique pas un accord historique %s sans source ni confirmations', async exchangeMode => {
    fs.setDoc('swaps/s1', { status: 'accepted', initiatorId: ALICE, receiverId: 'bob' });
    await expect(setMode({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: ALICE }, data: { swapId: 's1', exchangeMode, expectedUid: ALICE, arrangements: 'Samedi à Québec.' } }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('swaps/s1')).toEqual({ status: 'accepted', initiatorId: ALICE, receiverId: 'bob' });
  });
});
