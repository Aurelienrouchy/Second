import * as SecureStore from 'expo-secure-store';
import {fetch as expoFetch} from 'expo/fetch';
import {auth} from '@/config/firebaseConfig';
import {runtimeEnvironment} from '@/config/firebaseEnvironment';
import {useAuthStore} from '@/store/authStore';
import {setAnalyticsEnabled, suspendAnalytics} from '@/lib/analytics';
import {AccountErasureJournal} from '@/services/accountErasureJournal';
import {AccountErasureService, accountErasureEndpoint} from '@/services/accountErasureService';
import {AccountErasureAppleWebService, validAppleWebStartReceipt} from '@/services/accountErasureAppleWebService';
import {consumeAppleErasureAuthorization, discardAppleErasureAuthorization, issueAppleErasureAuthorization} from '@/services/accountErasureAppleAuthorization';
import {ACCOUNT_ERASURE_PROTOCOL, isAccountErasureAttempt, isAccountErasureReceipt} from '@/types/accountErasure';
import type {AccountErasureAttempt, AccountErasureReceipt} from '@/types/accountErasure';

let mockGeneration = 1;
const mockMemory = new Map<string, string>();
const mockPublicMemory = new Map<string, string>();
jest.mock('@/utils/environmentStorage', () => ({__esModule: true, default: {
  getItem: async (key: string) => mockPublicMemory.get(key) ?? null,
  setItem: async (key: string, value: string) => {mockPublicMemory.set(key, value);},
}}));
jest.mock('expo-secure-store', () => ({WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {mockMemory.set(key, value);}),
  deleteItemAsync: jest.fn(async (key: string) => {mockMemory.delete(key);}),
}));
jest.mock('expo/fetch', () => ({fetch: jest.fn()}));
jest.mock('@/config/firebaseEnvironment', () => ({runtimeEnvironment: {name: 'production', projectId: 'seconde-b47a6',
  useEmulators: false, storageNamespace: 'production', emulatorProjectId: 'demo-second', emulatorHost: 'localhost'}}));
jest.mock('@/lib/analytics', () => ({suspendAnalytics: jest.fn(), setAnalyticsEnabled: jest.fn(async () => undefined)}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  const {subscribeWithSelector} = jest.requireActual<typeof import('zustand/middleware')>('zustand/middleware');
  return {getAuthSessionGeneration: () => mockGeneration,
    useAuthStore: create(subscribeWithSelector(() => ({authenticatedUid: 'erasure-owner', isLoading: false})))};
});

const view = () => undefined;
const sdkUser = (uid = 'erasure-owner') => ({uid, providerData: [{providerId: 'password'}, {providerId: 'apple.com'}],
  getIdToken: jest.fn(async () => 'synthetic-owner-jwt')});
let owner = sdkUser();
function login(user: ReturnType<typeof sdkUser> | null) {
  mockGeneration++; Object.assign(auth, {currentUser: user});
  useAuthStore.setState({authenticatedUid: user?.uid ?? null, isLoading: false});
}
const response = (receipt: unknown, status = 200) => ({ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(receipt)}) as Response;
const receipt = (attempt: Pick<AccountErasureAttempt, 'requestId' | 'commandId'>, state: AccountErasureReceipt['state'] = 'inspecting', version = 1): AccountErasureReceipt => ({
  kind: 'account_erasure_receipt_v1', requestId: attempt.requestId, commandId: attempt.commandId, state, version,
  accountAccessClosed: state === 'completed', deletionComplete: state === 'completed', appleAuthorizationRequired: state === 'awaiting_apple_authorization',
  progress: {completedSteps: state === 'completed' ? 4 : 1, totalSteps: 4},
  reasons: state === 'awaiting_apple_authorization' ? ['authorization_required'] : [],
  updatedAt: '2026-11-25T10:00:00.000Z', completedAt: state === 'completed' ? '2026-11-25T10:00:00.000Z' : null,
  retentionPolicyVersion: 'seconde-erasure-2026-11-25-v1', observationExpiresAt: state === 'completed' ? '2026-12-25T10:00:00.000Z' : null,
  success: state === 'completed', status: state === 'completed' ? 'complete' : 'incomplete', newOperationsBlocked: true,
});
const body = (index = 0): Record<string, unknown> => JSON.parse(String(jest.mocked(expoFetch).mock.calls[index][1]?.body)).data;
const commandRecord = () => [...mockMemory.values()].map(value => JSON.parse(value) as Record<string, unknown>).find(value => value.protocol === ACCOUNT_ERASURE_PROTOCOL && 'commandId' in value)!;
async function submitted() {return AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, view), view);}
async function received(state: AccountErasureReceipt['state'] = 'inspecting') {
  const attempt = await submitted(); return AccountErasureJournal.record(attempt, receipt(attempt, state), view);
}
let detach: (() => void) | null = null;
beforeEach(() => {
  mockMemory.clear(); mockPublicMemory.clear(); mockGeneration++; jest.clearAllMocks(); owner = sdkUser(); login(owner);
  Object.assign(runtimeEnvironment, {name: 'production', projectId: 'seconde-b47a6', useEmulators: false});
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {mockMemory.set(key, value);});
  jest.mocked(expoFetch).mockReset();
});
afterEach(() => {detach?.(); detach = null; jest.restoreAllMocks();});

