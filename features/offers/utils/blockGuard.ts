/**
 * Quelles actions d'offre restent ouvertes quand l'interlocuteur est bloqué.
 *
 * Bloquer quelqu'un supprime la barre de saisie et affiche « Débloquez-le pour
 * reprendre la conversation » — mais la bulle d'offre, elle, gardait TOUS ses
 * boutons. On pouvait donc accepter une offre, contre-proposer un lieu, ou
 * confirmer un rendez-vous physique avec une personne à qui l'on ne peut plus
 * écrire un mot. Accepter crée en outre une transaction et verrouille l'article.
 *
 * Tout couper serait pire : une rencontre déjà acceptée resterait prisonnière
 * jusqu'au balayage automatique (48 h ou 7 jours), article bloqué, sans aucune
 * sortie. La règle retenue distingue donc les actions qui POURSUIVENT la
 * relation de celles qui la TERMINENT ou protègent :
 *
 *   fermées   accepter · contre-offrir (prix, lieu, horaire) · confirmer
 *   ouvertes  refuser · annuler la rencontre · signaler une absence · finaliser
 *
 * Une personne qui bloque garde ainsi toutes ses sorties, y compris son recours,
 * mais ne peut plus s'engager davantage.
 */
export const OFFER_ACTIONS_CLOSED_WHEN_BLOCKED = [
  'onAcceptOffer',
  'onCounterPrice',
  'onCounterLocation',
  'onCounterTime',
  'onConfirmMeetup',
] as const;

/**
 * Retire les handlers fermés au blocage. La bulle n'affiche un bouton que si son
 * handler est fourni : retirer le handler suffit donc à faire disparaître le
 * bouton, sans ajouter de drapeau à un composant qui en porte déjà treize.
 */
export function withOfferBlockGuard<H extends Record<string, unknown>>(
  handlers: H,
  isBlocked: boolean
): H {
  if (!isBlocked) return handlers;
  const guarded: Record<string, unknown> = { ...handlers };
  for (const key of OFFER_ACTIONS_CLOSED_WHEN_BLOCKED) {
    if (key in guarded) guarded[key] = undefined;
  }
  return guarded as H;
}
