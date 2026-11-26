// Provider SDKs and analytics are external to the account dependency graph.
jest.mock('@/services/authService', () => ({ AuthService: {} }));
jest.mock('@/lib/analytics', () => ({}));

import { useAuthStore, getAuthSessionGeneration } from '@/store/authStore';
import { mergeGuestDataIntoUser } from '@/services/authMergeService';
import { getUserPreferences } from '@/services/userAuthData';

it('initializes the auth store with its real guest merge and account data modules', () => {
  expect(useAuthStore.getState().authenticatedUid).toBeNull();
  expect(getAuthSessionGeneration()).toBe(0);
  expect(typeof mergeGuestDataIntoUser).toBe('function');
  expect(typeof getUserPreferences).toBe('function');
});
