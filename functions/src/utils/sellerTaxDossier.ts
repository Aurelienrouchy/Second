/** Annual private fiscal workpapers and imported acts. A preparation, an
 * assessment, a real receipt artifact and a seller acknowledgment are distinct.
 * No filing API, taxpayer identifier collection, money or account restriction. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {exactCents} from './shippingPurchaseRate';
import {acceptedPurchaseTaxSnapshot,acceptedQuotePurchasePolicy,nativePurchasePaymentSource} from './purchasePolicy';
import {readAllocationHistoryIntent,readSettledAllocationIntent,allocationLocalMovementsVerified} from './refundAllocation';
import {supportUid,supportObject,supportHash,supportSourceHash,supportAdmin} from './supportRequest';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication} from './eligibility';
import {taxCents,taxHash,taxId,taxNative,taxSellerRef,taxOperatorRef,planSellerTaxSource,planSellerTaxEvidenceEvent,readSellerTaxAnnualSummary,
  SELLER_TAX_POLICY_VERSION,SELLER_TAX_LEDGER_LIMITS,type SellerTaxSource} from './sellerTaxLedger';
import {observeSellerTaxEvidence,parseSellerTaxEvidenceReference,qualifySellerTaxCopy,readSellerTaxPrivateCopy,qualifySellerTaxCreditNoteFile,readSellerTaxPrivateCreditNote,
  type SellerTaxCopyBinding,type SellerTaxCreditNoteBinding,type SellerTaxEvidencePurpose,type SellerTaxEvidenceReference,type SellerTaxEvidenceSubject} from './sellerTaxEvidence';
import {parseSellerTaxCaptureReference,sellerTaxCaptureContext,sellerTaxCapturePoint,readSellerTaxCapture,sellerTaxCaptureView,prepareSellerTaxCapture,
  observeSellerTaxCapturePage,planSellerTaxCapturePage,type SellerTaxCaptureReference} from './sellerTaxAnnualCapture';

type Data=FirebaseFirestore.DocumentData;
export const SELLER_TAX_REPORTING_CAPABILITY='seller_tax_reporting_v1';
const OWNER_ACTIONS=['ingest','scan','snapshot','identity_record','evidence_event','assistance','copy_ack','annual_capture_prepare','annual_capture_advance'];
const ADMIN_ACTIONS=['operator_record','ingest','scan','snapshot','identity_record','evidence_event','declaration_prepare','filing_record','copy_record','credit_note_record','annual_capture_prepare','annual_capture_advance'];
const CASE='seller_tax_case_v1',RECEIPT='seller_tax_command_v1';
const yearRef=(subject:string,ownerId:string|null,year:number)=>subject==='operator'?taxOperatorRef(year):taxSellerRef(ownerId!).collection('years').doc(String(year));
const commandRef=(subject:string,ownerId:string|null,year:number,uid:string,rid:string)=>yearRef(subject,ownerId,year).collection('commands').doc(supportHash([uid,rid]));
const timestamp=(v:any)=>taxNative(v)?v.toDate().toISOString():null;
const keys:Record<string,string[]>={operator_record:['evidenceReference'],identity_record:['evidenceReference'],evidence_event:['source','evidenceReference'],
  ingest:['source'],scan:[],snapshot:['captureReference'],assistance:['reasonCode'],declaration_prepare:['kind','previousDeclaration','captureReference'],filing_record:['declaration','evidenceReference'],
  copy_record:['declaration','evidenceReference'],copy_ack:['declaration','delivery'],credit_note_record:['source','evidenceReference'],annual_capture_prepare:[],annual_capture_advance:['captureReference']};
function source(raw:unknown):SellerTaxSource{const s=supportObject(raw,['kind','id','refundIntentId']);
  if(!['purchase','purchase_refund','swap'].includes(s.kind)||!taxId(s.id)||(s.kind==='purchase_refund'?!taxId(s.refundIntentId):s.refundIntentId!==undefined))
    throw new HttpsError('invalid-argument','Source native de vente requise.');
  return {kind:s.kind,id:s.id,...s.kind==='purchase_refund'?{refundIntentId:s.refundIntentId}:{}};
}
function reference(raw:unknown){const r=supportObject(raw,['id','contentHash']);if(!taxId(r.id)||!taxHash(r.contentHash))throw new HttpsError('invalid-argument','Référence de document fiscal requise.');return {id:r.id,contentHash:r.contentHash};}
type TaxDocumentReference={id:string;contentHash:string};
type TaxAssistanceReason='missing_identity'|'missing_tax_identifier'|'identifier_exception'|'missing_copy'|'disputed_period'|'incorrect_information';
type TaxCommand={expectedVersion:number}&(
  {action:'operator_record';evidenceReference:SellerTaxEvidenceReference}|{action:'identity_record';evidenceReference:SellerTaxEvidenceReference}|
  {action:'evidence_event';source:SellerTaxSource;evidenceReference:SellerTaxEvidenceReference}|{action:'ingest';source:SellerTaxSource}|
  {action:'scan'}|{action:'snapshot';captureReference?:SellerTaxCaptureReference}|{action:'assistance';reasonCode:TaxAssistanceReason}|
  {action:'annual_capture_prepare'}|{action:'annual_capture_advance';captureReference:SellerTaxCaptureReference}|
  {action:'declaration_prepare';kind:'original'|'corrective'|'cancelled';previousDeclaration:TaxDocumentReference|null;captureReference?:SellerTaxCaptureReference}|
  {action:'filing_record';declaration:TaxDocumentReference;evidenceReference:SellerTaxEvidenceReference}|
  {action:'copy_record';declaration:TaxDocumentReference;evidenceReference:SellerTaxEvidenceReference}|
  {action:'copy_ack';declaration:TaxDocumentReference;delivery:TaxDocumentReference}|
  {action:'credit_note_record';source:SellerTaxSource;evidenceReference:SellerTaxEvidenceReference});
type TaxParsedRequest={capability:typeof SELLER_TAX_REPORTING_CAPABILITY;expectedUid:string;mode:'execute'|'neutralize'|'observe'|'page';access:'owner'|'admin';subject:'seller'|'operator';
  ownerId:string|null;year:number;requestId:string|null;command:TaxCommand|null;collection:string|null;cursor:string|null};
function parse(raw:unknown):TaxParsedRequest{const d=supportObject(raw,['capability','expectedUid','mode','access','subject','ownerId','year','requestId','command','collection','cursor']);
  if(d.capability!==SELLER_TAX_REPORTING_CAPABILITY||!taxId(d.expectedUid)||!['execute','neutralize','observe','page'].includes(d.mode)||!['owner','admin'].includes(d.access)||!['seller','operator'].includes(d.subject)||(d.subject==='seller'?!taxId(d.ownerId):d.ownerId!==null)||d.subject==='operator'&&d.access!=='admin'||
    !Number.isInteger(d.year)||d.year<2024||d.year>new Date().getUTCFullYear()+1)throw new HttpsError('invalid-argument','Portée fiscale privée explicite requise.');
  if(d.mode!=='page'&&(d.collection!==undefined||d.cursor!==undefined))throw new HttpsError('invalid-argument','Champs de page uniquement en lecture paginée.');
  const out:TaxParsedRequest={capability:SELLER_TAX_REPORTING_CAPABILITY,expectedUid:d.expectedUid,mode:d.mode,access:d.access,subject:d.subject,ownerId:d.ownerId,year:d.year,requestId:null,command:null,collection:null,cursor:null};
  if(d.requestId!=null){if(typeof d.requestId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(d.requestId))throw new HttpsError('invalid-argument','Commande fiscale durable requise.');out.requestId=d.requestId;}
  if(d.mode==='execute'||d.mode==='neutralize'){
    const c=d.command;if(!c||typeof c!=='object'||!Object.prototype.hasOwnProperty.call(keys,c.action))throw new HttpsError('invalid-argument','Acte fiscal explicite requis.');
    supportObject(c,['action','expectedVersion',...keys[c.action]]);if(!taxCents(c.expectedVersion))throw new HttpsError('invalid-argument','Version fiscale native requise.');
    const allowed=d.access==='owner'?OWNER_ACTIONS:ADMIN_ACTIONS;if(!allowed.includes(c.action)||d.subject==='operator'&&c.action!=='operator_record'||c.action==='operator_record'&&d.subject!=='operator')
      throw new HttpsError('permission-denied','Cet acte n’est pas autorisé pour cette portée.');
    const b={expectedVersion:c.expectedVersion};let command:TaxCommand;
    switch(c.action){
      case 'operator_record':command={...b,action:'operator_record',evidenceReference:parseSellerTaxEvidenceReference(c.evidenceReference)};break;
      case 'identity_record':command={...b,action:'identity_record',evidenceReference:parseSellerTaxEvidenceReference(c.evidenceReference)};break;
      case 'evidence_event':command={...b,action:'evidence_event',source:source(c.source),evidenceReference:parseSellerTaxEvidenceReference(c.evidenceReference)};break;
      case 'credit_note_record':command={...b,action:'credit_note_record',source:source(c.source),evidenceReference:parseSellerTaxEvidenceReference(c.evidenceReference)};break;
      case 'ingest':command={...b,action:'ingest',source:source(c.source)};break;
      case 'scan':command={...b,action:'scan'};break;
      case 'snapshot':command={...b,action:'snapshot',...c.captureReference!==undefined?{captureReference:parseSellerTaxCaptureReference(c.captureReference)}:{}};break;
      case 'annual_capture_prepare':command={...b,action:'annual_capture_prepare'};break;
      case 'annual_capture_advance':command={...b,action:'annual_capture_advance',captureReference:parseSellerTaxCaptureReference(c.captureReference)};break;
      case 'assistance':if(!['missing_identity','missing_tax_identifier','identifier_exception','missing_copy','disputed_period','incorrect_information'].includes(c.reasonCode))throw new HttpsError('invalid-argument','Motif fiscal requis.');command={...b,action:'assistance',reasonCode:c.reasonCode};break;
      case 'declaration_prepare':if(!['original','corrective','cancelled'].includes(c.kind))throw new HttpsError('invalid-argument','Type de déclaration requis.');{
        const previousDeclaration=c.previousDeclaration===null?null:reference(c.previousDeclaration);if((c.kind==='original')!==(previousDeclaration===null))throw new HttpsError('invalid-argument','Une correction ou annulation référence sa déclaration originale.');
        command={...b,action:'declaration_prepare',kind:c.kind,previousDeclaration,...c.captureReference!==undefined?{captureReference:parseSellerTaxCaptureReference(c.captureReference)}:{}};break;}
      case 'filing_record':command={...b,action:'filing_record',declaration:reference(c.declaration),evidenceReference:parseSellerTaxEvidenceReference(c.evidenceReference)};break;
      case 'copy_record':command={...b,action:'copy_record',declaration:reference(c.declaration),evidenceReference:parseSellerTaxEvidenceReference(c.evidenceReference)};break;
      case 'copy_ack':command={...b,action:'copy_ack',declaration:reference(c.declaration),delivery:reference(c.delivery)};break;
      default:throw new HttpsError('invalid-argument','Acte fiscal explicite requis.');
    }
    if(!out.requestId)throw new HttpsError('invalid-argument','Commande durable requise.');out.command=command;
  }else if(d.command!==undefined)throw new HttpsError('invalid-argument','Une lecture ne contient pas d’acte.');
  if(d.mode==='page'){
    if(!['events','identities','snapshots','declarations','filings','deliveries','assistance','credit_notes','captures'].includes(d.collection)||d.cursor!==null&&!taxId(d.cursor))throw new HttpsError('invalid-argument','Page fiscale explicite requise.');
    out.collection=d.collection;out.cursor=d.cursor;
  }return out;
}
async function authority(tx:FirebaseFirestore.Transaction,request:any,d:Data){const s=await assertPrivateAccountSession(request,tx);
  if(d.access==='admin')await supportAdmin(tx,s.uid,s.currentAdminClaim);else if(d.subject!=='seller'||d.ownerId!==s.uid)throw new HttpsError('permission-denied','Dossier fiscal privé.');}
function currentCase(raw:Data|undefined,subject:string,ownerId:string|null,year:number){
  if(raw&&(raw.kind!==CASE||raw.subject!==subject||raw.ownerId!==ownerId||raw.year!==year||!taxCents(raw.version)))throw new HttpsError('failed-precondition','Dossier fiscal historique non qualifié.');
  return raw??{kind:CASE,subject,ownerId,year,version:0,scan:{phase:'sales',cursor:null,refundQueue:[],pages:0,closed:false,issues:[]},identity:null,lastSnapshot:null,lastDeclaration:null,createdAt:null};
}
async function document(tx:FirebaseFirestore.Transaction,ref:FirebaseFirestore.DocumentReference,r:{id:string;contentHash:string}){
  const d=(await tx.get(ref.collection('documents').doc(r.id))).data();if(!d||d.contentHash!==r.contentHash||d.contentHash!==supportSourceHash(d.document))throw new HttpsError('failed-precondition','Document fiscal natif non qualifié.');return d.document;
}
/** Current native refund association for a private, already issued note. The
 * signature binds these exact amounts/sources without copying the money data
 * into the file DTO or granting a new financial effect. */
