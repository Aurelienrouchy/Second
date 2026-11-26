import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { auth } from '@/config/firebaseConfig';
import type { EligibilityDecision, OwnerEligibility } from '@/types/eligibility';
let mockGeneration = 1;
let mockActive = true;
let mockIdentityUid = 'owner';
let mockIdentityError = false;
let mockIdentityLoading = false;
const mockGetMine = jest.fn();
const mockPush = jest.fn();
const mockExit = jest.fn();
const mockReadDecision = jest.fn();
jest.mock('@/services/automatedDecisionService', () => ({ AutomatedDecisionService: { ownerRefusals: (...args: unknown[]) => mockReadDecision(...args) } }));
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: (...args: unknown[]) => mockGetMine(...args) } }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
 useRouter: () => ({ push: mockPush }), useFocusEffect: (callback: () => void | (() => void)) => {
  const React = require('react'); React.useEffect(callback, [callback]);
} }));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration, useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), {
  getState: () => ({ authenticatedUid: 'owner', user: { id: 'owner' }, identityUser: { id: mockIdentityUid, isActive: mockActive }, identityError: mockIdentityError, isLoading: mockIdentityLoading }),
}) }));
jest.mock('@/services/chatService', () => ({ ChatService: { cancelMeetup: (...args: unknown[]) => mockExit(...args) } }));
jest.mock('@/services/chat/offers', () => ({ acknowledgeMeetupProposal: jest.fn() }));
import { assertNewSaleAdmission, assertSalePreparationAdmission } from '@/services/newSaleAdmission';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { useChatOfferActions } from '@/features/chat/hooks/useChatOfferActions';
import { currentPublicationAdmissionPresentation, publicationAdmissionPresentation, tradeAdmissionPresentation } from '@/utils/tradeAdmissionPresentation';
const {isOwnerAdmissionDecision} = jest.requireActual<typeof import('@/services/automatedDecisionService')>('@/services/automatedDecisionService');

function decision(scope: EligibilityDecision['scope'], allowed: boolean, reasons: string[] = []): EligibilityDecision {
  return { scope, allowed, reasons, status: allowed ? 'allowed' : 'blocked', messages: allowed ? [] : ['Critères à compléter'], policyVersion: '2026-10-26.v1', civilDate: '2026-10-12', evaluationStage: 'foundations' };
}
function owner(buy = true, sell = true): OwnerEligibility {
  return { publication: decision('sell', sell, sell ? [] : ['professional_declared']), decisions: { buy: decision('buy', buy, buy ? [] : ['underage']), sell: decision('sell', sell, sell ? [] : ['professional_declared']), new_paid_shipping: decision('new_paid_shipping', false, ['seller_qc_missing']) } } as OwnerEligibility;
}
beforeEach(() => {
  jest.clearAllMocks(); mockGeneration = 1; mockActive = true;
  mockIdentityUid = 'owner'; mockIdentityError = false; mockIdentityLoading = false;
  (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'owner' };
  mockGetMine.mockResolvedValue(owner()); mockExit.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('refuses a new purchase below 18 before dispatch', async () => {
  mockGetMine.mockResolvedValue(owner(false)); const dispatch = jest.fn();
  await expect(assertNewSaleAdmission('owner', 'buy', () => undefined).then(dispatch)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'eligibility_required', scope: 'buy', reasons: ['underage'] } });
  expect(dispatch).not.toHaveBeenCalled(); expect(mockGetMine).toHaveBeenCalledWith('owner');
});

it('admits a private adult seller and an adult professional buyer, while refusing professional sales without applying shipping criteria to meetup', async () => {
  await expect(assertNewSaleAdmission('owner', 'sell', () => undefined)).resolves.toBeUndefined();
  mockGetMine.mockResolvedValue(owner(true, false));
  await expect(assertNewSaleAdmission('owner', 'sell', () => undefined)).rejects.toMatchObject({ details: { scope: 'sell', reasons: ['professional_declared'] } });
  await expect(assertNewSaleAdmission('owner', 'buy', () => undefined)).resolves.toBeUndefined();
});

