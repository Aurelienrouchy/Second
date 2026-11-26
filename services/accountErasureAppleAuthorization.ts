import type {User as FirebaseUser} from 'firebase/auth';
import type {AccountErasureAttempt} from '@/types/accountErasure';

/** Opaque, nonserializable in-memory ticket. The provider code is held only in
 * this WeakMap and is consumed once by the dedicated authorize_apple request. */
export interface AppleErasureAuthorization {readonly kind: 'apple_erasure_authorization_v1'}
interface Secret {owner: FirebaseUser; generation: number; ownerId: string; commandId: string; requestId: string;
  code: string; expiresAt: number}
const codes = new WeakMap<AppleErasureAuthorization, Secret>();
const lifetimeMs = 120_000;
export function issueAppleErasureAuthorization(attempt: Pick<AccountErasureAttempt, 'ownerId' | 'commandId' | 'requestId'>,
  owner: FirebaseUser, generation: number, code: string): AppleErasureAuthorization {
  if (owner.uid !== attempt.ownerId || !owner.providerData.some(provider => provider.providerId === 'apple.com') ||
      typeof code !== 'string' || code.length < 8 || code.length > 4096 || /[\r\n\0]/.test(code)) {
    throw new Error('Une nouvelle autorisation Apple est nécessaire.');
  }
  const ticket = Object.freeze({kind: 'apple_erasure_authorization_v1' as const});
  codes.set(ticket, {...attempt, owner, generation, code, expiresAt: Date.now() + lifetimeMs});
  return ticket;
}
export function discardAppleErasureAuthorization(ticket: AppleErasureAuthorization | null): void {
  if (ticket) codes.delete(ticket);
}
export function consumeAppleErasureAuthorization(ticket: AppleErasureAuthorization, attempt: AccountErasureAttempt,
  owner: FirebaseUser, generation: number): string {
  const secret = codes.get(ticket); codes.delete(ticket);
  if (!secret || secret.expiresAt <= Date.now() || secret.expiresAt - Date.now() > lifetimeMs || secret.owner !== owner ||
      secret.generation !== generation || secret.ownerId !== attempt.ownerId || secret.commandId !== attempt.commandId ||
      secret.requestId !== attempt.requestId || owner.uid !== attempt.ownerId ||
      !owner.providerData.some(provider => provider.providerId === 'apple.com')) {
    throw new Error('Confirmez à nouveau votre autorisation Apple pour cette demande.');
  }
  return secret.code;
}
