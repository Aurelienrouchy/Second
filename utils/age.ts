/**
 * Age gating — shared contract with the backend (functions/src/callable/consent.ts).
 *
 * Date of birth is stored as an ISO calendar string "YYYY-MM-DD" (no Date,
 * no timezone) to avoid fuseau drift. Age is computed against the *local*
 * calendar day, which is what a user means by "how old am I today".
 */

/** Minimum age to register / buy / browse. */
export const MIN_AGE_REGISTER = 16;

/** Minimum age to sell (Stripe Connect payout account requirement). */
export const MIN_AGE_SELL = 18;

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build an ISO "YYYY-MM-DD" string from numeric calendar parts.
 * Returns null if the parts do not form a real calendar date.
 */
export function toIsoDate(
  year: number,
  month: number,
  day: number,
): string | null {
  if (!isRealCalendarDate(year, month, day)) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Validate that year/month/day is a real calendar date in a sane range. */
export function isRealCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  const currentYear = new Date().getFullYear();
  if (year < 1900 || year > currentYear) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

/**
 * Compute age in completed years from an ISO "YYYY-MM-DD" string against
 * today's local calendar day. Returns null for malformed/invalid input.
 */
export function computeAgeFromIso(dateOfBirth: string): number | null {
  if (!ISO_DATE_REGEX.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split('-').map((p) => parseInt(p, 10));
  if (!isRealCalendarDate(year, month, day)) return null;

  const today = new Date();
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

/** True when the ISO date of birth corresponds to an age >= MIN_AGE_SELL. */
export function canSell(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const age = computeAgeFromIso(dateOfBirth);
  return age !== null && age >= MIN_AGE_SELL;
}
