/**
 * UserActions — boutons Contacter + S'abonner du profil public.
 *
 * Domaine : profil-reviews. Comportement MÉTIER couvert :
 *  - le libellé du bouton suivi reflète l'état : "S'ABONNER" si non suivi,
 *    "ABONNÉ" une fois abonné.
 *  - taper Contacter / S'abonner déclenche les callbacks correspondants.
 *  - pendant un envoi de suivi (isFollowLoading), le bouton est désactivé
 *    (garde anti double-toggle).
 *  - pendant l'ouverture d'une conversation (isContactLoading), le bouton
 *    Contacter est désactivé et n'appelle pas onContact.
 *
 * .test.tsx → périmètre Jest.
 */

import { fireEvent, render } from '@testing-library/react-native';

// On importe le composant par son chemin direct (pas le barrel) : le barrel
// @/features/user-profile tire ProfileHeader → components/ui (Avatar /
// OfflineBanner) qui pullent des ESM natifs (expo-linear-gradient, expo-network)
// non transpilés sous Jest et hors périmètre de ce test.
import { UserActions } from '@/features/user-profile/components/UserActions';

function setup(overrides: Partial<React.ComponentProps<typeof UserActions>> = {}) {
  const onContact = jest.fn();
  const onFollow = jest.fn();
  const utils = render(
    <UserActions
      isFollowing={false}
      isContactLoading={false}
      isFollowLoading={false}
      onContact={onContact}
      onFollow={onFollow}
      {...overrides}
    />,
  );
  return { ...utils, onContact, onFollow };
}

describe('UserActions — libellé de suivi', () => {
  it('affiche "S\'ABONNER" quand l’utilisateur ne suit pas encore le vendeur', () => {
    const { getByText } = setup({ isFollowing: false });
    expect(getByText("S'ABONNER")).toBeTruthy();
  });

  it('affiche "ABONNÉ" une fois le vendeur suivi', () => {
    const { getByText, queryByText } = setup({ isFollowing: true });
    expect(getByText('ABONNÉ')).toBeTruthy();
    expect(queryByText("S'ABONNER")).toBeNull();
  });
});

describe('UserActions — actions', () => {
  it('déclenche onContact au tap sur Contacter', () => {
    const { getByText, onContact } = setup();
    fireEvent.press(getByText('CONTACTER'));
    expect(onContact).toHaveBeenCalledTimes(1);
  });

  it('déclenche onFollow au tap sur S\'abonner', () => {
    const { getByText, onFollow } = setup();
    fireEvent.press(getByText("S'ABONNER"));
    expect(onFollow).toHaveBeenCalledTimes(1);
  });
});

describe('UserActions — gardes pendant le chargement', () => {
  it('désactive le suivi pendant un toggle en cours (anti double-toggle)', () => {
    const { getByText, onFollow } = setup({ isFollowLoading: true });
    fireEvent.press(getByText("S'ABONNER"));
    expect(onFollow).not.toHaveBeenCalled();
  });

  it('désactive Contacter pendant l’ouverture d’une conversation', () => {
    // En chargement, le label "CONTACTER" est remplacé par un spinner : on cible
    // le bouton via son testID stable et on vérifie qu'il n'appelle pas onContact.
    const { getByTestId, queryByText, onContact } = setup({
      isContactLoading: true,
    });
    // Le texte "CONTACTER" disparaît au profit de l'ActivityIndicator.
    expect(queryByText('CONTACTER')).toBeNull();

    fireEvent.press(getByTestId('profile-contact-button'));
    expect(onContact).not.toHaveBeenCalled();
  });
});
