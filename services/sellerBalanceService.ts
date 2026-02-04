import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  increment,
} from '@react-native-firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { SellerBalance } from '../types';

export class SellerBalanceService {
  /**
   * Get seller balance
   */
  static async getBalance(userId: string): Promise<SellerBalance> {
    try {
      const balanceRef = doc(firestore, 'seller_balances', userId);
      const balanceDoc = await getDoc(balanceRef);

      if (!balanceDoc.exists()) {
        // Create initial balance if doesn't exist
        const initialBalance: SellerBalance = {
          userId,
          availableBalance: 0,
          pendingBalance: 0,
          totalEarnings: 0,
          transactions: [],
          updatedAt: new Date(),
        };

        await setDoc(balanceRef, {
          ...initialBalance,
          updatedAt: serverTimestamp(),
        });

        return initialBalance;
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
   * Add amount to pending balance (when payment is made)
   */
  static async addPendingAmount(
    userId: string,
    amount: number,
    transactionId: string,
    description: string
  ): Promise<void> {
    try {
      const balanceRef = doc(firestore, 'seller_balances', userId);
      const balanceDoc = await getDoc(balanceRef);

      const transaction = {
        id: transactionId,
        type: 'sale' as const,
        amount,
        description,
        createdAt: serverTimestamp(),
        status: 'pending' as const,
      };

      if (!balanceDoc.exists()) {
        // Create new balance document
        await setDoc(balanceRef, {
          userId,
          availableBalance: 0,
          pendingBalance: amount,
          totalEarnings: 0,
          transactions: [transaction],
          updatedAt: serverTimestamp(),
        });
      } else {
        // Update existing balance
        await updateDoc(balanceRef, {
          pendingBalance: increment(amount),
          transactions: arrayUnion(transaction),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error: any) {
      throw new Error(`Erreur lors de l'ajout du montant en attente: ${error.message}`);
    }
  }

  /**
   * Move amount from pending to available (when item is delivered)
   */
  static async movePendingToAvailable(
    userId: string,
    amount: number,
    transactionId: string
  ): Promise<void> {
    try {
      const balanceRef = doc(firestore, 'seller_balances', userId);
      const balanceDoc = await getDoc(balanceRef);

      if (!balanceDoc.exists()) {
        throw new Error('Balance not found');
      }

      const currentData = balanceDoc.data();
      const transactions = currentData?.transactions || [];

      // Update the transaction status to completed
      const updatedTransactions = transactions.map((t: any) => {
        if (t.id === transactionId) {
          return {
            ...t,
            status: 'completed',
          };
        }
        return t;
      });

      await updateDoc(balanceRef, {
        pendingBalance: increment(-amount),
        availableBalance: increment(amount),
        totalEarnings: increment(amount),
        transactions: updatedTransactions,
        updatedAt: serverTimestamp(),
      });
    } catch (error: any) {
      throw new Error(`Erreur lors du transfert du montant: ${error.message}`);
    }
  }

  /**
   * Request withdrawal (creates a withdrawal transaction entry)
   */
  static async requestWithdrawal(
    userId: string,
    amount: number,
    iban: string
  ): Promise<string> {
    try {
      const balanceRef = doc(firestore, 'seller_balances', userId);
      const balanceDoc = await getDoc(balanceRef);

      if (!balanceDoc.exists()) {
        throw new Error('Balance not found');
      }

      const currentData = balanceDoc.data();
      const availableBalance = currentData?.availableBalance || 0;

      if (availableBalance < amount) {
        throw new Error('Solde insuffisant pour ce retrait');
      }

      const withdrawalId = `withdrawal_${Date.now()}`;
      const withdrawalTransaction = {
        id: withdrawalId,
        type: 'withdrawal' as const,
        amount: -amount, // Negative for withdrawal
        description: `Retrait vers ${iban.slice(-4)}`,
        createdAt: serverTimestamp(),
        status: 'pending' as const,
      };

      const transactions = currentData?.transactions || [];

      await updateDoc(balanceRef, {
        availableBalance: increment(-amount),
        transactions: [...transactions, withdrawalTransaction],
        updatedAt: serverTimestamp(),
      });

      return withdrawalId;
    } catch (error: any) {
      throw new Error(`Erreur lors de la demande de retrait: ${error.message}`);
    }
  }

  /**
   * Update withdrawal status (called by admin after processing)
   */
  static async updateWithdrawalStatus(
    userId: string,
    withdrawalId: string,
    status: 'completed' | 'failed'
  ): Promise<void> {
    try {
      const balanceRef = doc(firestore, 'seller_balances', userId);
      const balanceDoc = await getDoc(balanceRef);

      if (!balanceDoc.exists()) {
        throw new Error('Balance not found');
      }

      const currentData = balanceDoc.data();
      const transactions = currentData?.transactions || [];

      // Find and update the withdrawal transaction
      const updatedTransactions = transactions.map((t: any) => {
        if (t.id === withdrawalId) {
          return {
            ...t,
            status,
          };
        }
        return t;
      });

      const updateData: any = {
        transactions: updatedTransactions,
        updatedAt: serverTimestamp(),
      };

      // If withdrawal failed, refund the amount to available balance
      if (status === 'failed') {
        const withdrawalTransaction = transactions.find((t: any) => t.id === withdrawalId);
        if (withdrawalTransaction) {
          updateData.availableBalance = increment(Math.abs(withdrawalTransaction.amount));
        }
      }

      await updateDoc(balanceRef, updateData);
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise à jour du retrait: ${error.message}`);
    }
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

