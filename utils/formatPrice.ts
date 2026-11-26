// Espace insécable : le prix est souvent posé au milieu d'une phrase, il ne doit
// jamais se couper entre le montant et le symbole. U+00A0 et non U+202F, dont le
// glyphe manque à certaines polices personnalisées (carré vide à l'écran).
const NBSP = ' ';

/**
 * Format a price for catalogue display (e.g. "45 $" or "45,50 $").
 * Uses the Canadian-French convention: non-breaking space before the dollar
 * sign, comma as decimal separator. Omits decimals when the amount is whole.
 */
export function formatPrice(amount: number): string {
  if (Number.isInteger(amount)) {
    return `${amount}${NBSP}$`;
  }
  return `${amount.toFixed(2).replace('.', ',')}${NBSP}$`;
}

/**
 * Format a price with explicit CAD currency indicator.
 * Always shows two decimal places for precision.
 * Use this in contexts where currency ambiguity matters:
 * checkout, seller balance, withdrawal, payout summaries.
 *
 * Example: formatPriceWithCurrency(45) => "45,00 $ CA"
 */
export function formatPriceWithCurrency(amount: number): string {
  return `${amount.toFixed(2).replace('.', ',')}${NBSP}$${NBSP}CA`;
}

/**
 * Format a cents amount (integer minor units) for display.
 * Canadian-French convention: non-breaking space before the dollar sign,
 * comma decimal. Always shows two decimals.
 *
 * Example: formatCents(4500) => "45,00 $"
 */
export function formatCents(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')}${NBSP}$`;
}
