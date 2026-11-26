import {runtimeProjectId} from './runtimeEnvironment';

/** Only the explicitly isolated, provider-free phase-1 deployment omits
 * provider bindings. Ordinary Dev, test/live servicing and missing/ambiguous
 * configuration retain their declared secrets and cannot silently downgrade. */
export function providerSecretsForDeployment(names: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const project = runtimeProjectId(env), runtime = env.SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT;
  const isolatedRuntime = typeof runtime === 'string' && typeof project === 'string' &&
    /^[a-z][a-z0-9-]{4,28}@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(runtime) &&
    runtime.endsWith(`@${project}.iam.gserviceaccount.com`);
  return isolatedRuntime && env.FINANCIAL_RECOVERY_ENVIRONMENT === 'unconfigured' &&
    env.PAYMENTS_ENABLED === 'false' && env.SHIPPING_ENABLED === 'false' && env.SECONDE_COMMERCE_TEST_MODE !== 'true' &&
    !env.FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID ? [] : [...names];
}