it.each(['activity_missing', 'activity_version_required'])('prepares a listing independently of the commercial %s declaration requirement', async reason => {
  const missing = owner();
  missing.decisions.sell = { ...decision('sell', false, [reason]), status: 'incomplete' };
  mockGetMine.mockResolvedValue(missing);
  await expect(assertSalePreparationAdmission('owner', () => undefined)).resolves.toBeUndefined();
  await expect(assertNewSaleAdmission('owner', 'sell', () => undefined)).rejects.toMatchObject({
    code: 'permission-denied', details: { scope: 'sell', reasons: [reason] },
  });
});

it.each(['underage', 'professional_declared', 'account_closing', 'account_security_contained', 'account_unavailable', 'review_required'])(
  'keeps the real listing restriction %s', async reason => {
    const refused = owner();
    refused.publication = decision('sell', false, [reason]);
    mockGetMine.mockResolvedValue(refused);
    await expect(assertSalePreparationAdmission('owner', () => undefined)).rejects.toMatchObject({
      code: 'permission-denied', details: { scope: 'sell', reason: 'eligibility_required', admission: 'publication', reasons: [reason] },
    });
  },
);

it.each([
  undefined,
  {...decision('sell', true), policyVersion: 'old'},
  {...decision('buy', true)},
  {...decision('sell', true), evaluationStage: 'unknown'},
  {...decision('sell', false, ['activity_missing']), status: 'incomplete'},
  {...decision('sell', false, ['activity_version_required']), status: 'incomplete'},
  {...decision('sell', true), reasons: ['underage'], messages: ['Moins de 18 ans']},
])('requires the qualified publication decision instead of inferring permission from commercial foundations (%p)', async publication => {
  mockGetMine.mockResolvedValue({...owner(), publication});
  await expect(assertSalePreparationAdmission('owner', () => undefined)).rejects.toMatchObject({ code: 'client/eligibility-unavailable' });
});

it.each([
  ['strict', () => assertNewSaleAdmission('owner', 'buy', () => undefined)],
  ['preparation', () => assertSalePreparationAdmission('owner', () => undefined)],
] as const)('does not dispatch on a read failure or a stale response from the same UID generation (%s)', async (_label, check) => {
  const dispatch = jest.fn(); mockGetMine.mockRejectedValueOnce(new Error('network'));
  await expect(check().then(dispatch)).rejects.toMatchObject({ code: 'client/eligibility-unavailable' });
  let resolve!: (value: OwnerEligibility) => void;
  mockGetMine.mockImplementationOnce(() => new Promise<OwnerEligibility>(done => { resolve = done; }));
  const pending = check().then(dispatch);
  mockGeneration++; resolve(owner());
  await expect(pending).rejects.toMatchObject({ code: 'client/stale-operation' });
  expect(dispatch).not.toHaveBeenCalled();
});

it.each(['identity', 'identity_error', 'loading', 'inactive'] as const)('keeps the identity fence before preparing a draft (%s)', async state => {
  if (state === 'identity') mockIdentityUid = 'peer';
  if (state === 'identity_error') mockIdentityError = true;
  if (state === 'loading') mockIdentityLoading = true;
  if (state === 'inactive') mockActive = false;
  await expect(assertSalePreparationAdmission('owner', () => undefined)).rejects.toMatchObject({
    code: state === 'inactive' ? 'permission-denied' : 'client/eligibility-unavailable',
  });
  expect(mockGetMine).not.toHaveBeenCalled();
});

