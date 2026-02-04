import { firestore } from '@/config/firebaseConfig';
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
} from '@react-native-firebase/firestore';

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
   * Bloquer un utilisateur
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
      });
    } catch (error) {
      console.error('Error blocking user:', error);
      throw new Error('Erreur lors du blocage de l\'utilisateur');
    }
  }

  /**
   * Débloquer un utilisateur
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

      if (userToRemove) {
        await updateDoc(doc(firestore, this.USERS_COLLECTION, userId), {
          blockedUsers: arrayRemove(userToRemove),
        });
      }
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
      const blockedUsers = userData?.blockedUsers || [];

      return blockedUsers.some((u: any) => u.userId === targetUserId);
    } catch (error) {
      console.error('Error checking blocked status:', error);
      return false;
    }
  }

  /**
   * Vérifier si l'un des deux utilisateurs a bloqué l'autre
   */
  static async areUsersBlocked(
    userId1: string,
    userId2: string
  ): Promise<boolean> {
    try {
      const [blocked1, blocked2] = await Promise.all([
        this.isUserBlocked(userId1, userId2),
        this.isUserBlocked(userId2, userId1),
      ]);
      return blocked1 || blocked2;
    } catch (error) {
      console.error('Error checking mutual block status:', error);
      return false;
    }
  }
}
