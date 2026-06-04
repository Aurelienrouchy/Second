/**
 * Contextual messages for auth triggers
 * These messages explain why the user needs to create an account
 */
export const AUTH_MESSAGES = {
  like: "Créez un compte pour sauvegarder vos coups de coeur",
  message: "Inscrivez-vous pour contacter le vendeur",
  buy: "Créez un compte pour finaliser votre achat",
  sell: "Inscrivez-vous pour vendre vos articles",
  follow: "Créez un compte pour suivre ce vendeur",
  swapParty: "Inscrivez-vous pour participer à la Swap Zone",
  saveSearch: "Créez un compte pour sauvegarder vos recherches",
  default: "Connectez-vous pour continuer",
} as const;

export type AuthMessageKey = keyof typeof AUTH_MESSAGES;

/**
 * Consent + age gate copy (rédigé par le juriste — ne pas modifier/paraphraser).
 */
export const COPY_CONSENT = {
  dobLabel: 'Date de naissance',
  ageError: 'Vous devez avoir au moins 16 ans pour utiliser Second.',
  termsPrefix: "J'ai lu et j'accepte les ",
  termsLink: "Conditions d'utilisation",
  termsSuffix: '.',
  privacyPrefix: "J'ai lu et j'accepte la ",
  privacyLink: 'Politique de confidentialité',
  privacySuffix: '.',
  marketing:
    "J'accepte de recevoir des offres, baisses de prix et nouveautés (vous pouvez vous désabonner à tout moment).",
} as const;

/**
 * Sell gate copy for 16-17 year olds (rédigé par le juriste — ne pas modifier).
 */
export const COPY_SELL_GATE =
  "La vente d'articles est réservée aux personnes de 18 ans et plus, car notre partenaire de paiement Stripe exige cet âge pour ouvrir un compte de versement. Vous pouvez continuer à acheter et naviguer sur Second.";

/**
 * Username choice + consent route copy (figée par le designer — ne pas paraphraser).
 *
 * Used by the mandatory post-signup route (app/complete-profile.tsx) where the
 * user picks their @handle, enters their DOB and accepts the consents. The
 * @handle is then RESERVED server-side and immutable (recordSignupConsent +
 * usernames registry).
 *
 * Validation constants below mirror the backend
 * (functions/src/callable/username.ts): USERNAME_MIN_LEN=3,
 * CHOSEN_USERNAME_MAX_LEN=20, charset [a-z0-9._-], no leading/trailing/doubled
 * separator, lowercase. The server is the source of truth; these are duplicated
 * here for client-side UX validation only (the backend module cannot be
 * imported into the app bundle).
 */
export const COPY_USERNAME = {
  title: 'Avant de continuer',
  message:
    'Choisissez votre pseudo, indiquez votre date de naissance et acceptez nos conditions.',
  label: 'Choisissez votre pseudo',
  placeholder: 'votre.pseudo',
  helper:
    '3 à 20 caractères. Lettres minuscules, chiffres, et . _ - uniquement.',
  immutability:
    "C'est l'identifiant unique avec lequel on vous retrouvera. Il ne pourra plus être modifié.",
  errTooShort: 'Au moins 3 caractères.',
  errInvalidChars: 'Lettres minuscules, chiffres, et . _ - uniquement.',
  errTaken: 'Ce pseudo est déjà pris.',
  errNetwork: 'Vérification impossible. Réessayez.',
  cta: 'CONTINUER',
  displayNameHint: 'Votre nom public. Vous pourrez le changer plus tard.',
} as const;

// ── Username validation (mirror of functions/src/callable/username.ts) ──
// Source of truth = backend (validateChosenUsername). Duplicated here for the
// live availability check + local pre-validation only. Keep in sync.
export const USERNAME_MIN_LEN = 3;
export const CHOSEN_USERNAME_MAX_LEN = 20;
/** Allowed character class: lowercase letters, digits and . _ - */
export const USERNAME_CHARSET = /^[a-z0-9._-]+$/;
/** A separator (. _ -) may not lead, trail, or be doubled. */
export const USERNAME_SEPARATOR = /[._-]/;
export const USERNAME_DOUBLED_SEPARATOR = /[._-]{2,}/;

/** Mirrors UsernameRejectionReason from the backend. */
export type UsernameRejectionReason = 'too_short' | 'too_long' | 'invalid_chars';

/**
 * Client-side mirror of the backend `validateChosenUsername`. Trims + lowercases,
 * then applies the same rules in the same priority order so the returned reason
 * is deterministic. The server re-validates on submit (it remains the authority).
 */
export function validateChosenUsernameLocal(
  input: string,
): { valid: true; username: string } | { valid: false; reason: UsernameRejectionReason } {
  const raw = input.trim().toLowerCase();
  if (raw.length < USERNAME_MIN_LEN) {
    return { valid: false, reason: 'too_short' };
  }
  if (raw.length > CHOSEN_USERNAME_MAX_LEN) {
    return { valid: false, reason: 'too_long' };
  }
  if (!USERNAME_CHARSET.test(raw)) {
    return { valid: false, reason: 'invalid_chars' };
  }
  if (
    USERNAME_SEPARATOR.test(raw[0]) ||
    USERNAME_SEPARATOR.test(raw[raw.length - 1])
  ) {
    return { valid: false, reason: 'invalid_chars' };
  }
  if (USERNAME_DOUBLED_SEPARATOR.test(raw)) {
    return { valid: false, reason: 'invalid_chars' };
  }
  return { valid: true, username: raw };
}
