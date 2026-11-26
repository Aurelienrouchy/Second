/**
 * AuthService — comportement MÉTIER de l'inscription / connexion / consentement.
 *
 * Couvre les règles non-négociables du domaine auth-onboarding APRÈS le refacto
 * route plein écran (app/complete-profile.tsx) + split inscription :
 *  - signUpWithEmail(email, password, displayName) crée un compte « NU » : pas
 *    d'age gate à la création, pas de recordSignupConsent, pas d'auto-assign
 *    username. Email de vérification envoyé (best-effort). Doc users authProvider
 *    'email', SANS dateOfBirth.
 *  - recordConsentForCurrentUser(consent) : age gate client + consentements, puis
 *    appelle recordSignupConsent (avec desiredUsername si fourni) et PROPAGE
 *    l'erreur brute du callable (already-exists / invalid-argument /
 *    failed-precondition) — pas de rollback destructif ici.
 *  - checkUsernameAvailability(username) : passe-plat vers le callable.
 *  - Rollback Loi 25 (social uniquement) : un compte sans consentement est
 *    supprimé s'il est BRAND-NEW, mais seulement déconnecté s'il EXISTE déjà.
 *  - computeConsentState : nouveau compte OU compte sans dateOfBirth → needsConsent
 *  - Messages d'erreur Firebase traduits en FR
 *  - Apple Sign-In refusé hors iOS
 *
 * Placé en .test.tsx pour rester dans le périmètre Jest (les *.test.ts → Vitest).
 * On surcharge ici les mocks firebase/* du jest.setup pour exposer les exports
 * supplémentaires (createUserWithEmailAndPassword, getAdditionalUserInfo, ...).
 */

import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import firebaseProjects from '@/config/firebaseProjects.json';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readSignupConsent, sellerActivityPolicy, signupConsentPolicy } from '@/services/signupConsentJournal';

// ─── Mocks des dépendances natives non couvertes par jest.setup ───────────────

jest.mock('expo-application', () => ({ __esModule: true, applicationId: 'com.seconde.app.dev' }));
jest.mock('@/config/firebase/development/oauth.json', () => ({ googleWebClientId: '', googleIosClientId: '' }));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
    signIn: jest.fn(),
    signOut: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(() => Promise.resolve(new Uint8Array(32))),
  digestStringAsync: jest.fn(() => Promise.resolve('hashed-nonce')),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

// firebase/auth — surcouche complète (le jest.setup ne fournit qu'un sous-ensemble).
jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signInWithCredential: jest.fn(),
  signOut: jest.fn(() => Promise.resolve()),
  onAuthStateChanged: jest.fn(() => jest.fn()),
  updateProfile: jest.fn(() => Promise.resolve()),
  getAdditionalUserInfo: jest.fn(() => ({ isNewUser: false })),
  GoogleAuthProvider: { credential: jest.fn(() => ({ providerId: 'google.com' })) },
  OAuthProvider: jest.fn().mockImplementation(() => ({
    credential: jest.fn(() => ({ providerId: 'apple.com' })),
  })),
  EmailAuthProvider: { credential: jest.fn(() => ({ providerId: 'password' })) },
  reauthenticateWithCredential: jest.fn(() => Promise.resolve()),
  linkWithCredential: jest.fn(() => Promise.resolve()),
  verifyBeforeUpdateEmail: jest.fn(() => Promise.resolve()),
  updatePassword: jest.fn(() => Promise.resolve()),
  sendEmailVerification: jest.fn(() => Promise.resolve()),
  sendPasswordResetEmail: jest.fn(() => Promise.resolve()),
  reload: jest.fn(() => Promise.resolve()),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db, col, id) => ({ col, id })),
  getDoc: jest.fn(),
  setDoc: jest.fn(() => Promise.resolve()),
  updateDoc: jest.fn(() => Promise.resolve()),
  deleteDoc: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => 'server-ts'),
  arrayUnion: jest.fn((...args: unknown[]) => args),
}));

// Callable générique : accepte n'importe quel payload et résout vers une forme
// `{ data: ... }` ouverte (recordSignupConsent, checkUsernameAvailability, …).
const mockCallable = jest.fn(
  (..._args: unknown[]): Promise<{ data: Record<string, unknown> }> =>
    Promise.resolve({ data: { ok: true } }),
);
jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => mockCallable),
}));

