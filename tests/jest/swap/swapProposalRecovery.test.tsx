jest.mock('@/services/devPushDestinationService', () => ({removeDevPushDestination: jest.fn()}));
import {callableIO, establishSession, resetEnvironment} from '../auth-onboarding/eligibilityTestHarness';
import {acceptSwap, getPendingSwapProposal, proposeSwap, type SwapProposalCommand} from '@/services/swapService';
const command: SwapProposalCommand = {initiatorId: 'owner', initiatorName: 'Moi', initiatorItems: [{articleId: 'a', title: 'A', price: 20}], receiverId: 'other', receiverName: 'Camille', receiverItems: [{articleId: 'b', title: 'B', price: 20}], expectedUid: 'owner', exchangeMode: 'hand_delivery', arrangements: 'Métro, samedi', agreementProtocol: 'swap_exchange_agreement_v1', expectedSourceHash: 'a'.repeat(64), clientRequestId: 'same-native-request'};
beforeEach(async () => {await resetEnvironment(); await establishSession('owner');});
it('journals the exact intention before the RPC and preserves it after an unknown response', async () => {
 callableIO.mockImplementation(async () => {expect(await getPendingSwapProposal('owner', () => {})).toMatchObject(command); throw new Error('network unavailable');});
 await expect(proposeSwap(command)).rejects.toThrow('network');
 const pending = await getPendingSwapProposal('owner', () => {}); expect(pending).toMatchObject(command);
});
it('replays the same request and clears only the confirmed same command', async () => {
 callableIO.mockRejectedValueOnce(new Error('network unavailable'));
 await expect(proposeSwap(command)).rejects.toThrow('network');
 const pending = await getPendingSwapProposal('owner', () => {}); callableIO.mockResolvedValue({data: {success: true, swapId: 'same-swap'}});
 await expect(proposeSwap(pending!)).resolves.toBe('same-swap');
 expect(callableIO.mock.calls[1][1]).toEqual(callableIO.mock.calls[0][1]); expect(await getPendingSwapProposal('owner', () => {})).toBeNull();
});
it('does not dispatch another proposal over an uncertain saved intention', async () => {
 callableIO.mockRejectedValueOnce(new Error('network unavailable')); await expect(proposeSwap(command)).rejects.toThrow();
 await expect(proposeSwap({...command, clientRequestId: 'another', message: 'different'})).rejects.toThrow('proposition en cours'); expect(callableIO).toHaveBeenCalledTimes(1);
});
it('does not erase an uncertain command after identity changed', async () => {
 let release!: (v: {data: unknown}) => void;
 callableIO.mockImplementation(() => new Promise(resolve => {release = resolve;}));
 const operation = proposeSwap(command); const assertion = expect(operation).rejects.toThrow();
 while (!release) await Promise.resolve();
 await establishSession('other'); release({data: {success: true, swapId: 'same-swap'}}); await assertion;
 await establishSession('owner'); expect(await getPendingSwapProposal('owner', () => {})).toMatchObject(command);
});

it('accepts the native direct postal preparation reply without labelling it a malformed acceptance', async () => {
 callableIO.mockResolvedValue({data: {success: true, status: 'photos_pending', requiresPayment: false, replay: false}});
 await expect(acceptSwap('swap', {expectedUid: 'owner', agreementProtocol: 'swap_exchange_agreement_v1', expectedSourceHash: 'a'.repeat(64)})).resolves.toEqual({status: 'photos_pending', requiresPayment: false, replay: false});
});
