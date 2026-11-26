import type { SupportPrivacyCategory, SupportPrivacyScope } from '@/types/supportRequest';

export const SUPPORT_PRIVACY_CATEGORY_LABELS: Record<SupportPrivacyCategory, string> = {
  account_profile: 'Profil du compte', saved_searches: 'Recherches enregistrées', search_history: 'Historique des recherches',
  consents: 'Consentements', notifications: 'Notifications', articles: 'Annonces', drafts: 'Brouillons',
  communications: 'Messages et communications', reviews: 'Avis', swaps: 'Échanges', swap_zone: 'Zone de troc',
  favorites: 'Favoris', media: 'Photos et autres médias', transactions: 'Commandes et opérations financières',
  support: 'Demandes au support', other_or_unknown: 'Autres données ou portée à préciser',
};

/** References remain declarations; this mirrors privacy_scope_v1 without normalizing an ID. */
export function supportPrivacyObjectError(scope: SupportPrivacyScope, category: SupportPrivacyCategory | null, id: string): string | null {
  if (!category || !scope.categories.includes(category)) return 'Choisissez une catégorie concernée pour cette référence.';
  if (!id) return 'Saisissez la référence exacte de la donnée concernée.';
  const bytes = Array.from(id).reduce((sum, char) => {
    const code = char.codePointAt(0)!; return sum + (code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4);
  }, 0);
  if (bytes > 128 || id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) return 'Cette référence ne respecte pas le format accepté. Copiez son identifiant seul, sans chemin ni lien.';
  if (scope.objects.some(object => object.category === category && object.id === id)) return 'Cette référence est déjà ajoutée dans cette catégorie.';
  if (scope.objects.length >= 20) return 'Vingt références au maximum peuvent être précisées dans une demande.';
  return null;
}

export function toggleSupportPrivacyCategory(scope: SupportPrivacyScope, category: SupportPrivacyCategory): SupportPrivacyScope {
  const removed = scope.categories.includes(category);
  return {...scope, categories: removed ? scope.categories.filter(item => item !== category) : [...scope.categories, category],
    objects: removed ? scope.objects.filter(object => object.category !== category) : scope.objects};
}
