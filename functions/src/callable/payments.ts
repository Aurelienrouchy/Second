/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 *
 * Shipping via ShipEngine (Intelcom + Canada Post)
 * Payment via Helcim (HelcimPay.js checkout)
 * Commission via service fee calculation
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine, ShipEngineClient } from '../config/shipEngine';
import { getHelcim } from '../config/helcim';
import { calculateFees, calculateServiceFee, getServiceFeeConfig } from '../utils/fees';

// =============================================================================
// GET SHIPPING ESTIMATES — Multi-carrier via ShipEngine
// =============================================================================

export const getShippingEstimate = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting shipping estimate:', error);
    throw new HttpsError('internal', `Failed to get shipping estimate: ${message}`);
  }
});

// =============================================================================
// GET SERVICE FEE — Returns fee info for client display
// =============================================================================

export const getServiceFee = onCall({ region: 'northamerica-northeast1' }, async (request) => {
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

        // Mark article as sold
        tx.update(articleRef, { isSold: true });

        // Build transaction data — server-side fee calculation (never trust client)
        const fee = calculateServiceFee(amount);
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
// CREATE HELCIM CHECKOUT — Initialize HelcimPay.js session
// =============================================================================

export const createHelcimCheckout = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
  const { transactionId } = request.data;

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  if (!transactionId) {
    throw new HttpsError('invalid-argument', 'Transaction ID is required');
  }

  const helcim = getHelcim();
  if (!helcim) {
    throw new HttpsError('failed-precondition', 'Helcim API not configured');
  }

  try {
    const txRef = db.collection('transactions').doc(transactionId);

    // Atomically read, validate, and update fee fields inside a transaction
    // to prevent races where concurrent calls both see !serviceFee and
    // double-write.
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

      // H8: Only allow checkout creation from valid statuses
      const checkoutableStatuses = new Set(['pending_payment']);
      if (!checkoutableStatuses.has(transaction.status)) {
        throw new HttpsError('failed-precondition', `Cannot create checkout for transaction in status ${transaction.status}`);
      }

      // H2: If a valid checkout already exists, return the existing token
      if (transaction.helcimCheckoutToken && transaction.helcimCheckoutCreatedAt) {
        const existingFees = calculateFees(transaction.amount, transaction.shippingCost || 0);
        return { existingCheckout: true, fees: existingFees, checkoutToken: transaction.helcimCheckoutToken as string };
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

      return { existingCheckout: false, fees: calculatedFees, checkoutToken: null as string | null };
    });

    // H2: If checkout already existed, return early without creating a new session
    if (txResult.existingCheckout) {
      console.log(`♻️ Returning existing Helcim checkout for transaction ${transactionId}`);
      return {
        success: true,
        checkoutToken: txResult.checkoutToken,
        feeBreakdown: {
          articlePrice: txResult.fees.articlePrice,
          shippingCost: txResult.fees.shippingCost,
          serviceFee: txResult.fees.serviceFee,
          serviceFeePercent: txResult.fees.serviceFeePercent,
          buyerTotal: txResult.fees.buyerTotal,
        },
      };
    }

    // Create Helcim checkout session (external API call, after transaction commits)
    const checkout = await helcim.createCheckoutSession({
      amount: txResult.fees.buyerTotal,
      currency: 'CAD',
      paymentType: 'purchase',
      invoiceNumber: transactionId,
      taxAmount: 0, // Pas de taxe sur les ventes C2C de seconde main
    });

    // Store the secret token AND checkout token for idempotent returns
    await txRef.update({
      helcimSecretToken: checkout.secretToken,
      helcimCheckoutToken: checkout.checkoutToken,
      helcimCheckoutCreatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`✅ Helcim checkout created for transaction ${transactionId} — total: $${txResult.fees.buyerTotal}`);

    return {
      success: true,
      checkoutToken: checkout.checkoutToken,
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
    console.error('Error creating Helcim checkout:', error);
    throw new HttpsError('internal', `Failed to create checkout: ${message}`);
  }
});

// =============================================================================
// FIND PICKUP POINTS — ShipEngine PUDO search
// =============================================================================

export const findPickupPoints = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
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

export const checkTrackingStatus = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
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
          console.warn('[payments] Could not load chat participants:', lookupErr);
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
export const requestWithdrawal = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { amount, bankAccount } = request.data ?? {};
  const userId = request.auth.uid;

  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'Invalid amount');
  }
  if (amount < 10) {
    throw new HttpsError('invalid-argument', 'Minimum withdrawal is 10');
  }
  if (typeof bankAccount !== 'string') {
    throw new HttpsError('invalid-argument', 'Numéro de compte bancaire requis');
  }

  // Validate Canadian bank account format
  // Accept either TTTTT-III-AAAAAAA (dashed) or raw digits (15-20 chars)
  const sanitizedBankAccount = bankAccount.replace(/[\s-]/g, '');
  const dashedFormat = /^\d{5}-\d{3}-\d{7,12}$/.test(bankAccount.trim());
  const rawFormat = /^\d{15,20}$/.test(sanitizedBankAccount);

  if (!dashedFormat && !rawFormat) {
    throw new HttpsError(
      'invalid-argument',
      'Format de compte bancaire invalide. Attendu : TTTTT-III-AAAAAAA ou 15-20 chiffres'
    );
  }

  const balanceRef = db.collection('seller_balances').doc(userId);

  try {
    // Use Firestore auto-generated ID to avoid collision from Date.now()
    const withdrawalRef = db.collection('withdrawal_requests').doc();
    const withdrawalId = withdrawalRef.id;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(balanceRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Balance not found');
      }
      const data = snap.data()!;
      const available = typeof data.availableBalance === 'number' ? data.availableBalance : 0;
      if (available < amount) {
        throw new HttpsError('failed-precondition', 'Insufficient balance');
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
        bankAccountLast4: sanitizedBankAccount.slice(-4),
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true, withdrawalId };
  } catch (error: unknown) {
    if (error instanceof HttpsError) throw error;
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[requestWithdrawal] Error', { userId, error: message });
    throw new HttpsError('internal', `Failed to request withdrawal: ${message}`);
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

          tx.update(sellerBalanceRef, {
            pendingBalance: FieldValue.increment(-actualPayout),
            availableBalance: FieldValue.increment(actualPayout),
            totalEarnings: FieldValue.increment(actualPayout),
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
 * Buyer cancels a transaction that has not been paid yet (e.g. Helcim
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
