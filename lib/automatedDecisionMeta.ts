/**
 * Automated-decision presentation metadata (Loi 25, art. 12.1).
 *
 * Single source of truth for the FR copy describing the three automated
 * decisions the platform takes WITHOUT human intervention:
 *   - funds_released      — heldBalance → balance after the 7-day dispute window.
 *   - transaction_expired — an orphaned / unfulfilled order is cancelled.
 *   - label_refund        — a paid order whose label could never be created is
 *                           refunded.
 *
 * Mirrors the backend union (`functions/src/callable/automatedDecisions.ts`).
 * The juriste-authored sentences live here verbatim. Shared layer: no UI
 * dependency — only string mapping consumed by the contestation UI.
 */

/** Mirrors the backend `AutomatedDecisionType` union. */
export type AutomatedDecisionType =
  | 'funds_released'
  | 'transaction_expired'
  | 'label_refund';

/** One entry of the transparent automated-decision log (ISO dates from backend). */
export interface AutomatedDecisionLogEntry {
  id: string;
  transactionId: string | null;
  userId: string | null;
  decisionType: AutomatedDecisionType | string | null;
  criteria: Record<string, unknown>;
  result: string;
  /** ISO-8601 string or null (already serialised server-side). */
  executedAt: string | null;
}

interface DecisionMeta {
  /** Short card title. */
  title: string;
  /** Accessible explanation header ("Pourquoi cette décision ?"). */
  explanation: string;
}

const DECISION_META: Record<AutomatedDecisionType, DecisionMeta> = {
  funds_released: {
    title: 'Libération automatique des fonds',
    explanation:
      'Cette décision a été prise automatiquement sur la base des critères suivants : ' +
      'la livraison a été confirmée et le délai de réclamation (7 jours) est écoulé. ' +
      'Vous pouvez demander une révision humaine.',
  },
  transaction_expired: {
    title: 'Annulation automatique de la commande',
    explanation:
      'Cette décision a été prise automatiquement sur la base des critères suivants : ' +
      'le délai imparti pour finaliser cette commande est écoulé sans action requise de la part des parties. ' +
      'Vous pouvez demander une révision humaine.',
  },
  label_refund: {
    title: 'Remboursement automatique',
    explanation:
      'Cette décision a été prise automatiquement sur la base des critères suivants : ' +
      "l'étiquette d'expédition n'a pas pu être créée après plusieurs tentatives, la commande a donc été remboursée. " +
      'Vous pouvez demander une révision humaine.',
  },
};

/** True when the value is one of the three known automated decision types. */
export function isAutomatedDecisionType(
  value: unknown,
): value is AutomatedDecisionType {
  return (
    value === 'funds_released' ||
    value === 'transaction_expired' ||
    value === 'label_refund'
  );
}

/** FR card title for a decision type (falls back to a neutral label). */
export function getDecisionTitle(decisionType: string | null | undefined): string {
  if (isAutomatedDecisionType(decisionType)) {
    return DECISION_META[decisionType].title;
  }
  return 'Décision automatisée';
}

/** Accessible "Pourquoi cette décision ?" explanation for a decision type. */
export function getDecisionExplanation(
  decisionType: string | null | undefined,
): string {
  if (isAutomatedDecisionType(decisionType)) {
    return DECISION_META[decisionType].explanation;
  }
  return (
    'Cette décision a été prise automatiquement. ' +
    'Vous pouvez demander une révision humaine.'
  );
}

/**
 * FR labels for the technical criteria keys written by the backend log.
 *
 * Keys MUST match the verbatim strings emitted by the backend automated-decision
 * jobs, otherwise the contestation UI falls back to a neutral label:
 *   - funds_released      (functions/src/scheduled/releaseHeldFunds.ts):
 *       status, disputed, fundsReleaseAt, disputeWindowDays
 *   - transaction_expired (functions/src/scheduled/transactionExpiration.ts):
 *       status, expiryWindowHours, expiryWindowDays, cancelReason
 *   - label_refund        (functions/src/scheduled/sweepPendingLabels.ts):
 *       status, labelCreationPending, maxAttempts, cancelReason
 */
const CRITERIA_KEY_LABELS: Record<string, string> = {
  status: 'Statut de la commande',
  disputed: 'Litige ouvert',
  fundsReleaseAt: 'Date de libération prévue',
  disputeWindowDays: 'Délai de réclamation (jours)',
  expiryWindowHours: 'Délai imparti (heures)',
  expiryWindowDays: 'Délai imparti (jours)',
  labelCreationPending: "Création d'étiquette en attente",
  maxAttempts: "Tentatives d'étiquette",
  cancelReason: "Motif d'annulation",
};

/**
 * Human-readable label for a criteria key. Falls back to a neutral generic
 * label (never the raw technical key) so an unmapped backend key can't leak
 * into the Loi 25 contestation UI.
 */
export function getCriteriaKeyLabel(key: string): string {
  return CRITERIA_KEY_LABELS[key] ?? 'Critère';
}

/**
 * Renders a single criteria value into a FR-readable string. Booleans become
 * Oui/Non, ISO dates become a localised date, everything else is stringified.
 */
export function formatCriteriaValue(value: unknown, locale: string): string {
  if (typeof value === 'boolean') {
    return value ? 'Oui' : 'Non';
  }
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    // Detect ISO-8601 timestamps and localise them.
    const parsed = Date.parse(value);
    if (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) &&
      !Number.isNaN(parsed)
    ) {
      return new Date(parsed).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
    return value;
  }
  return String(value);
}

/**
 * Flattens a criteria map into ordered { label, value } rows for display.
 * Keeps only primitive values (the backend already sanitises the map).
 */
export function buildCriteriaRows(
  criteria: Record<string, unknown>,
  locale: string,
): { key: string; label: string; value: string }[] {
  return Object.entries(criteria)
    .filter(
      ([, value]) =>
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
    )
    .map(([key, value]) => ({
      key,
      label: getCriteriaKeyLabel(key),
      value: formatCriteriaValue(value, locale),
    }));
}
