export const SELLER_TAX_CAPABILITY = 'seller_tax_reporting_v1' as const;
export const SELLER_TAX_COLLECTIONS = ['events', 'identities', 'snapshots', 'declarations', 'filings', 'deliveries', 'assistance', 'credit_notes', 'captures'] as const;
export const SELLER_TAX_ASSISTANCE_REASONS = ['missing_identity', 'missing_tax_identifier', 'identifier_exception', 'missing_copy', 'disputed_period', 'incorrect_information'] as const;
export type SellerTaxCollection = typeof SELLER_TAX_COLLECTIONS[number];
export type SellerTaxAssistanceReason = typeof SELLER_TAX_ASSISTANCE_REASONS[number];
export interface SellerTaxScope {access: 'owner' | 'admin'; subject: 'seller' | 'operator'; ownerId: string | null; year: number}
export interface SellerTaxSourceOwner {protocol: 'seller_tax_source_owner_v1'; kind: 'purchase'; transactionId: string;
  partyRole: 'buyer' | 'seller'; ownerId: string; sourceVersionHash: string}
export interface SellerTaxDocumentReference {id: string; contentHash: string}
export interface SellerTaxCaptureReference {id: string; scopeHash: string}
export interface SellerTaxReadTime {seconds: number; nanoseconds: number}
export interface SellerTaxEvidenceReference {artifactId: string; generation: string; contentHash: string}
export type SellerTaxSource = {kind: 'purchase' | 'swap'; id: string} | {kind: 'purchase_refund'; id: string; refundIntentId: string};
export type SellerTaxCommand = {expectedVersion: number} & (
  {action: 'operator_record' | 'identity_record'; evidenceReference: SellerTaxEvidenceReference} |
  {action: 'evidence_event' | 'credit_note_record'; source: SellerTaxSource; evidenceReference: SellerTaxEvidenceReference} |
  {action: 'ingest'; source: SellerTaxSource} | {action: 'scan' | 'annual_capture_prepare'} |
  {action: 'snapshot'; captureReference?: SellerTaxCaptureReference} |
  {action: 'annual_capture_advance'; captureReference: SellerTaxCaptureReference} |
  {action: 'assistance'; reasonCode: SellerTaxAssistanceReason} |
  {action: 'declaration_prepare'; kind: 'original' | 'corrective' | 'cancelled'; previousDeclaration: SellerTaxDocumentReference | null; captureReference?: SellerTaxCaptureReference} |
  {action: 'filing_record' | 'copy_record'; declaration: SellerTaxDocumentReference; evidenceReference: SellerTaxEvidenceReference} |
  {action: 'copy_ack'; declaration: SellerTaxDocumentReference; delivery: SellerTaxDocumentReference});
/** Only exact enums, native IDs and opaque proof references; never fiscal identity values. */
export interface SellerTaxAttempt {version: 1; uid: string; scope: SellerTaxScope; requestId: string; command: SellerTaxCommand; inputHash: string}
export interface SellerTaxReceipt {
  protocol: 'seller_tax_command_v1'; actorId: string; requestId: string; inputHash: string;
  subject: SellerTaxScope['subject']; ownerId: string | null; year: number; action: SellerTaxCommand['action'];
  status: 'pending' | 'completed' | 'not_executed' | 'unknown'; versionBefore: number; versionAfter: number;
  documentReference: SellerTaxDocumentReference | null; reason: string | null; recordedAt: string; completedAt: string | null;
  financialEffectAuthorized: false; authorityFilingPerformed: false;
}
export interface SellerTaxScan {phase: 'sales' | 'initiated' | 'received' | 'done'; cursor: string | null;
  refundQueue: {transactionId: string; cursor: string | null}[]; pages: number; closed: boolean; issues: string[]}
export interface SellerTaxOperator {status: 'documented_reporting_operator' | 'documented_excluded_operator' | 'unknown';
  legalName: 'Seconde Technologies inc.'; identityAvailable: boolean; timeZone: 'UTC' | 'America/Toronto';
  policyVersion: 'ca_dpi_goods_2026_01'; purpose: 'part_xx_reporting'; gstRegistrationDocumented: boolean;
  qstRegistrationDocumented: boolean; externalAssessmentVerified: false}
export interface SellerTaxIdentity {personKind: 'individual'; identityDocumented: boolean; residenceJurisdictions: string[];
  identifierStatus: 'external_identifier_documented' | 'exception_documented' | 'missing';
  exceptionReason: 'jurisdiction_does_not_issue' | 'jurisdiction_does_not_require_collection' | 'government_verification_service' | null;
  completeForPreparation: boolean; externalIdentityVerified: false; taxIdentifierValueAvailableInApp: false}
