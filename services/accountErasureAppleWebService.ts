import {fetch as expoFetch} from 'expo/fetch';
import {auth} from '@/config/firebaseConfig';
import {runtimeEnvironment} from '@/config/firebaseEnvironment';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import {AccountErasureJournal} from '@/services/accountErasureJournal';
import {accountErasureEndpoint} from '@/services/accountErasureService';
import type {AccountErasureAttempt} from '@/types/accountErasure';
import {ACCOUNT_ERASURE_APPLE_WEB, ACCOUNT_ERASURE_APPLE_WEB_PROJECTS} from '@/types/accountErasureAppleWeb';
import type {AccountErasureAppleWebStartReceipt} from '@/types/accountErasureAppleWeb';

const failed = () => new Error('L’ouverture de l’autorisation Apple n’est pas confirmée. Vérifiez le suivi de cette même demande.');
export function validAppleWebStartReceipt(value: unknown): value is AccountErasureAppleWebStartReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>, project = runtimeEnvironment.projectId;
  if (Object.keys(result).sort().join(',') !== 'browserUrl,capability,challengeId,expiresAt' ||
      result.capability !== ACCOUNT_ERASURE_APPLE_WEB || typeof result.challengeId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(result.challengeId) || typeof result.browserUrl !== 'string' ||
      result.browserUrl.length > 700 || typeof result.expiresAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(result.expiresAt) ||
      !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now() ||
      Date.parse(result.expiresAt) > Date.now() + 360_000 || !Object.hasOwn(ACCOUNT_ERASURE_APPLE_WEB_PROJECTS, project)) return false;
  try {
    const url = new URL(result.browserUrl), expected = ACCOUNT_ERASURE_APPLE_WEB_PROJECTS[project as keyof typeof ACCOUNT_ERASURE_APPLE_WEB_PROJECTS];
    const params = new URLSearchParams(url.hash.slice(1));
    return url.origin === expected.origin && !url.username && !url.password && !url.search &&
      url.pathname === '/account-erasure-apple' && [...params.keys()].sort().join(',') === 'cap,challengeId' &&
      params.get('challengeId') === result.challengeId && /^[A-Za-z0-9_-]{43}$/.test(params.get('cap') ?? '');
  } catch {return false;}
}

/** Only opens authorization for an existing, confirmed order. No new erasure,
 * key rotation or Firebase session handoff is supported by this transport. */
export const AccountErasureAppleWebService = {
  async start(attempt: AccountErasureAttempt, assertView: () => void): Promise<AccountErasureAppleWebStartReceipt> {
    const owner = auth.currentUser, generation = getAuthSessionGeneration();
    const check = () => {
      assertView(); const state = useAuthStore.getState();
      if (!owner || auth.currentUser !== owner || owner.uid !== attempt.ownerId || state.isLoading ||
          state.authenticatedUid !== owner.uid || generation !== getAuthSessionGeneration()) throw failed();
    };
    check();
    if (attempt.phase !== 'submitted' || !attempt.receipt?.appleAuthorizationRequired || attempt.receipt.deletionComplete ||
        !owner!.providerData.some(provider => provider.providerId === 'apple.com') ||
        !owner!.providerData.some(provider => provider.providerId === 'password') || runtimeEnvironment.useEmulators) throw failed();
    const token = await owner!.getIdToken(true); check();
    const reference = await AccountErasureJournal.payload(attempt, 'observe', check); check();
    const payload = {capability: ACCOUNT_ERASURE_APPLE_WEB, purpose: 'authorize_existing', expectedUid: attempt.ownerId,
      requestId: reference.requestId, commandId: reference.commandId, observationKey: reference.observationKey, confirmed: true};
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const result = await expoFetch(accountErasureEndpoint().replace(/deleteUserAccountV2$/, 'startAccountErasureAppleWeb'), {
        method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({data: payload}),
      });
      check(); const raw = await result.text(); check(); if (raw.length > 8_000) throw failed();
      let parsed: unknown; try {parsed = JSON.parse(raw);} catch {throw failed();}
      if (!result.ok || !parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).join(',') !== 'result' ||
          !validAppleWebStartReceipt((parsed as Record<string, unknown>).result)) throw failed();
      return (parsed as {result: AccountErasureAppleWebStartReceipt}).result;
    } catch {check(); throw failed();} finally {clearTimeout(timer);}
  },
};
