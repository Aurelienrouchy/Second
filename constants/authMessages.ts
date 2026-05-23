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
  swapParty: "Inscrivez-vous pour participer à cette Swap Party",
  saveSearch: "Créez un compte pour sauvegarder vos recherches",
  default: "Connectez-vous pour continuer",
} as const;

export type AuthMessageKey = keyof typeof AUTH_MESSAGES;