interface SellerTaxCaseHeader {protocol: typeof SELLER_TAX_CAPABILITY; subject: SellerTaxScope['subject']; ownerId: string | null; year: number}
export type SellerTaxCase = SellerTaxCaseHeader & ({opaque: true} | {opaque: false; version: number;
  operator: (SellerTaxOperator & {versionHash: string}) | null;
  identity: (SellerTaxIdentity & {versionHash: string; operatorVersionHash: string}) | null;
  lastSnapshot: SellerTaxDocumentReference | null; lastDeclaration: SellerTaxDocumentReference | null; scan: SellerTaxScan;
  createdAt: string | null; fiscalFactsAreCertified: false; filingPerformedByApplication: false;
  taxRegistrationCertified: false; financialEffectAuthorized: false; administrativeView: boolean});
export interface SellerTaxQuarter {quarter: 1 | 2 | 3 | 4; grossConsiderationCents: number; adjustmentsCents: number;
  considerationCents: number; platformFeesCents: number; platformTaxesCents: number; activityCount: number}
interface SellerTaxAnnualSummaryBase {protocol: 'seller_tax_annual_summary_v1'; ownerId: string; year: number; currency: 'CAD';
  timeZone: 'UTC' | 'America/Toronto' | 'unqualified'; policyVersion: 'ca_dpi_goods_2026_01'; quarters: SellerTaxQuarter[];
  annualActivityCount: number | null; annualConsiderationCents: number | null; smallGoodsExclusionCandidate: boolean | null;
  activityCountBasis: 'one_native_agreement_per_seller'; exclusionDoesNotDetermineProfessionalStatus: true;
  issues: string[];
  sourceReferences: {eventId: string; bodyHash: string; versionHash: string; currentObservationHash: string}[];
  eventSetHash: string; completeSourceUniverseVerified: false;
  withdrawalsOrReleasesCounted: false; eventsInspected: number; hasMore: boolean; nextCursor: string | null}
export type SellerTaxAnnualSummary = SellerTaxAnnualSummaryBase & ({qualification: 'unknown' | 'recorded_events_only'; nativeEventSnapshotVerified: false} |
  {qualification: 'unknown' | 'fixed_native_sources'; nativeEventSnapshotVerified: true; captureReference: SellerTaxCaptureReference;
    nativeReadTime: SellerTaxReadTime; knownNativeSourceSetClosed: true; legalSourceUniverseVerified: false});
export interface SellerTaxCapture {protocol: 'seller_tax_annual_capture_v1'; ownerId: string; year: number; reference: SellerTaxCaptureReference;
  status: 'capturing' | 'complete' | 'unavailable'; reason: null | 'native_read_time_expired_or_unavailable'; version: number; readTime: SellerTaxReadTime;
  context: {operatorVersionHash: string | null; operatorStatus: SellerTaxOperator['status']; timeZone: 'UTC' | 'America/Toronto' | 'unqualified';
    identityVersionHash: string | null; identityReady: boolean; policyVersion: 'ca_dpi_goods_2026_01'};
  pages: number; cursor: {phase: 'events' | 'sales' | 'initiated' | 'received' | 'ledger' | 'done'; lastId: string | null; refundQueue: {transactionId: string; lastId: string | null}[]};
  sourcesInspected: number; unknownSources: number; otherYearSources: number; entriesHash: string; summary: SellerTaxAnnualSummary | null;
  knownNativeSourcesOnly: true; legalSourceUniverseVerified: false; authorityReadMode: 'current'; financialEffectAuthorized: false}
export interface SellerTaxPrivateCopy {protocol: 'seller_tax_private_copy_v1'; ownerId: string; year: number;
  availability: 'available' | 'unavailable'; reason: null | 'individual_file_not_recorded'; declaration: SellerTaxDocumentReference; filing: SellerTaxDocumentReference;
  delivery: SellerTaxDocumentReference; sourceVersionHash: string;
  file: null | {contentHash: string; generation: string; contentType: 'application/pdf' | 'application/xml' | 'text/xml'; sizeBytes: number};
  dataBase64: string | null; individualizationBasis: null | 'independent_qualified_attestation'; legalAuthenticityVerified: false; deviceReadVerified: false}
export interface SellerTaxPrivateCreditNote extends Pick<SellerTaxPrivateCopy, 'ownerId' | 'year' | 'availability' | 'reason' | 'sourceVersionHash' | 'file' | 'dataBase64' | 'individualizationBasis' | 'legalAuthenticityVerified' | 'deviceReadVerified'> {
  protocol: 'seller_tax_private_credit_note_v1'; creditNote: SellerTaxDocumentReference;
  source: Extract<SellerTaxSource, {kind: 'purchase_refund'}>; issuedAt: string; originalInvoiceReferenceHash: string;
  gstCents: number; qstCents: number; buyerFeeCents: number;
}
export interface SellerTaxEvent {protocol: 'seller_tax_event_body_v1'; ownerId: string; source: SellerTaxSource; activityReference: string;
  eventKind: 'paid_or_credited' | 'original_period_adjustment'; currency: 'CAD'; effectiveAt: string | null; adjustmentRecordedAt: string | null;
  grossConsiderationCents: number | null; platformFeesCents: number | null; platformTaxesCents: number | null;
  considerationDeltaCents: number | null; walletCreditCents: number | null; debtOffsetCents: number | null;
  activityCountImpact: 0 | 1; originalEventId: string | null; buyerPaymentRecordedAt: string | null;
  nonMonetaryValueCents: number | null; financialAccountValueIncluded: false}
