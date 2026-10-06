import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  return { Text: (props: Record<string, unknown>) => React.createElement(RNText, props) };
});

import SwapItemCard from '@/components/swap/SwapItemCard';
import SwapSummaryBox from '@/components/swap/SwapSummaryBox';
import { SwapProposalView } from '@/features/swap/components/SwapProposalView';
import { SwapStatusView } from '@/features/swap/components/SwapStatusView';
import { getSwapStatusLabel } from '@/features/swap/presentation';
import type { SwapItemInfo } from '@/types';

const myItem: SwapItemInfo = { articleId: 'mine', title: 'Mon manteau', price: 50, size: { value: 'M', system: 'EU' } };
const theirItem: SwapItemInfo = { articleId: 'theirs', title: 'Leur robe', price: 30 };

it.each(['mine', 'their'] as const)('permet de retirer un article du côté %s et ne déduit pas son état de sa taille', variant => {
  const remove = jest.fn();
  render(<SwapItemCard item={myItem} variant={variant} onRemove={remove} />);
  fireEvent.press(screen.getByRole('button', { name: 'Retirer Mon manteau' }));
  expect(remove).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Taille M')).toBeOnTheScreen();
  expect(screen.queryByText(/Bon état/)).toBeNull();
});

it.each([true, false])('garde Vous donnez / Vous recevez pour chaque rôle (initiateur=%s)', isInitiator => {
  render(<SwapProposalView senderName="Alice" senderImage={undefined} message="Message proposé" senderItems={[theirItem]} myItems={[myItem]} cashTopUp={undefined} isInitiator={isInitiator} />);
  expect(screen.getByText(isInitiator ? 'Proposition envoyée' : 'Proposition reçue')).toBeOnTheScreen();
  expect(within(screen.getByTestId('swap-given-items')).getByText('Mon manteau')).toBeOnTheScreen();
  expect(within(screen.getByTestId('swap-received-items')).getByText('Leur robe')).toBeOnTheScreen();
  expect(screen.queryByText('Alice propose')).toBeNull();
});

it.each([
  { payerId: 'me', expected: 'Vous' },
  { payerId: 'alice', expected: 'Alice' },
  { payerId: 'missing', expected: 'Payeur à confirmer' },
])('affiche le complément historique en CAD selon le véritable payeur $payerId', ({ payerId, expected }) => {
  render(<SwapProposalView senderName="Alice" senderImage={undefined} message={undefined} senderItems={[theirItem]} myItems={[myItem]} cashTopUp={{ amount: 4500, payerId }} currentUserId="me" otherUserId="alice" />);
  expect(screen.getByText(`Complément historique : 45,00 $ CA · Payeur prévu : ${expected}.`)).toBeOnTheScreen();
});

it('convertit les cents sur le suivi et n’invente pas de lieu, distance ou remboursement', () => {
  render(<SwapStatusView status="expired" senderName="Alice" senderImage={undefined} senderItems={[theirItem]} myItems={[myItem]} cashTopUpAmount={4500} cashTopUpPayer="you" />);
  expect(screen.getByText('Échange expiré')).toBeOnTheScreen();
  expect(screen.getByText('Complément historique : 45,00 $ CA · Payeur prévu : Vous.')).toBeOnTheScreen();
  expect(screen.queryByText(/Villeray|2.8 km|remboursé/)).toBeNull();
  expect(screen.getAllByText('Mon manteau')).toHaveLength(1);
  expect(screen.getAllByText('Leur robe')).toHaveLength(1);
});

it('le récapitulatif conserve les articles et n’attribue pas un complément sans payeur', () => {
  render(<SwapSummaryBox youReceive="Leur robe" youGive="Mon manteau" receivedItems={[theirItem]} givenItems={[myItem]} cashSupplement={45} />);
  expect(screen.getByText('Leur robe')).toBeOnTheScreen();
  expect(screen.getByText('Mon manteau')).toBeOnTheScreen();
  expect(screen.getByText('Complément historique : 45,00 $ CA · Payeur prévu : Payeur à confirmer.')).toBeOnTheScreen();
});

it('nomme distinctement les propositions reçues et envoyées', () => {
  expect(getSwapStatusLabel('proposed', true)).toBe('Proposition envoyée');
  expect(getSwapStatusLabel('proposed', false)).toBe('Proposition reçue');
});


it('garde le montant et la devise CAD ensemble dans la carte article', () => {
  render(<SwapItemCard item={myItem} />);
  const value = screen.getByText('Valeur indiquée · 50,00 $ CA');
  expect(React.Children.toArray(value.props.children).join('')).toContain('50,00\u00A0$\u00A0CA');
});

it.each(['proposal', 'status'] as const)('évite un point doublé après un nom abrégé dans %s', kind => {
  if (kind === 'proposal') render(<SwapProposalView senderName="Lou Martin" senderImage={undefined} message={undefined} senderItems={[theirItem]} myItems={[myItem]} cashTopUp={{ amount: 4500, payerId: 'lou' }} currentUserId="me" otherUserId="lou" />);
  else render(<SwapStatusView status="shipping" senderName="Lou Martin" senderImage={undefined} senderItems={[theirItem]} myItems={[myItem]} cashTopUpAmount={4500} cashTopUpPayer="other" />);
  const legacy = screen.getByText('Complément historique : 45,00 $ CA · Payeur prévu : Lou M.');
  const rawCopy = React.Children.toArray(legacy.props.children).join('');
  expect(rawCopy).toContain('45,00\u00A0$\u00A0CA');
  expect(rawCopy).not.toContain('Lou M..');
});
