/** Gross sale exposure includes debt repaid; only the net credit enters escrow.
 * Legacy transactions can be resolved from their server-owned repayment ledger.
 */
export async function sellerPendingCreditCents(
  tx: FirebaseFirestore.Transaction,
  walletRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<number> {
  const gross = typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;
  if (typeof data.sellerPendingCreditCents === 'number') {
    return Math.max(0, Math.min(gross, data.sellerPendingCreditCents));
  }
  if (typeof data.sellerDebtRepaidCents === 'number') {
    return Math.max(0, gross - data.sellerDebtRepaidCents);
  }
  const ledger = await tx.get(walletRef.collection('ledger').where('transactionId', '==', transactionId));
  const debtRepaid = ledger.docs.reduce((sum, entry) => {
    const d = entry.data();
    return d.type === 'debt_repayment' && d.description === 'Vente — régularisation du solde dû' &&
      typeof d.amount === 'number' ? sum + Math.max(0, d.amount) : sum;
  }, 0);
  return Math.max(0, gross - debtRepaid);
}