it.each(['identity', 'sdk_uid', 'context'] as const)('rejects a preparation response after the current identity or context changes (%s)', async change => {
  let resolve!: (value: OwnerEligibility) => void;
  mockGetMine.mockImplementationOnce(() => new Promise<OwnerEligibility>(done => { resolve = done; }));
  let current = true;
  const dispatch = jest.fn();
  const pending = assertSalePreparationAdmission('owner', () => {
    if (!current) throw Object.assign(new Error('Stale context'), { code: 'client/stale-operation' });
  }).then(dispatch);
  if (change === 'identity') mockIdentityUid = 'peer';
  if (change === 'sdk_uid') (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'peer' };
  if (change === 'context') current = false;
  resolve(owner());
  await expect(pending).rejects.toMatchObject({ code: change === 'identity' ? 'client/eligibility-unavailable' : 'client/stale-operation' });
  expect(dispatch).not.toHaveBeenCalled();
});

it('routes own criteria to eligibility and the counterpart only to help, without interpreting ordinary permission errors', () => {
  const { result } = renderHook(useTradeAdmissionError);
  const own = { code: 'functions/permission-denied', details: { reason: 'eligibility_required', scope: 'buy', messages: ['Votre motif'] } };
  act(() => { result.current(own, { isCurrent: () => true }); });
  const first = (Alert.alert as jest.Mock).mock.calls.at(-1)![2]; first[1].onPress();
  expect(mockPush).toHaveBeenLastCalledWith('/settings/eligibility');
  act(() => { result.current({ code: 'functions/failed-precondition', details: { reason: 'counterparty_unavailable', scope: 'buy', message: 'Opération indisponible avec cet utilisateur.', messages: ['PRIVATE'] } }, { isCurrent: () => true }); });
  const call = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  expect(call[1]).not.toContain('PRIVATE'); expect(call[2][1].text).toBe('Contacter l’assistance'); call[2][1].onPress();
  expect(mockPush).toHaveBeenLastCalledWith('/settings/help');
  expect(tradeAdmissionPresentation({ code: 'permission-denied', message: 'eligibility_required' })).toBeNull();
  mockActive = false;
  expect(tradeAdmissionPresentation({ code: 'permission-denied', details: { reason: 'account_unavailable', scope: 'sell' } })?.action).toBe('support');
});

it('keeps cancellation and rejection usable without reading new-sale criteria', async () => {
  mockGetMine.mockRejectedValue(new Error('No eligibility read allowed for old exits'));
  const reject = jest.fn(async () => undefined);
  const { result } = renderHook(() => useChatOfferActions({ chatId: 'old-chat', userId: 'owner', otherParticipantId: 'peer', sellerId: 'owner', acceptOffer: jest.fn(), rejectOffer: reject }));
  await act(async () => { await result.current.handleCancelMeetup('old-meetup'); await result.current.handleRejectOffer('old-offer', 'old-offer'); });
  expect(mockExit).toHaveBeenCalledTimes(1); expect(reject).toHaveBeenCalledTimes(1); expect(mockGetMine).not.toHaveBeenCalled();
});

const publicationError = {code: 'functions/permission-denied', details: {reason: 'admission_refused', automated: true, action: 'reviewAutomatedDecision',
  decisionId: `admission_${'a'.repeat(64)}`}};

it.each([
  publicationError,
  {code: 'functions/permission-denied', details: {reason: 'eligibility_required', scope: 'sell', reasons: ['activity_missing'], messages: ['Ancienne déclaration demandée']}},
])('reads only current publication admission after an old refusal and never routes to a declaration (%p)', async error => {
  mockReadDecision.mockRejectedValue(Object.assign(new Error('Not found'), {code: 'functions/not-found'}));
  const current = owner();
  current.decisions.sell = {...decision('sell', false, ['activity_missing']), status: 'incomplete', messages: ['Ancienne déclaration demandée']};
  mockGetMine.mockResolvedValue(current);
  const {result} = renderHook(useTradeAdmissionError);
  await act(async () => {expect(result.current(error, {isCurrent: () => true, publication: {uid: 'owner', requestId: 'draft'}})).toBe(true);});
  expect(mockGetMine).toHaveBeenCalledWith('owner'); expect(mockReadDecision).not.toHaveBeenCalled();
  const alert = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  expect(alert[0]).toBe('Prêt à réessayer');
  expect(alert[1]).not.toMatch(/déclaration|critères/i);
  expect(alert[2]).toEqual([{text: 'Fermer', style: 'cancel'}]);
  expect(mockPush).not.toHaveBeenCalled();
});

