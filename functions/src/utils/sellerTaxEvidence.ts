/** Read-only fiscal-specific import. Identifier values never enter callable
 * arguments, Firestore documents, receipts or DTOs. Provisioning is external. */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {Storage} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {storage} from '../config/firebase';
import {supportHash,supportObject,supportSourceHash} from './supportRequest';
import {taxHash,taxId} from './sellerTaxLedger';

export const SELLER_TAX_EVIDENCE_LIMITS={bytes:131072,attestationBytes:32768,readTimeoutMs:7000} as const;
export const SELLER_TAX_COPY_LIMITS={bytes:5*1024*1024,contentTypes:['application/pdf','application/xml','text/xml']} as const;
export type SellerTaxEvidencePurpose='operator'|'identity'|'filing'|'delivery'|'credit_note'|'valuation'|'coverage';
export type SellerTaxEvidenceReference={artifactId:string;generation:string;contentHash:string};
export type SellerTaxEvidenceSubject={subject:'seller';ownerId:string}|{subject:'operator';ownerId:null};
const purposes=['operator','identity','filing','delivery','credit_note','valuation','coverage'];
const unavailable=()=>new HttpsError('failed-precondition','Le coffre fiscal privé et son accès indépendant doivent être qualifiés.');
const principal=(s:unknown):s is string=>typeof s==='string'&&/^(?:serviceAccount|user):[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/.test(s);
const generation=(s:unknown):s is string=>typeof s==='string'&&/^\d{1,30}$/.test(s);
const bucketName=(s:unknown):s is string=>typeof s==='string'&&/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(s);
const nativeSize=(s:unknown)=>typeof s==='string'&&/^\d+$/.test(s)?Number(s):typeof s==='number'?s:NaN;
const instant=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const keyBase=(s:unknown)=>typeof s==='string'&&/^projects\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+(?:\/cryptoKeyVersions\/\d+)?$/.test(s)?s.replace(/\/cryptoKeyVersions\/\d+$/,''):null;
export function parseSellerTaxEvidenceReference(raw:unknown):SellerTaxEvidenceReference{
  const r=supportObject(raw,['artifactId','generation','contentHash']);if(!taxHash(r.artifactId)||!generation(r.generation)||!taxHash(r.contentHash))throw new HttpsError('invalid-argument','Référence native de pièce fiscale requise.');
  return {artifactId:r.artifactId,generation:r.generation,contentHash:r.contentHash};
}
function configuration(){
  let c:Record<string,any>;try{c=supportObject(JSON.parse(process.env.SELLER_TAX_VAULT_ATTESTATION??''),['bucket','path','generation','contentHash','issuerPrincipal','keyVersion','publicKeyPem','applicationPrincipal']);}catch{throw unavailable();}
  const name=process.env.SELLER_TAX_EVIDENCE_BUCKET?.trim(),kmsKey=process.env.SELLER_TAX_EVIDENCE_KMS_KEY?.trim();
  if(!bucketName(name)||name===storage.bucket().name||!keyBase(kmsKey)||kmsKey!==keyBase(kmsKey)||!bucketName(c.bucket)||
    typeof c.path!=='string'||!/^vault_access\/[a-f0-9]{64}\.json$/.test(c.path)||!generation(c.generation)||!taxHash(c.contentHash)||
    !principal(c.issuerPrincipal)||!principal(c.applicationPrincipal)||c.issuerPrincipal===c.applicationPrincipal||!keyBase(c.keyVersion)||
    !/\/cryptoKeyVersions\/\d+$/.test(c.keyVersion)||typeof c.publicKeyPem!=='string'||c.publicKeyPem.length>8192)throw unavailable();
  let key;try{key=createPublicKey(c.publicKeyPem);}catch{throw unavailable();}
  if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw unavailable();
  return {name,kmsKey,attestation:c,key};
}
function json(bytes:Buffer){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw unavailable();}}
function iam(policy:any){
  if(!policy||typeof policy.etag!=='string'||!policy.etag||!Array.isArray(policy.bindings)||policy.bindings.length>100)throw unavailable();
  const bindings=policy.bindings.map((b:any)=>{if(typeof b.role!=='string'||b.condition!=null||!Array.isArray(b.members)||b.members.length>100||b.members.some((m:any)=>!principal(m)))throw unavailable();
    return {role:b.role,members:[...b.members].sort()};}).sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {version:policy.version??1,etag:policy.etag,bindings};
}
async function bucketAccess(bucket:ReturnType<Storage['bucket']>,guard:()=>Promise<unknown>){
  await guard();const [m]=await bucket.getMetadata();await guard();const [p]=await bucket.iam.getPolicy({requestedPolicyVersion:3});await guard();
  if(m.name!==bucket.name||!generation(String(m.metageneration??''))||!/^\d+$/.test(String(m.projectNumber??''))||
    m.iamConfiguration?.publicAccessPrevention!=='enforced'||m.iamConfiguration?.uniformBucketLevelAccess?.enabled!==true)throw unavailable();
  const policy=iam(p);return {bucket:bucket.name,projectNumber:String(m.projectNumber),bucketMetageneration:String(m.metageneration),bucketIamHash:supportSourceHash(policy),policy};
}
async function accessAttestation(reader:Storage,c:ReturnType<typeof configuration>,access:Awaited<ReturnType<typeof bucketAccess>>,guard:()=>Promise<unknown>){
  const r=c.attestation,f=reader.bucket(r.bucket).file(r.path,{generation:r.generation});await guard();const [m]=await f.getMetadata();await guard();
  if(m.bucket!==r.bucket||m.name!==r.path||String(m.generation)!==r.generation||m.contentType!=='application/json'||!Number.isSafeInteger(nativeSize(m.size))||
    nativeSize(m.size)<2||nativeSize(m.size)>SELLER_TAX_EVIDENCE_LIMITS.attestationBytes||typeof m.crc32c!=='string'||!m.crc32c)throw unavailable();
  const [bytes]=await f.download({validation:'crc32c',decompress:false});await guard();if(bytes.length!==nativeSize(m.size)||createHash('sha256').update(bytes).digest('hex')!==r.contentHash)throw unavailable();
  const envelope=supportObject(json(bytes),['manifest','signature']),a=supportObject(envelope.manifest,['protocol','bucket','projectNumber','bucketMetageneration','bucketIamHash','authorizedPrincipals',
    'applicationPrincipal','issuerPrincipal','keyVersion','issuedAt','expiresAt','inheritedEffectiveAccessReview']);
  if(typeof envelope.signature!=='string'||! /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature)||Buffer.from(envelope.signature,'base64').toString('base64')!==envelope.signature||
    !verify('sha256',Buffer.from(supportSourceHash(a),'utf8'),c.key,Buffer.from(envelope.signature,'base64'))||a.protocol!=='seller_tax_vault_access_v1'||
    a.bucket!==access.bucket||a.projectNumber!==access.projectNumber||a.bucketMetageneration!==access.bucketMetageneration||a.bucketIamHash!==access.bucketIamHash||
    a.issuerPrincipal!==r.issuerPrincipal||a.keyVersion!==r.keyVersion||a.applicationPrincipal!==r.applicationPrincipal||!instant(a.issuedAt)||!instant(a.expiresAt)||
    Date.parse(a.issuedAt)>Date.now()||Date.parse(a.expiresAt)<=Date.now()||Date.parse(a.expiresAt)<=Date.parse(a.issuedAt)||!Array.isArray(a.authorizedPrincipals)||
    !a.authorizedPrincipals.length||a.authorizedPrincipals.length>100||a.authorizedPrincipals.some((p:any)=>!principal(p))||new Set(a.authorizedPrincipals).size!==a.authorizedPrincipals.length||
    !a.authorizedPrincipals.includes(r.applicationPrincipal)||access.policy.bindings.some((b:any)=>b.members.some((p:any)=>!a.authorizedPrincipals.includes(p))))throw unavailable();
  const review=supportObject(a.inheritedEffectiveAccessReview,['resource','permissions','approvedPrincipals','reviewedAt','hierarchyEvidenceHash','signingAuthorityEvidenceHash']);
  if(review.resource!==`//storage.googleapis.com/projects/_/buckets/${c.name}`||supportHash(review.permissions)!==supportHash(['storage.objects.get'])||
    !Array.isArray(review.approvedPrincipals)||supportHash([...review.approvedPrincipals].sort())!==supportHash([...a.authorizedPrincipals].sort())||!instant(review.reviewedAt)||
    Date.parse(review.reviewedAt)>Date.parse(a.issuedAt)||!taxHash(review.hierarchyEvidenceHash)||!taxHash(review.signingAuthorityEvidenceHash))throw unavailable();
  return {protocol:'seller_tax_vault_access_proof_v1',accessBasis:'independent_qualified_attestation',bucket:c.name,projectNumber:access.projectNumber,
    bucketMetageneration:access.bucketMetageneration,bucketIamHash:access.bucketIamHash,attestationReference:{bucket:r.bucket,path:r.path,generation:r.generation,contentHash:r.contentHash},
    issuerPrincipal:r.issuerPrincipal,keyVersion:r.keyVersion,publicKeyHash:createHash('sha256').update(c.key.export({type:'spki',format:'der'})).digest('hex'),
    issuedAt:a.issuedAt,expiresAt:a.expiresAt,runtimeEffectiveIamVerified:false,runtimeSigningAuthorityVerified:false};
}
export async function observeSellerTaxEvidence(target:SellerTaxEvidenceSubject,year:number,purpose:SellerTaxEvidencePurpose,reference:SellerTaxEvidenceReference,
  authorize:()=>Promise<unknown>,historicalProof?:FirebaseFirestore.DocumentData|null){
  const deadline=Date.now()+25000,guard=async()=>{if(Date.now()>deadline)throw new HttpsError('deadline-exceeded','Lecture fiscale à reprendre.');await authorize();if(Date.now()>deadline)throw new HttpsError('deadline-exceeded','Lecture fiscale à reprendre.');};
  if(!target||!['seller','operator'].includes(target.subject)||(target.subject==='seller'?!taxId(target.ownerId):target.ownerId!==null)||
    !Number.isInteger(year)||year<2024||year>2200||!purposes.includes(purpose)||target.subject==='operator'&&purpose!=='operator')throw new HttpsError('invalid-argument','Portée de pièce fiscale invalide.');
  const c=configuration(),reader=new Storage({timeout:SELLER_TAX_EVIDENCE_LIMITS.readTimeoutMs,retryOptions:{autoRetry:false,maxRetries:0}}),bucket=reader.bucket(c.name),
    path=`private_tax_evidence/${supportHash([target.subject,target.ownerId,year])}/${purpose}/${reference.artifactId}.json`,file=bucket.file(path,{generation:reference.generation});
  if(historicalProof&&(historicalProof.protocol!=='seller_tax_evidence_proof_v1'||historicalProof.subject!==target.subject||historicalProof.ownerId!==target.ownerId||historicalProof.year!==year||
    historicalProof.purpose!==purpose||supportHash(historicalProof.reference)!==supportHash(reference)||historicalProof.bucket!==c.name||historicalProof.path!==path))throw unavailable();
  const access=await bucketAccess(bucket,guard),accessProof=await accessAttestation(reader,c,access,guard);
  await guard();const [metadata]=await file.getMetadata();await guard();const size=nativeSize(metadata.size),expectedKey=historicalProof?.kmsKeyName??c.kmsKey;
  if(metadata.bucket!==bucket.name||metadata.name!==path||String(metadata.generation)!==reference.generation||!keyBase(metadata.kmsKeyName)||keyBase(metadata.kmsKeyName)!==keyBase(expectedKey)||
    historicalProof&&metadata.kmsKeyName!==expectedKey||metadata.contentType!=='application/json'||!Number.isSafeInteger(size)||size<2||size>SELLER_TAX_EVIDENCE_LIMITS.bytes||
    typeof metadata.crc32c!=='string'||!metadata.crc32c||metadata.metadata?.firebaseStorageDownloadTokens!=null)throw unavailable();
  const [bytes]=await file.download({validation:'crc32c',decompress:false});await guard();
  if(bytes.byteLength!==size||createHash('sha256').update(bytes).digest('hex')!==reference.contentHash)throw unavailable();
  const [again]=await file.getMetadata();await guard();const after=await bucketAccess(bucket,guard);
  if(String(again.generation)!==reference.generation||again.crc32c!==metadata.crc32c||String(again.size)!==String(metadata.size)||again.kmsKeyName!==metadata.kmsKeyName||
    again.contentType!==metadata.contentType||again.metadata?.firebaseStorageDownloadTokens!=null||supportHash(after)!==supportHash(access)||Date.parse(accessProof.expiresAt)<=Date.now())throw unavailable();
  const envelope=supportObject(json(bytes),['protocol','subject','ownerId','year','purpose','issuedAt','payload']);
  if(envelope.protocol!=='seller_tax_evidence_v1'||envelope.subject!==target.subject||envelope.ownerId!==target.ownerId||envelope.year!==year||envelope.purpose!==purpose||!instant(envelope.issuedAt)||
    Date.parse(envelope.issuedAt)>Date.now()||!envelope.payload||typeof envelope.payload!=='object'||Array.isArray(envelope.payload))throw unavailable();
  const proof={protocol:'seller_tax_evidence_proof_v1',subject:target.subject,ownerId:target.ownerId,year,purpose,reference,bucket:c.name,path,generation:reference.generation,
    contentHash:reference.contentHash,sizeBytes:size,crc32c:metadata.crc32c,kmsKeyName:metadata.kmsKeyName,issuedAt:envelope.issuedAt,observedAt:Timestamp.now(),accessProof,
    externalAuthenticityVerified:false,authorityFilingVerified:false};
  return {proof,payload:envelope.payload};
}
export type SellerTaxCopyBinding={ownerId:string;year:number;nativeDeclarationHash:string;documentReferenceId:string;filingReferenceHash:string;deliveredFileHash:string};
export type SellerTaxCreditNoteBinding={ownerId:string;year:number;transactionId:string;refundIntentId:string;nativeSourceHash:string;
  originalInvoiceReferenceHash:string;issuedAt:string;gstCents:number;qstCents:number;buyerFeeCents:number};
