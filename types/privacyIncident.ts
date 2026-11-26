export type PrivacyIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type PrivacyIncidentStatus = 'open' | 'investigating' | 'contained' | 'resolved';
export type PrivacyCAIChannel = 'cai_secure_form' | 'registered_mail' | 'email' | 'other';

interface PrivacyCommandIdentity { expectedAdminUid: string; requestId: string }
export interface PrivacyIncidentCreationInput extends PrivacyCommandIdentity {
  type: string;
  severity: PrivacyIncidentSeverity;
  description: string;
  affectedUserIds: string[];
  affectedDataFields: string[];
  measures: string;
  status: PrivacyIncidentStatus;
}
export interface PrivacyCAIInput extends PrivacyCommandIdentity {
  incidentId: string;
  notifiedAt: string;
  channel: PrivacyCAIChannel;
  caiReference: string;
  evidenceReference: string;
}
export interface PrivacyNoticeInput extends PrivacyCommandIdentity {
  incidentId: string;
  messageVersion: string;
  message: string;
}
export type PrivacyIncidentAttempt =
  | { version: 1; kind: 'create'; payload: PrivacyIncidentCreationInput }
  | { version: 1; kind: 'cai'; payload: PrivacyCAIInput }
  | { version: 1; kind: 'notice'; payload: PrivacyNoticeInput };

export interface PrivacyCAIReceipt {
  opaque?: false;
  protocol: 'privacy_cai_external_v1';
  ok: true;
  incidentId: string;
  requestId: string;
  actorUid: string;
  receiptId: string;
  payloadHash: string;
  replay: boolean;
  notifiedAt: string;
  recordedAt: string;
  channel: PrivacyCAIChannel;
  caiReference: string;
  evidenceReference: string;
  externalActionDeclared: true;
  sentByApplication: false;
}
export interface PrivacyNoticeReceipt {
  opaque?: false;
  protocol: 'privacy_user_notices_v1';
  ok: true;
  incidentId: string;
  actorUid: string;
  requestId: string;
  campaignId: string;
  messageVersion: string;
  payloadHash: string;
  requestPayloadHash: string;
  total: number;
  inAppCommittedCount: number;
  pendingCount: number;
  failedThisAttempt: number;
  complete: boolean;
  inAppCommitted: boolean;
  resumable: boolean;
  transportQueued: boolean;
  transportIntentCount: number;
  deviceDeliveryVerified: false;
  readingVerified: false;
}
export interface PrivacyCreationReceipt {
  opaque?: false;
  protocol: 'privacy_incident_creation_v1';
  ok: true;
  incidentId: string;
  requestId: string;
  actorUid: string;
  payloadHash: string;
  createdAt: string;
  replay: boolean;
}
interface PrivacyOpaqueReceiptIdentity {
  ok: true;
  incidentId: string;
  requestId: string;
  actorUid: string;
  opaque: true;
  requestCommitted: true;
  replay: true;
}
/** This proves only the actor's recorded declaration, without its private body. */
export interface PrivacyOpaqueCAIReceipt extends PrivacyOpaqueReceiptIdentity {
  protocol: 'privacy_cai_external_v1';
  payloadHash: string;
  receiptId: string;
  recordedAt: string;
  externalActionDeclared: true;
  sentByApplication: false;
}
/** A recorded command never establishes campaign completion or recipient counts. */
export interface PrivacyOpaqueNoticeReceipt extends PrivacyOpaqueReceiptIdentity {
  protocol: 'privacy_user_notices_v1';
  payloadHash: string | null;
  requestPayloadHash: string;
  campaignId: string;
}
export type PrivacyIncidentReceipt = PrivacyCAIReceipt | PrivacyNoticeReceipt | PrivacyCreationReceipt |
  PrivacyOpaqueCAIReceipt | PrivacyOpaqueNoticeReceipt;
export type PrivacyOwnCommandReference = {
  kind: 'create'; expectedAdminUid: string; requestId: string; incidentId: string; payloadHash: string;
} | {
  kind: 'cai'; expectedAdminUid: string; requestId: string; incidentId: string; payloadHash: string;
} | {
  kind: 'notice'; expectedAdminUid: string; requestId: string; incidentId: string; payloadHash: string; campaignId: string;
};
export interface PrivacyOwnCommandReceipt {
  protocol: 'privacy_own_command_receipt_v1';
  actorUid: string;
  requestId: string;
  reference: PrivacyOwnCommandReference;
  state: 'unrecorded' | 'committed' | 'not_executed';
  recordedAt: string | null;
  reason: 'command_neutralized' | null;
  requestCommitted: boolean;
  opaque: boolean;
  privateIncidentAccessGranted: false;
  notificationCompletionVerified: false;
  externalCAISendVerified: false;
  receipt: PrivacyNoticeReceipt | null;
}
/** Local summary only. Acknowledgement always reads the exact native receipt again. */
export type PrivacyOwnCommandJournalProof = Pick<PrivacyOwnCommandReceipt, 'state' | 'recordedAt' | 'reason'>;
export interface PrivacyIncidentJournalEntry {
  version: 1 | 2;
  reference: PrivacyOwnCommandReference;
  attempt: PrivacyIncidentAttempt | null;
  receipt: PrivacyIncidentReceipt | null;
  proof: PrivacyOwnCommandJournalProof | null;
}

export interface PrivacyIncidentRecord {
  id: string;
  type: string | null;
  severity: PrivacyIncidentSeverity | null;
  description: string | null;
  affectedUserIds: string[];
  affectedDataFields: string[];
  measures: string;
  status: PrivacyIncidentStatus | null;
  detectedAt: string | null;
  notifiedCAI: boolean;
  caiNotificationState: 'external_action_documented' | 'historical_unqualified' | 'not_recorded';
  caiNotificationReceipt: Pick<PrivacyCAIReceipt, 'protocol' | 'receiptId' | 'actorUid' | 'notifiedAt' | 'recordedAt' |
    'channel' | 'caiReference' | 'evidenceReference' | 'externalActionDeclared' | 'sentByApplication'> | null;
  legacyCAIDeclaration: { notifiedCAI: boolean; notifiedCAIAt: string | null; caiReference: string | null };
  userNotificationState: 'in_app_committed' | 'pending_or_unqualified' | 'historical_unqualified' | 'not_recorded';
  notifiedUsersAt: string | null;
  legacyNotifiedUsersAt: string | null;
  deviceDeliveryVerified: false;
  readingVerified: false;
}
