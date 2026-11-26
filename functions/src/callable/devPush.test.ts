import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({runtime: true, parse: vi.fn(), write: vi.fn(), guard: vi.fn(), rate: vi.fn()}));
vi.mock('firebase-functions/v2/https', () => ({onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {constructor(public code: string, message: string) {super(message);}}}));
vi.mock('../utils/devPush', () => ({isDevPushRuntime: () => mocks.runtime,
  parseDevPushInput: mocks.parse, writeDevPushDestination: mocks.write}));
vi.mock('../utils/privateAccountSession', () => ({assertPrivateAccountSession: mocks.guard,
  withPrivateAccountSession: async (request: unknown, operation: () => Promise<unknown>) => {await mocks.guard(request); return operation();}}));
vi.mock('../utils/rateLimit', () => ({checkRateLimit: mocks.rate}));
import { registerDevPushDestination } from './devPush';
const call = registerDevPushDestination as unknown as (request: unknown) => Promise<unknown>;
beforeEach(() => {vi.clearAllMocks(); mocks.runtime = true; mocks.parse.mockReturnValue({mode: 'register'});
  mocks.write.mockResolvedValue({registered: true}); mocks.guard.mockResolvedValue(undefined); mocks.rate.mockResolvedValue(undefined);});
describe('Dev push callable boundary', () => {
  it('refuses an unauthenticated request and an inactive Dev runtime before persistence', async () => {
    await expect(call({data: {}})).rejects.toMatchObject({code: 'unauthenticated'});
    mocks.runtime = false;
    await expect(call({auth: {uid: 'A'}, data: {}})).rejects.toMatchObject({code: 'failed-precondition'});
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('validates expected identity, current private session and rate limit before guarded transaction', async () => {
    const request = {auth: {uid: 'A'}, data: {expectedUid: 'A'}};
    expect(await call(request)).toEqual({registered: true});
    expect(mocks.parse).toHaveBeenCalledWith(request.data, 'A');
    expect(mocks.rate).toHaveBeenCalledWith('A', true, expect.objectContaining({maxCallsAuthenticated: 40}));
    const transaction = {test: true}; await mocks.write.mock.calls[0][2](transaction);
    expect(mocks.guard).toHaveBeenLastCalledWith(request, transaction);
  });
});
