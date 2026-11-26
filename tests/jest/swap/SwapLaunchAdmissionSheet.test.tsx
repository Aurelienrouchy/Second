import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {OwnerEligibility} from '@/types/eligibility';

const mockRead = jest.fn(), mockSend = jest.fn(), mockAllowed = jest.fn();
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => 'owner'}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/services/eligibilityService', () => ({EligibilityService: {getMine: (...args: unknown[]) => mockRead(...args), declareActivity: jest.fn()}}));
jest.mock('@/hooks/useEligibility', () => ({useEligibilityOperation: () => ({send: (...args: unknown[]) => mockSend(...args), isPending: false,
  isRestoring: false, restoreError: false, hasPendingOperation: false, pendingPayload: null})}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({focused: true, focusRevision: '1', capture: () => 'scope', assertCurrent: jest.fn()})}));
jest.mock('@/utils/eligibilityPresentation', () => ({eligibilityErrorMessage: () => 'Réessayez dans un instant.'}));
jest.mock('expo-router', () => ({router: {push: jest.fn()}}));
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react'); const {View} = require('react-native');
  return {BottomSheetModal: React.forwardRef(({children}: {children: React.ReactNode}, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({present: jest.fn(), dismiss: jest.fn()})); return <View>{children}</View>;
  }), BottomSheetScrollView: View, BottomSheetBackdrop: () => null};
});
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({top: 0, bottom: 0})}));
jest.mock('@/components/ui', () => {
  const {Text, Pressable} = require('react-native');
  return {Text, Button: ({children, disabled, onPress}: {children: React.ReactNode; disabled?: boolean; onPress?: () => void}) =>
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{disabled}}><Text>{children}</Text></Pressable>,
  Checkbox: ({children, onToggle, checked, accessibilityLabel}: {children: React.ReactNode; onToggle: () => void; checked: boolean; accessibilityLabel: string}) =>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={accessibilityLabel} accessibilityState={{checked}} onPress={onToggle}>{children}</Pressable>};
});
import {SwapLaunchAdmissionSheet} from '@/features/swap/components/shared/SwapLaunchAdmissionSheet';

let client: QueryClient;
const personal = 'Je propose mes articles personnels, à titre de particulier.';
function eligibility(reasons = ['quebec_residence_declaration_required']): OwnerEligibility {
  return {version: 'a'.repeat(64), statementVersion: 'current', statements: {personal, professional: 'Professionnel'},
    activityDeclaration: {kind: 'personal', statementVersion: 'current'},
    quebecResidenceStatementVersion: '2026-10-17.v1', quebecResidenceStatement: 'Je déclare résider au Québec.',
    swapLaunch: {allowed: reasons.length === 0, reasons, policyVersion: '2026-10-17.v1'}} as OwnerEligibility;
}
beforeEach(() => {
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  mockRead.mockReset().mockResolvedValue(eligibility()); mockSend.mockReset().mockResolvedValue({recorded: true}); mockAllowed.mockReset();
});
afterEach(() => client.clear());
const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
it('opening and an unchecked residence never declare anything', async () => {
  const view = render(<SwapLaunchAdmissionSheet visible onClose={jest.fn()} onAllowed={mockAllowed}/>, {wrapper});
  await waitFor(() => expect(view.getByLabelText('J’habite au Québec')).toBeTruthy());
  expect(view.getByLabelText('J’habite au Québec').props.accessibilityState.checked).toBe(false);
  fireEvent.press(view.getByText('Continuer'));
  expect(mockSend).not.toHaveBeenCalled(); expect(mockAllowed).not.toHaveBeenCalled();
});
it('only missing QC needs one choice and allows entry only after the fresh native read', async () => {
  let resolve!: (value: OwnerEligibility) => void;
  mockRead.mockResolvedValueOnce(eligibility()).mockImplementationOnce(() => new Promise(done => {resolve = done;}));
  const view = render(<SwapLaunchAdmissionSheet visible onClose={jest.fn()} onAllowed={mockAllowed}/>, {wrapper});
  await waitFor(() => expect(view.getByLabelText('J’habite au Québec')).toBeTruthy());
  expect(view.queryByLabelText(personal)).toBeNull();
  fireEvent.press(view.getByLabelText('J’habite au Québec')); fireEvent.press(view.getByText('Continuer'));
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
  expect(mockSend.mock.calls[0][0]).toEqual({kind: 'personal', statementVersion: 'current', personalDeclarationAccepted: true,
    expectedUid: 'owner', expectedVersion: 'a'.repeat(64), quebecResidenceDeclaration: {version: '2026-10-17.v1', country: 'CA', province: 'QC', accepted: true}});
  expect(mockAllowed).not.toHaveBeenCalled();
  await act(async () => {resolve(eligibility([]));});
  expect(mockAllowed).toHaveBeenCalledTimes(1);
});
it('a late confirmation cannot reopen entry after the sheet closed', async () => {
  let resolve!: (value: OwnerEligibility) => void;
  mockRead.mockResolvedValueOnce(eligibility()).mockImplementationOnce(() => new Promise(done => {resolve = done;}));
  const view = render(<SwapLaunchAdmissionSheet visible onClose={jest.fn()} onAllowed={mockAllowed}/>, {wrapper});
  await waitFor(() => expect(view.getByLabelText('J’habite au Québec')).toBeTruthy());
  fireEvent.press(view.getByLabelText('J’habite au Québec')); fireEvent.press(view.getByText('Continuer'));
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
  view.rerender(<SwapLaunchAdmissionSheet visible={false} onClose={jest.fn()} onAllowed={mockAllowed}/>);
  await act(async () => {resolve(eligibility([]));}); expect(mockAllowed).not.toHaveBeenCalled();
});
it('a missing personal declaration needs its own explicit choice', async () => {
  mockRead.mockResolvedValue(eligibility(['activity_missing', 'quebec_residence_declaration_required']));
  const view = render(<SwapLaunchAdmissionSheet visible onClose={jest.fn()} onAllowed={mockAllowed}/>, {wrapper});
  await waitFor(() => expect(view.getByLabelText('J’échange mes affaires personnelles, sans activité professionnelle')).toBeTruthy());
  fireEvent.press(view.getByLabelText('J’habite au Québec')); fireEvent.press(view.getByText('Continuer'));
  expect(mockSend).not.toHaveBeenCalled();
});
