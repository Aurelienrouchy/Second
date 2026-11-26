/**
 * Tests métier — <ChatBubble /> : l'accusé de réception d'un message envoyé.
 *
 * Un message dont l'écriture a ÉCHOUÉ portait bien un drapeau `failed`, mais
 * rien ne le lisait : la bulle continuait d'afficher l'horloge « en cours
 * d'envoi », pour toujours. Le message n'est ni renvoyé, ni retiré, et rien ne
 * dit à l'utilisateur qu'il n'est jamais parti.
 */
import { render, screen } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Ionicons: ({ name, ...props }: { name: string }) =>
      React.createElement(View, { ...props, testID: `icon-${name}` }),
  };
});
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});

import ChatBubble from './ChatBubble';
import type { Message } from '@/types';

const base: Message = {
  id: 'm1',
  chatId: 'c1',
  senderId: 'me',
  receiverId: 'other',
  type: 'text',
  content: 'Bonjour',
  timestamp: new Date('2026-06-12T14:30:00Z'),
  status: 'sending',
  isRead: false,
};

describe('<ChatBubble /> — accusés de réception', () => {
  it('affiche l’horloge tant que le message est en vol', () => {
    render(<ChatBubble message={base} isOwnMessage />);
    expect(screen.queryByTestId('icon-time-outline')).toBeTruthy();
    expect(screen.queryByTestId('icon-alert-circle')).toBeNull();
  });

  it('affiche un signal d’échec quand l’envoi a échoué', () => {
    const failed = { ...base, failed: true } as Message;
    render(<ChatBubble message={failed} isOwnMessage />);
    expect(screen.queryByTestId('icon-alert-circle')).toBeTruthy();
    expect(screen.queryByTestId('icon-time-outline')).toBeNull();
  });

  it('un simple ✓ quand le message est parti', () => {
    render(<ChatBubble message={{ ...base, status: 'sent' }} isOwnMessage />);
    expect(screen.queryByTestId('icon-checkmark')).toBeTruthy();
  });

  it('aucun accusé sur le message de l’autre', () => {
    render(<ChatBubble message={{ ...base, senderId: 'other' }} isOwnMessage={false} />);
    expect(screen.queryByTestId('icon-time-outline')).toBeNull();
    expect(screen.queryByTestId('icon-alert-circle')).toBeNull();
  });
});