it('persists a device-only secret before any server effect and returns no capability to UI', async () => {
  const attempt = await AccountErasureService.prepare(owner.uid, view);
  expect(attempt).toMatchObject({ownerId: owner.uid, phase: 'prepared', receipt: null});
  expect(attempt).not.toHaveProperty('observationKey');
  expect([...mockPublicMemory.entries()]).toEqual([['account_erasure_guest_blocked', 'false']]);
  expect(commandRecord().observationKey).toMatch(/^[a-f0-9]{64}$/);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, requireAuthentication: false,
    keychainService: 'ca.seconde.erasure.seconde-b47a6'}));
  expect(suspendAnalytics).toHaveBeenCalledTimes(1); expect(setAnalyticsEnabled).toHaveBeenCalledWith(false);
  expect(expoFetch).not.toHaveBeenCalled(); expect(owner.getIdToken).not.toHaveBeenCalled();
});
it('refuses effects when secure storage is unavailable', async () => {
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValue(false);
  await expect(AccountErasureService.prepare(owner.uid, view)).rejects.toThrow('suivi sécurisé');
  expect(expoFetch).not.toHaveBeenCalled();
});
it('refuses effects if the keychain does not durably reread the saved key', async () => {
  jest.mocked(SecureStore.setItemAsync).mockResolvedValue();
  await expect(AccountErasureService.prepare(owner.uid, view)).rejects.toThrow('suivi sécurisé');
  expect(expoFetch).not.toHaveBeenCalled();
});
it('never discovers anonymously before the existing Auth hydration has finished', async () => {
  useAuthStore.setState({isLoading: true});
  await expect(AccountErasureJournal.discover(view)).rejects.toThrow();
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled(); expect(expoFetch).not.toHaveBeenCalled();
});
it('keeps the same ID/key and submitted journal after an unknown request result', async () => {
  const prepared = await AccountErasureService.prepare(owner.uid, view);
  jest.mocked(expoFetch).mockRejectedValueOnce(new Error('lost synthetic reply'));
  await expect(AccountErasureService.request(prepared, view)).rejects.toThrow('reste à vérifier');
  const saved = await AccountErasureService.prepare(owner.uid, view);
  expect(saved).toMatchObject({...prepared, phase: 'submitted'});
  const first = body();
  jest.mocked(expoFetch).mockResolvedValueOnce(response({result: receipt(saved)}));
  await AccountErasureService.request(saved, view);
  expect(body(1)).toEqual(first); expect(first).toMatchObject({capability: ACCOUNT_ERASURE_PROTOCOL, mode: 'delete',
    operation: 'request', expectedUid: owner.uid, confirmed: true});
  expect(jest.mocked(expoFetch).mock.calls[0][0]).toBe('https://northamerica-northeast1-seconde-b47a6.cloudfunctions.net/deleteUserAccountV2');
});
it('does not emit a request or resume when rediscovering a submitted intention', async () => {
  const attempt = await submitted();
  expect(await AccountErasureJournal.discover(view)).toEqual(attempt);
  expect(expoFetch).not.toHaveBeenCalled();
});
it('observes after Auth disappears without refreshing an ID token or sending credentials/instructions', async () => {
  const attempt = await submitted(); login(null);
  const found = await AccountErasureJournal.discover(view); expect(found).toEqual(attempt);
  jest.mocked(expoFetch).mockResolvedValueOnce(response({result: receipt(attempt, 'completed')}));
  const done = await AccountErasureService.observe(attempt, view);
  expect(done.receipt?.deletionComplete).toBe(true); expect(owner.getIdToken).not.toHaveBeenCalled();
  expect(jest.mocked(expoFetch).mock.calls[0][1]).toMatchObject({credentials: 'omit', redirect: 'error',
    headers: {'Content-Type': 'application/json'}});
  expect(Object.keys(body()).sort()).toEqual(['capability', 'commandId', 'mode', 'observationKey', 'operation', 'requestId']);
  expect(body().operation).toBe('observe');
});
it('rejects account B before loading A’s observation capability or sending any request', async () => {
  const attempt = await submitted(); login(sdkUser('account-B')); jest.mocked(SecureStore.getItemAsync).mockClear();
  await expect(AccountErasureService.observe(attempt, view)).rejects.toThrow('session');
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled(); expect(expoFetch).not.toHaveBeenCalled();
});
it('durably closes A → B → null even if B never opens the erasure screen', async () => {
  await submitted(); detach = AccountErasureJournal.attachIdentityWatcher();
  login(sdkUser('account-B')); login(null);
  expect(await AccountErasureJournal.discover(view)).toBeNull();
  detach(); detach = null;
  // Simulated app restart: the persisted close, rather than a mounted screen,
  // still controls later anonymous discovery.
  expect(await AccountErasureJournal.discover(view)).toBeNull();
  const pointer = [...mockMemory.values()].map(value => JSON.parse(value) as Record<string, unknown>).find(value => value.version === 1 && 'anonymousBlocked' in value);
  expect(pointer?.anonymousBlocked).toBe(true);
});
it('closes a previous A pointer when the app starts already adopted into B', async () => {
  await submitted(); login(sdkUser('account-B')); detach = AccountErasureJournal.attachIdentityWatcher(); login(null);
  expect(await AccountErasureJournal.discover(view)).toBeNull();
});
it('lets the proven owner rediscover their own journal after a foreign session', async () => {
  const attempt = await submitted(); detach = AccountErasureJournal.attachIdentityWatcher();
  login(sdkUser('account-B')); login(null); expect(await AccountErasureJournal.discover(view)).toBeNull();
  login(owner); expect(await AccountErasureJournal.discover(view)).toEqual(attempt);
  login(null); expect(await AccountErasureJournal.discover(view)).toEqual(attempt);
});
it('discards a request response when Auth disappears, then recovers it only by fresh anonymous observation', async () => {
  const prepared = await AccountErasureService.prepare(owner.uid, view);
  jest.mocked(expoFetch).mockImplementationOnce(async () => {login(null); return response({result: receipt(prepared, 'completed')});});
  await expect(AccountErasureService.request(prepared, view)).rejects.toThrow('session');
  const recovered = await AccountErasureJournal.discover(view); expect(recovered && isAccountErasureAttempt(recovered) && recovered.receipt).toBeNull();
  if (!recovered || !isAccountErasureAttempt(recovered)) throw new Error('Missing synthetic intention');
  owner.getIdToken.mockClear(); jest.mocked(expoFetch).mockResolvedValueOnce(response({result: receipt(recovered, 'completed')}));
  expect((await AccountErasureService.observe(recovered, view)).receipt?.deletionComplete).toBe(true);
  expect(owner.getIdToken).not.toHaveBeenCalled();
});
it.each(['owner', 'generation', 'view'] as const)('rejects a late response after %s changes', async change => {
  const attempt = await submitted(); let active = true;
  jest.mocked(expoFetch).mockImplementationOnce(async () => {
    if (change === 'owner') login(sdkUser('account-B'));
    if (change === 'generation') mockGeneration++;
    if (change === 'view') active = false;
    return response({result: receipt(attempt)});
  });
  await expect(AccountErasureService.observe(attempt, () => {if (!active) throw new Error('stale view');})).rejects.toThrow();
  expect(commandRecord().receipt).toBeNull();
});
it.each(['uid', 'content', 'amount', 'observationKey'])('rejects an observation receipt leaking %s', async extra => {
  const attempt = await submitted();
  jest.mocked(expoFetch).mockResolvedValueOnce(response({result: {...receipt(attempt), [extra]: 'unexpected synthetic private detail'}}));
  await expect(AccountErasureService.observe(attempt, view)).rejects.toThrow('reste à vérifier');
  expect(commandRecord().receipt).toBeNull();
});
it('rejects a different command and never falls back to the old function', async () => {
  const attempt = await submitted(); jest.mocked(expoFetch).mockResolvedValueOnce(response({result: {...receipt(attempt), commandId: 'a'.repeat(64)}}));
  await expect(AccountErasureService.observe(attempt, view)).rejects.toThrow(); expect(expoFetch).toHaveBeenCalledTimes(1);
});
it('rejects a regressing version, same-version contradiction and completed downgrade', async () => {
  const attempt = await received();
  await expect(AccountErasureJournal.record(attempt, {...receipt(attempt), state: 'erasing'}, view)).rejects.toThrow();
  const latest = await AccountErasureJournal.record(attempt, receipt(attempt, 'completed', 3), view);
  await expect(AccountErasureJournal.record(latest, receipt(attempt, 'erasing', 2), view)).rejects.toThrow();
  await expect(AccountErasureJournal.record(latest, receipt(attempt, 'erasing', 4), view)).rejects.toThrow();
});
it('does not turn a closed account or an incomplete provider result into completed erasure', () => {
  const fake = {commandId: 'a'.repeat(64), requestId: 'synthetic-request-123'};
  expect(isAccountErasureReceipt({...receipt(fake), accountAccessClosed: true})).toBe(true);
  expect(isAccountErasureReceipt({...receipt(fake), deletionComplete: true})).toBe(false);
  expect(isAccountErasureReceipt({...receipt(fake, 'completed'), observationExpiresAt: null})).toBe(false);
});
it('does not surface raw server error details or a malformed secret-bearing JSON string', async () => {
  const attempt = await submitted(), secret = String(commandRecord().observationKey);
  jest.mocked(expoFetch).mockResolvedValueOnce(response({error: {status: 'FAILED_PRECONDITION', message: secret, details: {key: secret}}}, 400));
  await expect(AccountErasureService.observe(attempt, view)).rejects.not.toThrow(secret);
  jest.mocked(expoFetch).mockResolvedValueOnce({ok: true, status: 200, text: async () => secret} as Response);
  await expect(AccountErasureService.observe(attempt, view)).rejects.not.toThrow(secret);
});
it('refuses to resume or authorize an intention without a confirmed server receipt', async () => {
  const attempt = await submitted();
  await expect(AccountErasureService.resume(attempt, view)).rejects.toThrow();
  expect(expoFetch).not.toHaveBeenCalled(); expect(owner.getIdToken).not.toHaveBeenCalled();
});
it('uses the explicit V2 endpoint in Dev too, and refuses an incoherent project/environment', () => {
  Object.assign(runtimeEnvironment, {name: 'development', projectId: 'seconde-dev'});
  expect(accountErasureEndpoint()).toBe('https://northamerica-northeast1-seconde-dev.cloudfunctions.net/deleteUserAccountV2');
  Object.assign(runtimeEnvironment, {name: 'development', projectId: 'seconde-b47a6'}); expect(accountErasureEndpoint).toThrow();
  Object.assign(runtimeEnvironment, {name: 'emulator', projectId: 'demo-second', useEmulators: true});
  expect(accountErasureEndpoint()).toBe('http://localhost:5001/demo-second/northamerica-northeast1/deleteUserAccountV2');
});
it('keeps the Apple code only in an opaque memory ticket, consumes it once and binds owner/generation/intention', async () => {
  const attempt = await submitted(), code = 'synthetic-apple-authorization-code';
  const ticket = issueAppleErasureAuthorization(attempt, owner as never, mockGeneration, code);
  expect(JSON.stringify(ticket)).not.toContain(code); expect(JSON.stringify([...mockMemory.values()])).not.toContain(code);
  expect(consumeAppleErasureAuthorization(ticket, attempt, owner as never, mockGeneration)).toBe(code);
  expect(() => consumeAppleErasureAuthorization(ticket, attempt, owner as never, mockGeneration)).toThrow();
  for (const invalid of ['owner', 'generation', 'intention'] as const) {
    const next = issueAppleErasureAuthorization(attempt, owner as never, mockGeneration, code);
    expect(() => consumeAppleErasureAuthorization(next, invalid === 'intention' ? {...attempt, commandId: 'b'.repeat(64)} : attempt,
      (invalid === 'owner' ? sdkUser() : owner) as never, mockGeneration + (invalid === 'generation' ? 1 : 0))).toThrow();
  }
});
it('expires or explicitly discards an Apple code without persisting it', async () => {
  const attempt = await submitted(), code = 'synthetic-apple-authorization-code';
  const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const expired = issueAppleErasureAuthorization(attempt, owner as never, mockGeneration, code); clock.mockReturnValue(now + 120_001);
  expect(() => consumeAppleErasureAuthorization(expired, attempt, owner as never, mockGeneration)).toThrow();
  const discarded = issueAppleErasureAuthorization(attempt, owner as never, mockGeneration, code); discardAppleErasureAuthorization(discarded);
  expect(() => consumeAppleErasureAuthorization(discarded, attempt, owner as never, mockGeneration)).toThrow();
});
it('sends the Apple authorization CODE only in authorize_apple, never as a Firebase access token or durable data', async () => {
  const attempt = await received('awaiting_apple_authorization'), code = 'synthetic-apple-authorization-code';
  const ticket = issueAppleErasureAuthorization(attempt, owner as never, mockGeneration, code);
  jest.mocked(expoFetch).mockResolvedValueOnce(response({result: receipt(attempt, 'erasing', 2)}));
  await AccountErasureService.authorizeApple(attempt, ticket, view);
  expect(body()).toMatchObject({operation: 'authorize_apple', appleAuthorizationCode: code, appleAuthorizationFlow: 'ios_native', expectedUid: owner.uid});
  expect(body()).not.toHaveProperty('confirmed');
  expect(jest.mocked(expoFetch).mock.calls[0][1]?.headers).toEqual({'Content-Type': 'application/json', Authorization: 'Bearer synthetic-owner-jwt'});
  expect(JSON.stringify([...mockMemory.values()])).not.toContain(code);
});
it('rejects an Apple ticket when only password is linked, regardless of the last provider used', async () => {
  const attempt = await submitted(); owner.providerData = [{providerId: 'password'}];
  expect(() => issueAppleErasureAuthorization(attempt, owner as never, mockGeneration, 'synthetic-apple-code')).toThrow();
});
it('persists a stable recovery key before rotation and only sends the recover_owner whitelist', async () => {
  const recovery = await AccountErasureService.prepareRecovery(owner.uid, view);
  const key = [...mockMemory.values()].map(value => JSON.parse(value) as Record<string, unknown>).find(value => value.recoveryId === recovery.recoveryId && value.protocol)?.observationKey;
  expect(key).toMatch(/^[a-f0-9]{64}$/); expect(recovery).not.toHaveProperty('observationKey');
  jest.mocked(expoFetch).mockRejectedValueOnce(new Error('lost synthetic rotation reply'));
  await expect(AccountErasureService.recoverOwner(recovery, view)).rejects.toThrow();
  const same = await AccountErasureService.prepareRecovery(owner.uid, view);
  expect(same).toMatchObject({...recovery, phase: 'submitted'});
  expect(Object.keys(body()).sort()).toEqual(['capability', 'expectedUid', 'mode', 'observationKey', 'operation', 'recoveryId']);
  expect(body()).toMatchObject({operation: 'recover_owner', observationKey: key, expectedUid: owner.uid});
});
it('recovers the canonical receipt after a lost rotation response and deleted Auth using only recoveryId/key', async () => {
  const original = await submitted(); const recovery = await AccountErasureService.prepareRecovery(owner.uid, view);
  jest.mocked(expoFetch).mockImplementationOnce(async () => {login(null); return response({result: receipt(original, 'completed', 3)});});
  await expect(AccountErasureService.recoverOwner(recovery, view)).rejects.toThrow('session');
  const saved = await AccountErasureJournal.discover(view);
  if (!saved || isAccountErasureAttempt(saved)) throw new Error('Missing synthetic recovery');
  owner.getIdToken.mockClear(); jest.mocked(expoFetch).mockResolvedValueOnce(response({result: receipt(original, 'completed', 3)}));
  const canonical = await AccountErasureService.observeRecovery(saved, view);
  expect(canonical.commandId).toBe(original.commandId); expect(canonical.requestId).toBe(original.requestId);
  expect(canonical.receipt?.deletionComplete).toBe(true); expect(owner.getIdToken).not.toHaveBeenCalled();
  expect(Object.keys(body(1)).sort()).toEqual(['capability', 'mode', 'observationKey', 'operation', 'recoveryId']);
  expect(body(1).operation).toBe('observe_recovery');
  expect(jest.mocked(expoFetch).mock.calls[1][1]?.headers).toEqual({'Content-Type': 'application/json'});
  expect(await AccountErasureJournal.discover(view)).toEqual(canonical);
});
it('rejects recovery of a different owner’s command and blocks recovery in account B', async () => {
  const original = await submitted(), recovery = await AccountErasureService.prepareRecovery(owner.uid, view);
  const sent = await AccountErasureJournal.beginRecovery(recovery, view);
  await expect(AccountErasureJournal.bindRecovery(sent, {...receipt(original), commandId: 'b'.repeat(64)}, view)).rejects.toThrow();
  login(sdkUser('account-B'));
  await expect(AccountErasureService.observeRecovery(sent, view)).rejects.toThrow('session');
  await expect(AccountErasureService.recoverOwner(sent, view)).rejects.toThrow('session'); expect(expoFetch).not.toHaveBeenCalled();
});
it('rejects a contradictory receipt at the same version during capability recovery too', async () => {
  const original = await received(), recovery = await AccountErasureService.prepareRecovery(owner.uid, view);
  const sent = await AccountErasureJournal.beginRecovery(recovery, view);
  await expect(AccountErasureJournal.bindRecovery(sent, {...original.receipt!, state: 'erasing'}, view)).rejects.toThrow();
});
it('does not adopt a recovery receipt before a recovery was explicitly submitted', async () => {
  const original = await submitted(), recovery = await AccountErasureService.prepareRecovery(owner.uid, view);
  await expect(AccountErasureJournal.bindRecovery(recovery, receipt(original), view)).rejects.toThrow();
});
it('keeps a pending capability indefinitely but purges the completed device key at its 30-day expiry on discovery', async () => {
  const pending = await received(); const key = String(commandRecord().observationKey);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2028-01-01T00:00:00.000Z'));
  login(null); expect(await AccountErasureJournal.discover(view)).toEqual(pending);
  login(owner); clock.mockReturnValue(Date.parse('2026-11-25T10:00:00.000Z'));
  const done = await AccountErasureJournal.record(pending, receipt(pending, 'completed', 2), view); login(null);
  expect(await AccountErasureJournal.discover(view)).toEqual(done);
  clock.mockReturnValue(Date.parse('2026-12-25T10:00:00.000Z'));
  expect(await AccountErasureJournal.discover(view)).toBeNull();
  expect(JSON.stringify([...mockMemory.values()])).not.toContain(key); expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
});
it('does not revive A after a keychain write failure during B adoption and an application restart', async () => {
  await submitted(); detach = AccountErasureJournal.attachIdentityWatcher();
  // Establish initial A's watcher work before injecting the foreign transition.
  await AccountErasureJournal.discover(view);
  jest.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('synthetic keychain unavailable'));
  login(sdkUser('account-B')); login(null);
  await expect(AccountErasureJournal.discover(view)).rejects.toThrow(); detach(); detach = null;
  let restarted!: Promise<unknown>;
  jest.isolateModules(() => {
    const freshAuth = jest.requireMock('@/config/firebaseConfig') as typeof import('@/config/firebaseConfig');
    const freshStore = jest.requireMock('@/store/authStore') as typeof import('@/store/authStore');
    Object.assign(freshAuth.auth, {currentUser: null}); freshStore.useAuthStore.setState({authenticatedUid: null, isLoading: false});
    const fresh = require('@/services/accountErasureJournal') as typeof import('@/services/accountErasureJournal');
    restarted = fresh.AccountErasureJournal.discover(view);
  });
  expect(await restarted).toBeNull();
});
const webReceipt = () => ({capability: 'account_erasure_apple_web_v1', challengeId: 'synthetic-challenge-123',
  browserUrl: `https://seconde-b47a6.firebaseapp.com/account-erasure-apple#challengeId=synthetic-challenge-123&cap=${'c'.repeat(43)}`,
  expiresAt: new Date(Date.now() + 240_000).toISOString()});
