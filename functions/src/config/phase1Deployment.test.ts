import {describe, expect, it} from 'vitest';
import {providerSecretsForDeployment} from './phase1Deployment';

describe('phase1 provider bindings', () => {
  const profile = {GCLOUD_PROJECT: 'seconde-dev', SECONDE_PROJECT_ID: 'seconde-dev', SECONDE_ENV: 'development',
    SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT: 'phase1-runtime@seconde-dev.iam.gserviceaccount.com',
    FINANCIAL_RECOVERY_ENVIRONMENT: 'unconfigured', PAYMENTS_ENABLED: 'false', SHIPPING_ENABLED: 'false'};
  it('omits only provider bindings in the explicitly isolated no-provider profile', () => {
    expect(providerSecretsForDeployment(['STRIPE_SECRET_KEY'], profile)).toEqual([]);
  });
  it.each([
    {SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT: undefined},
    {SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT: 'phase1-runtime@other-project.iam.gserviceaccount.com'},
    {FINANCIAL_RECOVERY_ENVIRONMENT: 'test'}, {FINANCIAL_RECOVERY_ENVIRONMENT: 'live'},
    {PAYMENTS_ENABLED: 'true'}, {PAYMENTS_ENABLED: undefined}, {SHIPPING_ENABLED: 'true'},
    {SECONDE_COMMERCE_TEST_MODE: 'true'}, {FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID: 'acct_existing'},
  ])('preserves declared provider requirements for an ordinary or inconsistent profile %j', extra => {
    const names = ['STRIPE_SECRET_KEY'];
    expect(providerSecretsForDeployment(names, {...profile, ...extra})).toEqual(names);
  });
});
