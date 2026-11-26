/** Runtime targets come from the deployed project, never a production fallback. */
export const PRODUCTION_PROJECT_ID = 'seconde-b47a6';

type RuntimeEnv = NodeJS.ProcessEnv;

function firebaseConfig(env: RuntimeEnv): { projectId?: string; storageBucket?: string } {
  if (!env.FIREBASE_CONFIG?.trim()) return {};
  // Admin also accepts a filename here. Do not let the SDK read an opaque
  // configuration with targets that have not passed the environment checks.
  if (!env.FIREBASE_CONFIG.trim().startsWith('{')) throw new Error('FIREBASE_CONFIG must be an inline JSON object.');
  const config = JSON.parse(env.FIREBASE_CONFIG) as Record<string, unknown>;
  for (const key of ['projectId', 'storageBucket']) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !(config[key] as string).trim())) {
      throw new Error(`FIREBASE_CONFIG ${key} is invalid.`);
    }
  }
  return {
    projectId: typeof config.projectId === 'string' ? config.projectId.trim() : undefined,
    storageBucket: typeof config.storageBucket === 'string' ? config.storageBucket.trim() : undefined,
  };
}

export function runtimeProjectId(env: RuntimeEnv = process.env): string | null {
  const projects = [env.GCLOUD_PROJECT, env.GCP_PROJECT, env.GOOGLE_CLOUD_PROJECT,
    firebaseConfig(env).projectId, env.SECONDE_PROJECT_ID].map(value => value?.trim()).filter(Boolean);
  if (new Set(projects).size > 1) throw new Error('Firebase runtime project configuration is inconsistent.');
  return projects[0] || null;
}

export function requireRuntimeProjectId(env: RuntimeEnv = process.env): string {
  const projectId = runtimeProjectId(env);
  if (!projectId) throw new Error('Firebase runtime project is required; no production fallback is allowed.');
  const declared = env.SECONDE_ENV?.trim();
  if (declared && declared !== 'development' && declared !== 'production') {
    throw new Error('SECONDE_ENV must be development or production.');
  }
  if (declared === 'development' && projectId === PRODUCTION_PROJECT_ID ||
      declared === 'production' && projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error('SECONDE_ENV does not match the Firebase runtime project.');
  }
  return projectId;
}

export function isProductionRuntime(env: RuntimeEnv = process.env): boolean {
  return runtimeProjectId(env) !== null && requireRuntimeProjectId(env) === PRODUCTION_PROJECT_ID;
}

export function runtimeStorageBucket(env: RuntimeEnv = process.env): string {
  const projectId = requireRuntimeProjectId(env);
  const configured = firebaseConfig(env).storageBucket;
  const canonical = [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
  if (configured && !canonical.includes(configured)) {
    throw new Error('Firebase Storage bucket does not match the runtime project.');
  }
  return configured ?? (env.NODE_ENV === 'test' ? canonical[1] : canonical[0]);
}

export function applicationLink(link: string, env: RuntimeEnv = process.env): string {
  return isProductionRuntime(env) ? link : link.replace(/^https:\/\/seconde\.ca\//, 'seconde-dev:///');
}

/** A dev installation never accepts live provider credentials. */
export function stripeKeyAllowed(key: string, env: RuntimeEnv = process.env): boolean {
  return isProductionRuntime(env) || /^(?:sk|rk)_test_/.test(key);
}

/** Sandbox use stays opt-in while the shipping rail itself remains disabled. */
export function shipEngineKeyAllowed(key: string, env: RuntimeEnv = process.env): boolean {
  return isProductionRuntime(env) || env.SHIPENGINE_SANDBOX_ENABLED === 'true' && key.startsWith('TEST_');
}

/** Explicit isolated commerce exercise. Neither a development build nor a
 * client-supplied switch can turn a production deployment into a sandbox. */
export function isDevCommerceTestRuntime(env: RuntimeEnv = process.env): boolean {
  return env.SECONDE_COMMERCE_TEST_MODE === 'true' && env.SECONDE_ENV === 'development' &&
    runtimeProjectId(env) === 'seconde-dev' && env.FUNCTIONS_EMULATOR !== 'true' &&
    env.FINANCIAL_RECOVERY_ENVIRONMENT === 'test';
}

export function isDevCommerceStripeTestRuntime(env: RuntimeEnv = process.env): boolean {
  return isDevCommerceTestRuntime(env) && /^(?:sk|rk)_test_/.test(env.STRIPE_SECRET_KEY?.trim() ?? '');
}

export function isDevCommerceShippingTestRuntime(env: RuntimeEnv = process.env): boolean {
  return isDevCommerceTestRuntime(env) && env.SHIPENGINE_SANDBOX_ENABLED === 'true' &&
    env.SHIPENGINE_ACCOUNT_ENVIRONMENT === 'sandbox' && env.SHIPENGINE_API_KEY?.startsWith('TEST_') === true &&
    (!env.SHIPENGINE_BASE_URL || env.SHIPENGINE_BASE_URL === 'https://api.shipengine.com');
}
