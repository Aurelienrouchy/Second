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

/** Owner-only verification signals; provider prose is never displayed. */
export interface StripeVerificationError { code: string; requirement: string | null }

/** Owner-only inventory: no complete banking coordinates leave the provider. */
export interface PaymentBankAccount {
  id: string;
  bankName: string | null;
  last4: string;
  currency: 'CAD';
  country: 'CA';
  status: string | null;
  isDefault: boolean;
  isSelected: boolean;
  canSelect: boolean;
  canDelete: boolean;
  deleteBlockedReason: null | 'selected_bank' | 'default_bank' | 'withdrawal_in_progress' | 'operation_in_progress' | 'unavailable';
  selectionDeclarationRequired: boolean;
}

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
  verificationErrors: StripeVerificationError[];
  requirementsPendingVerification: string[];
  connectActionRequired?: boolean;
  /** A fresh owner status read has qualified that no existing Connect creation needs recovery. */
  connectCreationReady?: boolean;
  connectOperationState?: 'creating' | 'rejected' | 'unknown';
  recoveryReference?: string | null;
  disabledReason: string | null;
  currentDeadline: number | null;
  bankAccountLast4: string | null;
  bankAccountId?: string | null;
  bankAccountStatus?: string | null;
  bankDeclarationRequired?: boolean;
  bankAccounts?: PaymentBankAccount[];
  bankAccountsAvailable?: boolean;
  bankChangesBlockedReason?: null | 'withdrawal_in_progress' | 'operation_in_progress';
  bankOperation?: { requestId: string; operationId: string; state: BankOperationState;
    action?: null | 'resumeBankOperation' | 'contactSupport' | 'correctBankDetails' } | null;
  payoutEligible?: boolean;
  payoutRestriction?: ConnectPayoutRestriction;
}

/** Mirrors the server's new-charge admission. Bank withdrawals are a separate
 * capability: a non-blocking identity review must not be shown as a refusal. */
export function canReceiveBuyerPayments(account: StripeAccountStatus | null | undefined): boolean {
  return account?.hasAccount === true && account.chargesEnabled === true &&
    ['active', 'partially_active', 'pending_verification', 'pending'].includes(account.status) &&
    (account.disabledReason === null || account.disabledReason === 'requirements.pending_verification') &&
    Array.isArray(account.requirementsPastDue) && account.requirementsPastDue.length === 0;
}

export interface ConnectPayoutRestriction {
  protocol: 'connect_payout_restriction_v1';
  ownerId: string;
  category: 'none' | 'restricted' | 'under_review' | 'information_required' | 'pending_verification' | 'bank_destination' | 'unknown';
  action: 'contactSupport' | 'completeIdentityInformation' | 'refreshStripeStatus' | 'correctBankDetails' | null;
  message: string;
  bankChangeResolvesRestriction: false;
  payoutPermissionGranted: false;
}

/** A typed callable alone does not qualify a restriction for the current owner. */
export function parseConnectPayoutRestriction(value: unknown, ownerId: string): ConnectPayoutRestriction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const actions: Record<ConnectPayoutRestriction['category'], ConnectPayoutRestriction['action'][]> = {
    none: [null], restricted: ['contactSupport'], under_review: ['contactSupport', 'refreshStripeStatus'],
    information_required: ['completeIdentityInformation'], pending_verification: ['refreshStripeStatus'],
    bank_destination: ['correctBankDetails'], unknown: ['contactSupport', 'refreshStripeStatus'],
  };
  if (r.protocol !== 'connect_payout_restriction_v1' || r.ownerId !== ownerId ||
      typeof r.category !== 'string' || !Object.hasOwn(actions, r.category) ||
      !actions[r.category as ConnectPayoutRestriction['category']].includes(r.action as ConnectPayoutRestriction['action']) ||
      typeof r.message !== 'string' || !r.message.trim() || r.message.length > 2000 ||
      r.bankChangeResolvesRestriction !== false || r.payoutPermissionGranted !== false) return null;
  return value as ConnectPayoutRestriction;
}

/** Réponse de `uploadStripeIdentityDocument`. */
export interface UploadIdentityDocumentResponse {
  success: boolean;
  status: StripeAccountStatusValue;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  verificationErrors: StripeVerificationError[];
  requirementsPendingVerification: string[];
  disabledReason: string | null;
}

/** Réponse de `addBankAccount`. */
export type BankOperationState = 'creating' | 'unknown' | 'selecting' | 'selection_unknown' | 'deleting' | 'deletion_unknown' | 'completed' | 'rejected' | 'candidate_unavailable' | 'reconciliation_required';

