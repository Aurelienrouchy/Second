/**
 * Payment callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { getShippo } from '../config/shippo';

/**
 * Get shipping estimate via Shippo
 */
export const getShippingEstimate = onCall({ memory: '512MiB' }, async (request) => {
  const { fromAddress, toAddress, weight, dimensions } = request.data;

  if (!fromAddress || !toAddress) {
    throw new HttpsError('invalid-argument', 'From and to addresses are required');
  }

  const shippo = getShippo();
  if (!shippo) {
    throw new HttpsError('failed-precondition', 'Shippo API not configured');
  }

  try {
    // Use provided dimensions or default values
    const parcelDimensions = {
      length: dimensions?.length?.toString() || '30',
      width: dimensions?.width?.toString() || '25',
      height: dimensions?.height?.toString() || '10',
      distanceUnit: 'cm' as const,
      weight: weight?.toString() || '0.5',
      massUnit: 'kg' as const,
    };

    console.log('📦 Creating Shippo shipment with:', {
      fromAddress,
      toAddress,
      parcelDimensions,
    });

    // Create shipment object
    const shipment = await shippo.shipments.create({
      addressFrom: {
        name: fromAddress.name,
        street1: fromAddress.street,
        city: fromAddress.city,
        zip: fromAddress.postalCode,
        country: fromAddress.country,
      },
      addressTo: {
        name: toAddress.name,
        street1: toAddress.street,
        city: toAddress.city,
        zip: toAddress.postalCode,
        country: toAddress.country,
        phone: toAddress.phoneNumber || '',
      },
      parcels: [parcelDimensions],
      async: false,
    });

    // Extract rates
    const rates = shipment.rates.map((rate: any) => ({
      carrier: rate.provider,
      serviceName: rate.servicelevel.name,
      estimatedDays: rate.estimatedDays || '3-5',
      amount: parseFloat(rate.amount),
      currency: rate.currency,
      shippoRateId: rate.objectId,
    }));

    console.log(`✅ Retrieved ${rates.length} shipping rates`);

    // Return cheapest and fastest options
    return {
      success: true,
      rates: rates.slice(0, 3), // Return top 3 options
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting shipping estimate:', error);
    throw new HttpsError('internal', `Failed to get shipping estimate: ${message}`);
  }
});

/**
 * Create Stripe Payment Intent
 */
export const createPaymentIntent = onCall({ memory: '512MiB' }, async (request) => {
  const { transactionId } = request.data;

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  if (!transactionId) {
    throw new HttpsError('invalid-argument', 'Transaction ID is required');
  }

  const stripeClient = getStripe();
  if (!stripeClient) {
    throw new HttpsError('failed-precondition', 'Stripe API not configured');
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

    // Check if payment intent already exists
    if (transaction.paymentIntentId) {
      const existingIntent = await stripeClient.paymentIntents.retrieve(
        transaction.paymentIntentId
      );
      if (existingIntent.status !== 'canceled') {
        return {
          success: true,
          clientSecret: existingIntent.client_secret,
          paymentIntentId: existingIntent.id,
        };
      }
    }

    // Create new payment intent
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: Math.round(transaction.totalAmount * 100), // Convert to cents
      currency: 'eur',
      metadata: {
        transactionId,
        buyerId: transaction.buyerId,
        sellerId: transaction.sellerId,
        articleId: transaction.articleId,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Update transaction with payment intent ID
    await db.collection('transactions').doc(transactionId).update({
      paymentIntentId: paymentIntent.id,
    });

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error creating payment intent:', error);
    throw new HttpsError('internal', `Failed to create payment intent: ${message}`);
  }
});

/**
 * Check tracking status from Shippo
 */
export const checkTrackingStatus = onCall({ memory: '512MiB' }, async (request) => {
  const { transactionId } = request.data;

  if (!transactionId) {
    throw new HttpsError('invalid-argument', 'Transaction ID is required');
  }

  try {
    // Get transaction
    const transactionDoc = await db.collection('transactions').doc(transactionId).get();

    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transaction = transactionDoc.data()!;

    if (!transaction.trackingNumber) {
      throw new HttpsError('failed-precondition', 'No tracking number available');
    }

    const shippo = getShippo();
    if (!shippo) {
      throw new HttpsError('failed-precondition', 'Shippo API not configured');
    }

    // Get tracking info from Shippo
    const tracking = await shippo.trackingStatus.get(
      transaction.trackingNumber,
      transaction.shippingEstimate?.carrier || 'usps'
    );

    const trackingStatus = tracking.trackingStatus?.status || 'UNKNOWN';

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
      const amount = transaction.amount;

      // Move from pending to available balance
      const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);
      const sellerBalanceDoc = await sellerBalanceRef.get();

      if (sellerBalanceDoc.exists) {
        const balanceData = sellerBalanceDoc.data()!;
        const transactions = balanceData.transactions || [];

        // Update the sale transaction status to completed
        const updatedTransactions = transactions.map((t: any) => {
          if (t.id === transactionId) {
            return { ...t, status: 'completed' };
          }
          return t;
        });

        await sellerBalanceRef.update({
          pendingBalance: FieldValue.increment(-amount),
          availableBalance: FieldValue.increment(amount),
          totalEarnings: FieldValue.increment(amount),
          transactions: updatedTransactions,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // Send system message
      const chatQuery = await db
        .collection('chats')
        .where('articleId', '==', transaction.articleId)
        .where('participants', 'array-contains', transaction.buyerId)
        .limit(1)
        .get();

      if (!chatQuery.empty) {
        const chatId = chatQuery.docs[0].id;

        await db.collection('messages').add({
          chatId,
          senderId: 'system',
          receiverId: 'system',
          type: 'system',
          content:
            '✅ Colis livré ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
          timestamp: FieldValue.serverTimestamp(),
          status: 'sent',
          isRead: true,
        });
      }
    }

    return {
      success: true,
      trackingStatus,
      trackingHistory: tracking.trackingHistory || [],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error checking tracking status:', error);
    throw new HttpsError('internal', `Failed to check tracking: ${message}`);
  }
});
