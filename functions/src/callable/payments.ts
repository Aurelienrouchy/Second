/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 *
 * Shipping via ShipEngine (Intelcom + Canada Post)
 * Payment via Stripe Connect Standard (destination charges)
 * Commission via service fee calculation (application_fee_amount)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine, ShipEngineClient } from '../config/shipEngine';
import { getStripe } from '../config/stripe';
import { calculateFees, calculateServiceFee, getServiceFeeConfig } from '../utils/fees';
import { sendPushNotification } from '../utils/notifications';

// =============================================================================
// GET SHIPPING ESTIMATES — Multi-carrier via ShipEngine
// =============================================================================

export const getShippingEstimate = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
  const { fromAddress, toAddress, weight, dimensions } = request.data;

  if (!fromAddress || !toAddress) {
    throw new HttpsError('invalid-argument', 'From and to addresses are required');
  }

  const shipEngine = getShipEngine();
  if (!shipEngine) {
    throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
  }

  try {
    const parcelWeight = parseFloat(weight) || 0.5;
    const parcelLength = parseFloat(dimensions?.length) || 30;
    const parcelWidth = parseFloat(dimensions?.width) || 25;
    const parcelHeight = parseFloat(dimensions?.height) || 10;

    console.log('📦 Getting ShipEngine multi-carrier rates:', {
      from: fromAddress.postalCode,
      to: toAddress.postalCode,
      weight: parcelWeight,
    });

    // Rate shopping across Intelcom + Canada Post via ShipEngine
    const rates = await shipEngine.getRates(
      {
        name: fromAddress.name || 'Vendeur',
        addressLine1: fromAddress.street || '',
        cityLocality: fromAddress.city || '',
        stateProvince: fromAddress.province || 'QC',
        postalCode: fromAddress.postalCode,
        countryCode: 'CA',
      },
      {
        name: toAddress.name || 'Acheteur',
        addressLine1: toAddress.street || '',
        cityLocality: toAddress.city || '',
        stateProvince: toAddress.province || 'QC',
        postalCode: toAddress.postalCode,
        countryCode: 'CA',
      },
      {
        weight: { value: parcelWeight, unit: 'kilogram' },
        dimensions: {
          length: parcelLength,
          width: parcelWidth,
          height: parcelHeight,
          unit: 'centimeter',
        },
      }
    );

    // Format rates for the client
    const formattedRates = rates
      .sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount)
      .slice(0, 5)
      .map((rate) => ({
        rateId: rate.rateId,
        carrier: rate.carrierFriendlyName,
        carrierCode: rate.carrierCode,
        serviceName: rate.serviceType,
        deliveryDays: `${rate.estimatedDeliveryDays} jour${rate.estimatedDeliveryDays > 1 ? 's' : ''} ouvrable${rate.estimatedDeliveryDays > 1 ? 's' : ''}`,
        amount: rate.shippingAmount.amount,
        currency: rate.shippingAmount.currency,
        deliveryType: rate.deliveryType,
      }));

    console.log(`✅ Retrieved ${formattedRates.length} shipping rates from ShipEngine`);

    return {
      success: true,
      rates: formattedRates,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting shipping estimate:', error);
    throw new HttpsError('internal', `Failed to get shipping estimate: ${message}`);
  }
});

// =============================================================================
// GET SERVICE FEE — Returns fee info for client display
// =============================================================================

export const getServiceFee = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
  const { articlePrice } = request.data;

  if (!articlePrice || articlePrice <= 0) {
    throw new HttpsError('invalid-argument', 'Article price is required');
  }

  const serviceFee = calculateServiceFee(articlePrice);
  const config = getServiceFeeConfig();

  return {
    success: true,
    serviceFee,
    serviceFeePercent: config.percent,
    serviceFeeFixed: config.fixed,
    serviceFeeMin: config.min,
  };
});

// =============================================================================
// CREATE TRANSACTION — Atomic article check + transaction creation
// =============================================================================

/**
 * Atomically verifies that an article is still available (not sold, not
 * inactive, not deleted) and creates a transaction for it.
 *
 * Why this is a Cloud Function rather than a client-side write:
 * - The buyer cannot update `isSold` on the article (Firestore rules
 *   restrict article updates to the seller). Only the Admin SDK can set
 *   isSold from the buyer's context.
 * - A client-side `addDoc` followed by a separate `updateDoc` is NOT
 *   atomic — two buyers can race and both succeed.
 * - Using `runTransaction` with the Admin SDK guarantees exactly one
 *   buyer wins.
 *
 * Supports both delivery types: 'shipping' and 'meetup'.
 */
