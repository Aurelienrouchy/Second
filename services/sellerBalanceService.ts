import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestore, functions } from '../config/firebaseConfig';
import { SellerBalance } from '../types';

export class SellerBalanceService {
  /**
   * Get seller balance.
   *
   * If the balance doc doesn't exist yet (the seller has never received
   * a payment), return an in-memory zero balance. The doc itself will be
   * created server-side by the stripeWebhook Cloud Function on the first
   * sale — the client cannot write to seller_balances anymore.
   */
  static async getBalance(userId: string): Promise<SellerBalance> {
    try {
      const balanceRef = doc(firestore, 'seller_balances', userId);
      const balanceDoc = await getDoc(balanceRef);

      if (!balanceDoc.exists()) {
        return {
          userId,
          availableBalance: 0,
          pendingBalance: 0,
          totalEarnings: 0,
          transactions: [],
          updatedAt: new Date(),
        };
      }

      const data = balanceDoc.data();
      return {
        userId,
        availableBalance: data?.availableBalance || 0,
        pendingBalance: data?.pendingBalance || 0,
        totalEarnings: data?.totalEarnings || 0,
        transactions: (data?.transactions || []).map((t: any) => ({
          ...t,
          createdAt: t.createdAt?.toDate() || new Date(),
        })),
        updatedAt: data?.updatedAt?.toDate() || new Date(),
      };
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de la balance: ${error.message}`);
    }
  }

  /**
   * @deprecated Server-side only — use the stripeWebhook Cloud Function.
   *
   * Kept as a stub so any straggling caller fails loudly instead of
   * silently hitting Firestore permission-denied (the seller_balances
   * collection now refuses all client writes).
   */
  static async addPendingAmount(
    _userId: string,
    _amount: number,
    _transactionId: string,
    _description: string
  ): Promise<void> {
    throw new Error(
      'SellerBalanceService.addPendingAmount is server-side only ' +
        '(handled by stripeWebhook Cloud Function).'
    );
  }

  /**
   * @deprecated Server-side only — use the checkTrackingStatus Cloud Function.
   */
  static async movePendingToAvailable(
    _userId: string,
    _amount: number,
    _transactionId: string
  ): Promise<void> {
    throw new Error(
      'SellerBalanceService.movePendingToAvailable is server-side only ' +
        '(handled by checkTrackingStatus Cloud Function).'
    );
  }

  /**
   * Request withdrawal — delegates to a Cloud Function so the balance
   * check + debit happen atomically server-side.
   *
   * The userId argument is kept for backwards compatibility but is
   * ignored: the CF derives it from request.auth.uid.
   */
  static async requestWithdrawal(
    _userId: string,
    amount: number,
    bankAccount: string
  ): Promise<string> {
    try {
      const callable = httpsCallable<
        { amount: number; bankAccount: string },
        { success: boolean; withdrawalId: string }
      >(functions, 'requestWithdrawal');
      const { data } = await callable({ amount, bankAccount });
      return data.withdrawalId;
    } catch (error: any) {
      throw new Error(
        `Erreur lors de la demande de retrait: ${error.message ?? error}`
      );
    }
  }

  /**
   * @deprecated Server-side only — admin processing should run as a
   * Cloud Function (Admin SDK) so refunds happen atomically and the
   * action is auditable.
   */
  static async updateWithdrawalStatus(
    _userId: string,
    _withdrawalId: string,
    _status: 'completed' | 'failed'
  ): Promise<void> {
    throw new Error(
      'SellerBalanceService.updateWithdrawalStatus is server-side only.'
    );
  }

  /**
   * Get withdrawal history for a user
   */
  static async getWithdrawalHistory(userId: string): Promise<SellerBalance['transactions']> {
    try {
      const balance = await this.getBalance(userId);
      return balance.transactions.filter(t => t.type === 'withdrawal');
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de l'historique: ${error.message}`);
    }
  }

  /**
   * Get sales history for a user
   */
  static async getSalesHistory(userId: string): Promise<SellerBalance['transactions']> {
    try {
      const balance = await this.getBalance(userId);
      return balance.transactions.filter(t => t.type === 'sale');
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de l'historique des ventes: ${error.message}`);
    }
  }
}

