/**
 * callableError — map a Firebase httpsCallable error into a stable code +
 * an actionable FR message.
 *
 * `httpsCallable` wraps a server `HttpsError` into a `FirebaseError` whose
 * `code` is prefixed with `functions/` (e.g. `functions/resource-exhausted`).
 * The default `error.message` is the raw server text, which is often opaque
 * or, worse, surfaced under a misleading title ("Article indisponible") for a
 * rate-limit (`resource-exhausted`). This util lets callers distinguish the
 * Firebase error codes and pick the right copy.
 */

/** Bare Firebase functions error code, with the `functions/` prefix stripped. */
export type CallableErrorCode =
  | 'cancelled'
  | 'unknown'
  | 'invalid-argument'
  | 'deadline-exceeded'
  | 'not-found'
  | 'already-exists'
  | 'permission-denied'
  | 'unauthenticated'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'out-of-range'
  | 'unimplemented'
  | 'internal'
  | 'unavailable'
  | 'data-loss';

/**
 * Resolve a Firebase callable error into its bare code (no `functions/`
 * prefix). Returns null when the error is not a recognizable callable error.
 */
export function getCallableErrorCode(error: unknown): CallableErrorCode | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const raw = (error as { code?: unknown }).code;
    if (typeof raw === 'string') {
      const bare = raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
      return bare as CallableErrorCode;
    }
  }
  return null;
}

/** True when the callable failed because the user hit a rate limit. */
export function isRateLimitError(error: unknown): boolean {
  return getCallableErrorCode(error) === 'resource-exhausted';
}

/** Raw server message, when present, else a generic fallback. */
export function getCallableErrorMessage(error: unknown, fallback = 'Une erreur est survenue.'): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

interface MappedCallableError {
  title: string;
  message: string;
}

/**
 * Map a callable error into a user-facing { title, message }.
 *
 * @param error    The error thrown by an httpsCallable invocation.
 * @param fallback Title/message used when the code is unknown. Defaults to a
 *                 neutral "Action impossible" rather than a misleading domain
 *                 title (e.g. "Article indisponible").
 */
export function mapCallableError(
  error: unknown,
  fallback: MappedCallableError = {
    title: 'Action impossible',
    message: 'Une erreur est survenue. Veuillez réessayer.',
  },
): MappedCallableError {
  const code = getCallableErrorCode(error);

  switch (code) {
    case 'resource-exhausted':
      return {
        title: 'Trop de tentatives',
        message:
          'Vous avez effectué trop d’actions en peu de temps. Patientez quelques instants avant de réessayer.',
      };
    case 'permission-denied':
      return {
        title: 'Action non autorisée',
        message:
          'Vous n’avez pas l’autorisation d’effectuer cette action.',
      };
    case 'unauthenticated':
      return {
        title: 'Connexion requise',
        message: 'Connectez-vous pour continuer.',
      };
    case 'failed-precondition':
      // The server message is generally meaningful here (article vendu, tarif
      // expiré, solde dû…) — surface it so the user understands the blocker.
      return {
        title: 'Action impossible',
        message: getCallableErrorMessage(error, fallback.message),
      };
    case 'not-found':
      return {
        title: 'Introuvable',
        message: 'La ressource demandée est introuvable.',
      };
    case 'deadline-exceeded':
    case 'unavailable':
      return {
        title: 'Connexion instable',
        message:
          'Le service est momentanément indisponible. Vérifiez votre connexion et réessayez.',
      };
    case 'invalid-argument':
      return {
        title: 'Données invalides',
        message: getCallableErrorMessage(error, 'Certaines informations sont invalides.'),
      };
    default:
      return fallback;
  }
}
