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
exports.cancelPendingTransaction = exports.adminRefundTransaction = exports.completeMeetupTransaction = exports.checkTrackingStatus = exports.findPickupPoints = exports.getStripeAccountStatus = exports.addBankAccount = exports.createStripeConnectAccount = exports.createStripeCheckout = exports.createTransaction = exports.getServiceFee = exports.getShippingEstimate = void 0;
exports.resolveSellerOriginAddress = resolveSellerOriginAddress;
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
const rateLimit_1 = require("../utils/rateLimit");
const trackingTransition_1 = require("../utils/trackingTransition");
// Rate limiting: financial callables share a 1-minute sliding window.
// maxCallsUnauthenticated is 0 everywhere — these endpoints require auth.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
// =============================================================================
// HELPERS — Seller origin address resolution
// =============================================================================
const CA_POSTAL_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;
// The 13 Canadian province / territory codes (Stripe + Canada Post standard).
const CA_PROVINCE_CODES = new Set([
    'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);
/**
 * Validates a buyer shipping address server-side for a Canadian shipping label.
 *
 * Mirrors the strictness of the seller onboarding postal-code check
 * (createStripeConnectAccount): a label must carry a real, deliverable
 * destination or `createLabel` will fail AFTER the buyer has been charged.
 *
 * Returns the normalized fields on success, or throws HttpsError
 * 'invalid-argument' (the caller validates BEFORE locking the article /
 * capturing payment).
 *
 * NOTE: never trust the client `country` — we force CA and reject anything else.
 */
function validateBuyerShippingAddress(raw) {
    var _a, _b, _c, _d, _e;
    if (!raw || typeof raw !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'L\'adresse de livraison est requise');
    }
    const addr = raw;
    // Country must be Canada (default + only supported destination).
    const country = ((_a = addr.country) !== null && _a !== void 0 ? _a : 'CA').toString().trim().toUpperCase();
    if (country !== 'CA') {
        throw new https_1.HttpsError('invalid-argument', 'Seules les adresses de livraison canadiennes sont prises en charge');
    }
    const street = ((_b = addr.street) !== null && _b !== void 0 ? _b : '').toString().trim();
    if (street.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'La rue de livraison est requise');
    }
    const city = ((_c = addr.city) !== null && _c !== void 0 ? _c : '').toString().trim();
    if (city.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'La ville de livraison est requise');
    }
    const province = ((_d = addr.province) !== null && _d !== void 0 ? _d : '').toString().trim().toUpperCase();
    if (!CA_PROVINCE_CODES.has(province)) {
        throw new https_1.HttpsError('invalid-argument', 'La province de livraison est invalide (code a 2 lettres requis, ex: QC)');
    }
    const postalCode = ((_e = addr.postalCode) !== null && _e !== void 0 ? _e : '').toString().replace(/\s/g, '').toUpperCase();
    if (!CA_POSTAL_RE.test(postalCode)) {
        throw new https_1.HttpsError('invalid-argument', 'Le code postal de livraison est invalide (format A1A 1A1)');
    }
    return { street, city, province, postalCode };
}
/**
 * Resolves the seller's real shipping origin address from their profile,
 * with a last-resort fallback to the article's denormalized `location`.
 *
 * Resolution order:
 *   1. Seller `addresses[]` entry flagged `isDefault` (must have street + postal)
 *   2. First seller `addresses[]` entry with a street + postal code
 *   3. Article `location` (postal code only) — uses seller display name as
 *      shipper name and a minimal line1 so ShipEngine can still rate by postal.
 *
 * Returns `null` when no usable origin (i.e. no valid Canadian postal code)
 * can be found — the caller must then reject the transaction. There is NO
 * Montreal fallback: a label must ship from the seller's real address.
 */
