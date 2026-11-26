import type {BankDisputeCaseCommand,BankDisputeCaseReference} from '@/types/bankDisputeCase';
export const BANK_DISPUTE_CASE_EFFECTS=['financialEffectAuthorized','bankOutcomeEstablished','bankAcceptanceVerified','holdReleaseAuthorized','inventoryPermissionGranted'] as const;
export const bankCaseObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const bankCaseExact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
export const bankCaseHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const bankCaseProviderId=(v:unknown,prefix:string):v is string=>typeof v==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,190}$`).test(v);
export const bankCaseUid=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.length<=128&&!v.includes('/');
export const bankCaseId=(v:unknown):v is string=>bankCaseUid(v)&&v.trim()===v&&!['.','..'].includes(v)&&!/^__.*__$/.test(v);
export const bankCaseText=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v&&v===v.trim()&&v.length<=max;
export const bankCaseDate=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const bankCaseNoEffects=(v:Record<string,unknown>)=>BANK_DISPUTE_CASE_EFFECTS.every(k=>v[k]===false);
export const isBankDisputeCaseReference=(v:unknown):v is BankDisputeCaseReference=>bankCaseObject(v)&&bankCaseExact(v,['id','contentHash'])&&typeof v.id==='string'&&/^be_[a-f0-9]{64}$/.test(v.id)&&bankCaseHash(v.contentHash);
export function isBankDisputeCaseCommand(v:unknown):v is BankDisputeCaseCommand {
  if(!bankCaseObject(v)||!bankCaseExact(v,['action','scope','sourceHash','draftReference','fileIndex','text','privateReason','pieces','acknowledged'])||!['save_draft','attach_file','stage_draft','submit_evidence','accept_dispute','buyer_withdrawal'].includes(String(v.action))||!['own','admin'].includes(String(v.scope))||!bankCaseHash(v.sourceHash)||v.acknowledged!==true||(v.action==='buyer_withdrawal')!==(v.scope==='own')||!Array.isArray(v.pieces)||v.pieces.length>3)return false;
  if(!v.pieces.every(p=>bankCaseObject(p)&&bankCaseExact(p,['slot','evidenceId','evidenceHash'])&&['customer_communication','shipping_documentation','uncategorized_file'].includes(String(p.slot))&&typeof p.evidenceId==='string'&&/^pf_[a-f0-9]{64}$/.test(p.evidenceId)&&bankCaseHash(p.evidenceHash))||new Set(v.pieces.map(p=>p.slot)).size!==v.pieces.length)return false;
  const documentary=['save_draft','buyer_withdrawal'].includes(String(v.action));
  return (documentary?v.draftReference===null&&v.fileIndex===null&&bankCaseText(v.text,6000):v.action==='accept_dispute'?v.draftReference===null&&v.text===null&&v.pieces.length===0:isBankDisputeCaseReference(v.draftReference)&&v.text===null&&v.pieces.length===0)&&(v.action==='buyer_withdrawal'?v.pieces.length===0&&v.privateReason===null:bankCaseText(v.privateReason,4000))&&(v.action==='attach_file'?typeof v.fileIndex==='number'&&Number.isSafeInteger(v.fileIndex)&&v.fileIndex>=0&&v.fileIndex<=2:v.fileIndex===null);
}
/** Synchronous choice fence, independent of stored SDK receipts. */
export function createBankDisputeCaseInteraction(){let revision=0;return{invalidate:()=>{revision++;},capture:()=>{const expected=revision;return()=>{if(revision!==expected)throw new Error('Le choix ou le formulaire bancaire a changé.');};}};}
