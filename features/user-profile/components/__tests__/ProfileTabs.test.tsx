/**
 * ProfileTabs — barre d'onglets Articles / Avis du profil.
 *
 * Domaine : profil-reviews. Comportement MÉTIER couvert :
 *  - taper un onglet remonte la cible ('articles' | 'avis') au parent.
 *  - le badge de compteur sur "Avis" n'apparaît QUE lorsqu'il y a des avis
 *    (reviewCount > 0), et affiche le nombre entre parenthèses.
 *
 * .test.tsx → périmètre Jest.
 */

import { fireEvent, render } from '@testing-library/react-native';

// On importe le composant par son chemin direct (pas le barrel) : le barrel
// @/features/user-profile tire ProfileHeader → components/ui (Avatar /
// OfflineBanner) qui pullent des ESM natifs (expo-linear-gradient, expo-network)
// non transpilés sous Jest et hors périmètre de ce test.
import { ProfileTabs } from '@/features/user-profile/components/ProfileTabs';

describe('ProfileTabs — changement d’onglet', () => {
  it('remonte "avis" quand on tape l’onglet Avis', () => {
    const onTabChange = jest.fn();
    const { getByTestId } = render(
      <ProfileTabs activeTab="articles" onTabChange={onTabChange} reviewCount={0} />,
    );

    fireEvent.press(getByTestId('profile-tab-avis'));
    expect(onTabChange).toHaveBeenCalledWith('avis');
  });

  it('remonte "articles" quand on tape l’onglet Articles', () => {
    const onTabChange = jest.fn();
    const { getByTestId } = render(
      <ProfileTabs activeTab="avis" onTabChange={onTabChange} reviewCount={2} />,
    );

    fireEvent.press(getByTestId('profile-tab-articles'));
    expect(onTabChange).toHaveBeenCalledWith('articles');
  });
});

describe('ProfileTabs — badge de compteur d’avis', () => {
  it('affiche le nombre d’avis entre parenthèses quand il y en a', () => {
    const { getByText } = render(
      <ProfileTabs activeTab="articles" onTabChange={jest.fn()} reviewCount={4} />,
    );

    expect(getByText('Avis (4)')).toBeTruthy();
  });

  it('n’affiche pas de compteur quand il n’y a aucun avis', () => {
    const { getByText, queryByText } = render(
      <ProfileTabs activeTab="articles" onTabChange={jest.fn()} reviewCount={0} />,
    );

    expect(getByText('Avis')).toBeTruthy();
    expect(queryByText(/Avis \(/)).toBeNull();
  });
});
