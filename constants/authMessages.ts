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
