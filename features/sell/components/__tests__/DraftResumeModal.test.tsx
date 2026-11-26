import { auth } from '@/config/firebaseConfig';
beforeEach(() => { (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'uid' }; });
jest.mock('@/hooks/useFirebaseUserId', () => ({ useFirebaseUserId: () => 'uid' }));
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Modal, StyleSheet, Text } from 'react-native';

jest.mock('@expo/vector-icons', () => {
  const { View } = require('react-native');
  return { Ionicons: View };
});
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});

import DraftResumeModal from '../shared/DraftResumeModal';
import { ArticleDraft, createEmptyDraft } from '@/features/sell/services/draftService';
import { APP_LOCALE } from '@/constants/locale';
import { fonts } from '@/constants/theme';

function renderModal(overrides: Partial<ArticleDraft> = {}) {
  const onResume = jest.fn();
  const onDiscard = jest.fn();
  const onDismiss = jest.fn();
  const utils = render(
    <DraftResumeModal
      visible
      draft={{ ...createEmptyDraft(), photos: ['file:///a.jpg'], currentStep: 2, ...overrides }}
      onResume={onResume}
      onDiscard={onDiscard}
      onDismiss={onDismiss}
    />,
  );
  return { ...utils, onResume, onDiscard, onDismiss };
}

describe('<DraftResumeModal />', () => {
  it('le bouton retour d’Android ferme la fenêtre au lieu d’entrer dans le tunnel', () => {
    const { UNSAFE_getByType, onResume, onDismiss } = renderModal();
    UNSAFE_getByType(Modal).props.onRequestClose();
    expect(onDismiss).toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('« Recommencer » demande confirmation avant de détruire le brouillon', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { onDiscard } = renderModal();

    fireEvent.press(screen.getByText('Recommencer'));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Recommencer')!.onPress!();
    expect(onDiscard).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('date le brouillon sur sa création, celle que compte l’expiration (DS03)', () => {
    // Le décompte court depuis la création : afficher la dernière modification
    // à côté de lui donnait deux dates contradictoires.
    const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    renderModal({ createdAt, updatedAt: new Date().toISOString() });

    const attendu = new Date(createdAt).toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByText(`Créé le ${attendu}`)).toBeTruthy();
  });

  it('n’écrit aucun texte en police système (DR04)', () => {
    renderModal();
    // Les deux « fallback » du thème SONT la police système : les exclure,
    // sinon la vérification passe sur le défaut qu'on cherche à bannir.
    const duDS = (Object.values(fonts) as string[]).filter(
      (f) => f !== fonts.sansFallback && f !== fonts.serifFallback,
    );
    const horsDS = screen
      .UNSAFE_getAllByType(Text)
      .map((node) => StyleSheet.flatten(node.props.style)?.fontFamily ?? 'police système')
      .filter((f) => !duDS.includes(f));

    expect(screen.UNSAFE_getAllByType(Text).length).toBeGreaterThan(0);
    expect(horsDS).toEqual([]);
  });
});