/** This descriptor can ONLY originate in the private imported delivery piece.
 * The independent signer attests the individualization policy/content binding;
 * neither MIME nor a client 'single_seller' flag establishes it. */
export function qualifySellerTaxCopy(raw:unknown,binding:SellerTaxCopyBinding){
  const d=supportObject(raw,['artifactId','generation','contentHash','contentType','sizeBytes','individualization']),i=supportObject(d.individualization,['manifest','signature']),
    m=supportObject(i.manifest,['protocol','ownerId','year','nativeDeclarationHash','documentReferenceId','filingReferenceHash','deliveredFileHash','artifactId','generation','contentType','sizeBytes','issuedAt','issuerPrincipal','keyVersion','policyVersion']);
  let authority:Data;try{authority=supportObject(JSON.parse(process.env.SELLER_TAX_COPY_BINDING_AUTHORITY??''),['issuerPrincipal','keyVersion','publicKeyPem','policyVersion']);}catch{throw unavailable();}
  const vault=configuration();if(typeof authority.publicKeyPem!=='string'||authority.publicKeyPem.length>8192)throw unavailable();let key;try{key=createPublicKey(authority.publicKeyPem);}catch{throw unavailable();}
  if(!principal(authority.issuerPrincipal)||authority.issuerPrincipal===vault.attestation.applicationPrincipal||authority.policyVersion!=='individual_seller_copy_v1'||
    !keyBase(authority.keyVersion)||!/\/cryptoKeyVersions\/\d+$/.test(authority.keyVersion)||key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048||
    !taxHash(d.artifactId)||!generation(d.generation)||!taxHash(d.contentHash)||d.contentHash!==binding.deliveredFileHash||
    !(SELLER_TAX_COPY_LIMITS.contentTypes as readonly string[]).includes(d.contentType)||!Number.isSafeInteger(d.sizeBytes)||d.sizeBytes<=0||d.sizeBytes>SELLER_TAX_COPY_LIMITS.bytes||
    m.protocol!=='seller_tax_single_copy_binding_v1'||Object.entries(binding).some(([k,v])=>m[k]!==v)||
    ['artifactId','generation','contentType','sizeBytes'].some(k=>m[k]!==d[k])||m.issuerPrincipal!==authority.issuerPrincipal||m.keyVersion!==authority.keyVersion||m.policyVersion!==authority.policyVersion||
    !instant(m.issuedAt)||Date.parse(m.issuedAt)>Date.now()||typeof i.signature!=='string'||i.signature.length>12000||! /^[A-Za-z0-9+/]+={0,2}$/.test(i.signature)||
    Buffer.from(i.signature,'base64').toString('base64')!==i.signature||!verify('sha256',Buffer.from(supportSourceHash(m),'utf8'),key,Buffer.from(i.signature,'base64')))throw unavailable();
  return {artifactId:d.artifactId as string,generation:d.generation as string,contentHash:d.contentHash as string,contentType:d.contentType as string,sizeBytes:d.sizeBytes as number,
    individualization:{manifest:m,signature:i.signature as string},bindingHash:supportSourceHash(m),individualizationBasis:'independent_qualified_attestation',
    legalAuthenticityVerified:false,runtimeSigningAuthorityVerified:false};
}
type Data=FirebaseFirestore.DocumentData;
/** The signed source is the immutable native refund/note tuple, never a hash
 * of the document containing this signature. Old imported JSON is not a file. */
