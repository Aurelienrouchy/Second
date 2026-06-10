/**
 * Helpers purs (shared layer) pour le cycle de vie d'un compte vendeur Stripe
 * Connect Custom : contrat de statut consommé par l'app, traduction FR lisible
 * des clés `requirements.*` renvoyées par Stripe, et dérivation de l'état réel
 * (charges vs payouts) — sans aucune dépendance Firebase/réseau.
 *
 * Modèle white-label : le vendeur ne voit jamais Stripe, donc l'app est la
 * seule surface qui affiche les exigences KYC et pilote la remédiation
 * (F59 / F62 / F117).
 */

/** Valeurs EXACTES de `status` dérivées par `deriveStripeAccountState` côté CF. */
export type StripeAccountStatusValue =
  | 'active'
  | 'partially_active'
  | 'pending_verification'
  | 'restricted'
  | 'pending'
  | 'none';

/** Contrat retourné par la callable `getStripeAccountStatus`. */
export interface StripeAccountStatus {
  success: boolean;
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  status: StripeAccountStatusValue;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  disabledReason: string | null;
  currentDeadline: number | null;
  bankAccountLast4: string | null;
}

/** Réponse de `uploadStripeIdentityDocument`. */
export interface UploadIdentityDocumentResponse {
  success: boolean;
  status: StripeAccountStatusValue;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  disabledReason: string | null;
}

/** Réponse de `addBankAccount`. */
export interface AddBankAccountResponse {
  success: boolean;
  bankAccountLast4: string;
  bankAccountStatus: string | null;
}

/**
 * Traduit une clé d'exigence Stripe en libellé FR lisible. Couvre les clés les
 * plus courantes en Custom (Canada). Les clés inconnues sont nettoyées en un
 * libellé générique plutôt que d'exposer la clé brute.
 */
export function translateRequirement(key: string): string {
  const exact: Record<string, string> = {
    'individual.verification.document': "Pièce d'identité à fournir",
    'individual.verification.additional_document':
      "Document d'identité supplémentaire à fournir",
    'individual.id_number': "Numéro d'identification à fournir",
    'individual.ssn_last_4': "Derniers chiffres du numéro d'assurance sociale",
    'individual.first_name': 'Prénom à compléter',
    'individual.last_name': 'Nom de famille à compléter',
    'individual.dob.day': 'Date de naissance à compléter',
    'individual.dob.month': 'Date de naissance à compléter',
    'individual.dob.year': 'Date de naissance à compléter',
    'individual.address.line1': 'Adresse à compléter',
    'individual.address.city': 'Ville à compléter',
    'individual.address.state': 'Province à compléter',
    'individual.address.postal_code': 'Code postal à compléter',
    'individual.phone': 'Numéro de téléphone à fournir',
    'individual.email': 'Adresse courriel à fournir',
    external_account: 'Compte bancaire à ajouter',
    'business_profile.url': 'Site web ou description de votre activité',
    'business_profile.mcc': "Catégorie d'activité à préciser",
    'tos_acceptance.date': "Conditions d'utilisation à accepter",
    'tos_acceptance.ip': "Conditions d'utilisation à accepter",
  };

  if (exact[key]) return exact[key];

  // Document de vérification d'une personne (clé dynamique person_xxx).
  if (key.includes('verification.document')) return "Pièce d'identité à fournir";
  if (key.includes('verification.additional_document')) {
    return "Document d'identité supplémentaire à fournir";
  }
  if (key.endsWith('.address.line1') || key.includes('.address.')) {
    return 'Adresse à compléter';
  }
  if (key.includes('external_account')) return 'Compte bancaire à ajouter';

  // Fallback : transformer la clé en texte lisible (sans exposer la clé brute).
  const readable = key
    .split('.')
    .pop()!
    .replace(/_/g, ' ')
    .trim();
  return readable
    ? `Information requise : ${readable}`
    : 'Information supplémentaire requise';
}

/**
 * Vrai si l'une des exigences (currently_due / past_due) ou le `disabledReason`
 * suggère qu'un document d'identité doit être fourni — déclenche le flow KYC.
 */
export function needsIdentityDocument(status: {
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  disabledReason: string | null;
}): boolean {
  const all = [...status.requirementsCurrentlyDue, ...status.requirementsPastDue];
  const docKey = all.some((k) => k.includes('verification.document'));
  const reason = status.disabledReason ?? '';
  const reasonDoc =
    reason.includes('verification.document') ||
    reason.includes('requirements.past_due') ||
    reason === 'requirements.pending_verification';
  return docKey || reasonDoc;
}

/** Traduit un `disabled_reason` Stripe en phrase FR, ou null si non pertinent. */
export function translateDisabledReason(reason: string | null): string | null {
  if (!reason) return null;
  const map: Record<string, string> = {
    'requirements.past_due':
      'Des informations sont en retard. Complétez-les pour réactiver vos paiements.',
    'requirements.pending_verification':
      'Vos informations sont en cours de vérification par Stripe.',
    'rejected.fraud': 'Votre compte a été restreint pour suspicion de fraude.',
    'rejected.terms_of_service':
      "Votre compte a été restreint pour non-respect des conditions d'utilisation.",
    'rejected.listed': 'Votre compte a été restreint.',
    'rejected.other': 'Votre compte a été restreint.',
    'listed': 'Votre compte est en cours de revue.',
    'under_review': 'Votre compte est en cours de revue par Stripe.',
    'platform_paused': 'Les paiements sont momentanément suspendus.',
    'other': 'Une action est requise pour réactiver vos paiements.',
  };
  return map[reason] ?? 'Une action est requise pour réactiver vos paiements.';
}

/** Libellé FR du statut de vérification d'un compte bancaire Stripe. */
export function translateBankStatus(status: string | null): string | null {
  if (!status) return null;
  const map: Record<string, string> = {
    new: 'En cours de vérification',
    validated: 'Vérifié',
    verified: 'Vérifié',
    verification_failed: 'Vérification échouée',
    errored: 'Erreur — remplacez ce compte',
  };
  return map[status] ?? null;
}
