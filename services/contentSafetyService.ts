import {CryptoDigestAlgorithm, digestStringAsync} from 'expo-crypto';
import {phase1HttpsCallable as httpsCallable} from '@/services/phase1Callable';
import {functions} from '@/config/firebaseConfig';
import {canonicalArticleReport} from '@/services/articleReportJournal';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {messageReportId} from '@/services/messageReportService';
import type {ContentAttempt, ContentCommand, ContentDecisionReference, ContentEntry, ContentOriginalFile, ContentPreview, ContentReceipt, ContentSafetySelection} from '@/types/contentSafety';
export const contentRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const text = (v: unknown, max: number) => typeof v === 'string' && !!v && v.trim() === v && v.length <= max;
const reasons = ['review_pressure', 'refund_pressure', 'threat', 'personal_information'];
const actions = ['report', 'contest', 'maintain', 'hide', 'restore'];
const flags = (v: Record<string, unknown>) => ['refundAuthorized', 'banAuthorized', 'faultEstablished', 'physicalReceiptVerified', 'deliveredCopiesErasureVerified'].every(k => v[k] === false) && v.bearerUrlRevocation === 'unknown';
const media = (v: unknown) => contentRecord(v) && v.protocol==='content_media_withdrawal_view_v1' && ['not_required','pending','unknown','needs_review','observed_revoked'].includes(String(v.state)) &&
  [v.managedObjectCount,v.privatelyPreservedCount,v.revokedObjectCount].every(x=>x===null||Number.isSafeInteger(x)&&Number(x)>=0)&&['native_managed_only','unknown_or_external','unknown'].includes(String(v.referenceCoverage))&&
  (v.observedAt===null||iso(v.observedAt))&&v.priorBearerAccessRestored===false&&v.externalUrlsWithdrawalVerified===false&&v.deliveredCopiesErasureVerified===false;
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');
export const sameContentSafety = (a: unknown, b: unknown) => canonicalArticleReport(a) === canonicalArticleReport(b);
export function contentReference(v: unknown): v is ContentDecisionReference {return contentRecord(v) && exact(v, ['id','contentHash','version']) && /^cd_[a-f0-9]{64}$/.test(String(v.id)) && hash(v.contentHash) && Number.isSafeInteger(v.version) && Number(v.version) > 0;}
export function contentCommand(v: unknown): v is ContentCommand {
  if (!contentRecord(v) || !exact(v, ['targetType','targetId','scope','action','reportId','sourceHash','previewId','reason','description','urgency','privateNote','ownerMessage','decisionReference','acknowledged','ratingAloneIsNotRemovalGround']) ||
    !['review','message'].includes(String(v.targetType)) || !messageReportId(v.targetId) || !['own','admin'].includes(String(v.scope)) || !actions.includes(String(v.action)) ||
    !hash(v.sourceHash) || !hash(v.previewId) || !reasons.includes(String(v.reason)) || !['yes','no','unknown'].includes(String(v.urgency)) ||
    !(v.description === null || text(v.description,1000)) || v.acknowledged !== true || v.ratingAloneIsNotRemovalGround !== true) return false;
  if (v.action === 'report' ? v.targetType !== 'review' || v.reportId !== null : !messageReportId(v.reportId)) return false;
  if (v.action === 'contest' ? !contentReference(v.decisionReference) : v.decisionReference !== null) return false;
  return v.scope === 'own' ? ['report','contest'].includes(String(v.action)) && v.privateNote === null && v.ownerMessage === null :
    ['maintain','hide','restore'].includes(String(v.action)) && text(v.privateNote,4000) && text(v.ownerMessage,2000);
}
export function contentAttempt(v: unknown, uid: string): v is ContentAttempt {return contentRecord(v) && exact(v, ['version','uid','requestId','command']) && v.version === 1 && v.uid === uid && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && contentCommand(v.command);}
function entry(v: unknown): v is ContentEntry {return contentRecord(v) && contentReference(v.reference) && actions.includes(String(v.action)) && reasons.includes(String(v.reason)) && ['yes','no','unknown'].includes(String(v.urgency)) &&
  [v.description,v.ownerMessage,v.privateNote].every(nullableText) && (v.relatedDecision === null || contentReference(v.relatedDecision)) && ['hidden','visible'].includes(String(v.visibilityAtCommit)) && iso(v.recordedAt) && v.historicalOnly === true && flags(v);}
