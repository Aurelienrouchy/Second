import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {AppState} from 'react-native';
import type {WalletInfo, WithdrawalRequest} from '@/types/wallet';

const mockPush = jest.fn(), mockWithdraw = jest.fn(), mockClearIdentity = jest.fn();
let mockWithdrawals: WithdrawalRequest[] = [];
let mockPendingWithdrawal: unknown = null;
const mockWallet: WalletInfo = {hasWallet: true, balance: 10000, pendingBalance: 0, heldBalance: 0, status: 'active',
  ledger: [{id: 'LEDGER_PRIVATE', type: 'sale_credit', amount: 3200, balanceAfter: 10000,
    description: 'Vente de la commande ORDER_PRIVATE', transactionId: 'ORDER_PRIVATE', refundIntentId: 'REFUND_PRIVATE',
    disputeId: 'DISPUTE_PRIVATE', financialQualification: 'qualified', createdAt: '2026-10-29T12:00:00Z'}],
  walletOrderReview: {protocol: 'wallet_order_review_v1', scope: 'seller_delivered_orders', limit: 100, inspectedCount: 0,
    truncated: false, globalCoverage: false, blockedOrderCount: 0, qualifiedCandidateCount: 0, deliveryCorrections: []},
  walletFinancialReview: {protocol: 'wallet_financial_review_v1', ownerId: 'seller', observedAt: '2026-10-29T12:00:00Z',
    scope: 'server_financial_guards', status: 'clear', informationalOnly: true, withdrawalPermissionGranted: false,
    globalCoverage: false, reasons: [], linkedOrders: [], withdrawalRequestIds: [], coverage: [], sellerDebtCents: 0},
  sellerDebtReview: {protocol: 'wallet_debt_review_v1', ownerId: 'seller', sellerDebtCents: 0, status: 'qualified',
    historyComplete: false, historyScope: 'recent_20_entries', ledgerLimit: 20, reason: null,
    recordedDebtCentsInView: 0, repaidDebtCentsInView: 0},
};
const mockRefetch = jest.fn(async () => ({isSuccess: true, isError: false, data: mockWallet}));
const mockPendingRefetch = jest.fn(async () => ({data: null}));
const mockAccountStatus = {success: true, hasAccount: true, payoutEligible: true, bankAccountId: 'ba_PRIVATE', bankAccountLast4: '4242', payoutRestriction: {}};
const mockRefetchAccount = jest.fn(async () => ({isSuccess: true, isError: false, data: mockAccountStatus}));
jest.mock('expo-linear-gradient', () => ({LinearGradient: require('react-native').View}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@/components/ui', () => ({Button: jest.requireActual('@/components/ui/Button').Button,
  Text: jest.requireActual('@/components/ui/Text').Text, ScreenHeader: jest.requireActual('@/components/ui/ScreenHeader').ScreenHeader,
  Skeleton: require('react-native').View,
}));

jest.mock('expo-router', () => ({useRouter: () => ({push: mockPush, back: jest.fn()}), useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]), Redirect: () => null,
}));
jest.mock('expo-crypto', () => ({randomUUID: () => 'WITHDRAWAL_PRIVATE'}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => 'seller', useAuthenticatedSession: () => ({uid: 'seller', identity: {stripeAccountId: 'acct_PRIVATE'}})}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/hooks/useWalletWithdrawalIdentity', () => ({useWalletWithdrawalIdentity: () => ({ready: false, proof: null,
  clear: mockClearIdentity, busy: false, notice: null, bindReview: jest.fn(), assertProof: jest.fn(), verify: jest.fn(),
})}));
jest.mock('@/features/wallet/hooks/useWallet', () => ({useWallet: () => ({wallet: mockWallet, isLoading: false, isError: false,
  isRefetching: false, refetch: mockRefetch, withdrawals: mockWithdrawals, isLoadingWithdrawals: false,
  isWithdrawalsError: false, refetchWithdrawals: mockRefetch, activate: jest.fn(), isActivating: false,
})}));
jest.mock('@/features/wallet/hooks/useStripeAccount', () => ({useStripeAccount: () => ({status: mockAccountStatus,
  refetch: mockRefetchAccount, isFetching: false, isError: false,
})}));
jest.mock('@/features/wallet/utils/stripeRequirements', () => ({parseConnectPayoutRestriction: () => ({category: 'none'})}));
jest.mock('@/features/wallet/services/walletService', () => ({WalletService: {withdrawFromWallet: mockWithdraw}}));
jest.mock('@/features/wallet', () => ({WithdrawalTimingNotice: () => {
  const {Text} = require('react-native'); return <Text>Suivi bancaire</Text>;
}}));
jest.mock('@/services/authService', () => ({AuthService: {getAuthProvider: () => 'password', hasPasswordProvider: () => true, reauthenticate: jest.fn()}}));
jest.mock('@/config/firebaseConfig', () => ({auth: {currentUser: {uid: 'seller'}}}));
jest.mock('@/services/tradeOperation', () => ({captureTradeSession: () => ({uid: 'seller', generation: 1}), assertTradeSessionCurrent: jest.fn()}));
jest.mock('@/services/withdrawalIntentJournal', () => ({hasTerminalWithdrawalReceipt: () => false, hasQualifiedWithdrawalNonExecution: () => false}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true}));
jest.mock('@tanstack/react-query', () => ({useQuery: () => ({data: mockPendingWithdrawal, isPending: false, isError: false, isFetching: false, refetch: mockPendingRefetch})}));

