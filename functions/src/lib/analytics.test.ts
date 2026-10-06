import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), capture: vi.fn(), constructor: vi.fn() }));
vi.mock('../config/firebase', () => ({ db: { collection: () => ({ doc: () => ({ get: mocks.getUser }) }) } }));
vi.mock('posthog-node', () => ({ PostHog: class {
  constructor() { mocks.constructor(); }
  captureImmediate = mocks.capture;
} }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('POSTHOG_API_KEY', 'public-test-key');
  mocks.getUser.mockResolvedValue({ exists: true, data: () => ({ preferences: { analyticsConsent: true } }) });
  mocks.capture.mockResolvedValue(undefined);
});

describe('server analytics preference', () => {
  it('honors persisted refusal for transactional collection', async () => {
    mocks.getUser.mockResolvedValue({ exists: true, data: () => ({ preferences: { analyticsConsent: false } }) });
    const { captureServerEvent } = await import('./analytics');
    await captureServerEvent('u1', 'order_paid', { $insert_id: 'order1' });
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('does not cache consent in warm invocations after withdrawal', async () => {
    const { captureServerEvent } = await import('./analytics');
    await captureServerEvent('u1', 'order_paid');
    mocks.getUser.mockResolvedValue({ exists: true, data: () => ({ preferences: { analyticsConsent: false } }) });
    await captureServerEvent('u1', 'order_delivered');
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
  it('preserves the opt-out default for existing users with absent preference', async () => {
    mocks.getUser.mockResolvedValue({ exists: true, data: () => ({}) });
    const { captureServerEvent } = await import('./analytics');
    await captureServerEvent('u1', 'order_paid', { $insert_id: 'order1' });
    expect(mocks.capture).toHaveBeenCalledWith({ distinctId: 'u1', event: 'order_paid', properties: { $insert_id: 'order1' } });
  });
  it('missing user and failed preference read skip capture without disrupting business flow', async () => {
    const { captureServerEvent } = await import('./analytics');
    mocks.getUser.mockResolvedValue({ exists: false });
    await expect(captureServerEvent('u1', 'account_deleted')).resolves.toBeUndefined();
    mocks.getUser.mockRejectedValue(new Error('offline'));
    await expect(captureServerEvent('u1', 'order_paid')).resolves.toBeUndefined();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
