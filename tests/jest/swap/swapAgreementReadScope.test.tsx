jest.mock('@/services/devPushDestinationService', () => ({removeDevPushDestination: jest.fn()}));
import {callableIO, clearQueryClients, deferred, establishSession, queryWrapper, resetEnvironment} from '../auth-onboarding/eligibilityTestHarness';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {AppState} from 'react-native';
import {useSwapAgreement} from '@/features/swap/hooks/useSwapAgreement';
import type {SwapAgreementPreview, SwapProposalPreviewInput} from '@/types/swap';
const input: SwapProposalPreviewInput = {operation: 'swap_proposal_preview', expectedUid: 'owner', receiverId: 'other', initiatorArticleIds: ['a'], receiverArticleIds: ['b'], exchangeMode: 'hand_delivery', arrangements: 'Métro, samedi', message: null};
const preview: SwapAgreementPreview = {protocol: 'swap_exchange_agreement_v1', scope: 'new_proposal', sourceHash: 'a'.repeat(64), termsVersion: '2026-10-17.v1', termsText: 'Modalités', exchangeMode: input.exchangeMode, arrangements: input.arrangements, initiatorId: 'owner', receiverId: 'other', initiatorItems: [{articleId: 'a', title: 'A', price: 20}], receiverItems: [{articleId: 'b', title: 'B', price: 20}], cashTopUp: null, message: null};
beforeEach(async () => {await resetEnvironment(); await establishSession('owner'); Object.defineProperty(AppState, 'currentState', {value: 'active', configurable: true, writable: true});});
afterEach(clearQueryClients);
it('does not issue two previews or a spurious failure on a same-frame double press', async () => {
 const io = deferred<{data: unknown}>(); callableIO.mockReturnValue(io.promise); const {Wrapper} = queryWrapper();
 const hook = renderHook(() => useSwapAgreement('owner', 'source'), {wrapper: Wrapper});
 let first!: Promise<void>; let second!: Promise<void>;
 act(() => {first = hook.result.current.read(input); second = hook.result.current.read(input);});
 await waitFor(() => expect(callableIO).toHaveBeenCalledTimes(1));
 await act(async () => {io.resolve({data: {swapProposalPreview: preview}}); await first; await second;});
 expect(hook.result.current.preview).toEqual(preview); expect(hook.result.current.accepted).toBe(false);
});
it('cancels a late former-source read without adopting it or making it a current query error', async () => {
 const io = deferred<{data: unknown}>(); callableIO.mockReturnValue(io.promise); const {Wrapper, client} = queryWrapper();
 const hook = renderHook(({source}) => useSwapAgreement('owner', source), {initialProps: {source: 'before'}, wrapper: Wrapper});
 let request!: Promise<void>; act(() => {request = hook.result.current.read(input);});
 const assertion = expect(request).rejects.toMatchObject({silent: true});
 await waitFor(() => expect(callableIO).toHaveBeenCalledTimes(1)); hook.rerender({source: 'after'});
 await act(async () => {io.resolve({data: {swapProposalPreview: preview}}); await assertion;});
 expect(hook.result.current.preview).toBeNull(); expect(hook.result.current.accepted).toBe(false);
 expect(client.getQueryCache().getAll().every(query => query.state.error === null)).toBe(true);
});
