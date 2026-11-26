import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {Alert} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {searchCanadianAddresses} from '@/services/addressAutocompleteService';

let mockFrame = 1;
let mockFocused = true;
const mockRouteParams = {purpose: 'shipping_origin', from: 'shipping-preparation', articleId: 'article'};
const mockSelected = {name: 'Jean Test', street: '123 Rue Test', line2: 'Appartement 5', city: 'Québec', province: 'QC', postalCode: 'G1R 1A1', country: 'CA'};
let mockProfileAddress: typeof mockSelected | undefined;
const mockRead = jest.fn();
const mockSave = jest.fn();
const mockRefreshUser = jest.fn(async () => undefined);
interface MockPlaceDetails {address_components: {long_name: string; short_name: string; types: string[]}[]}
interface MockGoogleProps {onPress: (data: unknown, details: MockPlaceDetails | null) => void; onFail: () => void; onTimeout: () => void; onNotFound: () => void; textInputProps: {onChangeText: (text: string) => void}}
let mockGoogleProps: MockGoogleProps | undefined;
jest.mock('expo-router', () => ({useRouter: () => ({back: jest.fn()}), useLocalSearchParams: () => mockRouteParams}));
jest.mock('@/hooks/useAuth', () => ({useUser: () => ({id: 'seller', address: mockProfileAddress}), useAuthenticatedUid: () => 'seller', useAuthActions: () => ({refreshUser: mockRefreshUser})}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({frame: mockFrame, focused: mockFocused, focusRevision: String(mockFrame),
  capture: () => {if (!mockFocused) throw new Error('stale'); return {frame: mockFrame};},
  assertCurrent: (op: {frame: number}) => {if (!mockFocused || op.frame !== mockFrame) throw new Error('stale');},
  isCurrent: (op: {frame: number}) => mockFocused && op.frame === mockFrame,
})}));
jest.mock('@/services/sellerShippingAddressService', () => ({SellerShippingAddressService: {read: (...args: unknown[]) => mockRead(...args), save: (...args: unknown[]) => mockSave(...args)}}));
jest.mock('@/services/userService', () => ({UserService: {updateUserProfile: jest.fn()}}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('expo-crypto', () => ({CryptoDigestAlgorithm: {SHA256: 'SHA-256'}, digestStringAsync: jest.fn(async () => 'c'.repeat(64))}));
jest.mock('@/components/OrdinaryShippingAddressChoice', () => ({OrdinaryShippingAddressChoice: ({onKind, onAccepted}: {onKind: (kind: string) => void; onAccepted: () => void}) => {
  const React = require('react'), {Pressable, Text, View} = require('react-native');
  return React.createElement(View, null,
    React.createElement(Pressable, {onPress: () => onKind('ordinary_residential')}, React.createElement(Text, null, 'Résidentielle')),
    React.createElement(Pressable, {onPress: onAccepted}, React.createElement(Text, null, 'Confirmer le type')));
}}));
jest.mock('@/components/ui', () => {const {Text} = require('react-native'); return {Text, Label: Text, Caption: Text, ScreenHeader: () => null};});
jest.mock('react-native-google-places-autocomplete', () => ({GooglePlacesAutocomplete: (props: MockGoogleProps) => {
  mockGoogleProps = props;
  const React = require('react'), {TextInput} = require('react-native');
  return React.createElement(TextInput, {testID: 'google-address-input', onChangeText: props.textInputProps.onChangeText});
}}));
jest.mock('@/services/addressAutocompleteService', () => ({searchCanadianAddresses: jest.fn()}));
import AddressSettings from '@/app/settings/address';

let client: QueryClient;
const suggestion = {id: 'place-1', label: '4899 Avenue du Parc, Montréal, QC, H2V 4E7', street: '4899 Avenue du Parc', city: 'Montréal', province: 'QC', postalCode: 'H2V 4E7', country: 'Canada'};
beforeEach(() => {
  mockFrame = 1; mockFocused = true;
  mockRouteParams.purpose = 'shipping_origin'; mockProfileAddress = undefined;
  mockGoogleProps = undefined; delete process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
  mockRead.mockResolvedValue({protocol: 'seller_shipping_address_observation_v1', ownerId: 'seller', sourceHash: 'a'.repeat(64), canEdit: true, qualification: 'native_selected_address', selectedIndex: 0, selected: mockSelected});
  jest.mocked(searchCanadianAddresses).mockResolvedValue([suggestion]);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {client.clear(); jest.clearAllMocks(); jest.restoreAllMocks(); delete process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;});
function open() {return render(<QueryClientProvider client={client}><AddressSettings/></QueryClientProvider>);}

it('ouvre directement les champs profil préremplis sans carte de résumé en haut ni lecture d’origine inutile', () => {
  mockRouteParams.purpose = 'profile'; mockProfileAddress = {...mockSelected};
  open();
  expect(screen.queryByText('Adresse actuelle :')).toBeNull();
  expect(screen.queryByText('Modifier l’adresse du profil')).toBeNull();
  expect(screen.getByTestId('address-autocomplete-input')).toBeTruthy();
  expect(screen.getByDisplayValue('123 Rue Test')).toBeTruthy();
  expect(screen.getByDisplayValue('Québec')).toBeTruthy();
  expect(screen.getByDisplayValue('QC')).toBeTruthy();
  expect(screen.getByDisplayValue('G1R 1A1')).toBeTruthy();
  expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy();
  expect(mockRead).not.toHaveBeenCalled();
});

it('garde la recherche visible en édition d’origine et préremplit les champs au clic sans perdre nom ni appartement ni sauvegarder', async () => {
  open();
  await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  expect(screen.queryByText('Adresse de départ des expéditions vendeur')).toBeNull();
  fireEvent.changeText(screen.getByTestId('address-autocomplete-input'), '4899 parc');
  await waitFor(() => expect(screen.getByRole('button', {name: suggestion.label})).toBeTruthy());
  fireEvent.press(screen.getByRole('button', {name: suggestion.label}));
  expect(screen.getByDisplayValue('4899 Avenue du Parc')).toBeTruthy();
  expect(screen.getByDisplayValue('Montréal')).toBeTruthy();
  expect(screen.getByDisplayValue('QC')).toBeTruthy();
  expect(screen.getByDisplayValue('H2V 4E7')).toBeTruthy();
  expect(screen.getByDisplayValue('Jean Test')).toBeTruthy();
  expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
  expect(screen.UNSAFE_getByType(require('react-native').ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
});

it('ignore une réponse de recherche ancienne lorsque le membre a saisi une autre recherche', async () => {
  let resolveFirst: ((value: typeof suggestion[]) => void) | undefined;
  jest.mocked(searchCanadianAddresses).mockImplementationOnce(() => new Promise(resolve => {resolveFirst = resolve;}));
  jest.mocked(searchCanadianAddresses).mockResolvedValueOnce([{...suggestion, id: 'second', label: 'Nouvelle recherche', street: '222 Autre Rue'}]);
  open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('address-autocomplete-input'), 'premiere');
  await waitFor(() => expect(searchCanadianAddresses).toHaveBeenCalledTimes(1));
  fireEvent.changeText(screen.getByTestId('address-autocomplete-input'), 'deuxieme');
  await waitFor(() => expect(screen.getByText('Nouvelle recherche')).toBeTruthy());
  await act(async () => resolveFirst?.([suggestion]));
  expect(screen.queryByText(suggestion.label)).toBeNull();
  expect(screen.getByText('Nouvelle recherche')).toBeTruthy();
});

it('conserve la saisie lorsque l’adresse serveur est relue', async () => {
  open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('123 rue Sainte-Catherine'), '999 Rue Choisie');
  fireEvent.press(screen.getByText('Résidentielle'));
  fireEvent.press(screen.getByText('Confirmer le type'));
  const first = await mockRead.mock.results[0].value;
  mockRead.mockResolvedValue({...first, selected: {...mockSelected}});
  await act(async () => {await client.invalidateQueries({queryKey: ['seller-shipping-address']});});
  expect(screen.getByDisplayValue('999 Rue Choisie')).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('button', {name: /Enregistrer l.adresse/})).toBeEnabled());
});

it('garde la saisie et propose une reprise explicite lorsque l’adresse a été modifiée ailleurs', async () => {
  open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('123 rue Sainte-Catherine'), '999 Rue Choisie');
  fireEvent.press(screen.getByText('Résidentielle'));
  fireEvent.press(screen.getByText('Confirmer le type'));
  const first = await mockRead.mock.results[0].value;
  mockRead.mockResolvedValue({...first, sourceHash: 'b'.repeat(64), selected: {...mockSelected, street: 'Une autre adresse'}});
  await act(async () => {await client.invalidateQueries({queryKey: ['seller-shipping-address']});});
  expect(screen.getByDisplayValue('999 Rue Choisie')).toBeTruthy();
  await waitFor(() => expect(screen.getByText('L’adresse enregistrée a changé. Votre saisie est conservée.')).toBeTruthy());
  expect(screen.getByRole('button', {name: /Enregistrer l.adresse/})).toBeDisabled();
  fireEvent.press(screen.getByRole('button', {name: 'Actualiser'}));
  expect(screen.getByDisplayValue('999 Rue Choisie')).toBeTruthy();
  expect(screen.getByRole('button', {name: /Enregistrer l.adresse/})).toBeEnabled();
  expect(mockSave).not.toHaveBeenCalled();
});

