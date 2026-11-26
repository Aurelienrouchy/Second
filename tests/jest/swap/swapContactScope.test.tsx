jest.mock('firebase/firestore', () => ({getDoc: jest.fn(), getDocFromServer: jest.fn(), getDocs: jest.fn(), runTransaction: jest.fn(), doc: jest.fn((_db, collection, id) => ({id, path: `${collection}/${id}`})), collection: jest.fn(), query: jest.fn(), where: jest.fn(), serverTimestamp: jest.fn(() => 'now'), updateDoc: jest.fn(async () => {}), arrayRemove: jest.fn()}));
jest.mock('@/services/devPushDestinationService', () => ({removeDevPushDestination: jest.fn()}));
jest.mock('@/services/moderationService', () => ({ModerationService: {areUsersBlocked: jest.fn(async () => false)}}));
import {callableIO, deferred, establishSession, resetEnvironment} from '../auth-onboarding/eligibilityTestHarness';
import {getDoc, getDocs, runTransaction} from 'firebase/firestore';
import {createOrGetChat} from '@/services/chat/conversation';
import {ModerationService} from '@/services/moderationService';
const none = {exists: () => false};
const chat = {exists: () => true, id: 'other__owner', data: () => ({participants: ['owner', 'other'], participantsInfo: []})};
beforeEach(async () => {
 await resetEnvironment(); await establishSession('owner');
 jest.mocked(ModerationService.areUsersBlocked).mockResolvedValue(false);
 jest.mocked(getDocs).mockResolvedValue({docs: []} as never);
 callableIO.mockResolvedValue({data: {profile: {displayName: 'Camille', profileImage: null}}});
});
it('rejects creation for a pair unrelated to the SDK owner before any read or write', async () => {
 await expect(createOrGetChat('a', 'b')).rejects.toThrow('session'); expect(getDoc).not.toHaveBeenCalled(); expect(runTransaction).not.toHaveBeenCalled();
});
it('does not publish an existing conversation after source/focus changed during the read', async () => {
 const read = deferred<typeof chat>(); jest.mocked(getDoc).mockReturnValueOnce(read.promise as never); let current = true;
 const request = createOrGetChat('owner', 'other', undefined, {expectedUid: 'owner', assertCurrent: () => {if (!current) throw new Error('gone');}});
 const assertion = expect(request).rejects.toThrow('gone'); await Promise.resolve(); current = false; read.resolve(chat); await assertion; expect(runTransaction).not.toHaveBeenCalled();
});
it('does not swallow identity loss inside the optional profile lookup', async () => {
 jest.mocked(getDoc).mockResolvedValue(none as never);
 const profile = deferred<{data: unknown}>(); callableIO.mockReturnValue(profile.promise);
 const request = createOrGetChat('owner', 'other'); const assertion = expect(request).rejects.toThrow('session');
 while (!callableIO.mock.calls.length) await Promise.resolve();
 await establishSession('other'); profile.resolve({data: {profile: {displayName: 'Camille', profileImage: null}}}); await assertion;
 expect(runTransaction).not.toHaveBeenCalled();
});
it('rechecks the owner and original choice inside the transaction before writing', async () => {
 jest.mocked(getDoc).mockResolvedValue(none as never); let current = true; const write = jest.fn();
 jest.mocked(runTransaction).mockImplementation(async (_db, callback) => callback({get: async () => {current = false; return none;}, set: write} as never) as never);
 await expect(createOrGetChat('owner', 'other', undefined, {expectedUid: 'owner', assertCurrent: () => {if (!current) throw new Error('gone');}})).rejects.toThrow('gone'); expect(write).not.toHaveBeenCalled();
});
it('returns the actual existing general chat with the source still current', async () => {
 jest.mocked(getDoc).mockResolvedValue(chat as never);
 await expect(createOrGetChat('owner', 'other', undefined, {expectedUid: 'owner', assertCurrent: () => {}})).resolves.toMatchObject({id: chat.id});
 expect(runTransaction).not.toHaveBeenCalled();
});
