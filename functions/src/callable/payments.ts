/**
 * Paiement — façade.
 *
 * Le fichier faisait 3881 lignes et portait 7 domaines. Il est éclaté dans
 * `callable/payments/` ; cette façade réexporte tout à l'identique, donc
 * index.ts (déclaration des fonctions déployées) et
 * scheduled/sweepPendingLabels.ts n'ont pas changé.
 */

export { RATE_LIMIT_WINDOW_MS, feeReductionForShopTier, isShopTierActive, reductionForShopDoc, resolveBuyerFeeReduction } from './payments/feeReduction';
export { CA_POSTAL_RE, CA_PROVINCE_CODES, resolveSellerOriginAddress, validateBuyerShippingAddress } from './payments/address';
export { checkTrackingStatus, findPickupPoints, getShippingEstimate } from './payments/shipping';
export { STRIPE_MIN_CHARGE_CENTS, createStripeCheckout, confirmStripeCheckout, retireLegacyStripeCheckout, createTransaction, getServiceFee, verifyAcceptedOfferForNegotiatedAmount } from './payments/checkout';
export { addBankAccount, createStripeConnectAccount, getStripeAccountStatus, uploadStripeIdentityDocument } from './payments/connectAccount';
export { MEETUP_NO_SHOW_REASONS, MEETUP_REPORTABLE_STATUSES, acceptMeetupOffer, completeMeetupTransaction, confirmMeetupTransaction, reportMeetupNoShow } from './payments/meetup';
export { inspectPaymentCaptureAnomaly, closeMeetupNoShow, retryPurchaseRefund, adminRefundTransaction, cancelPendingTransaction, resolveDispute, sellerCancelTransaction } from './payments/disputes';

export { quoteShippingPurchase, setArticleShippingParcel, getArticleShippingParcel } from './payments/shippingPurchase';
