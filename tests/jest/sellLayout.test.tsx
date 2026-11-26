/**
 * Tunnel de vente — un invité qui se connecte depuis le tunnel y revient.
 *
 * La feuille annonçait « Connectez-vous pour vendre un article », mais son
 * rappel de succès était vide : une fois connecté, le vendeur restait sur
 * l'accueil où le tunnel l'avait renvoyé.
 */
const mockReplace = jest.fn();
const mockShow = jest.fn();
const mockRouter = {replace: mockReplace};
let mockFocused = true;

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(() => { if (mockFocused) return effect(); }, [effect, mockFocused]),

  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => mockRouter,
}));
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => 0,
  useAuthStore: jest.requireActual('zustand').create(() => ({
    user: null, identityUser: null, authenticatedUid: null, isLoading: false,
  })),
}));
jest.mock('@/store/authSheetStore', () => ({
  useAuthSheetStore: { getState: () => ({ show: mockShow }) },
}));

import { render } from '@testing-library/react-native';

import SellLayout from '@/app/sell/_layout';

beforeEach(() => { jest.clearAllMocks(); mockFocused = true; });

describe('SellLayout — invité', () => {
  it('ramène au tunnel de vente après la connexion', () => {
    render(<SellLayout />);
    expect(mockShow).toHaveBeenCalledTimes(1);
    const onSuccess = mockShow.mock.calls[0][1] as () => void;
    mockReplace.mockClear();
    onSuccess();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/sell');
  });
});

it('ne représente pas la feuille sur un rendu du même focus, mais la repropose après un vrai retour', () => {
 const view = render(<SellLayout />); expect(mockShow).toHaveBeenCalledTimes(1);
 view.rerender(<SellLayout />); expect(mockShow).toHaveBeenCalledTimes(1);
 mockFocused = false; view.rerender(<SellLayout />); expect(mockShow).toHaveBeenCalledTimes(1);
 mockFocused = true; view.rerender(<SellLayout />); expect(mockShow).toHaveBeenCalledTimes(2);
});
