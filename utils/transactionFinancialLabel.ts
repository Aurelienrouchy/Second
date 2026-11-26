import type { Transaction } from '@/types/transaction';
import { getRefundPresentation, hasBankObligation } from './refundPresentation';

/** A confirmed refund does not erase an independent banking case. */
export function getTransactionFinancialLabel(transaction: Transaction, perspective: 'buyer' | 'seller'): string | undefined {
  const refund = getRefundPresentation(transaction, perspective);
  const bank = hasBankObligation(transaction);
  if (!bank) return refund?.title;
  return refund ? `${refund.title} · Dossier bancaire à examiner` : 'Dossier bancaire à examiner';
}