const fail = () => new Error('Les références de contenu, la source ou le reçu exact doivent être relus.');
async function call(uid: string, scope: 'own'|'admin', data: unknown, current: () => void) {const session = captureTradeSession(uid); current(); const r = await httpsCallable<unknown,unknown>(functions, scope === 'own' ? 'submitReport' : 'triageReport')(data); assertTradeSessionCurrent(session); current(); return r.data;}
function parsePreview(v: unknown, uid: string, scope: 'own'|'admin', selection: ContentSafetySelection, history: boolean): ContentPreview {
  if (!contentRecord(v) || v.protocol !== (history ? 'content_moderation_history_v1' : 'content_moderation_preview_v1') || v.actorId !== uid || v.scope !== scope || v.targetType !== selection.targetType || v.targetId !== selection.targetId || v.reportId !== selection.reportId || !hash(v.previewId) || !flags(v) || !media(v.mediaWithdrawal) || !contentRecord(v.source)) throw fail();
  const s = v.source;
  if (s.protocol !== 'content_moderation_source_v1' || s.targetType !== selection.targetType || s.targetId !== selection.targetId || s.reportId !== selection.reportId || !['native_content','unknown'].includes(String(s.qualification)) ||
    ![s.sourceHash,s.reportHash,s.contentHash,s.caseHash].every(hash) || ![s.reportRevision,s.contentRevision].every(nullableText) || !(s.originalHash === null || hash(s.originalHash)) || !(s.caseVersion === null || Number.isSafeInteger(s.caseVersion) && Number(s.caseVersion) >= 0) ||
    !Array.isArray(s.parties) || !s.parties.every(messageReportId) || (s.parent !== null && (!contentRecord(s.parent) || !['chat','order','swap'].includes(String(s.parent.kind)) || !messageReportId(s.parent.id) || typeof s.parent.revision !== 'string'))) throw fail();
  if (s.qualification === 'native_content' && (s.parties.length !== 2 || new Set(s.parties).size !== 2 || !s.parent || scope === 'own' && !s.parties.includes(uid))) throw fail();
  if (![v.current,v.original,v.messageEvidence].every(x => x === null || contentRecord(x)) || scope === 'own' && (v.original !== null || v.messageEvidence !== null || v.reportEvidence !== null) ||
    !(v.currentDecision === null || entry(v.currentDecision)) || !Array.isArray(v.options) || !v.options.every(a => (scope === 'own' ? ['report','contest'] : ['maintain','hide','restore']).includes(String(a))) || s.qualification !== 'native_content' && v.options.length > 0) throw fail();
  if (v.report !== null && (!contentRecord(v.report) || ![v.report.reason,v.report.description,v.report.status].every(nullableText) || !['yes','no','unknown'].includes(String(v.report.urgency)))) throw fail();
  if (v.reportEvidence !== null && (!contentRecord(v.reportEvidence) || v.reportEvidence.qualification !== 'native_report_capture' || !contentRecord(v.reportEvidence.body) || !hash(v.reportEvidence.sourceHash) || !iso(v.reportEvidence.recordedAt))) throw fail();
  if (selection.decisionReference && (!contentRecord(v.selectedDecision) || v.selectedDecision.qualification !== 'native_addressed_entry' || !entry(v.selectedDecision.entry) || !sameContentSafety(v.selectedDecision.entry.reference,selection.decisionReference))) throw fail();
  if (!Array.isArray(v.entries) || v.entries.length > 20 || !v.entries.every(e => contentRecord(e) && (e.qualification === 'native_content_entry' ? entry(e.entry) : e.qualification === 'unknown' && messageReportId(e.entryId) && e.entry === null))) throw fail();
  if (history) {const c = v.coverage; if (!contentRecord(c) || !Number.isSafeInteger(c.inspected) || Number(c.inspected) < v.entries.length || Number(c.inspected) > 20 || c.limit !== 20 || typeof c.hasMore !== 'boolean' || c.exhaustiveHistoryVerified !== false ||
      (c.hasMore ? !contentRecord(v.nextCursor) || !messageReportId(v.nextCursor.lastId) || c.inspected !== 20 : v.nextCursor !== null)) throw fail();}
  else if (v.coverage !== null || v.nextCursor !== null || v.entries.length !== 0) throw fail();
  return v as unknown as ContentPreview;
}
export const ContentSafetyService = {
  async preview(uid: string, scope: 'own'|'admin', selection: ContentSafetySelection, current: () => void, cursor?: {lastId: string} | null): Promise<ContentPreview> {
    const history = cursor !== undefined;
    return parsePreview(await call(uid,scope,{operation: history ? 'contentModerationHistory' : 'contentModerationPreview',capability:'content_safety_v1',expectedUid:uid,scope,...selection,...(history ? {cursor} : {})},current),uid,scope,selection,history);
  },
  async command(a: ContentAttempt, mode: 'execute'|'observe'|'neutralize', current: () => void): Promise<ContentReceipt> {
    if (!contentAttempt(a,a.uid)) throw fail();
    const v = await call(a.uid,a.command.scope,{operation:'contentModerationCommand',capability:'content_safety_v1',expectedUid:a.uid,requestId:a.requestId,mode,command:a.command},current);
    const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256,canonicalArticleReport(a.command)); current();
    if (!contentRecord(v) || v.protocol !== 'content_moderation_command_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || !sameContentSafety(v.command,a.command) || v.payloadHash !== digest || !flags(v) || !media(v.mediaWithdrawal) || !['unrecorded','committed','not_executed'].includes(String(v.state)) || typeof v.documentNeutralizedAtCommit !== 'boolean' || typeof v.storageSdkRestrictionAtCommit !== 'boolean') throw fail();
    if (v.state === 'unrecorded' ? [v.reason,v.reportId,v.caseId,v.entryId,v.entryReference,v.recordedAt].some(x => x !== null) : !iso(v.recordedAt) || (v.state === 'committed' ? v.reason !== null || !messageReportId(v.reportId) || !/^cm_[a-f0-9]{64}$/.test(String(v.caseId)) || !contentReference(v.entryReference) || v.entryId !== v.entryReference.id : typeof v.reason !== 'string' || !v.reason || [v.reportId,v.caseId,v.entryId,v.entryReference].some(x => x !== null))) throw fail();
    if (v.state !== 'committed' && (v.documentNeutralizedAtCommit !== false || v.storageSdkRestrictionAtCommit !== false)) throw fail();
    return v as unknown as ContentReceipt;
  },
  async originalFile(uid: string, selection: ContentSafetySelection, sourceHash: string, fileKind: 'image'|'thumbnail', current: () => void): Promise<ContentOriginalFile> {
    const v = await call(uid,'admin',{operation:'readContentOriginalFile',capability:'content_safety_v1',expectedUid:uid,scope:'admin',...selection,fileKind},current);
    if (!contentRecord(v) || v.protocol !== 'content_original_file_v1' || v.actorId !== uid || v.targetType !== selection.targetType || v.targetId !== selection.targetId || v.reportId !== selection.reportId || v.sourceHash !== sourceHash || !/^\d+$/.test(String(v.generation)) || !hash(v.sha256) || !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(String(v.contentType)) || typeof v.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.base64) || v.base64.length > 2_796_204 || !(v.crc32c === null || typeof v.crc32c === 'string') || v.originalAtReportTimeVerified !== false || v.physicalContentVerified !== false || !flags(v)) throw fail();
    return v as unknown as ContentOriginalFile;
  }
};
/** Only native addressed proof permits opening an exact historical decision. */
export async function contentSafetyNotificationContext(data: unknown,uid: string,current: () => void): Promise<ContentSafetySelection|null> {
  current();if(!contentRecord(data)||data.ownerId!==uid||data.contentSafetyCapability!=='content_safety_v1'||!['review','message'].includes(String(data.contentTargetType))||!messageReportId(data.contentTargetId)||!messageReportId(data.reportId)||
    !/^cm_[a-f0-9]{64}$/.test(String(data.contentCaseId))||typeof data.contentEntryVersion!=='string'||!/^[1-9]\d*$/.test(data.contentEntryVersion))return null;
  const reference={id:data.contentEntryId,contentHash:data.contentEntryHash,version:Number(data.contentEntryVersion)};if(!contentReference(reference)||String(reference.version)!==data.contentEntryVersion)return null;
  const targetType=data.contentTargetType as 'review'|'message',caseHash=await digestStringAsync(CryptoDigestAlgorithm.SHA256,canonicalArticleReport([targetType,data.contentTargetId]));current();
  if(data.contentCaseId!==`cm_${caseHash}`)return null;
  const selection:ContentSafetySelection={targetType,targetId:data.contentTargetId,reportId:data.reportId,decisionReference:reference};
  const proof=await ContentSafetyService.preview(uid,'own',selection,current);current();
  return proof.selectedDecision?.qualification==='native_addressed_entry'&&sameContentSafety(proof.selectedDecision.entry.reference,reference)?selection:null;
}
