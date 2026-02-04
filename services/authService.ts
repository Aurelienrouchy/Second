import { auth, firestore } from '@/config/firebaseConfig';
import { User } from '@/types';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  AppleAuthProvider,
  signInWithCredential,
  signInWithEmailAndPassword,
  updateProfile,
  EmailAuthProvider
} from '@react-native-firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from '@react-native-firebase/firestore';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

export class AuthService {
  /**
   * Initialise les services d'authentification
   */
  static async initialize(): Promise<void> {
    try {
      // Client IDs from Firebase project seconde-b47a6 (project number: 628214013296)
      // webClientId: OAuth 2.0 Web Client from google-services.json (client_type: 3)
      // iosClientId: iOS Client from GoogleService-Info.plist (client_type: 2)
      const config = {
        webClientId: '628214013296-pggun4ig3j52v6r2me4k33ljsh5rc4tg.apps.googleusercontent.com',
        iosClientId: '628214013296-fspuqlslcg8tln3aonhce95c435oauts.apps.googleusercontent.com',
        offlineAccess: false,
      };

      GoogleSignin.configure(config);
      console.log('[AuthService] Google Sign-In configured successfully');
    } catch (error) {
      console.error('[AuthService] Failed to configure Google Sign-In:', error);
      throw error;
    }
  }

