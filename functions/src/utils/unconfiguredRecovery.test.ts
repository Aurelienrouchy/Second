import { afterEach, describe, expect, it, vi } from 'vitest';
import { unconfiguredEffectAllowed } from './financialRecoveryInterlock';
import { installFinancialSubjectTransactions } from './financialSubjectTransaction';
import { recoveryInstallation, recoveryManifestQualifiesSource } from '../config/recoveryControl';

vi.mock('../config/firebase', async () => {
  const { createFirestoreMock } = await import('./testHelpers/firestoreMock');
  const fs = createFirestoreMock();
  return { db: fs.db, FieldValue: fs.FieldValue };
});

afterEach(() => vi.unstubAllEnvs());
const op = 'callable/products.createArticle';

describe('unconfigured financial provider preserves bounded catalogue access', () => {
  it('allows explicit catalogue admission and native inventory sources only', () => {
    expect(unconfiguredEffectAllowed(op, 'firestore_commit', {providerOperation:'new_commerce_admission'})).toBe(true);
    expect(unconfiguredEffectAllowed(op, 'firestore_commit', {refs:['articles/a','inventory_units/u']})).toBe(true);
    expect(unconfiguredEffectAllowed('callable/products.updateArticle', 'firestore_commit', {refs:['articles/a/retired_media/'+'a'.repeat(64)]})).toBe(true);
  });
  it.each(['stripe_mutation','shipengine_label_mutation','webhook_admission'] as const)('rejects %s even under a catalogue scope', kind => {
    expect(unconfiguredEffectAllowed(op, kind, {refs:['articles/a']})).toBe(false);
  });
  it.each(['wallets/u','transactions/t','platform_ledger/l','users/u','articles/a/ledger/x'])('cannot mint or reconcile a financial source at %s', ref => {
    expect(unconfiguredEffectAllowed(op, 'firestore_commit', {refs:[ref]})).toBe(false);
  });
  it('rejects financial scopes, provider operations and provider idempotency keys', () => {
    expect(unconfiguredEffectAllowed('callable/wallet.walletWithdraw', 'firestore_commit', {refs:['articles/a']})).toBe(false);
    expect(unconfiguredEffectAllowed(op, 'firestore_commit', {refs:['articles/a'],providerOperation:'refunds.create'})).toBe(false);
    expect(unconfiguredEffectAllowed(op, 'firestore_commit', {refs:['articles/a'],idempotencyKeys:['pi_test']})).toBe(false);
  });
  it('represents a genuinely absent provider without an invented Stripe account', () => {
    vi.stubEnv('GCLOUD_PROJECT','seconde-dev');
    vi.stubEnv('FINANCIAL_RECOVERY_BUCKET','seconde-dev-independent-control');
    vi.stubEnv('FINANCIAL_RECOVERY_CONTROL_OBJECT','control/current.json');
    vi.stubEnv('FINANCIAL_RECOVERY_PREFIX','installations/seconde-dev');
    vi.stubEnv('FINANCIAL_RECOVERY_INSTALLATION_ID','installation-test');
    vi.stubEnv('FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID','seconde-dev');
    vi.stubEnv('FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID','(default)');
    vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','unconfigured');
    vi.stubEnv('FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID',undefined);
    expect(recoveryInstallation().stripePlatformAccountId).toBeNull();
    vi.stubEnv('FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID','acct_invented');
    expect(() => recoveryInstallation()).toThrow('Financial operations require');
  });
  it('does not qualify any restored financial source through a manifest', async () => {
    await expect(recoveryManifestQualifiesSource({control:{financialEnvironment:'unconfigured',reconciliationManifest:{object:'x'}}} as any,'wallets/u','a'.repeat(64))).resolves.toBe(false);
  });
  it.each(['wallets','transactions','disputes','withdrawal_requests','swaps','stripe_checkout_intents','platform_ledger'])('blocks native %s writes before commit', async root => {
    vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','unconfigured');
    const native = {set:vi.fn(),get:vi.fn(async (ref: any) => ({ref,exists:false,data:()=>undefined}))};
    const db = {doc:(path:string)=>({path}),runTransaction: async (callback: any) => callback(native)} as any;
    installFinancialSubjectTransactions(db);
    await expect(db.runTransaction(async (tx: any) => tx.set({path:`${root}/id`},{balance:100}))).rejects.toThrow('configured provider');
    expect(native.set).not.toHaveBeenCalled();
    // Current native guards may read the target before refusing an unknown
    // source. A read is not permission to flush any of its staged writes.
    expect(native.get.mock.calls.every(([ref])=>typeof ref.path==='string')).toBe(true);
  });
});
