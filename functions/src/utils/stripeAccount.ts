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
 * Persist only stripeAccountFirestoreFields(state), whose concrete values
 * never include undefined. Verification errors and pending fields are private
 * owner transport and must not be written to the public user document.
 */

export type StripeAccountStatus =
  | 'active'
  | 'partially_active'
  | 'pending_verification'
  | 'restricted'
  | 'pending';

/** Owner-only transport. Never copy provider prose or persist on public users. */
export interface StripeVerificationError {
  code: string;
  requirement: string | null;
}

export interface StripeAccountState {
  status: StripeAccountStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  /** Private callable fields, excluded from stripeAccountFirestoreFields. */
  verificationErrors: StripeVerificationError[];
  requirementsPendingVerification: string[];
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

/** New-charge guard only. A pending verification is not itself a rejection if
 * Stripe actually permits charges. Payout readiness is a separate permission. */
export function hasUnrestrictedStripeChargeCapability(state: {
  chargesEnabled: unknown; status: unknown; disabledReason: unknown; requirementsPastDue: unknown;
}): boolean {
  return state.chargesEnabled === true && typeof state.status === 'string' &&
    ['active', 'partially_active', 'pending_verification', 'pending'].includes(state.status) &&
    (state.disabledReason === null || state.disabledReason === 'requirements.pending_verification') &&
    Array.isArray(state.requirementsPastDue) && state.requirementsPastDue.length === 0;
}

function requirementKey(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 255 &&
    /^(?:individual|company|business_profile|external_account|tos_acceptance|settings|documents|person_[A-Za-z0-9]+)(?:\.[a-z0-9_]+)*$/.test(value)
    ? value : null;
}

function verificationErrors(value: unknown): StripeVerificationError[] {
  if (!Array.isArray(value)) return [];
  const errors: StripeVerificationError[] = [], seen = new Set<string>();
  for (const error of value) {
    if (!error || typeof error !== 'object' || Array.isArray(error)) continue;
    const code = typeof error.code === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(error.code)
      ? error.code : 'unknown_verification_error';
    const requirement = requirementKey(error.requirement), key = JSON.stringify([code, requirement]);
    if (seen.has(key)) continue;
    seen.add(key); errors.push({ code, requirement });
    if (errors.length === 20) break;
  }
  return errors;
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
  const ownerVerificationErrors = verificationErrors(requirements.errors);
  const requirementsPendingVerification = [...new Set(toStringArray(requirements.pending_verification)
    .map(requirementKey).filter((key): key is string => key !== null))].slice(0, 50);
  const disabledReason =
    typeof requirements.disabled_reason === 'string' ? requirements.disabled_reason : null;
  const currentDeadline =
    typeof requirements.current_deadline === 'number' ? requirements.current_deadline : null;

  const externalAccounts = account?.external_accounts?.data;
  const hasExternalAccount = Array.isArray(externalAccounts) && externalAccounts.some((e: any) => e?.object === 'bank_account' && e.country === 'CA' && e.currency === 'cad');
  const defaultBank = hasExternalAccount
    ? externalAccounts.find((e: any) => e?.object === 'bank_account' && e.country === 'CA' && e.currency === 'cad' && e.default_for_currency === true)
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
  if ((disabledReason && disabledReason !== 'requirements.pending_verification') || requirementsPastDue.length > 0) {
    status = 'restricted';
  } else if (disabledReason === 'requirements.pending_verification') {
    status = 'pending_verification';
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
    verificationErrors: ownerVerificationErrors,
    requirementsPendingVerification,
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
