import React, { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NeighborhoodBottomSheet, { type NeighborhoodBottomSheetRef } from '../pricing/NeighborhoodBottomSheet';
import { getNeighborhoodById } from '@/data/neighborhoods';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react') as typeof import('react');
  const { View, TextInput } = require('react-native') as typeof import('react-native');
  type MockFooterProps = { animatedFooterPosition: { value: number } };
  // Same reconciliation seam as Gorhom: the supplied function is a component type,
  // rendered behind a memoized footer container, not called as a render prop.
  const FooterContainer = React.memo(function MockFooterContainer({ Footer }: { Footer: React.ComponentType<MockFooterProps> }) {
    return <Footer animatedFooterPosition={{ value: 0 }} />;
  });
  return {
    __esModule: true,
    default: React.forwardRef(function MockBottomSheet({ children, footerComponent: Footer }: { children: React.ReactNode; footerComponent?: React.ComponentType<MockFooterProps> }, ref) {
      React.useImperativeHandle(ref, () => ({ close: jest.fn(), snapToIndex: jest.fn() }));
      return <View>{children}{Footer ? <FooterContainer Footer={Footer} /> : null}</View>;
    }),
    BottomSheetFooter: View,
    BottomSheetBackdrop: View,
    BottomSheetTextInput: TextInput,
    BottomSheetSectionList: ({ sections, renderItem }: { sections: Array<{ data: Array<{ id: string }> }>; renderItem: (info: { item: { id: string } }) => React.ReactNode }) =>
      <View>{sections.flatMap(section => section.data).map(item => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)}</View>,
    useBottomSheetTimingConfigs: () => ({}),
  };
});

it('keeps the confirmation mounted while updating its count and confirms the current buffered selection once', () => {
  const ref = createRef<NeighborhoodBottomSheetRef>();
  const onConfirm = jest.fn();
  render(<NeighborhoodBottomSheet ref={ref} selectedNeighborhoods={[]} onConfirm={onConfirm} />);
  act(() => ref.current?.show());
  const initialButton = screen.getByTestId('neighborhood-sheet-confirm');
  fireEvent.press(screen.getByText('Vieux-Montréal'));
  expect(screen.getByTestId('neighborhood-sheet-confirm') === initialButton).toBe(true);
  expect(screen.getByText('VALIDER (1)')).toBeTruthy();
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.press(initialButton);
  fireEvent.press(initialButton);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onConfirm).toHaveBeenCalledWith([getNeighborhoodById('old-montreal')]);
});
