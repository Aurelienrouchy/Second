/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 *
 * Shipping via ShipEngine (Intelcom + Canada Post)
 * Payment via Helcim (HelcimPay.js checkout)
 * Commission via service fee calculation
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { getShipEngine, ShipEngineClient } from '../config/shipEngine';
import { getHelcim } from '../config/helcim';
import { calculateFees, calculateServiceFee, getServiceFeeConfig } from '../utils/fees';

// =============================================================================
// GET SHIPPING ESTIMATES — Multi-carrier via ShipEngine
// =============================================================================

export const getShippingEstimate = onCall({ memory: '512MiB' }, async (request) => {
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

export const getServiceFee = onCall(async (request) => {
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
// CREATE HELCIM CHECKOUT — Initialize HelcimPay.js session
// =============================================================================

export const createHelcimCheckout = onCall({ memory: '512MiB' }, async (request) => {
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
    // Get transaction details
    const transactionDoc = await db.collection('transactions').doc(transactionId).get();

    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transaction = transactionDoc.data()!;

    // Verify the user is the buyer
    if (transaction.buyerId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'You are not authorized for this transaction');
    }

    // Check if already paid
    if (transaction.status === 'paid') {
      throw new HttpsError('already-exists', 'Transaction already paid');
    }

    // Calculate fees
    const fees = calculateFees(transaction.amount, transaction.shippingCost);

    // Update transaction with fee info if not already set
    if (!transaction.serviceFee) {
      await db.collection('transactions').doc(transactionId).update({
        serviceFee: fees.serviceFee,
        serviceFeePercent: fees.serviceFeePercent,
        totalAmount: fees.buyerTotal,
        sellerPayout: fees.sellerPayout,
      });
    }

    // Create Helcim checkout session
    const checkout = await helcim.createCheckoutSession({
      amount: fees.buyerTotal,
      currency: 'CAD',
      paymentType: 'purchase',
      invoiceNumber: transactionId,
      taxAmount: 0, // Pas de taxe sur les ventes C2C de seconde main
    });

    // Store the secret token for webhook verification
    await db.collection('transactions').doc(transactionId).update({
      helcimSecretToken: checkout.secretToken,
      helcimCheckoutCreatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`✅ Helcim checkout created for transaction ${transactionId} — total: $${fees.buyerTotal}`);

    return {
      success: true,
      checkoutToken: checkout.checkoutToken,
      feeBreakdown: {
        articlePrice: fees.articlePrice,
        shippingCost: fees.shippingCost,
        serviceFee: fees.serviceFee,
        serviceFeePercent: fees.serviceFeePercent,
        buyerTotal: fees.buyerTotal,
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

export const findPickupPoints = onCall(async (request) => {
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

export const checkTrackingStatus = onCall({ memory: '512MiB' }, async (request) => {
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

    // Update transaction
    await db.collection('transactions').doc(transactionId).update({
      trackingStatus,
    });

    // If delivered, move funds from pending to available
    if (trackingStatus === 'DELIVERED') {
      await db.collection('transactions').doc(transactionId).update({
        status: 'delivered',
        deliveredAt: FieldValue.serverTimestamp(),
      });

      const sellerId = transaction.sellerId;
      const sellerPayout = transaction.sellerPayout || transaction.amount;

      // Move from pending to available balance
      const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);
      const sellerBalanceDoc = await sellerBalanceRef.get();

      if (sellerBalanceDoc.exists) {
        const balanceData = sellerBalanceDoc.data()!;
        const transactions = balanceData.transactions || [];

        const updatedTransactions = transactions.map((t: any) => {
          if (t.id === transactionId) {
            return { ...t, status: 'completed' };
          }
          return t;
        });

        await sellerBalanceRef.update({
          pendingBalance: FieldValue.increment(-sellerPayout),
          availableBalance: FieldValue.increment(sellerPayout),
          totalEarnings: FieldValue.increment(sellerPayout),
          transactions: updatedTransactions,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // Send system message
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
