/**
 * Types — Transaction : statuts et signalement acheteur.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

import type { Article, ArticleImage, ArticleSize } from './article';
import type { Chat } from './chat';
import type { MeetupSpot } from './meetup';
import type { ShippingAddress } from './shipping';

export type TransactionDeliveryType = 'meetup' | 'shipping';

export type TransactionStatus =
  | 'pending_payment'    // Awaiting Stripe payment (shipping only)
  | 'meetup_pending'     // Meetup requested, awaiting seller confirmation
  | 'meetup_confirmed'   // Seller confirmed meetup
  | 'meetup_completed'   // Both parties confirmed exchange
  | 'paid'               // Payment received (shipping) — seller prepares parcel
  | 'label_created'      // Shipping label purchased, before first carrier scan
  | 'shipped'            // Package shipped (in transit)
  | 'delivered'          // Package delivered — funds held during dispute window
  | 'completed'          // Sale finalized after 7-day dispute window
  | 'return_requested'   // Buyer requested a return — return label being issued, funds held
  | 'delivery_failed'    // Carrier delivery failed — dispute opened, funds frozen
  | 'lost'               // Parcel declared lost — funds frozen
  | 'cancelled'          // Cancelled by either party
  | 'disputed'           // Dispute opened on the order
  | 'refund_in_progress' // Transient — resolves to 'refunded'
  | 'refund_action_required'
  | 'refunded';          // Refund completed

/** Reason categories for a buyer report / return request (UX spec §4b, §4d). */
export type BuyerReportReason =
  | 'not_received'      // Colis non reçu
  | 'not_as_described'  // Article non conforme à l'annonce
  | 'damaged'           // Article endommagé
  | 'changed_mind'      // Changement d'avis (return flow only)
  | 'other';            // Autre

/** Buyer-submitted problem report attached to a transaction. */
export interface BuyerReport {
  reason: BuyerReportReason;
  details?: string;     // Free-form description
  reportedAt: Date;
}

export type RefundStatus = 'pending' | 'requires_action' | 'unknown' | 'succeeded' | 'failed' | 'canceled' | 'reconciliation_required';
/** Callable transport contract. A resolved Promise is not a financial confirmation. */
export interface IssueRefundResult {
  success: boolean;
  status: RefundStatus;
  intentId: string | null;
  refundId: string | null;
  actionRequired: boolean;
  message: string;
  outstandingCardCents: number | null;
  localReconciliationRequired: boolean;
  bankWaiting: boolean;
  alreadyRefunded?: boolean;
}
export interface TransactionRefund {
  intentId?: string;
  state?: RefundStatus | 'requested';
  source?: string;
  originalStatus?: TransactionStatus;
  reason?: string;
  paymentIntentId?: string | null;
  providerStatus?: string | null;
  stripeRefundId?: string | null;
  failureReason?: string | null;
  cardAmountCents?: number | null;
  capturedCardCents?: number | null;
  walletAmountCents?: number | null;
  cardConfirmedCents?: number | null;
  cardSatisfiedVia?: string | null;
  outstandingCardCents?: number | null;
  localOutstandingWalletCents?: number | null;
  localOutstandingSellerCents?: number | null;
  duplicateCardSettlementCents?: number | null;
  freezeCents?: number;
  legacyReconciliationRequired?: boolean;
  bankWaiting?: boolean;
  bankWaitingDisputeId?: string | null;
  fundsAppliedAt?: Date;
  requestedAt?: Date;
  updatedAt?: Date;
  authorizedRetryAt?: Date;
}
export interface TransactionBankDispute {
  id?: string;
  state?: 'open' | 'closed';
  outcome?: 'won' | 'lost' | 'warning_closed' | null;
  amountCents?: number;
  freezeCents?: number;
  reconciliationRequired?: boolean;
  conflictingDisputeId?: string;
  statusBeforeOpen?: TransactionStatus | null;
  openedAt?: Date;
  closedAt?: Date;
  ledgerReconciledAt?: Date;
}

