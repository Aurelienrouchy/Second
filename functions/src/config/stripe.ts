/**
 * Stripe Connect client initialization
 * Stripe Connect Custom accounts for marketplace payments
 *
 * Architecture (single-rail / separate charges & transfers):
 * - Each seller has a Stripe Connect Custom account (created silently)
 * - Payments are PLATFORM charges (no destination transfer at capture); the
 *   seller is credited in the wallet ledger and paid out by a single
 *   platform->connected transfer at withdrawal time
 * - Platform keeps the buyer protection fee (5% + 1.50$) and the shippingCost
 *   used to pay the ShipEngine label
 * - Bank accounts collected in-app (addBankAccount callable)
 * - Payouts controlled via manual schedule + walletWithdraw callable
 */

import Stripe from 'stripe';
import * as logger from 'firebase-functions/logger';
import { assertFinancialRecoveryEffect, preserveFinancialRecoveryEffectResponse, qualifiedFinancialRecoveryEnvironment,
  FinancialRecoveryBlocked } from '../utils/financialRecoveryInterlock';
import { recoveryDigest } from './recoveryControl';
import { stripeKeyAllowed } from './runtimeEnvironment';

type StripeClient = InstanceType<typeof Stripe>;

let stripeInstance: StripeClient | null = null;
let stripeInstanceKey: string | null = null;

/** Explicit SDK resource methods used for financial/identity mutations. GET
 * resources, event verification and auto-pagination contracts stay untouched.
 * No generic Proxy is placed around SDK internals or Stripe promises. */
function protectFinancialMutations(client: StripeClient, secretKey: string): void {
  const methods: readonly [string, string, number][] = [
    ['paymentIntents','create',1], ['paymentIntents','update',2], ['paymentIntents','confirm',2], ['paymentIntents','cancel',2], ['paymentIntents','capture',2],
    ['refunds','create',1], ['refunds','update',2], ['refunds','cancel',2],
    ['transfers','create',1], ['transfers','update',2], ['transfers','createReversal',2], ['transfers','updateReversal',3],
    ['payouts','create',1], ['payouts','cancel',2], ['payouts','reverse',2], ['payouts','update',2],
    ['accounts','create',1], ['accounts','update',2], ['accounts','del',2], ['accounts','reject',2],
    ['accounts','createExternalAccount',2], ['accounts','updateExternalAccount',3], ['accounts','deleteExternalAccount',3],
    ['accounts','createPerson',2], ['accounts','updatePerson',3], ['accounts','deletePerson',3], ['accounts','updateCapability',3],
    ['files','create',1], ['disputes','close',2], ['disputes','update',2],
    ['charges','create',1], ['charges','update',2], ['charges','capture',2],
    ['customers','create',1], ['customers','update',2], ['customers','del',2],
    ['paymentMethods','attach',2], ['paymentMethods','detach',2], ['paymentMethods','update',2],
    ['subscriptions','create',1], ['subscriptions','update',2], ['subscriptions','cancel',2],
    ['accountLinks','create',1], ['accountSessions','create',1],
  ];
  for (const [resourceName, methodName, optionsIndex] of methods) {
    const resource = (client as unknown as Record<string, Record<string, unknown>>)[resourceName];
    const original = resource?.[methodName];
    if (typeof original !== 'function') continue;
    resource[methodName] = async (...args: unknown[]) => {
      const installation = qualifiedFinancialRecoveryEnvironment();
      if (!secretKey.startsWith(installation.financialEnvironment === 'live' ? 'sk_live_' : 'sk_test_') &&
          !secretKey.startsWith(installation.financialEnvironment === 'live' ? 'rk_live_' : 'rk_test_')) throw new FinancialRecoveryBlocked('stripe_environment_mismatch');
      // GET is always permitted, including during recovery. The key's platform
      // identity is qualified before each mutation, not inferred from metadata.
      const account = await client.accounts.retrieveCurrent({}, {timeout:5000,maxNetworkRetries:0});
      if (account.id !== installation.stripePlatformAccountId) throw new FinancialRecoveryBlocked('stripe_platform_mismatch');
      const options = args[optionsIndex] as Record<string, unknown> | undefined;
      const keys = options && typeof options.idempotencyKey === 'string' ? [options.idempotencyKey] : [];
      const ids = args.filter((arg): arg is string => typeof arg === 'string' && /^(?:pi|acct|tr|po|re|dp|ch|ba|pm|cus|sub)_[A-Za-z0-9]+$/.test(arg));
      const operation = `${resourceName}.${methodName}`;
      await assertFinancialRecoveryEffect('stripe_mutation', {providerOperation: operation, refs: ids, idempotencyKeys: keys});
      // SDK network retries must not issue a second POST after draining began.
      // Native intent recovery decides whether a later GET/POST is authorized.
      args[optionsIndex] = {...(options ?? {}), maxNetworkRetries: 0};
      const requestHash = recoveryDigest(JSON.stringify({operation,ids,keys}));
      let result: unknown;
      try { result = await original.apply(resource, args); }
      catch (error) {
        const status = (error as {statusCode?:unknown})?.statusCode;
        await preserveFinancialRecoveryEffectResponse('stripe', operation,
          {status:typeof status === 'number' ? 'provider_error' : 'transport_outcome_unknown',
            ...(typeof status === 'number' && Number.isSafeInteger(status) ? {http_status:status} : {})}, requestHash);
        throw error;
      }
      await preserveFinancialRecoveryEffectResponse('stripe', operation, result, requestHash);
      return result;
    };
  }
}

/**
 * Returns the Stripe SDK singleton.
 * Reads STRIPE_SECRET_KEY from environment (injected via Firebase Secrets).
 * Returns null if the key is not configured (e.g. in test environments).
 *
 * The singleton is invalidated if the secret key changes (e.g. after rotation),
 * preventing stale credentials from being used in warm function containers.
 */
export const getStripe = (): StripeClient | null => {
  if (process.env.FINANCIAL_RECOVERY_ENVIRONMENT === 'unconfigured') return null;
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    logger.error('STRIPE_SECRET_KEY not found in environment');
    return null;
  }
  if (!stripeKeyAllowed(secretKey)) {
    logger.error('Live Stripe credentials are forbidden outside the production project');
    return null;
  }
  // Invalidate cached instance if the key changed (secret rotation)
  if (!stripeInstance || stripeInstanceKey !== secretKey) {
    const keyPrefix = secretKey.substring(0, 12);
    logger.info('Initializing Stripe SDK', { keyPrefix: `${keyPrefix}...` });
    // Pin the API version coherent with stripe ^22 (Dahlia release) so the
    // shape of webhook payloads / API responses cannot drift under us.
    // maxNetworkRetries: Stripe retries are idempotent (uses idempotency keys
    // internally), safe to retry transient network/5xx failures.
    // timeout: cap each request at 20s to avoid hanging the webhook handler.
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2026-04-22.dahlia',
      maxNetworkRetries: 2,
      timeout: 20000,
    });
    protectFinancialMutations(stripeInstance, secretKey);
    stripeInstanceKey = secretKey;
  }
  return stripeInstance;
};
