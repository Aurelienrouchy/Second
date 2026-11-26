import {OAuthProvider, reauthenticateWithCredential} from 'firebase/auth';
import {httpsCallable} from 'firebase/functions';
import * as AppleAuthentication from 'expo-apple-authentication';
import {auth} from '@/config/firebaseConfig';
import {runtimeEnvironment} from '@/config/firebaseEnvironment';
import {AuthService} from '@/services/authService';
import {consumeAppleErasureAuthorization} from '@/services/accountErasureAppleAuthorization';
import type {AccountErasureAttempt} from '@/types/accountErasure';

jest.mock('expo-application', () => ({applicationId: 'com.seconde.app'}));
jest.mock('@react-native-google-signin/google-signin', () => ({GoogleSignin: {}}));
jest.mock('@/utils/imageUtils', () => ({processImageWithBlurhash: jest.fn()}));
jest.mock('@/services/nativeStorageUpload', () => ({uploadPreparedJpeg: jest.fn()}));
jest.mock('expo-apple-authentication', () => ({isAvailableAsync: jest.fn(async () => true), signInAsync: jest.fn(),
  AppleAuthenticationScope: {FULL_NAME: 0, EMAIL: 1}}));
jest.mock('firebase/auth', () => ({reauthenticateWithCredential: jest.fn(async () => undefined), OAuthProvider: jest.fn(), onAuthStateChanged: jest.fn()}));

const owner = {uid: 'synthetic-owner', providerData: [{providerId: 'password'}, {providerId: 'apple.com'}]};
const attempt: AccountErasureAttempt = {protocol: 'account_erasure_v1', ownerId: owner.uid, commandId: 'a'.repeat(64),
  requestId: 'synthetic-request-123', phase: 'submitted', receipt: null, preparedAt: 1};
const credential = jest.fn(() => ({providerId: 'apple.com'}));
const originalEnvironment = runtimeEnvironment.name;
beforeEach(() => {
  jest.clearAllMocks(); runtimeEnvironment.name = 'production'; Object.assign(auth, {currentUser: owner});
  jest.mocked(OAuthProvider).mockImplementation(() => ({credential}) as never);
  jest.mocked(AppleAuthentication.signInAsync).mockResolvedValue({identityToken: 'synthetic-apple-id-token', authorizationCode: 'synthetic-apple-CODE'} as never);
});
afterEach(() => {runtimeEnvironment.name = originalEnvironment;});
it('uses the ID token and nonce for Firebase and retains the separate Apple CODE only as a bound opaque ticket', async () => {
  const guard = jest.fn(), wait = jest.fn(async () => undefined);
  const ticket = await AuthService.reauthenticateWithAppleForErasure(attempt, 8, guard, wait);
  expect(OAuthProvider).toHaveBeenCalledWith('apple.com');
  expect(credential).toHaveBeenCalledWith({idToken: 'synthetic-apple-id-token', rawNonce: expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(reauthenticateWithCredential).toHaveBeenCalledWith(owner, {providerId: 'apple.com'});
  expect(wait).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalled();
  expect(JSON.stringify(ticket)).not.toContain('synthetic-apple-CODE');
  expect(consumeAppleErasureAuthorization(ticket, attempt, owner as never, 8)).toBe('synthetic-apple-CODE');
  expect(httpsCallable).not.toHaveBeenCalled();
});
it('requires the fresh Apple authorization code even if Firebase primary reauthentication succeeded', async () => {
  jest.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({identityToken: 'synthetic-id-token', authorizationCode: null} as never);
  await expect(AuthService.reauthenticateWithAppleForErasure(attempt, 8, () => undefined)).rejects.toThrow('nouvelle autorisation');
  expect(reauthenticateWithCredential).toHaveBeenCalledTimes(1); expect(httpsCallable).not.toHaveBeenCalled();
});
it('does not adopt a native Apple result after switching the SDK owner', async () => {
  jest.mocked(AppleAuthentication.signInAsync).mockImplementationOnce(async () => {
    Object.assign(auth, {currentUser: {...owner}}); return {identityToken: 'synthetic-id-token', authorizationCode: 'synthetic-code'} as never;
  });
  await expect(AuthService.reauthenticateWithAppleForErasure(attempt, 8, () => undefined)).rejects.toThrow('session Apple');
  expect(reauthenticateWithCredential).not.toHaveBeenCalled();
});
it('preserves ordinary Apple reauthentication without requiring or returning a provider code', async () => {
  jest.mocked(AppleAuthentication.signInAsync).mockResolvedValueOnce({identityToken: 'synthetic-id-token', authorizationCode: null} as never);
  await expect(AuthService.reauthenticateWithApple(() => undefined)).resolves.toBeUndefined();
  expect(reauthenticateWithCredential).toHaveBeenCalledTimes(1);
});
