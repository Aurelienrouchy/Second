/** Structural observation only. No unknown amount is replaced with zero;
 * absence of a breach never reconciles a ledger or provider statement. */
const BUCKETS = ['balance', 'pendingBalance', 'heldBalance', 'sellerDebt'] as const;
type Bucket = typeof BUCKETS[number];
export function inspectWalletInvariants(data: Record<string, unknown>) {
  const amounts: Record<Bucket, number | null> = {balance:null,pendingBalance:null,heldBalance:null,sellerDebt:null};
  const breaches: string[] = [], notRecordedFields: string[] = [], missingRequiredFields: string[] = [];
  let negativeObserved = false;
  for (const field of BUCKETS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      notRecordedFields.push(field);
      // Native writers historically create the hold/debt buckets lazily.
      // Their absence is neither a structural breach nor a proven zero.
      if (field === 'balance' || field === 'pendingBalance') missingRequiredFields.push(field);
      continue;
    }
    const value = data[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      breaches.push(`${field}_invalid_cents`); continue;
    }
    amounts[field] = value;
    if (value < 0) { breaches.push(`${field}_negative`); negativeObserved = true; }
  }
  const currencyRecorded = Object.prototype.hasOwnProperty.call(data, 'currency');
  const currencyQualified = typeof data.currency === 'string' && data.currency.toUpperCase() === 'CAD';
  if (!currencyRecorded) {notRecordedFields.push('currency');missingRequiredFields.push('currency');}
  else if (!currencyQualified) breaches.push('currency_unqualified');
  return {protocol:'wallet_invariant_scan_v1' as const,
    invariantQualification:negativeObserved ? 'breach_observed' as const : breaches.length ? 'structural_anomaly' as const :
      notRecordedFields.length ? 'not_fully_recorded' as const : 'no_breach_observed' as const,
    requiresReview:breaches.length > 0 || missingRequiredFields.length > 0,
    alertSeverity:breaches.length ? 'critical' as const : missingRequiredFields.length ? 'warning' as const : null,
    breaches, notRecordedFields, missingRequiredFields, ...amounts, currency:currencyQualified ? 'CAD' as const : null,
    amountUnit:'cents' as const, ledgerReconciled:false as const, providerReconciled:false as const,
    financialEffectAuthorized:false as const, unknownAmountsReplacedWithZero:false as const};
}
