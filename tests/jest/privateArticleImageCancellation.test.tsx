import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {PrivateArticleEvidenceRead, PrivateArticleMedia, PrivateArticleMediaReference} from '@/types/articlePrivacy';

let mockUid = 'seller', mockFrame = 1, mockFocus = 1, mockFocused = true, mockCaptureRefused = false;
const mockEvidence = jest.fn(), mockImage = jest.fn();
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => mockUid}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/hooks/useShippingPurchaseContext', () => ({useShippingPurchaseContext: () => ({
  focused: mockFocused, frame: mockFrame, focusRevision: mockFocus,
  capture: () => {
    if (mockCaptureRefused || !mockFocused) throw new Error('stale capture');
    return {session: {uid: mockUid}, frame: mockFrame};
  },
  assertCurrent: (operation: {session: {uid: string}; frame: number}) => {
    if (operation.frame !== mockFrame || operation.session.uid !== mockUid || !mockFocused) throw new Error('stale source');
  },
})}));
jest.mock('@/services/articlePrivacyService', () => ({articlePrivacySourceHash: async () => 'source-hash',
  ArticlePrivacyService: {evidence: (...args: unknown[]) => mockEvidence(...args), image: (...args: unknown[]) => mockImage(...args)},
}));

import {usePrivateArticleImage} from '@/hooks/usePrivateArticleImage';

const access = {articleId: 'article', transactionId: 'order'}, publicReference = 'https://images.test/source.jpg';
const publicProof = (viewerId = 'seller'): PrivateArticleEvidenceRead => ({kind: 'private_article_evidence_v1', viewerId,
  ownerId: 'seller', articleId: 'article', state: 'unrecorded', publicReferenceUseAllowed: true, publicReferenceHashes: ['source-hash'],
  evidenceId: null, capturedAt: null, sourceUpdatedAt: null, snapshot: null, mediaRefs: [], mediaNeedsReview: 0, ownerWithdrawalAttempt: null,
});
const media: PrivateArticleMediaReference = {mediaId: 'media', evidenceId: 'evidence', generation: '1', sourceReferenceHash: 'source-hash',
  contentType: 'image/jpeg', size: 1, mediaBasis: 'source_generation_at_withdrawal', historicalPixelsVerified: false};
