"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelPendingTransaction = exports.completeMeetupTransaction = exports.requestWithdrawal = exports.checkTrackingStatus = exports.findPickupPoints = exports.getStripeAccountStatus = exports.getStripeAccountLink = exports.createStripeConnectAccount = exports.createStripeCheckout = exports.createTransaction = exports.getServiceFee = exports.getShippingEstimate = void 0;
/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 *
 * Shipping via ShipEngine (Intelcom + Canada Post)
 * Payment via Stripe Connect Standard (destination charges)
 * Commission via service fee calculation (application_fee_amount)
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const shipEngine_1 = require("../config/shipEngine");
const stripe_1 = require("../config/stripe");
const fees_1 = require("../utils/fees");
// =============================================================================
// GET SHIPPING ESTIMATES — Multi-carrier via ShipEngine
// =============================================================================
exports.getShippingEstimate = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
    const { fromAddress, toAddress, weight, dimensions } = request.data;
    if (!fromAddress || !toAddress) {
        throw new https_1.HttpsError('invalid-argument', 'From and to addresses are required');
    }
    const shipEngine = (0, shipEngine_1.getShipEngine)();
    if (!shipEngine) {
        throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
    }
    try {
        const parcelWeight = parseFloat(weight) || 0.5;
        const parcelLength = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.length) || 30;
        const parcelWidth = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.width) || 25;
        const parcelHeight = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.height) || 10;
        console.log('📦 Getting ShipEngine multi-carrier rates:', {
            from: fromAddress.postalCode,
            to: toAddress.postalCode,
            weight: parcelWeight,
        });
        // Rate shopping across Intelcom + Canada Post via ShipEngine
        const rates = await shipEngine.getRates({
            name: fromAddress.name || 'Vendeur',
            addressLine1: fromAddress.street || '',
            cityLocality: fromAddress.city || '',
            stateProvince: fromAddress.province || 'QC',
            postalCode: fromAddress.postalCode,
            countryCode: 'CA',
        }, {
            name: toAddress.name || 'Acheteur',
            addressLine1: toAddress.street || '',
            cityLocality: toAddress.city || '',
            stateProvince: toAddress.province || 'QC',
            postalCode: toAddress.postalCode,
            countryCode: 'CA',
        }, {
            weight: { value: parcelWeight, unit: 'kilogram' },
            dimensions: {
                length: parcelLength,
                width: parcelWidth,
                height: parcelHeight,
                unit: 'centimeter',
            },
        });
        // Format rates for the client
        const formattedRates = rates
            .sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount)
            .slice(0, 5)
            .map((rate) => ({
            rateId: rate.rateId,
            carrier: rate.carrierFriendlyName,
            carrierCode: rate.carrierCode,
            serviceName: rate.serviceType,
            estimatedDays: `${rate.estimatedDeliveryDays} jour${rate.estimatedDeliveryDays > 1 ? 's' : ''} ouvrable${rate.estimatedDeliveryDays > 1 ? 's' : ''}`,
            amount: rate.shippingAmount.amount,
            currency: rate.shippingAmount.currency,
            deliveryType: rate.deliveryType,
        }));
        console.log(`✅ Retrieved ${formattedRates.length} shipping rates from ShipEngine`);
        return {
            success: true,
            rates: formattedRates,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error getting shipping estimate:', error);
        throw new https_1.HttpsError('internal', `Failed to get shipping estimate: ${message}`);
    }
});
// =============================================================================
// GET SERVICE FEE — Returns fee info for client display
// =============================================================================
exports.getServiceFee = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    const { articlePrice } = request.data;
    if (!articlePrice || articlePrice <= 0) {
        throw new https_1.HttpsError('invalid-argument', 'Article price is required');
    }
    const serviceFee = (0, fees_1.calculateServiceFee)(articlePrice);
    const config = (0, fees_1.getServiceFeeConfig)();
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
exports.createTransaction = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { articleId, deliveryType, amount, shippingCost, shippingAddress, meetupSpot, chatId, shipEngineRateId, } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    const buyerId = request.auth.uid;
    // --- Input validation ---------------------------------------------------
    if (typeof articleId !== 'string' || articleId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'articleId is required');
    }
    if (deliveryType !== 'shipping' && deliveryType !== 'meetup') {
        throw new https_1.HttpsError('invalid-argument', 'deliveryType must be "shipping" or "meetup"');
    }
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
        throw new https_1.HttpsError('invalid-argument', 'amount must be a positive number');
    }
    if (deliveryType === 'shipping') {
        if (typeof shippingCost !== 'number' || !isFinite(shippingCost) || shippingCost < 0) {
            throw new https_1.HttpsError('invalid-argument', 'shippingCost is required for shipping');
        }
        if (!shippingAddress || typeof shippingAddress !== 'object') {
            throw new https_1.HttpsError('invalid-argument', 'shippingAddress is required for shipping');
        }
    }
    // --- Atomic check + create -----------------------------------------------
    const articleRef = firebase_1.db.collection('articles').doc(articleId);
    try {
        const transactionId = await firebase_1.db.runTransaction(async (tx) => {
            const articleSnap = await tx.get(articleRef);
            if (!articleSnap.exists) {
                throw new https_1.HttpsError('not-found', 'Cet article n\'existe plus');
            }
            const articleData = articleSnap.data();
            if (articleData.isSold === true) {
                throw new https_1.HttpsError('failed-precondition', 'Cet article a déjà été vendu');
            }
            if (articleData.isActive === false) {
                throw new https_1.HttpsError('failed-precondition', 'Cet article n\'est plus disponible');
            }
            if (articleData.sellerId === buyerId) {
                throw new https_1.HttpsError('invalid-argument', 'Vous ne pouvez pas acheter votre propre article');
            }
            // Verify the amount is valid:
            // - Exact listed price is always accepted.
            // - A negotiated (lower) price is accepted if positive and below listed price.
            //   The negotiation was validated via the offer/accept flow in chat.
            // - Amounts above listed price are rejected (overpay protection).
            if (amount > articleData.price) {
                throw new https_1.HttpsError('failed-precondition', 'Le montant dépasse le prix de l\'article.');
            }
            if (amount !== articleData.price && amount <= 0) {
                throw new https_1.HttpsError('invalid-argument', 'Le montant doit être supérieur à zéro.');
            }
            // Mark article as sold
            tx.update(articleRef, { isSold: true });
            // Build transaction data — server-side fee calculation (never trust client)
            const fee = (0, fees_1.calculateServiceFee)(amount);
            const shipping = deliveryType === 'shipping' ? (shippingCost || 0) : 0;
            const totalAmount = amount + shipping + fee;
            const transactionData = {
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
                createdAt: firebase_1.FieldValue.serverTimestamp(),
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
                const cleanSpot = {
                    name: meetupSpot.name,
                    category: meetupSpot.category,
                    neighborhood: meetupSpot.neighborhood,
                };
                if (meetupSpot.id)
                    cleanSpot.id = meetupSpot.id;
                if (meetupSpot.address)
                    cleanSpot.address = meetupSpot.address;
                if (meetupSpot.coordinates)
                    cleanSpot.coordinates = meetupSpot.coordinates;
                transactionData.meetupSpot = cleanSpot;
            }
            const newTxRef = firebase_1.db.collection('transactions').doc();
            tx.set(newTxRef, transactionData);
            return newTxRef.id;
        });
        console.log(`✅ Transaction ${transactionId} created for article ${articleId} (${deliveryType}) by buyer ${buyerId}`);
        return { success: true, transactionId };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error creating transaction:', error);
        throw new https_1.HttpsError('internal', `Failed to create transaction: ${message}`);
    }
});
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
exports.createStripeCheckout = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = request.data;
    if (!transactionId || typeof transactionId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    try {
        const txRef = firebase_1.db.collection('transactions').doc(transactionId);
        // Atomically read, validate, and update fee fields inside a transaction
        // to prevent races where concurrent calls both see no PaymentIntent and
        // double-create.
        const txResult = await firebase_1.db.runTransaction(async (tx) => {
            const transactionDoc = await tx.get(txRef);
            if (!transactionDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Transaction not found');
            }
            const transaction = transactionDoc.data();
            // Verify the user is the buyer
            if (transaction.buyerId !== request.auth.uid) {
                throw new https_1.HttpsError('permission-denied', 'You are not authorized for this transaction');
            }
            // Only allow checkout creation from valid statuses
            const checkoutableStatuses = new Set(['pending_payment']);
            if (!checkoutableStatuses.has(transaction.status)) {
                throw new https_1.HttpsError('failed-precondition', `Cannot create checkout for transaction in status ${transaction.status}`);
            }
            // Idempotent: if a PaymentIntent already exists, return existing clientSecret
            if (transaction.stripePaymentIntentId && transaction.stripeClientSecret) {
                const existingFees = (0, fees_1.calculateFees)(transaction.amount, transaction.shippingCost || 0);
                return {
                    existingCheckout: true,
                    fees: existingFees,
                    clientSecret: transaction.stripeClientSecret,
                    sellerId: transaction.sellerId,
                };
            }
            // Always recalculate fees server-side for correctness
            const calculatedFees = (0, fees_1.calculateFees)(transaction.amount, transaction.shippingCost || 0);
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
                clientSecret: null,
                sellerId: transaction.sellerId,
            };
        });
        // Idempotent return: PaymentIntent already existed
        if (txResult.existingCheckout) {
            logger.info('Returning existing Stripe PaymentIntent', { transactionId });
            return {
                success: true,
                clientSecret: txResult.clientSecret,
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
        const sellerDoc = await firebase_1.db.collection('users').doc(txResult.sellerId).get();
        if (!sellerDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Seller not found');
        }
        const sellerData = sellerDoc.data();
        const sellerStripeAccountId = sellerData.stripeAccountId;
        if (!sellerStripeAccountId) {
            throw new https_1.HttpsError('failed-precondition', 'Le vendeur n\'a pas encore configuré son compte de paiement');
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
                buyerId: request.auth.uid,
            },
            // Defer payouts until delivery confirmed (escrow simulation)
            // The actual payout hold is managed via the connected account's schedule
        });
        // Store PaymentIntent details in the transaction doc
        await txRef.update({
            stripePaymentIntentId: paymentIntent.id,
            stripeClientSecret: paymentIntent.client_secret,
            stripeCheckoutCreatedAt: firebase_1.FieldValue.serverTimestamp(),
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
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error creating Stripe checkout', { transactionId, error: message });
        throw new https_1.HttpsError('internal', `Failed to create checkout: ${message}`);
    }
});
// =============================================================================
// CREATE STRIPE CONNECT ACCOUNT — Onboard seller to Stripe Connect Standard
// =============================================================================
/**
 * Creates a Stripe Connect Standard account for the authenticated seller
 * and returns an Account Link URL to complete onboarding in a browser/WebView.
 *
 * If the seller already has a Stripe account, returns a new Account Link
 * for re-onboarding (e.g. if they didn't finish).
 */