it('opens only an existing Apple order with a fresh owner JWT, never a prepare_request or an observation-key handoff', async () => {
  const attempt = await received('awaiting_apple_authorization'), expected = webReceipt(); jest.mocked(expoFetch).mockResolvedValueOnce(response({result: expected}));
  const result = await AccountErasureAppleWebService.start(attempt, view);
  expect(result).toEqual(expected); expect(result.browserUrl).not.toContain(String(commandRecord().observationKey));
  expect(body()).toEqual({capability: 'account_erasure_apple_web_v1', purpose: 'authorize_existing', expectedUid: owner.uid,
    requestId: attempt.requestId, commandId: attempt.commandId, observationKey: commandRecord().observationKey, confirmed: true});
  expect(jest.mocked(expoFetch).mock.calls[0][0]).toBe('https://northamerica-northeast1-seconde-b47a6.cloudfunctions.net/startAccountErasureAppleWeb');
  expect(jest.mocked(expoFetch).mock.calls[0][1]?.headers).toEqual({'Content-Type': 'application/json', Authorization: 'Bearer synthetic-owner-jwt'});
  expect(JSON.stringify([...mockMemory.values()])).not.toContain(result.browserUrl);
});
it('refuses Apple Web start before a server order or in another account', async () => {
  const prepared = await AccountErasureService.prepare(owner.uid, view);
  await expect(AccountErasureAppleWebService.start(prepared, view)).rejects.toThrow();
  const pending = await received('awaiting_apple_authorization'); login(sdkUser('account-B'));
  await expect(AccountErasureAppleWebService.start(pending, view)).rejects.toThrow(); expect(expoFetch).not.toHaveBeenCalled();
});
it.each([
  'https://foreign.example/account-erasure-apple#challengeId=synthetic-challenge-123&cap=' + 'c'.repeat(43),
  'https://seconde-dev.firebaseapp.com/account-erasure-apple#challengeId=synthetic-challenge-123&cap=' + 'c'.repeat(43),
  'https://seconde-b47a6.firebaseapp.com/account-erasure-apple?uid=owner#challengeId=synthetic-challenge-123&cap=' + 'c'.repeat(43),
  'https://seconde-b47a6.firebaseapp.com/account-erasure-apple#challengeId=synthetic-challenge-123&cap=' + 'd'.repeat(64),
])('refuses an unsafe provider URL before handing it to the native browser (%s)', browserUrl => {
  expect(validAppleWebStartReceipt({...webReceipt(), browserUrl})).toBe(false);
});
it('does not return a challenge from a now-stale owner or echo a raw provider error', async () => {
  const pending = await received('awaiting_apple_authorization');
  jest.mocked(expoFetch).mockImplementationOnce(async () => {login(sdkUser('account-B')); return response({result: webReceipt()});});
  await expect(AccountErasureAppleWebService.start(pending, view)).rejects.toThrow('ouverture');
  login(owner); jest.mocked(expoFetch).mockResolvedValueOnce(response({error: {message: 'synthetic-private-cap-error'}}, 400));
  await expect(AccountErasureAppleWebService.start(pending, view)).rejects.not.toThrow('synthetic-private-cap-error');
});
