import { auth, firestore } from '@/config/firebaseConfig';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

export type ReportType = 'user' | 'article' | 'message';

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'inappropriate_content'
  | 'counterfeit'
  | 'scam'
  | 'dangerous_item'
  | 'other';

export const ReportReasonLabels: Record<ReportReason, string> = {
  spam: 'Spam ou publicité',
  harassment: 'Harcèlement ou abus',
  inappropriate_content: 'Contenu inapproprié',
  counterfeit: 'Article contrefait',
  scam: 'Arnaque ou fraude',
  dangerous_item: 'Article dangereux ou interdit',
  other: 'Autre raison',
};

export interface Report {
  id?: string;
  reporterId: string;
  reporterName: string;
  targetType: ReportType;
  targetId: string;
  targetOwnerId?: string;
  reason: ReportReason;
  description?: string;
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  createdAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  resolution?: string;
}

export interface BlockedUser {
  userId: string;
  blockedUserId: string;
  blockedUserName: string;
  blockedAt: Date;
}

export class ModerationService {
  private static readonly REPORTS_COLLECTION = 'reports';
  private static readonly USERS_COLLECTION = 'users';

  // ============================================
  // REPORTING
  // ============================================

  /**
   * Signaler un utilisateur, un article ou un message
   */
  static async createReport(
    reporterId: string,
    reporterName: string,
    targetType: ReportType,
    targetId: string,
    reason: ReportReason,
    description?: string,
    targetOwnerId?: string
  ): Promise<string> {
    try {
      const report: Omit<Report, 'id'> = {
        reporterId,
        reporterName,
        targetType,
        targetId,
        targetOwnerId,
        reason,
        description,
        status: 'pending',
        createdAt: new Date(),
      };

      const docRef = await addDoc(
        collection(firestore, this.REPORTS_COLLECTION),
        {
          ...report,
          createdAt: serverTimestamp(),
        }
      );

      return docRef.id;
    } catch (error) {
      console.error('Error creating report:', error);
      throw new Error('Erreur lors de l\'envoi du signalement');
    }
  }

  /**
   * Récupérer les signalements d'un utilisateur
   */
  static async getUserReports(userId: string): Promise<Report[]> {
    try {
      const q = query(
        collection(firestore, this.REPORTS_COLLECTION),
        where('reporterId', '==', userId)
      );
      const snapshot = await getDocs(q);

      return snapshot.docs.map((docSnapshot: any) => {
        const data = docSnapshot.data();
        return {
          id: docSnapshot.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          reviewedAt: data.reviewedAt?.toDate(),
        } as Report;
      });
    } catch (error) {
      console.error('Error fetching user reports:', error);
      return [];
    }
  }

  /**
   * Vérifier si un utilisateur a déjà signalé une cible
   */
  static async hasUserReported(
    reporterId: string,
    targetType: ReportType,
    targetId: string
  ): Promise<boolean> {
    try {
      const q = query(
        collection(firestore, this.REPORTS_COLLECTION),
        where('reporterId', '==', reporterId),
        where('targetType', '==', targetType),
        where('targetId', '==', targetId)
      );
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking report:', error);
      return false;
    }
  }

  // ============================================
  // BLOCKING
  // ============================================

