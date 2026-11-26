/**
 * Lecture des paramètres de route du tunnel de vente.
 *
 * Les paramètres arrivent tels quels de la barre d'adresse : un lien profond
 * bricolé, une clé répétée (expo-router rend alors un tableau) ou un JSON
 * valide mais de mauvaise forme faisaient tomber l'écran au montage, sans
 * filet — aucun écran du tunnel n'exporte d'ErrorBoundary.
 */

/**
 * Expo Router also decodes local search params after query parsing. Preserve
 * percent escapes inside opaque file/private-media references for that pass.
 * Consumers still receive ordinary JSON and keep their existing validation.
 */
export function serializeRouteParam(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new Error('Paramètre de navigation invalide.');
  return encodeURIComponent(json);
}

export function parseRouteParam<T>(
  value: string | string[] | undefined,
  fallback: T,
  isValid: (v: unknown) => v is T,
): T {
  if (value == null) return fallback;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function isObject<T>(v: unknown): v is T {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