async function creditNoteBinding(tx:FirebaseFirestore.Transaction,ownerId:string,year:number,note:Data,historical=false):Promise<SellerTaxCreditNoteBinding>{
  const s=source(note.source);if(s.kind!=='purchase_refund'||!taxId(s.refundIntentId))throw new HttpsError('failed-precondition','Note liée à son remboursement natif requise.');
  const id=s.id,intentId=s.refundIntentId,order=(await tx.get(db.collection('transactions').doc(id))).data(),
    allocation=(await tx.get(db.collection('transactions').doc(id).collection('refund_allocations').doc(intentId))).data(),
    counter=(await tx.get(db.collection('platform_ledger').doc('purchase_refund_'+supportHash([id,intentId])))).data();
  if(!order||order.buyerId!==ownerId||!taxId(order.sellerId)||order.sellerId===ownerId||!allocation||!counter)throw new HttpsError('failed-precondition','Les sources privées de la note doivent être rapprochées.');
  const quote=taxId(order.shippingQuoteId)?(await tx.get(db.collection('shipping_quotes').doc(order.shippingQuoteId))).data():null,
    accepted=quote&&acceptedQuotePurchasePolicy(order,id,quote)?acceptedPurchaseTaxSnapshot(order,quote):null,payment=nativePurchasePaymentSource(order,id),terms=allocation.terms,
    amount=exactCents(order.amount),fee=exactCents(order.serviceFee),shipping=exactCents(order.shippingCost),tax=exactCents(order.taxTotal),total=exactCents(order.totalAmount);
  const nativeSource={protocol:'purchase_refund_accounting_source_v1',transactionId:id,refundIntentId:intentId,buyerId:ownerId,sellerId:order.sellerId,
    reservationHash:allocation.reservationHash,basisHash:allocation.basisHash,termsHash:terms?supportHash(terms):null,components:terms?.refund??null,
    cardCents:terms?.cardCents??null,walletCents:terms?.walletCents??null,sellerDebitCents:terms?.sellerDebitCents??null};
  const baseSource={protocol:'purchase_platform_base_source_v1',transactionId:id,buyerId:ownerId,sellerId:order.sellerId,articleCents:amount,buyerFeeCents:fee,
    shippingCents:shipping,taxCents:tax,totalCents:total,payment:payment?{kind:payment.kind,referenceId:payment.referenceId,
      cardCents:payment.kind==='wallet_ledger'?0:payment.amountCents-(payment.walletCents??0),walletCents:payment.kind==='wallet_ledger'?payment.amountCents:payment.walletCents??0}:null};
  if(!accepted||!payment||[amount,fee,shipping,tax,total].some(v=>v===null)||amount! + fee! + shipping! + tax! !== total||payment.amountCents!==total||
    counter.type!=='purchase_refund_counterentry'||counter.protocol!=='purchase_platform_accounting_v1'||counter.currency!=='cad'||!historical&&counter.qualification!=='qualified'||
    !taxNative(counter.createdAt)||counter.baseHash!==supportSourceHash(baseSource)||counter.sourceHash!==supportSourceHash(counter.source)||counter.sourceHash!==supportSourceHash(nativeSource)||
    counter.transactionId!==id||counter.refundIntentId!==intentId||allocation.protocol!=='purchase_refund_allocation_record_v1'||allocation.transactionId!==id||allocation.refundIntentId!==intentId||
    allocation.buyerId!==ownerId||allocation.sellerId!==order.sellerId||allocation.basisHash!==supportSourceHash(allocation.basis)||
    allocation.reservationHash!==supportSourceHash(allocation.reservation)||allocation.reservation?.termsHash!==supportHash(terms)||
    ![note.gstCents,note.qstCents,note.buyerFeeCents].every(taxCents)||note.gstCents!==terms?.refund?.gstCents||note.qstCents!==terms?.refund?.qstCents||note.buyerFeeCents!==terms?.refund?.buyerFeeCents||
    note.gstCents!==exactCents(Math.abs(counter.gst))||note.qstCents!==exactCents(Math.abs(counter.qst))||note.buyerFeeCents!==exactCents(Math.abs(counter.serviceFee))||
    counter.gst>0||counter.qst>0||counter.serviceFee>0||note.gstCents>exactCents(accepted.gst)!||note.qstCents>exactCents(accepted.qst)!||note.buyerFeeCents>fee!||
    !taxHash(note.originalInvoiceReferenceHash)||typeof note.issuedAt!=='string'||!Number.isFinite(Date.parse(note.issuedAt))||Date.parse(note.issuedAt)>Date.now())
    throw new HttpsError('failed-precondition','Les composantes et sources originales de la note doivent être rapprochées.');
  let intent=order.refund;if(intent?.intentId!==intentId)intent=await readAllocationHistoryIntent(tx,id,order,intentId);
  // Import is NEW documentary issuance and requires a presently qualified
  // settlement. Reading the SAME immutable, previously qualified note is an
  // existing right: a late card failure or review flag cannot revoke it. Its
  // original allocation and exact committed local movements still must match;
  // this observation grants neither payment success nor another money effect.
  const association=!!intent&&intent.intentId===intentId&&intent.buyerId===ownerId&&intent.sellerId===order.sellerId&&intent.currency==='cad';
  if(!association||(historical?note.currentAccountingQualification!=='native_components_and_settlement_observed'||
      !await allocationLocalMovementsVerified(tx,id,order,intent,allocation):!await readSettledAllocationIntent(tx,id,order,intent)))
    throw new HttpsError('failed-precondition','Le règlement natif de la note doit être rapproché.');
  // These are original committed facts, unlike provider/review progress. Bind
  // the native Timestamps themselves (seconds AND nanos): changing all three
  // matching dates together must still invalidate the previously signed file.
  const project=(raw:Data,keys:string[])=>Object.fromEntries(keys.filter(k=>Object.prototype.hasOwnProperty.call(raw,k)).map(k=>[k,raw[k]]));
  const ledgerRefs=[...intent.walletAmountCents>0?[db.collection('wallets').doc(ownerId).collection('ledger').doc('refund_credit_'+intentId)]:[],
    ...intent.sellerDebitCents>0?[db.collection('wallets').doc(order.sellerId).collection('ledger').doc('refund_debit_'+intentId)]:[]];
  const localRows=await Promise.all(ledgerRefs.map(r=>tx.get(r)));
  if(localRows.some(r=>!r.exists))throw new HttpsError('failed-precondition','Les écritures natives de la note doivent être rapprochées.');
  const settlementWitness={transactionRef:db.collection('transactions').doc(id).path,
    refund:project(intent,['intentId','buyerId','sellerId','currency','paymentIntentId','stripeRefundId','cardAmountCents','walletAmountCents','sellerDebitCents','fundsAppliedAt']),
    allocationRef:db.collection('transactions').doc(id).collection('refund_allocations').doc(intentId).path,
    settlement:project(allocation.settlement,['protocol','refundIntentId','appliedAt','providerRefundId','sellerDebitCents','salePendingConsumedCents','saleHeldConsumedCents',
      'saleReleasedConsumedCents','fromPendingCents','fromHeldCents','fromBalanceCents','debtCents']),
    counterRef:db.collection('platform_ledger').doc('purchase_refund_'+supportHash([id,intentId])).path,counterCreatedAt:counter.createdAt};
  const localLedgerWitnesses=localRows.map((row,i)=>({ref:ledgerRefs[i].path,document:project(row.data()!,
    ['type','transactionId','refundIntentId','amount','debtRecorded','balanceAfter','currency','createdAt'])}));
  return {ownerId,year,transactionId:id,refundIntentId:intentId,nativeSourceHash:supportSourceHash({protocol:'seller_tax_credit_note_financial_source_v1',
    source:nativeSource,baseHash:counter.baseHash,acceptedTaxSnapshot:accepted,settlementWitness,localLedgerWitnesses}),originalInvoiceReferenceHash:note.originalInvoiceReferenceHash,
    issuedAt:note.issuedAt,gstCents:note.gstCents,qstCents:note.qstCents,buyerFeeCents:note.buyerFeeCents};
}
function storeDocument(tx:FirebaseFirestore.Transaction,ref:FirebaseFirestore.DocumentReference,collection:string,id:string,body:Data){const contentHash=supportSourceHash(body),r={id,contentHash};
  tx.create(ref.collection('documents').doc(id),{document:body,contentHash});tx.create(ref.collection(collection).doc(id),{reference:r,kind:body.kind,createdAt:body.recordedAt});return r;}
