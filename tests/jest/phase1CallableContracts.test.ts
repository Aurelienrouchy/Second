import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import { auth, storage } from '@/config/firebaseConfig';
import { runtimeEnvironment, resolveFirebaseEnvironment } from '@/config/firebaseEnvironment';
import { catalogueCallableName, phase1CallableName, phase1ProductionContracts } from '@/config/catalogueCallableContracts';
import phase1Release from '@/functions/phase1-release.json';
import { sellerActivityPolicy, signupConsentPolicy, type SignupConsent } from '@/services/signupConsentJournal';
import type { Article, User } from '@/types';
import type { TriageReportInput } from '@/types/articleModeration';
import { ACCOUNT_CONTROL_CAPABILITY, ACCOUNT_CONTROL_STATEMENT_VERSION, type AccountControlCommand } from '@/types/accountControlProof';

jest.mock('expo-application', () => ({ applicationId: 'com.seconde.app' }));
jest.mock('expo-apple-authentication', () => ({}));
jest.mock('@react-native-google-signin/google-signin', () => ({ GoogleSignin: {} }));
jest.mock('@/utils/imageUtils', () => ({ processImageWithBlurhash: jest.fn() }));
jest.mock('@/services/nativeStorageUpload', () => ({ uploadPreparedJpeg: jest.fn() }));
jest.mock('@/services/tradeOperation', () => ({
  captureTradeSession: () => ({ uid: 'phase1-owner' }),
  assertTradeSessionCurrent: jest.fn(),
}));

import { AuthService } from '@/services/authService';
import { ArticlesService } from '@/services/articlesService';
import { declineSwap } from '@/services/swapService';
import { ChatMessageImageService } from '@/services/chatMessageImageService';
import { ModerationService } from '@/services/moderationService';
import { ArticleModerationService } from '@/services/articleModerationService';
import { AccountControlProofService } from '@/services/accountControlProofService';

const originalEnvironment = runtimeEnvironment.name;
const originalStorageApp = storage.app;
const request = jest.fn();
const owner = { uid: 'phase1-owner', getIdToken: jest.fn(async () => 'phase1-test-token') };
const imageReference = { chatId: 'phase1-chat', messageId: 'phase1-message', fileKind: 'image' as const };
const imageUri = 'gs://phase1.example.appspot.com/chat_images/phase1-chat/photo.jpg';
const consent = (): SignupConsent => ({
  dateOfBirth: '1990-01-01', acceptedTerms: true, acceptedPrivacy: true, marketingOptIn: false,
  policyVersion: signupConsentPolicy.version,
  sellerActivityDeclaration: {
    kind: 'personal', statementVersion: sellerActivityPolicy.version, personalDeclarationAccepted: true,
    expectedVersion: 'a'.repeat(64), requestId: 'phase1-signup', expectedUid: owner.uid,
  },
});
const article = (): Parameters<typeof ArticlesService.createArticle>[0] => ({
  title: 'Veste', description: 'Une veste en coton', price: 40,
  images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/photo.jpg?alt=media' }],
  category: 'Haut', categoryIds: ['tops'], condition: 'bon état', sellerId: owner.uid,
  sellerName: 'Membre', isHandDelivery: true, isShipping: false, quantity: 1,
});

beforeEach(async () => {
  jest.clearAllMocks();
  request.mockReset();
  await AsyncStorage.clear();
  runtimeEnvironment.name = 'production';
  Object.assign(auth, { currentUser: owner });
  Object.assign(storage, { app: { options: { storageBucket: 'phase1.example.appspot.com' } } });
  jest.mocked(httpsCallable).mockReturnValue(request);
});
afterEach(() => {
  runtimeEnvironment.name = originalEnvironment;
  Object.assign(storage, { app: originalStorageApp });
  jest.restoreAllMocks();
});

it('keeps current names on both the dev cloud and emulators', () => {
  for (const useEmulators of [undefined, '1']) {
    const environment = resolveFirebaseEnvironment({ test: false, appEnvironment: 'development', useEmulators });
    for (const {original: name} of phase1Release.versionedFunctions) {
      expect(catalogueCallableName(name, environment.name)).toBe(name);
    }
  }
});

it('matches every production endpoint to the backend release manifest, without changing business names or other APIs', () => {
  const expected = Object.fromEntries(phase1Release.versionedFunctions.map(({original, name}) => [original, name]));
  expect(phase1ProductionContracts).toEqual(expected);
  expect(Object.keys(expected)).toHaveLength(36);
  for (const [original, endpoint] of Object.entries(expected)) {
    expect(phase1CallableName(original, 'production')).toBe(endpoint);
    expect(phase1CallableName(endpoint, 'production')).toBe(endpoint);
  }
  expect(phase1CallableName('getMyEligibility', 'production')).toBe('getMyEligibility');
  expect(phase1CallableName('__proto__', 'production')).toBe('__proto__');
});

