import { describe, expect, it } from 'vitest';
import { applicationLink, isProductionRuntime, requireRuntimeProjectId, runtimeProjectId, runtimeStorageBucket, shipEngineKeyAllowed, stripeKeyAllowed } from './runtimeEnvironment';

const dev = { GCLOUD_PROJECT: 'seconde-dev', SECONDE_ENV: 'development' };
const prod = { GCLOUD_PROJECT: 'seconde-b47a6', SECONDE_ENV: 'production' };

describe('runtime environment isolation', () => {
  it('never falls back to production without a runtime project', () => {
    expect(runtimeProjectId({})).toBeNull();
    expect(isProductionRuntime({})).toBe(false);
    expect(() => requireRuntimeProjectId({})).toThrow('no production fallback');
  });
  it('uses the deployed project and rejects competing project targets', () => {
    expect(requireRuntimeProjectId(dev)).toBe('seconde-dev');
    expect(runtimeProjectId({ FIREBASE_CONFIG: '{"projectId":"seconde-dev"}' })).toBe('seconde-dev');
    expect(() => runtimeProjectId({ ...dev, SECONDE_PROJECT_ID: 'seconde-b47a6' })).toThrow('inconsistent');
  });
  it('refuses either environment pointing at the other project', () => {
    expect(isProductionRuntime(prod)).toBe(true);
    expect(isProductionRuntime(dev)).toBe(false);
    expect(() => requireRuntimeProjectId({ ...dev, GCLOUD_PROJECT: 'seconde-b47a6' })).toThrow('does not match');
    expect(() => requireRuntimeProjectId({ ...prod, GCLOUD_PROJECT: 'seconde-dev' })).toThrow('does not match');
    expect(() => requireRuntimeProjectId({ ...dev, SECONDE_ENV: 'typo' })).toThrow('must be');
  });
  it('rejects live Stripe credentials before constructing a client in dev', () => {
    expect(stripeKeyAllowed('sk_live_example', dev)).toBe(false);
    expect(stripeKeyAllowed('rk_live_example', dev)).toBe(false);
    expect(stripeKeyAllowed('sk_test_example', dev)).toBe(true);
    expect(stripeKeyAllowed('sk_live_example', prod)).toBe(true);
  });
  it('keeps dev shipping off unless explicitly using a sandbox key', () => {
    expect(shipEngineKeyAllowed('TEST_example', dev)).toBe(false);
    expect(shipEngineKeyAllowed('live_example', { ...dev, SHIPENGINE_SANDBOX_ENABLED: 'true' })).toBe(false);
    expect(shipEngineKeyAllowed('TEST_example', { ...dev, SHIPENGINE_SANDBOX_ENABLED: 'true' })).toBe(true);
    expect(shipEngineKeyAllowed('live_example', prod)).toBe(true);
  });
  it('opens the development application for a dev notification', () => {
    expect(applicationLink('https://seconde.ca/orders/o1', dev)).toBe('seconde-dev:///orders/o1');
    expect(applicationLink('https://seconde.ca/my-orders', dev)).toBe('seconde-dev:///my-orders');
    expect(applicationLink('https://seconde.ca/orders/o1', prod)).toBe('https://seconde.ca/orders/o1');
    expect(applicationLink('', dev)).toBe('');
  });
  it('accepts only canonical default buckets belonging to the runtime project', () => {
    expect(runtimeStorageBucket(dev)).toBe('seconde-dev.firebasestorage.app');
    expect(runtimeStorageBucket({ ...dev, FIREBASE_CONFIG: '{"storageBucket":"seconde-dev.appspot.com"}' })).toBe('seconde-dev.appspot.com');
    expect(() => runtimeStorageBucket({ ...dev, FIREBASE_CONFIG: '{"projectId":"seconde-dev","storageBucket":"seconde-b47a6.firebasestorage.app"}' })).toThrow('bucket does not match');
    expect(() => runtimeStorageBucket({ ...dev, FIREBASE_CONFIG: '{"storageBucket":"external.example"}' })).toThrow('bucket does not match');
  });
  it('does not delegate an unexamined file configuration to Firebase Admin', () => {
    expect(() => runtimeStorageBucket({ ...dev, FIREBASE_CONFIG: '/tmp/firebase-config.json' })).toThrow('inline JSON');
    expect(() => runtimeStorageBucket({ ...dev, FIREBASE_CONFIG: '{"storageBucket":123}' })).toThrow('storageBucket is invalid');
  });
});
