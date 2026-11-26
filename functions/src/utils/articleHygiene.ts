import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { articleHygieneInputFromStored, articleHygieneRequirement, evaluateArticleHygieneInput } from '../shared/articleHygiene';

/** New commercial operations only; historical receipts are read first. */
export function assertArticleHygieneAdmitted(article: FirebaseFirestore.DocumentData): void {
  const raw = article.hygieneDeclaration;
  const requirement = articleHygieneRequirement(article.categoryIds);
  if (requirement === 'invalid') {
    const decision = evaluateArticleHygieneInput(article.categoryIds, article.condition, null);
    throw new HttpsError('failed-precondition', decision.message!,
      { reason: decision.reason, field: 'categoryIds', action: 'reviewArticleHygiene' });
  }
  if (requirement !== 'none' && (!raw || !(raw.declaredAt instanceof Timestamp)
      || raw.declaredAt.toMillis() <= 0 || raw.declaredAt.toMillis() > Date.now() + 60_000)) {
    throw new HttpsError('failed-precondition', 'Le vendeur doit confirmer la déclaration d’hygiène de cet article avant une nouvelle opération.',
      { reason: 'article_hygiene_witness_required', field: 'hygieneDeclaration', action: 'reviewArticleHygiene' });
  }
  const input = raw == null ? null : articleHygieneInputFromStored(article.categoryIds, article.sellerId, raw);
  const decision = evaluateArticleHygieneInput(article.categoryIds, article.condition, input);
  if (!decision.allowed || (raw != null && input == null)) {
    throw new HttpsError('failed-precondition', decision.message ?? 'La déclaration d’hygiène doit être confirmée à nouveau par le vendeur.',
      { reason: decision.reason ?? 'article_hygiene_witness_invalid', field: 'hygieneDeclaration', action: 'reviewArticleHygiene' });
  }
}

/** Author, native date and examined category always come from the server. */
export function declaredArticleHygiene(categoryIds: unknown, condition: unknown, input: unknown, sellerId: string): Record<string, unknown> | null {
  const decision = evaluateArticleHygieneInput(categoryIds, condition, input);
  if (!decision.allowed) throw new HttpsError('invalid-argument', decision.message!,
    { reason: decision.reason, field: 'hygieneDeclaration', action: 'reviewArticleHygiene' });
  return decision.declaration ? { ...decision.declaration, declaredBy: sellerId, declaredAt: Timestamp.now(), categoryIds: [...categoryIds as string[]] } : null;
}