export const createTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const {
      articleId,
      deliveryType,
      amount,
      shippingCost,
      shippingAddress,
      meetupSpot,
      chatId,
      shipEngineRateId,
    } = request.data ?? {};

    const buyerId = request.auth.uid;

    // --- Input validation ---------------------------------------------------

    if (typeof articleId !== 'string' || articleId.length === 0) {
      throw new HttpsError('invalid-argument', 'articleId is required');
    }
    if (deliveryType !== 'shipping' && deliveryType !== 'meetup') {
      throw new HttpsError('invalid-argument', 'deliveryType must be "shipping" or "meetup"');
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be a positive number');
    }

    if (deliveryType === 'shipping') {
      if (typeof shippingCost !== 'number' || !isFinite(shippingCost) || shippingCost < 0) {
        throw new HttpsError('invalid-argument', 'shippingCost is required for shipping');
      }
      if (!shippingAddress || typeof shippingAddress !== 'object') {
        throw new HttpsError('invalid-argument', 'shippingAddress is required for shipping');
      }
    }

    // --- Atomic check + create -----------------------------------------------

    const articleRef = db.collection('articles').doc(articleId);

    try {
      const transactionId = await db.runTransaction(async (tx) => {
        const articleSnap = await tx.get(articleRef);

        if (!articleSnap.exists) {
          throw new HttpsError('not-found', 'Cet article n\'existe plus');
        }

        const articleData = articleSnap.data()!;

        if (articleData.isSold === true) {
          throw new HttpsError('failed-precondition', 'Cet article a déjà été vendu');
        }

        if (articleData.isActive === false) {
          throw new HttpsError('failed-precondition', 'Cet article n\'est plus disponible');
        }

        if (articleData.sellerId === buyerId) {
          throw new HttpsError('invalid-argument', 'Vous ne pouvez pas acheter votre propre article');
        }

        // Verify the amount is valid:
        // - Exact listed price is always accepted.
        // - A negotiated (lower) price is accepted if positive and below listed price.
        //   The negotiation was validated via the offer/accept flow in chat.
        // - Amounts above listed price are rejected (overpay protection).
        if (amount > articleData.price) {
          throw new HttpsError(
            'failed-precondition',
            'Le montant dépasse le prix de l\'article.'
          );
        }
        if (amount !== articleData.price && amount <= 0) {
          throw new HttpsError(
            'invalid-argument',
            'Le montant doit être supérieur à zéro.'
          );
        }

        // For shipping transactions, verify seller has active Stripe Connect
        // before locking the article. This prevents articles from being marked
        // sold for a seller who can't receive payment.
        if (deliveryType === 'shipping') {
          const sellerRef = db.collection('users').doc(articleData.sellerId);
          const sellerSnap = await tx.get(sellerRef);
          if (!sellerSnap.exists) {
            throw new HttpsError('not-found', 'Vendeur introuvable');
          }
          const sellerData = sellerSnap.data()!;
          if (!sellerData.stripeAccountId || sellerData.stripeChargesEnabled !== true) {
            throw new HttpsError(
              'failed-precondition',
              'Le vendeur n\'a pas encore configuré son compte de paiement.'
            );
          }
        }

        // Mark article as sold
        tx.update(articleRef, { isSold: true });

        // Build transaction data — server-side fee calculation (never trust client)
        // Meetup transactions have NO platform fee (aligned with frontend
        // messaging "Aucun frais de plateforme") and no shipping cost.
        const fee = deliveryType === 'meetup' ? 0 : calculateServiceFee(amount);
        const shipping = deliveryType === 'shipping' ? (shippingCost || 0) : 0;
        const totalAmount = amount + shipping + fee;

        const transactionData: Record<string, any> = {
          articleId,
          buyerId,
          sellerId: articleData.sellerId,
          amount,
          shippingCost: shipping,
          serviceFee: fee,
          totalAmount,
          sellerPayout: amount,
          deliveryType,
          status: deliveryType === 'shipping' ? 'pending_payment' : 'meetup_pending',
          createdAt: FieldValue.serverTimestamp(),
        };

        if (chatId && typeof chatId === 'string') {
          transactionData.chatId = chatId;
        }

        if (deliveryType === 'shipping') {
          transactionData.shippingAddress = shippingAddress;
          if (shipEngineRateId && typeof shipEngineRateId === 'string') {
            transactionData.shipEngineRateId = shipEngineRateId;
          }
        }

        if (deliveryType === 'meetup' && meetupSpot && typeof meetupSpot === 'object') {
          const cleanSpot: Record<string, any> = {
            name: meetupSpot.name,
            category: meetupSpot.category,
            neighborhood: meetupSpot.neighborhood,
          };
          if (meetupSpot.id) cleanSpot.id = meetupSpot.id;
          if (meetupSpot.address) cleanSpot.address = meetupSpot.address;
          if (meetupSpot.coordinates) cleanSpot.coordinates = meetupSpot.coordinates;
          transactionData.meetupSpot = cleanSpot;
        }

        const newTxRef = db.collection('transactions').doc();
        tx.set(newTxRef, transactionData);

        return newTxRef.id;
      });

      console.log(
        `✅ Transaction ${transactionId} created for article ${articleId} (${deliveryType}) by buyer ${buyerId}`
      );

      return { success: true, transactionId };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error creating transaction:', error);
      throw new HttpsError('internal', `Failed to create transaction: ${message}`);
    }
  }
);