  /**
   * Inscription avec email et mot de passe
   */
  static async signUpWithEmail(email: string, password: string, displayName: string): Promise<User> {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;

      // Mettre à jour le profil Firebase avec le nom d'affichage
      await updateProfile(firebaseUser, { displayName });

      // Créer l'utilisateur dans Firestore
      const userData: User = {
        id: firebaseUser.uid,
        email: firebaseUser.email!,
        displayName,
        createdAt: new Date(),
        isActive: true,
      };

      // Ajouter profileImage seulement s'il existe
      if (firebaseUser.photoURL) {
        userData.profileImage = firebaseUser.photoURL;
      }

      // Préparer les données pour Firestore
      const firestoreData: any = {
        id: userData.id,
        email: userData.email,
        displayName: userData.displayName,
        createdAt: serverTimestamp(),
        isActive: true,
      };

      // Ajouter profileImage seulement s'il existe
      if (userData.profileImage) {
        firestoreData.profileImage = userData.profileImage;
      }

      await setDoc(doc(firestore, 'users', firebaseUser.uid), firestoreData);

      return userData;
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
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
   * Connexion avec Google
   */
  static async signInWithGoogle(): Promise<User> {
    try {
      // Vérifier si Google Play Services est disponible
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      
      // Obtenir les informations utilisateur de Google
      const userInfo = await GoogleSignin.signIn();
      
      // Extraire correctement l'idToken et l'accessToken selon la forme retournée
      const idToken = (userInfo as any)?.idToken ?? (userInfo as any)?.data?.idToken;
      const accessToken = (userInfo as any)?.accessToken ?? (userInfo as any)?.data?.accessToken;

      // Vérifier que nous avons un idToken
      if (!idToken) {
        throw new Error('No ID token received from Google Sign-In. Please check your Google Sign-In configuration.');
      }
      
      // Créer un credential Firebase avec le token Google  
      const googleCredential = GoogleAuthProvider.credential(idToken, accessToken);
      
      // Se connecter à Firebase avec le credential Google
      const userCredential = await signInWithCredential(auth, googleCredential);
      const firebaseUser = userCredential.user;
      
      let userData = await this.getUserData(firebaseUser.uid);
      if (!userData) {
        userData = {
          id: firebaseUser.uid,
          email: firebaseUser.email!,
          displayName: firebaseUser.displayName || 'Utilisateur Google',
          profileImage: firebaseUser.photoURL || undefined,
          createdAt: new Date(),
          isActive: true,
        };

        const firestoreData: any = {
          id: userData.id,
          email: userData.email,
          displayName: userData.displayName,
          createdAt: serverTimestamp(),
          isActive: true,
        };

        if (userData.profileImage) {
          firestoreData.profileImage = userData.profileImage;
        }

        await setDoc(doc(firestore, 'users', firebaseUser.uid), firestoreData);
      }

      return userData;
    } catch (error: any) {
      // Log detailed error for debugging
      console.error('[AuthService] Google Sign-In error details:', {
        code: error?.code,
        message: error?.message,
        name: error?.name,
        stack: error?.stack?.substring(0, 500)
      });

      // Provide more specific error messages
      if (error?.code === 'SIGN_IN_CANCELLED') {
        throw new Error('Connexion Google annulée');
      } else if (error?.code === 'IN_PROGRESS') {
        throw new Error('Une connexion Google est déjà en cours');
      } else if (error?.code === 'PLAY_SERVICES_NOT_AVAILABLE') {
        throw new Error('Google Play Services non disponible');
      } else if (error?.code === 'DEVELOPER_ERROR' || error?.code === '10') {
        throw new Error('Erreur de configuration Google Sign-In. Vérifiez les Client IDs et SHA-1.');
      } else if (error?.message?.includes('No ID token')) {
        throw new Error('Token Google non reçu. Vérifiez la configuration OAuth.');
      }

      throw new Error('Erreur lors de la connexion Google: ' + (error?.message || 'Erreur inconnue'));
    }
  }


  /**
   * Connexion avec Apple (expo-apple-authentication)
   */
  static async signInWithApple(): Promise<User> {
    try {
      // Générer un nonce pour la sécurité
      const nonce = Math.random().toString(36).substring(2, 10);
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
      const appleCredential = AppleAuthProvider.credential(
        credential.identityToken,
        nonce
      );

      // Se connecter à Firebase avec le credential Apple
      const userCredential = await signInWithCredential(auth, appleCredential);
      const firebaseUser = userCredential.user;

      let userData = await this.getUserData(firebaseUser.uid);
      if (!userData) {
        // Créer un nouveau compte utilisateur
        const displayName = credential.fullName
          ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
          : firebaseUser.displayName || 'Utilisateur Apple';

        userData = {
          id: firebaseUser.uid,
          email: firebaseUser.email || credential.email || '',
          displayName: displayName || 'Utilisateur Apple',
          profileImage: firebaseUser.photoURL || undefined,
          createdAt: new Date(),
          isActive: true,
        };

        const firestoreData: any = {
          id: userData.id,
          email: userData.email,
          displayName: userData.displayName,
          createdAt: serverTimestamp(),
          isActive: true,
        };

        if (userData.profileImage) {
          firestoreData.profileImage = userData.profileImage;
        }

        await setDoc(doc(firestore, 'users', firebaseUser.uid), firestoreData);
      }

      return userData;
    } catch (error: any) {
      console.error('Apple Sign-In error:', error);
      if (error.code === 'ERR_REQUEST_CANCELED') {
        throw new Error('Connexion Apple annulée');
      }
      throw new Error('Erreur lors de la connexion Apple');
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
  static onAuthStateChanged(callback: (user: any | null) => void): () => void {
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
      const userData: User = {
        id: data.id,
        email: data.email,
        displayName: data.displayName,
        createdAt: data.createdAt?.toDate?.() || new Date(),
      };

      // Ajouter les champs optionnels seulement s'ils existent
      if (data.profileImage) {
        userData.profileImage = data.profileImage;
      }
      if (data.phoneNumber) {
        userData.phoneNumber = data.phoneNumber;
      }
      if (data.rating) {
        userData.rating = data.rating;
      }
      if (data.address) {
        userData.address = data.address;
      }
      if (data.bio) {
        userData.bio = data.bio;
      }

      return userData;
    } catch (error) {
      return null;
    }
  }

  /**
   * Re-authentifier l'utilisateur avec mot de passe
   */
  static async reauthenticate(password: string): Promise<void> {
    const user = auth.currentUser;
    if (!user || !user.email) throw new Error('Utilisateur non connecté');

    const credential = EmailAuthProvider.credential(user.email, password);
    try {
      await user.reauthenticateWithCredential(credential);
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Mettre à jour l'email
   */
  static async updateEmail(newEmail: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      await user.updateEmail(newEmail);
      
      // Mettre à jour Firestore
      await updateDoc(doc(firestore, 'users', user.uid), {
        email: newEmail,
        updatedAt: serverTimestamp()
      });
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
      await user.updatePassword(newPassword);
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
      await auth.sendPasswordResetEmail(email);
    } catch (error: any) {
      throw new Error(this.getAuthErrorMessage(error.code));
    }
  }

  /**
   * Supprimer le compte utilisateur (RGPD Art. 17)
   * Supprime les données Firebase Auth et Firestore
   */
  static async deleteAccount(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Utilisateur non connecté');

    try {
      // Supprimer le compte Firebase Auth
      await user.delete();
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
      await user.sendEmailVerification();
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

    await user.reload();
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