it('relit automatiquement après un vrai rejet CAS au clic Enregistrer et ne renvoie jamais la mutation tout seul', async () => {
  open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('123 rue Sainte-Catherine'), '999 Rue Choisie');
  fireEvent.press(screen.getByText('Résidentielle'));
  fireEvent.press(screen.getByText('Confirmer le type'));
  const first = await mockRead.mock.results[0].value;
  mockRead.mockResolvedValue({...first, sourceHash: 'b'.repeat(64), selected: {...mockSelected, street: 'Une autre adresse'}});
  mockSave.mockRejectedValueOnce(new Error('L’adresse d’expédition sélectionnée a changé. Relisez-la avant toute mise à jour.'));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  fireEvent.press(screen.getByRole('button', {name: /Enregistrer l.adresse/}));
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText('L’adresse enregistrée a changé. Votre saisie est conservée.')).toBeTruthy());
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(screen.getByDisplayValue('999 Rue Choisie')).toBeTruthy();
  expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy();
  expect(screen.getByRole('button', {name: /Enregistrer l.adresse/})).toBeDisabled();
  fireEvent.press(screen.getByRole('button', {name: 'Actualiser'}));
  expect(screen.getByRole('button', {name: /Enregistrer l.adresse/})).toBeEnabled();
  expect(mockSave).toHaveBeenCalledTimes(1);
});

