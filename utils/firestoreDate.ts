/**
 * Normalisation des dates lues depuis Firestore.
 *
 * Un champ date écrit comme `Date` est persisté en `Timestamp`. Relu sans
 * converter, le Web SDK rend donc un `Timestamp`, jamais une `Date` — et
 * `new Date(timestamp)` vaut `Invalid Date`. Selon l'appelant, cela produisait
 * soit la chaîne « Invalid Date » écrite dans une conversation, soit une levée
 * `RangeError: Invalid time value` sur `.toISOString()` — cette dernière APRÈS
 * qu'une Cloud Function avait déjà acté l'opération.
 *
 * Ce module vit dans la couche partagée parce que trois couches en ont besoin :
 * `services/chat/*` pour composer le corps des messages, `features/offers/*`
 * pour l'afficher dans la bulle. Une copie par couche est précisément ce qui
 * fait diverger deux lectures d'une même donnée.
 */

/** Renvoie une `Date` valide, ou `null` — jamais une date invalide. */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (
    typeof value === 'object' &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Horaire d'une rencontre, avec le repli métier quand aucun n'a été convenu.
 * Le libellé est repris mot pour mot de l'existant : aucun changement de copie.
 */
export function formatMeetupDateTime(value: unknown, locale: string): string {
  const d = toDate(value);
  if (!d) return 'à une date à convenir';
  const date = d.toLocaleDateString(locale);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `le ${date} à ${time}`;
}