function operatorView(raw:Data|undefined,year:number){const c=currentCase(raw,'operator',null,year);return c.operator??{status:'unknown',identityAvailable:false,timeZone:null,versionHash:null,externalAssessmentVerified:false};}
function newSensitiveIntake(op:Data){if(op.status!=='documented_reporting_operator'||!taxHash(op.versionHash)||!op.identityAvailable)throw new HttpsError('failed-precondition','Qualification annuelle et finalité de la collecte fiscale requises.');}
function safeOperator(payload:Data,year:number){
  supportObject(payload,['assessment','year','legalName','registeredOffice','operatorTaxIdentifiers','timeZone','purpose','policyVersion','gstRegistrationDocumented','qstRegistrationDocumented']);
  if(payload.year!==year||payload.purpose!=='part_xx_reporting'||payload.policyVersion!==SELLER_TAX_POLICY_VERSION||
    !['documented_reporting_operator','documented_excluded_operator','unknown'].includes(payload.assessment)||!['UTC','America/Toronto'].includes(payload.timeZone)||
    payload.legalName!=='Seconde Technologies inc.')throw new HttpsError('failed-precondition','Évaluation annuelle de l’exploitant non qualifiée.');
  const office=validAddress(payload.registeredOffice),identifiers=Array.isArray(payload.operatorTaxIdentifiers)&&payload.operatorTaxIdentifiers.length>0&&payload.operatorTaxIdentifiers.length<=10&&
    payload.operatorTaxIdentifiers.every((i:any)=>i&&/^[A-Z]{2}$/.test(i.jurisdiction)&&typeof i.value==='string'&&i.value.trim().length>0&&i.value.length<=100);
  return {status:payload.assessment,legalName:'Seconde Technologies inc.',identityAvailable:office&&identifiers,
    timeZone:payload.timeZone,policyVersion:SELLER_TAX_POLICY_VERSION,purpose:payload.purpose,gstRegistrationDocumented:payload.gstRegistrationDocumented===true,
    qstRegistrationDocumented:payload.qstRegistrationDocumented===true,externalAssessmentVerified:false};
}
function validAddress(v:any){return !!v&&typeof v==='object'&&!Array.isArray(v)&&['line1','city','region','postalCode','country'].every(k=>typeof v[k]==='string'&&v[k].trim().length>0&&v[k].length<=200)&&/^[A-Z]{2}$/.test(v.country);}
function safeIdentity(payload:Data){
  supportObject(payload,['personKind','firstName','lastName','primaryAddress','dateOfBirth','residenceJurisdictions','taxIdentifiers','identifierException','diligenceEvidencePresent']);
  const nonempty=(v:any)=>typeof v==='string'&&!!v.trim()&&v.length<=200;
  const countries=Array.isArray(payload.residenceJurisdictions)&&payload.residenceJurisdictions.length>0&&payload.residenceJurisdictions.length<=10&&payload.residenceJurisdictions.every((s:any)=>typeof s==='string'&&/^[A-Z]{2}$/.test(s));
  const identifiers=Array.isArray(payload.taxIdentifiers)&&payload.taxIdentifiers.length<=10&&payload.taxIdentifiers.every((r:any)=>r&&Object.keys(r).sort().join(',')==='jurisdiction,value'&&
    typeof r.jurisdiction==='string'&&/^[A-Z]{2}$/.test(r.jurisdiction)&&nonempty(r.value));
  const exception=payload.identifierException===null?null:supportObject(payload.identifierException,['reason','jurisdiction','supportingEvidencePresent']);
  if(exception&&(!['jurisdiction_does_not_issue','jurisdiction_does_not_require_collection','government_verification_service'].includes(exception.reason)||
    !/^[A-Z]{2}$/.test(exception.jurisdiction)||exception.supportingEvidencePresent!==true))throw new HttpsError('failed-precondition','Exception d’identifiant non documentée.');
  if(payload.personKind!=='individual'||!countries||!identifiers)
    throw new HttpsError('failed-precondition','Identité fiscale individuelle à documenter.');
  const dob=typeof payload.dateOfBirth==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(payload.dateOfBirth)&&Number.isFinite(Date.parse(payload.dateOfBirth+'T00:00:00.000Z'))&&
    new Date(payload.dateOfBirth+'T00:00:00.000Z').toISOString().slice(0,10)===payload.dateOfBirth&&payload.dateOfBirth<=new Date().toISOString().slice(0,10);
  const identityDocumented=nonempty(payload.firstName)&&nonempty(payload.lastName)&&validAddress(payload.primaryAddress)&&dob&&payload.diligenceEvidencePresent===true;
  // Raw names, address, DOB and identifier values remain ONLY in the CMEK file.
  const identifierStatus=payload.taxIdentifiers.length>0?'external_identifier_documented':exception?'exception_documented':'missing';
  return {personKind:'individual',identityDocumented,residenceJurisdictions:payload.residenceJurisdictions,identifierStatus,exceptionReason:exception?.reason??null,
    completeForPreparation:identityDocumented&&identifierStatus!=='missing',externalIdentityVerified:false,taxIdentifierValueAvailableInApp:false};
}
function receiptView(c:Data|null){return c?{protocol:RECEIPT,actorId:c.actorId,requestId:c.requestId,inputHash:c.inputHash,subject:c.subject,ownerId:c.ownerId,year:c.year,action:c.command.action,
  status:c.status,versionBefore:c.versionBefore,versionAfter:c.versionAfter,documentReference:c.documentReference??null,reason:c.reason??null,
  recordedAt:timestamp(c.recordedAt),completedAt:timestamp(c.completedAt),financialEffectAuthorized:false,authorityFilingPerformed:false}:null;}
