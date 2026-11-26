export const BUSINESS_CESSATION_CAPABILITY = 'business_cessation_v1' as const;
export type BusinessCessationAccess = 'admin' | 'owner';
export interface BusinessCessationObligation {kind: 'transaction' | 'swap' | 'withdrawal' | 'wallet' | 'support'; id: string}
export type BusinessCessationCommand = {action: 'create_plan'; reason: string}
  | {action: 'advance_inventory' | 'seal_inventory' | 'export_next_page' | 'seal_export'; planId: string; expectedVersion: number}
  | {action: 'export_claim'; planId: string; claimId: string}
  | {action: 'link_claim'; planId: string; supportRequestId: string; reference: BusinessCessationObligation};
export interface BusinessCessationReference {uid: string; access: BusinessCessationAccess; requestId: string; inputHash: string}
export interface BusinessCessationReceipt {
  protocol: 'business_cessation_receipt_v1'; actorUid: string; requestId: string; inputHash: string;
  state: 'unrecorded' | 'not_executed' | 'pending' | 'recorded'; action: BusinessCessationCommand['action'] | null;
  planId: string | null; claimId: string | null; resultingVersion: number | null; receiptHash: string | null; recordedAt: string | null;
  newCommerceActivated: false; financialEffectExecuted: false;
}
export interface BusinessCessationContact {responsible: 'Direction Seconde'; email: 'privacy@seconde.app'; availabilityVerified: false}
export interface BusinessCessationStatus {
  protocol: 'business_cessation_status_v1'; newCommerce: 'open' | 'stop_new' | 'unqualified'; reason: string | null;
  controlGeneration: string | null; planId: string | null; servicingIndependentlyGuarded: true; declaredContact: BusinessCessationContact;
  reserveFinancingVerified: false; cessationActivatedByThisRequest: false;
}
export interface BusinessCessationCapture {seconds: number; nanoseconds: number}
export interface BusinessCessationPlan {
  protocol: 'business_cessation_plan_v1'; planId: string; version: number; createdBy: string; reason: string; capture: BusinessCessationCapture;
  inventory: {sourceIndex: number; sourceCount: number; cursor: string | null; pageCount: number; rowCount: number; unknownCount: number; digest: string; complete: boolean};
  export: {pageCount: number; digest: string; sealed: boolean; policyQualified: boolean};
  inventorySettlesObligations: false; allObligationsResolved: false; reserveFinancingVerified: false;
  independentArchiveRecorded: boolean; outsideAppFutureAvailabilityVerified: false; createdAt: string | null; updatedAt: string | null;
}
export interface BusinessCessationRow {
  rowId: string; category: string; sourceRef: string; sourceHash: string; sourceRevision: string | null; status: string | null;
  obligationState: 'open' | 'unknown'; responsible: 'Direction Seconde'; recoveryRoutes: string[]; physicalCompletionVerified: false; financialSettlementVerified: false;
}
export interface BusinessCessationPage {
  protocol: 'business_cessation_page_v1'; planId: string; pageNumber: number; category: string; capture: BusinessCessationCapture;
  previousDigest: string; digest: string; rows: BusinessCessationRow[]; knownSourcesOnly: true;
}
export interface BusinessCessationClaim {
  protocol: 'business_cessation_claim_v1'; claimId: string; planId: string; ownerUid: string; supportRequestId: string;
  reference: BusinessCessationObligation; sourceHash: string; sourceRevision: string | null; status: 'recorded_for_servicing';
  contact: BusinessCessationContact; recordedAt: string | null; obligationResolved: false; financialEffectExecuted: false;
  archive: {state: 'not_recorded' | 'pending' | 'recorded'; contentHash: string | null; generation: string | null};
}
export type BusinessCessationExportTarget = {kind: 'inventory'; planId: string; pageNumber: number} | {kind: 'claim'; claimId: string; planId: string};
export type BusinessCessationExport = {
  protocol: 'business_cessation_export_read_v1' | 'business_cessation_claim_export_read_v1'; planId: string;
  pageNumber?: number; claimId?: string; contentHash: string; generation: string; bytesBase64: string; mimeType: 'application/json';
  independentArchiveRecorded: true; outsideAppFutureAvailabilityVerified: false; containsPrivateEvidence: false;
};
export type BusinessCessationLane = 'purchases' | 'sales' | 'swaps_initiated' | 'swaps_received' | 'withdrawals' | 'wallet' | 'support';
export interface BusinessCessationOwnObligations {
  protocol: 'business_cessation_own_obligations_v1'; lane: BusinessCessationLane;
  items: {reference: BusinessCessationObligation; status: string | null; recordedAt: string | null; amountCents: number | null;
    currency: 'CAD' | null; sourceHash: string; sourceRevision: string | null}[];
  cursor: string | null; hasMore: boolean; claimPermissionGranted: false;
}

export type BusinessCessationDiscovery = {
  protocol: 'business_cessation_plans_v1'; items: BusinessCessationPlan[]; cursor: string | null; hasMore: boolean;
} | {protocol: 'business_cessation_own_claims_v1'; items: BusinessCessationClaim[]; cursor: string | null; hasMore: boolean};
