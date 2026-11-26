import firebaseProjects from '@/config/firebaseProjects.json';
import { resolveFirebaseEnvironment } from '@/config/firebaseEnvironment';
import { resolveStripePublishableKey } from '@/config/stripeConfig';

it('selects the separate development project for a normal local launch', () => {
  const result = resolveFirebaseEnvironment({ test: false, development: true });
  expect(result.name).toBe('development');
  expect(result.projectId).toBe(firebaseProjects.development.projectId);
  expect(result.projectId).not.toBe(firebaseProjects.production.projectId);
  expect(result.useEmulators).toBe(false);
  expect(result.appScheme).toBe('seconde-dev');
});

it('blocks an explicit production environment in local development', () => {
  expect(() => resolveFirebaseEnvironment({ test: false, development: true, appEnvironment: 'production' }))
    .toThrow('Le lancement local ne peut pas utiliser Firebase Production.');
});

it('requires a deliberate production selection in a release runtime', () => {
  expect(resolveFirebaseEnvironment({ test: false, development: false }).name).toBe('development');
  const result = resolveFirebaseEnvironment({ test: false, development: false, appEnvironment: 'production' });
  expect(result.projectId).toBe(firebaseProjects.production.projectId);
  expect(result.appScheme).toBe('seconde');
});

it('rejects invalid environment values and a production/emulator mixture', () => {
  expect(() => resolveFirebaseEnvironment({ test: false, appEnvironment: 'staging' })).toThrow('EXPO_PUBLIC_APP_ENV');
  expect(() => resolveFirebaseEnvironment({ test: false, appEnvironment: 'production', useEmulators: '1' }))
    .toThrow('Un build de production ne peut pas utiliser les émulateurs Firebase.');
});

it('forces all tests onto demo-second even if production is requested', () => {
  const result = resolveFirebaseEnvironment({ test: true, development: true, appEnvironment: 'production' });
  expect(result.projectId).toBe('demo-second');
  expect(result.name).toBe('development');
  expect(result.useEmulators).toBe(true);
});

describe('Stripe follows the isolated runtime', () => {
  const originalKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const originalPaymentsEnabled = process.env.EXPO_PUBLIC_PAYMENTS_ENABLED;
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_PAYMENTS_ENABLED;
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    else process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = originalKey;
    if (originalPaymentsEnabled === undefined) delete process.env.EXPO_PUBLIC_PAYMENTS_ENABLED;
    else process.env.EXPO_PUBLIC_PAYMENTS_ENABLED = originalPaymentsEnabled;
  });

  it('rejects a live Stripe key before initializing a dev payment client', () => {
    process.env.EXPO_PUBLIC_PAYMENTS_ENABLED = 'true';
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_wrong_environment';
    jest.isolateModules(() => {
      // The default test runtime is an emulator, where the payment rail is
      // deliberately closed. Exercise the separate Dev cloud admission here.
      const { runtimeEnvironment: cloud } = require('@/config/firebaseEnvironment') as typeof import('@/config/firebaseEnvironment');
      Object.assign(cloud, { projectId: 'seconde-dev', useEmulators: false });
      expect(() => require('@/config/stripeConfig'))
        .toThrow('Seconde Dev refuse une clé Stripe de production');
    });
  });

  it('keeps emulator payments closed even when a public payment flag is supplied', () => {
    process.env.EXPO_PUBLIC_PAYMENTS_ENABLED = 'true';
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_wrong_environment';
    jest.isolateModules(() => {
      expect(require('@/config/featureFlags').PAYMENTS_ENABLED).toBe(false);
      expect(require('@/config/stripeConfig').STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
    });
  });

  it('keeps browsing available with closed payments and never passes a live key to Dev', () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_live_wrong_environment';
    jest.isolateModules(() => {
      const config = require('@/config/stripeConfig') as typeof import('@/config/stripeConfig');
      expect(config.STRIPE_PUBLISHABLE_KEY).toMatch(/^pk_test_51UUxsw0kghMArvqh/);
    });
  });

  it('uses a test key and the development redirect scheme', () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_isolated';
    jest.isolateModules(() => {
      const config = require('@/config/stripeConfig');
      expect(config.STRIPE_PUBLISHABLE_KEY).toBe('pk_test_isolated');
      expect(config.STRIPE_URL_SCHEME).toBe('seconde-dev');
    });
  });

  it('defaults Dev payments to the dedicated sandbox rather than the old account', () => {
    const result = resolveStripePublishableKey({ environment: 'development', paymentsEnabled: true });
    expect(result).toMatch(/^pk_test_51UUxsw0kghMArvqh/);
  });

  it.each([undefined, '', 'pk_test_sandbox', 'pk_live_', ' pk_live_account', 'pk_live_account\n'])(
    'blocks incomplete or non-live production payment configuration: %s',
    (configuredKey) => {
      expect(() => resolveStripePublishableKey({ environment: 'production', paymentsEnabled: true, configuredKey }))
        .toThrow('Les paiements en production exigent une clé publique Stripe de production');
    },
  );

  it('uses only the explicitly configured live key for production payments', () => {
    expect(resolveStripePublishableKey({ environment: 'production', paymentsEnabled: true, configuredKey: 'pk_live_account' }))
      .toBe('pk_live_account');
  });

  it.each([undefined, '', 'invalid', 'pk_test_sandbox'])(
    'keeps production browsing available while payments are closed: %s',
    (configuredKey) => {
      expect(resolveStripePublishableKey({ environment: 'production', paymentsEnabled: false, configuredKey }))
        .toMatch(/^pk_test_51UUxsw0kghMArvqh/);
    },
  );
});
