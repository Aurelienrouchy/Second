import type { ReactNode } from 'react';
import type { SupportAccountSource } from './supportRequest';

export const ACCOUNT_RELATIONSHIP_CAPABILITY = 'account_relationship_review_v1' as const;
export const ACCOUNT_RELATIONSHIP_INVENTORY_CAPABILITY = 'account_relationship_legacy_inventory_v1' as const;
export const ACCOUNT_RELATIONSHIP_INVENTORY_V2_CAPABILITY = 'account_relationship_legacy_inventory_v2' as const;
export const RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY = 'relationship_purchase_retirement_v1' as const;
export const RELATIONSHIP_PAIR_ACTIONS = ['retain_current', 'restrict_new_engagements', 'close_own_restriction'] as const;
export const RELATIONSHIP_ORDER_ACTIONS = ['retain_current', 'retain_release_review', 'close_own_release_review'] as const;
export const RELATIONSHIP_ASSESSMENTS = ['relationship_examined', 'unresolved', 'no_relation_established'] as const;
export const RELATIONSHIP_FACT_QUALIFICATIONS = ['declared', 'documentary', 'unknown', 'contradictory'] as const;
export type RelationshipScope = 'own' | 'admin';
export interface RelationshipOrder {kind: 'purchase' | 'swap'; id: string}
export interface RelationshipContext {supportRequestId: string; orders: RelationshipOrder[]}
export interface RelationshipReference {pairId: string; id: string; contentHash: string; version: number}
export interface RelationshipSource {sourceHash: string; pairId: string; version: number}
export interface RelationshipFact {qualification: typeof RELATIONSHIP_FACT_QUALIFICATIONS[number]; text: string}
export interface RelationshipEffects {
  commonIdentityVerified: false; fraudEstablished: false; refundAuthorized: false;
  globalBanAuthorized: false; inventoryPermissionGranted: false; fundsRecovered: false;
}
export interface RelationshipCommand {
  context: RelationshipContext; source: RelationshipSource; scope: RelationshipScope; action: 'record_review' | 'contest';
  pairAction: typeof RELATIONSHIP_PAIR_ACTIONS[number]; orderAction: typeof RELATIONSHIP_ORDER_ACTIONS[number];
  assessment: typeof RELATIONSHIP_ASSESSMENTS[number]; facts: RelationshipFact[];
  privateReason: string | null; statement: string | null; reconsiderWhen: string | null;
  partyMessages: {userId: string; message: string}[]; decisionReference: RelationshipReference | null; acknowledged: true;
}
export interface RelationshipAttempt {
  version: 1; uid: string; requestId: string; capability: typeof ACCOUNT_RELATIONSHIP_CAPABILITY; command: RelationshipCommand;
}
export interface RelationshipOrderSource extends RelationshipOrder {
  revision: string | null; sourceHash: string; originHash: string | null; originQualification: 'native_agreement' | 'native_proposal' | 'unknown';
}
export interface RelationshipEntry extends RelationshipEffects {
  reference: RelationshipReference; context: RelationshipContext; action: RelationshipCommand['action']; assessment: RelationshipCommand['assessment'];
  pairAction: RelationshipCommand['pairAction']; orderAction: RelationshipCommand['orderAction'];
  statement: string | null; privateReason: string | null; facts: RelationshipFact[] | null; reconsiderWhen: string | null;
  message: string | null; partyMessages: RelationshipCommand['partyMessages'] | null; relatedDecision: RelationshipReference | null; orders: RelationshipOrder[] | null;
  recordedAt: string; historicalOnly: true;
}
export type RelationshipHistoryEntry = {qualification: 'native_relationship_entry'; entry: RelationshipEntry} |
  {qualification: 'unknown'; entryId: string; entry: null};
