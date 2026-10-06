import React from 'react';
import { act, render } from '@testing-library/react-native';
import { PrivateStorageImage } from '@/components/PrivateStorageImage';

const mockAuth = { currentUser: { uid: 'owner' } as { uid: string } | null };
const mockListeners = new Set<() => void>();
jest.mock('@/config/firebaseConfig', () => ({ get auth() { return mockAuth; } }));
jest.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, listener: () => void) => {
    mockListeners.add(listener);
    listener();
    return () => mockListeners.delete(listener);
  },
}));

const mockSource = { value: undefined as { uri: string } | undefined };
jest.mock('@/hooks/usePrivateMediaSource', () => ({
  usePrivateMediaSource: () => mockSource.value,
}));

beforeEach(() => { mockSource.value = undefined; mockAuth.currentUser = { uid: 'owner' }; mockListeners.clear(); });

describe('private image native rendering', () => {
  it('forces no disk or memory image cache for authorized bytes', () => {
    mockSource.value = { uri: 'data:image/jpeg;base64,/9j/' };
    const view = render(<PrivateStorageImage testID="private-image" uri="gs://demo-second.appspot.com/chat_images/c1/photo.jpg" />);
    expect(view.getByTestId('private-image').props.cachePolicy).toBe('none');
    expect(view.getByTestId('private-image').props.source).toEqual(mockSource.value);
  });
  it('never uses a remote bearer or external URI as an anonymous fallback', () => {
    const view = render(<PrivateStorageImage testID="private-image" uri="https://example.test/private.jpg?token=fake" allowLocalSource />);
    expect(view.getByTestId('private-image').props.source).toBeUndefined();
  });
  it('permits explicit local creation previews without any remote fallback', () => {
    const view = render(<PrivateStorageImage testID="private-image" uri="file:///camera/photo.jpg" allowLocalSource localSourceOwnerUid="owner" />);
    expect(view.getByTestId('private-image').props.source).toEqual({ uri: 'file:///camera/photo.jpg' });
    expect(view.getByTestId('private-image').props.cachePolicy).toBe('none');
  });
  it('refuses local previews without a captured owner or with a foreign owner', () => {
    const view = render(<PrivateStorageImage testID="private-image" uri="file:///camera/photo.jpg" allowLocalSource />);
    expect(view.getByTestId('private-image').props.source).toBeUndefined();
    view.rerender(<PrivateStorageImage testID="private-image" uri="file:///camera/photo.jpg" allowLocalSource localSourceOwnerUid="other" />);
    expect(view.getByTestId('private-image').props.source).toBeUndefined();
  });
  it('clears a mounted local photo on UID switch without a screen reset or prop change', () => {
    const view = render(<PrivateStorageImage testID="private-image" uri="file:///camera/photo.jpg" allowLocalSource localSourceOwnerUid="owner" />);
    expect(view.getByTestId('private-image').props.source).toEqual({ uri: 'file:///camera/photo.jpg' });
    act(() => {
      mockAuth.currentUser = { uid: 'other' };
      mockListeners.forEach((notify) => notify());
    });
    expect(view.getByTestId('private-image').props.source).toBeUndefined();
  });
  it('clears a mounted local photo on SDK logout', () => {
    const view = render(<PrivateStorageImage testID="private-image" uri="file:///camera/photo.jpg" allowLocalSource localSourceOwnerUid="owner" />);
    act(() => {
      mockAuth.currentUser = null;
      mockListeners.forEach((notify) => notify());
    });
    expect(view.getByTestId('private-image').props.source).toBeUndefined();
  });
  it('drops the old bitmap source when the authenticated loader clears it', () => {
    mockSource.value = { uri: 'data:image/jpeg;base64,/9j/' };
    const view = render(<PrivateStorageImage testID="private-image" uri="gs://demo-second.appspot.com/chat_images/c1/photo.jpg" />);
    mockSource.value = undefined;
    view.rerender(<PrivateStorageImage testID="private-image" accessibilityLabel="cleared" uri="gs://demo-second.appspot.com/chat_images/c1/photo.jpg" />);
    expect(view.getByTestId('private-image').props.source).toBeUndefined();
  });
});
