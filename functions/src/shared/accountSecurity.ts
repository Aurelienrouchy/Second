/** A security containment is independent of commercial standing/eligibility.
 * Every present marker is closed to NEW effects, including malformed/null data.
 * A persisted restoration marker is never sufficient to open this predicate.
 * Backend readers may return an ephemeral projection after joining the native
 * receipt, original containment and current Auth record in their transaction. */
const qualifiedProfiles = new WeakSet<object>();
/** Internal backend projection; no serializable field carries this authority. */
export function accountSecurityQualifiedProjection<T extends Record<string, unknown>>(profile: T): T {
  const projection = { ...profile };
  qualifiedProfiles.add(projection);
  return projection;
}
export function hasAccountSecurityBarrier(profile: Record<string, unknown> | null | undefined): boolean {
  return profile != null && (Object.prototype.hasOwnProperty.call(profile, 'accountSecurityBarrier') ||
    Object.prototype.hasOwnProperty.call(profile, 'accountSecurityRecovery')) && !qualifiedProfiles.has(profile);
}