export function qualifySellerTaxCreditNoteFile(raw:unknown,binding:SellerTaxCreditNoteBinding){
  const d=supportObject(raw,['artifactId','generation','contentHash','contentType','sizeBytes','individualization']),i=supportObject(d.individualization,['manifest','signature']),
    m=supportObject(i.manifest,['protocol','ownerId','year','transactionId','refundIntentId','nativeSourceHash','originalInvoiceReferenceHash','issuedAt','gstCents','qstCents','buyerFeeCents',
      'fileContentHash','artifactId','generation','contentType','sizeBytes','attestedAt','issuerPrincipal','keyVersion','policyVersion']);
  let authority:Data;try{authority=supportObject(JSON.parse(process.env.SELLER_TAX_CREDIT_NOTE_BINDING_AUTHORITY??''),['issuerPrincipal','keyVersion','publicKeyPem','policyVersion']);}catch{throw unavailable();}
  const vault=configuration();if(typeof authority.publicKeyPem!=='string'||authority.publicKeyPem.length>8192)throw unavailable();let key;try{key=createPublicKey(authority.publicKeyPem);}catch{throw unavailable();}
  if(!principal(authority.issuerPrincipal)||authority.issuerPrincipal===vault.attestation.applicationPrincipal||authority.policyVersion!=='individual_buyer_credit_note_v1'||
    !keyBase(authority.keyVersion)||!/\/cryptoKeyVersions\/\d+$/.test(authority.keyVersion)||key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048||
    !taxHash(d.artifactId)||!generation(d.generation)||!taxHash(d.contentHash)||m.fileContentHash!==d.contentHash||
    !(SELLER_TAX_COPY_LIMITS.contentTypes as readonly string[]).includes(d.contentType)||!Number.isSafeInteger(d.sizeBytes)||d.sizeBytes<=0||d.sizeBytes>SELLER_TAX_COPY_LIMITS.bytes||
    m.protocol!=='seller_tax_single_credit_note_binding_v1'||Object.entries(binding).some(([k,v])=>m[k]!==v)||
    ['artifactId','generation','contentType','sizeBytes'].some(k=>m[k]!==d[k])||m.issuerPrincipal!==authority.issuerPrincipal||m.keyVersion!==authority.keyVersion||m.policyVersion!==authority.policyVersion||
    !instant(m.attestedAt)||Date.parse(m.attestedAt)>Date.now()||typeof i.signature!=='string'||i.signature.length>12000||! /^[A-Za-z0-9+/]+={0,2}$/.test(i.signature)||
    Buffer.from(i.signature,'base64').toString('base64')!==i.signature||!verify('sha256',Buffer.from(supportSourceHash(m),'utf8'),key,Buffer.from(i.signature,'base64')))throw unavailable();
  return {artifactId:d.artifactId as string,generation:d.generation as string,contentHash:d.contentHash as string,contentType:d.contentType as string,sizeBytes:d.sizeBytes as number,
    individualization:{manifest:m,signature:i.signature as string},individualizationBasis:'independent_qualified_attestation',legalAuthenticityVerified:false};
}
/** Explicit owner-only read; the caller repeatedly qualifies the exact native
 * delivery/declaration/filing and current recent session. No URL is returned. */
