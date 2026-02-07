import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { ShippingAddress, Transaction } from '../types';

export class TransactionService {
  /**
   * Create a new transaction after offer acceptance
   */
  static async createTransaction(
    articleId: string,
    buyerId: string,
    sellerId: string,
    amount: number,
    shippingCost: number,
    shippingAddress: ShippingAddress,
    chatId?: string
  ): Promise<string> {
    try {
      const totalAmount = amount + shippingCost;

      const transactionData: any = {
        articleId,
        buyerId,
        sellerId,
        amount,
        shippingCost,
        totalAmount,
        status: 'pending_payment',
        shippingAddress,
        createdAt: serverTimestamp(),
      };

      // Add chatId if provided
      if (chatId) {
        transactionData.chatId = chatId;
      }

      const transactionsRef = collection(firestore, 'transactions');
      const docRef = await addDoc(transactionsRef, transactionData);

      return docRef.id;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création de la transaction: ${error.message}`);
    }
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

      const data = transactionDoc.data();
      return {
        id: transactionDoc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        paidAt: data?.paidAt?.toDate(),
        shippedAt: data?.shippedAt?.toDate(),
        deliveredAt: data?.deliveredAt?.toDate(),
      } as Transaction;
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de la transaction: ${error.message}`);
    }
  }

  /**
   * Get transaction by chat ID
   */
  static async getTransactionByChat(chatId: string): Promise<Transaction | null> {
    try {
      // Query transactions by chatId only (secure and efficient)
      const transactionsRef = collection(firestore, 'transactions');
      const q = query(
        transactionsRef,
        where('chatId', '==', chatId),
        where('status', 'in', ['pending_payment', 'paid', 'shipped', 'delivered'])
      );

      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        // No transaction found for this chat
        console.log('[TransactionService] No transaction found for chatId:', chatId);
        return null;
      }

      // Return the most recent transaction
      const transactionDoc = querySnapshot.docs[0];
      const data = transactionDoc.data();

      return {
        id: transactionDoc.id,
        ...data,
        createdAt: data?.createdAt?.toDate() || new Date(),
        paidAt: data?.paidAt?.toDate(),
        shippedAt: data?.shippedAt?.toDate(),
        deliveredAt: data?.deliveredAt?.toDate(),
      } as Transaction;
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de la transaction: ${error.message}`);
    }
  }

  /**
   * Update transaction status
   */
  static async updateTransactionStatus(
    transactionId: string,
    status: Transaction['status'],
    additionalData?: Partial<Transaction>
  ): Promise<void> {
    try {
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
   * Update payment information
   */
  static async updatePaymentInfo(
    transactionId: string,
    paymentIntentId: string
  ): Promise<void> {
    try {
      const transactionRef = doc(firestore, 'transactions', transactionId);
      
      await updateDoc(transactionRef, {
        paymentIntentId,
        status: 'paid',
        paidAt: serverTimestamp(),
      });
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise à jour du paiement: ${error.message}`);
    }
  }

  /**
   * Update shipping information
   */
  static async updateShippingInfo(
    transactionId: string,
    shippoTransactionId: string,
    shippingLabelUrl: string,
    trackingNumber: string,
    trackingUrl?: string
  ): Promise<void> {
    try {
      const transactionRef = doc(firestore, 'transactions', transactionId);
      
      await updateDoc(transactionRef, {
        shippoTransactionId,
        shippingLabelUrl,
        trackingNumber,
        trackingUrl: trackingUrl || '',
        trackingStatus: 'TRANSIT',
        status: 'shipped',
        shippedAt: serverTimestamp(),
      });
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise à jour des informations d'expédition: ${error.message}`);
    }
  }

  /**
   * Update tracking status
   */
  static async updateTrackingStatus(
    transactionId: string,
    trackingStatus: string
  ): Promise<void> {
    try {
      const transactionRef = doc(firestore, 'transactions', transactionId);
      
      const updateData: any = {
        trackingStatus,
      };

      // If delivered, update status and timestamp
      if (trackingStatus === 'DELIVERED') {
        updateData.status = 'delivered';
        updateData.deliveredAt = serverTimestamp();
      }

      await updateDoc(transactionRef, updateData);
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise à jour du statut de suivi: ${error.message}`);
    }
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

