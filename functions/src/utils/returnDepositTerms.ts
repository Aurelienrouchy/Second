/** Accepted terms for NEW return quotes; never inferred for historic labels. */
export const RETURN_DEPOSIT_TERMS = {
  protocol: 'return_deposit_terms_v1', calendarDays: 7, timeZone: 'America/Toronto',
  clockBasis: 'first_native_document_availability', timeOfDay: 'same_local_time',
  ambiguousOrMissingLocalTime: 'human_review', motivatedExtension: true,
  elapsedTimeDecidesFault: false, financialEffectAuthorized: false,
} as const;
const formatter = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Toronto', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
function localParts(ms: number) {
  const p = formatter.formatToParts(new Date(ms)), part = (name: string) => Number(p.find(v => v.type === name)?.value);
  return [part('year'), part('month'), part('day'), part('hour'), part('minute'), part('second')];
}
/** Add civil dates, preserving Québec wall-clock time and milliseconds.
 * Test all contemporary Toronto offsets; ambiguity/gaps never silently choose
 * a side. This is documentary timing, never permission to release/refund. */
export function returnDepositCalendarDeadline(availableAtMs: number): number | null {
  if (!Number.isSafeInteger(availableAtMs) || availableAtMs < Date.UTC(2000, 0, 1) || availableAtMs > Date.UTC(2100, 0, 1)) return null;
  const [y, m, d, h, min, sec] = localParts(availableAtMs);
  const shifted = new Date(Date.UTC(y, m - 1, d + 7, h, min, sec, availableAtMs % 1000));
  const target = [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), h, min, sec];
  const nominal = shifted.getTime(), candidates = [nominal + 4 * 3_600_000, nominal + 5 * 3_600_000]
    .filter(candidate => localParts(candidate).every((value, i) => value === target[i]));
  return candidates.length === 1 ? candidates[0] : null;
}