export interface AddBankAccountResponse {
  success: boolean;
  requestId: string;
  operationId: string;
  operationState: BankOperationState;
  bankAccountLast4: string | null;
  bankAccountStatus: string | null;
  previousBankPreserved: true;
  ownershipVerified: false;
  action: null | 'resumeBankOperation' | 'contactSupport' | 'correctBankDetails';
  mode?: 'replace' | 'declare_current' | 'select_existing' | 'delete_existing';
  bankAccountId?: string | null;
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
 * Only an explicit requirement/error for the supported individual document
 * opens this uploader. Pending verification alone never requests a new upload.
 */
interface IdentityDocumentRequirements {
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  verificationErrors?: StripeVerificationError[];
  requirementsPendingVerification?: string[];
}

function isActionableIdentityError(error: StripeVerificationError): boolean {
  return isSupportedIdentityRequirement(error.requirement) &&
    ['expired', 'not_readable', 'corrupt', 'missing_front', 'missing_back', 'type_not_supported', 'type_unsupported']
      .includes(error.code.startsWith('verification_document_') ? error.code.slice('verification_document_'.length) : error.code);
}

/** An exact supported field already being reviewed is not a resend request.
 * Other due fields stay visible, and a recognized document error overrides waiting. */
export function getActionableRequirements(status: IdentityDocumentRequirements): string[] {
  const pending = new Set(status.requirementsPendingVerification ?? []);
  const errors = status.verificationErrors ?? [];
  return [...new Set([...status.requirementsPastDue, ...status.requirementsCurrentlyDue])].filter(requirement =>
    !isSupportedIdentityRequirement(requirement) || !pending.has(requirement) ||
    errors.some(error => error.requirement === requirement && isActionableIdentityError(error)));
}

export function needsIdentityDocument(status: IdentityDocumentRequirements & { disabledReason: string | null }): boolean {
  return getActionableRequirements(status).some(isSupportedIdentityRequirement) ||
    (status.verificationErrors ?? []).some(isActionableIdentityError);
}

/** This uploader attaches only individual.verification.document (front + optional back). */
export function isSupportedIdentityRequirement(requirement: string | null): boolean {
  return requirement === 'individual.verification.document' || requirement === 'individual.verification.document.front' ||
    requirement === 'individual.verification.document.back';
}

export function translateVerificationError(error: StripeVerificationError): string {
  const instructions: Record<string, string> = {
    expired: 'La pièce semble expirée. Fournissez une pièce valide et non expirée.',
    not_readable: 'La pièce ne peut pas être lue. Reprenez une photo nette, en couleurs, avec tous les bords visibles.',
    corrupt: 'Le fichier ne peut pas être lu. Sélectionnez une nouvelle photo nette de la pièce.',
    missing_front: 'Le recto de la pièce manque. Ajoutez une photo lisible du recto.',
    missing_back: 'Le verso de la pièce manque. Ajoutez le recto et le verso dans le même envoi.',
    type_not_supported: 'Ce type de pièce n’est pas accepté. Consultez notre équipe pour choisir une pièce adaptée.',
    type_unsupported: 'Ce type de pièce n’est pas accepté. Consultez notre équipe pour choisir une pièce adaptée.',
  };
  const code = error.code.startsWith('verification_document_') ? error.code.slice('verification_document_'.length) : error.code;
  const message = instructions[code] ?? 'La vérification demande une correction. Consultez notre équipe pour connaître la marche à suivre.';
  return isSupportedIdentityRequirement(error.requirement) ? message
    : `${message} Cette exigence ne peut pas être corrigée avec l’envoi de pièce proposé ici ; contactez notre équipe.`;
}

export function identityDocumentNeedsBack(status: IdentityDocumentRequirements): boolean {
  return getActionableRequirements(status).includes('individual.verification.document.back') ||
    (status.verificationErrors ?? []).some(error => isSupportedIdentityRequirement(error.requirement) &&
      ['missing_back', 'verification_document_missing_back'].includes(error.code));
}

/** Traduit un `disabled_reason` Stripe en phrase FR, ou null si non pertinent. */
export function translateDisabledReason(reason: string | null): string | null {
  if (!reason) return null;
  const map: Record<string, string> = {
    'requirements.past_due':
      'Des informations sont en retard. Consultez les corrections demandées et actualisez le statut après les avoir fournies.',
    'requirements.pending_verification':
      'Vos renseignements sont en cours de vérification.',
    'rejected.fraud': 'Votre compte a été restreint pour suspicion de fraude.',
    'rejected.terms_of_service':
      "Votre compte a été restreint pour non-respect des conditions d'utilisation.",
    'rejected.listed': 'Votre compte a été restreint.',
    'rejected.other': 'Votre compte a été restreint.',
    'listed': 'Votre compte est en cours de revue.',
    'under_review': 'Votre compte est en cours d’examen.',
    'platform_paused': 'Les paiements sont momentanément suspendus.',
    'other': 'Une action est requise pour réactiver vos paiements.',
  };
  return map[reason] ?? 'Une action est requise pour réactiver vos paiements.';
}

/** État technique du compte ; aucun de ces statuts ne prouve sa propriété. */
export function translateBankStatus(status: string | null): string | null {
  if (!status) return null;
  const map: Record<string, string> = {
    new: 'Compte enregistré',
    validated: 'Coordonnées acceptées par le prestataire',
    verified: 'Statut technique accepté par le prestataire',
    verification_failed: 'Coordonnées à corriger',
    errored: 'Retrait en erreur — compte à examiner',
    tokenized_account_number_deactivated: 'Compte désactivé — coordonnées à corriger',
  };
  return map[status] ?? null;
}