const googleDetails: MockPlaceDetails = {address_components: [
  {long_name: '4899', short_name: '4899', types: ['street_number']},
  {long_name: 'Avenue du Parc', short_name: 'Avenue du Parc', types: ['route']},
  {long_name: 'Montréal', short_name: 'Montréal', types: ['locality']},
  {long_name: 'Québec', short_name: 'QC', types: ['administrative_area_level_1']},
  {long_name: 'H2V 4E7', short_name: 'H2V 4E7', types: ['postal_code']},
  {long_name: 'Canada', short_name: 'CA', types: ['country']},
]};

it.each(['onFail', 'onTimeout', 'onNotFound', 'emptyDetails'] as const)('bascule réellement Google vers Photon après %s, sans laisser l’ancienne liste Google', async failure => {
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'dedicated-test-key';
  open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('google-address-input'), '4899 parc');
  act(() => {if (failure === 'emptyDetails') mockGoogleProps?.onPress({}, {address_components: []}); else mockGoogleProps?.[failure]();});
  expect(screen.queryByTestId('google-address-input')).toBeNull();
  expect(screen.getByTestId('address-autocomplete-input').props.value).toBe('4899 parc');
  await waitFor(() => expect(screen.getByRole('button', {name: suggestion.label})).toBeTruthy());
  fireEvent.press(screen.getByRole('button', {name: suggestion.label}));
  expect(screen.getByDisplayValue('Montréal')).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});

it.each(['new-input', 'blur'] as const)('ignore les détails Google différés après %s', async change => {
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'dedicated-test-key';
  const view = open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('google-address-input'), '4899 parc');
  // The widget's real request.onreadystatechange closes over onPress at row press.
  const pendingDetails = mockGoogleProps!.onPress;
  if (change === 'new-input') fireEvent.changeText(screen.getByTestId('google-address-input'), 'autre rue');
  else {mockFrame++; mockFocused = false; view.rerender(<QueryClientProvider client={client}><AddressSettings/></QueryClientProvider>);}
  await act(async () => pendingDetails({}, googleDetails));
  expect(screen.queryByDisplayValue('4899 Avenue du Parc')).toBeNull();
  expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});

it('remplit également tous les champs au clic sur une suggestion Google courante', async () => {
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'dedicated-test-key';
  open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('google-address-input'), '4899 parc');
  await act(async () => mockGoogleProps?.onPress({}, {address_components: [...googleDetails.address_components,
    {long_name: 'Appartement 99', short_name: '99', types: ['subpremise']}]}));
  expect(screen.getByDisplayValue('4899 Avenue du Parc')).toBeTruthy();
  expect(screen.getByDisplayValue('Montréal')).toBeTruthy();
  expect(screen.getByDisplayValue('H2V 4E7')).toBeTruthy();
  expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy();
  expect(screen.getByDisplayValue('Jean Test')).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});

it('renseigne l’appartement Google uniquement lorsque le complément est encore vide', async () => {
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY = 'dedicated-test-key';
  open(); await waitFor(() => expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Appartement, bureau ou complément d’adresse'), '');
  fireEvent.changeText(screen.getByTestId('google-address-input'), '4899 parc');
  await act(async () => mockGoogleProps?.onPress({}, {address_components: [...googleDetails.address_components,
    {long_name: 'Appartement 99', short_name: '99', types: ['subpremise']}]}));
  expect(screen.getByDisplayValue('Appartement 99')).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});
