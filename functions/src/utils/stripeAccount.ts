/**
 * Stripe Connect Custom account state — single source of truth for mapping a
 * Stripe `Account` object into the canonical `users/{uid}` fields and the
 * status string consumed by the app.
 *
 * White-label model: the seller never visits Stripe, so the app is the only
 * surface that can show KYC requirements and drive remediation. This helper
 * surfaces `requirements.*` (currently_due / past_due / disabled_reason /
 * current_deadline) that the legacy status derivation ignored (F59), in
 * addition to the charges/payouts/details booleans (F62/F117).
 *
 * "No undefined in Firestore": every field returned is a concrete value
 * (string | boolean | array | null) so it is always safe to pass to
 * update()/set() without `|| undefined`.
 */

export type StripeAccountStatus =
  | 'active'
  | 'partially_active'
  | 'pending_verification'
  | 'restricted'
  | 'pending';

export interface StripeAccountState {
  status: StripeAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  /** Stripe's machine reason payouts are disabled, or null when none. */
  disabledReason: string | null;
  /** Unix seconds (Stripe convention) for the next requirement deadline, or null. */
  currentDeadline: number | null;
  /** Last 4 of the default external bank account, or null when none attached. */
  bankAccountLast4: string | null;
  /** Stripe verification status of the default external account, or null. */
  bankAccountStatus: string | null;
  /** Whether at least one external (bank) account is attached. */
  hasExternalAccount: boolean;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Derive the canonical account state from a Stripe `Account`. Pure & deterministic.
 */
export function deriveStripeAccountState(account: any): StripeAccountState {
  const chargesEnabled = account?.charges_enabled === true;
  const payoutsEnabled = account?.payouts_enabled === true;
  const detailsSubmitted = account?.details_submitted === true;

  const requirements = account?.requirements ?? {};
  const requirementsCurrentlyDue = toStringArray(requirements.currently_due);
  const requirementsPastDue = toStringArray(requirements.past_due);
  const disabledReason =
    typeof requirements.disabled_reason === 'string' ? requirements.disabled_reason : null;
  const currentDeadline =
    typeof requirements.current_deadline === 'number' ? requirements.current_deadline : null;

  const externalAccounts = account?.external_accounts?.data;
  const hasExternalAccount = Array.isArray(externalAccounts) && externalAccounts.length > 0;
  const defaultBank = hasExternalAccount
    ? externalAccounts.find((e: any) => e?.default_for_currency === true) ?? externalAccounts[0]
    : null;
  const bankAccountLast4 =
    defaultBank && typeof defaultBank.last4 === 'string' ? defaultBank.last4 : null;
  const bankAccountStatus =
    defaultBank && typeof defaultBank.status === 'string' ? defaultBank.status : null;

  // Status precedence: a present disabled_reason / past_due requirement means
  // Stripe has actively restricted the account (KYC remediation required) even
  // when charges may still be enabled — surface 'restricted' so the app shows
  // the remediation path instead of a misleading "active" (F62/F117).
  let status: StripeAccountStatus;
  if (disabledReason || requirementsPastDue.length > 0) {
    status = 'restricted';
  } else if (chargesEnabled && payoutsEnabled) {
    status = 'active';
  } else if (chargesEnabled) {
    status = 'partially_active';
  } else if (detailsSubmitted) {
    status = 'pending_verification';
  } else {
    status = 'pending';
  }

  return {
    status,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    requirementsCurrentlyDue,
    requirementsPastDue,
    disabledReason,
    currentDeadline,
    bankAccountLast4,
    bankAccountStatus,
    hasExternalAccount,
  };
}

/**
 * Build the `users/{uid}` field map from an account state. All fields are
 * CF-only (locked in firestore.rules) and never undefined.
 */
export function stripeAccountFirestoreFields(
  state: StripeAccountState
): Record<string, unknown> {
  return {
    stripeAccountStatus: state.status,
    stripeChargesEnabled: state.chargesEnabled,
    stripePayoutsEnabled: state.payoutsEnabled,
    stripeDetailsSubmitted: state.detailsSubmitted,
    stripeRequirementsCurrentlyDue: state.requirementsCurrentlyDue,
    stripeRequirementsPastDue: state.requirementsPastDue,
    stripeRequirementsDisabledReason: state.disabledReason,
    stripeRequirementsCurrentDeadline: state.currentDeadline,
    ...(state.bankAccountLast4 !== null
      ? { stripeBankAccountLast4: state.bankAccountLast4 }
      : {}),
    ...(state.bankAccountStatus !== null
      ? { stripeBankAccountStatus: state.bankAccountStatus }
      : {}),
    ...(state.hasExternalAccount ? { stripeBankAccountAdded: true } : {}),
  };
}
