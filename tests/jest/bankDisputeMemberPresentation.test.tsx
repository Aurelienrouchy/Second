import React from 'react';
import {render} from '@testing-library/react-native';
import {BankDisputeCaseSummary} from '@/components/BankDisputeCaseSummary';
import {BankDisputeCaseHistoryEntry} from '@/components/BankDisputeCaseHistoryEntry';
import {BankDisputeCaseReceiptSummary} from '@/components/BankDisputeCaseReceiptSummary';
import type {BankDisputeCaseReceipt,BankDisputeCaseView} from '@/types/bankDisputeCase';

const value:BankDisputeCaseView={
  transactionId:'order-private-id',disputeId:'du_private',version:77,status:'under_review',amountCents:4310,currency:'CAD',
  dueBy:'2026-10-31T18:00:00.000Z',dueQualification:'provider_timestamp',hasEvidence:true,submissionCount:2,pastDue:false,
  providerObservedAt:'2026-10-29T18:00:00.000Z',responsibleUid:'operator-private-id',currentDraft:{id:'private-draft',contentHash:'private-hash'},currentStage:null,
  financialEffectAuthorized:false,bankOutcomeEstablished:false,bankAcceptanceVerified:false,holdReleaseAuthorized:false,inventoryPermissionGranted:false,
  currentProviderStateVerified:false,providerRestitutionVerified:false,
};

it('shows the qualified amount and dates without bank identifiers or invented financial completion',()=>{
  const view=render(<BankDisputeCaseSummary value={value} compact/>);
  expect(view.getByText('En cours d’examen')).toBeTruthy();
  expect(view.getByText(/Montant concerné : 43,10/)).toBeTruthy();
  expect(view.getByText(/Réponse attendue avant le 31 octobre 2026/)).toBeTruthy();
  const output=JSON.stringify(view.toJSON());
  expect(output).not.toMatch(/order-private-id|du_private|private-hash|private-draft|operator-private-id|fonds restitués|remboursement confirmé/i);
});

it('does not promote unqualified monetary and date fields into useful-looking facts',()=>{
  const view=render(<BankDisputeCaseSummary value={{...value,currency:null,dueQualification:'unknown',providerObservedAt:'invalid'}} compact/>);
  expect(view.queryByText(/Montant concerné|Réponse attendue avant|Dernière mise à jour/)).toBeNull();
});

it('keeps the full administrative presentation available even when compact was requested',()=>{
  const view=render(<BankDisputeCaseSummary value={value} admin compact/>);
  expect(view.getByText(/Dossier bancaire du_private/)).toBeTruthy();
  expect(view.getByText(/private-draft/)).toBeTruthy();
});

it('presents a withdrawal statement without technical historical identifiers',()=>{
  const view=render(<BankDisputeCaseHistoryEntry compact row={{qualification:'native_bank_entry',entry:{id:'private-entry',action:'buyer_withdrawal',recordedAt:'2026-10-29T18:00:00.000Z',ownStatement:'J’ai contacté ma banque.',bankOutcomeEstablished:false}}}/>);
  expect(view.getByText('Déclaration de retrait enregistrée')).toBeTruthy();
  expect(view.getByText('J’ai contacté ma banque.')).toBeTruthy();
  expect(JSON.stringify(view.toJSON())).not.toMatch(/private-entry|source|empreinte|restitution/i);
});

it('keeps an uncertain submission uncertain without echoing private refusal details',()=>{
  const receipt={state:'unknown',reason:'private-source-hash',recordedAt:null,command:{action:'buyer_withdrawal'},reference:{id:'private-entry',contentHash:'private-hash'},result:null,futureEffectsNeutralized:false} as unknown as BankDisputeCaseReceipt;
  const view=render(<BankDisputeCaseReceiptSummary value={receipt} compact/>);
  expect(view.getByText('L’envoi reste à vérifier.')).toBeTruthy();
  expect(JSON.stringify(view.toJSON())).not.toMatch(/private-|enregistrée|remboursement confirmé/);
});