it('keeps an old DTO retryable without presenting a declaration or retrying the publication', async () => {
  const current = owner(); delete current.publication;
  mockGetMine.mockResolvedValue(current);
  const retry = jest.fn();
  const {result} = renderHook(useTradeAdmissionError);
  await act(async () => {result.current(publicationError, {isCurrent: () => true, retry, publication: {uid: 'owner'}});});
  const alert = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  expect(alert[0]).toBe('Connexion indisponible');
  expect(alert[1]).not.toMatch(/déclaration|critères/i);
  await act(async () => {alert[2][1].onPress();});
  expect(mockGetMine).toHaveBeenCalledTimes(2); expect(retry).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});

it.each(['age_missing', 'age_invalid', 'underage', 'professional_declared'])('offers help without a declaration form for %s', async reason => {
  mockGetMine.mockResolvedValue({...owner(), publication: decision('sell', false, [reason])});
  const {result} = renderHook(useTradeAdmissionError);
  await act(async () => {result.current(publicationError, {isCurrent: () => true, publication: {uid: 'owner'}});});
  const alert = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  expect(alert[2][1].text).toBe('Contacter l’assistance');
  act(() => {alert[2][1].onPress();});
  expect(mockPush).toHaveBeenLastCalledWith('/settings/help');
  expect(publicationAdmissionPresentation({reasons: [reason], messages: ['Motif actuel']}).route).toBe('/settings/help');
});

it('retries only the current eligibility read and ignores its late result after the original publication context changes', async () => {
  mockGetMine.mockRejectedValueOnce(new Error('offline'));
  let resolve!: (value: OwnerEligibility) => void;
  mockGetMine.mockImplementationOnce(() => new Promise(done => {resolve = done;}));
  const retryPublish = jest.fn(); let current = true;
  const {result} = renderHook(useTradeAdmissionError);
  await act(async () => {result.current(publicationError, {isCurrent: () => current, retry: retryPublish, publication: {uid: 'owner', requestId: 'draft'}});});
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)![0]).toBe('Connexion indisponible');
  await act(async () => {(Alert.alert as jest.Mock).mock.calls.at(-1)![2][1].onPress();});
  expect(mockGetMine).toHaveBeenCalledTimes(2); expect(mockReadDecision).not.toHaveBeenCalled(); expect(retryPublish).not.toHaveBeenCalled();
  current = false;
  await act(async () => {resolve(owner());});
  expect(Alert.alert).toHaveBeenCalledTimes(1); expect(mockPush).not.toHaveBeenCalled();
});

it('offers publication again only on an explicit current-user action after a now-allowed foundation read', async () => {
  const retryPublish = jest.fn(); let current = true;
  const {result} = renderHook(useTradeAdmissionError);
  await act(async () => {result.current(publicationError, {isCurrent: () => current, retry: retryPublish, publication: {uid: 'owner', requestId: 'draft'}});});
  const alert = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
  expect(alert[0]).toBe('Prêt à réessayer'); expect(alert[2][1].text).toBe('Réessayer');
  expect(retryPublish).not.toHaveBeenCalled();
  alert[2][1].onPress(); expect(retryPublish).toHaveBeenCalledTimes(1);
  current = false; alert[2][1].onPress(); expect(retryPublish).toHaveBeenCalledTimes(1);
});

it('does not infer permission from malformed or mixed current foundations', () => {
  expect(tradeAdmissionPresentation(publicationError)).toMatchObject({title: 'Vérification du compte', action: 'decision'});
  expect(currentPublicationAdmissionPresentation({...decision('sell', true), reasons: ['underage'], messages: ['Moins de 18 ans']})).toBeNull();
  expect(currentPublicationAdmissionPresentation(decision('buy', true))).toBeNull();
  expect(currentPublicationAdmissionPresentation({...decision('sell', true), evaluationStage: 'unknown'})).toBeNull();
  expect(currentPublicationAdmissionPresentation(decision('sell', false, ['professional_declared']))?.route).toBe('/settings/help');
});

