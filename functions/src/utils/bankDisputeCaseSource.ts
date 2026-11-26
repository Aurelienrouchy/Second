/** Private bank-case observations. No balance or commercial state is changed. */
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {getStripe} from '../config/stripe';
import {supportHash,supportSourceHash,supportRevision} from './supportRequest';
import {exactCents} from './shippingPurchaseRate';
import {productReviewCaseRef} from './productReviewSource';
import {financialRecoverySourceFields,financialRecoverySourceHash,type FinancialRecoveryDomain} from './financialRecoverySources';
import {FinancialRecoveryBlocked} from './financialRecoveryInterlock';

/** Documentary recovery can preserve facts/notes after closure, but must never
 * turn an existing unqualified/restored source into current financial authority.
 * A changed source is either requalified normally or its witness is invalidated. */
export async function bankDocumentarySourceFields(domain:FinancialRecoveryDomain,ref:FirebaseFirestore.DocumentReference,
  current:FirebaseFirestore.DocumentSnapshot|FirebaseFirestore.DocumentData,patch:FirebaseFirestore.DocumentData){
  const snapshot=typeof current.data==='function'&&typeof current.exists==='boolean'?current as FirebaseFirestore.DocumentSnapshot:null;
  const before=snapshot?snapshot.data():current;
  try{
    if(before&&financialRecoverySourceHash(domain,before)===financialRecoverySourceHash(domain,{...before,...patch}))return patch;
    return await financialRecoverySourceFields(domain,ref,current,patch);
  }
  catch(error){if(!(error instanceof FinancialRecoveryBlocked))throw error;return {...patch,financialRecoveryWitness:null};}
}
export const bankCaseRef=(id:string)=>db.collection('bank_dispute_cases').doc(id);
export const bankNative=(v:any):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
export const bankId=(v:any,prefix:string):v is string=>typeof v==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,190}$`).test(v);
export const bankStripeId=(v:any):string|null=>typeof v==='string'?v:typeof v?.id==='string'?v.id:null;
export const BANK_STATUSES=['needs_response','under_review','warning_needs_response','warning_under_review','won','lost','warning_closed','prevented'] as const;
type NativeDispute=Awaited<ReturnType<NonNullable<ReturnType<typeof getStripe>>['disputes']['retrieve']>>;
export type BankEnhancedEvidence=NativeDispute['evidence']['enhanced_evidence'];
export type BankEvidence=Record<string,string|null|BankEnhancedEvidence>;
const evidenceFields=['access_activity_log','billing_address','cancellation_policy','cancellation_policy_disclosure','cancellation_rebuttal',
  'customer_communication','customer_email_address','customer_name','customer_purchase_ip','customer_signature','duplicate_charge_documentation',
  'duplicate_charge_explanation','duplicate_charge_id','product_description','receipt','refund_policy','refund_policy_disclosure','refund_refusal_explanation',
  'service_date','service_documentation','shipping_address','shipping_carrier','shipping_date','shipping_documentation','shipping_tracking_number','uncategorized_file','uncategorized_text'];
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const keys=(v:any,allowed:string[])=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
const nullableStrings=(v:any,names:string[])=>names.every(k=>Object.prototype.hasOwnProperty.call(v,k)&&(v[k]===null||typeof v[k]==='string'));
function enhancedEvidence(v:any):v is BankEnhancedEvidence {
  if(!keys(v,['visa_compliance','visa_compelling_evidence_3']))return false;
  if(Object.prototype.hasOwnProperty.call(v,'visa_compliance')&&
    (!keys(v.visa_compliance,['fee_acknowledged'])||typeof v.visa_compliance.fee_acknowledged!=='boolean'))return false;
  if(!Object.prototype.hasOwnProperty.call(v,'visa_compelling_evidence_3'))return true; // Native {} is ordinary, empty evidence.
  const ce=v.visa_compelling_evidence_3;
  if(!keys(ce,['disputed_transaction','prior_undisputed_transactions'])||!Object.prototype.hasOwnProperty.call(ce,'disputed_transaction')||
    !Array.isArray(ce.prior_undisputed_transactions)||ce.prior_undisputed_transactions.length>2)return false;
  const text=['customer_account_id','customer_device_fingerprint','customer_device_id','customer_email_address','customer_purchase_ip','product_description'];
  const address=(a:any)=>a===null||keys(a,['city','country','line1','line2','postal_code','state'])&&nullableStrings(a,['city','country','line1','line2','postal_code','state']);
  const disputed=ce.disputed_transaction;
  if(disputed!==null&&(!keys(disputed,[...text,'merchandise_or_services','shipping_address'])||!nullableStrings(disputed,text)||
    ![null,'merchandise','services'].includes(disputed.merchandise_or_services)||!address(disputed.shipping_address)))return false;
  return ce.prior_undisputed_transactions.every((prior:any)=>keys(prior,[...text,'charge','shipping_address'])&&nullableStrings(prior,text)&&
    bankId(prior.charge,'ch')&&address(prior.shipping_address));
}
function evidence(v:any):v is BankEvidence {
  return object(v)&&Object.keys(v).length<=50&&Object.entries(v).every(([k,value])=>k==='enhanced_evidence'?enhancedEvidence(value):
    evidenceFields.includes(k)&&(value===null||typeof value==='string'))&&Buffer.byteLength(JSON.stringify(v),'utf8')<=200000;
}
/** Stripe updates individual evidence fields. Empty/default fields are not
 * selected material; every populated field, including enhanced programs, is. */
function evidenceSelection(v:BankEvidence){return Object.fromEntries(Object.entries(v).filter(([k,value])=>value!==null&&value!==''&&
  !(k==='enhanced_evidence'&&object(value)&&Object.keys(value).length===0)));}
export function bankEvidenceSelectionMatches(v:BankEvidence,selected:Record<string,string>){return supportSourceHash(evidenceSelection(v))===supportSourceHash(selected);}
export function bankEvidenceHasUnselected(v:BankEvidence,selected:Record<string,string>){return Object.keys(evidenceSelection(v)).some(k=>!Object.prototype.hasOwnProperty.call(selected,k));}
export function bankProviderSemantic(d:any){
  if(d?.object!=='dispute'||!bankId(d.id,'du')||!bankId(bankStripeId(d.payment_intent),'pi')||!bankId(bankStripeId(d.charge),'ch')||d.currency!=='cad'||
    !Number.isSafeInteger(d.amount)||d.amount<=0||typeof d.livemode!=='boolean'||!BANK_STATUSES.includes(d.status))return null;
  const details=d.evidence_details,fields=d.evidence;
  if(!evidence(fields))return null;
  const due=Number.isSafeInteger(details?.due_by)&&details.due_by>=0&&details.due_by<=253402300799?details.due_by:null;
  const transactions=Array.isArray(d.balance_transactions)&&d.balance_transactions.length<=100?d.balance_transactions.map((v:any)=>({
    id:bankStripeId(v),amountCents:Number.isSafeInteger(v?.amount)?v.amount:null,currency:typeof v?.currency==='string'?v.currency:null,
    type:typeof v?.type==='string'?v.type:null,createdSeconds:Number.isSafeInteger(v?.created)?v.created:null})):null;
  return {disputeId:d.id,paymentIntentId:bankStripeId(d.payment_intent)!,chargeId:bankStripeId(d.charge)!,currency:'CAD' as const,amountCents:d.amount,
    livemode:d.livemode,status:d.status,reason:typeof d.reason==='string'?d.reason:null,evidence:fields,evidenceHash:supportSourceHash(fields),
    dueBySeconds:due,dueQualification:due===null?'unknown':due===0?'provider_no_response_allowed':'provider_timestamp',
    hasEvidence:typeof details?.has_evidence==='boolean'?details.has_evidence:null,
    submissionCount:Number.isSafeInteger(details?.submission_count)&&details.submission_count>=0?details.submission_count:null,
    pastDue:typeof details?.past_due==='boolean'?details.past_due:null,balanceTransactions:transactions,
    operationMarker:typeof d.metadata?.seconde_bank_operation==='string'?d.metadata.seconde_bank_operation:null};
}
export type BankProvider=NonNullable<ReturnType<typeof bankProviderSemantic>>;
export async function getBankProvider(id:string){
  const stripe=getStripe();if(!stripe)throw new Error('Bank provider unavailable');
  const dispute=await stripe.disputes.retrieve(id),base=bankProviderSemantic(dispute);if(!base)throw new Error('Bank dispute identity unknown');
  const [pi,charge]=await Promise.all([stripe.paymentIntents.retrieve(base.paymentIntentId),stripe.charges.retrieve(base.chargeId)]);
  if(pi.id!==base.paymentIntentId||pi.currency!=='cad'||pi.livemode!==base.livemode||pi.transfer_data!=null||
    (pi.application_fee_amount!=null&&pi.application_fee_amount!==0)||pi.status!=='succeeded'||!Number.isSafeInteger(pi.amount_received)||pi.amount_received<base.amountCents||
    bankStripeId(pi.latest_charge)!==base.chargeId||charge.id!==base.chargeId||charge.currency!=='cad'||charge.livemode!==base.livemode||
    bankStripeId(charge.payment_intent)!==base.paymentIntentId||charge.amount_captured!==pi.amount_received||charge.paid!==true||
    !Number.isSafeInteger(charge.amount_refunded)||charge.amount_refunded<0||charge.amount_refunded>pi.amount_received)
    throw new Error('Bank capture/charge binding unknown');
  return {semantic:base,observedAt:Timestamp.now(),capture:{paymentIntentId:pi.id,chargeId:charge.id,capturedCents:pi.amount_received,
    refundedCents:charge.amount_refunded,providerRefunded:charge.refunded,piMetadataHash:supportSourceHash(pi.metadata)},
    semanticHash:supportSourceHash(base)};
}
export type BankObservation=Awaited<ReturnType<typeof getBankProvider>>;
export function bankNativeIdentity(order:any,observation:BankObservation){
  const p=observation.semantic,parties=[order?.buyerId,order?.sellerId],total=exactCents(order?.totalAmount),card=order?.capturedCardCents;
  const wallet=['wallet_and_card','mixed'].includes(order?.paidVia)?order.walletAmountUsed:0;
  return parties.every(v=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/'))&&parties[0]!==parties[1]&&bankNative(order?.createdAt)&&
    p.paymentIntentId===order.stripePaymentIntentId&&p.chargeId===bankStripeId(order.stripeChargeId)&&Number.isSafeInteger(card)&&card>0&&
    p.amountCents<=card&&observation.capture.capturedCents===card&&total!==null&&Number.isSafeInteger(wallet)&&wallet>=0&&card+wallet===total&&
    (order.currency==null||['CAD','cad'].includes(order.currency));
}
/** The exact case/order/PI binding, private native ledgers and product members
 * are re-read in the effect transaction. Missing/over-bound context is unknown. */
export async function readBankCaseSource(tx:FirebaseFirestore.Transaction,transactionId:string,disputeId:string,observation:BankObservation|null){
  const ref=db.collection('transactions').doc(transactionId),snap=await tx.get(ref),order=snap.data();
  if(!order)throw new Error('Native purchase unavailable');
  const parties=[order.buyerId,order.sellerId];
  if(!parties.every(v=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/'))||parties[0]===parties[1])throw new Error('Native parties unknown');
  const rootSnapshot=await tx.get(bankCaseRef(disputeId)),root=rootSnapshot.data()??null,provider=observation?.semantic??null;
  const boundId=order.bankDispute?.id===disputeId||order.disputeId===disputeId||order.bankDispute?.conflictingDisputeId===disputeId||
    root?.protocol==='bank_dispute_case_v1'&&root.transactionId===transactionId&&root.disputeId===disputeId;
  const pi=provider?.paymentIntentId??order.stripePaymentIntentId;
  let unique=false;
  if(bankId(pi,'pi')){const matches=await tx.get(db.collection('transactions').where('stripePaymentIntentId','==',pi).limit(2));unique=matches.size===1&&matches.docs[0].id===transactionId;}
  const identityQualified=!!observation&&unique&&bankNativeIdentity(order,observation);
  const rootQualified=!root||root.protocol==='bank_dispute_case_v1'&&root.disputeId===disputeId&&
    (root.transactionId===null||root.transactionId===transactionId)&&Number.isSafeInteger(root.version)&&root.version>0&&root.version<Number.MAX_SAFE_INTEGER-1;
  const qualified=identityQualified&&boundId&&rootQualified;
  const ledger=[],ledgerEntries=[];let bounded=true;
  for(const uid of parties){const rows=await tx.get(db.collection('wallets').doc(uid).collection('ledger').where('transactionId','==',transactionId).limit(101));
    if(rows.size>100)bounded=false;
    for(const row of rows.docs.slice(0,100)){const e=row.data();ledgerEntries.push({id:row.id,ownerRole:uid===order.buyerId?'buyer':'seller',
      type:typeof e.type==='string'&&e.type.length<=100?e.type:'unknown',amountCentsRecorded:Number.isSafeInteger(e.amount)&&e.amount>=0?e.amount:null,
      currency:e.currency==='CAD'?'CAD':null,debtCentsRecorded:Number.isSafeInteger(e.debtRecorded)&&e.debtRecorded>=0?e.debtRecorded:null,
      disputeId:bankId(e.disputeId,'du')?e.disputeId:null,createdAt:bankNative(e.createdAt)?e.createdAt.toDate().toISOString():null,financialAttributionVerified:false});}
    ledger.push({ownerId:uid,count:rows.size,hash:supportSourceHash(rows.docs.map(row=>({id:row.id,revision:supportRevision(row),sourceHash:supportSourceHash(row.data())})))});}
  const pr=productReviewCaseRef({kind:'order',id:transactionId}),product=(await tx.get(pr)).data()??null,members=[];
  for(const group of ['contributions','communications','evidence']){const rows=await tx.get(pr.collection(group).orderBy('__name__').limit(101));if(rows.size>100)bounded=false;
    members.push({group,count:rows.size,hash:supportSourceHash(rows.docs.map(row=>({id:row.id,revision:supportRevision(row),sourceHash:supportSourceHash(row.data())})))});}
  const intents=await tx.get(db.collection('product_review_evidence_commands').where('caseId','==',pr.id).orderBy('__name__').limit(101));if(intents.size>100)bounded=false;
  members.push({group:'evidence_intents',count:intents.size,hash:supportSourceHash(intents.docs.map(row=>({id:row.id,sourceHash:supportSourceHash(row.data())})))});
  const draft=root?.currentDraft??null,stage=root?.currentStage??null,files=[];
  if(draft&&typeof draft.id==='string')for(let i=0;i<3;i++){const file=await tx.get(bankCaseRef(disputeId).collection('files').doc(supportHash([draft.id,i])));files.push({index:i,hash:supportSourceHash(file.data()??null)});}
  const capture={protocol:'bank_case_source_v1',transactionId,disputeId,orderRevision:supportRevision(snap),orderHash:supportSourceHash(order),parties,
    provider:observation?{semantic:observation.semantic,capture:observation.capture}:null,ledger,productHash:supportSourceHash(product),members,
    draft,stage,files,responsibleUid:root?.responsibleUid??null,bounded,qualified:qualified&&bounded};
  return {ref,snap,order,parties,root,rootSnapshot,provider,capture,sourceHash:supportSourceHash(capture),qualified:qualified&&bounded,identityQualified,boundId,ledgerEntries};
}
export function bankResponseAvailable(provider:BankProvider|null){return !!provider&&['needs_response','warning_needs_response'].includes(provider.status)&&
  provider.dueBySeconds!==null&&provider.dueBySeconds>0&&provider.dueBySeconds*1000>Date.now()&&provider.pastDue===false&&provider.submissionCount!==null;}
export async function prepareBankObservation(tx:FirebaseFirestore.Transaction,transactionId:string|null,disputeId:string,observation:BankObservation|null,event?:any){
  const rootRef=bankCaseRef(disputeId),snap=await tx.get(rootRef),root=snap.data(),now=Timestamp.now();
  transactionId=transactionId??(typeof root?.transactionId==='string'?root.transactionId:null);
  const semantic=observation?.semantic??null,hash=supportSourceHash({transactionId,semantic,reason:observation?null:'current_provider_unknown'}),oref=rootRef.collection('observations').doc('bo_'+hash);
  const prior=await tx.get(oref),eventRef=event?rootRef.collection('events').doc(event.id):null,oldEvent=eventRef?await tx.get(eventRef):null;
  const alertRef=db.collection('admin_alerts').doc('bank_case_'+disputeId+'_'+hash),alert=await tx.get(alertRef);
  const malformed=!!root&&(root.protocol!=='bank_dispute_case_v1'||root.disputeId!==disputeId||root.transactionId!=null&&root.transactionId!==transactionId||!Number.isSafeInteger(root.version)||root.version<1||root.version>=Number.MAX_SAFE_INTEGER-1);
  const document={protocol:'bank_case_observation_v1',transactionId,disputeId,semantic,providerQualified:!!observation,observedAt:observation?.observedAt??now,
    financialEffectApplied:false,providerRestitutionVerified:false};
  const rootPatch=!root?{protocol:'bank_dispute_case_v1',disputeId,transactionId,version:1,latestObservation:{id:oref.id,contentHash:prior.exists?prior.data()!.contentHash:supportSourceHash(document)},
    currentDraft:null,currentStage:null,responsibleUid:null,createdAt:now,updatedAt:now}:
    !malformed&&(!root.latestObservation||root.latestObservation.id!==oref.id||root.transactionId==null&&transactionId!=null)?
      {transactionId,version:root.version+1,latestObservation:{id:oref.id,contentHash:prior.exists?prior.data()!.contentHash:supportSourceHash(document)},updatedAt:now}:null;
  const rootFields=rootPatch?await bankDocumentarySourceFields('bank_case_root',rootRef,snap,rootPatch):null;
  return ()=>{
    if(!prior.exists)tx.create(oref,{document,contentHash:supportSourceHash(document)});
    if(rootFields){if(!root)tx.create(rootRef,rootFields);else tx.update(rootRef,rootFields);}
    if(eventRef&&!oldEvent?.exists){
      const e=event.data.object,details=e?.evidence_details;
      const record={protocol:'bank_case_event_v1',eventId:event.id,eventType:event.type,disputeId,
        providerOccurredAtSeconds:Number.isSafeInteger(event.created)?event.created:null,
        providerOccurrenceQualified:Number.isSafeInteger(event.created)&&event.created>0&&event.created<=Math.floor(now.toMillis()/1000),
        nativeEvent:{paymentIntentId:bankId(bankStripeId(e?.payment_intent),'pi')?bankStripeId(e.payment_intent):null,
          chargeId:bankId(bankStripeId(e?.charge),'ch')?bankStripeId(e.charge):null,amountCents:Number.isSafeInteger(e?.amount)&&e.amount>0?e.amount:null,
          currency:typeof e?.currency==='string'&&e.currency.length===3?e.currency:null,providerStatus:BANK_STATUSES.includes(e?.status)?e.status:'unknown',
          dueBySeconds:Number.isSafeInteger(details?.due_by)&&details.due_by>=0?details.due_by:null,
          hasEvidence:typeof details?.has_evidence==='boolean'?details.has_evidence:null,
          submissionCount:Number.isSafeInteger(details?.submission_count)&&details.submission_count>=0?details.submission_count:null},
        accountScope:event.account==null&&event.context==null?'platform':'incompatible_scope',source:'signature_verified_stripe_dispatcher',
        observationId:oref.id,transactionId,receivedAt:now,financialEffectApplied:false};
      tx.create(eventRef,{...record,contentHash:supportSourceHash(record)});
    }
    if(!prior.exists&&!alert.exists)tx.create(alertRef,{kind:'bank_dispute_case',severity:observation&&!malformed?'info':'critical',refId:disputeId,transactionId,
      message:'Dossier bancaire : échéance, pièces et rapprochement à examiner. Aucun mouvement autorisé depuis cette observation.',createdAt:now,status:'open'});
  };
}
