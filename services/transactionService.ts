import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestore, functions } from '../config/firebaseConfig';
import { MeetupSpot, ShippingAddress, Transaction, TransactionStatus } from '../types';

/**
 * Every `Transaction` field stored as a Firestore `Timestamp` that the app
 * consumes as a JS `Date`. Centralized so every read path converts the SAME
 * set — components (ShipmentTracking, Timeline) expect `Date`, never raw
 * `Timestamp`, otherwise calls like `toLocaleDateString()` crash.
 */
const TRANSACTION_DATE_FIELDS = [
  'meetupConfirmedAt',
  'meetupCompletedAt',
  'fundsReleaseAt',
  'fundsReleasedAt',
  'disputeClosedAt',
  'shippingReconciledAt',
  'lastLabelAttemptAt',
  'labelCreatedAt',
  'labelStaleNudgedAt',
  'deliveryFailedAt',
  'stripeRefundIssuedAt',
  'refundStartedAt',
  'paidAt',
  'shippedAt',
  'deliveredAt',
] as const;

/**
 * Maps a raw Firestore transaction document into a typed `Transaction`,
 * converting every `Timestamp` field to a `Date`. `createdAt` always resolves
 * to a `Date` (falls back to `new Date(0)` when missing so sorting stays
 * stable); optional date fields stay `undefined` when absent (never written
 * back as `undefined` to Firestore — read-only mapping).
 */
function mapTransaction(id: string, data: Record<string, any>): Transaction {
  const mapped: Record<string, any> = { ...data, id };

  mapped.createdAt = data?.createdAt?.toDate?.() ?? new Date(0);

  for (const field of TRANSACTION_DATE_FIELDS) {
    const value = data?.[field];
    if (value?.toDate) {
      mapped[field] = value.toDate();
    }
  }

  return mapped as Transaction;
}

export class TransactionService {
  /**
   * Create a shipping transaction via Cloud Function.
   *
   * The Cloud Function atomically verifies that the article is still
   * available (not sold, not deleted, not inactive) and creates the
   * transaction in a single Firestore runTransaction. This prevents
   * the race condition where two buyers purchase the same article.
   */
  static async createShippingTransaction(
    articleId: string,
    buyerId: string,
    sellerId: string,
    amount: number,
    shippingCost: number,
    shippingAddress: ShippingAddress,
    shipEngineRateId: string,
    chatId?: string,
    serviceFee?: number
  ): Promise<string> {
    // shipEngineRateId is mandatory: the backend buys the real label from this
    // rate. Never send null — a missing rate would block label generation.
    if (!shipEngineRateId) {
      throw new Error("Le tarif de livraison est manquant. Actualisez l'estimation.");
    }

    const callable = httpsCallable<
      Record<string, any>,
      { success: boolean; transactionId: string }
    >(functions, 'createTransaction');

    const result = await callable({
      articleId,
      deliveryType: 'shipping',
      amount,
      shippingCost,
      serviceFee: serviceFee || 0,
      shippingAddress,
      chatId: chatId || null,
      shipEngineRateId,
    });

    if (!result.data.success || !result.data.transactionId) {
      throw new Error('Erreur lors de la création de la transaction');
    }

    return result.data.transactionId;
  }

  /**
   * Create a meetup transaction via Cloud Function.
   *
   * Same atomic safety as createShippingTransaction: the Cloud Function
   * checks article availability and marks it sold in a single
   * runTransaction.
   */
  static async createMeetupTransaction(
    articleId: string,
    buyerId: string,
    sellerId: string,
    amount: number,
    meetupSpot: MeetupSpot | null,
    chatId?: string
  ): Promise<string> {
    const callable = httpsCallable<
      Record<string, any>,
      { success: boolean; transactionId: string }
    >(functions, 'createTransaction');

    const result = await callable({
      articleId,
      deliveryType: 'meetup',
      amount,
      meetupSpot: meetupSpot || null,
      chatId: chatId || null,
    });

    if (!result.data.success || !result.data.transactionId) {
      throw new Error('Erreur lors de la création de la transaction meetup');
    }

    return result.data.transactionId;
  }