// Le module firebaseConfig est déjà mocké dans jest.setup, mais on a besoin
// d'un `auth.currentUser` mutable pour les chemins reauthenticate/rollback.
jest.mock('@/config/firebaseConfig', () => ({
  auth: { currentUser: null },
  firestore: {},
  functions: {},
  storage: {},
}));

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCredential,
  getAdditionalUserInfo,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import { getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { auth } from '@/config/firebaseConfig';
import { AuthService } from '@/services/authService';

// Helpers pour fabriquer des dates de naissance ISO relatives à aujourd'hui.
function isoForAge(age: number): string {
  const d = new Date();
  return `${d.getFullYear() - age}-01-01`;
}

const VALID_CONSENT = {
  dateOfBirth: isoForAge(25),
  acceptedTerms: true,
  acceptedPrivacy: true,
  marketingOptIn: false,
  policyVersion: signupConsentPolicy.version,
  sellerActivityDeclaration: {kind: 'personal' as const, statementVersion: sellerActivityPolicy.version,
    personalDeclarationAccepted: true, expectedVersion: 'a'.repeat(64), requestId: 'signup-test-1', expectedUid: 'u'},
};

function makeUserDoc(data: Record<string, unknown>) {
  return {
    exists: () => true,
    id: (data.id as string) ?? 'uid-1',
    data: () => data,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockCallable.mockResolvedValue({ data: { ok: true } });
  (httpsCallable as jest.Mock).mockReturnValue(mockCallable);
  (auth as { currentUser: unknown }).currentUser = null;
});

describe('AuthService.signUpWithEmail — compte NU (split, sans age gate)', () => {
  beforeEach(() => {
    (createUserWithEmailAndPassword as jest.Mock).mockResolvedValue({
      user: { uid: 'uid-1', email: 'ok@x.com', photoURL: null, delete: jest.fn() },
    });
  });

  it('crée le compte Firebase + le doc users NU (authProvider email, SANS dateOfBirth, SANS consentement)', async () => {
    const user = await AuthService.signUpWithEmail('ok@x.com', 'password', 'Marie');

    expect(createUserWithEmailAndPassword).toHaveBeenCalled();
    expect(user.id).toBe('uid-1');
    expect(user.displayName).toBe('Marie');
    // Le doc est NU : pas de dateOfBirth, authProvider 'email'.
    const written = (setDoc as jest.Mock).mock.calls[0][1];
    expect(written.authProvider).toBe('email');
    expect(written.dateOfBirth).toBeUndefined();
    expect(user.dateOfBirth).toBeUndefined();
    // Le displayName Firebase est posé.
    expect(updateProfile).toHaveBeenCalledWith(expect.anything(), { displayName: 'Marie' });
    // PLUS de consentement ni d'assignation pseudo à la création : aucun callable.
    expect(httpsCallable).not.toHaveBeenCalledWith(expect.anything(), 'recordSignupConsent');
    expect(httpsCallable).not.toHaveBeenCalledWith(expect.anything(), 'assignUsername');
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('envoie l\'email de vérification (gate serveur createArticle)', async () => {
    await AuthService.signUpWithEmail('ok@x.com', 'password', 'Marie');
    expect(sendEmailVerification).toHaveBeenCalled();
  });

  it("n'échoue PAS l'inscription si l'email de vérification échoue (best-effort)", async () => {
    (sendEmailVerification as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
    await expect(
      AuthService.signUpWithEmail('ok@x.com', 'password', 'Marie'),
    ).resolves.toBeDefined();
  });

  it('traduit une erreur Firebase de création (email déjà utilisé) en message FR', async () => {
    (createUserWithEmailAndPassword as jest.Mock).mockRejectedValueOnce({
      code: 'auth/email-already-in-use',
    });
    await expect(
      AuthService.signUpWithEmail('dup@x.com', 'password', 'Dup'),
    ).rejects.toThrow(/déjà utilisée/);
  });
});

describe('AuthService.signUpWithEmail — rollback si le setDoc échoue', () => {
  it('supprime doc + compte Auth si le setDoc Firestore échoue APRÈS la création Auth', async () => {
    const deleteUser = jest.fn(() => Promise.resolve());
    (createUserWithEmailAndPassword as jest.Mock).mockResolvedValue({
      user: { uid: 'uid-rollback', email: 'r@x.com', photoURL: null, delete: deleteUser },
    });
    // L'écriture du doc users échoue : on ne doit pas laisser un compte Auth
    // orphelin sans doc Firestore → cleanup destructif (doc + Auth).
    (setDoc as jest.Mock).mockRejectedValueOnce(new Error('firestore down'));

    await expect(
      AuthService.signUpWithEmail('r@x.com', 'password', 'R'),
    ).rejects.toThrow(/création du compte a échoué/);

    expect(deleteDoc).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalled();
  });
});

describe('AuthService.signInWithEmail', () => {
  it('retourne les données utilisateur Firestore après connexion', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockResolvedValue({ user: { uid: 'uid-9' } });
    (getDoc as jest.Mock).mockResolvedValue(
      makeUserDoc({ id: 'uid-9', email: 'a@b.com', displayName: 'Anna', dateOfBirth: isoForAge(30) }),
    );

    const user = await AuthService.signInWithEmail('a@b.com', 'pw');
    expect(user.id).toBe('uid-9');
    expect(user.displayName).toBe('Anna');
  });

  it('lève un message FR traduit sur mauvais identifiants', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValue({ code: 'auth/invalid-credential' });
    await expect(AuthService.signInWithEmail('a@b.com', 'wrong')).rejects.toThrow(
      'Email ou mot de passe incorrect',
    );
  });

  it('lève si le doc Firestore est introuvable malgré une auth réussie', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockResolvedValue({ user: { uid: 'ghost' } });
    (getDoc as jest.Mock).mockResolvedValue({ exists: () => false, data: () => null });
    // L'erreur interne « Données utilisateur introuvables » (sans .code) est
    // re-mappée par getAuthErrorMessage vers le message générique : on ne doit
    // jamais retourner d'utilisateur (la connexion échoue), c'est le contrat.
    await expect(AuthService.signInWithEmail('a@b.com', 'pw')).rejects.toThrow(
      /Une erreur est survenue/,
    );
  });
});

describe('AuthService.signInWithGoogle — consentement & needsConsent', () => {
  const previousWebClientId = process.env.EXPO_PUBLIC_DEV_GOOGLE_WEB_CLIENT_ID;
  const previousIosClientId = process.env.EXPO_PUBLIC_DEV_GOOGLE_IOS_CLIENT_ID;
  afterEach(() => {
    if (previousWebClientId === undefined) delete process.env.EXPO_PUBLIC_DEV_GOOGLE_WEB_CLIENT_ID;
    else process.env.EXPO_PUBLIC_DEV_GOOGLE_WEB_CLIENT_ID = previousWebClientId;
    if (previousIosClientId === undefined) delete process.env.EXPO_PUBLIC_DEV_GOOGLE_IOS_CLIENT_ID;
    else process.env.EXPO_PUBLIC_DEV_GOOGLE_IOS_CLIENT_ID = previousIosClientId;
  });
  beforeEach(() => {
    // Synthetic OAuth IDs belong to the isolated dev project; no SDK network is used.
    process.env.EXPO_PUBLIC_DEV_GOOGLE_WEB_CLIENT_ID = `${firebaseProjects.development.messagingSenderId}-test-web.apps.googleusercontent.com`;
    process.env.EXPO_PUBLIC_DEV_GOOGLE_IOS_CLIENT_ID = `${firebaseProjects.development.messagingSenderId}-test-ios.apps.googleusercontent.com`;
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ data: { idToken: 'tok' } });
    (signInWithCredential as jest.Mock).mockResolvedValue({
      user: { uid: 'g-uid', email: 'g@x.com', displayName: 'Greta', photoURL: null },
    });
  });

  it('refuses production OAuth clients in dev before opening Google', async () => {
    process.env.EXPO_PUBLIC_DEV_GOOGLE_WEB_CLIENT_ID = '628214013296-prod.apps.googleusercontent.com';
    await expect(AuthService.signInWithGoogle()).rejects.toThrow('La connexion Google de Seconde Dev n’est pas encore configurée.');
    expect(GoogleSignin.hasPlayServices).not.toHaveBeenCalled();
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
  });

  it('keeps app initialization usable when dev OAuth is absent', async () => {
    delete process.env.EXPO_PUBLIC_DEV_GOOGLE_WEB_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_DEV_GOOGLE_IOS_CLIENT_ID;
    await expect(AuthService.initialize()).resolves.toBeUndefined();
    expect(GoogleSignin.configure).not.toHaveBeenCalled();
  });

  it('nouveau compte → needsConsent + isNewUser, crée le doc users (authProvider google)', async () => {
    (getAdditionalUserInfo as jest.Mock).mockReturnValue({ isNewUser: true });
    (getDoc as jest.Mock).mockResolvedValue({ exists: () => false, data: () => null });

    const result = await AuthService.signInWithGoogle();

    expect(result.needsConsent).toBe(true);
    expect(result.isNewUser).toBe(true);
    const written = (setDoc as jest.Mock).mock.calls[0][1];
    expect(written.authProvider).toBe('google');
  });

  it('compte existant SANS dateOfBirth → needsConsent mais isNewUser=false (jamais supprimable)', async () => {
    (getAdditionalUserInfo as jest.Mock).mockReturnValue({ isNewUser: false });
    (getDoc as jest.Mock).mockResolvedValue(
      makeUserDoc({ id: 'g-uid', email: 'g@x.com', displayName: 'Greta' }), // pas de dateOfBirth
    );

    const result = await AuthService.signInWithGoogle();

    expect(result.needsConsent).toBe(true);
    expect(result.isNewUser).toBe(false);
    // Pas de re-création de doc pour un compte existant.
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('compte existant AVEC dateOfBirth → needsConsent=false (déjà consenti)', async () => {
    (getAdditionalUserInfo as jest.Mock).mockReturnValue({ isNewUser: false });
    (getDoc as jest.Mock).mockResolvedValue(
      makeUserDoc({ id: 'g-uid', email: 'g@x.com', displayName: 'Greta', dateOfBirth: isoForAge(30) }),
    );

    const result = await AuthService.signInWithGoogle();
    expect(result.needsConsent).toBe(false);
  });

  it('handles the resolved cancellation response returned by Google Sign-In v16', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({type: 'cancelled', data: null});
    await expect(AuthService.signInWithGoogle()).rejects.toThrow('Connexion Google annulée');
    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('traduit une annulation Google en message FR', async () => {
    (GoogleSignin.signIn as jest.Mock).mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    await expect(AuthService.signInWithGoogle()).rejects.toThrow('Connexion Google annulée');
  });
});

describe('AuthService.signInWithApple — garde-fou plateforme', () => {
  it('requires the dev native app before opening Apple in a production binary', async () => {
    const native = Application as { applicationId: string };
    const previous = native.applicationId;
    native.applicationId = 'com.seconde.app';
    try {
      await expect(AuthService.signInWithApple()).rejects.toThrow('nécessitent l’application Seconde Dev');
      expect(AppleAuthentication.signInAsync).not.toHaveBeenCalled();
      const status = await AuthService.getAuthConfigStatus();
      expect(status.apple).toBe('native_build_required');
      expect(status.emailPassword).toBe('server_configuration_not_verified');
    } finally { native.applicationId = previous; }
  });

  it('keeps the 32-byte hashed Apple challenge and original nonce bound to Firebase', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({ identityToken: 'apple-token', fullName: null });
    (signInWithCredential as jest.Mock).mockResolvedValue({ user: {uid: 'a-uid', email: 'a@x.com', displayName: 'Anne'} });
    (getAdditionalUserInfo as jest.Mock).mockReturnValue({ isNewUser: false });
    (getDoc as jest.Mock).mockResolvedValue(makeUserDoc({ id: 'a-uid', displayName: 'Anne', dateOfBirth: isoForAge(30) }));
    await AuthService.signInWithApple();
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledWith(32);
    expect(Crypto.digestStringAsync).toHaveBeenCalledWith('SHA256', '00'.repeat(32));
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith(expect.objectContaining({nonce: 'hashed-nonce'}));
    const { OAuthProvider } = require('firebase/auth');
    expect(OAuthProvider.mock.results.at(-1).value.credential).toHaveBeenCalledWith({idToken: 'apple-token', rawNonce: '00'.repeat(32)});
  });

  it('refuse hors iOS', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    await expect(AuthService.signInWithApple()).rejects.toThrow(/uniquement sur iOS/);
    Object.defineProperty(Platform, 'OS', { get: () => original, configurable: true });
  });
});

