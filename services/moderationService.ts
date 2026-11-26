import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';

import { auth, firestore, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { acknowledgeArticleReportAttempt, articleReportTupleHash, parseArticleReportObservation, parseArticleReportPreview, rememberArticleReportAttempt } from '@/services/articleReportJournal';
import type { ArticleReportAttempt, ArticleReportObservation, ArticleReportPreview } from '@/types/articleReportEvidence';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
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

  static async previewArticleReport(uid: string, articleId: string, sellerId: string,
    examined: Record<string, unknown>, assertContext: () => void): Promise<ArticleReportPreview> {
    const session = captureTradeSession(uid); assertContext();
    const response = await httpsCallable<unknown, unknown>(functions, 'submitReport')({operation: 'previewArticleReport',
      expectedUid: uid, targetId: articleId, expectedArticle: examined});
    assertTradeSessionCurrent(session); assertContext();
    const preview = await parseArticleReportPreview(response.data, uid, articleId, sellerId, examined, assertContext);
    assertTradeSessionCurrent(session); assertContext(); return preview;
  }

  static async submitArticleReport(attempt: ArticleReportAttempt, assertContext: () => void): Promise<ArticleReportObservation> {
    const session = captureTradeSession(attempt.uid); assertContext();
    await rememberArticleReportAttempt(attempt, assertContext); assertTradeSessionCurrent(session); assertContext();
    const {version: _version, uid, ...payload} = attempt;
    const response = await httpsCallable<unknown, unknown>(functions, 'submitReport')({...payload, expectedUid: uid});
    assertTradeSessionCurrent(session); assertContext();
    const receipt = await parseArticleReportObservation(response.data, attempt, assertContext);
    assertTradeSessionCurrent(session); assertContext(); return receipt;
  }

  static async observeArticleReport(attempt: ArticleReportAttempt, assertContext: () => void): Promise<ArticleReportObservation> {
    const session = captureTradeSession(attempt.uid); assertContext();
    const response = await httpsCallable<unknown, unknown>(functions, 'submitReport')({operation: 'observeArticleReport',
      expectedUid: attempt.uid, targetId: attempt.targetId, requestId: attempt.requestId});
    assertTradeSessionCurrent(session); assertContext();
    const receipt = await parseArticleReportObservation(response.data, attempt, assertContext);
    assertTradeSessionCurrent(session); assertContext(); return receipt;
  }

  static async acknowledgeArticleReport(attempt: ArticleReportAttempt, assertContext: () => void): Promise<ArticleReportObservation> {
    const receipt = await this.observeArticleReport(attempt, assertContext); assertContext();
    await acknowledgeArticleReportAttempt(attempt, receipt, assertContext); return receipt;
  }

  static async neutralizeArticleReport(attempt: ArticleReportAttempt, assertContext: () => void): Promise<ArticleReportObservation> {
    const session = captureTradeSession(attempt.uid); assertContext();
    await rememberArticleReportAttempt(attempt, assertContext); assertTradeSessionCurrent(session); assertContext();
    const expectedTupleHash = await articleReportTupleHash(attempt); assertTradeSessionCurrent(session); assertContext();
    const {version: _version, uid, ...payload} = attempt;
    const response = await httpsCallable<unknown, unknown>(functions, 'submitReport')({...payload, operation: 'neutralizeArticleReport', expectedUid: uid, expectedTupleHash});
    assertTradeSessionCurrent(session); assertContext();
    const receipt = await parseArticleReportObservation(response.data, attempt, assertContext);
    assertTradeSessionCurrent(session); assertContext(); return receipt;
  }

  // ============================================
  // REPORTING
  // ============================================

  /**
   * Signaler un utilisateur, un article ou un message
   */
  /**
   * Signaler un utilisateur, un article ou un message.
   *
   * Passe par la callable `submitReport` (Admin SDK) plutôt que par une écriture
   * cliente directe. Le rail serveur existait, était déployé, et n'était appelé
   * par aucun code : il valide les champs, borne les longueurs, dérive le nom du
   * signaleur du document utilisateur — que le client ne peut pas falsifier — et
   * impose « un signalement par personne et par cible » via un identifiant
   * déterministe posé dans une transaction. Une écriture cliente ne pouvait rien
   * garantir de tout cela : un même utilisateur pouvait signaler cent fois la
   * même cible, et se déclarer sous n'importe quel nom.
   *
   * `reporterId` et `reporterName` restent dans la signature — les appelants les
   * fournissent — mais le SERVEUR les dérive lui-même de l'appelant authentifié.
   */
  static async createReport(
    _reporterId: string,
    _reporterName: string,
    targetType: ReportType,
    targetId: string,
    reason: ReportReason,
    description?: string,
    targetOwnerId?: string
  ): Promise<string> {
    if (targetType === 'article') throw new Error('Examinez l’aperçu actuel de l’article avant de confirmer son signalement.');
    try {
      const submitReportFn = httpsCallable<
        {
          targetType: ReportType;
          targetId: string;
          reason: ReportReason;
          description?: string;
          targetOwnerId?: string;
        },
        { ok: true; reportId: string; status: 'pending' }
      >(functions, 'submitReport');

      const res = await submitReportFn({
        targetType,
        targetId,
        reason,
        // Champs optionnels OMIS quand ils sont absents : la callable refuse
        // explicitement `undefined`, comme le SDK le refusait avant elle.
        ...(description ? { description } : {}),
        ...(targetOwnerId ? { targetOwnerId } : {}),
      });

      return res.data.reportId;
    } catch (error) {
      console.error('Error creating report:', error);
      // Le serveur distingue le doublon du reste : « déjà signalé » n'est pas une
      // erreur pour l'utilisateur, c'est une information.
      const code = (error as { code?: string })?.code ?? '';
      if (code.includes('already-exists')) {
        throw new Error('Vous avez déjà signalé cet élément.');
      }
      throw new Error("Erreur lors de l'envoi du signalement");
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
      // TOUTES les entrées, pas seulement la première. `blockUser` horodate
      // chaque objet (`blockedAt`), donc deux blocages successifs de la même
      // personne produisent deux objets DIFFÉRENTS qu'`arrayUnion` empile au
      // lieu de dédupliquer — et aucun des deux points d'entrée ne vérifie
      // l'état préalable. Ne retirer que la première laissait `blockedUsers`
      // porter un résidu : les règles Firestore, qui lisent `blockedUserIds`,
      // acceptaient alors le message, tandis que le trigger serveur, qui lit
      // les DEUX formes, le supprimait. La personne se croyait débloquée et
      // tous les messages reçus étaient détruits en silence, définitivement.
      const usersToRemove = blockedUsers.filter(
        (u: any) => u.userId === blockedUserId
      );

      // Toujours retirer l'UID de la liste plate (source de vérité des rules),
      // même si l'entrée objet est introuvable (doc partiellement migré).
      const update: Record<string, unknown> = {
        blockedUserIds: arrayRemove(blockedUserId),
      };
      if (usersToRemove.length > 0) {
        update.blockedUsers = arrayRemove(...usersToRemove);
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

      // Déduplication à la lecture : un double blocage empile deux objets
      // (horodatages distincts), qui afficheraient deux fois la même personne
      // dans Réglages → Utilisateurs bloqués. On garde le blocage le plus
      // ancien, celui qui date de la décision initiale.
      const seen = new Set<string>();
      return blockedUsers
        .map((u: any) => ({
          userId,
          blockedUserId: u.userId,
          blockedUserName: u.userName,
          blockedAt: new Date(u.blockedAt),
        }))
        .sort(
          (a: BlockedUser, b: BlockedUser) =>
            a.blockedAt.getTime() - b.blockedAt.getTime()
        )
        .filter((u: BlockedUser) => {
          if (seen.has(u.blockedUserId)) return false;
          seen.add(u.blockedUserId);
          return true;
        });
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
