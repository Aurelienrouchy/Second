/**
 * Maps a Stripe Payment Sheet failure into an actionable FR message + a flag
 * indicating whether retrying on the SAME transaction makes sense.
 *
 * The backend no longer cancels the transaction on `payment_failed` (audit
 * F102) — a failed attempt leaves the PaymentIntent re-confirmable for ~1h, so
 * the buyer can retry the same Payment Sheet (no new transaction) or come back
 * later. This helper drives that UX: it distinguishes a declined card, an
 * abandoned 3DS step, and a network error, each with a tailored message.
 */

/**
 * Subset of the Stripe Payment Sheet failure carried by `StripePaymentResult`
 * (kept local so this shared util has no dependency on the `components` layer
 * — boundaries: shared cannot import core).
 */
export interface StripePaymentFailure {
  error?: string;
  errorCode?: string;
  declineCode?: string;
  errorType?: string;
}

export interface ClassifiedPaymentError {
  /** FR title for the alert. */
  title: string;
  /** FR body — explains the cause and what the user can do. */
  message: string;
  /** True when re-presenting the same Payment Sheet is the right next step. */
  retryable: boolean;
}

/** Stripe decline codes that mean the buyer should use another card. */
const HARD_DECLINE_CODES = new Set([
  'lost_card',
  'stolen_card',
  'pickup_card',
  'restricted_card',
  'do_not_honor',
  'card_velocity_exceeded',
]);

/**
 * Classifies a failed `StripePaymentResult` (not a user cancellation — callers
 * handle `error === 'cancelled'` separately) into a tailored FR message.
 */
export function classifyStripePaymentError(
  result: StripePaymentFailure,
): ClassifiedPaymentError {
  const errorType = result.errorType ?? '';
  const errorCode = result.errorCode ?? '';
  const declineCode = result.declineCode ?? '';
  const raw = (result.error ?? '').toLowerCase();

  // ── Network / connectivity ────────────────────────────────────────────────
  if (
    errorType === 'api_connection_error' ||
    errorCode === 'Timeout' ||
    raw.includes('network') ||
    raw.includes('connexion') ||
    raw.includes('connection') ||
    raw.includes('internet')
  ) {
    return {
      title: 'Connexion interrompue',
      message:
        "Le paiement n'a pas pu aboutir à cause d'un problème de connexion. Vérifiez votre réseau, puis réessayez. Aucun montant n'a été débité.",
      retryable: true,
    };
  }

  // ── Card declined (card_error) ────────────────────────────────────────────
  if (errorType === 'card_error' || declineCode) {
    if (HARD_DECLINE_CODES.has(declineCode)) {
      return {
        title: 'Carte refusée',
        message:
          'Votre carte a été refusée. Essayez une autre carte ou contactez votre banque.',
        retryable: true,
      };
    }
    if (declineCode === 'insufficient_funds') {
      return {
        title: 'Fonds insuffisants',
        message:
          'Votre carte a été refusée pour fonds insuffisants. Essayez une autre carte ou réessayez plus tard.',
        retryable: true,
      };
    }
    if (declineCode === 'expired_card') {
      return {
        title: 'Carte expirée',
        message: 'Votre carte est expirée. Essayez une autre carte.',
        retryable: true,
      };
    }
    return {
      title: 'Carte refusée',
      message:
        'Votre carte a été refusée. Vérifiez vos informations ou essayez une autre carte.',
      retryable: true,
    };
  }

  // ── 3DS / authentication abandoned ────────────────────────────────────────
  if (
    errorType === 'authentication_error' ||
    raw.includes('authenticat') ||
    raw.includes('3d secure') ||
    raw.includes('3ds')
  ) {
    return {
      title: 'Authentification incomplète',
      message:
        "La vérification de sécurité (3-D Secure) n'a pas été menée à son terme. Réessayez et validez la confirmation de votre banque.",
      retryable: true,
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  return {
    title: 'Le paiement a échoué',
    message:
      result.error?.trim() ||
      "Le paiement n'a pas pu être finalisé. Vous pouvez réessayer — aucun montant n'a été débité.",
    retryable: true,
  };
}