export interface RelationshipRestriction {blocked: boolean; reference: RelationshipReference}
export interface RelationshipPreview extends RelationshipEffects {
  protocol: 'account_relationship_preview_v1'; actorId: string; scope: RelationshipScope; context: RelationshipContext;
  source: {sourceHash: string | null; pairId: string; version: number | null; qualification: 'native_current' | 'unknown'};
  ticket: {id: string; version: number; receivedAt: string; narrative: string} | null;
  accounts: SupportAccountSource[] | null; orders: RelationshipOrderSource[];
  pairRestriction?: RelationshipRestriction | null;
  orderReviews?: Record<string, RelationshipRestriction & {order: RelationshipOrder}>;
  ownScopes: {newEngagements: 'unknown' | 'restricted_by_review' | 'no_own_restriction';
    orderReleaseReviews: {order: RelationshipOrder; state: 'unknown' | 'retained_for_review' | 'no_own_review'}[]; currentPermissionsGranted: false} | null;
  legacyPaymentReview: {orders: {order: RelationshipOrder & {kind: 'swap'};
    state: 'native_manual_protocol_recorded' | 'neutralization_observed' | 'legacy_exposure_requires_review' | 'unknown';
    externalConfirmationPrevented: boolean; providerObservedAt: string | null}[];
    coverage: {selectedSwapCount: number; selectedOnly: true; exhaustivePairSwapHistoryVerified: false}};
  canRecordReview: boolean; canContest: boolean; selectedDecision: RelationshipEntry | null;
  entries: RelationshipHistoryEntry[]; nextCursor: {lastId: string} | null;
  coverage: {inspected: number; limit: 20; hasMore: boolean | null; exhaustiveHistoryVerified: false} | null;
  statement: string;
}
export interface RelationshipReceipt extends RelationshipEffects {
  protocol: 'account_relationship_command_v1'; actorId: string; requestId: string; command: RelationshipCommand; payloadHash: string;
  state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null; reference: RelationshipReference | null; recordedAt: string | null;
}
export type RelationshipInventoryDirection = 'first_to_second' | 'second_to_first';
export interface RelationshipInventoryCursor {direction: RelationshipInventoryDirection; lastId: string | null; sourceHash: string}
export interface RelationshipInventoryRow {
  swapId: string; source: {revision: string | null; sourceHash: string; originQualification: RelationshipOrderSource['originQualification']; originHash: string | null};
  direction: RelationshipInventoryDirection; createdAt: string | null; acceptedAt: string | null;
  status: 'proposed' | 'payment_pending' | 'accepted' | 'photos_pending' | 'shipping' | 'completed' | 'cancelled' | 'declined' | 'expired' | 'disputed' | 'unknown';
  topUp: {qualification: 'native_declared' | 'unknown'; baseCents: number | null; payerRole: 'first_party' | 'second_party' | null;
    paymentReferenceQualification: 'native_reference_present' | 'reference_absent_outcome_unknown' | 'malformed_reference_unknown'};
  payment: RelationshipPreview['legacyPaymentReview']['orders'][number] & {
    providerStatus: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'requires_capture' | 'canceled' | 'unknown';
    currentProviderStateVerified: false;
  };
  selectedInDecision: boolean; newNativeReviewRequired: boolean;
  checkoutReference: {swapId: string; relationshipReference: RelationshipReference} | null;
  coverage: 'native_pair_row_only'; paymentPermissionGranted: false; externalExposureExhaustivelyResolved: false;
}
export interface RelationshipInventoryPage extends RelationshipEffects {
  protocol: typeof ACCOUNT_RELATIONSHIP_INVENTORY_CAPABILITY; actorId: string; scope: 'admin'; decisionReference: RelationshipReference;
  source: {sourceHash: string; pairRevision: string | null; pairVersion: number | null;
    qualification: 'native_pair_current' | 'historical_pair_current_unknown'};
  readAt: string; rows: RelationshipInventoryRow[]; nextCursor: RelationshipInventoryCursor | null;
  coverage: {direction: RelationshipInventoryDirection; inspected: number; limit: 20; hasMoreInDirection: boolean; directionTailReached: boolean;
    resumedAfterId: string | null; snapshotConsistencyVerified: false; exhaustivePairSwapHistoryVerified: false;
    missingHistoricalPartyFields: 'unknown'; orphanProviderIntents: 'unknown'; providerQueriesPerformed: false};
  selectedDecisionChangesRequiredForOtherSwaps: true; currentPermissionsGranted: false;
}
export interface RelationshipReauthenticationProps {uid: string; sourceKey: string; disabled: boolean; onVerified: () => void; parcel?: boolean}
export type RelationshipReauthentication = (props: RelationshipReauthenticationProps) => ReactNode;

