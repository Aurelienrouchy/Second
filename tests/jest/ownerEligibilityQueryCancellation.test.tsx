import React from 'react';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react-native';
import {CancelledError, QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {httpsCallable} from 'firebase/functions';
import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import {useEligibility} from '@/hooks/useEligibility';
import {queryKeys} from '@/lib/queryKeys';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {EligibilityDecision, EligibilityScope, OwnerEligibility} from '@/types/eligibility';

function nativeEligibility(version: string): OwnerEligibility {
  const decision = (scope: EligibilityScope): EligibilityDecision => ({scope, allowed: false, status: 'incomplete', reasons: ['age_missing'], messages: [], policyVersion: 'fixture-policy', civilDate: null, evaluationStage: 'foundations'});
  return {version, policyVersion: 'fixture-policy', statementVersion: 'fixture-statement', statements: {personal: 'Particulier', professional: 'Professionnel'},
    dateOfBirth: null, dateOfBirthCopy: {type: 'missing', value: null}, dateOfBirthSource: 'missing', dateOfBirthVerified: false,
    firstDateOfBirthAction: 'recordSignupConsent', initialDateRequiresTermsAndPrivacy: true, activityDeclaration: null, sellerQuebecEvidence: null,
    decisions: {buy: decision('buy'), sell: decision('sell'), new_paid_shipping: decision('new_paid_shipping')}};
}
let client: QueryClient;
const onError = jest.fn(), rpc = jest.fn();
function wrapper({children}: {children: React.ReactNode}) {return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(() => {
  establishIdentityFixture('A'); onError.mockClear(); rpc.mockReset().mockResolvedValue({data: nativeEligibility('b'.repeat(64))});
  (httpsCallable as jest.Mock).mockImplementation((_functions: unknown, name: string) => {
    if (name !== 'getMyEligibility') throw new Error(`Unexpected query RPC: ${name}`);
    return rpc;
  });
  client = new QueryClient({queryCache: new QueryCache({onError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {cleanup(); client.clear(); clearIdentityFixture();});

it.each(['uid', 'generation', 'sdk-only', 'unmount'] as const)('cancels the real owner query after %s loss without reporting a current provider failure', async loss => {
  let release!: (value: {data: OwnerEligibility}) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => {release = resolve;}));
  const view = renderHook(() => useEligibility(), {wrapper}); await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  const oldKey = client.getQueryCache().findAll({queryKey: queryKeys.eligibility.owner('A')})[0].queryKey;
  const joined = client.fetchQuery({queryKey: oldKey}), rejected = expect(joined).rejects.toBeInstanceOf(CancelledError);
  if (loss === 'uid') act(() => establishIdentityFixture('B'));
  if (loss === 'generation') act(() => {useAuthStore.getState().reset(); establishIdentityFixture('A');});
  if (loss === 'sdk-only') Object.assign(auth, {currentUser: {...auth.currentUser, uid: 'B'}});
  if (loss === 'unmount') view.unmount();
  await act(async () => {release({data: nativeEligibility('a'.repeat(64))}); await rejected;});
  expect(onError).not.toHaveBeenCalled(); expect(client.getQueryData(oldKey)).toBeUndefined();
  if (loss === 'uid' || loss === 'generation') {
    await waitFor(() => expect(view.result.current.data?.version).toBe('b'.repeat(64)));
    expect(rpc).toHaveBeenCalledTimes(2);
  }
});

it('keeps a genuine current server refusal visible, including its original error code', async () => {
  const failure = Object.assign(new Error('Refus actuel du serveur'), {code: 'functions/unauthenticated'});
  rpc.mockRejectedValueOnce(failure); const {result} = renderHook(() => useEligibility(), {wrapper});
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBe(failure); expect(onError).toHaveBeenCalledWith(failure, expect.anything());
});
