/**
 * Tests métier — <ConfirmStep /> (components/MakeOfferModal/ConfirmStep.tsx).
 *
 * Dernière étape du tunnel d'offre : récapitulatif + envoi. Règles métier :
 *  - Mode shipping : envoie via onSubmitShipping(montant, message), affiche un
 *    accusé de succès, puis ferme la modale.
 *  - Mode meetup : envoie via onSubmitMeetup(montant, message, spot). Sans spot
 *    sélectionné → alerte "Informations manquantes", aucun envoi.
 *  - Échec d'envoi → alerte d'erreur, la modale NE se ferme PAS (l'utilisateur
 *    peut réessayer).
 *  - Pendant l'envoi, isSubmitting passe à true puis false (toggle du spinner /
 *    désactivation du bouton).
 *  - Le récapitulatif reflète le mode (libellé "MONTANT À PAYER" en meetup vs
 *    "MONTANT DE L'OFFRE" en shipping) et la mention d'expiration 48h.
 */

import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// @expo/vector-icons tire expo-font (ESM non transpilé sous jest-expo) ; on le
// neutralise localement par un stub View sans toucher au setup partagé.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Ionicons: (props: Record<string, unknown>) => React.createElement(View, props) };
});

import type { MeetupSpot } from '@/types';

import type { MakeOfferContext } from './types';
import ConfirmStep from './ConfirmStep';

const spot: MeetupSpot = {
  id: 'spot-1',
  name: 'Métro Berri-UQAM',
  category: 'metro',
  neighborhood: { id: 'n-1', name: 'Quartier latin', borough: 'Ville-Marie' },
} as unknown as MeetupSpot;

function buildContext(overrides: Partial<MakeOfferContext> = {}): MakeOfferContext {
  const { state: stateOverride, actions: actionsOverride, ...rest } = overrides;
  return {
    state: {
      step: 'confirm',
      mode: 'meetup',
      offerAmount: '80',
      message: '',
      selectedNeighborhood: null,
      selectedSpot: spot,
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

describe('<ConfirmStep /> — envoi de l’offre', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('meetup : envoie montant + message + spot puis ferme la modale', async () => {
    const onSubmitMeetup = jest.fn().mockResolvedValue(undefined);
    const context = buildContext({ state: { message: 'Dispo ce soir' } as never });

    render(<ConfirmStep context={context} onSubmitMeetup={onSubmitMeetup} />);
    fireEvent.press(screen.getByText("ENVOYER L'OFFRE"));

    await waitFor(() =>
      expect(onSubmitMeetup).toHaveBeenCalledWith(80, 'Dispo ce soir', spot),
    );
    await waitFor(() => expect(context.onClose).toHaveBeenCalledTimes(1));
    // toggle du flag de soumission autour de l'appel async
    expect(context.actions.setIsSubmitting).toHaveBeenCalledWith(true);
    expect(context.actions.setIsSubmitting).toHaveBeenCalledWith(false);
  });

  it('meetup sans spot sélectionné : alerte "Informations manquantes", aucun envoi', () => {
    const onSubmitMeetup = jest.fn();
    const context = buildContext({ state: { selectedSpot: null } as never });

    render(<ConfirmStep context={context} onSubmitMeetup={onSubmitMeetup} />);
    fireEvent.press(screen.getByText("ENVOYER L'OFFRE"));

    expect(onSubmitMeetup).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Erreur', 'Informations manquantes');
  });

  it('meetup : un échec d’envoi alerte sans fermer la modale (retry possible)', async () => {
    const onSubmitMeetup = jest.fn().mockRejectedValue(new Error('offline'));
    const context = buildContext();

    render(<ConfirmStep context={context} onSubmitMeetup={onSubmitMeetup} />);
    fireEvent.press(screen.getByText("ENVOYER L'OFFRE"));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Erreur',
        expect.stringContaining("Impossible d'envoyer"),
      ),
    );
    expect(context.onClose).not.toHaveBeenCalled();
    // le flag de soumission est bien relâché même en cas d'erreur
    expect(context.actions.setIsSubmitting).toHaveBeenLastCalledWith(false);
  });

  it('shipping : envoie montant + message (sans spot) puis ferme la modale', async () => {
    const onSubmitShipping = jest.fn().mockResolvedValue(undefined);
    const context = buildContext({
      state: { mode: 'shipping', offerAmount: '120', message: 'Merci' } as never,
    });

    render(<ConfirmStep context={context} onSubmitShipping={onSubmitShipping} />);
    fireEvent.press(screen.getByText("ENVOYER L'OFFRE"));

    await waitFor(() => expect(onSubmitShipping).toHaveBeenCalledWith(120, 'Merci'));
    await waitFor(() => expect(context.onClose).toHaveBeenCalledTimes(1));
  });

  it('shipping sans callback fourni : alerte "Informations manquantes"', () => {
    const context = buildContext({ state: { mode: 'shipping' } as never });

    render(<ConfirmStep context={context} />);
    fireEvent.press(screen.getByText("ENVOYER L'OFFRE"));

    expect(alertSpy).toHaveBeenCalledWith('Erreur', 'Informations manquantes');
  });

  it('le récapitulatif meetup mentionne le paiement en main propre et l’expiration 48h', () => {
    const context = buildContext();
    render(<ConfirmStep context={context} onSubmitMeetup={jest.fn()} />);

    expect(screen.getByText('MONTANT A PAYER')).toBeOnTheScreen();
    expect(
      screen.getByText(/paiement en main propre lors du meetup/i),
    ).toBeOnTheScreen();
    expect(screen.getByText(/expire après 48h sans réponse/i)).toBeOnTheScreen();
  });

  it('le récapitulatif shipping mentionne le montant de l’offre et la livraison', () => {
    const context = buildContext({ state: { mode: 'shipping' } as never });
    render(<ConfirmStep context={context} onSubmitShipping={jest.fn()} />);

    expect(screen.getByText("MONTANT DE L'OFFRE")).toBeOnTheScreen();
    expect(screen.getByText('LIVRAISON')).toBeOnTheScreen();
  });

  it('le bouton d’envoi est désactivé pendant la soumission', () => {
    const context = buildContext({ state: { isSubmitting: true } as never });
    render(<ConfirmStep context={context} onSubmitMeetup={jest.fn()} />);

    // Spinner affiché → le libellé ENVOYER L'OFFRE n'est plus rendu.
    expect(screen.queryByText("ENVOYER L'OFFRE")).toBeNull();
  });
});