  /**
   * Get a transaction by ID
   */
  static async getTransaction(transactionId: string): Promise<Transaction | null> {
    try {
      const transactionRef = doc(firestore, 'transactions', transactionId);
      const transactionDoc = await getDoc(transactionRef);

      if (!transactionDoc.exists()) {
        return null;
      }

      return mapTransaction(transactionDoc.id, transactionDoc.data() ?? {});
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de la transaction: ${error.message}`);
    }
  }

  /**
   * Get the active transaction for a chat from the caller's perspective.
   *
   * SECURITY: the transactions read rule requires the caller to be either
   * buyer or seller of each returned doc. To match that, we run two
   * queries scoped by uid (buyer-side and seller-side) instead of a bare
   * chatId filter, which Firestore would reject under rules-aware
   * queries.
   *
   * Requires composite indexes (buyerId, chatId) and (sellerId, chatId).
   */
  static async getTransactionByChat(
    chatId: string,
    userId: string
  ): Promise<Transaction | null> {
    if (!userId) {
      throw new Error('userId is required to query a transaction');
    }
    try {
      // Includes the post-delivery + recourse statuses so the chat-embedded
      // ShipmentTracking (buyer recourse on delivery_failed/lost, return
      // request on completed) keeps rendering instead of getting a null
      // transaction. Excludes only the cold terminal states (refunded,
      // cancelled) and refund_in_progress, which carry no tracking surface.
      const allowedStatuses = [
        'pending_payment',
        'meetup_pending',
        'meetup_confirmed',
        'meetup_completed',
        'paid',
        'label_created',
        'shipped',
        'delivered',
        'completed',
        'delivery_failed',
        'lost',
        'disputed',
      ] as const;
      const transactionsRef = collection(firestore, 'transactions');
      const buyerQuery = query(
        transactionsRef,
        where('buyerId', '==', userId),
        where('chatId', '==', chatId),
        where('status', 'in', allowedStatuses as unknown as string[])
      );
      const sellerQuery = query(
        transactionsRef,
        where('sellerId', '==', userId),
        where('chatId', '==', chatId),
        where('status', 'in', allowedStatuses as unknown as string[])
      );

      const [buyerSnap, sellerSnap] = await Promise.all([
        getDocs(buyerQuery),
        getDocs(sellerQuery),
      ]);

      const docs = [...buyerSnap.docs, ...sellerSnap.docs];
      if (docs.length === 0) return null;

      // Pick the most recent
      const sorted = docs
        .map((d) => mapTransaction(d.id, d.data()))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return sorted[0];
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de la transaction: ${error.message}`);
    }
  }

  /**
   * Update transaction status.
   *
   * SECURITY: 'cancelled' goes through a Cloud Function that re-checks
   * caller identity and current status. 'paid' / 'shipped' / 'delivered'
   * are written by Cloud Functions (stripeWebhook, checkTrackingStatus)
   * and should not be set from the client. Other statuses still go via
   * direct Firestore update.
   */
  static async updateTransactionStatus(
    transactionId: string,
    status: Transaction['status'],
    additionalData?: Partial<Transaction>
  ): Promise<void> {
    try {
      if (status === 'cancelled') {
        const callable = httpsCallable<
          { transactionId: string },
          { success: boolean }
        >(functions, 'cancelPendingTransaction');
        await callable({ transactionId });
        return;
      }

      const transactionRef = doc(firestore, 'transactions', transactionId);

      const updateData: any = {
        status,
      };

      // Add timestamp based on status
      if (status === 'paid') {
        updateData.paidAt = serverTimestamp();
      } else if (status === 'shipped') {
        updateData.shippedAt = serverTimestamp();
      } else if (status === 'delivered') {
        updateData.deliveredAt = serverTimestamp();
      } else if (status === 'meetup_confirmed') {
        updateData.meetupConfirmedAt = serverTimestamp();
      } else if (status === 'meetup_completed') {
        updateData.meetupCompletedAt = serverTimestamp();
      }

      // Add any additional data
      if (additionalData) {
        Object.assign(updateData, additionalData);
      }

      await updateDoc(transactionRef, updateData);
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise à jour de la transaction: ${error.message}`);
    }
  }

  /**
   * @deprecated Server-side only — handled by stripeWebhook Cloud Function.
   * Stub throws to surface any straggling caller instead of silently
   * hitting Firestore permission-denied (the transactions rule rejects
   * client status='paid' updates).
   */
  static async updatePaymentInfo(
    _transactionId: string,
    _paymentIntentId: string
  ): Promise<void> {
    throw new Error(
      'TransactionService.updatePaymentInfo is server-side only ' +
        '(handled by stripeWebhook Cloud Function).'
    );
  }

  /**
   * @deprecated Server-side only — handled by stripeWebhook (label
   * generation + status='shipped').
   */
  static async updateShippingInfo(
    _transactionId: string,
    _intelcomBookingId: string,
    _shippingLabelUrl: string,
    _trackingNumber: string,
    _trackingUrl?: string
  ): Promise<void> {
    throw new Error(
      'TransactionService.updateShippingInfo is server-side only ' +
        '(handled by stripeWebhook Cloud Function).'
    );
  }

  /**
   * @deprecated Server-side only — handled by checkTrackingStatus
   * Cloud Function (which marks status='delivered' atomically).
   */
  static async updateTrackingStatus(
    _transactionId: string,
    _trackingStatus: string
  ): Promise<void> {
    throw new Error(
      'TransactionService.updateTrackingStatus is server-side only ' +
        '(handled by checkTrackingStatus Cloud Function).'
    );
  }

  /**
   * Get active (non-finalized) transactions for a user.
   *
   * Used to block account deletion when the user has a pending order, an open
   * dispute, or delivered funds still inside the 7-day held window.
   *
   * Active statuses (P1):
   *   - pending_payment, meetup_pending, meetup_confirmed, paid, shipped
   *   - disputed           → a litige in progress must never be abandoned by
   *                          deleting an account.
   *   - delivered          → funds are held for a 7-day dispute window
   *                          (heldBalance, transaction.fundsReleaseAt). A
   *                          delivered transaction is only FINALIZED once funds
   *                          are released, so it counts as active until then.
   *
   * Firestore does not support OR on different fields, so we run two queries
   * (buyer-side + seller-side) and merge. `delivered` cannot be range-filtered
   * on `fundsReleaseAt` inside the same `in` query, so we post-filter delivered
   * rows: a delivered transaction is considered finalized (NOT active) only when
   * its funds have been released (`fundsReleasedAt` set) OR its release time
   * (`fundsReleaseAt`) is already past.
   */
  static async getActiveTransactionsForUser(userId: string): Promise<Transaction[]> {
    const activeStatuses: TransactionStatus[] = [
      'pending_payment',
      'meetup_pending',
      'meetup_confirmed',
      'paid',
      'shipped',
      'disputed',
      'delivered',
    ];

    const transactionsRef = collection(firestore, 'transactions');

    const buyerQuery = query(
      transactionsRef,
      where('buyerId', '==', userId),
      where('status', 'in', activeStatuses)
    );

    const sellerQuery = query(
      transactionsRef,
      where('sellerId', '==', userId),
      where('status', 'in', activeStatuses)
    );

    const [buyerSnap, sellerSnap] = await Promise.all([
      getDocs(buyerQuery),
      getDocs(sellerQuery),
    ]);

    const now = Date.now();
    const seen = new Set<string>();
    const transactions: Transaction[] = [];

    for (const d of [...buyerSnap.docs, ...sellerSnap.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() as Record<string, any>;

      // `delivered` is only "active" while funds are still held (within the
      // 7-day dispute window). Once released, the transaction is finalized and
      // must NOT block deletion.
      if (data?.status === 'delivered') {
        const fundsReleased = !!data.fundsReleasedAt;
        const releaseAtMs =
          typeof data.fundsReleaseAt?.toDate === 'function'
            ? data.fundsReleaseAt.toDate().getTime()
            : null;
        const releasePast = releaseAtMs != null && releaseAtMs <= now;
        if (fundsReleased || releasePast) {
          continue; // finalized — skip
        }
      }

      transactions.push({
        id: d.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        paidAt: data?.paidAt?.toDate(),
        shippedAt: data?.shippedAt?.toDate(),
        deliveredAt: data?.deliveredAt?.toDate(),
      } as Transaction);
    }

    return transactions;
  }

  /**
   * Get all transactions for a user (buyer or seller)
   */
  static async getUserTransactions(userId: string): Promise<Transaction[]> {
    try {
      const transactionsRef = collection(firestore, 'transactions');
      
      // Get transactions where user is buyer
      const buyerQuery = query(
        transactionsRef,
        where('buyerId', '==', userId)
      );
      
      // Get transactions where user is seller
      const sellerQuery = query(
        transactionsRef,
        where('sellerId', '==', userId)
      );

      const [buyerSnapshot, sellerSnapshot] = await Promise.all([
        getDocs(buyerQuery),
        getDocs(sellerQuery),
      ]);

      const transactions: Transaction[] = [];

      buyerSnapshot.forEach((doc) => {
        const data = doc.data();
        transactions.push({
          id: doc.id,
          ...data,
          createdAt: data?.createdAt?.toDate() || new Date(),
          paidAt: data?.paidAt?.toDate(),
          shippedAt: data?.shippedAt?.toDate(),
          deliveredAt: data?.deliveredAt?.toDate(),
        } as Transaction);
      });

      sellerSnapshot.forEach((doc) => {
        const data = doc.data();
        transactions.push({
          id: doc.id,
          ...data,
          createdAt: data?.createdAt?.toDate() || new Date(),
          paidAt: data?.paidAt?.toDate(),
          shippedAt: data?.shippedAt?.toDate(),
          deliveredAt: data?.deliveredAt?.toDate(),
        } as Transaction);
      });

      // Sort by creation date (most recent first)
      return transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des transactions: ${error.message}`);
    }
  }
}