// =============================================================================
// CREATE STRIPE CHECKOUT — Initialize Stripe PaymentIntent (destination charge)
// =============================================================================

/**
 * Creates a Stripe PaymentIntent with destination charge to the seller's
 * Stripe Connect account. The platform takes an application_fee_amount
 * equal to the buyer protection fee (serviceFee).
 *
 * Returns the PaymentIntent clientSecret for the client to confirm payment
 * using Stripe's React Native SDK or web Elements.
 *
 * Idempotent: if a PaymentIntent already exists for this transaction,
 * returns the existing clientSecret without creating a new one.
 */
export const createStripeCheckout = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { transactionId } = request.data;

    if (!transactionId || typeof transactionId !== 'string') {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    try {
      const txRef = db.collection('transactions').doc(transactionId);

      // Atomically read, validate, and update fee fields inside a transaction
      // to prevent races where concurrent calls both see no PaymentIntent and
      // double-create.
      const txResult = await db.runTransaction(async (tx) => {
        const transactionDoc = await tx.get(txRef);

        if (!transactionDoc.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }

        const transaction = transactionDoc.data()!;

        // Verify the user is the buyer
        if (transaction.buyerId !== request.auth!.uid) {
          throw new HttpsError('permission-denied', 'You are not authorized for this transaction');
        }

        // Only allow checkout creation from valid statuses
        const checkoutableStatuses = new Set(['pending_payment']);
        if (!checkoutableStatuses.has(transaction.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot create checkout for transaction in status ${transaction.status}`
          );
        }

        // Idempotent: if a PaymentIntent already exists, retrieve clientSecret from Stripe
        // (never store client_secret in Firestore — it's a sensitive credential)
        if (transaction.stripePaymentIntentId) {
          const existingFees = calculateFees(transaction.amount, transaction.shippingCost || 0);
          return {
            existingCheckout: true,
            fees: existingFees,
            existingPaymentIntentId: transaction.stripePaymentIntentId as string,
            sellerId: transaction.sellerId as string,
          };
        }

        // Always recalculate fees server-side for correctness
        const calculatedFees = calculateFees(transaction.amount, transaction.shippingCost || 0);

        // Update fee fields atomically
        tx.update(txRef, {
          serviceFee: calculatedFees.serviceFee,
          serviceFeePercent: calculatedFees.serviceFeePercent,
          totalAmount: calculatedFees.buyerTotal,
          sellerPayout: calculatedFees.sellerPayout,
        });

        return {
          existingCheckout: false,
          fees: calculatedFees,
          existingPaymentIntentId: null as string | null,
          sellerId: transaction.sellerId as string,
        };
      });

      // Idempotent return: PaymentIntent already existed — retrieve clientSecret from Stripe
      if (txResult.existingCheckout) {
        const existingPI = await stripe.paymentIntents.retrieve(txResult.existingPaymentIntentId!);
        logger.info('Returning existing Stripe PaymentIntent', {
          transactionId,
          paymentIntentId: existingPI.id,
        });
        return {
          success: true,
          clientSecret: existingPI.client_secret,
          feeBreakdown: {
            articlePrice: txResult.fees.articlePrice,
            shippingCost: txResult.fees.shippingCost,
            serviceFee: txResult.fees.serviceFee,
            serviceFeePercent: txResult.fees.serviceFeePercent,
            buyerTotal: txResult.fees.buyerTotal,
          },
        };
      }

      // Look up seller's Stripe Connect account
      const sellerDoc = await db.collection('users').doc(txResult.sellerId).get();
      if (!sellerDoc.exists) {
        throw new HttpsError('not-found', 'Seller not found');
      }
      const sellerData = sellerDoc.data()!;
      const sellerStripeAccountId = sellerData.stripeAccountId;
      if (!sellerStripeAccountId) {
        throw new HttpsError(
          'failed-precondition',
          'Le vendeur n\'a pas encore configuré son compte de paiement'
        );
      }

      // Convert dollars to cents for Stripe (all Stripe amounts are in smallest currency unit)
      const amountInCents = Math.round(txResult.fees.buyerTotal * 100);
      const applicationFeeInCents = Math.round(txResult.fees.serviceFee * 100);

      // Create Stripe PaymentIntent with destination charge
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'cad',
        application_fee_amount: applicationFeeInCents,
        transfer_data: {
          destination: sellerStripeAccountId,
        },
        metadata: {
          transactionId,
          sellerId: txResult.sellerId,
          buyerId: request.auth!.uid,
        },
        // Defer payouts until delivery confirmed (escrow simulation)
        // The actual payout hold is managed via the connected account's schedule
      });

      // Store PaymentIntent ID in the transaction doc (never store client_secret)
      await txRef.update({
        stripePaymentIntentId: paymentIntent.id,
        stripeCheckoutCreatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('Stripe PaymentIntent created', {
        transactionId,
        paymentIntentId: paymentIntent.id,
        amountCents: amountInCents,
        feeCents: applicationFeeInCents,
      });

      return {
        success: true,
        clientSecret: paymentIntent.client_secret,
        feeBreakdown: {
          articlePrice: txResult.fees.articlePrice,
          shippingCost: txResult.fees.shippingCost,
          serviceFee: txResult.fees.serviceFee,
          serviceFeePercent: txResult.fees.serviceFeePercent,
          buyerTotal: txResult.fees.buyerTotal,
        },
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating Stripe checkout', { transactionId, error: message });
      throw new HttpsError('internal', `Failed to create checkout: ${message}`);
    }
  }
);

// =============================================================================
// CREATE STRIPE CONNECT ACCOUNT — Custom account (zero seller interaction)
// =============================================================================

/**
 * Creates a Stripe Connect Custom account for the authenticated seller.
 * With Custom accounts, the platform controls the entire onboarding —
 * the seller never sees Stripe UI. Bank account info is collected in-app
 * and submitted via the addBankAccount callable.
 *
 * Idempotent: if the seller already has a stripeAccountId, returns it
 * without creating a new account.
 *
 * This function serves as a fallback/manual trigger. The primary path
 * creates the Stripe account silently inside createArticle at first publish.
 */
export const createStripeConnectAccount = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;
      let stripeAccountId = userData.stripeAccountId;

      // Idempotent: if account already exists, return it
      if (stripeAccountId) {
        logger.info('Stripe Custom account already exists', {
          userId,
          stripeAccountId,
        });
        return {
          success: true,
          stripeAccountId,
        };
      }

      // Create a new Connect Custom account
      const account = await stripe.accounts.create({
        type: 'custom',
        country: 'CA',
        email: userData.email || request.auth.token.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        tos_acceptance: {
          service_agreement: 'recipient',
        },
        metadata: {
          firebaseUserId: userId,
        },
      });

      stripeAccountId = account.id;

      // Store the Stripe account ID and initial status in the user document.
      // All five Stripe fields are written here so the frontend can read
      // them immediately without waiting for the account.updated webhook.
      await userRef.update({
        stripeAccountId: account.id,
        stripeAccountStatus: 'pending',
        stripeChargesEnabled: false,
        stripePayoutsEnabled: false,
        stripeDetailsSubmitted: false,
        stripeAccountCreatedAt: FieldValue.serverTimestamp(),
      });

      logger.info('Stripe Custom account created', {
        userId,
        stripeAccountId: account.id,
      });

      // No Account Links needed for Custom accounts — bank info is
      // collected in-app via addBankAccount callable.

      return {
        success: true,
        stripeAccountId,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating Stripe Custom account', { userId, error: message });
      throw new HttpsError('internal', `Failed to create Connect account: ${message}`);
    }
  }
);

// =============================================================================
// ADD BANK ACCOUNT — Attach Canadian bank account to seller's Custom account
// =============================================================================

/**
 * Attaches a Canadian bank account to the seller's Stripe Connect Custom
 * account. The seller provides transit number (5 digits), institution
 * number (3 digits), and account number directly in the app UI.
 *
 * Canadian routing_number format for Stripe:
 * transit (5 digits) + institution (3 digits) = 8 digits total
 *
 * After attaching the bank account, configures manual payouts so the
 * platform controls when funds are disbursed (via requestWithdrawal).
 */
export const addBankAccount = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;
    const { transitNumber, institutionNumber, accountNumber, accountHolderName } = request.data ?? {};

    // ── Input validation ──
    if (typeof transitNumber !== 'string' || !/^\d{5}$/.test(transitNumber)) {
      throw new HttpsError(
        'invalid-argument',
        'Le numero de transit doit contenir exactement 5 chiffres'
      );
    }
    if (typeof institutionNumber !== 'string' || !/^\d{3}$/.test(institutionNumber)) {
      throw new HttpsError(
        'invalid-argument',
        'Le numero d\'institution doit contenir exactement 3 chiffres'
      );
    }
    if (typeof accountNumber !== 'string' || !/^\d{7,12}$/.test(accountNumber)) {
      throw new HttpsError(
        'invalid-argument',
        'Le numero de compte doit contenir entre 7 et 12 chiffres'
      );
    }

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;
      const stripeAccountId = userData.stripeAccountId;

      if (!stripeAccountId) {
        throw new HttpsError(
          'failed-precondition',
          'Aucun compte de paiement trouve. Publiez un article d\'abord.'
        );
      }

      // Canadian routing_number = transit (5) + institution (3) = 8 digits
      const routingNumber = `${transitNumber}${institutionNumber}`;

      // Create external bank account on the Custom connected account
      await stripe.accounts.createExternalAccount(stripeAccountId, {
        external_account: {
          object: 'bank_account',
          country: 'CA',
          currency: 'cad',
          routing_number: routingNumber,
          account_number: accountNumber,
          ...(accountHolderName && typeof accountHolderName === 'string'
            ? { account_holder_name: accountHolderName.trim().substring(0, 200) }
            : {}),
        },
      });

      // Configure manual payouts — the platform controls disbursement
      // via the requestWithdrawal callable (Stripe Payouts API)
      await stripe.accounts.update(stripeAccountId, {
        settings: {
          payouts: {
            schedule: {
              interval: 'manual' as const,
            },
          },
        },
      });

      // Update user document with bank account status
      await userRef.update({
        stripeBankAccountAdded: true,
        stripeBankAccountLast4: accountNumber.slice(-4),
        stripePayoutsEnabled: true,
      });

      logger.info('Bank account added to Stripe Custom account', {
        userId,
        stripeAccountId,
        routingNumber,
        accountLast4: accountNumber.slice(-4),
      });

      return {
        success: true,
        bankAccountLast4: accountNumber.slice(-4),
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error adding bank account', { userId, error: message });
      throw new HttpsError('internal', `Echec de l'ajout du compte bancaire: ${message}`);
    }
  }
);

// =============================================================================
// GET STRIPE ACCOUNT STATUS — Check if seller's Connect account is active
// =============================================================================

/**
 * Retrieves the current status of the seller's Stripe Connect account
 * (charges_enabled, payouts_enabled, details_submitted) and updates
 * the status in Firestore.
 */
export const getStripeAccountStatus = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const userId = request.auth.uid;

    try {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;
      const stripeAccountId = userData.stripeAccountId;

      if (!stripeAccountId) {
        return {
          success: true,
          hasAccount: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          status: 'none',
        };
      }

      // Retrieve the account from Stripe
      const account = await stripe.accounts.retrieve(stripeAccountId);

      // Determine status
      let status: string;
      if (account.charges_enabled && account.payouts_enabled) {
        status = 'active';
      } else if (account.details_submitted) {
        status = 'pending_verification';
      } else {
        status = 'pending';
      }

      // Update Firestore with latest status
      await userRef.update({
        stripeAccountStatus: status,
        stripeChargesEnabled: account.charges_enabled,
        stripePayoutsEnabled: account.payouts_enabled,
        stripeDetailsSubmitted: account.details_submitted,
      });

      logger.info('Stripe account status checked', {
        userId,
        stripeAccountId,
        status,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      });

      return {
        success: true,
        hasAccount: true,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        status,
      };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error checking Stripe account status', { userId, error: message });
      throw new HttpsError('internal', `Failed to check account status: ${message}`);
    }
  }
);

// =============================================================================
// FIND PICKUP POINTS — ShipEngine PUDO search
// =============================================================================

export const findPickupPoints = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
  const { postalCode } = request.data;

  if (!postalCode) {
    throw new HttpsError('invalid-argument', 'Postal code is required');
  }

  const shipEngine = getShipEngine();
  if (!shipEngine) {
    throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
  }

  try {
    const locations = await shipEngine.findPUDOLocations(postalCode, 'CA', 10);

    return {
      success: true,
      locations,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error finding pickup points:', error);
    throw new HttpsError('internal', `Failed to find pickup points: ${message}`);
  }
});

