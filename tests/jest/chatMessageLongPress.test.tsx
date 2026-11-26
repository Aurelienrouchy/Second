import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import type {Message} from '@/types/chat';

jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => 'seller'}));
jest.mock('@/hooks/useFirebaseUserId', () => ({useFirebaseUserId: () => 'seller'}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({
  focused: true, frame: 'current-frame', focusRevision: 'current-focus', capture: jest.fn(),
})}));
jest.mock('@/components/PrivateStorageImage', () => ({PrivateStorageImage: () => {
  const {View} = require('react-native');
  return <View testID="message-photo" />;
}}));

import ChatBubble from '@/features/chat/components/ChatBubble';

const message: Message = {
  id: 'message', chatId: 'conversation', senderId: 'buyer', receiverId: 'seller',
  type: 'text', content: 'Bonjour !', timestamp: new Date('2026-10-28T20:00:00Z'),
  status: 'sent', isRead: false,
};

it('keeps reporting out of the text conversation and opens it through long press or accessibility', () => {
  const onReport = jest.fn();
  const screen = render(<ChatBubble message={message} isOwnMessage={false} onReport={onReport} />);
  expect(screen.queryByText('Signaler ce message')).toBeNull();
  fireEvent(screen.getByText('Bonjour !'), 'longPress');
  expect(onReport).toHaveBeenCalledTimes(1);
  fireEvent(screen.getByText('Bonjour !'), 'accessibilityAction', {nativeEvent: {actionName: 'longpress'}});
  expect(onReport).toHaveBeenCalledTimes(2);
});

it('reports a photo through long press while preserving its ordinary tap to view', () => {
  const onReport = jest.fn();
  const screen = render(<ChatBubble message={{...message, type: 'image', image: {url: 'private-photo'}}} isOwnMessage={false} onReport={onReport} />);
  expect(screen.queryByText('Signaler ce message')).toBeNull();
  fireEvent(screen.getByTestId('message-photo'), 'longPress');
  expect(onReport).toHaveBeenCalledTimes(1);
  expect(screen.getAllByTestId('message-photo')).toHaveLength(1);
  fireEvent.press(screen.getByTestId('message-photo'));
  expect(screen.getAllByTestId('message-photo')).toHaveLength(2);
});

it('preserves reporting access for an unavailable message without exposing its old content', () => {
  const onReport = jest.fn();
  const screen = render(<ChatBubble message={{...message, contentModeration: {
    protocol: 'content_visibility_v1', state: 'hidden', caseId: 'case', decisionId: 'decision', version: 1,
  }}} isOwnMessage={false} onReport={onReport} />);
  expect(screen.queryByText('Bonjour !')).toBeNull();
  expect(screen.queryByText('Signaler ce message')).toBeNull();
  fireEvent(screen.getByText('Ce message n’est plus disponible.'), 'longPress');
  expect(onReport).toHaveBeenCalledTimes(1);
});
