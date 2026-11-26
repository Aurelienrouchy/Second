import {CryptoDigestAlgorithm, digestStringAsync} from 'expo-crypto';
import {phase1HttpsCallable as httpsCallable} from '@/services/phase1Callable';
import {functions} from '@/config/firebaseConfig';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {canonicalArticleReport} from '@/services/articleReportJournal';
import type {AdminMessageReportEvidence, MessageExposure, MessageReportAttempt, MessageReportCommand, MessageReportPreview, MessageReportReceipt, MessageReportOrder} from '@/types/messageReportEvidence';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const utf8Bytes = (v: string) => Array.from(v).reduce((sum, char) => {const code = char.codePointAt(0)!; return sum + (code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4);}, 0);
const revision = (v: unknown) => {if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) return false; const [seconds, nanos] = v.split(':').map(Number); return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;};

export const messageReportId = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v && !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v) && utf8Bytes(v) <= 1500;
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const nullableString = (v: unknown) => v === null || typeof v === 'string';
const flags = (v: Record<string, unknown>) => ['exposureVerified', 'externalPaymentVerified', 'faultEstablished', 'refundAuthorized', 'recoveryVerified'].every(k => v[k] === false);
export const sameMessageReport = (a: unknown, b: unknown) => canonicalArticleReport(a) === canonicalArticleReport(b);
export function messageExposure(v: unknown): v is MessageExposure {return record(v) && Object.keys(v).sort().join(',') === 'externalPaymentDeclared,informationShared,linkOpened' && Object.values(v).every(x => ['declared_yes', 'declared_no', 'unknown'].includes(String(x)));}
function order(v: unknown): v is MessageReportOrder {return record(v) && ['unknown', 'not_requested', 'native_linked_order'].includes(String(v.qualification)) && nullableString(v.transactionId) && nullableString(v.revision) && nullableString(v.status) && nullableString(v.deliveryType) && (v.qualification === 'native_linked_order' ? messageReportId(v.transactionId) && revision(v.revision) : v.transactionId === null && v.revision === null && v.status === null && v.deliveryType === null);}
function capturedSource(v: unknown): v is NonNullable<AdminMessageReportEvidence['source']> {
  if (!record(v) || v.protocol !== 'message_report_captured_content_v1' || !messageReportId(v.actorId) || !messageReportId(v.chatId) || !messageReportId(v.messageId) ||
      !revision(v.chatRevision) || !revision(v.messageRevision) || !(v.messageCreatedAt === null || iso(v.messageCreatedAt)) ||
      !Array.isArray(v.participantIds) || v.participantIds.length !== 2 || new Set(v.participantIds).size !== 2 || !v.participantIds.every(messageReportId) || !v.participantIds.includes(v.actorId) ||
      !record(v.message) || !messageReportId(v.message.senderId) || !v.participantIds.includes(v.message.senderId) ||
      !(v.message.receiverId === null || messageReportId(v.message.receiverId) && v.message.receiverId !== v.message.senderId && v.participantIds.includes(v.message.receiverId)) ||
      !nullableString(v.message.content) || !['text', 'image', 'offer'].includes(String(v.message.type)) ||
      !(v.requestedTransactionId === null || messageReportId(v.requestedTransactionId)) || !order(v.order) ||
      (v.order.qualification === 'native_linked_order' && v.order.transactionId !== v.requestedTransactionId)) return false;
  const positive = (x: unknown) => x === null || typeof x === 'number' && Number.isFinite(x) && x > 0;
  const m = v.message;
  if (m.type === 'image' ? !record(m.image) || !nullableString(m.image.url) || !nullableString(m.image.thumbnail) || !positive(m.image.width) || !positive(m.image.height) : m.image !== null) return false;
  if (m.type === 'offer' ? !record(m.offer) || !positive(m.offer.amount) || !nullableString(m.offer.status) || !nullableString(m.offer.message) : m.offer !== null) return false;
  return m.type !== 'text' || typeof m.content === 'string' && !!m.content;
}
function command(v: unknown): v is MessageReportCommand {
  if (!record(v)) return false;
  const safety = Object.prototype.hasOwnProperty.call(v,'contentSafety');
  if (Object.keys(v).filter(k=>!safety||k!=='contentSafety').sort().join(',') !== 'acknowledged,chatId,description,exposure,messageId,previewId,reason,sourceHash,sourceRevision,transactionId') return false;
  if (safety && (!record(v.contentSafety) || Object.keys(v.contentSafety).sort().join(',') !== 'linkedReviewId,protocol,urgency' || v.contentSafety.protocol !== 'content_safety_statement_v1' || !['yes','no','unknown'].includes(String(v.contentSafety.urgency)) || !(v.contentSafety.linkedReviewId === null || messageReportId(v.contentSafety.linkedReviewId)) || !['review_pressure','refund_pressure','threat','personal_information'].includes(String(v.reason)))) return false;
  return messageReportId(v.chatId) && messageReportId(v.messageId) && (v.transactionId === null || messageReportId(v.transactionId)) && [v.previewId, v.sourceHash, v.sourceRevision].every(hash) && typeof v.reason === 'string' && !!v.reason && v.reason === v.reason.trim() && v.reason.length <= 100 && (v.description === null || typeof v.description === 'string' && !!v.description && v.description.trim() === v.description && v.description.length <= (safety?1000:2000)) && messageExposure(v.exposure) && v.acknowledged === true;
}
export function isMessageReportAttempt(v: unknown, uid: string): v is MessageReportAttempt {return record(v) && Object.keys(v).sort().join(',') === 'command,requestId,uid,version' && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' && v.requestId.length >= 16 && utf8Bytes(v.requestId) <= 128 && messageReportId(v.requestId) && command(v.command);}
export function isMessageReportSummary(v: unknown, reportId: string): v is AdminMessageReportEvidence {
  if (!record(v) || v.protocol !== 'message_report_evidence_v1' || v.reportId !== reportId || !flags(v) || v.source !== null || v.sourceCurrentQualification !== 'unknown') return false;
  return v.qualification === 'unknown' ? [v.capturedAt, v.chatId, v.messageId, v.sourceHash, v.sourceRevision, v.exposure].every(x => x === null) :
    v.qualification === 'native_capture' && iso(v.capturedAt) && messageReportId(v.chatId) && messageReportId(v.messageId) && hash(v.sourceHash) && hash(v.sourceRevision) && messageExposure(v.exposure);
}
const fail = () => new Error('Le message, la source ou le reçu exact doit être relu. L’intention conservée reste à vérifier.');
async function call(uid: string, name: string, data: unknown, assertCurrent: () => void) {const session = captureTradeSession(uid); assertCurrent(); const result = await httpsCallable<unknown, unknown>(functions, name)(data); assertTradeSessionCurrent(session); assertCurrent(); return result.data;}
export const MessageReportService = {
  async preview(uid: string, chatId: string, messageId: string, transactionId: string | null, assertCurrent: () => void, contentSafety?: {linkedReviewId:string|null}): Promise<MessageReportPreview> {
    const v = await call(uid, 'submitReport', {operation: 'previewMessageReport', capability: 'message_report_v1', expectedUid: uid, chatId, messageId, transactionId,...(contentSafety?{contentSafetyCapability:'content_safety_v1',linkedReviewId:contentSafety.linkedReviewId}:{})}, assertCurrent);
    if (!record(v) || v.protocol !== 'message_report_preview_v1' || v.actorId !== uid || !flags(v) || !record(v.source)) throw fail();
    const s = v.source;
    if (s.protocol !== 'message_report_source_v1' || s.chatId !== chatId || s.messageId !== messageId || !flags(s) || !['native_message', 'unknown'].includes(String(s.qualification)) || !nullableString(s.text) || typeof s.imagePresent !== 'boolean') throw fail();
    if (s.qualification === 'native_message') {if (![v.previewId, s.sourceHash, s.sourceRevision].every(hash) || !revision(s.messageRevision) || !revision(s.chatRevision) || !messageReportId(s.senderId) || !['text', 'image', 'offer'].includes(String(s.messageType)) || !order(s.order) || (s.order.qualification === 'native_linked_order' && s.order.transactionId !== transactionId)) throw fail();}
    else if ([v.previewId, s.sourceHash, s.sourceRevision, s.messageRevision, s.chatRevision, s.senderId, s.messageType, s.text, s.order].some(x => x !== null) || s.imagePresent !== false) throw fail();
    if(contentSafety){const c=v.contentSafety;if(!record(c)||c.capability!=='content_safety_v1'||c.linkedReviewId!==contentSafety.linkedReviewId||!(c.linkedReviewId===null?c.linkedReviewQualification==='not_requested':['native_linked_review','unknown'].includes(String(c.linkedReviewQualification))))throw fail();}
    else if(Object.prototype.hasOwnProperty.call(v,'contentSafety'))throw fail();
    return v as unknown as MessageReportPreview;
  },
  async command(a: MessageReportAttempt, mode: 'execute' | 'observe' | 'neutralize', assertCurrent: () => void): Promise<MessageReportReceipt> {
    if (!isMessageReportAttempt(a, a.uid)) throw fail();
    const v = await call(a.uid, 'submitReport', {operation: 'messageReportCommand', capability: 'message_report_v1', expectedUid: a.uid, requestId: a.requestId, mode, command: a.command,...(a.command.contentSafety?{contentSafetyCapability:'content_safety_v1'}:{})}, assertCurrent);
    const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, canonicalArticleReport(a.command)); assertCurrent();
    if (!record(v) || v.protocol !== 'message_report_command_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || !sameMessageReport(v.command, a.command) || v.payloadHash !== digest || !flags(v) || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state))) throw fail();
    if (v.state === 'unrecorded' ? [v.reason, v.reportId, v.captureId, v.captureHash, v.reportStatus, v.recordedAt].some(x => x !== null) : !iso(v.recordedAt) || (v.state === 'committed' ? !messageReportId(v.reportId) || !/^message_[a-f0-9]{64}$/.test(String(v.captureId)) || !hash(v.captureHash) || v.reason !== null || !(v.reportStatus === null || ['pending', 'reviewed', 'resolved', 'dismissed'].includes(String(v.reportStatus))) : typeof v.reason !== 'string' || !v.reason || [v.reportId, v.captureId, v.captureHash, v.reportStatus].some(x => x !== null))) throw fail();
    return v as unknown as MessageReportReceipt;
  },
  async readEvidence(uid: string, reportId: string, assertCurrent: () => void): Promise<AdminMessageReportEvidence> {
    const v = await call(uid, 'getPendingReports', {operation: 'readMessageReportEvidence', capability: 'message_report_v1', expectedUid: uid, reportId}, assertCurrent);
    if (!record(v) || v.protocol !== 'message_report_evidence_v1' || v.actorId !== uid || v.reportId !== reportId || !flags(v) || !['unknown', 'native_capture'].includes(String(v.qualification)) || !['unknown', 'same_native_source', 'changed'].includes(String(v.sourceCurrentQualification))) throw fail();
    if (v.qualification === 'unknown') {if ([v.capturedAt, v.chatId, v.messageId, v.sourceHash, v.sourceRevision, v.exposure, v.source].some(x => x !== null) || v.sourceCurrentQualification !== 'unknown') throw fail();}
    else {const s = v.source; if (!iso(v.capturedAt) || !messageReportId(v.chatId) || !messageReportId(v.messageId) || !hash(v.sourceHash) || !hash(v.sourceRevision) || !messageExposure(v.exposure) || !capturedSource(s) || s.chatId !== v.chatId || s.messageId !== v.messageId) throw fail();}
    return v as unknown as AdminMessageReportEvidence;
  },
};
