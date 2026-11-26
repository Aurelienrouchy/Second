/** Public wire contract. A Web capability authorizes ONE Apple authorization
 * for the same erasure intention; it never authorizes a Firebase session. */
export const ACCOUNT_ERASURE_APPLE_WEB = 'account_erasure_apple_web_v1' as const;
export type AccountErasureAppleWebStart = {
  capability: typeof ACCOUNT_ERASURE_APPLE_WEB;
  purpose: 'authorize_existing';
  expectedUid: string;
  requestId: string;
  commandId: string;
  observationKey: string;
  confirmed: true;
};
export type AccountErasureAppleWebStartReceipt = {
  capability: typeof ACCOUNT_ERASURE_APPLE_WEB;
  challengeId: string;
  browserUrl: string;
  expiresAt: string;
};
export type AccountErasureAppleWebCapability = {
  capability: typeof ACCOUNT_ERASURE_APPLE_WEB;
  challengeId: string;
  cap: string;
};
export type AccountErasureAppleWebConfiguration = {
  capability: typeof ACCOUNT_ERASURE_APPLE_WEB;
  challengeId: string;
  expiresAt: string;
  apple: {clientId:string;redirectURI:string;state:string;nonce:string;usePopup:true};
};
export type AccountErasureAppleWebComplete = AccountErasureAppleWebCapability & {
  code: string;
  id_token: string;
  state: string;
};
export type AccountErasureAppleWebAuthorizationReceipt = {
  capability: typeof ACCOUNT_ERASURE_APPLE_WEB;
  challengeId: string;
  authorizationReceived: true;
};
export const ACCOUNT_ERASURE_APPLE_WEB_PROJECTS = {
  'seconde-b47a6': {origin:'https://seconde-b47a6.firebaseapp.com',clientId:'com.seconde.app.auth',keyId:'JSAN734TGM'},
  'seconde-dev': {origin:'https://seconde-dev.firebaseapp.com',clientId:'com.seconde.app.dev.auth',keyId:'4QU6688YNR'},
} as const;
export const ACCOUNT_ERASURE_APPLE_WEB_PATH = '/account-erasure-apple';
export const ACCOUNT_ERASURE_APPLE_WEB_CALLBACK_PATH = '/account-erasure-apple/callback';