// =============================================================================
// CHECK TRACKING STATUS — Via ShipEngine
// =============================================================================

export const checkTrackingStatus = onCall({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { transactionId } = request.data;

  if (!transactionId) {
    throw new HttpsError('invalid-argument', 'Transaction ID is required');
  }

  try {
    const transactionDoc = await db.collection('transactions').doc(transactionId).get();

    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transaction = transactionDoc.data()!;

    // SECURITY: only the buyer or seller can trigger tracking status checks.
    // Without this, any authenticated user could force DELIVERED status and
    // trigger fund transfer to the seller.
    const callerUid = request.auth.uid;
    if (transaction.buyerId !== callerUid && transaction.sellerId !== callerUid) {
      throw new HttpsError(
        'permission-denied',
        'You are not authorized for this transaction'
      );
    }

    if (!transaction.trackingNumber) {
      throw new HttpsError('failed-precondition', 'No tracking number available');
    }

    const shipEngine = getShipEngine();
    if (!shipEngine) {
      throw new HttpsError('failed-precondition', 'ShipEngine API not configured');
    }

    const carrierCode = transaction.carrierCode || 'intelcom_ca';
    const tracking = await shipEngine.getTracking(carrierCode, transaction.trackingNumber);

    const trackingStatus = ShipEngineClient.mapStatus(tracking.statusCode);

    // If delivered, atomically update transaction status AND credit seller
    // balance in a single runTransaction to prevent partial writes (e.g.
    // marking delivered but failing to credit the seller).
    if (trackingStatus === 'DELIVERED') {
      const txRef = db.collection('transactions').doc(transactionId);
      const sellerId = transaction.sellerId;
      const sellerPayout = transaction.sellerPayout || transaction.amount;
      const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);

      await db.runTransaction(async (t) => {
        const [txSnap, sellerBalanceDoc] = await Promise.all([
          t.get(txRef),
          t.get(sellerBalanceRef),
        ]);

        // Guard: if already delivered, skip (idempotent)
        if (txSnap.exists && txSnap.data()!.status === 'delivered') {
          return;
        }

        // 1. Update transaction: trackingStatus + status + deliveredAt
        t.update(txRef, {
          trackingStatus,
          status: 'delivered',
          deliveredAt: FieldValue.serverTimestamp(),
        });

        // 2. Credit seller balance: pending → available
        if (sellerBalanceDoc.exists) {
          const balanceData = sellerBalanceDoc.data()!;
          const txns = balanceData.transactions || [];

          // H7: Guard against negative pendingBalance
          const currentPending = balanceData.pendingBalance || 0;
          let actualPayout = sellerPayout;
          if (currentPending < sellerPayout) {
            logger.warn(`[checkTrackingStatus] pendingBalance (${currentPending}) < sellerPayout (${sellerPayout}) for seller ${sellerId}`);
            actualPayout = Math.min(sellerPayout, Math.max(0, currentPending));
          }

          const updatedTransactions = txns.map((txn: any) => {
            if (txn.id === transactionId) {
              return { ...txn, status: 'completed' };
            }
            return txn;
          });

          t.update(sellerBalanceRef, {
            pendingBalance: FieldValue.increment(-actualPayout),
            availableBalance: FieldValue.increment(actualPayout),
            totalEarnings: FieldValue.increment(actualPayout),
            transactions: updatedTransactions,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      // Send system message (non-critical, outside transaction)
      if (transaction.chatId) {
        // Look up chat participants so the message is visible to listeners
        // that filter messages by participants and respects rules.
        let participants: string[] = [];
        try {
          const chatSnap = await db.collection('chats').doc(transaction.chatId).get();
          if (chatSnap.exists) {
            participants = (chatSnap.data()?.participants as string[]) || [];
          }
        } catch (lookupErr) {
          logger.warn('[payments] Could not load chat participants', {
            chatId: transaction.chatId,
            error: lookupErr instanceof Error ? lookupErr.message : lookupErr,
          });
        }

        await db.collection('messages').add({
          chatId: transaction.chatId,
          senderId: 'system',
          receiverId: 'system',
          type: 'system',
          content: 'Colis livré ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
          participants,
          timestamp: FieldValue.serverTimestamp(),
          status: 'sent',
          isRead: true,
        });
      }

      // Push notification to buyer: order delivered
      try {
        const articleTitle = transaction.articleTitle || 'votre commande';
        await sendPushNotification(
          transaction.buyerId,
          'Colis livre !',
          `Votre commande ${articleTitle} a ete livree.`,
          { transactionId, articleId: transaction.articleId || '' },
          'order_delivered'
        );
      } catch (notifError) {
        logger.warn('[checkTrackingStatus] Failed to send buyer delivery notification', {
          transactionId,
          error: notifError instanceof Error ? notifError.message : notifError,
        });
      }
    } else {
      // Not delivered yet — just update the tracking status
      await db.collection('transactions').doc(transactionId).update({
        trackingStatus,
      });
    }

    return {
      success: true,
      trackingStatus,
      trackingHistory: tracking.events || [],
    };
  } catch (error: unknown) {
    if (error instanceof HttpsError) throw error;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error checking tracking status:', error);
    throw new HttpsError('internal', `Failed to check tracking: ${message}`);
  }
});

// =============================================================================
// REQUEST WITHDRAWAL — Stripe Payout + atomic balance debit
// =============================================================================

/**
 * Caller (the seller) requests a withdrawal of `amount` from their
 * available balance. The function creates a real Stripe Payout on the
 * seller's Custom connected account, debits the seller_balance atomically,
 * and stores the payoutId for tracking.
 *
 * Prerequisites:
 * - Seller must have a stripeAccountId (Custom account)
 * - Seller must have a bank account attached (via addBankAccount)
 * - Minimum withdrawal: 10 CAD
 *
 * Why this is a CF, not a client mutation:
 * - The previous client implementation read the balance, then issued an
 *   updateDoc with `increment(-amount)`. Two concurrent requests could both
 *   pass the read-side check and double-spend.
 * - Validation (min amount, balance check, Stripe account check) must run on
 *   a server we trust.
 *
 * Authorization: caller must be the balance owner (request.auth.uid).
 */
export const requestWithdrawal = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { amount } = request.data ?? {};
    const userId = request.auth.uid;

    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
      throw new HttpsError('invalid-argument', 'Invalid amount');
    }
    if (amount < 10) {
      throw new HttpsError('invalid-argument', 'Le retrait minimum est de 10 $');
    }

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    // Verify seller has a Stripe Custom account with bank account attached
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }
    const userData = userDoc.data()!;
    const stripeAccountId = userData.stripeAccountId;

    if (!stripeAccountId) {
      throw new HttpsError(
        'failed-precondition',
        'Aucun compte de paiement configure. Publiez un article d\'abord.'
      );
    }
    if (!userData.stripeBankAccountAdded) {
      throw new HttpsError(
        'failed-precondition',
        'Veuillez ajouter un compte bancaire avant de demander un retrait.'
      );
    }

    const balanceRef = db.collection('seller_balances').doc(userId);

    try {
      // Use Firestore auto-generated ID to avoid collision from Date.now()
      const withdrawalRef = db.collection('withdrawal_requests').doc();
      const withdrawalId = withdrawalRef.id;

      // Step 1: Atomically debit the balance and create the withdrawal record
      const bankLast4 = userData.stripeBankAccountLast4 || '****';

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(balanceRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Balance not found');
        }
        const data = snap.data()!;
        const available = typeof data.availableBalance === 'number' ? data.availableBalance : 0;
        if (available < amount) {
          throw new HttpsError('failed-precondition', 'Solde insuffisant');
        }

        const transactions = Array.isArray(data.transactions) ? data.transactions : [];
        const withdrawalEntry = {
          id: withdrawalId,
          type: 'withdrawal',
          amount: -amount,
          description: `Retrait vers ****${bankLast4}`,
          // serverTimestamp() can't be used inside an array element; use Date instead.
          createdAt: new Date(),
          status: 'processing',
        };

        tx.update(balanceRef, {
          availableBalance: FieldValue.increment(-amount),
          transactions: [...transactions, withdrawalEntry],
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Persist the withdrawal request as a separate doc INSIDE the
        // transaction so balance deduction and record creation are atomic.
        tx.set(withdrawalRef, {
          withdrawalId,
          userId,
          amount,
          bankAccountLast4: bankLast4,
          stripeAccountId,
          status: 'processing',
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      // Step 2: Create the Stripe Payout on the connected account
      // This is outside the Firestore transaction because it's an external
      // API call. If it fails, we have the withdrawal_request doc with status
      // 'processing' that can be retried.
      try {
        const amountInCents = Math.round(amount * 100);
        const payout = await stripe.payouts.create(
          {
            amount: amountInCents,
            currency: 'cad',
            metadata: {
              withdrawalId,
              firebaseUserId: userId,
            },
          },
          { stripeAccount: stripeAccountId }
        );

        // Update the withdrawal request with the Stripe payout ID
        await withdrawalRef.update({
          stripePayoutId: payout.id,
          status: 'processing',
        });

        logger.info('Stripe payout created', {
          userId,
          withdrawalId,
          payoutId: payout.id,
          amount,
        });

        return { success: true, withdrawalId, payoutId: payout.id };
      } catch (payoutError) {
        // Stripe payout failed — revert the balance deduction
        logger.error('Stripe payout failed — reverting balance', {
          userId,
          withdrawalId,
          error: payoutError instanceof Error ? payoutError.message : payoutError,
        });

        await db.runTransaction(async (tx) => {
          const snap = await tx.get(balanceRef);
          if (!snap.exists) return;

          const data = snap.data()!;
          const transactions = Array.isArray(data.transactions) ? data.transactions : [];
          const updatedTransactions = transactions.map((txn: any) => {
            if (txn.id === withdrawalId) {
              return { ...txn, status: 'failed' };
            }
            return txn;
          });

          tx.update(balanceRef, {
            availableBalance: FieldValue.increment(amount),
            transactions: updatedTransactions,
            updatedAt: FieldValue.serverTimestamp(),
          });
        });

        // Mark withdrawal request as failed
        await withdrawalRef.update({
          status: 'failed',
          failureReason: payoutError instanceof Error ? payoutError.message : 'Unknown Stripe error',
          failedAt: FieldValue.serverTimestamp(),
        });

        const message = payoutError instanceof Error ? payoutError.message : 'Unknown error';
        throw new HttpsError('internal', `Echec du retrait: ${message}`);
      }
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[requestWithdrawal] Error', { userId, error: message });
      throw new HttpsError('internal', `Failed to request withdrawal: ${message}`);
    }
  }
);

// =============================================================================
// COMPLETE MEETUP TRANSACTION — Buyer confirms receipt, credits seller
// =============================================================================

/**
 * Buyer confirms the meetup exchange was completed. This transitions the
 * transaction from `meetup_confirmed` → `meetup_completed` and credits the
 * seller balance (pending → available), mirroring what checkTrackingStatus
 * does for shipping transactions on DELIVERED.
 *
 * Only the buyer can call this (the buyer confirms receipt).
 */
export const completeMeetupTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { transactionId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    try {
      const transactionData = await db.runTransaction(async (tx) => {
        const txSnap = await tx.get(txRef);
        if (!txSnap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }

        const data = txSnap.data()!;

        // Only the buyer can confirm receipt
        if (data.buyerId !== callerUid) {
          throw new HttpsError('permission-denied', 'Only the buyer can complete the meetup');
        }

        // Must be in meetup_confirmed status
        if (data.status !== 'meetup_confirmed') {
          throw new HttpsError(
            'failed-precondition',
            `Cannot complete meetup from status ${data.status}`
          );
        }

        const sellerId = data.sellerId;
        const sellerPayout = data.sellerPayout || data.amount;
        const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);

        const sellerBalanceDoc = await tx.get(sellerBalanceRef);

        // 1. Update transaction status
        tx.update(txRef, {
          status: 'meetup_completed',
          completedAt: FieldValue.serverTimestamp(),
        });

        // 2. Credit seller balance: pending → available
        if (sellerBalanceDoc.exists) {
          const balanceData = sellerBalanceDoc.data()!;
          const txns = balanceData.transactions || [];

          // Guard against negative pendingBalance (same as H7)
          const currentPending = balanceData.pendingBalance || 0;
          let actualPayout = sellerPayout;
          if (currentPending < sellerPayout) {
            logger.warn(`[completeMeetupTransaction] pendingBalance (${currentPending}) < sellerPayout (${sellerPayout}) for seller ${sellerId}`);
            actualPayout = Math.min(sellerPayout, Math.max(0, currentPending));
          }

          const updatedTransactions = txns.map((txn: any) => {
            if (txn.id === transactionId) {
              return { ...txn, status: 'completed' };
            }
            return txn;
          });

          // NOTE: totalEarnings includes ALL completed sales (shipping + meetup)
          // as a comprehensive reference. totalMeetupEarnings tracks meetup-only
          // amounts separately so the seller balance screen can distinguish
          // platform-processed funds from in-person exchanges.
          tx.update(sellerBalanceRef, {
            pendingBalance: FieldValue.increment(-actualPayout),
            availableBalance: FieldValue.increment(actualPayout),
            totalEarnings: FieldValue.increment(actualPayout),
            totalMeetupEarnings: FieldValue.increment(actualPayout),
            transactions: updatedTransactions,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          // Seller balance doc doesn't exist yet (meetup has no webhook to create it).
          // Create it with the payout directly as available.
          tx.set(sellerBalanceRef, {
            pendingBalance: 0,
            availableBalance: sellerPayout,
            totalEarnings: sellerPayout,
            totalMeetupEarnings: sellerPayout,
            transactions: [{
              id: transactionId,
              type: 'sale',
              amount: sellerPayout,
              description: 'Vente meetup',
              createdAt: new Date(),
              status: 'completed',
            }],
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        return { chatId: data.chatId, sellerId };
      });

      // Send system message (non-critical, outside transaction)
      if (transactionData.chatId) {
        let participants: string[] = [];
        try {
          const chatSnap = await db.collection('chats').doc(transactionData.chatId).get();
          if (chatSnap.exists) {
            participants = (chatSnap.data()?.participants as string[]) || [];
          }
        } catch (lookupErr) {
          console.warn('[completeMeetupTransaction] Could not load chat participants:', lookupErr);
        }

        await db.collection('messages').add({
          chatId: transactionData.chatId,
          senderId: 'system',
          receiverId: 'system',
          type: 'system',
          content: 'Rencontre confirmée ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
          participants,
          timestamp: FieldValue.serverTimestamp(),
          status: 'sent',
          isRead: true,
        });
      }

      console.log(`✅ Meetup transaction ${transactionId} completed. Seller ${transactionData.sellerId} credited.`);

      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error completing meetup transaction:', error);
      throw new HttpsError('internal', `Failed to complete meetup: ${message}`);
    }
  }
);

// =============================================================================
// CANCEL PENDING TRANSACTION — Buyer cancels a non-paid transaction
// =============================================================================

/**
 * Buyer cancels a transaction that has not been paid yet (e.g. Stripe
 * checkout failed or was abandoned).
 *
 * Authorization: caller must be the buyer of the transaction. We refuse to
 * cancel transactions whose current status is anything beyond pending —
 * we cannot mark a paid/shipped/delivered transaction as cancelled this way.
 */
export const cancelPendingTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const txRef = db.collection('transactions').doc(transactionId);
    const callerUid = request.auth.uid;

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(txRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = snap.data()!;

        // H15: Allow both buyer and seller to cancel
        if (data.buyerId !== callerUid && data.sellerId !== callerUid) {
          throw new HttpsError(
            'permission-denied',
            'Only buyer or seller can cancel'
          );
        }

        // H15: Added meetup_confirmed to cancellable statuses
        const cancellableStatuses = new Set([
          'pending',
          'pending_payment',
          'meetup_pending',
          'meetup_confirmed',
        ]);
        if (!cancellableStatuses.has(data.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot cancel transaction in status ${data.status}`
          );
        }
        tx.update(txRef, {
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: callerUid,
        });

        // Release the article so it can be purchased again.
        // createTransaction marks isSold=true atomically at creation
        // time; cancelling must undo that.
        // D2: Guard against deleted article — only update if it still exists
        if (data.articleId) {
          const articleRef = db.collection('articles').doc(data.articleId);
          const articleSnap = await tx.get(articleRef);
          if (articleSnap.exists) {
            tx.update(articleRef, { isSold: false });
          }
        }
      });

      return { success: true };
    } catch (error: unknown) {
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error cancelling transaction:', error);
      throw new HttpsError('internal', `Failed to cancel: ${message}`);
    }
  }
);
