import { describe, expect, it } from 'vitest';
import type { IssueRefundResult, Transaction } from '@/types/transaction';
import { Timestamp } from 'firebase/firestore';
import { canRetryRefund, getPaymentBlockReason, getRefundPresentation, hasBankObligation, hasUnsettledRefund, isRefundConfirmed, refundResultPresentation } from './refundPresentation';

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({id: 'sale', buyerId: 'buyer', sellerId: 'seller', articleId: 'article', amount: 50, totalAmount: 50, shippingCost: 0, deliveryType: 'shipping', status: 'refund_in_progress', createdAt: new Date(), ...overrides});
const result = (status: IssueRefundResult['status']): IssueRefundResult => ({success: status === 'succeeded', status, intentId: 'intent', refundId: 're', outstandingCardCents: status === 'succeeded' ? 0 : 4000, localReconciliationRequired: false, bankWaiting: false, actionRequired: status !== 'pending' && status !== 'succeeded', message: 'Dossier en cours.'});
type ProofOverrides = {root?: Record<string, unknown>; refund?: Record<string, unknown>; bank?: Record<string, unknown>};
const projectedBankTx = ({root = {}, refund = {}, bank = {}}: ProofOverrides = {}): Transaction => tx({
  refundBlocked: true, stripePaymentIntentId: 'pi', capturedCardCents: 4000, paidVia: 'mixed', walletAmountUsed: 1000, ...root,
  bankDispute: {id: 'dp', state: 'closed', outcome: 'lost', amountCents: 4000, closedAt: new Date(), ledgerReconciledAt: new Date(), ...bank},
  refund: {intentId: 'i', state: 'reconciliation_required', paymentIntentId: 'pi', currency: 'cad', capturedCardCents: 4000,
    cardAmountCents: 4000, cardSatisfiedVia: 'chargeback', outstandingCardCents: 0, walletAmountCents: 1000, localOutstandingWalletCents: 0, ...refund},
} as unknown as Partial<Transaction>);
const prefixBankTx = ({root = {}, refund = {}, bank = {}}: ProofOverrides = {}): Transaction => projectedBankTx({
  root: {status: 'refunded', refundedVia: 'chargeback', ...root}, bank,
  refund: {bankSettlementAt: new Date(), cardSatisfiedVia: null, outstandingCardCents: 4000, localOutstandingWalletCents: 1000, ...refund},
});