exports.createStripeConnectAccount = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    const userId = request.auth.uid;
    try {
        const userRef = firebase_1.db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new https_1.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
        let stripeAccountId = userData.stripeAccountId;
        // Create a new Connect account if the seller doesn't have one
        if (!stripeAccountId) {
            const account = await stripe.accounts.create({
                type: 'standard',
                country: 'CA',
                email: userData.email || request.auth.token.email,
                metadata: {
                    firebaseUserId: userId,
                },
            });
            stripeAccountId = account.id;
            // Store the Stripe account ID in the user document
            await userRef.update({
                stripeAccountId: account.id,
                stripeAccountStatus: 'pending',
                stripeAccountCreatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            logger.info('Stripe Connect account created', {
                userId,
                stripeAccountId: account.id,
            });
        }
        // Generate an Account Link for onboarding
        const accountLink = await stripe.accountLinks.create({
            account: stripeAccountId,
            refresh_url: `https://second.app/settings/payments?refresh=true`,
            return_url: `https://second.app/settings/payments?success=true`,
            type: 'account_onboarding',
        });
        return {
            success: true,
            accountLinkUrl: accountLink.url,
            stripeAccountId,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error creating Stripe Connect account', { userId, error: message });
        throw new https_1.HttpsError('internal', `Failed to create Connect account: ${message}`);
    }
});
// =============================================================================
// GET STRIPE ACCOUNT LINK — Re-generate onboarding link
// =============================================================================
/**
 * Generates a new Account Link for a seller who has a Stripe Connect account
 * but hasn't completed onboarding yet. Useful when the previous link expired.
 */
exports.getStripeAccountLink = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    const userId = request.auth.uid;
    try {
        const userDoc = await firebase_1.db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            throw new https_1.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
        const stripeAccountId = userData.stripeAccountId;
        if (!stripeAccountId) {
            throw new https_1.HttpsError('failed-precondition', 'No Stripe account found. Please create one first.');
        }
        const accountLink = await stripe.accountLinks.create({
            account: stripeAccountId,
            refresh_url: `https://second.app/settings/payments?refresh=true`,
            return_url: `https://second.app/settings/payments?success=true`,
            type: 'account_onboarding',
        });
        logger.info('Stripe Account Link generated', { userId, stripeAccountId });
        return {
            success: true,
            accountLinkUrl: accountLink.url,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error generating Stripe account link', { userId, error: message });
        throw new https_1.HttpsError('internal', `Failed to generate account link: ${message}`);
    }
});
// =============================================================================
// GET STRIPE ACCOUNT STATUS — Check if seller's Connect account is active
// =============================================================================
/**
 * Retrieves the current status of the seller's Stripe Connect account
 * (charges_enabled, payouts_enabled, details_submitted) and updates
 * the status in Firestore.
 */
