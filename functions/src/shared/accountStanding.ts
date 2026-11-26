/** New-operation admission only. An absent legacy field keeps its existing
 * compatibility; a present value must be exactly true. Missing user documents
 * remain the responsibility of the caller's existing evidence/existence checks.
 * Never normalize or write an active status when reading an old source. */
export function hasUnavailableAccountStanding(user: Record<string, unknown> | null | undefined): boolean {
  return user != null && Object.prototype.hasOwnProperty.call(user, 'isActive') && user.isActive !== true;
}