it('dispatches a local swap refusal and its retry to V2 with the same domain payload', async () => {
  const lost = Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' });
  request.mockRejectedValueOnce(lost).mockResolvedValueOnce({data: {success: true}});
  await expect(declineSwap('phase1-swap', {expectedUid: owner.uid})).rejects.toBe(lost);
  expect(httpsCallable).toHaveBeenCalledTimes(1);
  await expect(declineSwap('phase1-swap', {expectedUid: owner.uid})).resolves.toBeUndefined();
  expect(jest.mocked(httpsCallable).mock.calls.map(call => call[1])).toEqual(['declineSwapV2', 'declineSwapV2']);
  expect(request.mock.calls[0][0]).toEqual({swapId: 'phase1-swap', expectedUid: owner.uid});
  expect(request.mock.calls[1][0]).toEqual(request.mock.calls[0][0]);
});

it('sends the exact signup choices to V2 and keeps the callable error without trying the old contract', async () => {
  const payload = consent();
  const error = Object.assign(new Error('Inscription à reprendre'), { code: 'functions/unavailable' });
  request.mockRejectedValueOnce(error);
  await expect(AuthService.recordConsentForCurrentUser(payload)).rejects.toBe(error);
  expect(httpsCallable).toHaveBeenCalledTimes(1);
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'recordSignupConsentV2');
  expect(request).toHaveBeenCalledWith(payload);
  expect(await AuthService.getPendingSignupConsent(owner.uid)).toEqual(payload);
});

it('uses V2 for publication and replays the same persisted command after an unknown outcome', async () => {
  const lost = Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' });
  request.mockRejectedValueOnce(lost).mockResolvedValueOnce({ data: { articleId: 'phase1-article' } });
  await expect(ArticlesService.createArticle(article(), { requestId: 'phase1-listing' })).rejects.toThrow('Réponse perdue');
  const payload = request.mock.calls[0][0];
  await expect(ArticlesService.createArticle(article(), { requestId: 'phase1-listing' })).resolves.toBe('phase1-article');
  expect(request.mock.calls[1][0]).toEqual(payload);
  expect(payload.clientRequestId).toBe('phase1-listing');
  expect(httpsCallable).toHaveBeenCalledTimes(2);
  expect(jest.mocked(httpsCallable).mock.calls.map(call => call[1])).toEqual(['createArticleV2', 'createArticleV2']);
});

it('uses the V2 editing contract without changing its payload or retrying a refused edit', async () => {
  const updates: Partial<Article> = { title: 'Veste en coton', price: 45 };
  const error = Object.assign(new Error('Édition refusée'), { code: 'functions/failed-precondition' });
  request.mockRejectedValueOnce(error);
  await expect(ArticlesService.updateArticle('phase1-article', updates)).rejects.toBe(error);
  expect(httpsCallable).toHaveBeenCalledTimes(1);
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'updateArticleV2');
  expect(request).toHaveBeenCalledWith({ articleId: 'phase1-article', updates });
});

it('refreshes the signed-in profile only after the V2 signup receipt', async () => {
  const user = { id: owner.uid } as User;
  const read = jest.spyOn(AuthService, 'getUserData').mockResolvedValue(user);
  request.mockResolvedValueOnce({ data: { ok: true } });
  await expect(AuthService.recordConsentForCurrentUser(consent())).resolves.toBe(user);
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'recordSignupConsentV2');
  expect(read).toHaveBeenCalledWith(owner.uid);
});

it('routes private message images to V2 and preserves a failed read without falling back to the legacy reporter', async () => {
  const current = jest.fn();
  const lost = Object.assign(new Error('Lecture indisponible'), { code: 'functions/not-found' });
  request.mockRejectedValueOnce(lost);

  await expect(ChatMessageImageService.read(owner.uid, imageReference, imageUri, current)).rejects.toBe(lost);
  expect(httpsCallable).toHaveBeenCalledTimes(1);
  expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'submitReportV2');
  const payload = request.mock.calls[0][0] as Record<string, unknown>;
  expect(payload).toEqual({operation: 'readChatMessageImage', capability: 'chat_message_image_v1', expectedUid: owner.uid,
    ...imageReference, sourceReferenceHash: expect.stringMatching(/^[a-f0-9]{64}$/)});

  request.mockReset().mockResolvedValueOnce({data: {
    protocol: 'chat_message_image_v1', viewerId: owner.uid, ...imageReference,
    sourceReferenceHash: payload.sourceReferenceHash, sourceHash: 'b'.repeat(64), generation: '17',
    contentType: 'image/png', size: 68,
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  }});
  await expect(ChatMessageImageService.read(owner.uid, imageReference, imageUri, current)).resolves.toMatchObject({
    protocol: 'chat_message_image_v1', ...imageReference,
  });
  expect(request).toHaveBeenCalledWith(payload);
  expect(jest.mocked(httpsCallable).mock.calls.map(call => call[1])).toEqual(['submitReportV2', 'submitReportV2']);
});

