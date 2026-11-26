import AsyncStorage from '@/utils/environmentStorage';
import sellerActivityPolicy from '@/functions/src/shared/sellerActivityPolicy.json';
import signupConsentPolicy from '@/functions/src/shared/signupConsentPolicy.json';
import { validateChosenUsernameLocal } from '@/constants/authMessages';

export { sellerActivityPolicy, signupConsentPolicy };

export interface SignupConsent {
  dateOfBirth: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingOptIn: boolean;
  desiredUsername?: string;
  policyVersion: string;
  sellerActivityDeclaration: {
    kind: 'personal';
    statementVersion: string;
    personalDeclarationAccepted: boolean;
    expectedVersion: string;
    requestId: string;
    expectedUid: string;
  };
}

const invalidJournal = () => Object.assign(new Error('Votre inscription précédente ne peut pas être vérifiée. Réessayez sans modifier vos choix.'), { code: 'client/signup-journal-invalid' });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keyFor = (uid: string) => `signup_consent_${uid}`;

/** Only an explicit signup submission can create this immutable retry payload. */
export function parseSignupConsent(value: unknown, uid: string): SignupConsent {
  if (!object(value) || typeof value.dateOfBirth !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.dateOfBirth) ||
      value.acceptedTerms !== true || value.acceptedPrivacy !== true || typeof value.marketingOptIn !== 'boolean' ||
      value.policyVersion !== signupConsentPolicy.version ||
      value.desiredUsername !== undefined && (typeof value.desiredUsername !== 'string' ||
        value.desiredUsername !== value.desiredUsername.trim().toLowerCase() || !validateChosenUsernameLocal(value.desiredUsername).valid)) throw invalidJournal();
  const declaration = value.sellerActivityDeclaration;
  if (!object(declaration) || declaration.kind !== 'personal' || declaration.statementVersion !== sellerActivityPolicy.version ||
      declaration.personalDeclarationAccepted !== true || declaration.expectedUid !== uid ||
      typeof declaration.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(declaration.expectedVersion) ||
      typeof declaration.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(declaration.requestId)) throw invalidJournal();
  return {
    dateOfBirth: value.dateOfBirth, acceptedTerms: true, acceptedPrivacy: true, marketingOptIn: value.marketingOptIn,
    policyVersion: signupConsentPolicy.version,
    ...(value.desiredUsername !== undefined ? { desiredUsername: value.desiredUsername as string } : {}),
    sellerActivityDeclaration: {kind: 'personal', statementVersion: sellerActivityPolicy.version, personalDeclarationAccepted: true,
      expectedVersion: declaration.expectedVersion, requestId: declaration.requestId, expectedUid: uid},
  };
}

export async function readSignupConsent(uid: string): Promise<SignupConsent | null> {
  const saved = await AsyncStorage.getItem(keyFor(uid));
  if (saved === null) return null;
  let value: unknown;
  try { value = JSON.parse(saved); } catch { throw invalidJournal(); }
  if (!object(value) || value.protocol !== 'signup_consent_v1' || value.uid !== uid ||
      value.statement !== sellerActivityPolicy.statements.personal) throw invalidJournal();
  return parseSignupConsent(value.payload, uid);
}

export async function writeSignupConsent(uid: string, payload: SignupConsent): Promise<void> {
  await AsyncStorage.setItem(keyFor(uid), JSON.stringify({protocol: 'signup_consent_v1', uid,
    statement: sellerActivityPolicy.statements.personal, payload}));
}

export async function clearSignupConsent(uid: string): Promise<void> {
  await AsyncStorage.removeItem(keyFor(uid));
}

/** A refused command may be edited; a lost response must retain the exact command. */
export function isDefinitiveSignupRefusal(error: unknown): boolean {
  const code = object(error) ? error.code : null;
  if (typeof code !== 'string') return false;
  const normalized = code.replace(/^functions\//, '');
  const details = object(error) && object(error.details) ? error.details : null;
  if (normalized === 'already-exists') return details?.field === 'username';
  if (normalized === 'aborted') return details?.reason === 'eligibility_version_changed';
  return ['invalid-argument', 'failed-precondition', 'permission-denied', 'out-of-range'].includes(normalized);
}