function resolveSellerOriginAddress(sellerData, articleData) {
    const sellerName = sellerData.displayName || 'Vendeur';
    const sellerPhone = typeof sellerData.phoneNumber === 'string' && sellerData.phoneNumber.trim().length > 0
        ? sellerData.phoneNumber.trim()
        : undefined;
    const normalizePostal = (raw) => {
        const cleaned = (raw !== null && raw !== void 0 ? raw : '').toString().replace(/\s/g, '').toUpperCase();
        return CA_POSTAL_RE.test(cleaned) ? cleaned : null;
    };
    const addresses = Array.isArray(sellerData.addresses) ? sellerData.addresses : [];
    const candidate = addresses.find((a) => (a === null || a === void 0 ? void 0 : a.isDefault) && (a === null || a === void 0 ? void 0 : a.street) && (a === null || a === void 0 ? void 0 : a.postalCode)) ||
        addresses.find((a) => (a === null || a === void 0 ? void 0 : a.street) && (a === null || a === void 0 ? void 0 : a.postalCode)) ||
        null;
    if (candidate) {
        const postal = normalizePostal(candidate.postalCode);
        if (postal && typeof candidate.street === 'string' && candidate.street.trim().length > 0) {
            return {
                name: sellerName,
                addressLine1: candidate.street.trim(),
                cityLocality: (candidate.city || '').toString().trim() || 'Montreal',
                stateProvince: (candidate.province || 'QC').toString().trim(),
                postalCode: postal,
                countryCode: 'CA',
                phone: sellerPhone,
            };
        }
    }
    // Last resort: article.location postal code (denormalized). No street, so we
    // use the postal code + city to let ShipEngine rate by zone.
    const loc = articleData.location;
    if (loc && typeof loc === 'object') {
        const postal = normalizePostal(loc.postalCode);
        if (postal) {
            return {
                name: sellerName,
                addressLine1: (loc.city || '').toString().trim() || 'Adresse vendeur',
                cityLocality: (loc.city || '').toString().trim() || 'Montreal',
                stateProvince: (loc.province || 'QC').toString().trim(),
                postalCode: postal,
                countryCode: 'CA',
                phone: sellerPhone,
            };
        }
    }
    return null;
}
// =============================================================================
// GET SHIPPING ESTIMATES — Multi-carrier via ShipEngine
// =============================================================================
exports.getShippingEstimate = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY'] }, async (request) => {
    var _a, _b, _c, _d;
    const { fromAddress, toAddress, weight, dimensions } = request.data;
    if (!fromAddress || !toAddress) {
        throw new https_1.HttpsError('invalid-argument', 'From and to addresses are required');
    }
    const shipEngine = (0, shipEngine_1.getShipEngine)();
    if (!shipEngine) {
        throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
    }
    // Require BOTH endpoints to be usable Canadian addresses. NO silent Montreal
    // fallback (P2-f): a fabricated QC/Montreal origin or destination produces a
    // wrong estimate for any seller/buyer outside Montreal, which then diverges
    // from the authoritative server re-pricing in createTransaction. Reject
    // explicitly so the client surfaces a real "address required" error.
    const normalizePostal = (raw) => {
        const cleaned = (raw !== null && raw !== void 0 ? raw : '').toString().replace(/\s/g, '').toUpperCase();
        return CA_POSTAL_RE.test(cleaned) ? cleaned : null;
    };
    const fromStreet = ((_a = fromAddress.street) !== null && _a !== void 0 ? _a : '').toString().trim();
    const fromCity = ((_b = fromAddress.city) !== null && _b !== void 0 ? _b : '').toString().trim();
    const fromPostal = normalizePostal(fromAddress.postalCode);
    if (fromStreet.length === 0 || fromCity.length === 0 || !fromPostal) {
        throw new https_1.HttpsError('invalid-argument', 'L\'adresse d\'expedition (vendeur) est incomplete ou invalide. Une rue, une ville et un code postal canadien valides sont requis.');
    }
    const toCity = ((_c = toAddress.city) !== null && _c !== void 0 ? _c : '').toString().trim();
    const toPostal = normalizePostal(toAddress.postalCode);
    if (toCity.length === 0 || !toPostal) {
        throw new https_1.HttpsError('invalid-argument', 'L\'adresse de livraison (acheteur) est incomplete ou invalide. Une ville et un code postal canadien valides sont requis.');
    }
    try {
        const parcelWeight = parseFloat(weight) || 0.5;
        const parcelLength = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.length) || 30;
        const parcelWidth = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.width) || 25;
        const parcelHeight = parseFloat(dimensions === null || dimensions === void 0 ? void 0 : dimensions.height) || 10;
        logger.info('Getting ShipEngine multi-carrier rates', {
            from: fromPostal,
            to: toPostal,
            weight: parcelWeight,
        });
        // Rate shopping across Intelcom + Canada Post via ShipEngine
        const rates = await shipEngine.getRates({
            name: fromAddress.name || 'Vendeur',
            addressLine1: fromStreet,
            cityLocality: fromCity,
            stateProvince: (fromAddress.province || 'QC').toString().trim(),
            postalCode: fromPostal,
            countryCode: 'CA',
            phone: fromAddress.phone || undefined,
        }, {
            name: toAddress.name || 'Acheteur',
            addressLine1: ((_d = toAddress.street) !== null && _d !== void 0 ? _d : '').toString().trim() || toCity,
            cityLocality: toCity,
            stateProvince: (toAddress.province || 'QC').toString().trim(),
            postalCode: toPostal,
            countryCode: 'CA',
            phone: toAddress.phone || undefined,
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
            deliveryDays: `${rate.estimatedDeliveryDays} jour${rate.estimatedDeliveryDays > 1 ? 's' : ''} ouvrable${rate.estimatedDeliveryDays > 1 ? 's' : ''}`,
            amount: rate.shippingAmount.amount,
            currency: rate.shippingAmount.currency,
            deliveryType: rate.deliveryType,
        }));
        logger.info(`Retrieved ${formattedRates.length} shipping rates from ShipEngine`);
        return {
            success: true,
            rates: formattedRates,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error getting shipping estimate:', error);
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
exports.createTransaction = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY', 'SHIPENGINE_API_KEY'] }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { callerKey, isAuthenticated } = (0, rateLimit_1.resolveCallerKey)(request);
    await (0, rateLimit_1.checkRateLimit)(callerKey, isAuthenticated, {
        functionName: 'createTransaction',
        maxCallsAuthenticated: 20,
        maxCallsUnauthenticated: 0,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
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
    // Holds the strictly-validated buyer shipping address (shipping mode only).
    let validatedShippingAddress = null;
    if (deliveryType === 'shipping') {
        // NOTE: the client-supplied `shippingCost` is intentionally NOT trusted.
        // It is re-priced server-side below via ShipEngine. We only require the
        // address and a valid (non-fallback) ShipEngine rateId to re-tarify.
        //
        // Strict server-side address validation (P1-18): a Canadian shipping
        // label needs a deliverable destination (valid CA postal code, province
        // in the 13 codes, non-empty street/city, country=CA) or createLabel
        // would fail AFTER the buyer is charged. We reject BEFORE locking the
        // article / capturing payment.
        validatedShippingAddress = validateBuyerShippingAddress(shippingAddress);
        if (typeof shipEngineRateId !== 'string' || shipEngineRateId.length === 0) {
            throw new https_1.HttpsError('invalid-argument', 'shipEngineRateId is required for shipping. Veuillez rafraichir l\'estimation de livraison.');
        }
        if (shipEngineRateId.startsWith('fallback_')) {
            // A fallback rateId means ShipEngine was unreachable when the buyer
            // requested an estimate. We cannot purchase a real label from it, so
            // we refuse to create a paid order that could never ship.
            throw new https_1.HttpsError('failed-precondition', 'Le tarif de livraison n\'est pas disponible pour le moment. Veuillez rafraichir l\'estimation de livraison.');
        }
    }
    // --- Server-side shipping re-pricing (never trust client shippingCost) ----
    //
    // The buyer-supplied `shippingCost` / `shipEngineRateId` cannot be trusted:
    // a malicious or buggy client could send shippingCost=0.01 with a real
    // rateId, then the platform pays the true ~14$ label at the webhook.
    //
    // We re-quote the exact same origin (seller profile address) / destination
    // (buyer shipping address) / parcel server-side, locate the rate matching
    // the supplied rateId, and use ITS amount as the authoritative shipping
    // cost. If the rateId can no longer be found (expired / tampered), we
    // reject and force the client to re-fetch a fresh estimate.
    //
    // This network call is done OUTSIDE runTransaction (no I/O inside a
    // Firestore transaction). The amount/availability invariants are still
    // re-checked atomically below.
    const articleRef = firebase_1.db.collection('articles').doc(articleId);
    let serverShippingCost = 0;
    if (deliveryType === 'shipping') {
        const shipEngine = (0, shipEngine_1.getShipEngine)();
        if (!shipEngine) {
            throw new https_1.HttpsError('failed-precondition', 'ShipEngine API not configured');
        }
        // Read article (parcel + seller) and seller (origin address) for re-pricing.
        const articlePreSnap = await articleRef.get();
        if (!articlePreSnap.exists) {
            throw new https_1.HttpsError('not-found', 'Cet article n\'existe plus');
        }
        const articlePreData = articlePreSnap.data();
        const sellerPreSnap = await firebase_1.db.collection('users').doc(articlePreData.sellerId).get();
        if (!sellerPreSnap.exists) {
            throw new https_1.HttpsError('not-found', 'Vendeur introuvable');
        }
        const sellerPreData = sellerPreSnap.data();
        // Resolve the seller's origin address from their profile — NO Montreal
        // fallback. A real label must ship from the seller's real address.
        const origin = resolveSellerOriginAddress(sellerPreData, articlePreData);
        if (!origin) {
            throw new https_1.HttpsError('failed-precondition', 'Le vendeur n\'a pas renseigne d\'adresse d\'expedition valide. La commande ne peut pas etre creee.');
        }
        // Destination = buyer shipping address. Already strictly validated above
        // (validatedShippingAddress is guaranteed non-null in shipping mode).
        const validatedAddr = validatedShippingAddress;
        const destination = {
            name: shippingAddress.name || 'Acheteur',
            addressLine1: validatedAddr.street,
            cityLocality: validatedAddr.city,
            stateProvince: validatedAddr.province,
            postalCode: validatedAddr.postalCode,
            countryCode: 'CA',
            phone: shippingAddress.phone || origin.phone,
        };
        // Parcel from article metadata (same defaults as getShippingEstimate).
        const parcelWeight = parseFloat(articlePreData.weight) || 0.5;
        const dims = articlePreData.dimensions || {};
        const parcel = {
            weight: { value: parcelWeight, unit: 'kilogram' },
            dimensions: {
                length: parseFloat(dims.length) || 30,
                width: parseFloat(dims.width) || 25,
                height: parseFloat(dims.height) || 10,
                unit: 'centimeter',
            },
        };
        let rates;
        try {
            rates = await shipEngine.getRates(origin, destination, parcel);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logger.error('createTransaction: ShipEngine re-pricing failed', {
                articleId, shipEngineRateId, message,
            });
            throw new https_1.HttpsError('unavailable', 'Impossible de verifier le tarif de livraison pour le moment. Veuillez reessayer.');
        }
        const matchedRate = rates.find((r) => r.rateId === shipEngineRateId);
        if (!matchedRate) {
            // rateId expired or never belonged to this origin/destination/parcel.
            logger.warn('createTransaction: supplied rateId not found in fresh rates', {
                articleId, shipEngineRateId, ratesReturned: rates.length,
            });
            throw new https_1.HttpsError('failed-precondition', 'Le tarif de livraison selectionne a expire. Veuillez rafraichir l\'estimation de livraison.');
        }
        serverShippingCost = matchedRate.shippingAmount.amount;
        logger.info('createTransaction: shipping re-priced server-side', {
            articleId,
            shipEngineRateId,
            clientShippingCost: shippingCost,
            serverShippingCost,
            carrier: matchedRate.carrierCode,
        });
    }
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
            // For shipping transactions, verify seller has active Stripe Connect
            // before locking the article. This prevents articles from being marked
            // sold for a seller who can't receive payment.
            //
            // Sellers must complete full onboarding via createStripeConnectAccount
            // before their articles can be purchased for shipping. No on-the-fly
            // account creation — Custom accounts require identity + bank info.
            if (deliveryType === 'shipping') {
                const sellerRef = firebase_1.db.collection('users').doc(articleData.sellerId);
                const sellerSnap = await tx.get(sellerRef);
                if (!sellerSnap.exists) {
                    throw new https_1.HttpsError('not-found', 'Vendeur introuvable');
                }
                const sellerData = sellerSnap.data();
                if (!sellerData.stripeAccountId) {
                    throw new https_1.HttpsError('failed-precondition', 'Le vendeur n\'a pas encore configure son compte de paiement. Il doit completer son inscription vendeur.');
                }
                if (sellerData.stripeChargesEnabled !== true) {
                    throw new https_1.HttpsError('failed-precondition', 'Le compte de paiement du vendeur n\'est pas encore actif. Veuillez reessayer plus tard.');
                }
            }
            // Mark article as sold
            tx.update(articleRef, { isSold: true });
            // Build transaction data — server-side fee calculation (never trust client)
            // Meetup transactions have NO platform fee (aligned with frontend
            // messaging "Aucun frais de plateforme") and no shipping cost.
            const fee = deliveryType === 'meetup' ? 0 : (0, fees_1.calculateServiceFee)(amount);
            // Shipping cost is the SERVER re-priced value, never the client input.
            const shipping = deliveryType === 'shipping' ? serverShippingCost : 0;
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
        logger.info('Transaction created', {
            transactionId, articleId, deliveryType, buyerId,
        });
        return { success: true, transactionId };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error creating transaction:', error);
        throw new https_1.HttpsError('internal', `Failed to create transaction: ${message}`);
    }
});
// =============================================================================
// CREATE STRIPE CHECKOUT — Initialize Stripe PaymentIntent (destination charge)
// =============================================================================
/**
 * Creates a Stripe PaymentIntent for the transaction.
 *
 * Two modes:
 * 1. **No wallet** (walletAmount === 0 or absent): Standard destination charge
 *    to seller's Connect account with application_fee_amount.
 * 2. **Mixed wallet+card** (0 < walletAmount < totalCharge): Platform receives
 *    the card portion (no transfer_data). Wallet portion is debited from buyer's
 *    wallet atomically. Seller is credited after delivery.
 *
 * Returns the PaymentIntent clientSecret for the client to confirm payment.
 *
 * Idempotent: if a PaymentIntent already exists for this transaction,
 * returns the existing clientSecret without creating a new one.
 */
