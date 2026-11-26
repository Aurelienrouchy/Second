/** Test-only IO seams. Auth store, hooks, routes and callable service stay real. */
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/config/firebaseConfig';
import { AuthService } from '@/services/authService';
import { guestPreferencesService } from '@/services/guestPreferencesService';
import { UserService } from '@/services/userService';
import { identifyUser, resetAnalytics, setAnalyticsUserConsent, track } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';
import type { User } from '@/types';
import type { AdminEligibilityReviewDetail, EligibilityDecision, EligibilityScope, OwnerEligibility } from '@/types/eligibility';

jest.mock('@/services/authService', () => ({ AuthService: {
  getCurrentUser: jest.fn(), signOut: jest.fn(), ensureUsernameAssigned: jest.fn(), getAuthProvider: jest.fn(() => 'password'), hasPasswordProvider: jest.fn(() => true),
} }));
jest.mock('@/services/userService', () => ({ UserService: { isUserAdmin: jest.fn() } }));
jest.mock('@/services/authMergeService', () => ({ mergeGuestDataIntoUser: jest.fn() }));
jest.mock('@/services/guestPreferencesService', () => ({ guestPreferencesService: {
  getGuestSession: jest.fn(), createGuestSession: jest.fn(), clearGuestSession: jest.fn(),
} }));
jest.mock('@/lib/analytics', () => ({
  identifyUser: jest.fn(), resetAnalytics: jest.fn(), setAnalyticsUserConsent: jest.fn(),
  suspendAnalytics: jest.fn(), track: jest.fn(),
}));
jest.mock('@/lib/queryClient', () => ({ queryClient: { clear: jest.fn() } }));
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ reset: jest.fn() }) } }));
jest.mock('@/store/notificationStore', () => ({ useNotificationStore: { getState: () => ({ reset: jest.fn(), pushToken: null }) } }));
jest.mock('@/store/immersiveOverlayStore', () => ({ useImmersiveOverlayStore: { getState: () => ({ reset: jest.fn() }) } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('firebase/functions', () => {
  const invoke = jest.fn<Promise<{ data: unknown }>, [string, unknown]>();
  return { __invoke: invoke, httpsCallable: jest.fn((_functions: unknown, name: string) => (payload: unknown) => invoke(name, payload)) };
});
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
// Mount actual controls; avoid unrelated ESM/native modules in the UI barrels.
jest.mock('@/components/ui', () => ({
  Text: jest.requireActual('@/components/ui/Text').Text, Caption: jest.requireActual('@/components/ui/Text').Caption,
  Button: jest.requireActual('@/components/ui/Button').Button,
  Input: jest.requireActual('@/components/ui/Input').Input,
  Checkbox: jest.requireActual('@/components/ui/Checkbox').Checkbox,
  ScreenHeader: jest.requireActual('@/components/ui/ScreenHeader').ScreenHeader,
}));
jest.mock('@/features/admin', () => ({
  AdminSellerActivityReview: jest.requireActual('@/features/admin/components/AdminSellerActivityReview').AdminSellerActivityReview,
  AdminSectionNav: jest.requireActual('@/features/admin/components/AdminSectionNav').AdminSectionNav,
  AdminEligibilityEvidence: jest.requireActual('@/features/admin/components/AdminEligibilityEvidence').AdminEligibilityEvidence,
}));
jest.mock('expo-router', () => {
  const ReactRuntime: typeof import('react') = jest.requireActual('react');
  return {
  useRouter: () => require('expo-router').router,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
 router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
    usePathname: () => '/admin/eligibility',
    useFocusEffect: (effect: () => void | (() => void)) => ReactRuntime.useEffect(effect, [effect]),
  };
});
// Virtualization is a native IO seam; preserve header, rows and footer content.
jest.mock('@shopify/flash-list', () => {
  const ReactRuntime: typeof import('react') = jest.requireActual('react');
  const { View }: typeof import('react-native') = jest.requireActual('react-native');
  return { FlashList: ({ data, renderItem, ListHeaderComponent, ListFooterComponent }: {
    data: unknown[]; renderItem: (item: { item: unknown }) => import('react').ReactNode;
    ListHeaderComponent: import('react').ReactNode; ListFooterComponent?: import('react').ReactNode }) =>
    ReactRuntime.createElement(View, null, ListHeaderComponent,
      ...data.map((item, index) => ReactRuntime.createElement(ReactRuntime.Fragment, { key: index }, renderItem({ item }))), ListFooterComponent) };
});

export const callableIO: jest.Mock<Promise<{ data: unknown }>, [string, unknown]> = jest.requireMock('firebase/functions').__invoke;
export const authIO = { getCurrentUser: jest.mocked(AuthService.getCurrentUser), signOut: jest.mocked(AuthService.signOut) };
export const analyticsIO = { identify: jest.mocked(identifyUser), reset: jest.mocked(resetAnalytics),
  consent: jest.mocked(setAnalyticsUserConsent), track: jest.mocked(track) };
const storageSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
const clients = new Set<QueryClient>();

export const profile = (id: string): User => ({ id, email: `${id}@example.test`, username: id,
  dateOfBirth: '1990-01-01', createdAt: new Date('2019-01-01'), isActive: true,
  preferences: { sizes: [], favoriteBrands: [], analyticsConsent: false } });
export function providerIdentity(id: string | null): void {
  // Only uid/email are consumed at this mocked Firebase SDK boundary.
  Object.defineProperty(auth, 'currentUser', { value: id ? { uid: id, email: `${id}@example.test`, emailVerified: true, providerData: [{providerId: 'password'}], getIdToken: async () => 'synthetic-token', getIdTokenResult: async () => ({claims: {auth_time: Math.floor(Date.now() / 1000)}}) } as unknown as FirebaseUser : null,
    writable: true, configurable: true });
}
export async function establishSession(id: string): Promise<void> {
  providerIdentity(id);
  await useAuthStore.getState().signIn(profile(id));
}
export async function resetEnvironment(): Promise<void> {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.mocked(AsyncStorage.setItem).mockImplementation(storageSet!);
  await AsyncStorage.clear();
  providerIdentity(null); useAuthStore.getState().reset();
  authIO.getCurrentUser.mockImplementation(async uid => uid ? profile(uid) : null);
  authIO.signOut.mockResolvedValue();
  jest.mocked(guestPreferencesService.getGuestSession).mockResolvedValue(null);
  jest.mocked(guestPreferencesService.createGuestSession).mockResolvedValue({ guestId: 'guest-test',
    createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z',
    likedArticles: [], searches: [], viewedArticles: [] });
  analyticsIO.consent.mockResolvedValue();
  jest.mocked(UserService.isUserAdmin).mockResolvedValue(true);
  let nextId = 0;
  const crypto: typeof import('expo-crypto') = jest.requireMock('expo-crypto');
  jest.mocked(crypto.randomUUID).mockImplementation(() => `10000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`);
  callableIO.mockReset();
}
export function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.add(client);
  function Wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
  return { client, Wrapper };
}
export function clearQueryClients(): void { clients.forEach(client => client.clear()); clients.clear(); }
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
export function ownerEligibility(overrides: Partial<OwnerEligibility> = {}): OwnerEligibility {
  const decision = (scope: EligibilityScope): EligibilityDecision => ({ scope, allowed: true, status: 'allowed', reasons: [], messages: [],
    policyVersion: 'policy-1', civilDate: '2026-10-11', evaluationStage: 'foundations' });
  return { version: 'a'.repeat(64), policyVersion: 'policy-1', statementVersion: 'statement-1',
    statements: { personal: 'Je confirme vendre mes propres articles.', professional: 'Je déclare mon activité professionnelle.' },
    dateOfBirth: '1990-01-01', dateOfBirthCopy: { type: 'string', value: '1990-01-01' }, dateOfBirthSource: 'declared_profile',
    dateOfBirthVerified: false, firstDateOfBirthAction: 'recordSignupConsent', initialDateRequiresTermsAndPrivacy: true,
    activityDeclaration: null, sellerQuebecEvidence: null,
    decisions: { buy: decision('buy'), sell: decision('sell'), new_paid_shipping: decision('new_paid_shipping') }, ...overrides };
}
export function adminReview(): AdminEligibilityReviewDetail {
  const signal = { scope: 'buy' as const, active: true, internalNote: 'Note privée', actorUid: 'admin-previous',
    recordedAt: '2026-10-10', clearedBy: null, clearedAt: null, reviewId: null };
  return { eligibility: ownerEligibility(), relatedSales: {items: [], cursor: null, hasMore: false}, request: { id: 'review-owner', ownerId: 'owner', kind: 'review', scope: 'buy',
    status: 'needs_information', requestVersion: 7, policyVersion: 'policy-1', reason: 'Réexamen demandé',
    proposedDateOfBirth: null, originalDateOfBirth: null, originalDateOfBirthCopy: null, correctedDateOfBirth: null,
    receivedAt: '2026-10-10', receivedCivilDate: '2026-10-10', statutoryDueDate: null,
    deadlineState: 'not_applicable', silenceEffect: null, ownerResponse: null, latestOwnerDetails: null,
    ownerDecisionReason: null, createdAt: '2026-10-10', updatedAt: '2026-10-10', decidedAt: null,
    internalNote: 'Privé admin seulement', priorReviewId: null }, signals: { s1: signal, s2: { ...signal } } };
}

/** Native IO receipt fixture: original command and statement remain separate from current eligibility. */
export function activityRecorded(input: import('@/types/eligibility').DeclareSellerActivityInput, dto: OwnerEligibility, ownerId = 'owner') {
  const recordedAt = '2026-10-17T00:00:00.000Z', statement = ownerEligibility().statements[input.kind];
  return {recorded: true, alreadyRecorded: false, eligibility: dto, currentEligibility: dto, declarationReceipt: {
    protocol: 'seller_activity_declaration_v1', id: `declaration-${input.requestId}`, ownerId, actorUid: ownerId, recordedAt,
    qualification: 'native_original', requestId: input.requestId, inputHash: 'b'.repeat(64), receiptHash: 'c'.repeat(64),
    command: input, statement, statementVersion: input.statementVersion, accepted: true, previous: null, legalEffectiveDate: null, legallyVerified: false,
    resultingDeclaration: {kind: input.kind, statementVersion: input.statementVersion, statement, ownerId, actorUid: ownerId, accepted: true,
      personalDeclarationAccepted: input.personalDeclarationAccepted ?? null, recordedAt, recordedAtMs: Date.parse(recordedAt), declarationVersion: 1, legalEffectiveDate: null, legallyVerified: false},
  }};
}
export function activityHistory(dto: OwnerEligibility) {
  const page = {items: [], cursor: null, hasMore: false};
  return {protocol: 'seller_activity_history_page_v1', history: {...page, coverage: 'owner_audit_page'}, relatedSales: page, relatedSwaps: {initiated: page, received: page}, currentEligibility: dto};
}