exports.getStripeAccountStatus = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    const userId = request.auth.uid;
    try {
        const userRef = firebase_1.db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new https_1.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
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
        let status;
        if (account.charges_enabled && account.payouts_enabled) {
            status = 'active';
        }
        else if (account.details_submitted) {
            status = 'pending_verification';
        }
        else {
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
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error checking Stripe account status', { userId, error: message });
        throw new https_1.HttpsError('internal', `Failed to check account status: ${message}`);
    }
});
// =============================================================================
// FIND PICKUP POINTS — ShipEngine PUDO search
// =============================================================================
exports.findPickupPoints = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
    const { postalCode } = request.data;
    if (!postalCode) {
        throw new https_1.HttpsError('invalid-argument', 'Postal code is required');
    }
    const shipEngine = (0, shipEngine_1.getShipEngine)();
    if (!shipEngine) {
        throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
    }
    try {
        const locations = await shipEngine.findPUDOLocations(postalCode, 'CA', 10);
        return {
            success: true,
            locations,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error finding pickup points:', error);
        throw new https_1.HttpsError('internal', `Failed to find pickup points: ${message}`);
    }
});
// =============================================================================
// CHECK TRACKING STATUS — Via ShipEngine
// =============================================================================
exports.checkTrackingStatus = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = request.data;
    if (!transactionId) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    try {
        const transactionDoc = await firebase_1.db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Transaction not found');
        }
        const transaction = transactionDoc.data();
        // SECURITY: only the buyer or seller can trigger tracking status checks.
        // Without this, any authenticated user could force DELIVERED status and
        // trigger fund transfer to the seller.
        const callerUid = request.auth.uid;
        if (transaction.buyerId !== callerUid && transaction.sellerId !== callerUid) {
            throw new https_1.HttpsError('permission-denied', 'You are not authorized for this transaction');
        }
        if (!transaction.trackingNumber) {
            throw new https_1.HttpsError('failed-precondition', 'No tracking number available');
        }
        const shipEngine = (0, shipEngine_1.getShipEngine)();
        if (!shipEngine) {
            throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
        }
        const carrierCode = transaction.carrierCode || 'intelcom_ca';
        const tracking = await shipEngine.getTracking(carrierCode, transaction.trackingNumber);
        const trackingStatus = shipEngine_1.ShipEngineClient.mapStatus(tracking.statusCode);
        // If delivered, atomically update transaction status AND credit seller
        // balance in a single runTransaction to prevent partial writes (e.g.
        // marking delivered but failing to credit the seller).
        if (trackingStatus === 'DELIVERED') {
            const txRef = firebase_1.db.collection('transactions').doc(transactionId);
            const sellerId = transaction.sellerId;
            const sellerPayout = transaction.sellerPayout || transaction.amount;
            const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
            await firebase_1.db.runTransaction(async (t) => {
                const [txSnap, sellerBalanceDoc] = await Promise.all([
                    t.get(txRef),
                    t.get(sellerBalanceRef),
                ]);
                // Guard: if already delivered, skip (idempotent)
                if (txSnap.exists && txSnap.data().status === 'delivered') {
                    return;
                }
                // 1. Update transaction: trackingStatus + status + deliveredAt
                t.update(txRef, {
                    trackingStatus,
                    status: 'delivered',
                    deliveredAt: firebase_1.FieldValue.serverTimestamp(),
                });
                // 2. Credit seller balance: pending → available
                if (sellerBalanceDoc.exists) {
                    const balanceData = sellerBalanceDoc.data();
                    const txns = balanceData.transactions || [];
                    // H7: Guard against negative pendingBalance
                    const currentPending = balanceData.pendingBalance || 0;
                    let actualPayout = sellerPayout;
                    if (currentPending < sellerPayout) {
                        logger.warn(`[checkTrackingStatus] pendingBalance (${currentPending}) < sellerPayout (${sellerPayout}) for seller ${sellerId}`);
                        actualPayout = Math.min(sellerPayout, Math.max(0, currentPending));
                    }
                    const updatedTransactions = txns.map((txn) => {
                        if (txn.id === transactionId) {
                            return Object.assign(Object.assign({}, txn), { status: 'completed' });
                        }
                        return txn;
                    });
                    t.update(sellerBalanceRef, {
                        pendingBalance: firebase_1.FieldValue.increment(-actualPayout),
                        availableBalance: firebase_1.FieldValue.increment(actualPayout),
                        totalEarnings: firebase_1.FieldValue.increment(actualPayout),
                        transactions: updatedTransactions,
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                }
            });
            // Send system message (non-critical, outside transaction)
            if (transaction.chatId) {
                // Look up chat participants so the message is visible to listeners
                // that filter messages by participants and respects rules.
                let participants = [];
                try {
                    const chatSnap = await firebase_1.db.collection('chats').doc(transaction.chatId).get();
                    if (chatSnap.exists) {
                        participants = ((_a = chatSnap.data()) === null || _a === void 0 ? void 0 : _a.participants) || [];
                    }
                }
                catch (lookupErr) {
                    console.warn('[payments] Could not load chat participants:', lookupErr);
                }
                await firebase_1.db.collection('messages').add({
                    chatId: transaction.chatId,
                    senderId: 'system',
                    receiverId: 'system',
                    type: 'system',
                    content: 'Colis livré ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
                    participants,
                    timestamp: firebase_1.FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                });
            }
        }
        else {
            // Not delivered yet — just update the tracking status
            await firebase_1.db.collection('transactions').doc(transactionId).update({
                trackingStatus,
            });
        }
        return {
            success: true,
            trackingStatus,
            trackingHistory: tracking.events || [],
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error checking tracking status:', error);
        throw new https_1.HttpsError('internal', `Failed to check tracking: ${message}`);
    }
});
// =============================================================================
// REQUEST WITHDRAWAL — Atomic balance debit + withdrawal record creation
// =============================================================================
/**
 * Caller (the seller) requests a withdrawal of `amount` to `bankAccount`.
 *
 * Why this is a CF, not a client mutation:
 * - The previous client implementation read the balance, then issued an
 *   updateDoc with `increment(-amount)`. Two concurrent requests could both
 *   pass the read-side check and double-spend.
 * - Validation (min amount, bank account format, balance check) must run on
 *   a server we trust.
 *
 * Canadian bank account format:
 * - With dashes: TTTTT-III-AAAAAAA (transit 5, institution 3, account 7-12)
 * - Raw digits: 15-20 digits total
 *
 * Authorization: caller must be the balance owner (request.auth.uid).
 */
