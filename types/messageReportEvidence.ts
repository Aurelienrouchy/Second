/** One exact selected message; declarations never attest fraud or restitution. */
import type {ContentSafetyStatement} from './contentSafety';
export type MessageExposureValue = 'declared_yes' | 'declared_no' | 'unknown';
export interface MessageExposure {linkOpened: MessageExposureValue; informationShared: MessageExposureValue; externalPaymentDeclared: MessageExposureValue}
export interface MessageReportSelection {chatId: string; messageId: string | null; transactionId: string | null}
export interface MessageReportFlags {exposureVerified: false; externalPaymentVerified: false; faultEstablished: false; refundAuthorized: false; recoveryVerified: false}
export interface MessageReportOrder {qualification: 'unknown' | 'not_requested' | 'native_linked_order'; transactionId: string | null; revision: string | null; status: string | null; deliveryType: string | null}
export interface MessageReportSource extends MessageReportFlags {
  protocol: 'message_report_source_v1'; qualification: 'native_message' | 'unknown'; chatId: string; messageId: string;
  sourceHash: string | null; sourceRevision: string | null; messageRevision: string | null; chatRevision: string | null;
  senderId: string | null; messageType: 'text' | 'image' | 'offer' | null; text: string | null; imagePresent: boolean; order: MessageReportOrder | null;
}
export interface MessageReportPreview extends MessageReportFlags {protocol: 'message_report_preview_v1'; actorId: string; previewId: string | null; source: MessageReportSource;
  contentSafety?: {capability:'content_safety_v1';linkedReviewId:string|null;linkedReviewQualification:'native_linked_review'|'unknown'|'not_requested'}}
export interface MessageReportCommand {chatId: string; messageId: string; transactionId: string | null; previewId: string; sourceHash: string;
  sourceRevision: string; reason: string; description: string | null; exposure: MessageExposure; acknowledged: true; contentSafety?: ContentSafetyStatement}
export interface MessageReportAttempt {version: 1; uid: string; requestId: string; command: MessageReportCommand}
export interface MessageReportReceipt extends MessageReportFlags {protocol: 'message_report_command_v1'; actorId: string; requestId: string;
  command: MessageReportCommand; payloadHash: string; state: 'unrecorded' | 'committed' | 'not_executed'; reason: string | null;
  reportId: string | null; captureId: string | null; captureHash: string | null; reportStatus: string | null; recordedAt: string | null}
export interface AdminMessageReportEvidence extends MessageReportFlags {protocol: 'message_report_evidence_v1'; reportId: string;
  actorId?: string; qualification: 'unknown' | 'native_capture'; sourceCurrentQualification: 'unknown' | 'same_native_source' | 'changed';
  capturedAt: string | null; chatId: string | null; messageId: string | null; sourceHash: string | null; sourceRevision: string | null;
  exposure: MessageExposure | null; source: null | {protocol: 'message_report_captured_content_v1'; actorId: string; chatId: string; messageId: string;
    chatRevision: string; messageRevision: string; participantIds: string[]; messageCreatedAt: string | null;
    message: {senderId: string; receiverId: string | null; type: 'text' | 'image' | 'offer'; content: string | null;
      image: {url: string | null; width: number | null; height: number | null; thumbnail: string | null} | null;
      offer: {amount: number | null; status: string | null; message: string | null} | null}; requestedTransactionId: string | null; order: MessageReportOrder};
}
