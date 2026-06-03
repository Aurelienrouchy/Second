/**
 * ChatInputBar — barre de saisie de la conversation.
 *
 * Comportement métier couvert (anti double-envoi / UX d'envoi) :
 *  - le bouton Envoyer est désactivé tant que le champ est vide / blanc.
 *  - il s'active dès qu'il y a du contenu non-blanc.
 *  - il se re-désactive pendant un envoi en cours (`isSending`) — garde
 *    anti double-envoi pendant que le message texte est en vol.
 *  - le bouton Offre n'apparaît que quand la conversation porte sur un article.
 *
 * .test.tsx → périmètre Jest. Utilise les testID stables ajoutés au composant
 * (chat-input / chat-send-button), réutilisés par le flow Maestro.
 */

import { fireEvent, render } from '@testing-library/react-native';

// expo-linear-gradient ship en ESM (non transpilé sous Jest) et est tiré via
// le barrel feature (ChatLoadingSkeleton → Skeleton). On le stub comme les
// autres modules natifs sans implémentation Node.
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: (props: Record<string, unknown>) => React.createElement(View, props) };
});

import { ChatInputBar } from '@/features/chat';

function setup(overrides: Partial<React.ComponentProps<typeof ChatInputBar>> = {}) {
  const onSend = jest.fn();
  const onChangeText = jest.fn();
  const onPickImage = jest.fn();
  const onMakeOffer = jest.fn();
  const utils = render(
    <ChatInputBar
      messageText=""
      onChangeText={onChangeText}
      onSend={onSend}
      onPickImage={onPickImage}
      onMakeOffer={onMakeOffer}
      isSendingImage={false}
      hasArticle={false}
      {...overrides}
    />,
  );
  return { ...utils, onSend, onChangeText, onMakeOffer };
}

describe('ChatInputBar — gating du bouton Envoyer', () => {
  it('reste inactif (onSend non appelé) quand le champ est vide', () => {
    const { getByTestId, onSend } = setup({ messageText: '' });
    fireEvent.press(getByTestId('chat-send-button'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('reste inactif quand le champ ne contient que des espaces', () => {
    const { getByTestId, onSend } = setup({ messageText: '   ' });
    fireEvent.press(getByTestId('chat-send-button'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('déclenche onSend quand le champ contient du texte', () => {
    const { getByTestId, onSend } = setup({ messageText: 'Bonjour' });
    fireEvent.press(getByTestId('chat-send-button'));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('bloque le double-envoi pendant un envoi en cours (isSending)', () => {
    const { getByTestId, onSend } = setup({ messageText: 'Bonjour', isSending: true });
    fireEvent.press(getByTestId('chat-send-button'));
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('ChatInputBar — propagation de la saisie', () => {
  it('remonte le texte saisi via onChangeText', () => {
    const { getByTestId, onChangeText } = setup();
    fireEvent.changeText(getByTestId('chat-input'), 'Coucou');
    expect(onChangeText).toHaveBeenCalledWith('Coucou');
  });
});

describe('ChatInputBar — bouton Offre conditionnel à l’article', () => {
  it('n’affiche pas le bouton Offre hors contexte article', () => {
    const { queryByTestId } = setup({ hasArticle: false });
    expect(queryByTestId('chat-offer-button')).toBeNull();
  });

  it('affiche le bouton Offre et déclenche onMakeOffer quand un article est attaché', () => {
    const { getByTestId, onMakeOffer } = setup({ hasArticle: true });
    fireEvent.press(getByTestId('chat-offer-button'));
    expect(onMakeOffer).toHaveBeenCalledTimes(1);
  });
});