function refusedListing(operation: 'createArticle' | 'updateArticle' | 'relistArticle') {
  const articleId = 'a'.repeat(20), sourceHash = 'a'.repeat(64);
  return {protocol: 'admission_refused_v1', id: `admission_${sourceHash}`, revision: '1:0', sourceHash, transactionId: null,
    decisionType: 'admission_refused', ownerId: 'owner', userId: 'owner', operation, scope: 'sell', policyVersion: '2026-10-26.v1',
    reasons: ['underage'], messages: ['Vous devez avoir 18 ans.'], result: 'Nouvelle annonce refusée', executedAt: '2026-10-26T00:00:00.000Z',
    automated: true, financialExecutionVerified: false, financialEffect: 'none', admissionGranted: false,
    criteria: {minimumAge: 18, ageSource: 'declared_profile', ageVerified: false, ageCondition: 'under18', activityRequirement: 'not_required',
      residenceRequirement: 'not_applied', residenceVerified: false, restrictionDetailsDisclosed: false, sellerRestriction: 'no_declared_professionals'},
    sourceContext: operation === 'createArticle' ? {kind: 'article_publication', articleId, publicationRequestId: 'draft', inputHash: sourceHash}
      : operation === 'updateArticle' ? {kind: 'article_edit', articleId, articleRevision: sourceHash, inputHash: sourceHash}
        : {kind: 'article_relist', articleId, articleRevision: sourceHash, requestId: 'relist', inputHash: sourceHash}};
}

it.each(['createArticle', 'updateArticle', 'relistArticle'] as const)('reads genuine listing refusals with the publication-only contract (%s)', operation => {
  expect(isOwnerAdmissionDecision(refusedListing(operation), 'owner')).toBe(true);
});

it('preserves historical admission criteria and keeps the new declaration exemption limited to its exact listing contract', () => {
  const native = refusedListing('createArticle');
  const {sellerRestriction: _restriction, ...legacyCriteria} = native.criteria;
  expect(isOwnerAdmissionDecision({...native, policyVersion: 'historical', criteria: {...legacyCriteria, activityRequirement: 'personal'}}, 'owner')).toBe(true);
  expect(isOwnerAdmissionDecision({...native, criteria: {...legacyCriteria, activityRequirement: 'personal'}}, 'owner')).toBe(false);
  for (const changes of [
    {policyVersion: 'unqualified'},
    {scope: 'buy'},
    {criteria: {...native.criteria, sellerRestriction: 'unknown'}},
    {criteria: {...native.criteria, extra: false}},
    {criteria: {...native.criteria, activityRequirement: 'personal'}},
    {criteria: legacyCriteria},
    {reasons: ['activity_missing']},
    {operation: 'acceptMeetupOffer', sourceContext: {kind: 'meetup_offer', chatId: 'chat', messageId: 'offer', articleId: 'article', offerSourceHash: native.sourceHash}},
  ]) expect(isOwnerAdmissionDecision({...native, ...changes}, 'owner')).toBe(false);
  const agreement = {...native, policyVersion: 'historical', operation: 'acceptMeetupOffer',
    sourceContext: {kind: 'meetup_offer', chatId: 'chat', messageId: 'offer', articleId: 'article', offerSourceHash: native.sourceHash}};
  expect(isOwnerAdmissionDecision({...agreement, criteria: {...legacyCriteria, activityRequirement: 'personal'}}, 'owner')).toBe(true);
  expect(isOwnerAdmissionDecision({...agreement, policyVersion: '2026-10-26.v1', scope: 'buy', criteria: legacyCriteria}, 'owner')).toBe(false);
});
