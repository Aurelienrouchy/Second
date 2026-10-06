import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { auth } from '@/config/firebaseConfig';
import { Modal } from 'react-native';
import DraftResumeModal from '@/components/DraftResumeModal';
import type { ArticleDraft } from '@/services/draftService';

const mockUid = jest.fn(() => 'alice');
jest.mock('@/hooks/useFirebaseUserId', () => ({ useFirebaseUserId: () => mockUid() }));

const mockResolvePrivate = jest.fn((..._args: unknown[]) => ({ uri: 'data:image/jpeg;base64,cHJpdmF0ZQ==' }));
jest.mock('@/hooks/usePrivateMediaSource', () => ({
  usePrivateMediaSource: (...args: unknown[]) => mockResolvePrivate(...args),
}));
jest.mock('@/services/draftService', () => ({ getDaysUntilExpiration: () => 7 }));

it('renders a canonical draft reference through authenticated source resolution, without native URL fallback', () => {
  const canonical = 'https://firebasestorage.googleapis.com/v0/b/test-bucket/o/drafts%2Falice%2Fd1%2Fphoto.jpg?alt=media';
  const draft: ArticleDraft = {
    id: 'd1', ownerUid: 'alice', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', currentStep: 1,
    photos: ['file:///documents/photo.jpg'], originalPhotoUris: [], storageUrls: [canonical],
    fields: null, pricing: null, aiResult: null,
  };
  const screen = render(<DraftResumeModal visible draft={draft} onResume={jest.fn()} onDiscard={jest.fn()} />);
  expect(mockResolvePrivate).toHaveBeenCalledWith(canonical);
  const image = screen.getByTestId('draft-private-preview');
  expect(image.props.source).toEqual({ uri: 'data:image/jpeg;base64,cHJpdmF0ZQ==' });
  expect(image.props.cachePolicy).toBe('none');
});


it('hides a previous account draft preview, title and actions after an account switch', () => {
  const draft: ArticleDraft = {
    id: 'd1', ownerUid: 'alice', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', currentStep: 1,
    photos: ['file:///documents/draft_images/alice/photo.jpg'], originalPhotoUris: [], storageUrls: [],
    fields: null, pricing: null, aiResult: null,
  };
  mockUid.mockReturnValue('alice');
  const screen = render(<DraftResumeModal visible draft={draft} onResume={jest.fn()} onDiscard={jest.fn()} />);
  expect(screen.queryByTestId('draft-private-preview')).toBeTruthy();
  mockUid.mockReturnValue('bob');
  screen.rerender(<DraftResumeModal visible draft={draft} onResume={jest.fn()} onDiscard={jest.fn()} />);
  expect(screen.queryByTestId('draft-private-preview')).toBeNull();
  expect(screen.queryByText('Brouillon trouvé')).toBeNull();
  expect(screen.queryByText('Article sans titre')).toBeNull();
});


it('rejects late resume/discard/native close events immediately after SDK account switch before rerender', () => {
  const mockAuth = auth as unknown as { currentUser: { uid: string } | null };
  mockAuth.currentUser = { uid: 'alice' };
  mockUid.mockReturnValue('alice');
  const draft: ArticleDraft = {
    id: 'd1', ownerUid: 'alice', createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', currentStep: 1,
    photos: [], originalPhotoUris: [], storageUrls: [], fields: null, pricing: null, aiResult: null,
  };
  const resume = jest.fn();
  const discard = jest.fn();
  const screen = render(<DraftResumeModal visible draft={draft} onResume={resume} onDiscard={discard} />);
  mockAuth.currentUser = { uid: 'bob' };
  fireEvent.press(screen.getByText('Reprendre'));
  fireEvent.press(screen.getByText('Recommencer'));
  fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  expect(resume).not.toHaveBeenCalled();
  expect(discard).not.toHaveBeenCalled();
  mockAuth.currentUser = null;
});
