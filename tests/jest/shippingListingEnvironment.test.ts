const mockEnvironment = { name: 'development', projectId: 'seconde-dev', useEmulators: false };
jest.mock('@/config/firebaseEnvironment', () => ({ get runtimeEnvironment() { return mockEnvironment; } }));

const originalPayments = process.env.EXPO_PUBLIC_PAYMENTS_ENABLED;
const originalShipping = process.env.EXPO_PUBLIC_SHIPPING_ENABLED;
const originalTestMode = process.env.EXPO_PUBLIC_COMMERCE_TEST_MODE;
beforeEach(() => {
  delete process.env.EXPO_PUBLIC_PAYMENTS_ENABLED;
  delete process.env.EXPO_PUBLIC_SHIPPING_ENABLED;
  delete process.env.EXPO_PUBLIC_COMMERCE_TEST_MODE;
});
afterEach(() => {
  if (originalPayments === undefined) delete process.env.EXPO_PUBLIC_PAYMENTS_ENABLED;
  else process.env.EXPO_PUBLIC_PAYMENTS_ENABLED = originalPayments;
  if (originalShipping === undefined) delete process.env.EXPO_PUBLIC_SHIPPING_ENABLED;
  else process.env.EXPO_PUBLIC_SHIPPING_ENABLED = originalShipping;
  if (originalTestMode === undefined) delete process.env.EXPO_PUBLIC_COMMERCE_TEST_MODE;
  else process.env.EXPO_PUBLIC_COMMERCE_TEST_MODE = originalTestMode;
});

it.each([
  ['development', 'seconde-dev', false, true, true],
  ['production', 'seconde-b47a6', false, true, false],
  ['development', 'seconde-dev', true, false, false],
  ['development', 'demo-second', true, false, false],
  ['development', 'seconde-b47a6', false, false, false],
  ['production', 'seconde-dev', false, false, false],
] as const)('commerce flags do not escape environment %s/%s, emulator %s', (name, projectId, useEmulators, commerce, testMode) => {
  Object.assign(mockEnvironment, { name, projectId, useEmulators });
  process.env.EXPO_PUBLIC_PAYMENTS_ENABLED = 'true';
  process.env.EXPO_PUBLIC_SHIPPING_ENABLED = 'true';
  process.env.EXPO_PUBLIC_COMMERCE_TEST_MODE = 'true';
  jest.isolateModules(() => {
    const flags = require('@/config/featureFlags') as typeof import('@/config/featureFlags');
    expect(flags.PAYMENTS_ENABLED).toBe(commerce);
    expect(flags.SHIPPING_ENABLED).toBe(commerce);
    expect(flags.DEV_COMMERCE_TESTING_ENABLED).toBe(testMode);
  });
});

it.each([
  ['development', 'seconde-dev', false, true],
  ['production', 'seconde-b47a6', false, false],
  ['development', 'seconde-b47a6', false, false],
  ['production', 'seconde-dev', false, false],
  ['development', 'seconde-dev', true, false],
  ['development', 'demo-second', true, false],
] as const)('shipping listings: environment %s, project %s, emulator %s -> %s', (name, projectId, useEmulators, enabled) => {
  Object.assign(mockEnvironment, { name, projectId, useEmulators });
  jest.isolateModules(() => {
    const flags = require('@/config/featureFlags') as typeof import('@/config/featureFlags');
    expect(flags.SHIPPING_LISTINGS_ENABLED).toBe(enabled);
    expect(flags.SHIPPING_ENABLED).toBe(false);
    expect(flags.PAYMENTS_ENABLED).toBe(false);
  });
});

it.each(['TRUE', 'True', ' true', 'true ', '1', 'yes', 'false', ''])(
  'keeps both commerce rails closed unless the flag is exactly true: %s',
  (value) => {
    process.env.EXPO_PUBLIC_PAYMENTS_ENABLED = value;
    process.env.EXPO_PUBLIC_SHIPPING_ENABLED = value;
    jest.isolateModules(() => {
      const flags = require('@/config/featureFlags') as typeof import('@/config/featureFlags');
      expect(flags.PAYMENTS_ENABLED).toBe(false);
      expect(flags.SHIPPING_ENABLED).toBe(false);
    });
  },
);

it.each([
  ['true', 'false', true, false],
  ['false', 'true', false, true],
  ['true', 'true', true, true],
] as const)('keeps payment %s and shipping %s activation independent', (paymentValue, shippingValue, payments, shipping) => {
  Object.assign(mockEnvironment, { name: 'production', projectId: 'seconde-b47a6', useEmulators: false });
  process.env.EXPO_PUBLIC_PAYMENTS_ENABLED = paymentValue;
  process.env.EXPO_PUBLIC_SHIPPING_ENABLED = shippingValue;
  jest.isolateModules(() => {
    const flags = require('@/config/featureFlags') as typeof import('@/config/featureFlags');
    expect(flags.PAYMENTS_ENABLED).toBe(payments);
    expect(flags.SHIPPING_ENABLED).toBe(shipping);
    expect(flags.SHIPPING_LISTINGS_ENABLED).toBe(shipping);
  });
});