/** Delivery history is retained while a contradictory carrier observation is reviewed. */
export interface TransactionDeliveryCorrection {
  schemaVersion: 1;
  correctionId: string;
  transactionId: string;
  buyerId: string;
  sellerId: string;
  state: 'release_suspended' | 'released_review_required';
  qualification: 'dated_provider_correction' | 'current_snapshot_contradicts_delivery';
  reason: string;
  detectedAt: Date;
  originalDeliveryAt: Date | null;
  originalFundsReleaseAt: Date | null;
  originalFundsReleasedAt: Date | null;
  ownerMessage: string;
  ownerAction: 'contactSupport';
  initialObservation?: Record<string, unknown>;
  latestObservation?: Record<string, unknown>;
}

/** Item terms stored by the server with an order, separate from the live listing. */
export interface TransactionArticleSnapshot {
  title?: string;
  description?: string;
  saleUnit?: Article['saleUnit'];
  listingContentVersion?: 'listing_content_v1' | 'listing_content_v2';
  price?: number;
  images?: Array<ArticleImage | string>;
  category?: string;
  categoryIds?: string[];
  condition?: Article['condition'];
  hygieneDeclaration?: Article['hygieneDeclaration'];
  size?: ArticleSize | string | null;
  brand?: string | null;
  brandStatus?: Article['brandStatus'];
  colors?: string[];
  materials?: string[];
  hasKnownDefects?: boolean;
  defectsDescription?: string | null;
  hasAlterations?: boolean | null;
  alterationsDescription?: string | null;
}

/** Server witness for a pending-order cancellation, distinct from status alone. */
export interface PendingCancellationProof {
  schemaVersion: 1;
  state: 'committed' | 'reconciliation_required';
  transactionId: string;
  buyerId: string;
  sellerId: string;
  source: 'participant_cancel_pending' | 'expiry_pending_1h';
  requestedBy: string | null;
  walletRefundCents?: number;
  purchaseDebitLedgerId?: string | null;
  walletRefundLedgerId?: string | null;
  cardCapabilityNeutralized?: boolean;
  committedAt?: Date;
  reason?: string;
  recordedAt?: Date;
}
export interface PendingCancellationResult {
  success: true;
  replay: boolean;
  currentStatus: 'cancelled';
  cancellationCommitted: true;
  walletRefundCommitted: true;
  refundedCents: number;
}

