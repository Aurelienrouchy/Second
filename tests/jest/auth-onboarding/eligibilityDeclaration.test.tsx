import {getEnvironmentStorageKey} from '@/config/firebaseEnvironment';
import { activityRecorded, activityHistory, callableIO, clearQueryClients, establishSession, ownerEligibility, queryWrapper, resetEnvironment } from './eligibilityTestHarness';
import React from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import EligibilityScreen from '@/app/settings/eligibility';
import { queryKeys } from '@/lib/queryKeys';
import type { OwnerEligibility } from '@/types/eligibility';

let dto: OwnerEligibility;
beforeEach(async () => {
  Object.defineProperty(AppState, 'currentState', {value: 'active', configurable: true, writable: true});
  await resetEnvironment(); await establishSession('owner'); dto = ownerEligibility();
  callableIO.mockImplementation(async (name, payload) => {
    if (name === 'getMyEligibility') return { data: payload && typeof payload === 'object' && 'operation' in payload && payload.operation === 'seller_activity_history' ? activityHistory(dto) : dto };
    if (name === 'listMyEligibilityReviews') return { data: { items: [], cursor: null, hasMore: false } };
    if (name === 'declareSellerActivity') return {data: activityRecorded(payload as import('@/types/eligibility').DeclareSellerActivityInput, dto)};
    throw new Error(`Unexpected callable ${name}`);
  });
});
afterEach(clearQueryClients);
const declarations = () => callableIO.mock.calls.filter(([name]) => name === 'declareSellerActivity').map(([, payload]) => payload);
async function acceptPersonal() {
  await waitFor(() => expect(screen.getByLabelText('Je vends mes articles personnels')).toBeOnTheScreen());
  fireEvent.press(screen.getByLabelText('Je vends mes articles personnels'));
  fireEvent.press(screen.getByLabelText(dto.statements.personal));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer ma déclaration' })).toBeEnabled());
}

it.each(['text', 'version'] as const)('requires explicit reacceptance after a server declaration %s change', async change => {
  const { client, Wrapper } = queryWrapper(); render(<EligibilityScreen />, { wrapper: Wrapper });
  await acceptPersonal();
  dto = change === 'text' ? { ...dto, statements: { ...dto.statements, personal: 'Je confirme le texte mis à jour.' } }
    : { ...dto, statementVersion: 'statement-2' };
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.eligibility.owner('owner') }); });
  await waitFor(() => expect(screen.getByLabelText(dto.statements.personal)).toHaveProp('accessibilityState', { checked: false, disabled: false }));
  const submit = screen.getByRole('button', { name: 'Enregistrer ma déclaration' });
  expect(submit).toBeDisabled(); fireEvent.press(submit); expect(declarations()).toHaveLength(0);
  fireEvent.press(screen.getByLabelText(dto.statements.personal));
  await waitFor(() => expect(submit).toBeEnabled()); fireEvent.press(submit);
  await waitFor(() => expect(declarations()).toHaveLength(1));
  expect(declarations()[0]).toEqual({ kind: 'personal', statementVersion: dto.statementVersion,
    personalDeclarationAccepted: true, expectedVersion: dto.version, requestId: expect.any(String) });
});

it('preserves the exact uncertain declaration and request ID across a policy change and remount', async () => {
  const normalResponse = callableIO.getMockImplementation()!;
  let attempts = 0;
  callableIO.mockImplementation(async (name, payload) => {
    if (name === 'declareSellerActivity' && ++attempts === 1) throw Object.assign(new Error('Response unavailable'), { code: 'functions/unavailable' });
    return normalResponse(name, payload);
  });
  const first = queryWrapper(); const view = render(<EligibilityScreen />, { wrapper: first.Wrapper });
  await acceptPersonal(); fireEvent.press(screen.getByRole('button', { name: 'Enregistrer ma déclaration' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Relire puis reprendre la tentative' })).toBeEnabled());
  const sent = declarations()[0];
  expect(sent).toEqual({ kind: 'personal', statementVersion: 'statement-1', personalDeclarationAccepted: true,
    expectedVersion: 'a'.repeat(64), requestId: expect.any(String) });
  const saved = await AsyncStorage.getItem(getEnvironmentStorageKey('eligibility_operation_owner_declare'));
  expect(saved).not.toBeNull();
  expect(JSON.parse(saved!)).toEqual({ uid: 'owner', payload: sent });
  view.unmount(); first.client.clear();
  dto = ownerEligibility({ version: 'b'.repeat(64), statementVersion: 'statement-2',
    statements: { personal: 'Texte neuf à accepter pour un nouvel envoi.', professional: 'Texte professionnel neuf.' } });
  const reopened = queryWrapper(); render(<EligibilityScreen />, { wrapper: reopened.Wrapper });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Relire puis reprendre la tentative' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Enregistrer ma déclaration' })).toBeDisabled();
  expect(declarations()).toHaveLength(1);
  fireEvent.press(screen.getByRole('button', { name: 'Relire puis reprendre la tentative' }));
  await waitFor(() => expect(declarations()).toHaveLength(2));
  expect(declarations()[1]).toEqual(sent);
  await waitFor(async () => expect(await AsyncStorage.getItem(getEnvironmentStorageKey('eligibility_operation_owner_declare'))).toBeNull());
});

it('records professional activity without claiming the personal declaration was accepted', async () => {
  const { Wrapper } = queryWrapper(); render(<EligibilityScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByLabelText('Je vends dans le cadre d’une activité professionnelle')).toBeOnTheScreen());
  fireEvent.press(screen.getByLabelText('Je vends dans le cadre d’une activité professionnelle'));
  fireEvent.press(screen.getByLabelText(dto.statements.professional));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer ma déclaration' })).toBeEnabled());
  fireEvent.press(screen.getByRole('button', { name: 'Enregistrer ma déclaration' }));
  await waitFor(() => expect(declarations()).toHaveLength(1));
  expect(declarations()[0]).toEqual({ kind: 'professional', statementVersion: 'statement-1', personalDeclarationAccepted: false,
    expectedVersion: 'a'.repeat(64), requestId: expect.any(String) });
});
