import { adminReview, callableIO, clearQueryClients, establishSession, queryWrapper, resetEnvironment } from '../auth-onboarding/eligibilityTestHarness';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AdminEligibilityScreen from '@/app/admin/eligibility';

beforeEach(async () => {
  await resetEnvironment(); await establishSession('admin');
  const detail = adminReview();
  callableIO.mockImplementation(async name => {
    if (name === 'listAdminEligibilityReviews') return { data: { items: [detail.request], cursor: null, hasMore: false } };
    if (name === 'getAdminEligibilityReview') return { data: detail };
    if (name === 'decideEligibilityReview') return { data: { recorded: true, alreadyRecorded: false,
      request: detail.request, eligibility: detail.eligibility } };
    throw new Error(`Unexpected callable ${name}`);
  });
});
afterEach(clearQueryClients);
const decisions = () => callableIO.mock.calls.filter(([name]) => name === 'decideEligibilityReview').map(([, payload]) => payload);
async function prepareWithS1() {
  const { Wrapper } = queryWrapper(); render(<AdminEligibilityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByRole('button', { name: /review-owner · Précisions demandées/ })).toBeOnTheScreen());
  fireEvent.press(screen.getByRole('button', { name: /review-owner · Précisions demandées/ }));
  await waitFor(() => expect(screen.getByLabelText('Terminer cet examen')).toBeOnTheScreen());
  fireEvent.press(screen.getByLabelText('Terminer cet examen'));
  fireEvent.changeText(screen.getByLabelText('Motif visible par le propriétaire'), 'Examen terminé après vérification.');
  fireEvent.changeText(screen.getByLabelText('Note interne privée'), 'Contexte privé conservé.');
  fireEvent.press(screen.getByLabelText('Clore le signal s1'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vérifier la décision' })).toBeEnabled());
  fireEvent.press(screen.getByRole('button', { name: 'Vérifier la décision' }));
  expect(screen.getByText('Signaux à clore : s1')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Enregistrer la décision' })).toBeEnabled();
}

it('invalidates s1 confirmation when choosing s2 and sends only the reconfirmed signal with exact versions', async () => {
  await prepareWithS1();
  fireEvent.press(screen.getByLabelText('Clore le signal s1'));
  fireEvent.press(screen.getByLabelText('Clore le signal s2'));
  expect(screen.queryByRole('button', { name: 'Enregistrer la décision' })).toBeNull();
  expect(decisions()).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'Vérifier la décision' }));
  expect(screen.getByText('Signaux à clore : s2')).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Enregistrer la décision' }));
  await waitFor(() => expect(decisions()).toHaveLength(1));
  expect(decisions()[0]).toEqual({ reviewId: 'review-owner', outcome: 'complete_review',
    ownerReason: 'Examen terminé après vérification.', internalNote: 'Contexte privé conservé.',
    expectedVersion: 'a'.repeat(64), expectedRequestVersion: 7, clearSignalIds: ['s2'], requestId: expect.any(String) });
});

it('requires new confirmation after clearing the entire selected signal set', async () => {
  await prepareWithS1(); fireEvent.press(screen.getByLabelText('Clore le signal s1'));
  expect(screen.queryByRole('button', { name: 'Enregistrer la décision' })).toBeNull();
  expect(decisions()).toHaveLength(0);
  fireEvent.press(screen.getByRole('button', { name: 'Vérifier la décision' }));
  expect(screen.queryByText(/Signaux à clore :/)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Enregistrer la décision' }));
  await waitFor(() => expect(decisions()).toHaveLength(1));
  expect(decisions()[0]).toEqual({ reviewId: 'review-owner', outcome: 'complete_review',
    ownerReason: 'Examen terminé après vérification.', internalNote: 'Contexte privé conservé.',
    expectedVersion: 'a'.repeat(64), expectedRequestVersion: 7, clearSignalIds: [], requestId: expect.any(String) });
});