export type ReturnRequestReason = 'not_as_described' | 'damaged' | 'wrong_item' | 'other';
export type PhysicalReturnReason = ReturnRequestReason | 'change_of_mind';
export type ReturnRequestStatus = 'reserved' | 'preparing' | 'quoted' | 'requested' | 'unknown' | 'reconciliation_required' | 'committed' | 'closed';
/** Quote belongs to the request in its parent receipt; measurements are declared. */
export interface ReturnShippingQuote {
  protocol: 'return_quote_v1' | 'return_quote_v2';
  quoteId: string;
  requestId: string;
  version: number;
  rateId: string;
  currency: 'CAD';
  costCents: number;
  /** Only new quotes carry these accepted terms; absence remains historical. */
  depositTerms?: import('./returnDepositDeadline').ReturnDepositTerms;
  depositTermsHash?: string;
  convenienceReturnFinancialTerms?: import('./convenienceReturn').ConvenienceReturnFinancialTerms;
  convenienceReturnFinancialTermsHash?: string;
  carrierName: string;
  serviceName: string;
  estimatedDeliveryDays: number | null;
  issuedAtMs: number;
  parcel: {weight: {value: number; unit: 'kilogram'};
    dimensions: {length: number; width: number; height: number; unit: 'centimeter'}};
  measurementVerified: false;
  refundDecisionGranted: false;
}
/** Read-only historical evidence; this never grants permission to ship. */
export interface HistoricalReturnDocument {
  transactionId: string;
  labelUrl: string;
  trackingNumber: string | null;
  shippingPermissionGranted: false;
}
export interface ReturnRequestResult {
  protocol: 'return_request_v1' | 'return_request_v2';
  transactionId: string;
  success: boolean;
  replay: boolean;
  requestId: string | null;
  version: number | null;
  requestRecorded: boolean;
  fundsFrozen: boolean;
  labelCommitted: boolean;
  shippingPermissionGranted: boolean;
  quote: ReturnShippingQuote | null;
  status: ReturnRequestStatus;
  actionRequired: boolean;
  currentOrderStatus: string;
  returnTrackingNumber: string | null;
  returnLabelUrl: string | null;
  /** Canadian dollars, not cents. */
  returnLabelCost: number | null;
  reason: string | null;
  terminalCapture?: import('./convenienceReturn').ConvenienceReturnTerminal;
  costResolution?: import('./convenienceReturn').ConvenienceReturnVarianceResolution;
}
export interface TransactionReturnRequest {
  schemaVersion: 1 | 2;
  requestId: string;
  version: number;
  transactionId: string;
  actorUid: string;
  buyerId: string;
  sellerId: string;
  reason: PhysicalReturnReason;
  totalCents: number;
  sellerPayoutCents: number;
  currency: 'CAD';
  sourceHash: string;
  /** Present only on a new return frozen from a qualified corrected delivery window. */
  effectiveDeliveryWindowSourceHash?: string;
  commercialReturn?: import('./productCommercialReturn').ProductCommercialReturnReference;
  convenienceReturn?: import('./convenienceReturn').ConvenienceReturnReference;
  convenienceReturnBasis?: Record<string, unknown>;
  commercialReturnBasis?: Omit<import('./productCommercialReturn').ProductCommercialReturnBasis, 'reportedAt' | 'initialReleaseAt' | 'instructedAt'> & {
    reportedAt: Date; initialReleaseAt: Date; instructedAt: Date};
  state: ReturnRequestStatus;
  requestedAt?: Date;
  fundsReleaseAt?: Date;
  authorizedAt?: Date;
  committedAt?: Date;
  lastFailureReason?: string;
  labelProof?: {labelId: string; trackingNumber: string; labelUrl: string; cost: number};
}
/** A submitted effect is never erased merely because a read has no server witness yet. */
export interface ReturnRequestAttempt {
  schemaVersion: 1;
  actorUid: string;
  transactionId: string;
  reason: PhysicalReturnReason;
  requestId?: string;
  version?: number;
  /** A submitted confirmation is never sent again after an unknown outcome. */
  phase?: 'prepare_submitted' | 'prepared' | 'confirm_submitted';
  acceptedQuote?: {quoteId: string; rateId: string; version: number; costCents: number; returnDepositTermsHash?: string;
    convenienceReturnFinancialTermsHash?: string; expectedNetRefundCents?: number};
  capability?: 'convenience_return_shipping_v1';
  convenienceReturn?: import('./convenienceReturn').ConvenienceReturnReference;
  materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1';
  commercialReturn?: import('./productCommercialReturn').ProductCommercialReturnReference;
}

