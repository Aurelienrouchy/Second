/**
 * Menu propriétaire d'une annonce : modifier / marquer vendu / retirer.
 *
 * « Mes articles » et la fiche article le redessinaient chacun de leur côté.
 * Ce module en est la seule source, libellés compris.
 */

export type OwnerArticleAction = 'edit' | 'shipping' | 'toggle_sold' | 'delete';

export interface OwnerActionEntry {
  label: string;
  action: OwnerArticleAction;
}

export interface OwnerActionSheetIOS {
  title: string;
  options: string[];
  cancelButtonIndex: number;
  destructiveButtonIndex: number;
  /** Aligné sur `options` ; `null` sur « Annuler ». */
  actions: (OwnerArticleAction | null)[];
}

export const CANCEL_LABEL = 'Annuler';

export const OWNER_ACTION_SHEET_MESSAGE = 'Que souhaitez-vous faire ?';

export function ownerArticleActions(isSold: boolean, shippingAvailable = false): OwnerActionEntry[] {
  const entries: OwnerActionEntry[] = [];
  // Une annonce vendue ne se modifie plus.
  if (!isSold) entries.push({ label: 'Modifier', action: 'edit' });
  if (!isSold && shippingAvailable) entries.push({ label: 'Préparer l’expédition', action: 'shipping' });
  entries.push({
    label: isSold ? 'Remettre en vente' : 'Marquer comme vendu',
    action: 'toggle_sold',
  });
  entries.push({ label: 'Supprimer', action: 'delete' });
  return entries;
}

export function buildOwnerActionSheetIOS(title: string, isSold: boolean, shippingAvailable = false): OwnerActionSheetIOS {
  const entries = ownerArticleActions(isSold, shippingAvailable);
  // « Annuler » en dernier : convention iOS, et l'ordre qu'affichait déjà la
  // fiche article quand « Mes articles » le plaçait en tête.
  const options = [...entries.map((e) => e.label), CANCEL_LABEL];
  const actions: (OwnerArticleAction | null)[] = [...entries.map((e) => e.action), null];
  return {
    title,
    options,
    cancelButtonIndex: options.length - 1,
    destructiveButtonIndex: entries.length - 1,
    actions,
  };
}

export function removeArticleAlert(title: string) {
  return {
    title: 'Retirer de la vente',
    message: `« ${title} » ne sera plus visible par les acheteurs. Vous ne pourrez pas le remettre en ligne.`,
    confirmLabel: 'Retirer',
  };
}

export const MARK_AS_SOLD_ALERT = {
  title: 'Marquer comme vendu ?',
  message:
    "Les personnes qui l'ont en favori le perdront, et les offres en attente seront annulées. Remettre en vente ne les rétablira pas.",
  confirmLabel: 'Marquer comme vendu',
} as const;