describe('AuthService.rollbackUnconsentedAccount — Loi 25', () => {
  it('compte BRAND-NEW (isNewUser=true) → suppression destructive (doc + Auth)', async () => {
    const deleteUser = jest.fn(() => Promise.resolve());
    (auth as { currentUser: unknown }).currentUser = { uid: 'new-uid', delete: deleteUser };

    await AuthService.rollbackUnconsentedAccount(true);

    expect(deleteDoc).toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalled();
  });

  it('compte EXISTANT (isNewUser=false) → simple signOut, JAMAIS de suppression', async () => {
    const deleteUser = jest.fn(() => Promise.resolve());
    (auth as { currentUser: unknown }).currentUser = { uid: 'existing-uid', delete: deleteUser };

    await AuthService.rollbackUnconsentedAccount(false);

    expect(deleteUser).not.toHaveBeenCalled();
    expect(deleteDoc).not.toHaveBeenCalled();
    // signOut Firebase appelé (préserve le compte, déconnecte seulement).
    expect(GoogleSignin.signOut).toHaveBeenCalled();
  });

  it('no-op si aucun utilisateur courant', async () => {
    (auth as { currentUser: unknown }).currentUser = null;
    await expect(AuthService.rollbackUnconsentedAccount(true)).resolves.toBeUndefined();
    expect(deleteDoc).not.toHaveBeenCalled();
  });
});

