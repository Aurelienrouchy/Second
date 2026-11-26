/** Gross sale exposure includes debt repaid; only the net credit enters escrow.
 * Legacy transactions can be resolved from their server-owned repayment ledger.
 */
import {readSellerAllocationConsumption} from './refundAllocation';
export async function sellerPendingCreditCents(
  tx: FirebaseFirestore.Transaction,
  walletRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  transactionId: string
): Promise<number> {
  const gross = typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;
  if (Object.prototype.hasOwnProperty.call(data, 'refundAllocationState')) {
    const consumed = await readSellerAllocationConsumption(tx, transactionId, data);
    const ledger = await tx.get(walletRef.collection('ledger').where('transactionId', '==', transactionId).limit(101));
    if (ledger.size >= 101) throw new Error('Sale refund allocation ledger coverage unknown');
    const originalNet = ledger.docs.reduce((n, row) => n + (row.data().type === 'sale_credit' ? row.data().amount : 0), 0);
    if (!Number.isSafeInteger(originalNet) || originalNet < 0 || originalNet > gross) throw new Error('Sale net credit source unknown');
    return Math.max(0, originalNet - consumed.sellerDebitCents);
  }
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


/** Only the amount actually moved for this sale may leave heldBalance.
 * A missing legacy movement record is not permission to release another sale.
 */
export async function sellerHeldCreditCents(
  tx: FirebaseFirestore.Transaction,
  walletRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData,
  transactionId: string,
  netCreditCents: number
): Promise<number | null> {
  if (Object.prototype.hasOwnProperty.call(data, 'refundAllocationState')) {
    const consumed = await readSellerAllocationConsumption(tx, transactionId, data);
    const ledger = await tx.get(walletRef.collection('ledger').where('transactionId', '==', transactionId).limit(101));
    if (ledger.size >= 101) return null;
    const moves = ledger.docs.filter(row => row.data().type === 'funds_held').map(row => row.data().amount);
    if (moves.length === 0) return netCreditCents === 0 ? 0 : null;
    if (moves.some(v => !Number.isSafeInteger(v) || v < 0)) return null;
    const moved = moves.reduce((n, v) => n + v, 0);
    return Math.min(netCreditCents, Math.max(0, moved - consumed.heldCents));
  }
  if (typeof data.sellerHeldCreditCents === 'number') {
    return Math.max(0, Math.min(netCreditCents, data.sellerHeldCreditCents));
  }
  const ledger = await tx.get(walletRef.collection('ledger').where('transactionId', '==', transactionId));
  const movements = ledger.docs.map(entry => entry.data()).filter(d => d.type === 'funds_held' && typeof d.amount === 'number');
  if (movements.length === 0) return netCreditCents === 0 ? 0 : null;
  const actualMoved = movements.reduce((sum, d) => sum + Math.max(0, d.amount), 0);
  return Math.max(0, Math.min(netCreditCents, actualMoved));
}