describe('Independent refund proof presentation', () => {
  it.each(['pending', 'requires_action', 'unknown', 'failed', 'canceled', 'reconciliation_required'] as const)('%s is not financial success', state => {
    expect(isRefundConfirmed(result(state))).toBe(false);
    expect(refundResultPresentation(result(state)).title).not.toBe('Remboursement confirmé');
  });
  it('requires explicit settled identity, zero and local proof from the result', () => {
    expect(isRefundConfirmed(result('succeeded'))).toBe(true);
    expect(isRefundConfirmed({...result('succeeded'), outstandingCardCents: null})).toBe(false);
    expect(isRefundConfirmed({...result('succeeded'), intentId: null})).toBe(false);
    expect(isRefundConfirmed({...result('succeeded'), localReconciliationRequired: true})).toBe(false);
  });
  it('unknown amount remains unknown, never zero', () => {
    const view = getRefundPresentation(tx({refund: {intentId: 'intent', state: 'unknown', outstandingCardCents: null}}), 'buyer');
    expect(view?.lines).toContain('Montant sur le moyen de paiement à vérifier.');
    expect(view?.confirmed).toBe(false);
  });
  it('card success with blocked local ledger remains open without inventing card debt', () => {
    const view = getRefundPresentation(tx({refundBlocked: true, refund: {intentId: 'intent', state: 'reconciliation_required', providerStatus: 'succeeded', cardConfirmedCents: 4000, cardSatisfiedVia: 'stripe', outstandingCardCents: 0, walletAmountCents: 1000}}), 'buyer');
    expect(view?.lines.join(' ')).toContain('moyen de paiement d’origine confirmé');
    expect(view?.lines.join(' ')).not.toContain('Portion réglée par la banque');
    expect(view?.lines.join(' ')).not.toContain('restant à traiter');
    expect(view?.lines.join(' ')).toContain('traitement du solde');
    expect(view?.confirmed).toBe(false);
  });
  it('late failure preserves wallet application but reopens card action', () => {
    const view = getRefundPresentation(tx({status: 'refund_action_required', refund: {intentId: 'intent', state: 'failed', outstandingCardCents: 4000, fundsAppliedAt: new Date(), walletAmountCents: 1000}}), 'buyer');
    expect(view?.title).toBe('Remboursement à reprendre');
    expect(view?.lines.join(' ')).toContain('Restitué dans votre porte-monnaie');
    expect(view?.confirmed).toBe(false);
  });
  it('bank waiting is distinct from permanent reconciliation', () => {
    expect(getRefundPresentation(tx({refund: {intentId: 'intent', state: 'pending', bankWaiting: true}}), 'buyer')?.title).toBe('En attente de la décision bancaire');
    expect(getRefundPresentation(tx({refund: {intentId: 'intent', state: 'reconciliation_required'}}), 'buyer')?.title).toBe('Remboursement à vérifier');
  });
  it('legacy refunded without intent is not a confirmed refund', () => {
    expect(getRefundPresentation(tx({status: 'refunded'}), 'buyer')?.confirmed).toBe(false);
  });
  it('outer terminal status cannot hide independent liability', () => {
    expect(hasUnsettledRefund(tx({status: 'completed', refundBlocked: true}))).toBe(true);
  });
  it('admits failed retry despite refundBlocked and refuses bank/legacy/unknown', () => {
    const eligible = tx({refundBlocked: true, refund: {intentId: 'i', state: 'failed', providerStatus: 'failed', paymentIntentId: 'pi', stripeRefundId: 're', cardAmountCents: 4000, outstandingCardCents: 4000}});
    expect(canRetryRefund(eligible)).toBe(true);
    expect(canRetryRefund({...eligible, bankDispute: {state: 'open'}})).toBe(false);
    expect(canRetryRefund({...eligible, refundLegacyReconciliationRequired: true})).toBe(false);
    expect(canRetryRefund({...eligible, refund: {...eligible.refund, state: 'unknown'}})).toBe(false);
    expect(canRetryRefund({...eligible, refund: {...eligible.refund, outstandingCardCents: null}})).toBe(false);
  });
  it('bank closed without closure proof stays blocked; qualified legacy closure does not', () => {
    expect(hasBankObligation(tx({bankDispute: {id: 'dp', state: 'closed', outcome: 'won'}}))).toBe(true);
    expect(hasBankObligation(tx({bankDispute: {id: 'dp', state: 'closed', outcome: 'won', closedAt: new Date()}}))).toBe(false);
    expect(hasBankObligation(tx({disputeFreezeCents: 1000}))).toBe(true);
    expect(hasBankObligation(tx({disputeFreezeCents: 1000, disputeId: 'dp', disputeOutcome: 'won', disputeClosedAt: new Date()}))).toBe(false);
  });
  it('qualified bank settlement is shown separately even without a Stripe refund', () => {
    const view = getRefundPresentation(projectedBankTx({root: {status: 'refunded'}, refund: {state: 'succeeded', fundsAppliedAt: new Date(), cardConfirmedCents: 0}}), 'buyer');
    expect(view?.lines.join(' ')).toContain('Portion réglée par la banque');
    expect(view?.lines.join(' ')).not.toContain('d’origine confirmé');
  });
  it('bank full loss can prove the wallet portion while the whole refund remains blocked', () => {
    const view = getRefundPresentation(projectedBankTx({bank: {reconciliationRequired: true}}), 'buyer');
    expect(view?.lines.join(' ')).toContain('Restitué dans votre porte-monnaie');
    expect(view?.lines.join(' ')).not.toContain('porte-monnaie en attente');
    expect(view?.confirmed).toBe(false);
  });
  it.each([
    {bank: {amountCents: 2000}}, {bank: {ledgerReconciledAt: undefined}}, {bank: {closedAt: undefined}},
    {bank: {state: 'open' as const}}, {bank: {outcome: 'won' as const}}, {bank: {id: ''}},
    {refund: {localOutstandingWalletCents: null}}, {refund: {localOutstandingWalletCents: undefined}},
  ])('does not claim wallet restitution with incomplete bank proof %j', changes => {
    const view = getRefundPresentation(projectedBankTx(changes), 'buyer');
    expect(view?.lines.join(' ')).toContain('Restitution dans votre porte-monnaie en attente');
    expect(view?.confirmed).toBe(false);
  });
  it('pending_payment alone cannot admit a new payment with independent obligations', () => {
    expect(getPaymentBlockReason(tx({status: 'pending_payment'}), 'buyer')).toBeNull();
    expect(getPaymentBlockReason(tx({status: 'pending_payment', refundBlocked: true}), 'buyer')).toBe('financial_obligation');
    expect(getPaymentBlockReason(tx({status: 'pending_payment', bankDispute: {id: 'dp', state: 'open'}}), 'buyer')).toBe('financial_obligation');
    expect(getPaymentBlockReason(tx({status: 'pending_payment'}), 'other')).toBe('forbidden');
  });
  it('shows bank and original wallet settlement before any provider projection without completing the refund', () => {
    const view = getRefundPresentation(prefixBankTx(), 'buyer');
    expect(view?.lines.join(' ')).toContain('Portion réglée par la banque');
    expect(view?.lines.join(' ')).toContain('Restitué dans votre porte-monnaie');
    expect(view?.lines.join(' ')).not.toContain('restant à traiter');
    expect(view?.lines.join(' ')).not.toContain('porte-monnaie en attente');
    expect(view?.confirmed).toBe(false);
  });
  it.each([0, 200])('displays the original wallet credit, not the intention amount %s', intended => {
    const view = getRefundPresentation(prefixBankTx({refund: {walletAmountCents: intended, localOutstandingWalletCents: intended}}), 'buyer');
    expect(view?.lines.filter(line => line.startsWith('Restitué'))).toEqual(['Restitué dans votre porte-monnaie : 10 $.']);
    expect(view?.confirmed).toBe(false);
  });
  it('recognizes a post-observation legacy capture without inventing a pre-observation capture', () => {
    expect(getRefundPresentation(projectedBankTx({root: {capturedCardCents: undefined}}), 'buyer')?.lines.join(' ')).toContain('Portion réglée par la banque');
    expect(getRefundPresentation(prefixBankTx({root: {capturedCardCents: undefined}}), 'buyer')?.lines.join(' ')).not.toContain('Portion réglée par la banque');
  });
  it.each([
    {refund: {intentId: ''}}, {refund: {paymentIntentId: 'other'}}, {root: {stripePaymentIntentId: undefined}},
    {refund: {currency: 'usd'}}, {refund: {currency: undefined}}, {bank: {currency: 'usd'}},
    {root: {capturedCardCents: null}}, {root: {capturedCardCents: 3999}}, {refund: {capturedCardCents: NaN}},
    {refund: {cardAmountCents: Infinity}}, {refund: {cardAmountCents: 5000}}, {bank: {amountCents: '4000'}},
    {bank: {amountCents: null}}, {bank: {amountCents: 1000}}, {bank: {conflictingDisputeId: 'other'}},
    {root: {disputeId: 'other'}}, {bank: {closedAt: null}}, {bank: {ledgerReconciledAt: undefined}},
    {refund: {bankSettlementAt: null}}, {root: {refundedVia: undefined}},
  ])('does not invent prefix settlement with contradictory or incomplete proof %j', changes => {
    const view = getRefundPresentation(prefixBankTx(changes), 'buyer');
    expect(view?.lines.join(' ')).not.toContain('Portion réglée par la banque');
    expect(view?.lines.join(' ')).not.toContain('Restitué dans votre porte-monnaie');
    expect(view?.confirmed).toBe(false);
  });
  it.each([
    {root: {walletAmountUsed: undefined}}, {root: {walletAmountUsed: null}}, {root: {walletAmountUsed: NaN}},
    {root: {paidVia: 'card'}}, {root: {buyerId: ''}}, {refund: {walletAmountCents: undefined}},
    {refund: {walletAmountCents: null}}, {refund: {walletAmountCents: 1200}}, {refund: {localOutstandingWalletCents: Infinity}},
  ])('keeps incomplete or contradictory original wallet proof unconfirmed %j', changes => {
    const view = getRefundPresentation(prefixBankTx(changes), 'buyer');
    expect(view?.lines.join(' ')).toContain('Portion réglée par la banque');
    expect(view?.lines.join(' ')).not.toContain('Restitué dans votre porte-monnaie');
    expect(view?.lines.join(' ')).toContain('porte-monnaie à vérifier');
    expect(view?.confirmed).toBe(false);
  });
  it('keeps overlap open, displays independent portions and never adds a second wallet credit', () => {
    const view = getRefundPresentation(prefixBankTx({root: {refundBlocked: false}, refund: {state: 'succeeded', fundsAppliedAt: new Date(), outstandingCardCents: 0, cardConfirmedCents: 4000, providerStatus: 'succeeded'}}), 'buyer');
    expect(view?.lines.join(' ')).toContain('moyen de paiement d’origine confirmé');
    expect(view?.lines.join(' ')).toContain('Portion réglée par la banque');
    expect(view?.lines.filter(line => line.startsWith('Restitué'))).toHaveLength(1);
    expect(view?.message).toContain('dossier reste à rapprocher');
    expect(view?.confirmed).toBe(false);
  });
  it('accepts a real Timestamp settlement marker and normalized Date closure/ledger', () => {
    const view = getRefundPresentation(prefixBankTx({refund: {bankSettlementAt: Timestamp.fromDate(new Date())}}), 'buyer');
    expect(view?.lines.join(' ')).toContain('Portion réglée par la banque');
    expect(view?.confirmed).toBe(false);
  });
  it.each([true, 123, 'today', {}, {__ts: true}, [], new Date(NaN),
    {toDate: () => new Date()}, {seconds: NaN, nanoseconds: 0, toDate: () => new Date()},
    {seconds: 0, nanoseconds: 1_000_000_000, toDate: () => new Date()},
    {seconds: 0, nanoseconds: 0, toDate: () => new Date(NaN)},
    {seconds: 0, nanoseconds: 0, toDate: () => new Date('2026-01-01')},
    {seconds: 0, nanoseconds: 0, toDate: () => {throw new Error('Invalid timestamp');}},
  ])('does not accept a malformed settlement marker %j', marker => {
    const view = getRefundPresentation(prefixBankTx({refund: {bankSettlementAt: marker}}), 'buyer');
    expect(view?.lines.join(' ')).not.toContain('Portion réglée par la banque');
    expect(view?.lines.join(' ')).not.toContain('Restitué dans votre porte-monnaie');
    expect(view?.confirmed).toBe(false);
  });
  it.each(['closedAt', 'ledgerReconciledAt'])('rejects an arbitrary truthy bank timestamp %s', field => {
    const view = getRefundPresentation(prefixBankTx({bank: {[field]: {}}}), 'buyer');
    expect(view?.lines.join(' ')).not.toContain('Portion réglée par la banque');
    expect(view?.confirmed).toBe(false);
  });
  it('does not show a wallet restitution or total confirmation from a malformed fundsAppliedAt', () => {
    const view = getRefundPresentation(tx({status: 'refunded', refund: {intentId: 'i', state: 'succeeded', outstandingCardCents: 0, fundsAppliedAt: {} as Date, walletAmountCents: 1000}}), 'buyer');
    expect(view?.confirmed).toBe(false);
    expect(view?.lines.join(' ')).not.toContain('Restitué dans votre porte-monnaie');
  });
  it.each(['lost', 'won'] as const)('a qualified same-bank %s closure supersedes the old waiting marker without completing the refund', outcome => {
    const view = getRefundPresentation(prefixBankTx({bank: {outcome}, refund: {state: outcome === 'lost' ? 'reconciliation_required' : 'pending', bankWaiting: true, bankWaitingDisputeId: 'dp'}}), 'buyer');
    expect(view?.message).not.toContain('attend la décision bancaire');
    expect(view?.title).not.toContain('En attente de la décision bancaire');
    expect(view?.confirmed).toBe(false);
  });
  it('does not use a foreign-bank closure to suppress an unidentified waiting obligation', () => {
    const view = getRefundPresentation(projectedBankTx({bank: {outcome: 'won'}, refund: {state: 'pending', bankWaiting: true, bankWaitingDisputeId: 'other'}}), 'buyer');
    expect(view?.message).toContain('attend la décision bancaire');
    expect(view?.confirmed).toBe(false);
  });
});
