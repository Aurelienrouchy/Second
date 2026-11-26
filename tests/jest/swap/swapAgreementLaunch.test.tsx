import { activityRecorded, callableIO, clearQueryClients, deferred, establishSession, ownerEligibility, queryWrapper, resetEnvironment } from '../auth-onboarding/eligibilityTestHarness';
import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { acceptSwap, getSwapAgreementPreview, proposeSwap } from '@/services/swapService';
import { EligibilityService } from '@/services/eligibilityService';
import { useSwapAgreement } from '@/features/swap/hooks/useSwapAgreement';
import type { SwapAgreementPreview, SwapProposalPreviewInput } from '@/types/swap';

const input: SwapProposalPreviewInput = {operation: 'swap_proposal_preview', expectedUid: 'owner', receiverId: 'other',
  initiatorArticleIds: ['mine'], receiverArticleIds: ['theirs'], exchangeMode: 'shipping', arrangements: 'Envoi et frais convenus par les membres.', message: 'Bonjour.'};
const preview: SwapAgreementPreview = {protocol: 'swap_exchange_agreement_v1', scope: 'new_proposal', sourceHash: 'a'.repeat(64),
  termsVersion: '2026-10-17.v1', termsText: 'L’expédition et la réception ont lieu au Québec.', exchangeMode: 'shipping', arrangements: input.arrangements,
  initiatorId: 'owner', receiverId: 'other', initiatorItems: [{articleId: 'mine', title: 'Article natif A', description: 'Description native A', price: 30}],
  receiverItems: [{articleId: 'theirs', title: 'Article natif B', description: 'Description native B', price: 40}], cashTopUp: null, message: 'Bonjour.'};
beforeEach(async () => {await resetEnvironment(); await establishSession('owner'); Object.defineProperty(AppState, 'currentState', {value: 'active', configurable: true, writable: true});});
afterEach(clearQueryClients);

it('reads only getMyEligibility and rejects an old ordinary DTO without any mutation fallback', async () => {
  callableIO.mockResolvedValue({data: ownerEligibility()});
  await expect(getSwapAgreementPreview(input)).rejects.toThrow('conditions');
  expect(callableIO.mock.calls).toEqual([['getMyEligibility', input]]);
});

it('binds native articles and exact message to the preview and refuses a changed message', async () => {
  callableIO.mockResolvedValue({data: {swapProposalPreview: preview}});
  await expect(getSwapAgreementPreview(input)).resolves.toEqual(preview);
  await expect(getSwapAgreementPreview({...input, message: 'Autre condition'})).rejects.toThrow('changé');
});

it('loses consent synchronously when editing and on source replacement, including old callbacks', () => {
  const {Wrapper} = queryWrapper();
  const hook = renderHook(({source}) => useSwapAgreement('owner', source), {initialProps: {source: 'source-a'}, wrapper: Wrapper});
  act(() => hook.result.current.show(preview)); act(() => hook.result.current.toggle());
  const old = hook.result.current.captureConsent();
  act(() => hook.result.current.invalidate()); expect(old.assertCurrent).toThrow();
  act(() => hook.result.current.show(preview)); act(() => hook.result.current.toggle());
  const previous = hook.result.current.captureConsent();
  hook.rerender({source: 'source-b'}); expect(hook.result.current.accepted).toBe(false); expect(previous.assertCurrent).toThrow();
});

it('checks SDK identity after IO and transmits explicit acknowledgement on proposal', async () => {
  const response = deferred<{data: unknown}>(); callableIO.mockReturnValue(response.promise);
  const operation = proposeSwap({initiatorId: 'owner', initiatorName: 'Moi', initiatorItems: preview.initiatorItems,
    receiverId: 'other', receiverName: 'Membre', receiverItems: preview.receiverItems, expectedUid: 'owner',
    agreementProtocol: preview.protocol, expectedSourceHash: preview.sourceHash, exchangeMode: preview.exchangeMode, arrangements: preview.arrangements});
  const assertion = expect(operation).rejects.toThrow('session');
  await waitFor(() => expect(callableIO).toHaveBeenCalledTimes(1));
  await establishSession('other'); response.resolve({data: {success: true, swapId: 'recorded'}}); await assertion;
  expect(callableIO.mock.calls[0][1]).toMatchObject({expectedUid: 'owner', expectedSourceHash: preview.sourceHash, exchangeMode: 'shipping'});
});

it('qualifies historical acceptance replay using its actual later status', async () => {
  callableIO.mockResolvedValue({data: {success: true, status: 'completed', requiresPayment: false, replay: true}});
  await expect(acceptSwap('swap', {expectedUid: 'owner', agreementProtocol: preview.protocol, expectedSourceHash: preview.sourceHash}))
    .resolves.toEqual({status: 'completed', requiresPayment: false, replay: true});
});

it('keeps its own native commit valid before the RPC response but rejects a changed agreement source', async () => {
  const {Wrapper} = queryWrapper();
  const hook = renderHook(({observed}: {observed: SwapAgreementPreview | null}) => useSwapAgreement('owner', 'immutable-contract', observed),
    {initialProps: {observed: null}, wrapper: Wrapper});
  act(() => hook.result.current.show(preview)); act(() => hook.result.current.toggle());
  const consent = hook.result.current.captureConsent(), response = deferred<{data: unknown}>(); callableIO.mockReturnValue(response.promise);
  const operation = acceptSwap('swap', consent.acknowledgement, consent.assertCurrent);
  // Models onSnapshot delivering an own first legacy acknowledgement before RPC completion.
  hook.rerender({observed: preview}); expect(consent.assertCurrent).not.toThrow();
  response.resolve({data: {success: true, status: 'accepted', requiresPayment: false, replay: false}});
  await expect(operation).resolves.toMatchObject({status: 'accepted'});
  // A progression acknowledgement is outside the immutable source descriptor.
  hook.rerender({observed: {...preview}}); expect(consent.assertCurrent).not.toThrow();
  hook.rerender({observed: {...preview, sourceHash: 'b'.repeat(64)}}); expect(consent.assertCurrent).toThrow();
});

it('keeps the complete explicit residence withdrawal payload and preserves legacy omission', async () => {
  callableIO.mockImplementation(async (_name, payload) => ({data: activityRecorded(payload as import('@/types/eligibility').DeclareSellerActivityInput, ownerEligibility())}));
  const legacy = {kind: 'personal' as const, statementVersion: 'v1', personalDeclarationAccepted: true, expectedVersion: 'a'.repeat(64), requestId: 'request'};
  await EligibilityService.declareActivity('owner', legacy);
  expect(callableIO.mock.calls[0][1]).toEqual(legacy);
  const withdrawal = {...legacy, expectedUid: 'owner', quebecResidenceDeclaration: {version: '2026-10-17.v1' as const, country: 'CA' as const, province: 'QC' as const, accepted: false}};
  await EligibilityService.declareActivity('owner', withdrawal); expect(callableIO.mock.calls[1][1]).toEqual(withdrawal);
});
