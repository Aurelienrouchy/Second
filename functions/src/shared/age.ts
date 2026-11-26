/** Shared civil calendar policy. Registration/catalogue is separate from new trading. */
export const MIN_AGE_REGISTER = 16;
export const MIN_AGE_BUY = 18;
export const MIN_AGE_SELL = 18;
export const ELIGIBILITY_TIME_ZONE = 'America/Toronto';

export interface CivilDate { year: number; month: number; day: number; }

export function parseCivilIsoDate(value: unknown): CivilDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day); probe.setUTCHours(0, 0, 0, 0);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
    ? { year, month, day } : null;
}

/** Québec civil day regardless of the server/phone calendar or DST. */
export function quebecCivilDate(now: Date = new Date()): string | null {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ELIGIBILITY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  const result = `${part('year')}-${part('month')}-${part('day')}`;
  return parseCivilIsoDate(result) ? result : null;
}

/** Whole years on an explicit civil date. Future DOB and malformed proof fail closed.
 * Feb29 reaches its birthday on Mar1 in a non-leap year, preserving consent's policy. */
export function ageAtCivilDate(value: unknown, todayIso: unknown): number | null {
  const birth = parseCivilIsoDate(value), today = parseCivilIsoDate(todayIso);
  if (!birth || !today || typeof value !== 'string' || typeof todayIso !== 'string' || value > todayIso) return null;
  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) age--;
  return age;
}

/** Civil-day deadline data for the operator; not an automatic admission/decision. */
export function civilDateAfterDays(iso: string, days: number): string | null {
  const date = parseCivilIsoDate(iso);
  if (!date || !Number.isSafeInteger(days)) return null;
  const shifted = new Date(0);
  shifted.setUTCFullYear(date.year, date.month - 1, date.day + days);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.toISOString().substring(0, 10);
}

/** Âge en années révolues aujourd'hui, `null` si la date est absente ou invalide. */
export function ageFromIsoDate(value: unknown, today: Date = new Date()): number | null {
  return ageAtCivilDate(value, quebecCivilDate(today));
}

/** Vrai si la date de naissance donne 18 ans révolus. */
export function isOldEnoughToSell(dateOfBirth: unknown, now: Date = new Date()): boolean {
  const age = ageFromIsoDate(dateOfBirth, now);
  return age !== null && age >= MIN_AGE_SELL;
}

export function isOldEnoughToBuy(dateOfBirth: unknown, now: Date = new Date()): boolean {
  const age = ageFromIsoDate(dateOfBirth, now);
  return age !== null && age >= MIN_AGE_BUY;
}