describe('AuthService.recordConsentForCurrentUser', () => {
  it('refuses an unchecked personal declaration or wrong identity before any mutation', async () => {
    (auth as {currentUser: unknown}).currentUser = {uid: 'u'};
    await expect(AuthService.recordConsentForCurrentUser({...VALID_CONSENT, sellerActivityDeclaration: {
      ...VALID_CONSENT.sellerActivityDeclaration, personalDeclarationAccepted: false,
    }})).rejects.toMatchObject({code: 'client/signup-journal-invalid'});
    await expect(AuthService.recordConsentForCurrentUser({...VALID_CONSENT, sellerActivityDeclaration: {
      ...VALID_CONSENT.sellerActivityDeclaration, expectedUid: 'someone-else',
    }})).rejects.toMatchObject({code: 'client/signup-journal-invalid'});
    expect(mockCallable).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('persists before IO, preserves an uncertain original and rejects changed retry choices', async () => {
    (auth as {currentUser: unknown}).currentUser = {uid: 'u'};
    mockCallable.mockImplementationOnce(async () => {
      expect(await readSignupConsent('u')).toEqual(VALID_CONSENT);
      throw {code: 'functions/unavailable'};
    });
    await expect(AuthService.recordConsentForCurrentUser(VALID_CONSENT)).rejects.toMatchObject({code: 'functions/unavailable'});
    expect(await AuthService.getPendingSignupConsent('u')).toEqual(VALID_CONSENT);
    await expect(AuthService.recordConsentForCurrentUser({...VALID_CONSENT, marketingOptIn: true})).rejects.toMatchObject({code: 'client/signup-pending'});
    expect(mockCallable).toHaveBeenCalledTimes(1);
    (getDoc as jest.Mock).mockResolvedValue(makeUserDoc({id: 'u', dateOfBirth: VALID_CONSENT.dateOfBirth}));
    await AuthService.recordConsentForCurrentUser(VALID_CONSENT);
    expect(mockCallable.mock.calls[1][0]).toEqual(mockCallable.mock.calls[0][0]);
    expect(await readSignupConsent('u')).toEqual(VALID_CONSENT);
    await AuthService.acknowledgeSignupConsent(VALID_CONSENT, {assertCurrent: () => {}});
    expect(await readSignupConsent('u')).toBeNull();
  });

  it('keeps replay available until adoption, then acknowledges a known receipt without a focus fence', async () => {
    (auth as {currentUser: unknown}).currentUser = {uid: 'u'};
    (getDoc as jest.Mock).mockResolvedValue(makeUserDoc({id: 'u', dateOfBirth: VALID_CONSENT.dateOfBirth}));
    let focused = true;
    const assertCurrent = () => {if (!focused) throw new Error('focus lost');};
    await AuthService.recordConsentForCurrentUser(VALID_CONSENT, {assertCurrent});
    expect(await readSignupConsent('u')).toEqual(VALID_CONSENT);
    const remove = AsyncStorage.removeItem.getMockImplementation!();
    jest.mocked(AsyncStorage.removeItem).mockImplementationOnce(async key => {
      focused = false;
      await remove?.(key);
    });
    const adoptedIdentity = jest.fn();
    await expect(AuthService.acknowledgeSignupConsent(VALID_CONSENT, {assertCurrent: adoptedIdentity})).resolves.toBeUndefined();
    expect(focused).toBe(false);
    expect(adoptedIdentity).toHaveBeenCalled();
    expect(await readSignupConsent('u')).toBeNull();
  });

  it('keeps the original after a request collision but permits a new command after an explicit CAS refusal', async () => {
    (auth as {currentUser: unknown}).currentUser = {uid: 'u'};
    mockCallable.mockRejectedValueOnce({code: 'functions/already-exists'});
    await expect(AuthService.recordConsentForCurrentUser(VALID_CONSENT)).rejects.toMatchObject({code: 'functions/already-exists'});
    expect(await readSignupConsent('u')).toEqual(VALID_CONSENT);
    mockCallable.mockRejectedValueOnce({code: 'functions/aborted', details: {reason: 'eligibility_version_changed'}});
    await expect(AuthService.recordConsentForCurrentUser(VALID_CONSENT)).rejects.toMatchObject({code: 'functions/aborted'});
    expect(await readSignupConsent('u')).toBeNull();
  });

  it('blocks a second submit synchronously and never adopts a response for a replaced Firebase identity', async () => {
    (auth as {currentUser: unknown}).currentUser = {uid: 'u'};
    let finish!: (value: {data: {ok: true}}) => void;
    const response = new Promise<{data: {ok: true}}>(resolve => {finish = resolve;});
    const entered = new Promise<void>(resolve => {mockCallable.mockImplementationOnce(() => {resolve(); return response;});});
    const first = AuthService.recordConsentForCurrentUser(VALID_CONSENT);
    await entered;
    await expect(AuthService.recordConsentForCurrentUser(VALID_CONSENT)).rejects.toMatchObject({code: 'client/signup-in-progress'});
    (auth as {currentUser: unknown}).currentUser = {uid: 'other'};
    finish({data: {ok: true}});
    await expect(first).rejects.toMatchObject({code: 'client/stale-operation'});
    expect(getDoc).not.toHaveBeenCalled();
    expect(await readSignupConsent('u')).toEqual(VALID_CONSENT);
  });

  it('stops before the RPC if focus changed during durable persistence', async () => {
    (auth as {currentUser: unknown}).currentUser = {uid: 'u'};
    let assertions = 0;
    const assertCurrent = () => {if (++assertions >= 3) throw Object.assign(new Error('stale'), {code: 'client/stale-operation'});};
    await expect(AuthService.recordConsentForCurrentUser(VALID_CONSENT, {assertCurrent})).rejects.toMatchObject({code: 'client/stale-operation'});
    expect(mockCallable).not.toHaveBeenCalled();
    expect(await readSignupConsent('u')).toEqual(VALID_CONSENT);
  });
  it('lève si aucun utilisateur connecté', async () => {
    (auth as { currentUser: unknown }).currentUser = null;
    await expect(AuthService.recordConsentForCurrentUser(VALID_CONSENT)).rejects.toThrow(
      /non connecté/,
    );
  });

  it('refuse un mineur sans appeler le callable serveur', async () => {
    (auth as { currentUser: unknown }).currentUser = { uid: 'u' };
    await expect(
      AuthService.recordConsentForCurrentUser({ ...VALID_CONSENT, dateOfBirth: isoForAge(15) }),
    ).rejects.toThrow(/au moins 16 ans/);
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('enregistre le consentement puis retourne le user rafraîchi', async () => {
    (auth as { currentUser: unknown }).currentUser = { uid: 'u' };
    (getDoc as jest.Mock).mockResolvedValue(
      makeUserDoc({ id: 'u', email: 'u@x.com', dateOfBirth: VALID_CONSENT.dateOfBirth }),
    );

    const fresh = await AuthService.recordConsentForCurrentUser(VALID_CONSENT);
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'recordSignupConsent');
    expect(mockCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        dateOfBirth: VALID_CONSENT.dateOfBirth,
        acceptedTerms: true,
        acceptedPrivacy: true,
        marketingOptIn: false,
      }),
    );
    expect(fresh.dateOfBirth).toBe(VALID_CONSENT.dateOfBirth);
  });

  it('transmet desiredUsername au callable quand il est fourni', async () => {
    (auth as { currentUser: unknown }).currentUser = { uid: 'u' };
    (getDoc as jest.Mock).mockResolvedValue(
      makeUserDoc({ id: 'u', email: 'u@x.com', dateOfBirth: VALID_CONSENT.dateOfBirth, username: 'marie' }),
    );

    await AuthService.recordConsentForCurrentUser({ ...VALID_CONSENT, desiredUsername: 'marie' });
    expect(mockCallable).toHaveBeenCalledWith(
      expect.objectContaining({ desiredUsername: 'marie' }),
    );
  });

  it("n'inclut JAMAIS desiredUsername:undefined dans le payload (pas de undefined Firestore)", async () => {
    (auth as { currentUser: unknown }).currentUser = { uid: 'u' };
    (getDoc as jest.Mock).mockResolvedValue(
      makeUserDoc({ id: 'u', email: 'u@x.com', dateOfBirth: VALID_CONSENT.dateOfBirth }),
    );

    await AuthService.recordConsentForCurrentUser(VALID_CONSENT);
    const payload = mockCallable.mock.calls[0][0] as Record<string, unknown>;
    expect('desiredUsername' in payload).toBe(false);
  });

  it("propage l'erreur BRUTE du callable (already-exists pseudo pris) SANS rollback", async () => {
    (auth as { currentUser: unknown }).currentUser = { uid: 'u' };
    const takenError = Object.assign(new Error('username taken'), {
      code: 'already-exists',
      details: { field: 'username' },
    });
    mockCallable.mockRejectedValueOnce(takenError);

    // L'erreur remonte telle quelle (code/details préservés) → la route peut
    // afficher « pseudo pris » inline et laisser l'user re-soumettre. Aucun
    // getDoc de rafraîchissement, aucune suppression de compte.
    await expect(
      AuthService.recordConsentForCurrentUser({ ...VALID_CONSENT, desiredUsername: 'marie' }),
    ).rejects.toMatchObject({ code: 'already-exists', details: { field: 'username' } });
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('lève si le user Firestore est introuvable après un consentement réussi', async () => {
    (auth as { currentUser: unknown }).currentUser = { uid: 'u' };
    (getDoc as jest.Mock).mockResolvedValue({ exists: () => false, data: () => null });

    await expect(AuthService.recordConsentForCurrentUser(VALID_CONSENT)).rejects.toThrow(
      /introuvables/,
    );
  });
});

describe('AuthService.checkUsernameAvailability', () => {
  it('relaie le résultat du callable checkUsernameAvailability', async () => {
    mockCallable.mockResolvedValueOnce({ data: { ok: true, available: true } });

    const result = await AuthService.checkUsernameAvailability('marie');
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'checkUsernameAvailability');
    expect(mockCallable).toHaveBeenCalledWith({ username: 'marie' });
    expect(result).toEqual({ ok: true, available: true });
  });

  it('relaie un pseudo indisponible (taken)', async () => {
    mockCallable.mockResolvedValueOnce({ data: { ok: true, available: false, reason: 'taken' } });

    const result = await AuthService.checkUsernameAvailability('prise');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('taken');
  });
});

describe('AuthService.getAuthProvider / hasPasswordProvider', () => {
  it('reconnaît le provider password', () => {
    (auth as { currentUser: unknown }).currentUser = {
      providerData: [{ providerId: 'password' }],
    };
    expect(AuthService.getAuthProvider()).toBe('password');
    expect(AuthService.hasPasswordProvider()).toBe(true);
  });

  it('priorise apple.com puis google.com', () => {
    (auth as { currentUser: unknown }).currentUser = {
      providerData: [{ providerId: 'google.com' }, { providerId: 'apple.com' }],
    };
    expect(AuthService.getAuthProvider()).toBe('apple.com');
  });

  it("retourne 'unknown' sans utilisateur", () => {
    (auth as { currentUser: unknown }).currentUser = null;
    expect(AuthService.getAuthProvider()).toBe('unknown');
    expect(AuthService.hasPasswordProvider()).toBe(false);
  });
});

describe('AuthService.isEmailVerified', () => {
  it('reflète emailVerified du user courant', () => {
    (auth as { currentUser: unknown }).currentUser = { emailVerified: true };
    expect(AuthService.isEmailVerified()).toBe(true);
    (auth as { currentUser: unknown }).currentUser = { emailVerified: false };
    expect(AuthService.isEmailVerified()).toBe(false);
    (auth as { currentUser: unknown }).currentUser = null;
    expect(AuthService.isEmailVerified()).toBe(false);
  });
});
