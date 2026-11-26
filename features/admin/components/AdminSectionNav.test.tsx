/**
 * La barre de navigation entre écrans d'administration.
 *
 * Elle existe parce que `/admin/reports` et `/admin/disputes` n'étaient
 * atteignables par AUCUN chemin dans l'application : le seul lien, dans
 * Réglages, ouvre `/admin/shops`. La file des signalements d'absence — recours
 * du seul parcours d'achat actif — était donc invisible pour l'administrateur.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { AdminSectionNav } from './AdminSectionNav';

// Le mock global de jest.setup.js fige `usePathname` sur '/'. On le remplace
// ici par une fonction pilotable : la route courante est justement ce que ce
// composant lit pour décider quelle section est active.
const mockRouter = { replace: jest.fn(), push: jest.fn() };
const mockPathname = jest.fn(() => '/admin/shops');
jest.mock('expo-router', () => ({
  // Accesseur et non valeur directe : la fabrique du mock est hoistée au-dessus
  // des `const` ci-dessus, qui seraient donc encore dans leur zone morte.
  get router() {
    return mockRouter;
  },
  usePathname: () => mockPathname(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname.mockReturnValue('/admin/shops');
});

describe('AdminSectionNav', () => {
  it('expose les trois sections', () => {
    render(<AdminSectionNav />);

    expect(screen.getByTestId('admin-nav-boutiques')).toBeTruthy();
    expect(screen.getByTestId('admin-nav-signalements')).toBeTruthy();
    expect(screen.getByTestId('admin-nav-litiges')).toBeTruthy();
  });

  it("marque comme sélectionnée la section correspondant à la route courante", () => {
    mockPathname.mockReturnValue('/admin/disputes');
    render(<AdminSectionNav />);

    expect(screen.getByTestId('admin-nav-litiges').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('admin-nav-boutiques').props.accessibilityState.selected).toBe(false);
  });

  it('navigue vers les litiges, qui étaient jusqu’ici sans chemin d’accès', () => {
    render(<AdminSectionNav />);

    fireEvent.press(screen.getByTestId('admin-nav-litiges'));

    expect(mockRouter.replace).toHaveBeenCalledWith('/admin/disputes');
  });

  // `replace` et non `push` : trois vues sœurs, pas une profondeur. Avec
  // `push`, quatre allers-retours empileraient quatre écrans.
  it('remplace la route au lieu de l’empiler', () => {
    render(<AdminSectionNav />);

    fireEvent.press(screen.getByTestId('admin-nav-signalements'));

    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('ne renavigue pas vers la section déjà affichée', () => {
    render(<AdminSectionNav />);

    fireEvent.press(screen.getByTestId('admin-nav-boutiques'));

    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
