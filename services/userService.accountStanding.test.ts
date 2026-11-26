import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import type { User } from '@/types';

vi.mock('@/utils/imageUtils', () => ({ prepareImageForUpload: vi.fn() }));
vi.mock('@/utils/fixStorageUrl', () => ({ fixStorageUrl: (url: string) => url }));
vi.mock('@/store/authStore', () => ({ getAuthSessionGeneration: vi.fn(), useAuthStore: { getState: vi.fn() } }));
// Ordinary account field writes do not exercise device push registration.
vi.mock('@/services/devPushDestinationService', () => ({ removeDevPushDestination: vi.fn() }));

import { UserService } from './userService';

describe('ACCOUNT_STANDING ordinary UserService mutations', () => {
  const timestamp = new Date('2026-10-10T12:00:00Z');

  beforeEach(() => {
    vi.stubGlobal('__DEV__', false);
    vi.clearAllMocks();
    vi.mocked(doc).mockReturnValue({ path: 'users/local' } as ReturnType<typeof doc>);
    vi.mocked(serverTimestamp).mockReturnValue(timestamp as unknown as ReturnType<typeof serverTimestamp>);
    vi.mocked(updateDoc).mockResolvedValue(undefined);
  });

  it('merges only requested preference fields with dotted paths and a fresh timestamp', async () => {
    await expect(UserService.updateUserPreferences('local', {
      sizes: ['L'], favoriteBrands: ['local-brand'], analyticsConsent: false,
    })).resolves.toBeUndefined();
    expect(vi.mocked(updateDoc).mock.calls[0][1]).toEqual({
      'preferences.sizes': ['L'],
      'preferences.favoriteBrands': ['local-brand'],
      'preferences.analyticsConsent': false,
      updatedAt: timestamp,
    });
  });

  it('changes the account type without asserting commercial standing', async () => {
    await expect(UserService.updateAccountType('local', 'shop')).resolves.toBeUndefined();
    expect(vi.mocked(updateDoc).mock.calls[0][1]).toEqual({ accountType: 'shop', updatedAt: timestamp });
  });

  it('persists ordinary bio, phone and address without a standing field', async () => {
    const ordinary = {
      bio: 'Texte ordinaire', phoneNumber: '+15145551234',
      address: { street: '10 rue locale', city: 'Montréal', province: 'QC', postalCode: 'H2X 1Y4', country: 'CA' },
    };
    await expect(UserService.updateUserProfile('local', ordinary)).resolves.toBeUndefined();
    expect(vi.mocked(updateDoc).mock.calls[0][1]).toEqual({ ...ordinary, updatedAt: timestamp });
  });

  const suppliedStanding: [string, unknown][] = [
    ['true', true], ['false', false], ['null', null], ['string', 'active'],
    ['number', 1], ['map', { value: true }], ['array', [true]], ['undefined', undefined],
  ];
  it.each(suppliedStanding)('does not forward explicitly supplied isActive=%s', async (_name, value) => {
    // Deliberately malformed runtime input; no product caller is claimed to supply these values.
    const payload = { bio: 'Ordinaire', isActive: value } as unknown as Partial<User>;
    await UserService.updateUserProfile('local', payload);
    expect(vi.mocked(updateDoc).mock.calls[0][1]).toEqual({ bio: 'Ordinaire', updatedAt: timestamp });
    expect(payload).toEqual({ bio: 'Ordinaire', isActive: value });
  });

  it('retains the existing exclusions and replaces a caller-supplied timestamp', async () => {
    const payload = {
      id: 'forged', email: 'forged@example.test', createdAt: new Date(0), isAdmin: true,
      role: 'admin', customClaims: { admin: true }, onboardingCompleted: true,
      onboardingPreferences: {}, isActive: true, updatedAt: new Date(0), bio: 'Ordinaire',
    } as unknown as Partial<User>;
    await UserService.updateUserProfile('local', payload);
    expect(vi.mocked(updateDoc).mock.calls[0][1]).toEqual({ bio: 'Ordinaire', updatedAt: timestamp });
  });

  it.each([
    ['preferences', () => UserService.updateUserPreferences('local', { sizes: ['L'] }), 'Erreur lors de la mise à jour des préférences'],
    ['accountType', () => UserService.updateAccountType('local', 'shop'), 'Erreur lors de la mise à jour du type de compte'],
    ['profile', () => UserService.updateUserProfile('local', { bio: 'Ordinaire' }), 'Erreur lors de la mise à jour du profil'],
  ] as const)('keeps %s write failures observable instead of reporting success', async (_method, invoke, message) => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error('permission-denied'));
    await expect(invoke()).rejects.toThrow(message);
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });
});
