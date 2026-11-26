import type { Article, ArticleImage } from '@/types/article';
import type { Transaction } from '@/types/transaction';
import { normalizeArticleImages } from './articleImages';
import { articleHygieneRequirement, articleHygieneInputFromStored, evaluateArticleHygieneInput } from '@/functions/src/shared/articleHygiene';

export interface TransactionArticlePresentation {
  articleId: string;
  transactionId: string | null;
  originalImageReferences: string[];
  privacyWithdrawalRecorded: boolean;
  source: 'snapshot' | 'current_listing' | 'unavailable';
  sourceLabel: string;
  title: string;
  images: ArticleImage[];
  description: string | null;
  condition: string | null;
  sizeLabel: string | null;
  brandLabel: string | null;
  defectsLabel: string;
  alterationsLabel: string;
  hygieneLabel: string | null;
  saleUnitLabel?: string;
  setPromised?: boolean;
  historicalColorsLabel?: string;
  historicalMaterialsLabel?: string;
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A partial stored snapshot never borrows mutable fields from today's listing. */
export function getTransactionArticlePresentation(
  transaction: Pick<Transaction, 'articleId' | 'articleSnapshot'> & Partial<Pick<Transaction, 'sellerId' | 'id'>> & { articlePrivacyWithdrawal?: unknown },
  currentArticle?: Article | null,
): TransactionArticlePresentation {
  const raw: unknown = transaction.articleSnapshot;
  const saved = record(raw) ? raw : null;
  const privacyWithdrawalRecorded = Object.prototype.hasOwnProperty.call(transaction, 'articlePrivacyWithdrawal');
  const current = !privacyWithdrawalRecorded && currentArticle?.id === transaction.articleId ? currentArticle : null;
  const data: Record<string, unknown> = saved ?? (current as unknown as Record<string, unknown> | null) ?? {};
  const source = saved ? 'snapshot' : current ? 'current_listing' : 'unavailable';
  // The command's hygiene statement comes only from its snapshot, never today's listing.
  const hygieneRequirement = articleHygieneRequirement(saved?.categoryIds);
  const hygiene = evaluateArticleHygieneInput(saved?.categoryIds, saved?.condition,
    articleHygieneInputFromStored(saved?.categoryIds, transaction.sellerId, saved?.hygieneDeclaration));
  const size = data.size;
  const sizeLabel = typeof size === 'string' && text(size)
    ? `${size} (système non déclaré)`
    : record(size) && text(size.value)
      ? `${text(size.value)} ${size.system === 'EU' || size.system === 'US' ? size.system : '(système non déclaré)'}`
      : null;
  const historicalList = (value: unknown) => Array.isArray(value) && value.length > 0 && value.length <= 20 &&
    value.every(item => typeof item === 'string' && !!item.trim() && item.length <= 200) ? value.map(item => item.trim()).join(', ') : null;
  return {
    articleId: transaction.articleId,
    transactionId: text(transaction.id),
    // References are matched only to qualified media proof. The withdrawal
    // snapshot never supplies missing contract text, declarations or pixels.
    originalImageReferences: Array.isArray(data.images) ? data.images.flatMap(value => {
      const url = typeof value === 'string' ? value : record(value) && typeof value.url === 'string' ? value.url : null;
      return url ? [url] : [];
    }) : [],
    privacyWithdrawalRecorded,
    source,
    sourceLabel: source === 'snapshot' ? 'Renseignements enregistrés avec la commande.'
      : source === 'current_listing' ? 'Annonce actuelle : les renseignements historiques n’ont pas été enregistrés.'
        : 'Renseignements de l’article indisponibles. Le suivi et l’assistance restent accessibles.',
    title: text(data.title) ?? 'Article de la commande',
    images: privacyWithdrawalRecorded ? [] : normalizeArticleImages(data.images),
    description: text(data.description),
    saleUnitLabel: saved?.saleUnit === 'set_as_one' ? 'Ensemble vendu comme un tout, à un seul prix.' : saved?.saleUnit === 'single_article' ? 'Un article vendu comme une unité entière.' : 'L’unité promise n’a pas été enregistrée avec cette commande.',
    setPromised: saved?.saleUnit === 'set_as_one',
    historicalColorsLabel: historicalList(saved?.colors) ?? 'Couleurs non enregistrées dans cette commande.',
    historicalMaterialsLabel: historicalList(saved?.materials) ?? 'Matières non enregistrées dans cette commande.',
    condition: text(data.condition),
    hygieneLabel: hygieneRequirement === 'none' ? null
      : hygiene.declaration?.kind === 'underwear' ? 'Le vendeur déclare que ce sous-vêtement n’a jamais été porté.'
        : hygiene.declaration?.kind === 'cosmetic' ? 'Le vendeur déclare que ce cosmétique est neuf et encore scellé.'
          : hygiene.declaration?.kind === 'not_applicable' ? 'Le vendeur déclare que cet article est d’une autre nature, sans sous-vêtement ou cosmétique.'
            : 'Aucune déclaration d’hygiène qualifiée n’a été enregistrée avec cette commande.',
    sizeLabel,
    brandLabel: data.brandStatus === 'unbranded' ? 'Sans marque'
      : data.brandStatus === 'unknown' ? 'Marque non identifiée' : text(data.brand),
    defectsLabel: data.hasKnownDefects === true ? text(data.defectsDescription) ?? 'Défauts signalés, sans précision enregistrée.'
      : data.hasKnownDefects === false ? 'Aucun défaut connu déclaré par le vendeur.' : 'Défauts non déclarés.',
    alterationsLabel: data.hasAlterations === true ? text(data.alterationsDescription) ?? 'Retouches signalées, sans précision enregistrée.'
      : data.hasAlterations === false ? 'Aucune retouche connue déclarée par le vendeur.'
        : data.hasAlterations === null ? 'Le vendeur ne sait pas si l’article a été retouché.' : 'Retouches non déclarées.',
  };
}