export async function readSellerTaxPrivateCopy(raw:unknown,binding:SellerTaxCopyBinding,authorize:()=>Promise<unknown>){
  const d=qualifySellerTaxCopy(raw,binding);
  return readIndividualFile(d,`private_tax_copies/${supportHash(['seller',binding.ownerId,binding.year])}`,()=>qualifySellerTaxCopy(raw,binding),authorize);
}
export async function readSellerTaxPrivateCreditNote(raw:unknown,binding:SellerTaxCreditNoteBinding,authorize:()=>Promise<unknown>){
  const d=qualifySellerTaxCreditNoteFile(raw,binding);
  return readIndividualFile(d,`private_tax_credit_notes/${supportHash(['buyer',binding.ownerId,binding.year,binding.transactionId,binding.refundIntentId])}`,
    ()=>qualifySellerTaxCreditNoteFile(raw,binding),authorize);
}
async function readIndividualFile(d:{artifactId:string;generation:string;contentHash:string;contentType:string;sizeBytes:number},prefix:string,requalify:()=>unknown,authorize:()=>Promise<unknown>){
  const c=configuration(),deadline=Date.now()+25000,
    guard=async()=>{if(Date.now()>deadline)throw new HttpsError('deadline-exceeded','Lecture de copie fiscale à reprendre.');await authorize();if(Date.now()>deadline)throw new HttpsError('deadline-exceeded','Lecture de copie fiscale à reprendre.');};
  const reader=new Storage({timeout:SELLER_TAX_EVIDENCE_LIMITS.readTimeoutMs,retryOptions:{autoRetry:false,maxRetries:0}}),bucket=reader.bucket(c.name),
    extension=d.contentType==='application/pdf'?'pdf':'xml',path=`${prefix}/${d.artifactId}.${extension}`,file=bucket.file(path,{generation:d.generation});
  const access=await bucketAccess(bucket,guard),accessProof=await accessAttestation(reader,c,access,guard);
  await guard();const [m]=await file.getMetadata();await guard();
  if(m.bucket!==c.name||m.name!==path||String(m.generation)!==d.generation||m.contentType!==d.contentType||nativeSize(m.size)!==d.sizeBytes||!keyBase(m.kmsKeyName)||
    keyBase(m.kmsKeyName)!==c.kmsKey||typeof m.crc32c!=='string'||!m.crc32c||m.metadata?.firebaseStorageDownloadTokens!=null)throw unavailable();
  const [bytes]=await file.download({validation:'crc32c',decompress:false});await guard();
  if(bytes.length!==d.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==d.contentHash)throw unavailable();
  const [after]=await file.getMetadata();await guard();const currentAccess=await bucketAccess(bucket,guard);
  if(String(after.generation)!==d.generation||String(after.size)!==String(m.size)||after.contentType!==m.contentType||after.crc32c!==m.crc32c||after.kmsKeyName!==m.kmsKeyName||
    after.metadata?.firebaseStorageDownloadTokens!=null||supportHash(currentAccess)!==supportHash(access)||Date.parse(accessProof.expiresAt)<=Date.now())throw unavailable();
  // Requalify signing configuration and original binding too, before pixels.
  requalify();await guard();
  return {file:{contentHash:d.contentHash,generation:d.generation,contentType:d.contentType,sizeBytes:d.sizeBytes},dataBase64:bytes.toString('base64'),
    individualizationBasis:'independent_qualified_attestation',legalAuthenticityVerified:false,deviceReadVerified:false};
}
