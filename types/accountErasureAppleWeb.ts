/** Mirrors the public Apple Web contract; no Functions runtime in the app. */
export const ACCOUNT_ERASURE_APPLE_WEB = 'account_erasure_apple_web_v1' as const;
export const ACCOUNT_ERASURE_APPLE_WEB_PROJECTS = {
  'seconde-b47a6': {origin: 'https://seconde-b47a6.firebaseapp.com', clientId: 'com.seconde.app.auth'},
  'seconde-dev': {origin: 'https://seconde-dev.firebaseapp.com', clientId: 'com.seconde.app.dev.auth'},
} as const;
export interface AccountErasureAppleWebStartReceipt {
  capability: typeof ACCOUNT_ERASURE_APPLE_WEB;
  challengeId: string;
  browserUrl: string;
  expiresAt: string;
}