exports.requestWithdrawal = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { amount, bankAccount } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    const userId = request.auth.uid;
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid amount');
    }
    if (amount < 10) {
        throw new https_1.HttpsError('invalid-argument', 'Minimum withdrawal is 10');
    }
    if (typeof bankAccount !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Numéro de compte bancaire requis');
    }
    // Validate Canadian bank account format
    // Accept either TTTTT-III-AAAAAAA (dashed) or raw digits (15-20 chars)
    const sanitizedBankAccount = bankAccount.replace(/[\s-]/g, '');
    const dashedFormat = /^\d{5}-\d{3}-\d{7,12}$/.test(bankAccount.trim());
    const rawFormat = /^\d{15,20}$/.test(sanitizedBankAccount);
    if (!dashedFormat && !rawFormat) {
        throw new https_1.HttpsError('invalid-argument', 'Format de compte bancaire invalide. Attendu : TTTTT-III-AAAAAAA ou 15-20 chiffres');
    }
    const balanceRef = firebase_1.db.collection('seller_balances').doc(userId);
    try {
        // Use Firestore auto-generated ID to avoid collision from Date.now()
        const withdrawalRef = firebase_1.db.collection('withdrawal_requests').doc();
        const withdrawalId = withdrawalRef.id;
        await firebase_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(balanceRef);
            if (!snap.exists) {
                throw new https_1.HttpsError('not-found', 'Balance not found');
            }
            const data = snap.data();
            const available = typeof data.availableBalance === 'number' ? data.availableBalance : 0;
            if (available < amount) {
                throw new https_1.HttpsError('failed-precondition', 'Insufficient balance');
            }
            const transactions = Array.isArray(data.transactions) ? data.transactions : [];
            const withdrawalEntry = {
                id: withdrawalId,
                type: 'withdrawal',
                amount: -amount,
                description: `Retrait vers ****${sanitizedBankAccount.slice(-4)}`,
                // serverTimestamp() can't be used inside an array element; use Date instead.
                createdAt: new Date(),
                status: 'pending',
            };
            tx.update(balanceRef, {
                availableBalance: firebase_1.FieldValue.increment(-amount),
                transactions: [...transactions, withdrawalEntry],
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            // Persist the withdrawal request as a separate doc INSIDE the
            // transaction so balance deduction and record creation are atomic.
            tx.set(withdrawalRef, {
                withdrawalId,
                userId,
                amount,
                bankAccountLast4: sanitizedBankAccount.slice(-4),
                status: 'pending',
                createdAt: firebase_1.FieldValue.serverTimestamp(),
            });
        });
        return { success: true, withdrawalId };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[requestWithdrawal] Error', { userId, error: message });
        throw new https_1.HttpsError('internal', `Failed to request withdrawal: ${message}`);
    }
});
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
exports.completeMeetupTransaction = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const callerUid = request.auth.uid;
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    try {
        const transactionData = await firebase_1.db.runTransaction(async (tx) => {
            const txSnap = await tx.get(txRef);
            if (!txSnap.exists) {
                throw new https_1.HttpsError('not-found', 'Transaction not found');
            }
            const data = txSnap.data();
            // Only the buyer can confirm receipt
            if (data.buyerId !== callerUid) {
                throw new https_1.HttpsError('permission-denied', 'Only the buyer can complete the meetup');
            }
            // Must be in meetup_confirmed status
            if (data.status !== 'meetup_confirmed') {
                throw new https_1.HttpsError('failed-precondition', `Cannot complete meetup from status ${data.status}`);
            }
            const sellerId = data.sellerId;
            const sellerPayout = data.sellerPayout || data.amount;
            const sellerBalanceRef = firebase_1.db.collection('seller_balances').doc(sellerId);
            const sellerBalanceDoc = await tx.get(sellerBalanceRef);
            // 1. Update transaction status
            tx.update(txRef, {
                status: 'meetup_completed',
                completedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            // 2. Credit seller balance: pending → available
            if (sellerBalanceDoc.exists) {
                const balanceData = sellerBalanceDoc.data();
                const txns = balanceData.transactions || [];
                // Guard against negative pendingBalance (same as H7)
                const currentPending = balanceData.pendingBalance || 0;
                let actualPayout = sellerPayout;
                if (currentPending < sellerPayout) {
                    logger.warn(`[completeMeetupTransaction] pendingBalance (${currentPending}) < sellerPayout (${sellerPayout}) for seller ${sellerId}`);
                    actualPayout = Math.min(sellerPayout, Math.max(0, currentPending));
                }
                const updatedTransactions = txns.map((txn) => {
                    if (txn.id === transactionId) {
                        return Object.assign(Object.assign({}, txn), { status: 'completed' });
                    }
                    return txn;
                });
                tx.update(sellerBalanceRef, {
                    pendingBalance: firebase_1.FieldValue.increment(-actualPayout),
                    availableBalance: firebase_1.FieldValue.increment(actualPayout),
                    totalEarnings: firebase_1.FieldValue.increment(actualPayout),
                    transactions: updatedTransactions,
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            else {
                // Seller balance doc doesn't exist yet (meetup has no webhook to create it).
                // Create it with the payout directly as available.
                tx.set(sellerBalanceRef, {
                    pendingBalance: 0,
                    availableBalance: sellerPayout,
                    totalEarnings: sellerPayout,
                    transactions: [{
                            id: transactionId,
                            type: 'sale',
                            amount: sellerPayout,
                            description: 'Vente meetup',
                            createdAt: new Date(),
                            status: 'completed',
                        }],
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            return { chatId: data.chatId, sellerId };
        });
        // Send system message (non-critical, outside transaction)
        if (transactionData.chatId) {
            let participants = [];
            try {
                const chatSnap = await firebase_1.db.collection('chats').doc(transactionData.chatId).get();
                if (chatSnap.exists) {
                    participants = ((_b = chatSnap.data()) === null || _b === void 0 ? void 0 : _b.participants) || [];
                }
            }
            catch (lookupErr) {
                console.warn('[completeMeetupTransaction] Could not load chat participants:', lookupErr);
            }
            await firebase_1.db.collection('messages').add({
                chatId: transactionData.chatId,
                senderId: 'system',
                receiverId: 'system',
                type: 'system',
                content: 'Rencontre confirmée ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
                participants,
                timestamp: firebase_1.FieldValue.serverTimestamp(),
                status: 'sent',
                isRead: true,
            });
        }
        console.log(`✅ Meetup transaction ${transactionId} completed. Seller ${transactionData.sellerId} credited.`);
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error completing meetup transaction:', error);
        throw new https_1.HttpsError('internal', `Failed to complete meetup: ${message}`);
    }
});
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
exports.cancelPendingTransaction = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    const callerUid = request.auth.uid;
    try {
        await firebase_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(txRef);
            if (!snap.exists) {
                throw new https_1.HttpsError('not-found', 'Transaction not found');
            }
            const data = snap.data();
            // H15: Allow both buyer and seller to cancel
            if (data.buyerId !== callerUid && data.sellerId !== callerUid) {
                throw new https_1.HttpsError('permission-denied', 'Only buyer or seller can cancel');
            }
            // H15: Added meetup_confirmed to cancellable statuses
            const cancellableStatuses = new Set([
                'pending',
                'pending_payment',
                'meetup_pending',
                'meetup_confirmed',
            ]);
            if (!cancellableStatuses.has(data.status)) {
                throw new https_1.HttpsError('failed-precondition', `Cannot cancel transaction in status ${data.status}`);
            }
            tx.update(txRef, {
                status: 'cancelled',
                cancelledAt: firebase_1.FieldValue.serverTimestamp(),
                cancelledBy: callerUid,
            });
            // Release the article so it can be purchased again.
            // createTransaction marks isSold=true atomically at creation
            // time; cancelling must undo that.
            // D2: Guard against deleted article — only update if it still exists
            if (data.articleId) {
                const articleRef = firebase_1.db.collection('articles').doc(data.articleId);
                const articleSnap = await tx.get(articleRef);
                if (articleSnap.exists) {
                    tx.update(articleRef, { isSold: false });
                }
            }
        });
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error cancelling transaction:', error);
        throw new https_1.HttpsError('internal', `Failed to cancel: ${message}`);
    }
});
//# sourceMappingURL=payments.js.map