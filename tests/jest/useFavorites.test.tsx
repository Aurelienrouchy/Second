import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
const mockSetDoc = jest.fn();
const mockGetDoc = jest.fn();
const mockUnsubscribe = jest.fn();
let mockProjectionListener: ((snapshot: { exists: () => boolean; data: () => { counted: boolean } }) => void) | undefined;
jest.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => args.slice(1).join('/'),
  arrayUnion: (value: string) => value, arrayRemove: (value: string) => value,
  setDoc: (...args: unknown[]) => mockSetDoc(...args), updateDoc: (...args: unknown[]) => mockSetDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  onSnapshot: (_ref: string, listener: typeof mockProjectionListener) => { mockProjectionListener = listener; return mockUnsubscribe; },
}));
jest.mock('@/config/firebaseConfig', () => ({ firestore: {} }));
jest.mock('@/hooks/useAuth', () => ({ useUser: () => ({ id: 'alice' }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/services/guestPreferencesService', () => ({ guestPreferencesService: {}, toArticleMeta: jest.fn() }));
import { favoritesKeys, useFavorites } from '@/hooks/useFavorites';
import { queryKeys } from '@/lib/queryKeys';
import type { Article } from '@/types';

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } } });
  client.setQueryData(favoritesKeys.ids('alice'), []);
  client.setQueryData(queryKeys.articles.detail('a'), { id: 'a', likes: 0, favoritesCount: 0 } as Article);
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  return { client, ...renderHook(() => useFavorites(), { wrapper }) };
}
describe('favorite count UI waits for canonical projection', () => {
  beforeEach(() => { jest.clearAllMocks(); mockProjectionListener = undefined; mockSetDoc.mockResolvedValue(undefined); });
  it('shows the first like immediately and waits for server acknowledgment, even with an initial stale snapshot', async () => {
    const { client, result } = harness();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    act(() => result.current.toggleFavorite('a'));
    await waitFor(() => expect(mockProjectionListener).toBeDefined());
    expect(client.getQueryData<Article>(queryKeys.articles.detail('a'))?.likes).toBe(1);
    act(() => mockProjectionListener!({ exists: () => true, data: () => ({ counted: false }) }));
    expect(client.getQueryData<Article>(queryKeys.articles.detail('a'))?.likes).toBe(1);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.articles.detail('a') });
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ likes: 3, favoritesCount: 3 }) });
    act(() => mockProjectionListener!({ exists: () => true, data: () => ({ counted: true }) }));
    await waitFor(() => expect(client.getQueryData<Article>(queryKeys.articles.detail('a'))?.likes).toBe(3));
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
  it('restores the previous count and favorite state if the write fails', async () => {
    mockSetDoc.mockRejectedValue(new Error('offline'));
    const { client, result } = harness();
    act(() => result.current.toggleFavorite('a'));
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled());
    await waitFor(() => expect(client.getQueryData<Article>(queryKeys.articles.detail('a'))?.likes).toBe(0));
    expect(client.getQueryData(favoritesKeys.ids('alice'))).toEqual([]);
    expect(mockProjectionListener).toBeUndefined();
  });
  it('ignores a double click until the same favorite write has settled', async () => {
    let resolveWrite: (() => void) | undefined;
    mockSetDoc.mockImplementation(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const { result } = harness();
    act(() => { result.current.toggleFavorite('a'); result.current.toggleFavorite('a'); });
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));
    await act(async () => resolveWrite!());
    await waitFor(() => expect(mockProjectionListener).toBeDefined());
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ likes: 1, favoritesCount: 1 }) });
    act(() => mockProjectionListener!({ exists: () => true, data: () => ({ counted: true }) }));
  });
});