it('versions report submission without changing its legacy business payload or its development endpoint', async () => {
  request.mockResolvedValue({data: {ok: true, reportId: 'phase1-report', status: 'pending'}});
  for (const environment of ['production', 'development'] as const) {
    runtimeEnvironment.name = environment;
    await expect(ModerationService.createReport(owner.uid, 'Membre', 'user', 'reported-member', 'harassment')).resolves.toBe('phase1-report');
  }
  expect(jest.mocked(httpsCallable).mock.calls.map(call => call[1])).toEqual(['submitReportV2', 'submitReport']);
  expect(request.mock.calls.map(call => call[0])).toEqual([
    {targetType: 'user', targetId: 'reported-member', reason: 'harassment'},
    {targetType: 'user', targetId: 'reported-member', reason: 'harassment'},
  ]);
});

it('uses the versioned administrative reader and decision while retaining the exact refused decision for an explicit retry', async () => {
  const input: TriageReportInput = { reportId: 'phase1-report', outcome: 'reviewed', resolution: 'Dossier examiné' };
  const lost = Object.assign(new Error('Décision sans reçu'), { code: 'functions/unavailable' });
  const receipt = {ok: true, reportId: input.reportId, status: 'reviewed', decisionId: null, replay: true, superseded: false, currentStatus: 'reviewed'};
  request.mockResolvedValueOnce({data: {ok: true, reports: [], count: 0}}).mockRejectedValueOnce(lost).mockResolvedValueOnce({data: receipt});
  await expect(ArticleModerationService.getReports(owner.uid, jest.fn())).resolves.toEqual({ok: true, reports: [], count: 0});
  await expect(ArticleModerationService.triage(owner.uid, input, jest.fn())).rejects.toBe(lost);
  expect(httpsCallable).toHaveBeenCalledTimes(2);
  await expect(ArticleModerationService.triage(owner.uid, input, jest.fn())).resolves.toEqual(receipt);
  expect(jest.mocked(httpsCallable).mock.calls.map(call => call[1])).toEqual(['getPendingReportsV2', 'triageReportV2', 'triageReportV2']);
  expect(request.mock.calls.map(call => call[0])).toEqual([{}, input, input]);
});

it('keeps an account-control pause and its explicit retry away from the historical account-deletion endpoint', async () => {
  const current = jest.fn();
  const command: AccountControlCommand = {action: 'pause', supportRequestId: 'phase1-support',
    statementVersion: ACCOUNT_CONTROL_STATEMENT_VERSION, accepted: true, proofId: `acp_${'a'.repeat(64)}`, sourceHash: 'b'.repeat(64)};
  const attempt = await AccountControlProofService.attempt(owner.uid, 'phase1-account-pause', command, current);
  const lost = Object.assign(new Error('Pause sans reçu'), {code: 'functions/unavailable'});
  const response = {protocol: ACCOUNT_CONTROL_CAPABILITY, actorUid: owner.uid, requestId: attempt.requestId,
    inputHash: attempt.descriptor.inputHash, state: 'unrecorded', replayed: false, receipt: null, proof: null};
  request.mockRejectedValueOnce(lost).mockResolvedValueOnce({data: {status: 'incomplete', newOperationsBlocked: true,
    deletionComplete: false, authDeleted: false, accountControlProof: response}});
  await expect(AccountControlProofService.command(attempt, 'execute', current, command)).rejects.toBe(lost);
  expect(httpsCallable).toHaveBeenCalledTimes(1);
  await expect(AccountControlProofService.command(attempt, 'execute', current, command)).resolves.toEqual(response);
  expect(jest.mocked(httpsCallable).mock.calls.map(call => call[1])).toEqual(['deleteUserAccountV2', 'deleteUserAccountV2']);
  const payload = {mode: 'pause', expectedUid: owner.uid,
    accountControlProof: {capability: ACCOUNT_CONTROL_CAPABILITY, requestId: attempt.requestId, command}};
  expect(request.mock.calls.map(call => call[0])).toEqual([payload, payload]);
  expect(owner.getIdToken).toHaveBeenCalledWith(true);
});

it.each(['production', 'development'] as const)('preserves the ordinary pause %s contract independently of tracked erasure', async environment => {
  runtimeEnvironment.name = environment;
  const receipt = {success: true, status: 'paused', newOperationsBlocked: true, deletionComplete: false, authDeleted: false};
  request.mockResolvedValueOnce({data: receipt});
  await expect(AuthService.deleteAccount('pause')).resolves.toEqual(receipt);
  const endpoint = environment === 'production' ? 'deleteUserAccountV2' : 'deleteUserAccount';
  expect(jest.mocked(httpsCallable).mock.calls.map(call => call[1])).toEqual([endpoint]);
  expect(request.mock.calls.map(call => call[0])).toEqual([{mode: 'pause', expectedUid: owner.uid}]);
});

it('refuses the old untracked deletion payload before refreshing Auth or dispatching any callable', async () => {
  request.mockResolvedValueOnce({data: {success: true, status: 'complete', newOperationsBlocked: true, deletionComplete: true, authDeleted: true}});
  await expect(AuthService.deleteAccount('delete')).rejects.toThrow('demande suivie');
  expect(owner.getIdToken).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
});
