/**
 * Tests métier — <OfferStep /> (components/MakeOfferModal/OfferStep.tsx).
 *
 * Première étape du tunnel « Faire une offre ». Règles métier vérifiées :
 *  - Montant invalide / vide / < 1 $ → alerte d'erreur, pas d'avancement.
 *  - Montant > plafond serveur (50000 $) → alerte plafond, pas d'avancement.
 *  - Offre « lowball » (< 30 % du prix affiché) → alerte de confirmation ;
 *    l'utilisateur peut « Continuer quand même ».
 *  - Montant valide → on avance à l'étape suivante selon le mode :
 *      meetup   : offer → location
 *      shipping : offer → confirm
 *  - Le pourcentage de réduction affiché reflète le montant saisi.
 */

import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

// @expo/vector-icons tire expo-font (ESM non transpilé sous jest-expo) ; on le
// neutralise localement par un stub View sans toucher au setup partagé.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Ionicons: (props: Record<string, unknown>) => React.createElement(View, props) };
});

// BottomSheetTextInput de @gorhom/bottom-sheet → on l'alias sur un TextInput RN
// classique (le contexte BottomSheet n'est pas monté dans ces tests d'étape).
jest.mock('@gorhom/bottom-sheet', () => {
  const { TextInput } = require('react-native');
  return { BottomSheetTextInput: TextInput };
});

import type { MakeOfferContext } from './types';
import OfferStep from './OfferStep';

function buildContext(overrides: Partial<MakeOfferContext> = {}): MakeOfferContext {
  const { state: stateOverride, actions: actionsOverride, ...rest } = overrides;
  return {
    state: {
      step: 'offer',
      mode: 'meetup',
      offerAmount: '',
      message: '',
      selectedNeighborhood: null,
      selectedSpot: null,
      customSpotName: '',
      isSubmitting: false,
      ...stateOverride,
    },
    actions: {
      setStep: jest.fn(),
      setMode: jest.fn(),
      setOfferAmount: jest.fn(),
      setMessage: jest.fn(),
      setSelectedNeighborhood: jest.fn(),
      setSelectedSpot: jest.fn(),
      setCustomSpotName: jest.fn(),
      setIsSubmitting: jest.fn(),
      ...actionsOverride,
    },
    articleTitle: 'Veste en cuir',
    currentPrice: 100,
    onClose: jest.fn(),
    ...rest,
  };
}

describe('<OfferStep /> — validation du montant', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('refuse un montant vide et n’avance pas', () => {
    const context = buildContext({ state: { offerAmount: '' } as never });
    render(<OfferStep context={context} />);

    fireEvent.press(screen.getByText('Continuer'));

    expect(alertSpy).toHaveBeenCalledWith('Erreur', 'Veuillez entrer un montant valide');
    expect(context.actions.setStep).not.toHaveBeenCalled();
  });

  it('refuse un montant sous le minimum (< 1 $)', () => {
    const context = buildContext({ state: { offerAmount: '0' } as never });
    render(<OfferStep context={context} />);

    fireEvent.press(screen.getByText('Continuer'));

    expect(alertSpy).toHaveBeenCalledWith('Erreur', 'Veuillez entrer un montant valide');
    expect(context.actions.setStep).not.toHaveBeenCalled();
  });

  it('refuse un montant au-dessus du plafond serveur (50000 $)', () => {
    const context = buildContext({ state: { offerAmount: '50001' } as never });
    render(<OfferStep context={context} />);

    fireEvent.press(screen.getByText('Continuer'));

    expect(alertSpy).toHaveBeenCalledWith('Montant trop élevé', expect.stringContaining('50000'));
    expect(context.actions.setStep).not.toHaveBeenCalled();
  });

  it('alerte sur une offre lowball (< 30 % du prix) sans avancer immédiatement', () => {
    // 25 $ pour un article à 100 $ → 25 % < 30 % → confirmation requise.
    const context = buildContext({ state: { offerAmount: '25' } as never });
    render(<OfferStep context={context} />);

    fireEvent.press(screen.getByText('Continuer'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Offre trop basse',
      expect.any(String),
      expect.any(Array),
    );
    expect(context.actions.setStep).not.toHaveBeenCalled();
  });

  it('lowball : "Continuer quand même" fait avancer à l’étape location (meetup)', () => {
    const context = buildContext({ state: { offerAmount: '25', mode: 'meetup' } as never });
    render(<OfferStep context={context} />);

    fireEvent.press(screen.getByText('Continuer'));

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === 'Continuer quand même')!.onPress!();

    expect(context.actions.setStep).toHaveBeenCalledWith('location');
  });

  it('montant raisonnable en meetup → avance directement vers location', () => {
    const context = buildContext({ state: { offerAmount: '80', mode: 'meetup' } as never });
    render(<OfferStep context={context} />);

    fireEvent.press(screen.getByText('Continuer'));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(context.actions.setStep).toHaveBeenCalledWith('location');
  });

  it('montant raisonnable en shipping → saute location et va vers confirm', () => {
    const context = buildContext({ state: { offerAmount: '80', mode: 'shipping' } as never });
    render(<OfferStep context={context} />);

    fireEvent.press(screen.getByText('Continuer'));

    expect(context.actions.setStep).toHaveBeenCalledWith('confirm');
  });

  it('affiche le pourcentage de réduction correspondant au montant saisi', () => {
    const context = buildContext({ state: { offerAmount: '70' } as never });
    render(<OfferStep context={context} />);

    // 70 $ pour 100 $ → 30 % de réduction.
    expect(screen.getByText('30% de réduction')).toBeOnTheScreen();
  });
});
