/** Absence is private, matching the privacy screen's initial choice. */
export function publicProfileImage(user: FirebaseFirestore.DocumentData | undefined | null): string | null {
  return user?.preferences?.privacy?.showProfilePhoto === true
    && typeof user.profileImage === 'string' ? user.profileImage : null;
}

/** A privacy tombstone cannot be republished by a stale projection writer. */
export function articlePrivacyWithdrawn(article: FirebaseFirestore.DocumentData | undefined): boolean {
  return !!article && Object.prototype.hasOwnProperty.call(article, 'privacyWithdrawal');
}
