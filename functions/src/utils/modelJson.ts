/**
 * Lecture de la réponse du modèle d'analyse.
 *
 * L'ancienne extraction prenait tout, du premier « { » au dernier « } ». Sur
 * une réponse en TABLEAU — `[{…},{…}]` — elle rendait `{…},{…}`, du JSON
 * invalide, et l'analyse échouait en « Erreur serveur ». On lit d'abord la
 * réponse entière (le modèle est tenu de répondre en JSON), on retient le
 * premier objet d'un tableau, et on ne cherche un objet équilibré au milieu
 * d'un texte qu'en dernier recours.
 */

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function firstObject(value: unknown): Record<string, unknown> | null {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObject(value)) return value;
  if (Array.isArray(value)) return value.find(isObject) ?? null;
  return null;
}

/** Index de l'accolade qui ferme celle ouverte en `start`, chaînes JSON comprises. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Premier objet JSON de la réponse du modèle. Lève s'il n'y en a aucun. */
export function parseModelJson(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const whole = firstObject(tryParse(cleaned));
  if (whole) return whole;

  const start = cleaned.indexOf('{');
  if (start >= 0) {
    const end = closingBrace(cleaned, start);
    if (end > start) {
      const embedded = firstObject(tryParse(cleaned.slice(start, end + 1)));
      if (embedded) return embedded;
    }
  }

  throw new Error('No JSON object in model response');
}
