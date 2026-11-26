/** Advisory native facts. Amounts are distinct observations, never additive sales. */
export interface SellerActivityMoneyFact {
  qualification: 'native_order_amount' | 'native_recorded_effect' | 'unknown';
  amountCents: number | null;
  currency: 'CAD' | null;
  reason: string | null;
}
export interface SellerActivityDateFact {
  qualification: 'native_timestamp' | 'unknown';
  at: string | null;
  reason: string | null;
}
export interface SellerActivitySource {
  transactionId: string; sellerId: string; orderRevision: string; orderSourceHash: string; scopeHash: string;
}
export interface SellerActivityCursor {lastId: string; scopeHash: string}
export interface SellerActivityRecordSource {revision: string | null; sourceHash: string}
export interface SellerActivityLedgerFacts {
  inspected: number; limit: 20; hasMore: boolean;
  sources: (SellerActivityRecordSource & {id: string})[];
}
export interface SellerActivityItem {
  transactionId: string; qualification: 'native_order' | 'unknown'; source: SellerActivityRecordSource;
  recordedStatus: string | null; createdAt: SellerActivityDateFact; paidAt: SellerActivityDateFact; releasedAt: SellerActivityDateFact;
  amounts: {
    orderTotal: SellerActivityMoneyFact; articlePrice: SellerActivityMoneyFact; sellerGross: SellerActivityMoneyFact;
    cardCaptured: SellerActivityMoneyFact; walletDebited: SellerActivityMoneyFact; sellerCredit: SellerActivityMoneyFact; release: SellerActivityMoneyFact;
    nativeRefund: {total: SellerActivityMoneyFact; card: SellerActivityMoneyFact; wallet: SellerActivityMoneyFact};
  };
  financialSources: {buyerLedger: SellerActivityLedgerFacts | null; sellerLedger: SellerActivityLedgerFacts | null};
}
export interface SellerActivityFactsPage {
  protocol: 'seller_activity_facts_v1'; actorId: string; anchorTransactionId: string; sellerId: string; readAt: string;
  source: SellerActivitySource;
  profile: {source: SellerActivityRecordSource; recordedCreatedAt: SellerActivityDateFact; authCreatedAt: SellerActivityDateFact};
  items: SellerActivityItem[];
  pagination: {inspected: number; limit: 20; hasMore: boolean; nextCursor: SellerActivityCursor | null};
  coverage: {source: 'native_transactions_for_seller'; order: 'document_id'; chronologicalOrderVerified: false;
    exhaustiveHistoryVerified: false; accountingSnapshot: false; globalTotalsProvided: false;
    firstInspectedId: string | null; lastInspectedId: string | null; afterId: string | null};
  pageHash: string;
  fraudEstablished: false; financialPermissionGranted: false; inventoryPermissionGranted: false;
  restrictionPermissionGranted: false; professionalClassification: null; activityAssessment: 'not_provided'; bankArrivalVerified: false;
}
