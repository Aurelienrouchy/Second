import {Timestamp} from 'firebase-admin/firestore';
import {articlePrivacyHash,privacyMarker} from './articlePrivacyContract';
import {accountErasureSourceHash} from './accountErasureContract';
type Data=FirebaseFirestore.DocumentData;
export function disposedArticleEvidence(value:Data|undefined):boolean{
  if(!value||Object.keys(value).sort().join(',')!==
    'accountErasureDisposition,articleId,completedAt,createdAt,operationId,ownerId,payloadHash,protocol,requestId,schemaVersion,sourceSnapshotHash,sourceUpdatedAt,state,updatedAt')return false;
  const d=value.accountErasureDisposition;
  return value.schemaVersion===2&&value.protocol==='article_privacy_disposed_v1'&&value.state==='disposed'&&
    typeof value.ownerId==='string'&&value.ownerId.length>0&&value.operationId===articlePrivacyHash([value.ownerId,value.articleId,value.requestId])&&
    value.payloadHash===articlePrivacyHash([value.ownerId,value.articleId,value.requestId,'withdraw_public'])&&
    /^[a-f0-9]{64}$/.test(value.sourceSnapshotHash??'')&&value.sourceUpdatedAt instanceof Timestamp&&
    value.createdAt instanceof Timestamp&&value.updatedAt instanceof Timestamp&&value.completedAt instanceof Timestamp&&
    d&&Object.keys(d).sort().join(',')==='commandId,disposedAt,originalEvidenceHash'&&/^[a-f0-9]{64}$/.test(d.commandId??'')&&
    /^[a-f0-9]{64}$/.test(d.originalEvidenceHash??'')&&d.disposedAt instanceof Timestamp&&d.disposedAt.isEqual(value.updatedAt);
}
export function minimizeDisposedArticleEvidence(before:Data,commandId:string,disposedAt:Timestamp):Data{
  if(before.schemaVersion!==1||before.state!=='completed'||!before.assetScanComplete||!before.contractCaptureComplete||
    !before.publicProjectionScanComplete||before.promotionPending!==false||!Array.isArray(before.media)||
    before.media.some((m:any)=>m.state!=='revoked')||!privacyMarker({schemaVersion:1,articleId:before.articleId,
      operationId:before.operationId,withdrawnAt:before.createdAt})||!/^[a-f0-9]{64}$/.test(commandId))throw new Error('Article disposal source unqualified.');
  return {schemaVersion:2,protocol:'article_privacy_disposed_v1',state:'disposed',ownerId:before.ownerId,articleId:before.articleId,
    requestId:before.requestId,operationId:before.operationId,payloadHash:before.payloadHash,sourceSnapshotHash:before.sourceSnapshotHash,
    sourceUpdatedAt:before.sourceUpdatedAt,createdAt:before.createdAt,completedAt:before.completedAt,updatedAt:disposedAt,
    accountErasureDisposition:{commandId,disposedAt,originalEvidenceHash:accountErasureSourceHash(before)}};
}