export interface Transaction {
  id: string;
  articleId: string;
  buyerId: string;
  sellerId: string;
  /** Missing on legacy orders; never substitute the current price as agreed terms. */
  articleSnapshot?: TransactionArticleSnapshot | null;
  currency?: string;
  shippingQuoteId?: string;
  stripeCheckoutProtocol?: string;
  walletCheckoutAttemptId?: string;
  walletCheckoutOutcome?: string;
  paidVia?: string;
  walletAmountUsed?: number;
  walletPayment?: {
    schemaVersion: 1; state: 'committed'; actorUid: string; amountCents: number; ledgerId: string;
    currency: 'CAD'; quoteId: string; rateId: string; committedAt?: Date;
  };
  amount: number;
  shippingCost: number;
  totalAmount: number;
  deliveryType: TransactionDeliveryType;
  status: TransactionStatus;
  // Service fee (commission Seconde)
  serviceFee?: number;
  serviceFeePercent?: number;
  /** Sales tax (TPS/TVQ) on the service fee. 0/absent when TAX_ENABLED=false. */
  taxTotal?: number;
  sellerPayout?: number;
  // Stripe payment
  stripePaymentIntentId?: string;
  stripeClientSecret?: string;
  stripeChargeId?: string;
  // ShipEngine shipping
  shipEngineRateId?: string;
  shipEngineLabelId?: string;
  carrierCode?: string;
  shippingLabelUrl?: string;
  trackingNumber?: string;
  trackingStatus?: string;
  trackingUrl?: string;
  shippingAddress?: ShippingAddress;
  // Legacy Intelcom (kept for migration)
  intelcomBookingId?: string;
  // Meetup details
  meetupSpot?: MeetupSpot;
  meetupConfirmedAt?: Date;
  meetupCompletedAt?: Date;
  /**
   * Message d'offre à l'origine de la transaction, posé par `acceptMeetupOffer`.
   * Absent sur les transactions pré-créées par le checkout direct, qui
   * précèdent l'envoi de l'offre.
   */
  offerMessageId?: string;
  // Chat reference
  chatId?: string;
  // Buyer-protection / funds-release window (7 days after delivery)
  fundsReleaseAt?: Date;        // When held funds become available
  fundsReleasedAt?: Date;       // When held funds were actually released
  deliveryCorrection?: TransactionDeliveryCorrection | null;
  deliveryCorrectionBlocked?: boolean;
  deliveryCorrectionOwnerMessage?: string;
  deliveryCorrectionOwnerAction?: 'contactSupport';
  // Dispute lifecycle
  disputed?: boolean;
  statusBeforeDispute?: TransactionStatus; // Status snapshot before dispute opened
  disputeOutcome?: string;      // Resolution outcome (free-form / enum server-side)
  disputeClosedAt?: Date;
  // Buyer report (raised from a delivery_failed / lost / return recourse flow)
  buyerReport?: BuyerReport;
  noShowReport?: {reportedBy: string; reason: string; details?: string; reportedAt?: Date};
  counterReport?: {reportedBy: string; reason: string; details?: string; reportedAt?: Date};
  // Return flow (article received but returned — return fees charged to the buyer)
  returnRequest?: TransactionReturnRequest | null;
  returnReconciliationRequired?: boolean;
  returnReconciliationReason?: string;
  returnLabelPending?: boolean | null;
  returnLabelId?: string;       // ShipEngine return label id
  returnTrackingNumber?: string;
  returnCarrierCode?: string;
  returnTrackingStatus?: string;
  returnLabelUrl?: string;      // Printable return label PDF url
  returnLabelCost?: number;     // Return shipping cost (Canadian dollars)
  returnReason?: string;        // Buyer-provided reason for the return
  returnRequestedAt?: Date;     // When the buyer requested the return
  returnDeliveredAt?: Date;     // When the return parcel was received by the seller
  // Shipping reconciliation (actual cost vs estimate)
  actualShippingCost?: number;  // Real shipping cost charged by carrier (currency units)
  shippingCostDelta?: number;   // Difference vs estimated shippingCost
  insuranceCost?: number;       // Shipping insurance cost
  shippingReconciledAt?: Date;
  // Label generation tracking
  labelAttempts?: number;       // Number of label-creation attempts
  lastLabelAttemptAt?: Date;
  labelCreatedAt?: Date;
  labelStaleNudgedAt?: Date;    // Last reminder sent for an undeposited label
  // Delivery / loss
  deliveryFailedAt?: Date;
  // Seller crediting
  sellerCreditedCents?: number; // Amount credited to seller wallet (cents)
  // Refund details
  refundReason?: string;
  refundedVia?: string;         // e.g. 'stripe' | 'wallet'
  stripeRefundIssuedAt?: Date;
  refundStartedAt?: Date;
  // Cancellation
  cancelReason?: string;
  pendingCancellation?: PendingCancellationProof;
  // Timestamps
  createdAt: Date;
  /** False when no valid creation date was stored; epoch is only a read fallback. */
  createdAtKnown?: boolean;
  refund?: TransactionRefund;
  refundBlocked?: boolean;
  refundLegacyReconciliationRequired?: boolean;
  refundLegacyOperationId?: string;
  bankDispute?: TransactionBankDispute;
  disputeId?: string;
  disputeFreezeCents?: number;
  refundedAt?: Date;
  capturedCardCents?: number;
  walletPaidAmount?: number;
  paidAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
}
