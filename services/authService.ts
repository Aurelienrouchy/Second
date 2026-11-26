import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { catalogueCallableName } from '@/config/catalogueCallableContracts';
import { resolveGoogleSignInConfiguration, socialAuthBundleId } from '@/config/socialAuthConfig';
import * as Application from 'expo-application';
import { auth, firestore, functions } from '@/config/firebaseConfig';
import { User } from '@/types';
import {isSmallBalanceSettlement} from '@/utils/smallBalanceClosure';
import type {SmallBalanceSettlement} from '@/types/wallet';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signOut as firebaseSignOut,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  linkWithCredential,
  verifyBeforeUpdateEmail,
  updatePassword as firebaseUpdatePassword,
  sendEmailVerification as firebaseSendEmailVerification,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  reload,
  type UserCredential,
} from 'firebase/auth';
import {
  arrayUnion,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { issueAppleErasureAuthorization } from '@/services/accountErasureAppleAuthorization';
import type { AppleErasureAuthorization } from '@/services/accountErasureAppleAuthorization';
import type { AccountErasureAttempt } from '@/types/accountErasure';

import { computeAgeFromIso, MIN_AGE_REGISTER } from '@/utils/age';
import { clearSignupConsent, isDefinitiveSignupRefusal, parseSignupConsent, readSignupConsent, writeSignupConsent,
  type SignupConsent } from '@/services/signupConsentJournal';
export type { SignupConsent } from '@/services/signupConsentJournal';

export interface SignupConsentContext { assertCurrent: () => void }
const signupSubmissions = new Set<string>();

/**
 * Consent payload collected at signup. `dateOfBirth` is an ISO "YYYY-MM-DD"
 * calendar string (no Date/timezone) shared with the backend callable
 * `recordSignupConsent`.
 *
 * `desiredUsername` is the user-chosen @handle picked on the mandatory
 * post-signup route (app/complete-profile.tsx). It is RESERVED + persisted
 * atomically by recordSignupConsent. Optional: legacy/auto-assign fallback when
 * absent.
 */
/**
 * Result of a social sign-in (Google/Apple).
 *
 * `needsConsent` is true when the account is BRAND NEW (Firebase
 * `isNewUser`) or when an existing account has no recorded consent yet
 * (no `dateOfBirth` on users/{uid}). In that case the caller MUST present
 * the mandatory consent step (age gate + Terms + Privacy) BEFORE letting
 * the user into the app — a social sign-in must never bypass Loi 25
 * consent (art. 12, 14). If the user backs out, the caller must call
 * `AuthService.rollbackUnconsentedAccount()` so no account ever subsists
 * without proof of consent.
 */
export interface SocialAuthResult {
  user: User;
  needsConsent: boolean;
  /**
   * True UNIQUEMENT pour un compte fraîchement créé (Firebase
   * `getAdditionalUserInfo().isNewUser`). Distingue un brand-new account
   * d'un compte EXISTANT sans `dateOfBirth` : seul le premier peut être
   * supprimé en cas de refus de consentement (cf. rollbackUnconsentedAccount).
   */
  isNewUser: boolean;
}

export type AccountClosureMode = 'pause' | 'delete';
export interface AccountClosureResult {
  success: boolean;
  status: 'paused' | 'incomplete' | 'complete';
  deletionComplete: boolean;
  newOperationsBlocked: boolean;
  authDeleted?: boolean;
  blockers?: string[];
  incompleteParts?: string[];
  action?: string;
  smallBalanceSettlement?: SmallBalanceSettlement | null;
}

export function isAccountClosureResult(value: unknown): value is AccountClosureResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  if (typeof result.success !== 'boolean' || typeof result.deletionComplete !== 'boolean' ||
      result.newOperationsBlocked !== true || typeof result.status !== 'string' ||
      !['paused', 'incomplete', 'complete'].includes(result.status)) return false;
  if (result.status === 'complete' ? !result.success || !result.deletionComplete : result.deletionComplete) return false;
  if (result.authDeleted !== undefined && typeof result.authDeleted !== 'boolean') return false;
  if (result.smallBalanceSettlement !== undefined && result.smallBalanceSettlement !== null && (!isSmallBalanceSettlement(result.smallBalanceSettlement) || result.status === 'complete' || result.deletionComplete !== false || result.authDeleted === true)) return false;
  for (const key of ['blockers', 'incompleteParts']) {
    const items = result[key];
    if (items !== undefined && (!Array.isArray(items) || !items.every(item => typeof item === 'string'))) return false;
  }
  if (Array.isArray(result.blockers) && result.blockers.some(blocker => blocker === 'privacy_retention_review_required' ||
    blocker === 'external_erasure_retention_review_required') &&
    (result.success !== false || result.deletionComplete !== false || result.status === 'complete' ||
      (result.action !== 'contactSupport' && !(result.action === 'settleSmallBalance' && isSmallBalanceSettlement(result.smallBalanceSettlement))))) return false;
  return result.action === undefined || typeof result.action === 'string';
}

function generateDefaultUsername(uid: string): string {
  return `user${uid.slice(-6)}`;
}