export interface SellerTaxEvidence {purpose: 'operator' | 'identity' | 'filing' | 'delivery' | 'credit_note' | 'valuation' | 'coverage';
  reference: SellerTaxEvidenceReference; contentHash: string; generation: string; issuedAt: string; externalAuthenticityVerified: false}
interface SellerTaxDocumentBase {protocol: 'seller_tax_document_v1'; subject: SellerTaxScope['subject']; ownerId: string | null;
  year: number; actorId: string; recordedAt: string; externalFactsVerified: false; financialEffectAuthorized: false; evidence: SellerTaxEvidence | null}
interface SellerTaxSnapshotFields {summary: SellerTaxAnnualSummary; operatorVersionHash: string | null;
  operatorQualification: SellerTaxOperator['status']; identityVersionHash: string | null; identityReady: boolean;
  sourceScan: SellerTaxScan; refundHistoryCoverageVerified: boolean; captureReference?: SellerTaxCaptureReference}
interface SellerTaxDeclarationFields {declaration: SellerTaxDocumentReference; declarationKind: 'original' | 'corrective' | 'cancelled'; documentReferenceId: string}
export type SellerTaxDocument = SellerTaxDocumentBase & (
  {kind: 'annual_capture_prepare' | 'annual_capture_advance'; capture: SellerTaxCapture} |
  {kind: 'operator_record'; operator: SellerTaxOperator} |
  {kind: 'identity_record'; identity: SellerTaxIdentity; operatorVersionHash: string} |
  {kind: 'ingest' | 'evidence_event'; eventId: string; event: SellerTaxEvent; eventBodyHash: string;
    qualification: 'native_fact' | 'documented_evidence' | 'unknown'; reason: string; source: SellerTaxSource} |
  {kind: 'scan'; scan: SellerTaxScan; events: string[]; liveSourceSnapshotVerified: false; refundHistoryCoverageVerified: boolean} |
  ({kind: 'snapshot'} & SellerTaxSnapshotFields) |
  ({kind: 'declaration_prepare'; declarationKind: 'original' | 'corrective' | 'cancelled'; previousDeclaration: SellerTaxDocumentReference | null;
    previousDocumentReferenceId: string | null; documentReferenceId: string; status: 'prepared_for_external_validation';
    requirementsUnknown: string[]; officialReturnCreated: false; filingPerformed: false} & SellerTaxSnapshotFields) |
  {kind: 'assistance'; reasonCode: SellerTaxAssistanceReason; state: 'assistance_requested'; identifierValueProvided: false; accountRestrictedByThisAction: false} |
  ({kind: 'filing_record'; state: 'external_receipt_recorded'; authority: 'CRA'; reportedExternalStatus: 'received' | 'accepted' | 'rejected';
    reportedReceivedAt: string; confirmationReferenceHash: string; submittedFileHash: string; authorityAcceptanceVerified: false;
    submittedContentBinding: 'external_receipt_claim'; externalReturnSchemaVerified: false} & SellerTaxDeclarationFields) |
  ({kind: 'copy_record'; state: 'external_delivery_evidence_recorded'; filingReference: SellerTaxDocumentReference;
    channel: 'secure_external_vault' | 'postal_receipt' | 'in_person_receipt'; reportedDeliveredAt: string; deliveredFileHash: string;
    reportedCopyScope: 'single_seller'; copyContentVerified: false; sellerAccessVerified: false;
    copyAccess?: {individualFileRecorded: true; individualizationBasis: 'independent_qualified_attestation'; legalAuthenticityVerified: false}} & SellerTaxDeclarationFields) |
  ({kind: 'copy_ack'; delivery: SellerTaxDocumentReference; state: 'owner_acknowledged_access'; acknowledgedAt: string} & SellerTaxDeclarationFields) |
  {kind: 'credit_note_record'; source: SellerTaxSource; state: 'external_credit_note_recorded'; currentAccountingQualification: string;
    originalInvoiceAuthenticityVerified: false; issuedAt: string; originalInvoiceReferenceHash: string; gstCents: number;
    qstCents: number; buyerFeeCents: number; registrationLegallyVerified: false;
    creditNoteAccess?: {individualFileRecorded: true; individualizationBasis: 'independent_qualified_attestation'; legalAuthenticityVerified: false}});
export interface SellerTaxPage {collection: SellerTaxCollection; entries: {reference: SellerTaxDocumentReference; document: SellerTaxDocument}[];
  hasMore: boolean; nextCursor: string | null; inspected: number; completeHistory: false}
export interface SellerTaxResponse {caseView: SellerTaxCase; commandReceipt: SellerTaxReceipt | null; page: SellerTaxPage | null}