export type RelationshipInventoryV2Cursor = RelationshipInventoryCursor & {kind: RelationshipOrder['kind']};
export const RELATIONSHIP_PURCHASE_STATUSES = ['pending_payment', 'meetup_pending', 'meetup_confirmed', 'meetup_completed', 'paid', 'label_created',
  'shipped', 'delivered', 'completed', 'return_requested', 'delivery_failed', 'lost', 'cancelled', 'disputed', 'refund_in_progress', 'refund_action_required', 'refunded', 'unknown'] as const;
export interface RelationshipInventoryPurchaseRow {
  kind: 'purchase'; id: string; source: RelationshipInventoryRow['source']; direction: RelationshipInventoryDirection;
  createdAt: string | null; status: typeof RELATIONSHIP_PURCHASE_STATUSES[number];
  payment: {state: RelationshipInventoryRow['payment']['state']; externalConfirmationPrevented: boolean;
    providerStatus: 'canceled' | 'unknown'; currentProviderStateVerified: false};
  purchase: {paymentReferenceQualification: RelationshipInventoryRow['topUp']['paymentReferenceQualification'];
    totalCents: number | null; walletCents: number | null; currency: 'CAD' | null};
  selectedInDecision: boolean; newNativeReviewRequired: boolean;
  checkoutReference: {transactionId: string; relationshipReference: RelationshipReference} | null;
  coverage: 'native_pair_row_only'; paymentPermissionGranted: false; externalExposureExhaustivelyResolved: false;
}
export type RelationshipInventoryV2Row = RelationshipInventoryPurchaseRow | (RelationshipInventoryRow & {kind: 'swap'; id: string});
export interface RelationshipInventoryV2Page extends Omit<RelationshipInventoryPage, 'protocol' | 'rows' | 'nextCursor' | 'coverage' | 'selectedDecisionChangesRequiredForOtherSwaps'> {
  protocol: typeof ACCOUNT_RELATIONSHIP_INVENTORY_V2_CAPABILITY; rows: RelationshipInventoryV2Row[]; nextCursor: RelationshipInventoryV2Cursor | null;
  coverage: RelationshipInventoryPage['coverage'] & {kind: RelationshipOrder['kind']; exhaustivePairPurchaseHistoryVerified: false};
  selectedDecisionChangesRequiredForOtherOrders: true;
}
export interface RelationshipPurchaseCommand {
  transactionId: string; scope: 'admin'; sourceHash: string; paymentIntentId: string; totalCents: number; walletCents: number;
  relationshipReference: RelationshipReference; acknowledged: true;
}
export interface RelationshipPurchasePreview {
  preAuthorizationFenceSupported: true;
  protocol: 'relationship_purchase_legacy_preview_v1'; actorId: string; transactionId: string; relationshipReference: RelationshipReference;
  sourceHash: string; buyerId: string; sellerId: string; amounts: {totalCents: number; walletCents: number; cardCents: number; currency: 'CAD'};
  provider: {status: Exclude<RelationshipInventoryRow['payment']['providerStatus'], 'unknown'>; confirmationMethod: 'automatic' | 'manual';
    state: 'unconfirmed' | 'confirmation' | 'action' | 'processing' | 'succeeded' | 'authorized' | 'canceled';
    captureMethod: 'automatic' | 'automatic_async' | 'manual' | 'unknown'; observedAt: string};
  wallet: {qualification: 'none' | 'native_debit' | 'unknown'; obligationOpen: boolean}; canNeutralize: boolean; reason: string | null;
  commandTemplate: RelationshipPurchaseCommand | null; paymentPermissionGranted: false;
}
export interface RelationshipPurchaseAttempt {version: 1; uid: string; requestId: string;
  capability: typeof RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY; command: RelationshipPurchaseCommand}
export interface RelationshipPurchaseReceipt {
  preAuthorizationFenceSupported: true;
  protocol: 'relationship_purchase_retirement_command_v1'; actorId: string; requestId: string; command: RelationshipPurchaseCommand; payloadHash: string;
  state: 'unrecorded' | 'authorized' | 'unknown' | 'received' | 'not_executed'; reason: string | null; recordedAt: string | null;
  result: null | {transactionId: string; providerStatus: 'canceled'; cardCapabilityNeutralized: true; walletObligationOpen: boolean;
    walletCents: number; totalCents: number; paymentPermissionGranted: false; orderChanged: false; stockChanged: false; fundsMoved: false; providerObservedAt: string};
  paymentPermissionGranted: false;
}