/**
 * Longueur maximale d'un nom d'affichage, imposée par `firestore.rules`
 * (`isValidUserData` : `isValidString(displayName, 1, 50)`).
 *
 * Le nom rendu par Google ou Apple n'est borné par RIEN. Un nom composé long —
 * patronymes portugais ou hispaniques, doubles noms — dépasse 50 caractères, et
 * l'écriture était alors REFUSÉE par la règle : `setDoc` lève à la première
 * connexion, le `catch` englobant le convertit en « Erreur lors de la connexion
 * Google. Veuillez réessayer. », et le retry échoue à l'identique. La personne
 * est enfermée dehors de son propre compte, sans que rien n'indique pourquoi.
 *
 * On tronque donc au bord du client, avant l'écriture, sur les deux chemins
 * (création du document et rattrapage d'un nom générique) et pour les deux
 * fournisseurs.
 */
const MAX_DISPLAY_NAME_LENGTH = 50;

/** Nom d'affichage borné, prêt à être écrit. */
function boundDisplayName(name: string): string {
  return name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function isGenericDisplayName(name: string | null | undefined): boolean {
  if (!name || name.trim().length === 0) return true;
  const lower = name.toLowerCase().trim();
  return lower.includes('utilisateur') || lower === 'user';
}

function googleSignInConfig() {
  return resolveGoogleSignInConfiguration({
    environment: runtimeEnvironment.name,
    platform: Platform.OS,
    webClientId: process.env.EXPO_PUBLIC_DEV_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_DEV_GOOGLE_IOS_CLIENT_ID,
  });
}

function requireSocialAuthNativeBuild(): void {
  const expectedBundleId = socialAuthBundleId(runtimeEnvironment.name);
  if (Application.applicationId !== expectedBundleId) {
    throw new Error(runtimeEnvironment.name === 'development'
      ? 'Google et Apple nécessitent l’application Seconde Dev. Installez le client de développement, puis réessayez.'
      : 'Cette version de l’application ne correspond pas à l’environnement de connexion.');
  }
}

function requireGoogleSignInConfiguration(): void {
  requireSocialAuthNativeBuild();
  const configuration = googleSignInConfig();
  if (!configuration) {
    throw new Error('La connexion Google de Seconde Dev n’est pas encore configurée. Utilisez une adresse courriel et un mot de passe de test.');
  }
  GoogleSignin.configure(configuration);
}

export class AuthService {
  /**
   * Déclenche l'assignation du `username` persistant, unique et immuable côté
   * serveur (callable `assignUsername`, région northamerica-northeast1).
   *
   * Le username est dérivé serveur du `displayName` et écrit UNE SEULE FOIS à
   * la création du compte. La callable est IDEMPOTENTE : la rappeler sur un
   * compte déjà doté d'un username est un no-op (`alreadyAssigned: true`).
   * Précondition serveur : le doc users/{uid} doit déjà exister — n'appeler
   * qu'APRÈS le setDoc de création.
   *
   * Best-effort : un échec ne doit JAMAIS faire échouer l'inscription ni la
   * connexion (le compte Auth + doc users existent déjà). Le filet de sécurité
   * au login rattrapera. On avale l'erreur (log __DEV__ uniquement).
   */
  static async ensureUsernameAssigned(): Promise<void> {
    try {
      const assignUsernameFn = httpsCallable<
        Record<string, never>,
        { ok: true; username: string; alreadyAssigned: boolean }
      >(functions, 'assignUsername');
      await assignUsernameFn({});
    } catch (error) {
      if (__DEV__) {
        console.error('[AuthService] ensureUsernameAssigned failed (non-blocking):', error);
      }
    }
  }

  /**
   * Initialise les services d'authentification
   */
  static async initialize(): Promise<void> {
    try {
      const config = googleSignInConfig();
      // Missing OAuth setup disables Google only; email sign-in remains usable.
      if (config) GoogleSignin.configure(config);
    } catch (error) {
      if (__DEV__) console.error('[AuthService] Failed to configure Google Sign-In:', error);
      throw error;
    }
  }

  /**
   * Inscription email — crée le compte Firebase Auth + le doc users/{uid} NU
   * (sans dateOfBirth, sans consentement, sans username).
   *
   * SPLIT (audit) : la collecte DOB + consentements + @pseudo a été déplacée
   * vers la route plein écran OBLIGATOIRE (app/complete-profile.tsx), qui appelle
   * recordSignupConsent APRÈS la création. Cette méthode ne fait donc QUE créer
   * le compte « nu » ; l'utilisateur ressort authentifié côté Firebase mais
   * `pendingConsent` côté app (gate authStore : pas de dateOfBirth ⇒ pas
   * pleinement connecté). Le username n'est PLUS auto-assigné ici : il est choisi
   * sur la route et réservé par recordSignupConsent.
   *
   * Pas de rollback destructif ici : un compte sans dateOfBirth est un état
   * intermédiaire LÉGITIME et attendu (la route force le consentement avant tout
   * accès, et le guard de démarrage y ramène un user qui aurait kill l'app). Si
   * le setDoc échoue après la création Auth, on supprime tout de même le compte
   * fraîchement créé pour ne pas laisser un compte Auth sans doc Firestore.
   */
  static async signUpWithEmail(
    email: string,
    password: string,
    displayName: string,
  ): Promise<User> {
    let firebaseUser: import('firebase/auth').User;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      firebaseUser = userCredential.user;

      // Mettre à jour le profil Firebase avec le nom d'affichage
      await updateProfile(firebaseUser, { displayName });
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }

    try {
      // Créer l'utilisateur NU dans Firestore (pas de dateOfBirth : la route de
      // consentement l'écrira via recordSignupConsent — la rule l'interdit au
      // create de toute façon).
      const userData: User = {
        id: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName,
        createdAt: new Date(),
        isActive: true,
      };

      if (firebaseUser.photoURL) {
        userData.profileImage = firebaseUser.photoURL;
      }

      const firestoreData: Record<string, unknown> = {
        id: userData.id,
        email: userData.email,
        displayName: userData.displayName,
        createdAt: serverTimestamp(),
        isActive: true,
        authProvider: 'email',
      };

      if (userData.profileImage) {
        firestoreData.profileImage = userData.profileImage;
      }

      await setDoc(doc(firestore, 'users', firebaseUser.uid), firestoreData);

      // Envoie l'email de vérification (le gate serveur createArticle exige
      // email_verified). Non-bloquant : un échec d'envoi ne doit pas faire
      // échouer l'inscription — l'utilisateur peut le renvoyer depuis
      // l'écran « Vérifier mon email ».
      try {
        await firebaseSendEmailVerification(firebaseUser);
      } catch (verificationError) {
        if (__DEV__) {
          console.error('[AuthService] signUpWithEmail sendEmailVerification failed:', verificationError);
        }
      }

      return userData;
    } catch (error: any) {
      if (__DEV__) {
        console.error('[AuthService] signUpWithEmail post-create error:', error);
      }

      // Le setDoc a échoué après la création du compte Auth → on supprime le
      // doc user (best-effort) puis le compte Auth (session récente) pour ne pas
      // laisser un compte Auth orphelin sans doc Firestore.
      try {
        await deleteDoc(doc(firestore, 'users', firebaseUser.uid));
      } catch (cleanupError) {
        if (__DEV__) {
          console.error('[AuthService] signUpWithEmail user doc cleanup failed:', cleanupError);
        }
      }

      try {
        await firebaseUser.delete();
      } catch (deleteError) {
        if (__DEV__) {
          console.error('[AuthService] signUpWithEmail auth rollback failed:', deleteError);
        }
      }

      throw new Error('La création du compte a échoué. Veuillez réessayer.');
    }
  }

  /**
   * Connexion avec email et mot de passe
   */
  static async signInWithEmail(email: string, password: string): Promise<User> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;

      const userData = await this.getUserData(firebaseUser.uid);
      if (!userData) {
        throw new Error('Données utilisateur introuvables');
      }

      return userData;
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Détermine si un utilisateur social fraîchement authentifié doit passer
   * par l'écran de consentement obligatoire (Loi 25 art. 12, 14).
   *
   * needsConsent === true si :
   *  - le compte est nouveau (Firebase `isNewUser`), OU
   *  - le doc users/{uid} existe sans `dateOfBirth` (donc sans preuve de
   *    consentement enregistrée par recordSignupConsent).
   *
   * Le `dateOfBirth` n'est écrit QUE par le callable serveur
   * recordSignupConsent : son absence est la source de vérité du « pas
   * encore consenti ».
   */
  private static computeConsentState(
    userCredential: UserCredential,
    existingUser: User | null,
  ): { needsConsent: boolean; isNewUser: boolean } {
    const isNewUser = getAdditionalUserInfo(userCredential)?.isNewUser === true;
    // needsConsent : nouveau compte, OU compte existant sans dateOfBirth.
    // isNewUser : brand-new uniquement — détermine si un rollback peut
    // supprimer le compte (cf. rollbackUnconsentedAccount).
    const needsConsent =
      isNewUser || !existingUser || !existingUser.dateOfBirth;
    return { needsConsent, isNewUser };
  }

  /**
   * Connexion avec Google
   */
  static async signInWithGoogle(): Promise<SocialAuthResult> {
    requireGoogleSignInConfiguration();
    try {
      // Vérifier si Google Play Services est disponible
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Obtenir les informations utilisateur de Google
      const userInfo = await GoogleSignin.signIn();
      if (userInfo.type === 'cancelled') {
        throw Object.assign(new Error('Connexion Google annulée'), { code: 'SIGN_IN_CANCELLED' });
      }

      // Extraire correctement l'idToken et l'accessToken selon la forme retournée
      const idToken = (userInfo as any)?.idToken ?? (userInfo as any)?.data?.idToken;
      const accessToken = (userInfo as any)?.accessToken ?? (userInfo as any)?.data?.accessToken;

      if (!idToken) {
        throw new Error('Connexion Google impossible. Vérifiez la configuration SHA-1 dans Firebase Console.');
      }

      // Créer un credential Firebase avec le token Google
      const googleCredential = GoogleAuthProvider.credential(idToken, accessToken);

      // Se connecter à Firebase avec le credential Google
      const userCredential = await signInWithCredential(auth, googleCredential);
      const firebaseUser = userCredential.user;

      const googleName = boundDisplayName(
        isGenericDisplayName(firebaseUser.displayName)
          ? generateDefaultUsername(firebaseUser.uid)
          : firebaseUser.displayName!,
      );

      let userData = await this.getUserData(firebaseUser.uid);
      // Calcule AVANT de créer/mettre à jour le doc (sinon getUserData ne
      // refléterait plus l'état "nouveau").
      const { needsConsent, isNewUser } = this.computeConsentState(
        userCredential,
        userData,
      );

      if (!userData) {
        userData = {
          id: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: googleName,
          profileImage: firebaseUser.photoURL || undefined,
          createdAt: new Date(),
          isActive: true,
        };

        const firestoreData: Record<string, unknown> = {
          id: userData.id,
          email: userData.email,
          displayName: userData.displayName,
          createdAt: serverTimestamp(),
          isActive: true,
          authProvider: 'google',
        };

        if (userData.profileImage) {
          firestoreData.profileImage = userData.profileImage;
        }

        await setDoc(doc(firestore, 'users', firebaseUser.uid), firestoreData);

        // Le username n'est PLUS auto-assigné à la création : il est choisi par
        // l'utilisateur sur la route de consentement obligatoire et réservé par
        // recordSignupConsent (desiredUsername). Le filet de rattrapage legacy
        // dans authStore couvre les comptes pré-existants sans username.
      } else if (isGenericDisplayName(userData.displayName)) {
        await updateDoc(doc(firestore, 'users', firebaseUser.uid), { displayName: googleName });
        userData.displayName = googleName;
      }

      return { user: userData, needsConsent, isNewUser };
    } catch (error: any) {
      if (error?.code === 'SIGN_IN_CANCELLED' || error?.code === 'ERR_REQUEST_CANCELED') {
        throw new Error('Connexion Google annulée');
      } else if (error?.code === 'IN_PROGRESS') {
        throw new Error('Une connexion Google est déjà en cours');
      } else if (error?.code === 'PLAY_SERVICES_NOT_AVAILABLE') {
        throw new Error('Google Play Services non disponible');
      } else if (error?.code === 'DEVELOPER_ERROR') {
        throw new Error('La connexion Google est indisponible sur cette version. Réessayez ou contactez l’assistance.');
      }

      if (error?.code === 'auth/account-exists-with-different-credential') {
        throw new Error(
          'Un compte existe déjà avec cette adresse e-mail via une autre méthode de connexion. Connectez-vous avec votre e-mail et mot de passe.',
        );
      }

      if (__DEV__) console.error('[AuthService] Google Sign-In error:', error?.code, error?.message);
      throw new Error('Erreur lors de la connexion Google. Veuillez réessayer.');
    }
  }


  /**
   * Connexion avec Apple (expo-apple-authentication)
   */
  static async signInWithApple(): Promise<SocialAuthResult> {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Sign-In disponible uniquement sur iOS.');
    }
    requireSocialAuthNativeBuild();
    try {
      // Garde-fou de disponibilité runtime (Apple peut être indisponible même
      // sur iOS : simulateur sans compte, version < iOS 13, etc.).
      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        throw new Error('Apple Sign-In n\'est pas disponible sur cet appareil.');
      }

      const nonceBytes = await Crypto.getRandomBytesAsync(32);
      const nonce = Array.from(new Uint8Array(nonceBytes))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        nonce
      );

      // Effectuer la requête de connexion Apple
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      // Vérifier si l'utilisateur a terminé la connexion
      if (!credential.identityToken) {
        throw new Error('Apple Sign-In échoué - pas de token d\'identité');
      }

      // Créer un credential Firebase avec le token Apple
      const provider = new OAuthProvider('apple.com');
      const appleCredential = provider.credential({
        idToken: credential.identityToken,
        rawNonce: nonce,
      });

      // Se connecter à Firebase avec le credential Apple
      const userCredential = await signInWithCredential(auth, appleCredential);
      const firebaseUser = userCredential.user;

      const appleFullName = credential.fullName
        ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
        : '';
      const resolvedName = boundDisplayName(
        appleFullName
          || (isGenericDisplayName(firebaseUser.displayName) ? null : firebaseUser.displayName)
          || generateDefaultUsername(firebaseUser.uid),
      );

      let userData = await this.getUserData(firebaseUser.uid);
      // Calcule AVANT toute écriture (cf. signInWithGoogle).
      const { needsConsent, isNewUser } = this.computeConsentState(
        userCredential,
        userData,
      );

      if (!userData) {
        userData = {
          id: firebaseUser.uid,
          email: firebaseUser.email || credential.email || '',
          displayName: resolvedName,
          profileImage: firebaseUser.photoURL || undefined,
          createdAt: new Date(),
          isActive: true,
        };

        const firestoreData: Record<string, unknown> = {
          id: userData.id,
          email: userData.email,
          displayName: userData.displayName,
          createdAt: serverTimestamp(),
          isActive: true,
          authProvider: 'apple',
        };

        if (userData.profileImage) {
          firestoreData.profileImage = userData.profileImage;
        }

        await setDoc(doc(firestore, 'users', firebaseUser.uid), firestoreData);

        // Le username n'est PLUS auto-assigné à la création : il est choisi par
        // l'utilisateur sur la route de consentement obligatoire et réservé par
        // recordSignupConsent (desiredUsername). Le filet de rattrapage legacy
        // dans authStore couvre les comptes pré-existants sans username.
      } else if (isGenericDisplayName(userData.displayName)) {
        await updateDoc(doc(firestore, 'users', firebaseUser.uid), { displayName: resolvedName });
        userData.displayName = resolvedName;
      }

      return { user: userData, needsConsent, isNewUser };
    } catch (error: any) {
      if (error.code === 'ERR_REQUEST_CANCELED') {
        throw new Error('Connexion Apple annulée');
      }
      if (error?.code === 'auth/account-exists-with-different-credential') {
        throw new Error(
          'Un compte existe déjà avec cette adresse e-mail via une autre méthode de connexion. Connectez-vous avec votre e-mail et mot de passe.',
        );
      }
      if (__DEV__) console.error('[AuthService] Apple Sign-In error:', error?.code, error?.message);
      throw new Error('Erreur lors de la connexion Apple');
    }
  }

  /**
   * Enregistre le consentement (date de naissance + CGU + politique + opt-in
   * marketing + @pseudo choisi) pour l'utilisateur DÉJÀ authentifié — utilisé
   * par la route de consentement OBLIGATOIRE (app/complete-profile.tsx), pour
   * les DEUX flows (inscription email ET connexion sociale Google/Apple).
   *
   * Réutilise le callable serveur `recordSignupConsent` (région
   * northamerica-northeast1), source de vérité : il revalide l'âge (>= 16,
   * America/Toronto), RÉSERVE atomiquement le @pseudo (usernames registry),
   * écrit users/{uid}.dateOfBirth + username et la sous-collection consents.
   * L'âge est aussi pré-validé côté client (UX) avant l'appel.
   *
   * Propagation des erreurs : on NE wrappe PAS l'erreur du callable — on la
   * laisse remonter telle quelle (FirebaseError avec `.code` / `.details`) pour
   * que la route puisse distinguer :
   *  - already-exists + details.field==='username' → pseudo pris (inline, pas
   *    de rollback compte : l'user re-soumet avec un autre pseudo) ;
   *  - invalid-argument + details.field==='username' → format @pseudo KO ;
   *  - invalid-argument sans field → DOB invalide / âge < 16 ;
   *  - failed-precondition → consentements manquants.
   *
   * Retourne le User rafraîchi (avec dateOfBirth + username).
   */
  static async getPendingSignupConsent(uid: string, context?: SignupConsentContext): Promise<SignupConsent | null> {
    const firebaseUser = auth.currentUser;
    const current = () => {
      if (!firebaseUser || firebaseUser.uid !== uid || auth.currentUser !== firebaseUser) {
        throw Object.assign(new Error('La session a changé. Reconnectez-vous.'), {code: 'client/stale-operation'});
      }
      context?.assertCurrent();
    };
    current();
    const pending = await readSignupConsent(uid);
    current();
    return pending;
  }

  /** Clear only after the store adopted this receipt. Focus is no longer relevant. */
  static async acknowledgeSignupConsent(consent: SignupConsent, context: SignupConsentContext): Promise<void> {
    const firebaseUser = auth.currentUser, uid = consent.sellerActivityDeclaration.expectedUid;
    const current = () => {
      if (!firebaseUser || firebaseUser.uid !== uid || auth.currentUser !== firebaseUser) {
        throw Object.assign(new Error('La session a changé.'), {code: 'client/stale-operation'});
      }
      context.assertCurrent();
    };
    current();
    const pending = await readSignupConsent(uid);
    current();
    if (!pending) return;
    if (JSON.stringify(pending) !== JSON.stringify(parseSignupConsent(consent, uid))) throw new Error('Cette inscription ne correspond pas à la demande en attente.');
    await clearSignupConsent(uid);
    current();
  }

  static async recordConsentForCurrentUser(consent: SignupConsent, context?: SignupConsentContext): Promise<User> {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error('Utilisateur non connecté');
    const uid = firebaseUser.uid;
    const current = () => {
      if (auth.currentUser !== firebaseUser || auth.currentUser?.uid !== uid) {
        throw Object.assign(new Error('La session a changé. Reconnectez-vous.'), {code: 'client/stale-operation'});
      }
      context?.assertCurrent();
    };
    current();
    const age = computeAgeFromIso(consent.dateOfBirth);
    if (age === null) throw new Error('La date de naissance est invalide');
    if (age < MIN_AGE_REGISTER) throw new Error(`Vous devez avoir au moins ${MIN_AGE_REGISTER} ans pour utiliser Second.`);
    const payload = parseSignupConsent(consent, uid);
    if (signupSubmissions.has(uid)) throw Object.assign(new Error('Votre inscription est déjà en cours.'), {code: 'client/signup-in-progress'});
    signupSubmissions.add(uid);
    try {
      const pending = await readSignupConsent(uid);
      current();
      if (pending && JSON.stringify(pending) !== JSON.stringify(payload)) {
        throw Object.assign(new Error('Reprenez votre inscription précédente avant de modifier vos choix.'), {code: 'client/signup-pending'});
      }
      // Durable before the first network mutation. Every retry uses these exact choices.
      await writeSignupConsent(uid, pending ?? payload);
      current();
      const recordConsentFn = httpsCallable<SignupConsent, {ok: true; age: number; username?: string}>(functions, catalogueCallableName('recordSignupConsent'));
      let result;
      try {
        result = await recordConsentFn(pending ?? payload);
      } catch (error) {
        current();
        if (isDefinitiveSignupRefusal(error)) {
          await clearSignupConsent(uid);
          current();
        }
        throw error;
      }
      current();
      if (result.data?.ok !== true) throw new Error('Le résultat de votre inscription reste à confirmer. Réessayez.');
      const fresh = await this.getUserData(uid);
      current();
      if (!fresh || fresh.id !== uid) throw new Error('Données utilisateur introuvables');
      // The store acknowledges only after signIn adopted this known receipt.
      // Losing focus before that point must leave an exact replay available.
      return fresh;
    } finally {
      signupSubmissions.delete(uid);
    }
  }

  /**
   * Vérifie en direct la disponibilité d'un @pseudo choisi (callable
   * `checkUsernameAvailability`, debounce côté UI). N'appeler QUE si le format
   * local est déjà valide (3-20, charset) — sinon l'erreur format s'affiche sans
   * appel réseau. Indicatif seulement : le submit (recordSignupConsent) tranche.
   */
  static async checkUsernameAvailability(
    username: string,
  ): Promise<{ ok: true; available: boolean; reason?: 'too_short' | 'too_long' | 'invalid_chars' | 'taken' }> {
    const checkFn = httpsCallable<
      { username: string },
      { ok: true; available: boolean; reason?: 'too_short' | 'too_long' | 'invalid_chars' | 'taken' }
    >(functions, 'checkUsernameAvailability');
    const result = await checkFn({ username });
    return result.data;
  }

  /**
   * Rollback d'un compte social sans consentement (Loi 25 art. 12, 14).
   *
   * Appelé quand l'utilisateur refuse / ferme l'écran de consentement, a
   * moins de 16 ans, ou si recordSignupConsent échoue après une connexion
   * sociale.
   *
   * `isNewUser` distingue deux cas RADICALEMENT différents :
   *  - `true` (compte BRAND-NEW créé à l'instant par signInWithCredential) :
   *    rien à perdre → suppression DESTRUCTIVE (doc users/{uid} best-effort
   *    puis compte Firebase Auth) pour ne JAMAIS laisser subsister un compte
   *    sans preuve de consentement.
   *  - `false` (compte EXISTANT sans dateOfBirth qui refuse de re-consentir) :
   *    le compte peut porter un solde vendeur, des commandes, etc. → NE PAS
   *    SUPPRIMER (cela bypasserait le pre-check de solde de deleteUserAccount
   *    et ferait perdre le compte). On se contente d'un signOut : il reste
   *    non-authentifié côté app tant qu'il n'a pas consenti (gate dans
   *    authStore.hydrateFromFirebase), mais le compte est préservé.
   *
   * Best-effort : on ne propage pas les erreurs de cleanup pour ne pas
   * masquer la raison du rollback.
   */
  static async rollbackUnconsentedAccount(isNewUser: boolean): Promise<void> {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;

    // Compte existant : jamais de suppression destructive. Simple déconnexion.
    if (!isNewUser) {
      try {
        await this.signOut();
      } catch (signOutError) {
        if (__DEV__) {
          console.error('[AuthService] rollbackUnconsentedAccount signOut (existing) failed:', signOutError);
        }
      }
      return;
    }

    const uid = firebaseUser.uid;
    try {
      await deleteDoc(doc(firestore, 'users', uid));
    } catch (cleanupError) {
      if (__DEV__) {
        console.error('[AuthService] rollbackUnconsentedAccount user doc cleanup failed:', cleanupError);
      }
    }

    try {
      await firebaseUser.delete();
    } catch (deleteError) {
      // Si delete() échoue (ex: requires-recent-login improbable ici), on
      // garantit au moins la déconnexion pour ne pas laisser une session
      // active sans consentement.
      if (__DEV__) {
        console.error('[AuthService] rollbackUnconsentedAccount auth delete failed:', deleteError);
      }
      try {
        await this.signOut();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Déconnexion
   */
  static async signOut(options: { expectedUid?: string; isCurrent?: () => boolean } = {}): Promise<void> {
    const current = () => (!options.expectedUid || auth.currentUser?.uid === options.expectedUid) &&
      (options.isCurrent?.() ?? true);
    if (!current()) return;
    try {
      // Déconnexion Google
      try {
        await GoogleSignin.signOut();
      } catch {
        // Ignorer les erreurs si l'utilisateur n'est pas connecté via Google
      }

      if (!current()) return;

      // Déconnexion Firebase
      await firebaseSignOut(auth);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtenir l'utilisateur actuel
   */
  static async getCurrentUser(expectedUid?: string): Promise<User | null> {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return null;
    if (expectedUid && firebaseUser.uid !== expectedUid) throw new Error('La session a changé.');
    try {
      const user = await this.getUserData(firebaseUser.uid, !!expectedUid);
      if (expectedUid && auth.currentUser?.uid !== expectedUid) throw new Error('La session a changé.');
      return user;
    } catch (error) {
      if (expectedUid) throw error;
      return null;
    }
  }

  /**
   * Écouter les changements d'état d'authentification
   */
  static onAuthStateChanged(callback: (user: import('firebase/auth').User | null) => void): () => void {
    return firebaseOnAuthStateChanged(auth, callback);
  }

  /**
   * Récupérer les données utilisateur depuis Firestore
   */
  private static async getUserData(userId: string, strict = false): Promise<User | null> {
    try {
      const userDoc = await getDoc(doc(firestore, 'users', userId));

      if (!userDoc.exists()) {
        return null;
      }

      if (userDoc.id !== userId) throw new Error('Profile identity mismatch');
      const data = userDoc.data()!;
      return {
        ...data,
        id: userDoc.id,
        createdAt: data.createdAt?.toDate?.() || new Date(),
      } as User;
    } catch (error) {
      if (strict) throw error;
      return null;
    }
  }

  static getAuthProvider(): 'password' | 'google.com' | 'apple.com' | 'unknown' {
    const user = auth.currentUser;
    if (!user) return 'unknown';
    const providers = user.providerData.map(p => p.providerId);
    if (providers.includes('apple.com')) return 'apple.com';
    if (providers.includes('google.com')) return 'google.com';
    if (providers.includes('password')) return 'password';
    return 'unknown';
  }

  static hasPasswordProvider(): boolean {
    const user = auth.currentUser;
    if (!user) return false;
    return user.providerData.some(p => p.providerId === 'password');
  }

  static async reauthenticate(password: string, assertCurrent: () => void = () => {}): Promise<void> {
    assertCurrent();
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Utilisateur non connecté');

    const credential = EmailAuthProvider.credential(user.email, password);
    try {
      await reauthenticateWithCredential(user, credential);
      assertCurrent();
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  static async reauthenticateWithGoogle(assertCurrent: () => void = () => {}, waitForNativeReturn?: () => Promise<void>): Promise<void> {
    assertCurrent();
    requireGoogleSignInConfiguration();
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    assertCurrent();
    const userInfo = await GoogleSignin.signIn();
    await waitForNativeReturn?.();
    assertCurrent();
    if (userInfo.type === 'cancelled') {
      throw Object.assign(new Error('Connexion Google annulée'), { code: 'SIGN_IN_CANCELLED' });
    }
    const idToken = (userInfo as any)?.idToken ?? (userInfo as any)?.data?.idToken;
    if (!idToken) throw new Error('Erreur de réauthentification Google');

    const credential = GoogleAuthProvider.credential(idToken);
    await reauthenticateWithCredential(user, credential);
    assertCurrent();
  }

  private static async reauthenticateAppleCredential(assertCurrent: () => void, waitForNativeReturn?: () => Promise<void>): Promise<AppleAuthentication.AppleAuthenticationCredential> {
    assertCurrent();
    if (Platform.OS !== 'ios') {
      throw new Error('La ré-authentification Apple n\'est disponible que sur iOS. Veuillez ajouter un mot de passe à votre compte depuis un appareil iOS.');
    }
    requireSocialAuthNativeBuild();
    const appleAvailable = await AppleAuthentication.isAvailableAsync();
    assertCurrent();
    if (!appleAvailable) throw new Error('Apple Sign-In n’est pas disponible sur cet appareil.');

    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    const nonceBytes = await Crypto.getRandomBytesAsync(32);
    assertCurrent();
    const nonce = Array.from(new Uint8Array(nonceBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      nonce
    );
    assertCurrent();

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    await waitForNativeReturn?.();
    assertCurrent();

    if (!appleCredential.identityToken) {
      throw new Error('Réauthentification Apple échouée');
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce: nonce,
    });
    await reauthenticateWithCredential(user, credential);
    assertCurrent();
    return appleCredential;
  }

  static async reauthenticateWithApple(assertCurrent: () => void = () => {}, waitForNativeReturn?: () => Promise<void>): Promise<void> {
    await this.reauthenticateAppleCredential(assertCurrent, waitForNativeReturn);
  }

  /** Erasure additionally needs Apple's fresh authorization CODE. It is never
   * an OAuth access token and never enters a persisted journal or analytics. */
  static async reauthenticateWithAppleForErasure(attempt: AccountErasureAttempt, generation: number,
    assertCurrent: () => void, waitForNativeReturn?: () => Promise<void>): Promise<AppleErasureAuthorization> {
    const owner = auth.currentUser;
    const check = () => {
      assertCurrent();
      if (!owner || auth.currentUser !== owner || owner.uid !== attempt.ownerId ||
          !owner.providerData.some(provider => provider.providerId === 'apple.com')) throw new Error('La session Apple a changé.');
    };
    check();
    const credential = await this.reauthenticateAppleCredential(check, waitForNativeReturn);
    check();
    if (!credential.authorizationCode) throw new Error('Apple doit fournir une nouvelle autorisation pour cette demande.');
    return issueAppleErasureAuthorization(attempt, owner!, generation, credential.authorizationCode);
  }

  /**
   * Mettre à jour l'email via lien de vérification.
   * Envoie un email de vérification au nouvel email. L'email ne sera effectif
   * dans Firebase Auth qu'après clic sur le lien. La synchronisation Firestore
   * se fait au prochain onAuthStateChanged / reload après vérification.
   */
  static async updateEmail(newEmail: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      await verifyBeforeUpdateEmail(user, newEmail);
      // Ne PAS mettre à jour Firestore ici : l'email n'est pas encore vérifié.
      // La sync Firestore se fera au prochain onAuthStateChanged après que
      // l'utilisateur ait cliqué le lien de vérification.
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Mettre à jour le mot de passe
   */
  static async updatePassword(newPassword: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      await firebaseUpdatePassword(user, newPassword);
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Vérifier l'état de la configuration des services d'authentification
   */
  static async getAuthConfigStatus() {
    const nativeBuildMatches = Application.applicationId === socialAuthBundleId(runtimeEnvironment.name);
    let apple: 'unsupported' | 'native_build_required' | 'available' | 'unavailable' = 'unsupported';
    if (Platform.OS === 'ios') {
      apple = !nativeBuildMatches ? 'native_build_required' :
        await AppleAuthentication.isAvailableAsync().catch(() => false) ? 'available' : 'unavailable';
    }
    return {
      environment: runtimeEnvironment.name,
      firebaseProjectId: runtimeEnvironment.projectId,
      // Client configuration cannot certify that a remote provider is enabled.
      emailPassword: 'server_configuration_not_verified' as const,
      google: !googleSignInConfig() ? 'not_configured' : nativeBuildMatches ? 'configured' : 'native_build_required',
      apple,
    };
  }

  /**
   * Envoyer un email de réinitialisation de mot de passe
   */
  static async sendPasswordResetEmail(email: string): Promise<void> {
    try {
      await firebaseSendPasswordResetEmail(auth, email);
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
      // Account absence/disabled state never becomes an existence signal on reset.
      if (code === 'auth/user-not-found' || code === 'auth/user-disabled') return;
      throw Object.assign(new Error(this.getAuthErrorMessage(code)), { code });
    }
  }

  /**
   * Supprimer le compte utilisateur (Loi 25 / PIPEDA)
   * Le serveur peut conserver la demande en attente d’un examen de conservation.
   * Seule une réponse complète qualifiée autorise le parcours de fin de compte.
   */
  static async deleteAccount(mode: AccountClosureMode = 'delete', options: { expectedUid?: string; assertCurrent?: () => void } = {}): Promise<AccountClosureResult> {
    // Deletion uses AccountErasureService's durable identity and private
    // observation capability. This legacy API remains the distinct pause API.
    if (mode !== 'pause') throw new Error('Utilisez la demande suivie de suppression depuis les paramètres du compte.');
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');
    const expectedUid = options.expectedUid ?? user.uid;
    const assertCurrent = () => {
      options.assertCurrent?.();
      if (auth.currentUser?.uid !== expectedUid || user.uid !== expectedUid) throw new Error('La session a changé.');
    };
    assertCurrent();
    // Refresh the JWT after real reauthentication; a UI flag alone cannot
    // satisfy the server's five-minute auth_time requirement.
    await user.getIdToken(true);
    assertCurrent();
    const result = await httpsCallable<{ mode: AccountClosureMode; expectedUid: string }, unknown>(functions, 'deleteUserAccount')({ mode, expectedUid });
    assertCurrent();
    if (!isAccountClosureResult(result.data)) throw new Error('Le résultat de la fermeture reste à vérifier.');
    return result.data;
  }

  /**
   * Envoyer un email de vérification
   */
  static async sendEmailVerification(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      await firebaseSendEmailVerification(user);
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Vérifier si l'email de l'utilisateur est vérifié
   */
  static isEmailVerified(): boolean {
    const user = auth.currentUser;
    return user?.emailVerified ?? false;
  }

  /**
   * Recharger l'utilisateur pour mettre à jour le statut de vérification.
   *
   * Si l'email vient d'être vérifié, force un refresh du token (getIdToken(true))
   * pour que le claim JWT `email_verified` — lu par le gate serveur createArticle —
   * soit rafraîchi immédiatement plutôt qu'au prochain refresh automatique (~1h).
   */
  static async reloadUser(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    await reload(user);

    if (user.emailVerified) {
      try {
        await user.getIdToken(true);
      } catch (error) {
        if (__DEV__) console.error('[AuthService] reloadUser force token refresh failed:', error);
      }
    }
  }

  /**
   * Link an email/password credential to the current social-auth user.
   * After linking, the user can sign in with either their social account
   * or the new email + password combination.
   */
  static async linkPasswordCredential(email: string, password: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      const credential = EmailAuthProvider.credential(email, password);
      await linkWithCredential(user, credential);

      // Ne pas écraser authProvider (le provider original reste la source de vérité).
      // On ajoute 'email' aux providers liés et on marque hasPassword: true.
      await updateDoc(doc(firestore, 'users', user.uid), {
        authProviders: arrayUnion('email'),
        hasPassword: true,
        email,
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Convertir les codes d'erreur Firebase en messages lisibles
   */
  private static getAuthErrorMessage(errorCode: string): string {
    switch (errorCode) {
      case 'auth/user-not-found':
        return 'Aucun utilisateur trouvé avec cette adresse email';
      case 'auth/wrong-password':
        return 'Mot de passe incorrect';
      case 'auth/email-already-in-use':
        return 'Cette adresse email est déjà utilisée';
      case 'auth/weak-password':
        return 'Le mot de passe doit contenir au moins 6 caractères';
      case 'auth/invalid-email':
        return 'Adresse email invalide';
      case 'auth/user-disabled':
        return 'Ce compte a été désactivé';
      case 'auth/too-many-requests':
        return 'Trop de tentatives. Veuillez réessayer plus tard';
      case 'auth/network-request-failed':
        return 'Erreur de connexion. Vérifiez votre connexion internet';
      case 'auth/invalid-credential':
        return 'Email ou mot de passe incorrect';
      case 'auth/requires-recent-login':
        return 'Cette action nécessite une connexion récente. Veuillez vous reconnecter.';
      default:
        return 'Une erreur est survenue lors de l\'authentification';
    }
  }
}
