import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  storage: vi.fn(),
  write: vi.fn(),
  capture: vi.fn(), screen: vi.fn(), identify: vi.fn(), reset: vi.fn(),
  register: vi.fn(), optOut: vi.fn(), optIn: vi.fn(), constructor: vi.fn(),
  lifecycle: null as ((state: string) => void) | null,
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: mocks.storage, setItem: mocks.write },
}));
vi.mock('react-native', () => ({
  AppState: { addEventListener: (_event: string, callback: (state: string) => void) => { mocks.lifecycle = callback; } },
}));
vi.mock('@/config/posthogConfig', () => ({ POSTHOG_API_KEY: 'public-test-key', POSTHOG_HOST: 'https://test.invalid' }));
vi.mock('posthog-react-native', () => ({
  default: class {
    constructor(_key: string, options: unknown) { mocks.constructor(options); }
    capture = mocks.capture; screen = mocks.screen; identify = mocks.identify;
    reset = mocks.reset; register = mocks.register; optOut = mocks.optOut; optIn = mocks.optIn;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('__DEV__', false);
  mocks.storage.mockResolvedValue(null);
  mocks.write.mockResolvedValue(undefined);
  mocks.screen.mockResolvedValue(undefined);
  mocks.optIn.mockResolvedValue(undefined);
  mocks.optOut.mockResolvedValue(undefined);
  mocks.register.mockResolvedValue(undefined);
  mocks.lifecycle = null;
});

async function load() { return import('./analytics'); }

describe('analytics consent hydration', () => {
  it('drops capture, screen and identity before local and account consent resolve', async () => {
    let resolve!: (value: string | null) => void;
    mocks.storage.mockReturnValue(new Promise<string | null>((done) => { resolve = done; }));
    const api = await load();
    const hydration = api.initAnalytics();
    api.track('user_signed_out', { source: 'user_action' });
    api.trackScreen('/home');
    api.identifyUser('u1', {});
    expect(mocks.constructor).not.toHaveBeenCalled();
    resolve(null);
    await hydration;
    expect(mocks.constructor).not.toHaveBeenCalled();
    await api.setAnalyticsUserConsent(false);
    mocks.lifecycle?.('background');
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.identify).not.toHaveBeenCalled();
  });

  it('cold-start refusal prevents SDK creation and lifecycle collection', async () => {
    mocks.storage.mockResolvedValue('true');
    const api = await load();
    await api.initAnalytics();
    await api.setAnalyticsUserConsent();
    mocks.lifecycle?.('active');
    api.trackScreen('/home');
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it('account refusal overrides a locally enabled setting', async () => {
    const api = await load();
    await api.setAnalyticsUserConsent(false);
    api.identifyUser('u1', {});
    api.track('user_signed_out', { source: 'user_action' });
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it('permits capture only after hydration and gates lifecycle synchronously on refusal', async () => {
    const api = await load();
    await api.setAnalyticsUserConsent(true);
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({ captureAppLifecycleEvents: false }));
    api.identifyUser('u1', {});
    api.track('user_signed_out', { source: 'user_action' });
    expect(mocks.identify).toHaveBeenCalledWith('u1', {});
    expect(mocks.capture).toHaveBeenCalledWith('user_signed_out', { source: 'user_action' });
    mocks.capture.mockClear();
    let persist!: () => void;
    mocks.write.mockReturnValue(new Promise<void>((done) => { persist = done; }));
    const refusal = api.setAnalyticsEnabled(false);
    mocks.lifecycle?.('background');
    api.trackScreen('/home');
    api.identifyUser('u1', {});
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.screen).not.toHaveBeenCalled();
    persist();
    await refusal;
  });

  it('failed storage hydration stays fail-closed, even for an enabled account', async () => {
    mocks.storage.mockRejectedValue(new Error('storage unavailable'));
    const api = await load();
    await api.setAnalyticsUserConsent(true);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it('suspends identity and capture while switching or refreshing account preferences', async () => {
    const api = await load();
    await api.setAnalyticsUserConsent(true);
    api.identifyUser('u1', {});
    api.suspendAnalytics();
    mocks.identify.mockClear();
    mocks.capture.mockClear();
    mocks.lifecycle?.('active');
    api.track('user_signed_out', { source: 'user_action' });
    await api.setAnalyticsUserConsent(false);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