function qualifiedReceipt(c:Data|undefined,d:Data,uid:string){if(c&&(c.protocol!==RECEIPT||c.actorId!==uid||c.requestId!==d.requestId||c.subject!==d.subject||c.ownerId!==d.ownerId||c.year!==d.year||
  c.inputHash!==supportHash({subject:c.subject,ownerId:c.ownerId,year:c.year,command:c.command})||!['pending','completed','not_executed','unknown'].includes(c.status)||!taxNative(c.recordedAt)||!c.command||!Object.prototype.hasOwnProperty.call(keys,c.command.action)||
  !taxCents(c.versionBefore)||!taxCents(c.versionAfter)||c.versionBefore!==c.command.expectedVersion||
  (c.status==='completed'?c.versionAfter!==c.versionBefore+1||!c.documentReference||!taxId(c.documentReference.id)||!taxHash(c.documentReference.contentHash)||c.documentHash!==c.documentReference.contentHash:
    c.versionAfter!==c.versionBefore||c.documentReference!=null)||
  (['completed','not_executed'].includes(c.status)?!taxNative(c.completedAt)||c.completedAt.toMillis()<c.recordedAt.toMillis():c.completedAt!==null)||
  d.command&&c.inputHash!==supportHash({subject:d.subject,ownerId:d.ownerId,year:d.year,command:d.command})))throw new HttpsError('already-exists','Cette commande fiscale possède un autre contenu.');return c??null;}
function caseView(c:Data,admin:boolean){return {protocol:SELLER_TAX_REPORTING_CAPABILITY,subject:c.subject,ownerId:c.ownerId,year:c.year,version:c.version,operator:c.subject==='operator'?c.operator??null:null,
  identity:c.identity??null,lastSnapshot:c.lastSnapshot??null,lastDeclaration:c.lastDeclaration??null,scan:c.scan,createdAt:timestamp(c.createdAt),opaque:false,
  fiscalFactsAreCertified:false,filingPerformedByApplication:false,taxRegistrationCertified:false,financialEffectAuthorized:false,administrativeView:admin};}
function redactDocument(d:Data){
  // Every stored document was constructed below from allowlisted projections;
  // evidence payloads and all TIN values are deliberately absent.
  const primitives=(v:any):any=>v instanceof Timestamp?timestamp(v):Array.isArray(v)?v.map(primitives):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,primitives(x)])):v;
  const safe={...d};if(d.kind==='copy_record'&&Object.prototype.hasOwnProperty.call(d,'copyFile')){
    delete safe.copyFile;delete safe.individualizationBasis;delete safe.legalAuthenticityVerified;
    safe.copyAccess={individualFileRecorded:true,individualizationBasis:'independent_qualified_attestation',legalAuthenticityVerified:false};
  }
  if(d.kind==='credit_note_record'&&Object.prototype.hasOwnProperty.call(d,'creditNoteFile')){
    delete safe.creditNoteFile;delete safe.nativeCreditNoteSourceHash;
    safe.creditNoteAccess={individualFileRecorded:true,individualizationBasis:'independent_qualified_attestation',legalAuthenticityVerified:false};
  }
  return primitives({...safe,recordedAt:timestamp(d.recordedAt),evidence:d.evidence?{purpose:d.evidence.purpose,reference:d.evidence.reference,contentHash:d.evidence.contentHash,
    generation:d.evidence.generation,issuedAt:d.evidence.issuedAt,externalAuthenticityVerified:false}:null});
}
async function read(request:any,d:Data){return db.runTransaction(async tx=>{
  await assertPrivateAccountSession(request,tx);const ref=yearRef(d.subject,d.ownerId,d.year),c=currentCase((await tx.get(ref)).data(),d.subject,d.ownerId,d.year),receipt=d.requestId?
    qualifiedReceipt((await tx.get(commandRef(d.subject,d.ownerId,d.year,request.auth.uid,d.requestId))).data(),d,request.auth.uid):null;
  let permitted=true;try{await authority(tx,request,d);}catch(e){if(e instanceof HttpsError&&e.code==='permission-denied')permitted=false;else throw e;}
  if(!permitted){if(!receipt)throw new HttpsError('permission-denied','Reçu fiscal propre requis.');return {caseView:{protocol:SELLER_TAX_REPORTING_CAPABILITY,subject:d.subject,ownerId:d.ownerId,year:d.year,opaque:true},commandReceipt:receiptView(receipt),page:null};}
  if(d.mode!=='page')return {caseView:caseView(c,d.access==='admin'),commandReceipt:receiptView(receipt),page:null};
  let query:FirebaseFirestore.Query=ref.collection(d.collection).orderBy('__name__').limit(11);if(d.cursor)query=query.startAfter(d.cursor);const page=await tx.get(query),selected=page.docs.slice(0,10),entries:Data[]=[];
  for(const row of selected){const index=row.data();if(!index.reference)continue;const doc=await document(tx,ref,reference(index.reference));
    if(doc.subject!==d.subject||doc.ownerId!==d.ownerId||doc.year!==d.year)throw new HttpsError('failed-precondition','Portée historique fiscale incohérente.');entries.push({reference:index.reference,document:redactDocument(doc)});}
  return {caseView:caseView(c,d.access==='admin'),commandReceipt:receiptView(receipt),page:{collection:d.collection,entries,hasMore:page.size>10,nextCursor:page.size>10?selected.at(-1)!.id:null,
    inspected:selected.length,completeHistory:false}};
});}

/** Existing support endpoints explicitly pass owner/admin/read authority; a
 * client access field never upgrades the endpoint's authority. */
