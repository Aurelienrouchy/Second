import { auth, firestore, functions } from '@/config/firebaseConfig';
import { User } from '@/types';
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
import { httpsCallable } from 'firebase/functions';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { computeAgeFromIso, MIN_AGE_REGISTER } from '@/utils/age';

/**
 * Consent payload collected at signup. `dateOfBirth` is an ISO "YYYY-MM-DD"
 * calendar string (no Date/timezone) shared with the backend callable
 * `recordSignupConsent`.
 */
export interface SignupConsent {
  dateOfBirth: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingOptIn: boolean;
}

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

function generateDefaultUsername(uid: string): string {
  return `user${uid.slice(-6)}`;
}

function isGenericDisplayName(name: string | null | undefined): boolean {
  if (!name || name.trim().length === 0) return true;
  const lower = name.toLowerCase().trim();
  return lower.includes('utilisateur') || lower === 'user';
}

export class AuthService {
  /**
   * Initialise les services d'authentification
   */
  static async initialize(): Promise<void> {
    try {
      const config = {
        webClientId: '628214013296-pggun4ig3j52v6r2me4k33ljsh5rc4tg.apps.googleusercontent.com',
        iosClientId: '628214013296-fspuqlslcg8tln3aonhce95c435oauts.apps.googleusercontent.com',
        offlineAccess: false,
      };

      GoogleSignin.configure(config);
    } catch (error) {
      if (__DEV__) console.error('[AuthService] Failed to configure Google Sign-In:', error);
      throw error;
    }
  }

  /**
   * Inscription avec email et mot de passe + consentement (Loi 25 / age gate).
   *
   * L'âge (>= 16) est validé AVANT createUserWithEmailAndPassword pour ne jamais
   * créer de compte orphelin. Après création du compte + user doc, le callable
   * serveur `recordSignupConsent` persiste dateOfBirth + les docs consents
   * (terms, privacy_policy, marketing) avec la version de politique courante.
   */
  static async signUpWithEmail(
    email: string,
    password: string,
    displayName: string,
    consent: SignupConsent,
  ): Promise<User> {
    // ── Age gate AVANT toute création de compte (pas d'orphelin) ──
    const age = computeAgeFromIso(consent.dateOfBirth);
    if (age === null) {
      throw new Error('La date de naissance est invalide');
    }
    if (age < MIN_AGE_REGISTER) {
      throw new Error(
        `Vous devez avoir au moins ${MIN_AGE_REGISTER} ans pour utiliser Second.`,
      );
    }
    if (!consent.acceptedTerms || !consent.acceptedPrivacy) {
      throw new Error(
        "Vous devez accepter les Conditions d'utilisation et la Politique de confidentialité.",
      );
    }

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
      // Créer l'utilisateur dans Firestore
      const userData: User = {
        id: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName,
        createdAt: new Date(),
        isActive: true,
        dateOfBirth: consent.dateOfBirth,
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
        dateOfBirth: consent.dateOfBirth,
      };

      if (userData.profileImage) {
        firestoreData.profileImage = userData.profileImage;
      }

      await setDoc(doc(firestore, 'users', firebaseUser.uid), firestoreData);

      // Persister dateOfBirth + consents côté serveur (source de vérité).
      // recordSignupConsent revalide l'âge et écrit la sous-collection consents.
      const recordConsentFn = httpsCallable<
        {
          dateOfBirth: string;
          acceptedTerms: boolean;
          acceptedPrivacy: boolean;
          marketingOptIn: boolean;
        },
        { ok: true; age: number }
      >(functions, 'recordSignupConsent');

      await recordConsentFn({
        dateOfBirth: consent.dateOfBirth,
        acceptedTerms: consent.acceptedTerms,
        acceptedPrivacy: consent.acceptedPrivacy,
        marketingOptIn: consent.marketingOptIn,
      });

      return userData;
    } catch (error: any) {
      if (__DEV__) {
        console.error('[AuthService] signUpWithEmail post-create error:', error);
      }

      // ── ROLLBACK : aucun compte ne doit subsister sans preuve de consentement
      // (état illégal Loi 25). Le setDoc ou recordSignupConsent a échoué après
      // la création du compte Auth → on supprime le doc user (best-effort) puis
      // le compte Auth (la session vient d'être créée, donc récente). ──
      try {
        await deleteDoc(doc(firestore, 'users', firebaseUser.uid));
      } catch (cleanupError) {
        // Les rules peuvent refuser la suppression directe : ne pas bloquer le
        // rollback du compte Auth pour autant.
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
    try {
      // Vérifier si Google Play Services est disponible
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Obtenir les informations utilisateur de Google
      const userInfo = await GoogleSignin.signIn();

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

      const googleName = isGenericDisplayName(firebaseUser.displayName)
        ? generateDefaultUsername(firebaseUser.uid)
        : firebaseUser.displayName!;

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
        throw new Error('Configuration Google Sign-In incorrecte. Vérifiez le SHA-1 dans Firebase Console.');
      }

      if (__DEV__) console.error('[AuthService] Google Sign-In error:', error?.code, error?.message);
      throw new Error('Erreur lors de la connexion Google. Veuillez réessayer.');
    }
  }


