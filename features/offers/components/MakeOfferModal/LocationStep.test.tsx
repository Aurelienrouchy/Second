import React, { useState } from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { MeetupNeighborhood, MeetupSpot } from '@/types';
import { initialState, type MakeOfferContext, type MakeOfferState } from './types';
import LocationStep from './LocationStep';
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetTextInput: require('react-native').TextInput }));
jest.mock('@shopify/flash-list', () => {
  const ReactMock = require('react');
  return { FlashList: ({ data, renderItem }: { data: unknown[]; renderItem: (item: { item: unknown }) => React.ReactNode }) =>
    ReactMock.createElement(require('react-native').View, null, data.map((item, index) => ReactMock.createElement(ReactMock.Fragment, { key: index }, renderItem({ item })))) };
});
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/data/neighborhoods', () => ({
  MONTREAL_NEIGHBORHOODS: [{ id: 'n1', name: 'Plateau', borough: 'Plateau' }],
  searchNeighborhoods: () => [{ id: 'n1', name: 'Plateau', borough: 'Plateau' }],
  getPopularSpotsForNeighborhood: () => [{ id: 's1', name: 'Café X', category: 'cafe', neighborhood: { id: 'n1', name: 'Plateau', borough: 'Plateau' } }],
}));
const advanced = jest.fn();
function Harness({ initial = {} }: { initial?: Partial<MakeOfferState> }) {
  const [state, setState] = useState({ ...initialState, step: 'location' as const, ...initial });
  const field = (key: keyof MakeOfferState, value: unknown) => setState((s) => ({ ...s, [key]: value }));
  const context: MakeOfferContext = { state, articleId: 'a1', articleTitle: 'Veste', currentPrice: 100, onClose: jest.fn(), actions: {
    setStep: (step) => { advanced(step); field('step', step); }, setMode: (mode) => field('mode', mode),
    setOfferAmount: (amount) => field('offerAmount', amount), setMessage: (message) => field('message', message),
    setSelectedNeighborhood: (area: MeetupNeighborhood | null) => field('selectedNeighborhood', area),
    setSelectedSpot: (spot: MeetupSpot | null) => field('selectedSpot', spot),
    setCustomSpotName: (name) => field('customSpotName', name), setIsSubmitting: (busy) => field('isSubmitting', busy),
  } };
  return state.step === 'confirm' ? <Text>RÉCAPITULATIF</Text> : <LocationStep context={context} />;
}
beforeEach(() => advanced.mockClear());
describe('Location selection requires an explicit Continue', () => {
  it('a popular place only selects; Continue advances to recap', () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId('offer-location-item-n1'));
    fireEvent.press(screen.getByTestId('offer-location-item-s1'));
    expect(advanced).not.toHaveBeenCalled();
    expect(screen.queryByText('RÉCAPITULATIF')).toBeNull();
    fireEvent.press(screen.getByTestId('offer-location-continue'));
    expect(screen.getByText('RÉCAPITULATIF')).toBeOnTheScreen();
  });
  it('a deferred place requires the same Continue and no neighborhood', () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId('offer-location-to-arrange'));
    expect(advanced).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('offer-location-continue')).toHaveLength(1);
    const controls = screen.UNSAFE_getAllByType(require('react-native').View).filter(node => node.props.children);
    const pair = controls.find(node => {
      const children = React.Children.toArray(node.props.children) as React.ReactElement<{testID?: string}>[];
      return children.some(child => child.props?.testID === 'offer-location-to-arrange') && children.some(child => child.props?.testID === 'offer-location-continue');
    });
    expect(pair).toBeDefined();
    const order = (React.Children.toArray(pair!.props.children) as React.ReactElement<{testID?: string}>[]).map(child => child.props?.testID);
    expect(order.indexOf('offer-location-continue')).toBe(order.indexOf('offer-location-to-arrange') + 1);
    fireEvent.press(screen.getByTestId('offer-location-continue'));
    expect(screen.getByText('RÉCAPITULATIF')).toBeOnTheScreen();
  });
  it('a custom place requires its name then Continue', () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId('offer-location-item-n1'));
    fireEvent.press(screen.getByText('Proposer un autre lieu'));
    fireEvent.press(screen.getByTestId('offer-location-continue'));
    expect(advanced).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByPlaceholderText('Ex: Café Olimpico, Station Laurier...'), 'Bibliothèque');
    expect(advanced).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('offer-location-continue'));
    expect(screen.getByText('RÉCAPITULATIF')).toBeOnTheScreen();
  });
  it('Continue is disabled without a selected place', () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId('offer-location-continue'));
    expect(advanced).not.toHaveBeenCalled();
  });
});