export async function handleSellerTaxReporting(request:any,endpoint:'owner'|'admin'|'read'){
  return withPrivateAccountSession(request,async()=>{supportUid(request);
    if(request.data?.mode==='credit_note_read'){
      if(endpoint!=='read')throw new HttpsError('permission-denied','Lecture privée propriétaire requise.');
      const raw=supportObject(request.data,['capability','expectedUid','mode','access','subject','ownerId','year','creditNote']),creditNoteReference=reference(raw.creditNote),
        d=parse({capability:raw.capability,expectedUid:raw.expectedUid,mode:'observe',access:raw.access,subject:raw.subject,ownerId:raw.ownerId,year:raw.year});
      if(d.expectedUid!==request.auth.uid||d.access!=='owner'||d.subject!=='seller'||d.ownerId!==request.auth.uid)throw new HttpsError('permission-denied','Note individuelle réservée à son destinataire.');
      const current=()=>db.runTransaction(async tx=>{await authority(tx,request,d);assertRecentAccountAuthentication(request.auth.token);
        const note=await document(tx,yearRef('seller',d.ownerId,d.year),creditNoteReference);
        if(note.kind!=='credit_note_record'||note.subject!=='seller'||note.ownerId!==d.ownerId||note.year!==d.year)throw new HttpsError('failed-precondition','Note individuelle native requise.');
        const binding=note.creditNoteFile?await creditNoteBinding(tx,d.ownerId!,d.year,note,true):null;
        if(binding&&note.nativeCreditNoteSourceHash!==binding.nativeSourceHash)throw new HttpsError('failed-precondition','La source originale de la note a changé.');
        return {binding,file:note.creditNoteFile??null,source:note.source,issuedAt:note.issuedAt,originalInvoiceReferenceHash:note.originalInvoiceReferenceHash,
          gstCents:note.gstCents,qstCents:note.qstCents,buyerFeeCents:note.buyerFeeCents,
          sourceVersionHash:supportSourceHash({creditNote:creditNoteReference,binding,creditNoteFile:note.creditNoteFile??null})};});
      const source=await current(),guard=async()=>{const next=await current();if(next.sourceVersionHash!==source.sourceVersionHash)throw new HttpsError('failed-precondition','La référence de note de crédit a changé.');};
      const base={protocol:'seller_tax_private_credit_note_v1',ownerId:d.ownerId,year:d.year,creditNote:creditNoteReference,sourceVersionHash:source.sourceVersionHash,
        source:source.source,issuedAt:source.issuedAt,originalInvoiceReferenceHash:source.originalInvoiceReferenceHash,gstCents:source.gstCents,qstCents:source.qstCents,buyerFeeCents:source.buyerFeeCents,
        legalAuthenticityVerified:false,deviceReadVerified:false};
      if(!source.file||!source.binding){await guard();return {creditNoteView:{...base,availability:'unavailable',reason:'individual_file_not_recorded',file:null,dataBase64:null,individualizationBasis:null}};}
      const result=await readSellerTaxPrivateCreditNote(source.file,source.binding,guard);await guard();return {creditNoteView:{...base,...result,availability:'available',reason:null}};
    }
    if(request.data?.mode==='copy_read'){
      if(endpoint!=='read')throw new HttpsError('permission-denied','Lecture privée propriétaire requise.');
      const raw=supportObject(request.data,['capability','expectedUid','mode','access','subject','ownerId','year','delivery']),deliveryReference=reference(raw.delivery),
        d=parse({capability:raw.capability,expectedUid:raw.expectedUid,mode:'observe',access:raw.access,subject:raw.subject,ownerId:raw.ownerId,year:raw.year});
      if(d.expectedUid!==request.auth.uid||d.access!=='owner'||d.subject!=='seller'||d.ownerId!==request.auth.uid)throw new HttpsError('permission-denied','Copie individuelle réservée à son propriétaire.');
      const current=()=>db.runTransaction(async tx=>{await authority(tx,request,d);assertRecentAccountAuthentication(request.auth.token);
        const ref=yearRef('seller',d.ownerId,d.year),delivery=await document(tx,ref,deliveryReference);
        if(delivery.kind!=='copy_record'||delivery.subject!=='seller'||delivery.ownerId!==d.ownerId||delivery.year!==d.year||delivery.reportedCopyScope!=='single_seller')throw new HttpsError('failed-precondition','Copie individuelle native requise.');
        const declarationReference=reference(delivery.declaration),filingReference=reference(delivery.filingReference),declaration=await document(tx,ref,declarationReference),filing=await document(tx,ref,filingReference);
        for(const doc of [declaration,filing])if(doc.subject!=='seller'||doc.ownerId!==d.ownerId||doc.year!==d.year)throw new HttpsError('permission-denied','Document fiscal étranger.');
        if(declaration.kind!=='declaration_prepare'||filing.kind!=='filing_record'||supportHash(filing.declaration)!==supportHash(declarationReference)||delivery.documentReferenceId!==declaration.documentReferenceId||
          filing.documentReferenceId!==declaration.documentReferenceId||!taxHash(delivery.deliveredFileHash))throw new HttpsError('failed-precondition','La copie doit correspondre à son dépôt et à sa déclaration.');
        const binding:SellerTaxCopyBinding={ownerId:d.ownerId!,year:d.year,nativeDeclarationHash:declarationReference.contentHash,documentReferenceId:declaration.documentReferenceId,
          filingReferenceHash:supportSourceHash(filingReference),deliveredFileHash:delivery.deliveredFileHash};
        return {binding,copyFile:delivery.copyFile??null,declaration:declarationReference,filing:filingReference,sourceVersionHash:supportSourceHash({delivery:deliveryReference,declaration:declarationReference,filing:filingReference,binding,copyFile:delivery.copyFile??null})};});
      const source=await current(),guard=async()=>{const next=await current();if(next.sourceVersionHash!==source.sourceVersionHash)throw new HttpsError('failed-precondition','La référence de copie fiscale a changé.');};
      const base={protocol:'seller_tax_private_copy_v1',ownerId:d.ownerId,year:d.year,declaration:source.declaration,filing:source.filing,delivery:deliveryReference,sourceVersionHash:source.sourceVersionHash,
        legalAuthenticityVerified:false,deviceReadVerified:false};
      if(!source.copyFile){await guard();return {copyView:{...base,availability:'unavailable',reason:'individual_file_not_recorded',file:null,dataBase64:null,individualizationBasis:null}};}
      const result=await readSellerTaxPrivateCopy(source.copyFile,source.binding,guard);await guard();
      return {copyView:{...base,...result,availability:'available',reason:null}};
    }
    if(request.data?.mode==='source_owner'){
      if(endpoint!=='read')throw new HttpsError('permission-denied','Lecture fiscale administrative requise.');
      const d=supportObject(request.data,['capability','expectedUid','mode','access','source']),s=supportObject(d.source,['kind','id','partyRole']);
      if(d.capability!==SELLER_TAX_REPORTING_CAPABILITY||d.expectedUid!==request.auth.uid||d.access!=='admin'||s.kind!=='purchase'||!taxId(s.id)||!['buyer','seller'].includes(s.partyRole))
        throw new HttpsError('invalid-argument','Source native et rôle fiscal explicites requis.');
      const sourceOwnerView=await db.runTransaction(async tx=>{await authority(tx,request,{access:'admin'});
        const native=(await tx.get(db.collection('transactions').doc(s.id))).data();
        if(!native||!taxId(native.buyerId)||!taxId(native.sellerId)||native.buyerId===native.sellerId)throw new HttpsError('failed-precondition','Les parties de la commande native doivent être rapprochées.');
        const facts={protocol:'seller_tax_source_owner_v1',kind:'purchase',transactionId:s.id,partyRole:s.partyRole,buyerId:native.buyerId,sellerId:native.sellerId};
        return {protocol:'seller_tax_source_owner_v1',kind:'purchase',transactionId:s.id,partyRole:s.partyRole,
          ownerId:s.partyRole==='buyer'?native.buyerId:native.sellerId,sourceVersionHash:supportSourceHash(facts)};});
      await db.runTransaction(tx=>authority(tx,request,{access:'admin'}));return {sourceOwnerView};
    }
    if(request.data?.mode==='annual_capture_observe'){
      if(endpoint!=='read')throw new HttpsError('permission-denied','Lecture fiscale privée requise.');
      const raw=supportObject(request.data,['capability','expectedUid','mode','access','subject','ownerId','year','captureReference']),r=parseSellerTaxCaptureReference(raw.captureReference);
      const d=parse({capability:raw.capability,expectedUid:raw.expectedUid,mode:'observe',access:raw.access,subject:raw.subject,ownerId:raw.ownerId,year:raw.year});
      if(d.expectedUid!==request.auth.uid||d.subject!=='seller')throw new HttpsError('permission-denied','Capture annuelle propre requise.');
      const captureView=await db.runTransaction(async tx=>{await authority(tx,request,d);const c=currentCase((await tx.get(yearRef(d.subject,d.ownerId,d.year))).data(),d.subject,d.ownerId,d.year),op=operatorView((await tx.get(taxOperatorRef(d.year))).data(),d.year);
        return sellerTaxCaptureView(await readSellerTaxCapture(tx,d.ownerId!,d.year,r,sellerTaxCaptureContext(op,c.identity)));});
      await db.runTransaction(tx=>authority(tx,request,d));return {captureView};
    }
    const d=parse(request.data),uid=request.auth.uid;
    if(endpoint==='owner'&&(d.access!=='owner'||!['execute','neutralize'].includes(d.mode))||endpoint==='admin'&&(d.access!=='admin'||!['execute','neutralize'].includes(d.mode))||endpoint==='read'&&['execute','neutralize'].includes(d.mode))throw new HttpsError('permission-denied','Point d’accès fiscal inadapté.');
    if(d.access==='owner'&&(d.subject!=='seller'||d.ownerId!==uid))throw new HttpsError('permission-denied','Dossier fiscal propre requis.');
    if(!['execute','neutralize'].includes(d.mode))return read(request,d);
    const ref=yearRef(d.subject,d.ownerId,d.year),cref=commandRef(d.subject,d.ownerId,d.year,uid,d.requestId!),inputHash=supportHash({subject:d.subject,ownerId:d.ownerId,year:d.year,command:d.command});
    if(d.mode==='neutralize'){
      await db.runTransaction(async tx=>{
        await assertPrivateAccountSession(request,tx);const receipt=qualifiedReceipt((await tx.get(cref)).data(),d,uid);
        if(receipt&&['completed','not_executed'].includes(receipt.status))return;
        // No external mutative operation exists in this capability. Its own
        // unresolved GET may be discarded, even after loss of the admin role;
        // the late commit rereads this exact tombstone before business writes.
        if(!receipt)await authority(tx,request,d);
        const now=Timestamp.now(),native=receipt??{protocol:RECEIPT,actorId:uid,requestId:d.requestId,subject:d.subject,ownerId:d.ownerId,year:d.year,
          command:d.command,inputHash,versionBefore:d.command!.expectedVersion,versionAfter:d.command!.expectedVersion,documentReference:null,recordedAt:now};
        tx.set(cref,{...native,status:'not_executed',reason:'explicit_documentary_neutralization',completedAt:now});
      });return read(request,{...d,mode:'observe',command:null});
    }
    const start=await db.runTransaction(async tx=>{
      await assertPrivateAccountSession(request,tx);const receiptSnapshot=await tx.get(cref),receipt=qualifiedReceipt(receiptSnapshot.data(),d,uid),c=currentCase((await tx.get(ref)).data(),d.subject,d.ownerId,d.year);
      if(receipt&&['completed','not_executed'].includes(receipt.status))return false;
      await authority(tx,request,d);if(d.access==='admin')assertRecentAccountAuthentication(request.auth.token);
      if(!receipt&&c.version!==d.command!.expectedVersion){tx.create(cref,{protocol:RECEIPT,actorId:uid,requestId:d.requestId,subject:d.subject,ownerId:d.ownerId,year:d.year,command:d.command,inputHash,
        status:'not_executed',reason:'version_changed',versionBefore:d.command!.expectedVersion,versionAfter:d.command!.expectedVersion,documentReference:null,recordedAt:Timestamp.now(),completedAt:Timestamp.now()});return false;}
      if(receipt&&c.version!==receipt.versionBefore){tx.set(cref,{...receipt,status:'not_executed',reason:'version_changed',completedAt:Timestamp.now()});return false;}
      let captureFields:Data={};if(!receipt&&d.command!.action==='annual_capture_prepare'){
        const op=operatorView((await tx.get(taxOperatorRef(d.year))).data(),d.year);
        captureFields={capturePoint:sellerTaxCapturePoint(receiptSnapshot),captureContext:sellerTaxCaptureContext(op,c.identity)};
      }
      if(!receipt)tx.create(cref,{protocol:RECEIPT,actorId:uid,requestId:d.requestId,subject:d.subject,ownerId:d.ownerId,year:d.year,command:d.command,inputHash,status:'pending',reason:null,
        versionBefore:c.version,versionAfter:c.version,documentReference:null,recordedAt:Timestamp.now(),completedAt:null,...captureFields});return true;
    });
    if(!start)return read(request,{...d,mode:'observe',command:null});
    const purpose:SellerTaxEvidencePurpose|undefined=({operator_record:'operator',identity_record:'identity',evidence_event:'valuation',filing_record:'filing',copy_record:'delivery',credit_note_record:'credit_note'} as Record<string,SellerTaxEvidencePurpose>)[d.command!.action];
    let imported:Awaited<ReturnType<typeof observeSellerTaxEvidence>>|null=null;
    if(purpose){
      if(!d.command||!('evidenceReference' in d.command))throw new HttpsError('invalid-argument','Pièce fiscale liée requise.');
      const guard=()=>db.runTransaction(async tx=>{await authority(tx,request,d);const c=currentCase((await tx.get(ref)).data(),d.subject,d.ownerId,d.year);
        if(c.version!==d.command!.expectedVersion)throw new HttpsError('failed-precondition','Le dossier fiscal a changé.');
        if(purpose==='identity'||purpose==='valuation'){const op=operatorView((await tx.get(taxOperatorRef(d.year))).data(),d.year);newSensitiveIntake(op);}});
      let target:SellerTaxEvidenceSubject;if(d.subject==='operator')target={subject:'operator',ownerId:null};else{if(typeof d.ownerId!=='string')throw new HttpsError('invalid-argument','Vendeur fiscal natif requis.');target={subject:'seller',ownerId:d.ownerId};}
      imported=await observeSellerTaxEvidence(target,d.year,purpose,d.command.evidenceReference,guard);
    }
    let capturePage:Awaited<ReturnType<typeof observeSellerTaxCapturePage>>|null=null,captured:Data|null=null;
    if(d.command!.action==='annual_capture_advance'){
      const captureReference=d.command!.captureReference;
      const guard=()=>db.runTransaction(async tx=>{await authority(tx,request,d);const receipt=qualifiedReceipt((await tx.get(cref)).data(),d,uid),c=currentCase((await tx.get(ref)).data(),d.subject,d.ownerId,d.year),op=operatorView((await tx.get(taxOperatorRef(d.year))).data(),d.year);
        if(receipt?.status!=='pending'||c.version!==d.command!.expectedVersion)throw new HttpsError('failed-precondition','La commande de capture a changé.');
        return readSellerTaxCapture(tx,d.ownerId!,d.year,captureReference,sellerTaxCaptureContext(op,c.identity));});
      captured=await guard();capturePage=await observeSellerTaxCapturePage(captured,guard);
    }
    await db.runTransaction(async tx=>{
      await authority(tx,request,d);const receipt=qualifiedReceipt((await tx.get(cref)).data(),d,uid),c=currentCase((await tx.get(ref)).data(),d.subject,d.ownerId,d.year);
      if(receipt&&['completed','not_executed'].includes(receipt.status))return;if(!receipt||receipt.status!=='pending')throw new HttpsError('failed-precondition','L’acte fiscal natif a changé.');
      if(c.version!==receipt.versionBefore){tx.set(cref,{...receipt,status:'not_executed',reason:'version_changed',completedAt:Timestamp.now()});return;}
      const command=d.command!,action=command.action,op=operatorView((await tx.get(taxOperatorRef(d.year))).data(),d.year),now=Timestamp.now(),id='taxdoc_'+supportHash([uid,d.requestId]);
      let body:Data={protocol:'seller_tax_document_v1',kind:action,subject:d.subject,ownerId:d.ownerId,year:d.year,actorId:uid,recordedAt:now,externalFactsVerified:false,financialEffectAuthorized:false},collection='assistance';
      if(c.version>=Number.MAX_SAFE_INTEGER)throw new HttpsError('resource-exhausted','Historique fiscal à rapprocher.');
      const next:Data={...c,version:c.version+1,createdAt:c.createdAt??now,updatedAt:now};const plans:{commit:()=>void}[]=[];
      if(action==='annual_capture_prepare'){
        const context=sellerTaxCaptureContext(op,c.identity);if(!receipt.capturePoint||supportSourceHash(receipt.captureContext)!==supportSourceHash(context))throw new HttpsError('failed-precondition','La source de la capture annuelle a changé.');
        const plan=prepareSellerTaxCapture(tx,d.ownerId!,d.year,uid,d.requestId!,receipt.capturePoint,context);plans.push(plan);body={...body,capture:sellerTaxCaptureView(plan.capture)};collection='captures';
      }else if(action==='annual_capture_advance'){
        const current=await readSellerTaxCapture(tx,d.ownerId!,d.year,command.captureReference,sellerTaxCaptureContext(op,c.identity));
        if(!captured||!capturePage||supportSourceHash(current)!==supportSourceHash(captured))throw new HttpsError('failed-precondition','La page de capture a changé.');
        const plan=await planSellerTaxCapturePage(tx,current,capturePage);plans.push(plan);body={...body,capture:sellerTaxCaptureView(plan.capture)};collection='captures';
      }else if(action==='operator_record'){
        const operator=safeOperator(imported!.payload,d.year);body={...body,operator,evidence:imported!.proof};collection='identities';next.operator={...operator,versionHash:supportSourceHash(body)};
      }else if(action==='identity_record'){
        newSensitiveIntake(op);const identity=safeIdentity(imported!.payload);body={...body,identity,evidence:imported!.proof,operatorVersionHash:op.versionHash};collection='identities';
        next.identity={...identity,versionHash:supportSourceHash(body),operatorVersionHash:op.versionHash};
      }else if(action==='ingest'||action==='evidence_event'){
        const plan=action==='ingest'?await planSellerTaxSource(tx,d.ownerId!,command.source):await planSellerTaxEvidenceEvent(tx,d.ownerId!,command.source,imported!.payload,imported!.proof,op.versionHash,op.timeZone);
        plans.push(plan);body={...body,eventId:plan.eventId,event:plan.document.body,eventBodyHash:plan.document.bodyHash,qualification:plan.document.qualification,reason:plan.document.reason,
          source:command.source,...imported?{evidence:imported.proof}:{}};collection='events';
      }else if(action==='scan'){
        const phases=['sales','initiated','received'] as const,scan=c.scan,size=SELLER_TAX_LEDGER_LIMITS.sourcePage;
        if(!scan||!phases.includes(scan.phase)&&scan.phase!=='done'||scan.cursor!==null&&!taxId(scan.cursor)||!taxCents(scan.pages)||
          !Array.isArray(scan.refundQueue)||scan.refundQueue.length>size||scan.refundQueue.some((j:any)=>!taxId(j.transactionId)||j.cursor!==null&&!taxId(j.cursor))||
          !Array.isArray(scan.issues)||scan.issues.length>20)throw new HttpsError('failed-precondition','Curseur fiscal natif inconnu.');
        const eventIds:string[]=[],issues:string[]=[...scan.issues];
        if(scan.refundQueue.length){
          const job=scan.refundQueue[0];let q:FirebaseFirestore.Query=db.collection('transactions').doc(job.transactionId).collection('refund_allocations').orderBy('__name__').limit(size+1);
          if(job.cursor)q=q.startAfter(job.cursor);const page=await tx.get(q),selected=page.docs.slice(0,size);
          for(const row of selected){const plan=await planSellerTaxSource(tx,d.ownerId!,{kind:'purchase_refund',id:job.transactionId,refundIntentId:row.id});plans.push(plan);eventIds.push(plan.eventId);}
          const queue=page.size>size?[{...job,cursor:selected.at(-1)!.id},...scan.refundQueue.slice(1)]:scan.refundQueue.slice(1);
          next.scan={...scan,refundQueue:queue,pages:scan.pages+1,closed:scan.phase==='done'&&queue.length===0};
        }else if(scan.phase!=='done'){
          let q:FirebaseFirestore.Query=db.collection(scan.phase==='sales'?'transactions':'swaps').where(scan.phase==='sales'?'sellerId':scan.phase==='initiated'?'initiatorId':'receiverId','==',d.ownerId).orderBy('__name__').limit(size+1);
          if(scan.cursor)q=q.startAfter(scan.cursor);const page=await tx.get(q),selected=page.docs.slice(0,size),queue:{transactionId:string;cursor:null}[]=[];
          for(const row of selected){const raw=row.data(),s:SellerTaxSource={kind:scan.phase==='sales'?'purchase':'swap',id:row.id},plan=await planSellerTaxSource(tx,d.ownerId!,s);plans.push(plan);eventIds.push(plan.eventId);
            if(scan.phase==='sales'){queue.push({transactionId:row.id,cursor:null});if(raw.refund!=null){if(taxId(raw.refund.intentId)){
              const correction=await planSellerTaxSource(tx,d.ownerId!,{kind:'purchase_refund',id:row.id,refundIntentId:raw.refund.intentId});plans.push(correction);eventIds.push(correction.eventId);
            }else issues.push('legacy_refund_identity_unknown');}}
          }
          const more=page.size>size,index=phases.indexOf(scan.phase),nextPhase=more?scan.phase:index<2?phases[index+1]:'done';
          next.scan={phase:nextPhase,cursor:more?selected.at(-1)!.id:null,refundQueue:queue,pages:scan.pages+1,closed:nextPhase==='done'&&queue.length===0,issues:[...new Set(issues)]};
        }
        body={...body,scan:next.scan,events:eventIds,liveSourceSnapshotVerified:false,refundHistoryCoverageVerified:next.scan.closed===true&&next.scan.issues.length===0};collection='events';
      }else if(action==='snapshot'||action==='declaration_prepare'){
        let summary:Data,capture:Data|null=null;
        if(command.captureReference){capture=await readSellerTaxCapture(tx,d.ownerId!,d.year,command.captureReference,sellerTaxCaptureContext(op,c.identity));if(capture.status!=='complete'||!capture.summary)throw new HttpsError('failed-precondition','Capture annuelle complète requise.');summary=capture.summary;}
        else summary=await readSellerTaxAnnualSummary(tx,d.ownerId!,d.year,op.timeZone??'unqualified');
        body={...body,summary,...capture?{captureReference:capture.reference}:{},operatorVersionHash:op.versionHash??null,operatorQualification:op.status,
          identityVersionHash:c.identity?.versionHash??null,identityReady:c.identity?.completeForPreparation===true,sourceScan:c.scan,refundHistoryCoverageVerified:c.scan.closed===true&&c.scan.issues.length===0};collection='snapshots';
        if(action==='declaration_prepare'){
          let previous:Data|null=null;if(command.previousDeclaration)previous=await document(tx,ref,command.previousDeclaration);
          if(previous&&(previous.kind!=='declaration_prepare'||previous.ownerId!==d.ownerId||previous.year!==d.year))throw new HttpsError('failed-precondition','Déclaration précédente étrangère.');
          body={...body,declarationKind:command.kind,previousDeclaration:command.previousDeclaration,previousDocumentReferenceId:previous?.documentReferenceId??null,
            documentReferenceId:'SECONDE_'+supportHash([d.subject,d.ownerId,d.year,uid,d.requestId]),status:'prepared_for_external_validation',
            requirementsUnknown:[...op.status!=='documented_reporting_operator'?['operator_assessment_unknown']:[],...!c.identity?.completeForPreparation?['seller_identity_incomplete']:[],
              ...summary.qualification==='unknown'?['annual_amounts_or_period_unknown']:[],...!capture&&c.scan.closed!==true?['native_source_scan_incomplete']:[],
              ...!capture&&(c.scan.closed!==true||c.scan.issues.length)?['refund_history_coverage_requires_reconciliation']:[],'external_schema_validation_and_filing_required'],officialReturnCreated:false,filingPerformed:false};collection='declarations';
        }
      }else if(action==='filing_record'||action==='copy_record'||action==='copy_ack'){
        const declaration=await document(tx,ref,command.declaration);if(declaration.kind!=='declaration_prepare'||declaration.ownerId!==d.ownerId||declaration.year!==d.year)throw new HttpsError('failed-precondition','Déclaration fiscale liée requise.');
        body={...body,declaration:command.declaration,declarationKind:declaration.declarationKind,documentReferenceId:declaration.documentReferenceId};
        if(action==='copy_ack'){
          const delivery=await document(tx,ref,command.delivery);if(delivery.kind!=='copy_record'||supportHash(delivery.declaration)!==supportHash(command.declaration)||d.ownerId!==uid)
            throw new HttpsError('permission-denied','Accusé de copie réservé au vendeur concerné.');body={...body,delivery:command.delivery,state:'owner_acknowledged_access',acknowledgedAt:now};collection='deliveries';
        }else{
          const p=imported!.payload;supportObject(p,action==='filing_record'?['ownerId','year','nativeDeclarationHash','documentReferenceId','previousDocumentReferenceId','authority','status','receivedAt','confirmationReference','submittedFileHash']:
            ['ownerId','year','nativeDeclarationHash','documentReferenceId','filingReference','channel','deliveredAt','recipientOwnerId','deliveredFileHash','copyScope','copyFile']);
          if(p.ownerId!==d.ownerId||p.year!==d.year||p.nativeDeclarationHash!==command.declaration.contentHash||p.documentReferenceId!==declaration.documentReferenceId)
            throw new HttpsError('failed-precondition','La preuve n’est pas liée au contenu fiscal original.');
          if(action==='filing_record'){
            if(p.authority!=='CRA'||!['received','accepted','rejected'].includes(p.status)||typeof p.receivedAt!=='string'||!Number.isFinite(Date.parse(p.receivedAt))||Date.parse(p.receivedAt)>Date.now()||
              !taxId(p.confirmationReference)||!taxHash(p.submittedFileHash)||(p.previousDocumentReferenceId??null)!==declaration.previousDocumentReferenceId)
              throw new HttpsError('failed-precondition','Reçu externe fiscal non qualifié.');
            body={...body,state:'external_receipt_recorded',authority:'CRA',reportedExternalStatus:p.status,reportedReceivedAt:p.receivedAt,confirmationReferenceHash:supportHash(p.confirmationReference),
              submittedFileHash:p.submittedFileHash,evidence:imported!.proof,authorityAcceptanceVerified:false,submittedContentBinding:'external_receipt_claim',externalReturnSchemaVerified:false};collection='filings';
          }else{
            const filing=await document(tx,ref,reference(p.filingReference));if(filing.kind!=='filing_record'||supportHash(filing.declaration)!==supportHash(command.declaration)||
              p.recipientOwnerId!==d.ownerId||!taxHash(p.deliveredFileHash)||p.copyScope!=='single_seller'||!['secure_external_vault','postal_receipt','in_person_receipt'].includes(p.channel)||
              typeof p.deliveredAt!=='string'||!Number.isFinite(Date.parse(p.deliveredAt))||Date.parse(p.deliveredAt)>Date.now())throw new HttpsError('failed-precondition','Copie et destinataire non liés au dépôt documenté.');
            body={...body,state:'external_delivery_evidence_recorded',filingReference:p.filingReference,channel:p.channel,reportedDeliveredAt:p.deliveredAt,deliveredFileHash:p.deliveredFileHash,
              evidence:imported!.proof,reportedCopyScope:'single_seller',copyContentVerified:false,sellerAccessVerified:false};collection='deliveries';
            if(p.copyFile!==undefined){
              if(p.channel!=='secure_external_vault')throw new HttpsError('failed-precondition','Un fichier consultable doit provenir du coffre individuel documenté.');
              const file=qualifySellerTaxCopy(p.copyFile,{ownerId:d.ownerId!,year:d.year,nativeDeclarationHash:command.declaration.contentHash,documentReferenceId:declaration.documentReferenceId,
                filingReferenceHash:supportSourceHash(reference(p.filingReference)),deliveredFileHash:p.deliveredFileHash});
              body.copyFile={artifactId:file.artifactId,generation:file.generation,contentHash:file.contentHash,contentType:file.contentType,sizeBytes:file.sizeBytes,individualization:file.individualization};
              body.individualizationBasis=file.individualizationBasis;body.legalAuthenticityVerified=false;
            }
          }
        }
      }else if(action==='credit_note_record'){
        if(command.source.kind!=='purchase_refund'||!taxId(command.source.refundIntentId))throw new HttpsError('invalid-argument','Allocation de remboursement requise.');
        const refundIntentId=command.source.refundIntentId;
        const order=(await tx.get(db.collection('transactions').doc(command.source.id))).data(),allocation=(await tx.get(db.collection('transactions').doc(command.source.id).collection('refund_allocations').doc(refundIntentId))).data(),
          counter=(await tx.get(db.collection('platform_ledger').doc('purchase_refund_'+supportHash([command.source.id,refundIntentId])))).data(),p=imported!.payload;
        supportObject(p,['recipientOwnerId','transactionId','refundIntentId','documentKind','issuedAt','gstCents','qstCents','buyerFeeCents','registrationEvidencePresent','originalInvoiceReferenceHash','creditNoteFile']);
        if(!order||order.buyerId!==d.ownerId||!allocation||!counter||counter.sourceHash!==supportSourceHash(counter.source)||counter.transactionId!==command.source.id||counter.refundIntentId!==refundIntentId||
          counter.source?.transactionId!==command.source.id||counter.source?.refundIntentId!==refundIntentId||counter.source?.buyerId!==order.buyerId||counter.source?.sellerId!==order.sellerId||
          counter.source?.reservationHash!==allocation.reservationHash||counter.source?.termsHash!==supportHash(allocation.terms)||
          p.recipientOwnerId!==d.ownerId||p.transactionId!==command.source.id||p.refundIntentId!==refundIntentId||p.documentKind!=='credit_note'||
          p.gstCents!==allocation.terms?.refund?.gstCents||p.qstCents!==allocation.terms?.refund?.qstCents||p.buyerFeeCents!==allocation.terms?.refund?.buyerFeeCents||
          p.gstCents!==exactCents(Math.abs(counter.gst))||p.qstCents!==exactCents(Math.abs(counter.qst))||p.buyerFeeCents!==exactCents(Math.abs(counter.serviceFee))||counter.gst>0||counter.qst>0||counter.serviceFee>0||p.registrationEvidencePresent!==true||
          !taxHash(p.originalInvoiceReferenceHash)||!op.identityAvailable||p.gstCents>0&&!op.gstRegistrationDocumented||p.qstCents>0&&!op.qstRegistrationDocumented||
          typeof p.issuedAt!=='string'||!Number.isFinite(Date.parse(p.issuedAt))||Date.parse(p.issuedAt)>Date.now())throw new HttpsError('failed-precondition','Note de crédit, inscription ou composantes originales à rapprocher.');
        const quote=taxId(order.shippingQuoteId)?(await tx.get(db.collection('shipping_quotes').doc(order.shippingQuoteId))).data():null,accepted=quote&&acceptedQuotePurchasePolicy(order,command.source.id,quote)?acceptedPurchaseTaxSnapshot(order,quote):null;
        let intent=order.refund;if(intent?.intentId!==refundIntentId)try{intent=await readAllocationHistoryIntent(tx,command.source.id,order,refundIntentId);}catch{intent=null;}
        const originalComponentsQualified=!!accepted&&p.gstCents<=exactCents(accepted.gst)!&&p.qstCents<=exactCents(accepted.qst)!,currentSettled=!!intent&&!!await readSettledAllocationIntent(tx,command.source.id,order,intent);
        body={...body,source:command.source,state:'external_credit_note_recorded',currentAccountingQualification:counter.qualification==='qualified'&&originalComponentsQualified&&currentSettled?'native_components_and_settlement_observed':'unknown',
          originalInvoiceAuthenticityVerified:false,issuedAt:p.issuedAt,originalInvoiceReferenceHash:p.originalInvoiceReferenceHash,
          gstCents:p.gstCents,qstCents:p.qstCents,buyerFeeCents:p.buyerFeeCents,evidence:imported!.proof,registrationLegallyVerified:false};collection='credit_notes';
        if(p.creditNoteFile!==undefined){
          const binding=await creditNoteBinding(tx,d.ownerId!,d.year,body),file=qualifySellerTaxCreditNoteFile(p.creditNoteFile,binding);
          body.nativeCreditNoteSourceHash=binding.nativeSourceHash;
          body.creditNoteFile={artifactId:file.artifactId,generation:file.generation,contentHash:file.contentHash,contentType:file.contentType,sizeBytes:file.sizeBytes,individualization:file.individualization};
        }
      }else body={...body,reasonCode:command.reasonCode,state:'assistance_requested',identifierValueProvided:false,accountRestrictedByThisAction:false};
      // All source, ledger, previous document and private-role reads precede
      // the first write. Evidence payloads never enter these documents.
      const contentHash=supportSourceHash(body);if(Buffer.byteLength(JSON.stringify(body),'utf8')>650000)throw new HttpsError('resource-exhausted','Dossier fiscal borné dépassé.');
      for(const plan of plans)plan.commit();const documentReference=storeDocument(tx,ref,collection,id,body);
      if(action==='snapshot')next.lastSnapshot=documentReference;if(action==='declaration_prepare')next.lastDeclaration=documentReference;
      tx.set(ref,next);tx.set(cref,{...receipt,status:'completed',versionAfter:next.version,documentReference,completedAt:now,reason:null,documentHash:contentHash});
    });return read(request,{...d,mode:'observe',command:null});
  });
}
