import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ stripeConstructor: vi.fn() }));
vi.mock('stripe', () => ({ default: class {
  constructor(...args: unknown[]) { mocks.stripeConstructor(...args); }
} }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), error: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('GCLOUD_PROJECT', 'seconde-dev');
  vi.stubEnv('SECONDE_ENV', 'development');
  vi.stubEnv('SHIPENGINE_SANDBOX_ENABLED', undefined);
  vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT', undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('provider factories on the dev project', () => {
  it('does not construct any provider when its financial binding is explicitly unconfigured', async () => {
    vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT', 'unconfigured');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_local_fixture');
    vi.stubEnv('SHIPENGINE_API_KEY', 'TEST_local_fixture');
    vi.stubEnv('SHIPENGINE_SANDBOX_ENABLED', 'true');
    const { getStripe } = await import('./stripe');
    const { getShipEngine } = await import('./shipEngine');
    expect(getStripe()).toBeNull();
    expect(getShipEngine()).toBeNull();
    expect(mocks.stripeConstructor).not.toHaveBeenCalled();
  });
  it('cannot even construct a Stripe live client', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_never_use_this_fixture');
    const { getStripe } = await import('./stripe');
    expect(getStripe()).toBeNull();
    expect(mocks.stripeConstructor).not.toHaveBeenCalled();
  });
  it('can construct a Stripe test client without a provider request', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_local_fixture');
    const { getStripe } = await import('./stripe');
    expect(getStripe()).not.toBeNull();
    expect(mocks.stripeConstructor).toHaveBeenCalledTimes(1);
  });
  it('does not retain a ShipEngine client after sandbox opt-in is withdrawn', async () => {
    vi.stubEnv('SHIPENGINE_API_KEY', 'TEST_local_fixture');
    const { getShipEngine } = await import('./shipEngine');
    expect(getShipEngine()).toBeNull();
    vi.stubEnv('SHIPENGINE_SANDBOX_ENABLED', 'true');
    expect(getShipEngine()).not.toBeNull();
    vi.stubEnv('SHIPENGINE_SANDBOX_ENABLED', 'false');
    expect(getShipEngine()).toBeNull();
  });
  it('never accepts a live ShipEngine key even after sandbox opt-in', async () => {
    vi.stubEnv('SHIPENGINE_API_KEY', 'live_local_fixture');
    vi.stubEnv('SHIPENGINE_SANDBOX_ENABLED', 'true');
    const { getShipEngine } = await import('./shipEngine');
    expect(getShipEngine()).toBeNull();
  });
});
