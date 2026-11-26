/** In-memory external GCS transport. The recovery installation, control and
 * effect guards remain real; no Firebase data or provider credentials exist. */
export function createRecoveryStorageFixture(projectId = 'seconde-dev') {
  type Stored = { generation: string; bytes: Buffer; metadata: Record<string, unknown> };
  const bucketName = 'unit-recovery-controls';
  const prefix = 'unit-fixture';
  const controlObject = `${prefix}/control.json`;
  const current = new Map<string, Stored>();
  const versions = new Map<string, Stored>();
  let generation = 0;
  const missing = () => Object.assign(new Error('Synthetic object not found'), { code: 404 });
  const conflict = () => Object.assign(new Error('Synthetic generation conflict'), { code: 412 });
  const put = (path: string, bytes: Buffer, metadata: Record<string, unknown> = {}) => {
    const value = { generation: String(++generation), bytes: Buffer.from(bytes), metadata: { ...metadata } };
    current.set(path, value);
    versions.set(`${path}:${value.generation}`, value);
    return value.generation;
  };
  const read = (path: string, selected?: string | number) => {
    const value = selected ? versions.get(`${path}:${selected}`) : current.get(path);
    if (!value) throw missing();
    return value;
  };
  const bucket = (name: string) => {
    if (name !== bucketName) throw new Error('Unexpected synthetic control bucket');
    return { name, file: (path: string, options?: { generation?: string | number }) => ({
      getMetadata: async () => {
        const value = read(path, options?.generation);
        return [{ ...value.metadata, generation: value.generation, size: String(value.bytes.length) }];
      },
      download: async () => [Buffer.from(read(path, options?.generation).bytes)],
      save: async (bytes: Buffer, options: { preconditionOpts: { ifGenerationMatch: number }; metadata?: Record<string, unknown> }) => {
        if (options.preconditionOpts.ifGenerationMatch !== 0 || current.has(path)) throw conflict();
        put(path, bytes, options.metadata);
      },
    }) };
  };
  const environment = {
    GCLOUD_PROJECT: projectId, SECONDE_PROJECT_ID: projectId,
    SECONDE_ENV: projectId === 'seconde-b47a6' ? 'production' : 'development',
    FINANCIAL_RECOVERY_BUCKET: bucketName, FINANCIAL_RECOVERY_CONTROL_OBJECT: controlObject,
    FINANCIAL_RECOVERY_PREFIX: prefix, FINANCIAL_RECOVERY_INSTALLATION_ID: 'unit-installation',
    FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID: projectId, FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID: '(default)',
    FINANCIAL_RECOVERY_ENVIRONMENT: 'unconfigured', FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID: '',
    PAYMENTS_ENABLED: 'false', SHIPPING_ENABLED: 'false',
  };
  const reset = () => {
    current.clear(); versions.clear(); generation = 0;
    put(controlObject, Buffer.from(JSON.stringify({ protocol: 'financial_recovery_control_v1',
      installationId: environment.FINANCIAL_RECOVERY_INSTALLATION_ID, firestoreProjectId: projectId,
      firestoreDatabaseId: '(default)', financialEnvironment: 'unconfigured', stripePlatformAccountId: null,
      epoch: 'unit-epoch', mode: 'normal', previousEpoch: null, reconciliationManifest: null,
      businessAdmission: { protocol: 'business_admission_control_v1', state: 'open', planId: null },
    })));
  };
  reset();
  return { environment, reset, put, bucket,
    snapshot: (path: string) => JSON.parse(read(path).bytes.toString('utf8')),
    Storage: class { constructor(_options?: unknown) {} bucket(name: string) { return bucket(name); } },
  };
}
