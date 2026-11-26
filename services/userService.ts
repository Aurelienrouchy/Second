import { auth, firestore, functions } from '@/config/firebaseConfig';
import type { User, UserPreferences } from '@/types';
import {
  arrayUnion,
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  Timestamp,
  type DocumentData,
  type Query,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { newProfileImagePath, uploadPreparedJpeg } from '@/services/nativeStorageUpload';
import { assertTradeSessionCurrent, captureTradeSession, staleTradeOperation } from '@/services/tradeOperation';
import { EligibilityService } from '@/services/eligibilityService';
import { getWalletHistoryPage } from '@/services/walletHistoryReader';
import { SupportRequestService } from '@/services/supportRequestService';
import { assertSupportProjectionGeneration, getSupportProjectionGeneration } from '@/services/supportProjectionGuard';
import { getUserById, getUserPreferences, removeFcmToken, removeExpoPushToken } from '@/services/userAuthData';
import type { SupportListCursor } from '@/types/supportRequest';

type UserExportValue = null | boolean | number | string | UserExportValue[] | { [key: string]: UserExportValue };
interface UserExportDocument { id: string; fields: { [key: string]: UserExportValue } }
interface UserExportCoverage {
  scope: 'selected_owner_fields';
  pageSize: number;
  maxPages: number;
  maxDocuments: number;
  maxSourceJsonCodeUnits: number;
  pagesRead: number;
  documentsEmitted: number;
  traversal: 'ended_at_read' | 'truncated' | 'unknown';
  reason: string | null;
  continuation: UserExportValue;
  legalCompleteness: false;
}
interface UserExportSource {
  source: string;
  state: 'read' | 'absent' | 'unavailable' | 'not_included';
  readAt: string | null;
  documents: UserExportDocument[] | null;
  reason: string | null;
  selectedFields: readonly string[];
  coverage?: UserExportCoverage;
}
interface ExportedUserData {
  protocol: 'owner_data_export_v1';
  actorId: string;
  startedAt: string;
  completedAt: string;
  exhaustive: false;
  authorization: 'firestore_rules_at_each_server_read';
  limitations: string[];
  sources: Record<string, UserExportSource>;
  limits: {pageSize: number; supportPageSize: number; maxPagesPerSource: number; maxDocumentsPerSource: number; maxSourceJsonCodeUnits: number; maxDocumentJsonCodeUnits: number; maxFileJsonCodeUnits: number;
    maxSelectedJsonCodeUnits: number; maxValueDepth: number; maxValueNodes: number; maxArrayItems: number; maxObjectKeys: number; maxStringCodeUnits: number};
}

const OWNER_EXPORT_LIMITS = {pageSize: 20, supportPageSize: 30, maxPagesPerSource: 10, maxDocumentsPerSource: 200,
  maxSourceJsonCodeUnits: 250_000, maxDocumentJsonCodeUnits: 16_384, maxSelectedJsonCodeUnits: 2_000_000,
  maxFileJsonCodeUnits: 4_000_000,
  maxValueDepth: 6, maxValueNodes: 2_000, maxArrayItems: 500, maxObjectKeys: 100, maxStringCodeUnits: 8_192} as const;

export class UserService {
  private static readonly COLLECTION = 'users';

  /**
   * Récupérer un utilisateur par son ID
   */
  static async getUserById(userId: string): Promise<User | null> {
    return getUserById(userId);
  }

  /**
   * Fetch a user's public profile via the getUserPublicProfile Cloud Function.
   * Use this when reading ANOTHER user's profile — Firestore rules block
   * direct reads to users/{uid} unless you are the owner.
   * Returns a User-shaped subset with the fields available publicly.
   */
  static async getPublicProfile(userId: string): Promise<User | null> {
    try {
      const getUserPublicProfileFn = httpsCallable<
        { userId: string },
        {
          profile: {
            id: string;
            displayName: string;
            profileImage: string | null;
            bio: string | null;
            createdAt?: string;
            rating: number | null;
            accountType: string;
            sellerLikesCount: number;
          };
        }
      >(functions, 'getUserPublicProfile');
      const result = await getUserPublicProfileFn({ userId });
      const p = result.data.profile;
      return {
        id: p.id,
        displayName: p.displayName,
        profileImage: p.profileImage ?? null,
        bio: p.bio ?? null,
        createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
        rating: p.rating ?? null,
        accountType: p.accountType as 'user' | 'shop',
        sellerLikesCount: p.sellerLikesCount,
      } as unknown as User;
    } catch (error) {
      // A former chat participant may no longer have a profile. Match the
      // callable's exact absence response, not an unavailable endpoint or read.
      if (
        typeof error === 'object' && error !== null &&
        'code' in error && error.code === 'functions/not-found' &&
        'message' in error && error.message === 'User not found'
      ) return null;
      if (__DEV__) console.error('Error fetching public profile via callable:', error);
      return null;
    }
  }

  /**
   * Mettre à jour les préférences d'un utilisateur
   */
  static async updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<void> {
    try {
      // Use dot notation so partial updates merge into the existing
      // preferences map instead of overwriting unrelated sub-fields. Any
      // preference sub-field is supported generically (sizes, shoesSizes,
      // favoriteBrands, …) so it stays aligned with the onboarding callable,
      // which writes both preferences.sizes and preferences.shoesSizes.
      const dottedPreferences: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(preferences)) {
        dottedPreferences[`preferences.${key}`] = value;
      }

      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        ...dottedPreferences,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (__DEV__) console.error('Error updating user preferences:', error);
      throw new Error('Erreur lors de la mise à jour des préférences');
    }
  }

  /**
   * Récupérer les préférences d'un utilisateur
   */
  static async getUserPreferences(userId: string): Promise<UserPreferences | null> {
    return getUserPreferences(userId);
  }

  /**
   * Défauts confidentialité PRIVACY-BY-DEFAULT (Loi 25 art. 9.1, LCAP).
   * Source de vérité unique des valeurs par défaut côté app — appliqués UNIQUEMENT
   * lorsqu'aucune préférence n'est encore enregistrée (NOUVEAUX utilisateurs).
   * Les préférences déjà persistées d'un utilisateur existant ne sont jamais réécrites.
   * - showProfilePhoto : false  (photo non visible publiquement tant que non activée)
   * - aiProfilingConsent : false (profilage IA désactivé tant que non activé)
   * - marketingConsent : false  (aucune communication marketing tant que non consentie)
   */
  static readonly PRIVACY_DEFAULTS = {
    showProfilePhoto: false,
    aiProfilingConsent: false,
    marketingConsent: false,
  } as const;

  /**
   * Vérifier si un utilisateur est admin.
   *
   * SECURITY: prefers the `admin` custom claim on the Firebase Auth ID
   * token (set server-side via Admin SDK and not user-writable). Falls
   * back to the Firestore `isAdmin` field only if the claim is missing
   * — and that field is now write-protected by the users/{uid} rule, so
   * a self-elevation attempt would be rejected before reaching here.
   */
  static async isUserAdmin(userId: string): Promise<boolean> {
    try {
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.uid === userId) {
        const tokenResult = await currentUser.getIdTokenResult();
        if (tokenResult.claims?.admin === true) {
          return true;
        }
      }

      // Fallback for compatibility while custom claims are rolled out.
      const user = await this.getUserById(userId);
      return user?.isAdmin === true;
    } catch (error) {
      if (__DEV__) console.error('Error checking admin status:', error);
      return false;
    }
  }

  /**
   * Mettre à jour le type de compte utilisateur
   */
  static async updateAccountType(
    userId: string,
    accountType: 'user' | 'shop'
  ): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        accountType,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (__DEV__) console.error('Error updating account type:', error);
      throw new Error('Erreur lors de la mise à jour du type de compte');
    }
  }

  /**
   * Mettre à jour le profil utilisateur
   */
  static async updateUserProfile(
    userId: string,
    data: Partial<User>,
    assertContext?: () => void,
  ): Promise<void> {
    try {
      const owner = auth.currentUser;
      const current = () => {
        assertContext?.();
        if (assertContext && (!owner || owner.uid !== userId || auth.currentUser !== owner)) throw staleTradeOperation();
      };
      current();
      const updateData: Record<string, unknown> = {
        ...data,
        updatedAt: serverTimestamp(),
      };

      // Ne pas permettre la mise à jour de certains champs via cette methode
      delete updateData.isActive;
      delete updateData.id;
      delete updateData.email;
      delete updateData.createdAt;
      delete updateData.isAdmin;
      delete updateData.role;
      delete updateData.customClaims;
      delete updateData.onboardingCompleted;
      delete updateData.onboardingPreferences;

      current();
      await updateDoc(doc(firestore, this.COLLECTION, userId), updateData);
      current();
    } catch (error) {
      if (__DEV__) console.error('Error updating user profile:', error);
      throw new Error('Erreur lors de la mise à jour du profil');
    }
  }

  // ============================================
  // PROFILE IMAGE UPLOAD
  // ============================================

  /**
   * Upload une image de profil vers Firebase Storage et retourne l'URL de téléchargement.
   */
  static async uploadProfileImage(userId: string, localUri: string, assertContext?: () => void): Promise<string> {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || currentUser.uid !== userId) {
        throw new Error('User not authenticated');
      }
      const uploadSession = captureTradeSession(userId);
      const current = () => {
        assertTradeSessionCurrent(uploadSession);
        assertContext?.();
        if (auth.currentUser !== currentUser || currentUser.uid !== userId) throw staleTradeOperation();
      };
      current();

      const compressedUri = await prepareImageForUpload(localUri, { maxDimension: 800 });
      current();
      const result = await uploadPreparedJpeg({ownerUid: userId, path: newProfileImagePath(userId), localUri: compressedUri,
        publicProfileUrl: true, assertContext: current});
      current();
      if (!result.publicDownloadUrl) throw new Error('Photo de profil non confirmée.');
      return result.publicDownloadUrl;
    } catch (error) {
      if (__DEV__) console.error('Error uploading profile image:', error);
      throw new Error('Erreur lors de l\'upload de la photo de profil');
    }
  }

  // ============================================
  // FCM TOKEN MANAGEMENT
  // ============================================

  /**
   * Enregistrer un token FCM pour les push notifications
   * Utilise arrayUnion pour supporter plusieurs appareils
   */
  static async saveFcmToken(userId: string, token: string): Promise<void> {
    // No-op silently if auth doesn't match the target doc (signed out / token revoked) — avoids a guaranteed permission-denied.
    if (auth.currentUser?.uid !== userId) return;
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        fcmTokens: arrayUnion(token),
        updatedAt: serverTimestamp(),
      });
      if (__DEV__) console.log('FCM token saved successfully');
    } catch (error) {
      if (__DEV__) console.error('Error saving FCM token:', error);
      throw new Error('Erreur lors de l\'enregistrement du token FCM');
    }
  }

  /**
   * Supprimer un token FCM (déconnexion ou token invalide)
   */
  static async removeFcmToken(userId: string, token: string): Promise<void> {
    return removeFcmToken(userId, token);
  }

  /** Expo tokens are stored separately; APNs tokens never enter fcmTokens. */
  static async saveExpoPushToken(userId: string, token: string): Promise<void> {
    if (auth.currentUser?.uid !== userId) return;
    if (!/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(token)) {
      throw new Error('Token de notification invalide');
    }
    await updateDoc(doc(firestore, this.COLLECTION, userId), {
      expoPushTokens: arrayUnion(token),
      updatedAt: serverTimestamp(),
    });
  }

  static async removeExpoPushToken(userId: string, token: string): Promise<void> {
    return removeExpoPushToken(userId, token);
  }

  /**
   * Récupérer les tokens FCM d'un utilisateur
   */
  static async getFcmTokens(userId: string): Promise<string[]> {
    try {
      const user = await this.getUserById(userId);
      return user?.fcmTokens || [];
    } catch (error) {
      if (__DEV__) console.error('Error fetching FCM tokens:', error);
      return [];
    }
  }

  // ============================================
  // NOTIFICATION PREFERENCES
  // ============================================

  /**
   * Mettre à jour les préférences de notification
   */
  static async updateNotificationPreferences(
    userId: string,
    notificationPrefs: NonNullable<UserPreferences['notifications']>
  ): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        'preferences.notifications': notificationPrefs,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (__DEV__) console.error('Error updating notification preferences:', error);
      throw new Error('Erreur lors de la mise à jour des préférences de notification');
    }
  }

  /**
   * Récupérer les préférences de notification avec valeurs par défaut
   */
  static async getNotificationPreferences(
    userId: string
  ): Promise<NonNullable<UserPreferences['notifications']>> {
    try {
      const user = await this.getUserById(userId);
      return user?.preferences?.notifications || {
        email: true,
        push: true,
        newMessages: true,
        newOrders: true,
        // Privacy by default (opt-in marketing) : notifications secondaires OFF
        priceDrops: false,
        articleFavorited: false,
        swapZoneReminder: false,
        offerReceived: true,
        offerResponse: true,
      };
    } catch (error) {
      if (__DEV__) console.error('Error fetching notification preferences:', error);
      // Retourner les valeurs par défaut en cas d'erreur
      return {
        email: true,
        push: true,
        newMessages: true,
        newOrders: true,
        // Privacy by default (opt-in marketing) : notifications secondaires OFF
        priceDrops: false,
        articleFavorited: false,
        swapZoneReminder: false,
        offerReceived: true,
        offerResponse: true,
      };
    }
  }

  // ============================================
  // RGPD COMPLIANCE
  // ============================================

  /** The existing private owner reader checks Auth revocation/disabled status
   * and native containment before and after its read. Commerce decisions are
   * irrelevant here: missing/incomplete profiles retain historical access. */
  static async assertUserDataExportSession(userId: string, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(userId);
    const current = () => {assertTradeSessionCurrent(session); assertContext();};
    current();
    const reply: unknown = await EligibilityService.getMine(userId);
    current();
    const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
    const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    if (!object(reply) || typeof reply.version !== 'string' || !/^[a-f0-9]{64}$/.test(reply.version) ||
        !text(reply.policyVersion) || !text(reply.statementVersion) || !object(reply.statements) ||
        !text(reply.statements.personal) || !text(reply.statements.professional) ||
        reply.dateOfBirthSource !== 'missing' && reply.dateOfBirthSource !== 'declared_profile' ||
        reply.dateOfBirthVerified !== false || reply.firstDateOfBirthAction !== 'recordSignupConsent' ||
        reply.initialDateRequiresTermsAndPrivacy !== true || !object(reply.decisions) ||
        !['buy', 'sell', 'new_paid_shipping'].every(scope => {
          const decision = reply.decisions && object(reply.decisions) ? reply.decisions[scope] : null;
          return object(decision) && decision.scope === scope && decision.policyVersion === reply.policyVersion && decision.evaluationStage === 'foundations';
        })) throw new Error('export/private_session_unqualified');
    current();
  }

  /** Selected owner-readable server sources, with explicit failures and exclusions. */
  static async exportUserData(userId: string, assertContext: () => void): Promise<ExportedUserData> {
    const session = captureTradeSession(userId), startedAt = new Date().toISOString();
    const supportGeneration = getSupportProjectionGeneration();
    let contextFailed = false, selectedCodeUnits = 0, valueNodes = 0;
    const current = () => {
      try { assertTradeSessionCurrent(session); assertSupportProjectionGeneration(supportGeneration); assertContext(); }
      catch (error) { contextFailed = true; throw error; }
    };
    current(); await this.assertUserDataExportSession(userId, current); current();
    const limited = () => new Error('export/source_value_limit');
    const jsonValue = (value: unknown, depth = 0): UserExportValue => {
      if (depth > OWNER_EXPORT_LIMITS.maxValueDepth || ++valueNodes > OWNER_EXPORT_LIMITS.maxValueNodes) throw limited();
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        if (value.length > OWNER_EXPORT_LIMITS.maxStringCodeUnits) throw limited();
        return value;
      }
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (value instanceof Timestamp) return value.toDate().toISOString();
      if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
      if (Array.isArray(value)) {
        if (value.length > OWNER_EXPORT_LIMITS.maxArrayItems) throw limited();
        return value.map(item => jsonValue(item, depth + 1));
      }
      if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        const keys = Object.keys(value);
        if (keys.length > OWNER_EXPORT_LIMITS.maxObjectKeys) throw limited();
        return Object.fromEntries(keys.filter(key => (value as Record<string, unknown>)[key] !== undefined)
          .map(key => [key, jsonValue((value as Record<string, unknown>)[key], depth + 1)]));
      }
      throw new Error('export/source_unusable');
    };
    const project = (id: string, data: Record<string, unknown>, fields: readonly string[]): UserExportDocument => {
      if (!id || id.includes('/') || id.length > 1500) throw new Error('export/source_unusable');
      valueNodes = 0;
      const result = {id, fields: Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, jsonValue(data[field])]))};
      if (JSON.stringify(result).length > OWNER_EXPORT_LIMITS.maxDocumentJsonCodeUnits) throw limited();
      return result;
    };
    const reasonFor = (error: unknown) => {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      return typeof code === 'string' && ['permission-denied', 'unauthenticated', 'functions/permission-denied', 'functions/unauthenticated'].includes(code)
        ? 'server_read_not_authorized' : error instanceof Error && error.message === 'export/source_value_limit' ? 'selected_value_limit'
          : error instanceof Error && error.message === 'export/source_unusable' ? 'source_not_qualified' : 'server_read_unavailable';
    };
    const coverage = (pageSize: number): UserExportCoverage => ({scope: 'selected_owner_fields', pageSize,
      maxPages: OWNER_EXPORT_LIMITS.maxPagesPerSource, maxDocuments: OWNER_EXPORT_LIMITS.maxDocumentsPerSource,
      maxSourceJsonCodeUnits: OWNER_EXPORT_LIMITS.maxSourceJsonCodeUnits, pagesRead: 0, documentsEmitted: 0,
      traversal: 'unknown', reason: null, continuation: null, legalCompleteness: false});
    const readPages = async <C,>(source: string, fields: readonly string[], load: (cursor: C | null) =>
      Promise<{documents: UserExportDocument[]; cursor: C | null; hasMore: boolean}>, pageSize: number = OWNER_EXPORT_LIMITS.pageSize): Promise<UserExportSource> => {
      const documents: UserExportDocument[] = [], seenIds = new Set<string>(), seenCursors = new Set<string>();
      const detail = coverage(pageSize);
      let cursor: C | null = null, sourceCodeUnits = 0, readAt: string | null = null;
      try {
        for (let pageIndex = 0; pageIndex < OWNER_EXPORT_LIMITS.maxPagesPerSource; pageIndex++) {
          current(); const page = await load(cursor); current();
          if (page.documents.length > pageSize || page.hasMore !== (page.cursor !== null)) throw new Error('export/source_unusable');
          const key = page.cursor === null ? null : JSON.stringify(page.cursor);
          if (key !== null && (seenCursors.has(key) || key === JSON.stringify(cursor))) throw new Error('export/source_unusable');
          if (page.documents.some(item => seenIds.has(item.id)) || new Set(page.documents.map(item => item.id)).size !== page.documents.length) throw new Error('export/source_unusable');
          detail.pagesRead++; readAt = new Date().toISOString();
          for (const item of page.documents) {
            const size = JSON.stringify(item).length;
            const reason = documents.length >= OWNER_EXPORT_LIMITS.maxDocumentsPerSource ? 'document_limit'
              : sourceCodeUnits + size > OWNER_EXPORT_LIMITS.maxSourceJsonCodeUnits ? 'source_memory_limit'
                : selectedCodeUnits + size > OWNER_EXPORT_LIMITS.maxSelectedJsonCodeUnits ? 'export_memory_limit' : null;
            if (reason) {
              detail.traversal = 'truncated'; detail.reason = reason; detail.continuation = null; detail.documentsEmitted = documents.length;
              return {source, state: 'read', readAt, documents, reason, selectedFields: fields, coverage: detail};
            }
            documents.push(item); seenIds.add(item.id); sourceCodeUnits += size; selectedCodeUnits += size;
          }
          detail.documentsEmitted = documents.length;
          cursor = page.cursor; valueNodes = 0; detail.continuation = cursor === null ? null : jsonValue(cursor);
          if (!page.hasMore) { detail.traversal = 'ended_at_read'; detail.reason = null; break; }
          if (key !== null) seenCursors.add(key);
          detail.traversal = 'truncated'; detail.reason = 'page_limit';
        }
        return {source, state: 'read', readAt, documents, reason: detail.reason, selectedFields: fields, coverage: detail};
      } catch (error: unknown) {
        if (contextFailed) throw error;
        current(); detail.traversal = 'unknown'; detail.reason = reasonFor(error); detail.documentsEmitted = documents.length;
        return {source, state: documents.length ? 'read' : 'unavailable', readAt, documents: documents.length ? documents : null,
          reason: detail.reason, selectedFields: fields, coverage: detail};
      }
    };
    const readDocument = async (source: string, fields: readonly string[]): Promise<UserExportSource> => {
      const detail = coverage(1); detail.maxPages = 1; detail.maxDocuments = 1;
      try {
        current(); const snapshot = await getDocFromServer(doc(firestore, source)); current();
        if (snapshot.metadata.fromCache) throw new Error('export/server_source_unavailable');
        detail.pagesRead = 1;
        const documents = snapshot.exists() ? [project(snapshot.id, snapshot.data(), fields)] : [];
        const size = JSON.stringify(documents).length;
        if (selectedCodeUnits + size > OWNER_EXPORT_LIMITS.maxSelectedJsonCodeUnits) throw limited();
        selectedCodeUnits += size; detail.documentsEmitted = documents.length; detail.traversal = 'ended_at_read';
        return {source, state: snapshot.exists() ? 'read' : 'absent', readAt: new Date().toISOString(), documents, reason: null, selectedFields: fields, coverage: detail};
      } catch (error: unknown) {
        if (contextFailed) throw error;
        current(); detail.reason = reasonFor(error);
        return {source, state: 'unavailable', readAt: null, documents: null, reason: detail.reason, selectedFields: fields, coverage: detail};
      }
    };
    const queryPage = async (target: Query<DocumentData>, fields: readonly string[], cursor: string | null,
      own?: {field: string; value: string}, metadata?: (data: Record<string, unknown>) => Record<string, unknown>) => {
      current();
      const snapshot = await getDocsFromServer(query(target, orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(OWNER_EXPORT_LIMITS.pageSize + 1)));
      current();
      if (snapshot.metadata.fromCache || snapshot.docs.length > OWNER_EXPORT_LIMITS.pageSize + 1) throw new Error('export/server_source_unavailable');
      const rows = snapshot.docs.slice(0, OWNER_EXPORT_LIMITS.pageSize);
      if (new Set(snapshot.docs.map(item => item.id)).size !== snapshot.docs.length) throw new Error('export/source_unusable');
      const documents = rows.map(item => {
        const data = item.data();
        if (own && data[own.field] !== own.value) throw new Error('export/source_unusable');
        return project(item.id, {...data, ...metadata?.(data)}, fields);
      });
      return {documents, hasMore: snapshot.docs.length > OWNER_EXPORT_LIMITS.pageSize,
        cursor: snapshot.docs.length > OWNER_EXPORT_LIMITS.pageSize ? rows[rows.length - 1].id : null};
    };
    const readQuery = (source: string, target: Query<DocumentData>, fields: readonly string[], own?: {field: string; value: string}, metadata?: (data: Record<string, unknown>) => Record<string, unknown>) =>
      readPages<string>(source, fields, cursor => queryPage(target, fields, cursor, own, metadata));
    const sources: Record<string, UserExportSource> = {};
    sources.profile = await readDocument(`users/${userId}`, ['displayName', 'email', 'phoneNumber', 'bio', 'profileImage', 'createdAt', 'updatedAt', 'preferences', 'notificationPreferences']); current();
    sources.articles = await readQuery('articles: sellerId = actorId', query(collection(firestore, 'articles'), where('sellerId', '==', userId)),
      ['title', 'description', 'price', 'brand', 'size', 'category', 'condition', 'isActive', 'isSold', 'createdAt', 'updatedAt'], {field: 'sellerId', value: userId}); current();
    sources.favorites = await readDocument(`favorites/${userId}`, ['articleIds', 'updatedAt']); current();
    sources.notifications = await readQuery('notifications: userId = actorId', query(collection(firestore, 'notifications'), where('userId', '==', userId)),
      ['type', 'isRead', 'createdAt', 'readAt'], {field: 'userId', value: userId}); current();
    sources.chats = await readQuery('chats: participants contains actorId', query(collection(firestore, 'chats'), where('participants', 'array-contains', userId)), ['createdAt', 'updatedAt']); current();
    const messageFields = ['chatId', 'senderId', 'type', 'timestamp', 'status', 'isRead'];
    sources.sentMessages = sources.chats.state !== 'read' ? {source: 'messages: own messages in owner-readable chats', state: 'unavailable', readAt: null, documents: null,
      reason: 'chat_source_unavailable', selectedFields: messageFields} : await readPages<{chatIndex: number; after: string | null}>('messages: own messages in owner-readable chats', messageFields, async cursor => {
      const chats = sources.chats.documents ?? [], position = cursor ?? {chatIndex: 0, after: null};
      if (position.chatIndex >= chats.length) return {documents: [], cursor: null, hasMore: false};
      const chat = chats[position.chatIndex];
      const page = await queryPage(query(collection(firestore, 'messages'), where('chatId', '==', chat.id), where('senderId', '==', userId), where('participants', 'array-contains', userId)),
        messageFields, position.after, {field: 'senderId', value: userId}); current();
      const next = page.hasMore ? {chatIndex: position.chatIndex, after: page.cursor}
        : position.chatIndex + 1 < chats.length ? {chatIndex: position.chatIndex + 1, after: null} : null;
      return {documents: page.documents, cursor: next, hasMore: next !== null};
    }); current();
    if (sources.sentMessages.coverage && sources.chats.coverage?.traversal !== 'ended_at_read' && sources.sentMessages.coverage.traversal === 'ended_at_read') {
      sources.sentMessages.coverage.traversal = 'truncated'; sources.sentMessages.coverage.reason = 'chat_scope_incomplete'; sources.sentMessages.reason = 'chat_scope_incomplete';
    }
    sources.reviews = await readQuery('avis: reviewerId = actorId', query(collection(firestore, 'avis'), where('reviewerId', '==', userId)), ['reviewerId', 'reviewedUserId', 'rating', 'createdAt'], {field: 'reviewerId', value: userId}); current();
    const transactionFields = ['articleId', 'status', 'createdAt', 'paidAt', 'deliveredAt', 'completedAt', 'price', 'total', 'serviceFee', 'shippingCost', 'currency', 'deliveryType'];
    sources.purchases = await readQuery('transactions: buyerId = actorId', query(collection(firestore, 'transactions'), where('buyerId', '==', userId)), transactionFields, {field: 'buyerId', value: userId}); current();
    sources.sales = await readQuery('transactions: sellerId = actorId', query(collection(firestore, 'transactions'), where('sellerId', '==', userId)), transactionFields, {field: 'sellerId', value: userId}); current();
    sources.savedSearches = await readQuery(`users/${userId}/savedSearches`, collection(firestore, 'users', userId, 'savedSearches'), ['query', 'filters', 'createdAt', 'updatedAt']); current();
    sources.searchHistory = await readQuery(`users/${userId}/searchHistory`, collection(firestore, 'users', userId, 'searchHistory'), ['query', 'timestamp']); current();
    sources.consents = await readQuery(`users/${userId}/consents`, collection(firestore, 'users', userId, 'consents'), ['type', 'consentType', 'version', 'policyVersion', 'acceptedAt', 'value']); current();
    const swapFields = ['ownerRole', 'status', 'exchangeMode', 'createdAt', 'updatedAt', 'acceptedAt', 'completedAt'];
    const swapStatuses = ['proposed', 'payment_pending', 'accepted', 'declined', 'cancelled', 'photos_pending', 'shipping', 'completed', 'disputed', 'expired'];
    const recordedDate = (value: unknown) => {
      const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value
        : typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? new Date(value) : null;
      return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    };
    for (const [key, role] of [['swapsInitiated', 'initiator'], ['swapsReceived', 'receiver']] as const) {
      sources[key] = await readQuery(`swaps: ${role}Id = actorId; own role metadata only`, query(collection(firestore, 'swaps'), where(`${role}Id`, '==', userId)),
        swapFields, {field: `${role}Id`, value: userId}, data => ({ownerRole: role, status: typeof data.status === 'string' && swapStatuses.includes(data.status) ? data.status : null,
          exchangeMode: data.exchangeMode === 'hand_delivery' || data.exchangeMode === 'shipping' ? data.exchangeMode : null,
          createdAt: recordedDate(data.createdAt), updatedAt: recordedDate(data.updatedAt), acceptedAt: recordedDate(data.acceptedAt), completedAt: recordedDate(data.completedAt)})); current();
    }
    const ledgerFields = ['source', 'type', 'amountCents', 'currency', 'createdAt', 'createdAtMs', 'dateQualification',
      'balanceAfterCents', 'debtRecordedCents', 'debtAllocationCents', 'amountMeaning', 'references', 'anomalies', 'financialQualification'];
    const withdrawalFields = ['source', 'type', 'amountCents', 'currency', 'createdAt', 'createdAtMs', 'dateQualification',
      'state', 'operationState', 'proofQualification', 'references', 'completionProof', 'compensationProof', 'anomalies'];
    for (const [key, source, fields] of [['walletLedger', 'ledger', ledgerFields], ['walletWithdrawals', 'withdrawals', withdrawalFields]] as const) {
      sources[key] = await readPages<string>(`getWalletInfo/history: owner ${source}; period unfiltered`, fields, async cursor => {
        current();
        const page = await getWalletHistoryPage(userId, {source, period: {fromMs: null, toMs: null}, cursor, pageSize: OWNER_EXPORT_LIMITS.pageSize}, current);
        current();
        return {documents: page.entries.map(item => {
          // Construct nested metadata too: the private reader's free descriptions and bank destination never enter this export.
          const references = item.source === 'ledger' ? {transactionId: item.references.transactionId, refundIntentId: item.references.refundIntentId,
            disputeId: item.references.disputeId, withdrawalRequestId: item.references.withdrawalRequestId,
            withdrawalDebitLedgerId: item.references.withdrawalDebitLedgerId, swapId: item.references.swapId}
            : {withdrawalRequestId: item.references.withdrawalRequestId, debitLedgerId: item.references.debitLedgerId, compensationLedgerId: item.references.compensationLedgerId};
          const metadata: Record<string, unknown> = {...item, references};
          if (item.source === 'withdrawals') {
            metadata.completionProof = item.completionProof ? {qualified: true, observedAt: item.completionProof.observedAt} : null;
            metadata.compensationProof = item.compensationProof ? {qualified: true, amountCents: item.compensationProof.amountCents,
              ledgerEntryId: item.compensationProof.ledgerEntryId, recordedAt: item.compensationProof.recordedAt} : null;
          }
          return project(item.id, metadata, fields);
        }), cursor: page.cursor, hasMore: page.hasMore};
      }); current();
    }
    const supportFields = ['kind', 'status', 'version', 'receivedAt', 'recordedAt', 'updatedAt', 'withdrawnAt', 'confidentialityState'];
    sources.support = await readPages<SupportListCursor>('SupportRequestService.list: owner metadata only', supportFields, async cursor => {
      current(); const page = await SupportRequestService.list(userId, 'owner', cursor ?? undefined, current); current();
      return {documents: page.items.map(item => project(item.id, {kind: item.kind, status: item.status, version: item.version,
        receivedAt: item.receivedAt, recordedAt: item.recordedAt, updatedAt: item.updatedAt, withdrawnAt: item.withdrawnAt,
        confidentialityState: item.confidentiality?.state ?? 'unknown'}, supportFields)), cursor: page.cursor, hasMore: page.hasMore};
    }, OWNER_EXPORT_LIMITS.supportPageSize); current();
    const excluded: Record<string, {source: string; reason: string}> = {
      localArticleDraft: {source: `AsyncStorage @article_draft:user:${userId}`, reason: 'Brouillon local non inclus ; aucune lecture, expiration, modification ou suppression de ses images.'},
      supportContent: {source: 'Récits, pièces, originaux confinés et journaux de support', reason: 'Non inclus. Seules les métadonnées propres des tickets sont sélectionnées.'},
      swapContent: {source: 'Contenus et journaux Troc', reason: 'Non inclus : récits, articles, photos, adresses, contreparties et preuves de Troc.'},
      walletPrivate: {source: 'Dossiers bancaires et contenus libres du portefeuille', reason: 'Non inclus : destinations bancaires et descriptions libres. Aucun total ni signe financier n’est déduit des deux registres.'},
      otherSubcollections: {source: 'Sous-dossiers et pièces autres que savedSearches, searchHistory et consents', reason: 'Non inclus ; cet export ne parcourt pas les sous-dossiers ni les fichiers.'},
      freeContent: {source: 'Corps des messages, notifications et avis ; documents de commande non sélectionnés', reason: 'Non inclus pour éviter de réexporter des contenus restreints ou des copies de support. Les champs exportés sont listés par source.'},
    };
    for (const [key, value] of Object.entries(excluded)) sources[key] = {...value, state: 'not_included', readAt: null, documents: null, selectedFields: []};
    await this.assertUserDataExportSession(userId, current); current();
    return {protocol: 'owner_data_export_v1', actorId: userId, startedAt, completedAt: new Date().toISOString(), exhaustive: false,
      authorization: 'firestore_rules_at_each_server_read', sources, limits: {...OWNER_EXPORT_LIMITS},
      limitations: ['Export limité aux champs et sources listés, sans certificat d’exhaustivité ni qualification juridique.',
        'Les lectures serveur sont distinctes : aucun instantané cohérent entre sources ou pages n’est certifié.',
        'Les requêtes Firestore sont bornées et ordonnées par identifiant ; les lecteurs privés existants qualifient les pages portefeuille et support.',
        'La portée authorization décrit les lectures Firestore ; les sources callable sont autorisées par leurs lecteurs serveur privés, sans mutation.',
        'Chaque source indique sa progression, sa troncature ou son issue inconnue. Finir une chaîne de pages ne certifie pas une recherche juridique complète.',
        'Les limites portent sur les pages, documents et unités UTF-16 du JSON sélectionné ; une valeur trop volumineuse reste indisponible, jamais déclarée absente.',
        'Les horodatages de préparation et de lecture proviennent de l’horloge de l’appareil, sans certification de cette horloge.',
        'Une source indisponible n’est pas une source absente ; une liste vide porte seulement sur la requête indiquée.',
        'Les dates et montants sont ceux enregistrés, sans conversion de devise, total, signe financier déduit, preuve de paiement ou réception bancaire.',
        'Ledger et retraits peuvent décrire un même mouvement ; leurs lignes ne doivent pas être additionnées.',
        'Le lecteur privé getMyEligibility qualifie la session sur le serveur avant et après les lectures, puis avant le fichier et son partage dans ce parcours.',
        'Ces contrôles ponctuels ne sont pas atomiques avec les lectures Firestore, le fichier ou le dialogue de partage ; aucune copie externe déjà remise ne peut être rappelée ici.',
        'L’accès en lecture avec une session SDK ne certifie pas un rétablissement du compte ni une permission de nouvelle opération.']};
  }
}
