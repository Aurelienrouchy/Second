/**
 * Contextual messages for auth triggers
 * These messages explain why the user needs to create an account
 */
export const AUTH_MESSAGES = {
  like: "Crée un compte pour sauvegarder tes coups de coeur",
  message: "Inscris-toi pour contacter le vendeur",
  buy: "Crée un compte pour finaliser ton achat",
  sell: "Inscris-toi pour vendre tes articles",
  follow: "Crée un compte pour suivre ce vendeur",
  swapParty: "Inscris-toi pour participer à cette Swap Party",
  saveSearch: "Crée un compte pour sauvegarder tes recherches",
  default: "Connecte-toi pour continuer",
} as const;

export type AuthMessageKey = keyof typeof AUTH_MESSAGES;
