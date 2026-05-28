/**
 * Wallet Service — Seconde
 *
 * All functions delegate to Cloud Functions (callable).
 * Amounts from the backend are in cents; the service returns raw data
 * and leaves formatting to the UI layer.
 */

import { httpsCallable } from 'firebase/functions';

import { functions } from '@/config/firebaseConfig';
import type { WalletInfo } from '@/types';

// =============================================================================
// RESPONSE TYPES (Cloud Function return shapes)
// =============================================================================

interface ActivateWalletResponse {
  success: boolean;
  balance: number;
  status: string;
}

interface WithdrawResponse {
  success: boolean;
  newBalance: number;
}

interface PayWithWalletResponse {
  success: boolean;
  newBalance: number;
}

// =============================================================================
// SERVICE
// =============================================================================

export class WalletService {
  /**
   * Fetch wallet info for the authenticated user.
   * Returns hasWallet: false if the user has not activated their wallet.
   */
  static async getWalletInfo(): Promise<WalletInfo> {
    const callable = httpsCallable<Record<string, never>, WalletInfo>(
      functions,
      'getWalletInfo',
    );
    const { data } = await callable({});
    return data;
  }

  /**
   * Activate the wallet for the authenticated user.
   */
  static async activateWallet(): Promise<{ success: boolean }> {
    const callable = httpsCallable<Record<string, never>, ActivateWalletResponse>(
      functions,
      'activateWallet',
    );
    const { data } = await callable({});
    return { success: data.success };
  }

  /**
   * Withdraw funds from the wallet to the user's Stripe Connect bank account.
   * @param amount Amount in cents
   */
  static async withdrawFromWallet(
    amount: number,
  ): Promise<{ success: boolean; newBalance: number }> {
    const callable = httpsCallable<{ amount: number }, WithdrawResponse>(
      functions,
      'walletWithdraw',
    );
    const { data } = await callable({ amount });
    return { success: data.success, newBalance: data.newBalance };
  }

  /**
   * Pay for a transaction using 100% wallet balance.
   * @param transactionId The transaction to pay for
   */
  static async payWithWallet(
    transactionId: string,
  ): Promise<{ success: boolean; newBalance: number }> {
    const callable = httpsCallable<{ transactionId: string }, PayWithWalletResponse>(
      functions,
      'payWithWallet',
    );
    const { data } = await callable({ transactionId });
    return { success: data.success, newBalance: data.newBalance };
  }
}