exports.createStripeCheckout = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { callerKey, isAuthenticated } = (0, rateLimit_1.resolveCallerKey)(request);
    await (0, rateLimit_1.checkRateLimit)(callerKey, isAuthenticated, {
        functionName: 'createStripeCheckout',
        maxCallsAuthenticated: 10,
        maxCallsUnauthenticated: 0,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const { transactionId, walletAmount: rawWalletAmount } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (!transactionId || typeof transactionId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    // walletAmount is optional, in cents, must be a non-negative integer
    const walletAmount = typeof rawWalletAmount === 'number' && Number.isInteger(rawWalletAmount) && rawWalletAmount > 0
        ? rawWalletAmount
        : 0;
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
            // Idempotent: if a PaymentIntent already exists, retrieve clientSecret from Stripe
            // (never store client_secret in Firestore — it's a sensitive credential)
            if (transaction.stripePaymentIntentId) {
                const existingFees = (0, fees_1.calculateFees)(transaction.amount, transaction.shippingCost || 0);
                return {
                    existingCheckout: true,
                    fees: existingFees,
                    existingPaymentIntentId: transaction.stripePaymentIntentId,
                    sellerId: transaction.sellerId,
                    walletDebited: false,
                };
            }
            // Always recalculate fees server-side for correctness
            const calculatedFees = (0, fees_1.calculateFees)(transaction.amount, transaction.shippingCost || 0);
            // --- Wallet debit (if applicable) ---
            let walletDebited = false;
            const totalChargeCents = Math.round(calculatedFees.buyerTotal * 100);
            if (walletAmount > 0) {
                if (walletAmount >= totalChargeCents) {
                    throw new https_1.HttpsError('invalid-argument', 'walletAmount must be less than totalCharge for mixed payment. Use payWithWallet for 100% wallet payments.');
                }
                // Verify buyer has wallet with sufficient balance
                const buyerWalletRef = firebase_1.db.collection('wallets').doc(request.auth.uid);
                const buyerWalletSnap = await tx.get(buyerWalletRef);
                if (!buyerWalletSnap.exists) {
                    throw new https_1.HttpsError('failed-precondition', 'Aucun porte-monnaie trouve');
                }
                const buyerWallet = buyerWalletSnap.data();
                if (buyerWallet.status !== 'active') {
                    throw new https_1.HttpsError('failed-precondition', 'Le porte-monnaie n\'est pas actif');
                }
                if (buyerWallet.balance < walletAmount) {
                    throw new https_1.HttpsError('failed-precondition', 'Solde insuffisant dans le porte-monnaie');
                }
                // Debit buyer wallet
                const newBalance = buyerWallet.balance - walletAmount;
                tx.update(buyerWalletRef, {
                    balance: firebase_1.FieldValue.increment(-walletAmount),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
                // Create buyer ledger entry
                const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
                tx.set(buyerLedgerRef, {
                    type: 'purchase_debit',
                    amount: walletAmount,
                    balanceAfter: newBalance,
                    description: 'Paiement partiel (porte-monnaie)',
                    transactionId,
                    createdAt: firebase_1.FieldValue.serverTimestamp(),
                });
                walletDebited = true;
            }
            // Update fee fields atomically + wallet info
            const updateData = {
                serviceFee: calculatedFees.serviceFee,
                serviceFeePercent: calculatedFees.serviceFeePercent,
                totalAmount: calculatedFees.buyerTotal,
                sellerPayout: calculatedFees.sellerPayout,
            };
            if (walletDebited) {
                updateData.walletAmountUsed = walletAmount;
                updateData.paidVia = 'wallet_and_card';
            }
            tx.update(txRef, updateData);
            return {
                existingCheckout: false,
                fees: calculatedFees,
                existingPaymentIntentId: null,
                sellerId: transaction.sellerId,
                walletDebited,
            };
        });
        // Idempotent return: PaymentIntent already existed — retrieve clientSecret from Stripe
        if (txResult.existingCheckout) {
            const existingPI = await stripe.paymentIntents.retrieve(txResult.existingPaymentIntentId);
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
        const totalChargeCents = Math.round(txResult.fees.buyerTotal * 100);
        const applicationFeeInCents = Math.round(txResult.fees.serviceFee * 100);
        if (txResult.walletDebited && walletAmount > 0) {
            // --- MIXED WALLET + CARD PAYMENT ---
            // Platform receives the card portion (no destination charge).
            // The wallet portion was already debited. Seller will be credited
            // after delivery via explicit transfer.
            const stripeChargeCents = totalChargeCents - walletAmount;
            // The application fee applies to the full purchase, but since the
            // wallet portion was already collected, the Stripe portion just needs
            // to cover the remaining charge. The platform fee is effectively
            // collected from the combined wallet+card amount.
            // We do NOT set application_fee_amount here because the platform
            // receives the entire card payment (no transfer_data), so the fee
            // is implicitly captured.
            let paymentIntent;
            try {
                paymentIntent = await stripe.paymentIntents.create({
                    amount: stripeChargeCents,
                    currency: 'cad',
                    metadata: {
                        transactionId,
                        sellerId: txResult.sellerId,
                        buyerId: request.auth.uid,
                        walletAmountUsed: String(walletAmount),
                        paymentType: 'wallet_and_card',
                    },
                }, 
                // Deterministic key so a retry (same transaction) never creates a
                // second PaymentIntent — Stripe returns the original PI instead.
                { idempotencyKey: `pi_${transactionId}` });
            }
            catch (stripeError) {
                // F05: Stripe PI creation failed — revert the wallet debit
                logger.error('Stripe PaymentIntent creation failed (mixed) — reverting wallet debit', {
                    transactionId,
                    walletAmount,
                    error: stripeError instanceof Error ? stripeError.message : stripeError,
                });
                const buyerWalletRef = firebase_1.db.collection('wallets').doc(request.auth.uid);
                await firebase_1.db.runTransaction(async (revertTx) => {
                    const walletSnap = await revertTx.get(buyerWalletRef);
                    if (!walletSnap.exists)
                        return;
                    const walletData = walletSnap.data();
                    revertTx.update(buyerWalletRef, {
                        balance: firebase_1.FieldValue.increment(walletAmount),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    const revertLedgerRef = buyerWalletRef.collection('ledger').doc();
                    revertTx.set(revertLedgerRef, {
                        type: 'refund_credit',
                        amount: walletAmount,
                        balanceAfter: (walletData.balance || 0) + walletAmount,
                        description: 'Remboursement — echec creation paiement',
                        transactionId,
                        createdAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                });
                // Also revert the paidVia/walletAmountUsed fields on the transaction
                await txRef.update({
                    walletAmountUsed: firebase_1.FieldValue.delete(),
                    paidVia: firebase_1.FieldValue.delete(),
                });
                throw stripeError;
            }
            // Store PaymentIntent ID in the transaction doc
            await txRef.update({
                stripePaymentIntentId: paymentIntent.id,
                stripeCheckoutCreatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            logger.info('Stripe PaymentIntent created (mixed wallet+card)', {
                transactionId,
                paymentIntentId: paymentIntent.id,
                totalCents: totalChargeCents,
                walletCents: walletAmount,
                stripeCents: stripeChargeCents,
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
                    walletAmountUsed: walletAmount,
                    stripeAmount: stripeChargeCents,
                },
            };
        }
        else {
            // --- STANDARD DESTINATION CHARGE (no wallet) ---
            const amountInCents = totalChargeCents;
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
            }, 
            // Deterministic key so a retry (same transaction) never creates a
            // second PaymentIntent — Stripe returns the original PI instead.
            { idempotencyKey: `pi_${transactionId}` });
            // Store PaymentIntent ID in the transaction doc (never store client_secret)
            await txRef.update({
                stripePaymentIntentId: paymentIntent.id,
                stripeCheckoutCreatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
            logger.info('Stripe PaymentIntent created (destination charge)', {
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
// CREATE STRIPE CONNECT ACCOUNT — Custom account, full in-app onboarding
// =============================================================================
/**
 * Creates a Stripe Connect Custom account for the authenticated seller with
 * ALL required information submitted in a single call so that
 * `charges_enabled` becomes `true` immediately (or very shortly after).
 *
 * The client collects:
 *   - Personal info: firstName, lastName, dob (day/month/year)
 *   - Address: line1, city, province, postalCode
 *   - Banking: transitNumber (5 digits), institutionNumber (3 digits),
 *     accountNumber (7-12 digits)
 *   - ToS acceptance IP (caller's public IP address)
 *
 * No Stripe hosted UI, no Account Links, no redirects.
 *
 * Idempotent: if the seller already has a stripeAccountId, returns it
 * along with current charges_enabled / requirements status.
 */
exports.createStripeConnectAccount = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { callerKey, isAuthenticated } = (0, rateLimit_1.resolveCallerKey)(request);
    await (0, rateLimit_1.checkRateLimit)(callerKey, isAuthenticated, {
        functionName: 'createStripeConnectAccount',
        maxCallsAuthenticated: 3,
        maxCallsUnauthenticated: 0,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    const userId = request.auth.uid;
    const data = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    // ── Input validation ────────────────────────────────────────────────────
    // Personal info
    if (typeof data.firstName !== 'string' || data.firstName.trim().length < 1) {
        throw new https_1.HttpsError('invalid-argument', 'Le prenom est requis');
    }
    if (typeof data.lastName !== 'string' || data.lastName.trim().length < 1) {
        throw new https_1.HttpsError('invalid-argument', 'Le nom est requis');
    }
    // Date of birth
    if (!data.dob || typeof data.dob !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'La date de naissance est requise');
    }
    const dobDay = Number(data.dob.day);
    const dobMonth = Number(data.dob.month);
    const dobYear = Number(data.dob.year);
    if (!Number.isInteger(dobDay) || dobDay < 1 || dobDay > 31) {
        throw new https_1.HttpsError('invalid-argument', 'Jour de naissance invalide (1-31)');
    }
    if (!Number.isInteger(dobMonth) || dobMonth < 1 || dobMonth > 12) {
        throw new https_1.HttpsError('invalid-argument', 'Mois de naissance invalide (1-12)');
    }
    if (!Number.isInteger(dobYear) || dobYear < 1900 || dobYear > new Date().getFullYear() - 13) {
        throw new https_1.HttpsError('invalid-argument', 'Annee de naissance invalide (minimum 13 ans)');
    }
    // Address
    if (!data.address || typeof data.address !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'L\'adresse est requise');
    }
    if (typeof data.address.line1 !== 'string' || data.address.line1.trim().length < 1) {
        throw new https_1.HttpsError('invalid-argument', 'L\'adresse (ligne 1) est requise');
    }
    if (typeof data.address.city !== 'string' || data.address.city.trim().length < 1) {
        throw new https_1.HttpsError('invalid-argument', 'La ville est requise');
    }
    if (typeof data.address.province !== 'string' || data.address.province.trim().length < 1) {
        throw new https_1.HttpsError('invalid-argument', 'La province est requise');
    }
    // Canadian postal code: A1A 1A1 or A1A1A1
    const postalCodeClean = (data.address.postalCode || '').toString().replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postalCodeClean)) {
        throw new https_1.HttpsError('invalid-argument', 'Le code postal canadien est invalide (format A1A 1A1)');
    }
    // Bank account
    const transitNumber = String(data.transitNumber || '').trim();
    const institutionNumber = String(data.institutionNumber || '').trim();
    const accountNumber = String(data.accountNumber || '').trim();
    if (!/^\d{5}$/.test(transitNumber)) {
        throw new https_1.HttpsError('invalid-argument', 'Le numero de transit doit contenir exactement 5 chiffres');
    }
    if (!/^\d{3}$/.test(institutionNumber)) {
        throw new https_1.HttpsError('invalid-argument', 'Le numero d\'institution doit contenir exactement 3 chiffres');
    }
    if (!/^\d{7,12}$/.test(accountNumber)) {
        throw new https_1.HttpsError('invalid-argument', 'Le numero de compte doit contenir entre 7 et 12 chiffres');
    }
    // ToS acceptance IP — extracted from request context (more secure than client-provided)
    const callerIp = ((_b = request.rawRequest) === null || _b === void 0 ? void 0 : _b.ip)
        || ((_f = (_e = (_d = (_c = request.rawRequest) === null || _c === void 0 ? void 0 : _c.headers) === null || _d === void 0 ? void 0 : _d['x-forwarded-for']) === null || _e === void 0 ? void 0 : _e.split(',')[0]) === null || _f === void 0 ? void 0 : _f.trim())
        || data.ip
        || '0.0.0.0';
    // ── Fetch user doc ──────────────────────────────────────────────────────
    try {
        const userRef = firebase_1.db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new https_1.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
        // Idempotent: if account already exists, retrieve current status and return
        if (userData.stripeAccountId) {
            const existingAccount = await stripe.accounts.retrieve(userData.stripeAccountId);
            // Sync latest status to Firestore
            const status = existingAccount.charges_enabled && existingAccount.payouts_enabled
                ? 'active'
                : existingAccount.details_submitted ? 'pending_verification' : 'pending';
            await userRef.update({
                stripeAccountStatus: status,
                stripeChargesEnabled: existingAccount.charges_enabled,
                stripePayoutsEnabled: existingAccount.payouts_enabled,
                stripeDetailsSubmitted: existingAccount.details_submitted,
            });
            logger.info('Stripe Custom account already exists — returning status', {
                userId,
                stripeAccountId: userData.stripeAccountId,
                chargesEnabled: existingAccount.charges_enabled,
            });
            return {
                success: true,
                stripeAccountId: userData.stripeAccountId,
                chargesEnabled: existingAccount.charges_enabled,
                payoutsEnabled: existingAccount.payouts_enabled,
                detailsSubmitted: existingAccount.details_submitted,
                requirements: ((_g = existingAccount.requirements) === null || _g === void 0 ? void 0 : _g.currently_due) || [],
                status,
            };
        }
        // ── Create the full Custom account ──────────────────────────────────
        const email = userData.email || request.auth.token.email || '';
        // Canadian routing_number = transit (5) + institution (3) = 8 digits
        const routingNumber = `${transitNumber}${institutionNumber}`;
        const account = await stripe.accounts.create({
            type: 'custom',
            country: 'CA',
            email,
            business_type: 'individual',
            individual: {
                first_name: data.firstName.trim(),
                last_name: data.lastName.trim(),
                dob: {
                    day: dobDay,
                    month: dobMonth,
                    year: dobYear,
                },
                address: {
                    line1: data.address.line1.trim(),
                    line2: data.address.line2 ? String(data.address.line2).trim() : undefined,
                    city: data.address.city.trim(),
                    state: data.address.province.trim(),
                    postal_code: postalCodeClean,
                    country: 'CA',
                },
            },
            tos_acceptance: {
                date: Math.floor(Date.now() / 1000),
                ip: callerIp,
            },
            external_account: {
                object: 'bank_account',
                country: 'CA',
                currency: 'cad',
                routing_number: routingNumber,
                account_number: accountNumber,
            },
            capabilities: {
                card_payments: { requested: true },
                transfers: { requested: true },
            },
            business_profile: {
                product_description: 'Vente de vetements et accessoires de seconde main',
            },
            settings: {
                payouts: {
                    schedule: {
                        interval: 'manual',
                    },
                },
            },
            metadata: {
                firebaseUserId: userId,
            },
        });
        // Determine status from the freshly created account
        const chargesEnabled = account.charges_enabled === true;
        const payoutsEnabled = account.payouts_enabled === true;
        const detailsSubmitted = account.details_submitted === true;
        const pendingRequirements = ((_h = account.requirements) === null || _h === void 0 ? void 0 : _h.currently_due) || [];
        let status;
        if (chargesEnabled && payoutsEnabled) {
            status = 'active';
        }
        else if (detailsSubmitted) {
            status = 'pending_verification';
        }
        else {
            status = 'pending';
        }
        // Store everything in the user document
        await userRef.update({
            stripeAccountId: account.id,
            stripeAccountStatus: status,
            stripeChargesEnabled: chargesEnabled,
            stripePayoutsEnabled: payoutsEnabled,
            stripeDetailsSubmitted: detailsSubmitted,
            stripeBankAccountAdded: true,
            stripeBankAccountLast4: accountNumber.slice(-4),
            stripeAccountCreatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
        logger.info('Stripe Custom account created with full onboarding', {
            userId,
            stripeAccountId: account.id,
            chargesEnabled,
            payoutsEnabled,
            detailsSubmitted,
            pendingRequirements,
            status,
        });
        return {
            success: true,
            stripeAccountId: account.id,
            chargesEnabled,
            payoutsEnabled,
            detailsSubmitted,
            requirements: pendingRequirements,
            status,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Log full Stripe error details (type, code, statusCode, param) for debugging
        const stripeDetails = { userId, error: message };
        if (error && typeof error === 'object') {
            const e = error;
            if (e.type)
                stripeDetails.stripeErrorType = e.type;
            if (e.code)
                stripeDetails.stripeErrorCode = e.code;
            if (e.statusCode)
                stripeDetails.stripeStatusCode = e.statusCode;
            if (e.param)
                stripeDetails.stripeParam = e.param;
            if (e.raw)
                stripeDetails.stripeRaw = JSON.stringify(e.raw).substring(0, 500);
        }
        logger.error('Error creating Stripe Custom account', stripeDetails);
        throw new https_1.HttpsError('internal', `Failed to create Connect account: ${message}`);
    }
});
// =============================================================================
// ADD BANK ACCOUNT — Attach Canadian bank account to seller's Custom account
// =============================================================================
/**
 * Updates / replaces the bank account on the seller's Stripe Connect Custom
 * account. The primary bank account is now set during account creation
 * (createStripeConnectAccount), but sellers may need to change their
 * bank account later.
 *
 * The seller provides transit number (5 digits), institution
 * number (3 digits), and account number directly in the app UI.
 *
 * Canadian routing_number format for Stripe:
 * transit (5 digits) + institution (3 digits) = 8 digits total
 *
 * Payout schedule is always set to manual (platform-controlled).
 */
exports.addBankAccount = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const stripe = (0, stripe_1.getStripe)();
    if (!stripe) {
        throw new https_1.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    const userId = request.auth.uid;
    const { transitNumber, institutionNumber, accountNumber, accountHolderName } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    // ── Input validation ──
    if (typeof transitNumber !== 'string' || !/^\d{5}$/.test(transitNumber)) {
        throw new https_1.HttpsError('invalid-argument', 'Le numero de transit doit contenir exactement 5 chiffres');
    }
    if (typeof institutionNumber !== 'string' || !/^\d{3}$/.test(institutionNumber)) {
        throw new https_1.HttpsError('invalid-argument', 'Le numero d\'institution doit contenir exactement 3 chiffres');
    }
    if (typeof accountNumber !== 'string' || !/^\d{7,12}$/.test(accountNumber)) {
        throw new https_1.HttpsError('invalid-argument', 'Le numero de compte doit contenir entre 7 et 12 chiffres');
    }
    try {
        const userRef = firebase_1.db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new https_1.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
        const stripeAccountId = userData.stripeAccountId;
        if (!stripeAccountId) {
            throw new https_1.HttpsError('failed-precondition', 'Aucun compte de paiement trouve. Publiez un article d\'abord.');
        }
        // Canadian routing_number = transit (5) + institution (3) = 8 digits
        const routingNumber = `${transitNumber}${institutionNumber}`;
        // Create external bank account on the Custom connected account
        await stripe.accounts.createExternalAccount(stripeAccountId, {
            external_account: Object.assign({ object: 'bank_account', country: 'CA', currency: 'cad', routing_number: routingNumber, account_number: accountNumber }, (accountHolderName && typeof accountHolderName === 'string'
                ? { account_holder_name: accountHolderName.trim().substring(0, 200) }
                : {})),
        });
        // Configure manual payouts — the platform controls disbursement
        // via the requestWithdrawal callable (Stripe Payouts API)
        await stripe.accounts.update(stripeAccountId, {
            settings: {
                payouts: {
                    schedule: {
                        interval: 'manual',
                    },
                },
            },
        });
        // Update user document with bank account status
        await userRef.update({
            stripeBankAccountAdded: true,
            stripeBankAccountLast4: accountNumber.slice(-4),
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
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error adding bank account', { userId, error: message });
        throw new https_1.HttpsError('internal', `Echec de l'ajout du compte bancaire: ${message}`);
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
        logger.error('Error finding pickup points:', error);
        throw new https_1.HttpsError('internal', `Failed to find pickup points: ${message}`);
    }
});
// =============================================================================
// CHECK TRACKING STATUS — Via ShipEngine
// =============================================================================
exports.checkTrackingStatus = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'] }, async (request) => {
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
        // Explicit status guard (P1-21): a DELIVERED scan must only move funds when
        // the transaction is in a deliverable state. A DELIVERED scan arriving on a
        // refunded / disputed / cancelled / already-delivered / meetup_* transaction
        // would otherwise drive pendingBalance negative or double-credit the seller.
        // applyTrackingOutcome re-checks this invariant atomically inside its own
        // runTransaction; this early note keeps the intent explicit for readers.
        if (trackingStatus === 'DELIVERED' && !trackingTransition_1.DELIVERABLE_STATUSES.has(transaction.status)) {
            logger.warn('[checkTrackingStatus] DELIVERED scan ignored — non-deliverable status', {
                transactionId,
                currentStatus: transaction.status,
            });
            return {
                success: true,
                trackingStatus,
                trackingHistory: tracking.events || [],
            };
        }
        // Apply the tracking outcome via the shared state-machine helper:
        //  - DELIVERED -> pendingBalance -> heldBalance + fundsReleaseAt (+7d)
        //  - FAILURE   -> delivery_failed, funds frozen, both parties notified
        //  - TRANSIT   -> label_created becomes 'shipped' (first carrier scan)
        //  - else      -> trackingStatus refresh only
        await (0, trackingTransition_1.applyTrackingOutcome)(transactionId, trackingStatus, 'manual');
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
        logger.error('Error checking tracking status:', error);
        throw new https_1.HttpsError('internal', `Failed to check tracking: ${message}`);
    }
});
// =============================================================================
// COMPLETE MEETUP TRANSACTION — Buyer confirms receipt, credits seller
// =============================================================================
/**
 * Buyer confirms the meetup exchange was completed. This transitions the
 * transaction from `meetup_confirmed` → `meetup_completed`, sets
 * `meetupCompletedAt`, and thereby unlocks review eligibility.
 *
 * Meetup is a pure cash-in-hand exchange: NO money flows through the platform,
 * so this NEVER credits the seller wallet and writes NO ledger entry.
 *
 * Only the buyer can call this (the buyer confirms receipt).
 */
exports.completeMeetupTransaction = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { callerKey, isAuthenticated } = (0, rateLimit_1.resolveCallerKey)(request);
    await (0, rateLimit_1.checkRateLimit)(callerKey, isAuthenticated, {
        functionName: 'completeMeetupTransaction',
        maxCallsAuthenticated: 20,
        maxCallsUnauthenticated: 0,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
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
            // Meetup = paiement cash hors-ligne pur. AUCUN argent n'a transité par
            // la plateforme, donc on NE crédite JAMAIS le wallet vendeur
            // (balance / pendingBalance) et on n'écrit AUCUN ledger de vente.
            // Le runTransaction se limite à : passer le statut à meetup_completed,
            // poser meetupCompletedAt, et débloquer l'éligibilité à l'avis (review),
            // qui est dérivée du statut terminal + meetupCompletedAt dans reviews.ts.
            tx.update(txRef, {
                status: 'meetup_completed',
                completedAt: firebase_1.FieldValue.serverTimestamp(),
                meetupCompletedAt: firebase_1.FieldValue.serverTimestamp(),
            });
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
                logger.warn('[completeMeetupTransaction] Could not load chat participants:', lookupErr);
            }
            await firebase_1.db.collection('messages').add({
                chatId: transactionData.chatId,
                senderId: 'system',
                receiverId: 'system',
                type: 'system',
                content: 'Rencontre confirmée ! La transaction est terminée. Le paiement a été réglé en main propre entre l\'acheteur et le vendeur.',
                participants,
                timestamp: firebase_1.FieldValue.serverTimestamp(),
                status: 'sent',
                isRead: true,
            });
        }
        logger.info('Meetup transaction completed', { transactionId, sellerId: transactionData.sellerId });
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error completing meetup transaction:', error);
        throw new https_1.HttpsError('internal', `Failed to complete meetup: ${message}`);
    }
});
// =============================================================================
// ADMIN REFUND TRANSACTION — Resolve disputes / lost / failed deliveries
// =============================================================================
/**
 * Admin-only refund for a card/destination-charge or mixed transaction
 * (the wallet-only path is handled by refundWalletPayment). Used to resolve
 * `delivery_failed`, `lost`, `disputed`, `delivered` (within the dispute
 * window) and any still-paid order where the buyer must be reimbursed.
 *
 * Flow:
 *   1. Stripe refund OUTSIDE the runTransaction, with a deterministic
 *      idempotency key (`rf_admin_<txId>`) so re-invocations never double-refund.
 *      For destination charges we pass reverse_transfer + refund_application_fee
 *      to claw the money back from the connected account; for direct platform
 *      (mixed wallet+card) charges those are omitted.
 *   2. Atomic Firestore reconciliation: re-credit any wallet portion to the
 *      buyer, debit the seller EXACTLY what was credited
 *      (pendingBalance -> heldBalance -> balance, shortfall -> sellerDebt),
 *      release the article, mark the transaction 'refunded'.
 *
 * Return-label cost policy: when the refund is the result of a dispute ruled
 * against the seller (`chargeReturnToSeller: true`), the return label cost
 * (if a return label was created) is also debited from the seller; by default
 * the buyer bears the return cost. The label itself is created via the
 * createReturnLabel ShipEngine method when requested.
 */
exports.adminRefundTransaction = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // Admin guard: custom claim OR users/{uid}.isAdmin fallback.
    let isAdmin = request.auth.token.admin === true;
    if (!isAdmin) {
        const adminSnap = await firebase_1.db.collection('users').doc(request.auth.uid).get();
        isAdmin = adminSnap.exists && ((_a = adminSnap.data()) === null || _a === void 0 ? void 0 : _a.isAdmin) === true;
    }
    if (!isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Admin privileges required');
    }
    const { transactionId, reason } = (_b = request.data) !== null && _b !== void 0 ? _b : {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const stripe = (0, stripe_1.getStripe)();
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    // Pre-read for the Stripe call (outside the transaction).
    const preSnap = await txRef.get();
    if (!preSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Transaction not found');
    }
    const preData = preSnap.data();
    // Idempotence: already refunded.
    if (preData.status === 'refunded') {
        return { success: true, alreadyRefunded: true };
    }
    // Only refundable post-payment statuses.
    const refundableStatuses = new Set([
        'paid',
        'label_created',
        'shipped',
        'delivered',
        'delivery_failed',
        'lost',
        'disputed',
    ]);
    if (!refundableStatuses.has(preData.status)) {
        throw new https_1.HttpsError('failed-precondition', `Cannot refund transaction in status ${preData.status}`);
    }
    const paidVia = preData.paidVia;
    const isMixedCharge = paidVia === 'wallet_and_card' || paidVia === 'mixed';
    // --- Stripe refund (card portion) OUTSIDE the Firestore transaction ---
    if (preData.stripePaymentIntentId && stripe) {
        try {
            await stripe.refunds.create(Object.assign({ payment_intent: preData.stripePaymentIntentId }, (isMixedCharge
                ? {}
                : { reverse_transfer: true, refund_application_fee: true })), { idempotencyKey: `rf_admin_${transactionId}` });
            logger.info('[adminRefundTransaction] Stripe refund created', {
                transactionId,
                paymentIntentId: preData.stripePaymentIntentId,
                reverseTransfer: !isMixedCharge,
            });
        }
        catch (refundErr) {
            logger.error('CRITICAL [adminRefundTransaction] Stripe refund failed', {
                transactionId,
                paymentIntentId: preData.stripePaymentIntentId,
                error: refundErr instanceof Error ? refundErr.message : refundErr,
            });
            // Dead-letter for the retry chantier; never throw silently.
            await firebase_1.db
                .collection('failed_operations')
                .add({
                type: 'admin_refund_failed',
                transactionId,
                paymentIntentId: preData.stripePaymentIntentId,
                reason: refundErr instanceof Error ? refundErr.message : 'stripe_refund_error',
                createdAt: firebase_1.FieldValue.serverTimestamp(),
                status: 'pending',
            })
                .catch(() => undefined);
            throw new https_1.HttpsError('internal', 'Stripe refund failed — operation recorded for retry, transaction not modified');
        }
    }
    // --- Atomic Firestore reconciliation ---
    try {
        await firebase_1.db.runTransaction(async (tx) => {
            const snap = await tx.get(txRef);
            if (!snap.exists)
                throw new https_1.HttpsError('not-found', 'Transaction not found');
            const data = snap.data();
            // Idempotence inside the transaction.
            if (data.status === 'refunded')
                return;
            const buyerId = data.buyerId;
            const sellerId = data.sellerId;
            const walletAmountUsed = data.walletAmountUsed || 0; // cents
            const hasWalletPortion = walletAmountUsed > 0 &&
                (paidVia === 'wallet' || paidVia === 'wallet_and_card' || paidVia === 'mixed');
            // Debit the EXACT amount credited to the seller (0 if never credited).
            const sellerDebitTarget = typeof data.sellerCreditedCents === 'number' ? data.sellerCreditedCents : 0;
            // Reads first.
            const buyerWalletRef = hasWalletPortion && buyerId ? firebase_1.db.collection('wallets').doc(buyerId) : null;
            const buyerWalletSnap = buyerWalletRef ? await tx.get(buyerWalletRef) : null;
            const sellerWalletRef = sellerDebitTarget > 0 && sellerId ? firebase_1.db.collection('wallets').doc(sellerId) : null;
            const sellerWalletSnap = sellerWalletRef ? await tx.get(sellerWalletRef) : null;
            const articleRef = data.articleId
                ? firebase_1.db.collection('articles').doc(data.articleId)
                : null;
            const articleSnap = articleRef ? await tx.get(articleRef) : null;
            // Writes.
            tx.update(txRef, {
                status: 'refunded',
                refundedAt: firebase_1.FieldValue.serverTimestamp(),
                refundedVia: preData.stripePaymentIntentId ? 'stripe' : 'wallet',
                refundReason: typeof reason === 'string' ? reason.substring(0, 300) : 'admin_refund',
                disputed: false,
            });
            if (articleRef && articleSnap && articleSnap.exists) {
                tx.update(articleRef, { isSold: false });
            }
            // Re-credit buyer wallet portion (card portion goes back via Stripe).
            if (buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
                const refundCents = paidVia === 'wallet'
                    ? Math.round((data.totalAmount || 0) * 100)
                    : walletAmountUsed;
                if (refundCents > 0) {
                    const wd = buyerWalletSnap.data();
                    tx.update(buyerWalletRef, {
                        balance: firebase_1.FieldValue.increment(refundCents),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
                    tx.set(buyerLedgerRef, {
                        type: 'refund_credit',
                        amount: refundCents,
                        balanceAfter: (wd.balance || 0) + refundCents,
                        description: 'Remboursement administrateur — retour au porte-monnaie',
                        transactionId,
                        createdAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                }
            }
            // Debit seller across the three buckets in escrow order; shortfall = debt.
            if (sellerDebitTarget > 0 && sellerWalletRef) {
                if (sellerWalletSnap && sellerWalletSnap.exists) {
                    const swd = sellerWalletSnap.data();
                    const pendingNow = swd.pendingBalance || 0;
                    const heldNow = swd.heldBalance || 0;
                    const balanceNow = swd.balance || 0;
                    const fromPending = Math.min(sellerDebitTarget, pendingNow);
                    let remaining = sellerDebitTarget - fromPending;
                    const fromHeld = Math.min(remaining, heldNow);
                    remaining -= fromHeld;
                    const fromBalance = Math.min(remaining, balanceNow);
                    const shortfall = remaining - fromBalance;
                    const walletUpdate = {
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    };
                    if (fromPending > 0)
                        walletUpdate.pendingBalance = firebase_1.FieldValue.increment(-fromPending);
                    if (fromHeld > 0)
                        walletUpdate.heldBalance = firebase_1.FieldValue.increment(-fromHeld);
                    if (fromBalance > 0)
                        walletUpdate.balance = firebase_1.FieldValue.increment(-fromBalance);
                    if (shortfall > 0)
                        walletUpdate.sellerDebt = firebase_1.FieldValue.increment(shortfall);
                    tx.update(sellerWalletRef, walletUpdate);
                    const debited = fromPending + fromHeld + fromBalance;
                    const sellerLedgerRef = sellerWalletRef.collection('ledger').doc();
                    tx.set(sellerLedgerRef, Object.assign({ type: 'refund_debit', amount: debited, balanceAfter: balanceNow - fromBalance, description: shortfall > 0
                            ? 'Remboursement administrateur — débit vendeur (dette enregistrée)'
                            : 'Remboursement administrateur — débit vendeur', transactionId, createdAt: firebase_1.FieldValue.serverTimestamp() }, (shortfall > 0 && { debtRecorded: shortfall })));
                }
                else {
                    // No wallet at all: record full target as debt.
                    tx.set(sellerWalletRef, {
                        sellerDebt: firebase_1.FieldValue.increment(sellerDebitTarget),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    }, { merge: true });
                }
            }
        });
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[adminRefundTransaction] reconciliation failed', { transactionId, error: message });
        throw new https_1.HttpsError('internal', `Refund reconciliation failed: ${message}`);
    }
    logger.warn('[adminRefundTransaction] transaction refunded by admin', {
        transactionId,
        adminUid: request.auth.uid,
    });
    return { success: true };
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
    const { callerKey, isAuthenticated } = (0, rateLimit_1.resolveCallerKey)(request);
    await (0, rateLimit_1.checkRateLimit)(callerKey, isAuthenticated, {
        functionName: 'cancelPendingTransaction',
        maxCallsAuthenticated: 20,
        maxCallsUnauthenticated: 0,
        windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const { transactionId } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const txRef = firebase_1.db.collection('transactions').doc(transactionId);
    const callerUid = request.auth.uid;
    try {
        await firebase_1.db.runTransaction(async (tx) => {
            // ── ALL READS FIRST (Firestore requires reads before writes) ──
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
            // Read the article doc BEFORE any writes (Firestore transaction rule)
            // D2: Guard against deleted article — only update if it still exists
            let articleSnap = null;
            let articleRef = null;
            if (data.articleId) {
                articleRef = firebase_1.db.collection('articles').doc(data.articleId);
                articleSnap = await tx.get(articleRef);
            }
            // F03: Read buyer wallet if wallet was used (all reads before writes)
            const walletAmountUsed = data.walletAmountUsed || 0; // in cents
            const hasWalletDebit = walletAmountUsed > 0 && (data.paidVia === 'wallet_and_card' || data.paidVia === 'wallet');
            let buyerWalletSnap = null;
            let buyerWalletRef = null;
            if (hasWalletDebit) {
                buyerWalletRef = firebase_1.db.collection('wallets').doc(data.buyerId);
                buyerWalletSnap = await tx.get(buyerWalletRef);
            }
            // ── ALL WRITES AFTER ALL READS ──
            tx.update(txRef, {
                status: 'cancelled',
                cancelledAt: firebase_1.FieldValue.serverTimestamp(),
                cancelledBy: callerUid,
            });
            // Release the article so it can be purchased again.
            // createTransaction marks isSold=true atomically at creation
            // time; cancelling must undo that.
            if (articleRef && articleSnap && articleSnap.exists) {
                tx.update(articleRef, { isSold: false });
            }
            // F03: Refund wallet portion if wallet was debited
            if (hasWalletDebit && buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
                const walletData = buyerWalletSnap.data();
                tx.update(buyerWalletRef, {
                    balance: firebase_1.FieldValue.increment(walletAmountUsed),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
                const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
                tx.set(buyerLedgerRef, {
                    type: 'refund_credit',
                    amount: walletAmountUsed,
                    balanceAfter: (walletData.balance || 0) + walletAmountUsed,
                    description: 'Remboursement — transaction annulee',
                    transactionId,
                    createdAt: firebase_1.FieldValue.serverTimestamp(),
                });
                logger.info('cancelPendingTransaction: wallet portion refunded', {
                    transactionId,
                    buyerId: data.buyerId,
                    walletAmountRefunded: walletAmountUsed,
                });
            }
        });
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Error cancelling transaction:', error);
        throw new https_1.HttpsError('internal', `Failed to cancel: ${message}`);
    }
});
//# sourceMappingURL=payments.js.map