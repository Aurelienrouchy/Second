import { CONDITIONS } from '@/data/conditions';
import { articleRequiresSize } from '@/data/sizes';
import type { DraftFields } from '../services/draftService';
import { evaluateArticleHygieneInput } from '@/functions/src/shared/articleHygiene';
import { childSafetyCategory } from '@/functions/src/shared/articleChildSafety';
import { articleChildSafetyInput } from '@/utils/articleChildSafetyInput';

type ListingDeclarations = Pick<DraftFields,
  'description' | 'categoryIds' | 'condition' | 'conditionConfirmed' | 'brand' | 'size' | 'hygieneDeclaration' | 'quantity' | 'stock' | 'childSafetyDeclaration'>;

export function getListingDeclarationErrors(fields: ListingDeclarations): Array<{ key: string; message: string }> {
  const errors: Array<{ key: string; message: string }> = [];
  const child = childSafetyCategory(fields.categoryIds);
  if (['child_clothing', 'canonical_sleepwear'].includes(child) && !articleChildSafetyInput(fields.childSafetyDeclaration))
    errors.push({key: 'childSafetyDeclaration', message: 'Choisissez l’usage, l’état de l’étiquette et vos observations de sécurité. Recopiez l’étiquette lisible et décrivez tout problème observé.'});
  if (fields.quantity !== undefined && fields.quantity !== 1 || fields.stock !== undefined && fields.stock !== 1) errors.push({key: 'quantity', message: 'Une annonce doit proposer une seule unité entière : un article ou un ensemble vendu comme un tout, sans stock multiple.'});
  const hygiene = evaluateArticleHygieneInput(fields.categoryIds, fields.condition, fields.hygieneDeclaration);
  if (!hygiene.allowed) errors.push({ key: 'hygieneDeclaration', message: hygiene.message ?? 'Confirmez la règle d’hygiène de cet article.' });
  if (!fields.description?.trim()) {
    errors.push({ key: 'description', message: 'Décrivez votre article.' });
  }
  if (fields.conditionConfirmed !== true || !CONDITIONS.some(item => item.value === fields.condition)) {
    errors.push({ key: 'condition', message: 'Choisissez vous-même l’état réel de l’article.' });
  }
  if (articleRequiresSize(fields.categoryIds ?? []) && !fields.size?.trim()) {
    errors.push({ key: 'size', message: 'Renseignez la taille ou la pointure de cet article.' });
  }
  return errors;
}