  /**
   * Bloquer un utilisateur.
   *
   * Maintient DEUX champs en parallèle, par souci de cohérence avec
   * l'application serveur :
   * - `blockedUsers` : tableau d'objets `{ userId, userName, blockedAt }`
   *   utilisé par l'UI (liste des bloqués) et par le trigger messages.ts.
   * - `blockedUserIds` : liste plate d'UIDs, source de vérité consommée par
   *   les Firestore rules (`isNotBlockedBy`) qui rejettent la création de
   *   message/chat vers un bloqueur. Sans ce champ, la règle tombe en
   *   fallback "passe" et le blocage n'est appliqué qu'a posteriori par le
   *   trigger (le message landait brièvement). Le client ne décide PAS de
   *   l'autorisation : il alimente seulement le champ que le serveur lit.
   */
  static async blockUser(
    userId: string,
    blockedUserId: string,
    blockedUserName: string
  ): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.USERS_COLLECTION, userId), {
        blockedUsers: arrayUnion({
          userId: blockedUserId,
          userName: blockedUserName,
          blockedAt: new Date().toISOString(),
        }),
        blockedUserIds: arrayUnion(blockedUserId),
      });
    } catch (error) {
      console.error('Error blocking user:', error);
      throw new Error('Erreur lors du blocage de l\'utilisateur');
    }
  }

  /**
   * Débloquer un utilisateur.
   *
   * Retire l'entrée des DEUX champs maintenus par blockUser :
   * `blockedUsers` (objet, pour l'UI) et `blockedUserIds` (UID plat, lu par
   * les Firestore rules) — sinon la règle continuerait de bloquer alors que
   * l'utilisateur a été retiré de la liste affichée.
   */
  static async unblockUser(
    userId: string,
    blockedUserId: string
  ): Promise<void> {
    try {
      // On doit d'abord récupérer l'objet exact pour le supprimer
      const userDoc = await getDoc(doc(firestore, this.USERS_COLLECTION, userId));
      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      const blockedUsers = userData?.blockedUsers || [];
      const userToRemove = blockedUsers.find(
        (u: any) => u.userId === blockedUserId
      );

      // Toujours retirer l'UID de la liste plate (source de vérité des rules),
      // même si l'entrée objet est introuvable (doc partiellement migré).
      const update: Record<string, unknown> = {
        blockedUserIds: arrayRemove(blockedUserId),
      };
      if (userToRemove) {
        update.blockedUsers = arrayRemove(userToRemove);
      }

      await updateDoc(doc(firestore, this.USERS_COLLECTION, userId), update);
    } catch (error) {
      console.error('Error unblocking user:', error);
      throw new Error('Erreur lors du déblocage de l\'utilisateur');
    }
  }

  /**
   * Récupérer la liste des utilisateurs bloqués
   */
  static async getBlockedUsers(userId: string): Promise<BlockedUser[]> {
    try {
      const userDoc = await getDoc(doc(firestore, this.USERS_COLLECTION, userId));
      if (!userDoc.exists()) return [];

      const userData = userDoc.data();
      const blockedUsers = userData?.blockedUsers || [];

      return blockedUsers.map((u: any) => ({
        userId,
        blockedUserId: u.userId,
        blockedUserName: u.userName,
        blockedAt: new Date(u.blockedAt),
      }));
    } catch (error) {
      console.error('Error fetching blocked users:', error);
      return [];
    }
  }

  /**
   * Vérifier si un utilisateur est bloqué
   */
  static async isUserBlocked(
    userId: string,
    targetUserId: string
  ): Promise<boolean> {
    try {
      const userDoc = await getDoc(doc(firestore, this.USERS_COLLECTION, userId));
      if (!userDoc.exists()) return false;

      const userData = userDoc.data();

      // Canonical field read by the Firestore rules (`isNotBlockedBy`): flat
      // list of plain UIDs. We check it first so the client UX matches exactly
      // what the server authorizes. Fall back to the object array for any doc
      // not yet carrying the flat list.
      const blockedUserIds = (userData?.blockedUserIds || []) as string[];
      if (blockedUserIds.includes(targetUserId)) return true;

      const blockedUsers = userData?.blockedUsers || [];
      return blockedUsers.some((u: any) => u.userId === targetUserId);
    } catch (error) {
      console.error('Error checking blocked status:', error);
      return false;
    }
  }

  /**
   * Vérifier si l'un des deux utilisateurs a bloqué l'autre.
   * Security rules restrict user doc reads to isOwner, so we can only check
   * whether the CURRENT user has blocked the other user. The reverse direction
   * (has the other user blocked us?) is enforced server-side by Cloud Functions.
   */
  static async areUsersBlocked(
    userId1: string,
    userId2: string
  ): Promise<boolean> {
    try {
      const currentUserId = auth.currentUser?.uid;
      if (!currentUserId) return false;

      // Determine which ID is the "other" user
      const otherUserId = currentUserId === userId1 ? userId2 : userId1;

      // Only read our own doc (allowed by security rules)
      return this.isUserBlocked(currentUserId, otherUserId);
    } catch (error) {
      if (__DEV__) console.error('Error checking mutual block status:', error);
      return false;
    }
  }
}