const privateProof = (): PrivateArticleEvidenceRead => ({...publicProof(), state: 'recorded', publicReferenceUseAllowed: false,
  publicReferenceHashes: [], evidenceId: 'evidence', evidenceScope: 'transaction_contract', contractId: 'order',
  capturedAt: '2026-10-29T00:00:00.000Z', sourceUpdatedAt: null, snapshot: {}, mediaRefs: [media],
});
const pixels: PrivateArticleMedia = {kind: 'private_article_media_v1', viewerId: 'seller', articleId: 'article', ...media,
  dataUrl: 'data:image/jpeg;base64,AA=='};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {resolve = done;});
  return {promise, resolve};
}
function environment() {
  const onError = jest.fn();
  const client = new QueryClient({queryCache: new QueryCache({onError}), defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {client, wrapper, onError};
}
beforeEach(() => {mockUid = 'seller'; mockFrame = 1; mockFocus = 1; mockFocused = true; mockCaptureRefused = false;
  mockEvidence.mockReset(); mockImage.mockReset();});

it('cancels an obsolete proof silently and freshly qualifies the same photo after refocus', async () => {
  const old = deferred<PrivateArticleEvidenceRead>(), env = environment();
  mockEvidence.mockReturnValueOnce(old.promise).mockResolvedValue(publicProof());
  const hook = renderHook(() => usePrivateArticleImage(access, publicReference), {wrapper: env.wrapper});
  await waitFor(() => expect(mockEvidence).toHaveBeenCalledTimes(1));
  mockFrame++; mockFocused = false;
  hook.rerender({});
  await act(async () => {old.resolve(publicProof());});
  expect(hook.result.current.image).toBeNull();
  expect(hook.result.current.unavailable).toBe(false);
  expect(env.onError).not.toHaveBeenCalled();
  mockFocused = true; mockFocus++;
  hook.rerender({});
  await waitFor(() => expect(hook.result.current.image).toBe(publicReference));
  expect(mockEvidence).toHaveBeenCalledTimes(2);
  env.client.clear();
});

it('keeps current permission errors visible and does not retry them', async () => {
  const error = new Error('permission denied'), env = environment();
  mockEvidence.mockRejectedValue(error);
  const hook = renderHook(() => usePrivateArticleImage(access, publicReference), {wrapper: env.wrapper});
  await waitFor(() => expect(hook.result.current.unavailable).toBe(true));
  expect(env.onError).toHaveBeenCalledWith(error, expect.anything());
  expect(mockEvidence).toHaveBeenCalledTimes(1);
  expect(hook.result.current.image).toBeNull();
  env.client.clear();
});

it('does not adopt or retry the old viewer proof after an account change', async () => {
  const old = deferred<PrivateArticleEvidenceRead>(), env = environment();
  mockEvidence.mockReturnValueOnce(old.promise).mockResolvedValue(publicProof('other'));
  const hook = renderHook(() => usePrivateArticleImage(access, publicReference), {wrapper: env.wrapper});
  await waitFor(() => expect(mockEvidence).toHaveBeenCalledTimes(1));
  mockUid = 'other'; mockFrame++; mockFocus++;
  hook.rerender({});
  await act(async () => {old.resolve(publicProof('seller'));});
  await waitFor(() => expect(mockEvidence).toHaveBeenCalledTimes(2));
  expect(mockEvidence.mock.calls.map(call => call[0])).toEqual(['seller', 'other']);
  expect(env.onError).not.toHaveBeenCalled();
  env.client.clear();
});

it('cancels obsolete private bytes without falling back to the removed public URL', async () => {
  const old = deferred<PrivateArticleMedia>(), env = environment();
  mockEvidence.mockResolvedValue(privateProof()); mockImage.mockReturnValue(old.promise);
  const hook = renderHook(() => usePrivateArticleImage(access, publicReference, true), {wrapper: env.wrapper});
  await waitFor(() => expect(mockImage).toHaveBeenCalledTimes(1));
  mockFrame++; mockFocused = false;
  hook.rerender({});
  await act(async () => {old.resolve(pixels);});
  expect(hook.result.current.image).toBeNull();
  expect(hook.result.current.privateImage).toBe(false);
  expect(hook.result.current.unavailable).toBe(false);
  expect(hook.result.current.withdrawalRecorded).toBe(true);
  expect(env.onError).not.toHaveBeenCalled();
  env.client.clear();
});

it('treats a capture refusal as cancellation before sending any image request', async () => {
  const env = environment(); mockCaptureRefused = true;
  const hook = renderHook(() => usePrivateArticleImage(access, publicReference), {wrapper: env.wrapper});
  await act(async () => {await Promise.resolve();});
  expect(mockEvidence).not.toHaveBeenCalled();
  expect(hook.result.current.unavailable).toBe(false);
  expect(env.onError).not.toHaveBeenCalled();
  env.client.clear();
});

it('preserves a current private media refusal and never exposes its old public reference', async () => {
  const env = environment(), error = new Error('private media denied');
  mockEvidence.mockResolvedValue(privateProof()); mockImage.mockRejectedValue(error);
  const hook = renderHook(() => usePrivateArticleImage(access, publicReference, true), {wrapper: env.wrapper});
  await waitFor(() => expect(hook.result.current.unavailable).toBe(true));
  expect(hook.result.current.image).toBeNull();
  expect(mockImage).toHaveBeenCalledTimes(1);
  expect(env.onError).toHaveBeenCalledWith(error, expect.anything());
  env.client.clear();
});
