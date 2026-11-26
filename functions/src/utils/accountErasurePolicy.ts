/** Operational choices delegated by the owner on 2026-11-25. This module does
 * not appoint an RPR, manufacture a statutory basis or certify a provider. */
import {Timestamp} from 'firebase-admin/firestore';
import type {AccountErasurePolicy,ErasureDisposition} from './accountErasureRuntime';
export const ACCOUNT_ERASURE_POLICY_VERSION='seconde-erasure-2026-11-25-v1';
export const ACCOUNT_ERASURE_POLICY={ordinary:'erase_on_request',localContractYears:3,closedReceiptDays:90,
  openCaseReviewDays:30,minimalExecutionProofYears:3,observationKeyDays:30,
  externalRetention:{googleLoggingDefaultDays:30,googleLoggingRequiredDays:400,geminiAbuseMonitoringDays:55},
  accounting:'six_years_after_last_relevant_fiscal_year_end',legalAuthorityAutomaticallyVerified:false,rprAutomaticallyDesignated:false} as const;
type Data=FirebaseFirestore.DocumentData;
const erase=():ErasureDisposition=>({action:'erase',purpose:null,reviewAt:null});
const review=():ErasureDisposition=>({action:'review',purpose:null,reviewAt:null});
const time=(value:unknown):value is Timestamp=>value instanceof Timestamp&&value.toMillis()>0&&value.toMillis()<=Date.now();
function yearsAfter(value:Timestamp,years:number){const date=value.toDate();date.setUTCFullYear(date.getUTCFullYear()+years);return Timestamp.fromDate(date);}
export function accountErasureTerminalTime(source:Data):Timestamp|null{
  const candidate=source.status==='meetup_completed'?source.meetupCompletedAt??source.completedAt:
    source.status==='completed'?source.completedAt:source.status==='declined'?source.declinedAt:
      source.status==='cancelled'?source.localCancellation?.cancelledAt??source.initiatorCancellation?.cancelledAt??source.cancelledAt:null;
  // updatedAt or a worker's wall clock cannot fabricate a business outcome.
  return time(candidate)?candidate:null;
}
export function createAccountErasurePolicy(dependencies:Pick<AccountErasurePolicy,'processors'|'apple'|'writerQualification'>):AccountErasurePolicy{
  const decision:AccountErasurePolicy['disposition']=(category,source)=>{
    if(category==='contracts'){
      const concluded=source.cashAgreement?.acceptedAt??source.acceptedAt,terminal=accountErasureTerminalTime(source);
      if(!time(concluded)||!terminal||terminal.toMillis()<concluded.toMillis())return review();
      const end=yearsAfter(terminal,3);
      return end.toMillis()>Date.now()?{action:'retain',purpose:'private_local_agreement_and_outcome_recours',reviewAt:end}:review();
    }
    if(category==='support'){
      const terminal=source.closedAt??source.resolvedAt;
      if(!['closed','resolved'].includes(source.status)||!time(terminal))return review();
      // An unqualified hold is not silently released by this operation. The
      // native preservation guard is checked separately for every mutation.
      return erase();
    }
    if(category==='media'&&Array.isArray(source.retainedContracts)&&source.retainedContracts.length){
      const obligations=source.retainedContracts.map((s:Data)=>decision('contracts',s,{}));
      if(obligations.some((d:ErasureDisposition)=>d.action!=='retain'))return review();
      return {action:'retain',purpose:'private_contract_article_evidence',reviewAt:Timestamp.fromMillis(Math.max(...obligations.map((d:ErasureDisposition)=>d.reviewAt!.toMillis())))};
    }
    return erase();
  };
  return {version:ACCOUNT_ERASURE_POLICY_VERSION,disposition:decision,...dependencies};
}