  /**
   * Connexion avec Apple (expo-apple-authentication)
   */
  static async signInWithApple(): Promise<SocialAuthResult> {
    try {
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
      const resolvedName = appleFullName
        || (isGenericDisplayName(firebaseUser.displayName) ? null : firebaseUser.displayName)
        || generateDefaultUsername(firebaseUser.uid);

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
      } else if (isGenericDisplayName(userData.displayName)) {
        await updateDoc(doc(firestore, 'users', firebaseUser.uid), { displayName: resolvedName });
        userData.displayName = resolvedName;
      }

      return { user: userData, needsConsent };
    } catch (error: any) {
      if (error.code === 'ERR_REQUEST_CANCELED') {
        throw new Error('Connexion Apple annulée');
      }
      throw new Error('Erreur lors de la connexion Apple');
    }
  }

  /**
   * Enregistre le consentement (date de naissance + CGU + politique + opt-in
   * marketing) pour l'utilisateur DÉJÀ authentifié — utilisé par l'écran de
   * consentement obligatoire qui suit une première connexion sociale.
   *
   * Réutilise le callable serveur `recordSignupConsent` (région
   * northamerica-northeast1), source de vérité : il revalide l'âge (>= 16,
   * America/Toronto), écrit users/{uid}.dateOfBirth et la sous-collection
   * consents. L'âge est aussi pré-validé côté client (UX) avant l'appel.
   *
   * Retourne le User rafraîchi (avec dateOfBirth). Lève en cas d'âge < 16,
   * de cases manquantes ou d'échec serveur — le caller doit alors rollback.
   */
  static async recordConsentForCurrentUser(consent: SignupConsent): Promise<User> {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      throw new Error('Utilisateur non connecté');
    }

    // ── Age gate client (UX) — le serveur revalide de toute façon ──
    const age = computeAgeFromIso(consent.dateOfBirth);
    if (age === null) {
      throw new Error('La date de naissance est invalide');
    }
    if (age < MIN_AGE_REGISTER) {
      throw new Error(
        `Vous devez avoir au moins ${MIN_AGE_REGISTER} ans pour utiliser Second.`,
      );
    }
    if (!consent.acceptedTerms || !consent.acceptedPrivacy) {
      throw new Error(
        "Vous devez accepter les Conditions d'utilisation et la Politique de confidentialité.",
      );
    }

    const recordConsentFn = httpsCallable<
      {
        dateOfBirth: string;
        acceptedTerms: boolean;
        acceptedPrivacy: boolean;
        marketingOptIn: boolean;
      },
      { ok: true; age: number }
    >(functions, 'recordSignupConsent');

    await recordConsentFn({
      dateOfBirth: consent.dateOfBirth,
      acceptedTerms: consent.acceptedTerms,
      acceptedPrivacy: consent.acceptedPrivacy,
      marketingOptIn: consent.marketingOptIn,
    });

    const fresh = await this.getUserData(firebaseUser.uid);
    if (!fresh) {
      throw new Error('Données utilisateur introuvables');
    }
    return fresh;
  }

  /**
   * Rollback d'un compte social sans consentement (Loi 25 art. 12, 14).
   *
   * Appelé quand l'utilisateur refuse / ferme l'écran de consentement, a
   * moins de 16 ans, ou si recordSignupConsent échoue après une PREMIÈRE
   * connexion sociale. Supprime le doc users/{uid} (best-effort) puis le
   * compte Firebase Auth (session récente) pour ne JAMAIS laisser subsister
   * un compte sans preuve de consentement. Best-effort : on ne propage pas
   * les erreurs de cleanup pour ne pas masquer la raison du rollback.
   */
  static async rollbackUnconsentedAccount(): Promise<void> {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;

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
  static async signOut(): Promise<void> {
    try {
      // Déconnexion Google
      try {
        await GoogleSignin.signOut();
      } catch {
        // Ignorer les erreurs si l'utilisateur n'est pas connecté via Google
      }

      // Déconnexion Firebase
      await firebaseSignOut(auth);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Obtenir l'utilisateur actuel
   */
  static async getCurrentUser(): Promise<User | null> {
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) {
        return null;
      }

      return await this.getUserData(firebaseUser.uid);
    } catch (error) {
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
  private static async getUserData(userId: string): Promise<User | null> {
    try {
      const userDoc = await getDoc(doc(firestore, 'users', userId));

      if (!userDoc.exists()) {
        return null;
      }

      const data = userDoc.data()!;
      return {
        ...data,
        id: userDoc.id,
        createdAt: data.createdAt?.toDate?.() || new Date(),
      } as User;
    } catch (error) {
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

  static async reauthenticate(password: string): Promise<void> {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Utilisateur non connecté');

    const credential = EmailAuthProvider.credential(user.email, password);
    try {
      await reauthenticateWithCredential(user, credential);
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  static async reauthenticateWithGoogle(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const userInfo = await GoogleSignin.signIn();
    const idToken = (userInfo as any)?.idToken ?? (userInfo as any)?.data?.idToken;
    if (!idToken) throw new Error('Erreur de réauthentification Google');

    const credential = GoogleAuthProvider.credential(idToken);
    await reauthenticateWithCredential(user, credential);
  }

  static async reauthenticateWithApple(): Promise<void> {
    if (Platform.OS !== 'ios') {
      throw new Error('La ré-authentification Apple n\'est disponible que sur iOS. Veuillez ajouter un mot de passe à votre compte depuis un appareil iOS.');
    }

    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    const nonceBytes = await Crypto.getRandomBytesAsync(32);
    const nonce = Array.from(new Uint8Array(nonceBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      nonce
    );

    const appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!appleCredential.identityToken) {
      throw new Error('Réauthentification Apple échouée');
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce: nonce,
    });
    await reauthenticateWithCredential(user, credential);
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
  static getAuthConfigStatus() {
    return {
      emailPassword: 'Ready', // Toujours disponible avec Firebase Auth
      google: 'Ready', // Configuré directement dans le code avec les valeurs du GoogleService-Info.plist
      apple: 'Ready' // Apple Sign-In disponible sur iOS
    };
  }

  /**
   * Envoyer un email de réinitialisation de mot de passe
   */
  static async sendPasswordResetEmail(email: string): Promise<void> {
    try {
      await firebaseSendPasswordResetEmail(auth, email);
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Supprimer le compte utilisateur (Loi 25 / PIPEDA)
   * Appelle la callable deleteUserAccount qui gere le cleanup Firestore,
   * Storage et la suppression du compte Firebase Auth cote serveur.
   */
  static async deleteAccount(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      const deleteUserAccountFn = httpsCallable(functions, 'deleteUserAccount');
      await deleteUserAccountFn();
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
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
   * Recharger l'utilisateur pour mettre à jour le statut de vérification
   */
  static async reloadUser(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    await reload(user);
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