import WalletScreen from '@/app/wallet';

beforeEach(() => {Object.defineProperty(AppState, 'currentState', {configurable: true, writable: true, value: 'active'});
  mockWithdrawals = []; mockPendingWithdrawal = null; mockWallet.balance = 10000; mockWallet.pendingBalance = 0; mockWithdraw.mockClear();});

it('shows useful amounts without exposing ledger references or the permanent legal card', async () => {
  const screen = render(<WalletScreen/>);
  await waitFor(() => expect(screen.getByText('Vente')).toBeTruthy());
  expect(screen.getByText('+32,00 $')).toBeTruthy();
  expect(screen.queryByText(/ORDER_PRIVATE|REFUND_PRIVATE|DISPUTE_PRIVATE/)).toBeNull();
  expect(screen.queryByText('Protection Seconde')).toBeNull();
});

it('keeps one withdrawal flow and asks for the amount and masked bank confirmation before dispatch', async () => {
  const screen = render(<WalletScreen/>);
  await waitFor(() => expect(screen.getByTestId('wallet-withdraw-button')).toBeEnabled());
  fireEvent.press(screen.getByTestId('wallet-withdraw-button'));
  expect(screen.queryByTestId('wallet-withdraw-button')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Montant du retrait en dollars canadiens'), '32,50');
  fireEvent.changeText(screen.getByLabelText('Mot de passe pour confirmer mon identité avant le retrait'), 'secret');
  fireEvent.press(screen.getByText('Continuer'));
  expect(screen.getByText('32,50 $')).toBeTruthy();
  expect(screen.getByText('Vers votre compte •••• 4242')).toBeTruthy();
  expect(screen.getByText('Confirmer le retrait')).toBeTruthy();
  expect(mockWithdraw).not.toHaveBeenCalled();
});

it('keeps the exact withdrawal help behind details without exposing its provider IDs', async () => {
  mockWithdrawals = [{id: 'WITHDRAWAL_PRIVATE', status: 'completed', amount: 3200, amountQualified: true,
    createdAt: new Date('2026-10-29T12:00:00Z'), reconciliationRequired: false, completionReceiptQualified: true,
    recoveryReceiptQualified: false, historicalDestination: {last4: '4242', bankName: 'Banque de test'}, payoutId: 'po_PRIVATE',
  }];
  const screen = render(<WalletScreen/>);
  await waitFor(() => expect(screen.getByText('Virement envoyé')).toBeTruthy());
  expect(screen.queryByText(/WITHDRAWAL_PRIVATE|po_PRIVATE/)).toBeNull();
  expect(screen.queryByText('Obtenir de l’aide')).toBeNull();
  fireEvent.press(screen.getByText('Détails du retrait'));
  expect(screen.getByText('Suivi bancaire')).toBeTruthy();
  fireEvent.press(screen.getByText('Obtenir de l’aide'));
  expect(mockPush).toHaveBeenCalledWith({pathname: '/settings/support', params: {kind: 'withdrawal_timing_assistance', withdrawalRequestId: 'WITHDRAWAL_PRIVATE'}});
});

it('does not offer a new withdrawal from pending sales when the withdrawable balance is zero', async () => {
  mockWallet.balance = 0; mockWallet.pendingBalance = 3200;
  const screen = render(<WalletScreen/>);
  await waitFor(() => expect(screen.getByText('32,00 $ en attente')).toBeTruthy());
  expect(screen.getByTestId('wallet-withdraw-button')).toBeDisabled();
  fireEvent.press(screen.getByTestId('wallet-withdraw-button'));
  expect(screen.queryByLabelText('Montant du retrait en dollars canadiens')).toBeNull();
  expect(mockWithdraw).not.toHaveBeenCalled();
});

it('preserves the observation of an already submitted withdrawal even with no remaining balance', async () => {
  mockWallet.balance = 0;
  mockPendingWithdrawal = {attempt: {requestId: 'WITHDRAWAL_PRIVATE', amountCents: 3200},
    receipt: {operationState: 'submitted', ownerMessage: null}};
  const screen = render(<WalletScreen/>);
  await waitFor(() => expect(screen.getByText('Actualiser le retrait')).toBeEnabled());
  expect(screen.getByTestId('wallet-withdraw-button')).toBeDisabled();
  fireEvent.press(screen.getByText('Actualiser le retrait'));
  expect(mockPendingRefetch).toHaveBeenCalled();
  expect(mockWithdraw).not.toHaveBeenCalled();
});
