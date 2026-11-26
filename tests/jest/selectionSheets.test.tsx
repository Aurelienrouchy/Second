import React, { createRef, useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getDocs, setDoc } from 'firebase/firestore';
import SelectionBottomSheet, { type SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import BrandSelectionSheet, { type BrandSelectionSheetRef } from '@/components/BrandSelectionSheet';
import type { SizeSystem } from '@/types/article';

jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@gorhom/bottom-sheet', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View, ScrollView, TextInput, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const Sheet = React.forwardRef<{ close: () => void }, {
    children?: React.ReactNode;
    footerComponent?: (props: Record<string, never>) => React.ReactNode;
    onClose?: () => void;
    accessible?: boolean;
  }>((props, ref) => {
    React.useImperativeHandle(ref, () => ({ close: () => props.onClose?.() }));
    return <View testID="selection-native-sheet" accessible={props.accessible ?? true}>{props.children}{props.footerComponent?.({})}</View>;
  });
  const List = ({ data, renderItem, ListFooterComponent, ListEmptyComponent }: {
    data: { value: string; label: string }[];
    renderItem: (info: { item: { value: string; label: string }; index: number }) => React.ReactNode;
    ListFooterComponent?: () => React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
  }) => (
    <View>
      {data.map((item, index) => <View key={item.value}>{renderItem({ item, index })}</View>)}
      {data.length === 0 && ListEmptyComponent}
      {ListFooterComponent?.()}
    </View>
  );
  return {
    __esModule: true,
    default: Sheet,
    BottomSheetBackdrop: View,
    BottomSheetFooter: View,
    BottomSheetScrollView: ScrollView,
    BottomSheetFlatList: List,
    BottomSheetTextInput: TextInput,
    TouchableOpacity: Pressable,
  };
});

function catalogue(labels: string[]) {
  const docs = labels.map((label) => ({ data: () => ({ value: label.toLowerCase(), label }) }));
  return { docs, forEach: (callback: (doc: (typeof docs)[number]) => void) => docs.forEach(callback) };
}

const mockGetDocs = jest.mocked(getDocs);

beforeEach(() => {
  mockGetDocs.mockResolvedValue(catalogue(['Zara', 'Uniqlo']) as unknown as Awaited<ReturnType<typeof getDocs>>);
});

describe('SelectionBottomSheet — choix de tailles contrôlé', () => {
  it('change la grille avec le parent, efface sa taille et reste ouverte avant le choix', () => {
    const onSystemChange = jest.fn();
    const onSelect = jest.fn();
    function ControlledSizes() {
      const ref = useRef<SelectionBottomSheetRef>(null);
      const [system, setSystem] = useState<SizeSystem>('EU');
      const [size, setSize] = useState<string | null>('42');
      useEffect(() => { ref.current?.show(); }, []);
      return (
        <>
          <Text testID="parent-size">{size ?? 'Aucune taille'}</Text>
          <SelectionBottomSheet
            ref={ref}
            title="Tailles"
            type="size"
            items={system === 'EU' ? [{ value: '42', label: '42' }] : [{ value: '8', label: '8' }]}
            sizeSystem={system}
            selectedValue={size}
            onSizeSystemChange={(next) => {
              onSystemChange(next);
              setSystem(next);
              setSize(null);
            }}
            onSelect={onSelect}
          />
        </>
      );
    }
    const view = render(<ControlledSizes />);
    expect(view.getByTestId('selection-native-sheet').props.accessible).toBe(false);
    fireEvent.press(view.getByTestId('selection-size-system-EU'));
    expect(onSystemChange).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('selection-size-system-US'));
    expect(onSystemChange).toHaveBeenCalledWith('US');
    expect(view.getByTestId('parent-size')).toHaveTextContent('Aucune taille');
    expect(view.queryByTestId('selection-item-42')).toBeNull();
    expect(view.getByRole('radio', { name: 'Tailles US', checked: true })).toBeTruthy();
    fireEvent.press(view.getByTestId('selection-item-8'));
    expect(onSelect).toHaveBeenCalledWith('8');
    expect(view.queryByText('Tailles')).toBeNull();
  });

  it('garde la sélection multiple existante sans afficher le changement EU/US', () => {
    const ref = createRef<SelectionBottomSheetRef>();
    const onSelect = jest.fn();
    const onSelectMultiple = jest.fn();
    const onSystemChange = jest.fn();
    const view = render(
      <SelectionBottomSheet
        ref={ref}
        title="Tailles"
        type="size"
        multiSelect
        sizeSystem="EU"
        onSizeSystemChange={onSystemChange}
        items={[{ value: '42', label: '42' }, { value: '44', label: '44' }]}
        selectedValues={['42']}
        onSelect={onSelect}
        onSelectMultiple={onSelectMultiple}
      />,
    );
    act(() => ref.current?.show());
    expect(view.getByTestId('selection-native-sheet').props.accessible).toBe(false);
    expect(view.queryByTestId('selection-size-system-EU')).toBeNull();
    fireEvent.press(view.getByTestId('selection-item-44'));
    fireEvent.press(view.getByTestId('selection-confirm-button'));
    expect(onSelectMultiple).toHaveBeenCalledWith(['42', '44']);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSystemChange).not.toHaveBeenCalled();
  });

  it.each(['size', 'color', 'default'] as const)('n’ajoute pas de commande à la feuille %s sans opt-in complet', (type) => {
    const ref = createRef<SelectionBottomSheetRef>();
    const view = render(
      <SelectionBottomSheet ref={ref} title="Choisir" type={type} items={[]} onSelect={jest.fn()} sizeSystem="EU" />,
    );
    act(() => ref.current?.show());
    expect(view.queryByTestId('selection-size-system-EU')).toBeNull();
  });
});

describe('BrandSelectionSheet — marque facultative', () => {
  it('permet Sans marque pendant le chargement et ferme sans écrire au catalogue', async () => {
    let resolveCatalogue!: (value: Awaited<ReturnType<typeof getDocs>>) => void;
    mockGetDocs.mockReturnValueOnce(new Promise((resolve) => { resolveCatalogue = resolve; }));
    const ref = createRef<BrandSelectionSheetRef>();
    const onSelectNoBrand = jest.fn();
    const onSelectSingle = jest.fn();
    const onConfirm = jest.fn();
    const view = render(
      <BrandSelectionSheet ref={ref} singleSelect selectedBrand="Zara" onSelectNoBrand={onSelectNoBrand} onSelectSingle={onSelectSingle} onConfirm={onConfirm} />,
    );
    act(() => ref.current?.show());
    expect(view.getByText('Chargement des marques...')).toBeTruthy();
    expect(view.getByTestId('selection-native-sheet').props.accessible).toBe(false);
    expect(view.queryByText('Tout effacer')).toBeNull();
    fireEvent.press(view.getByTestId('brand-none-option'));
    expect(onSelectNoBrand).toHaveBeenCalledTimes(1);
    expect(onSelectSingle).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
    expect(view.queryByText('Marques')).toBeNull();
    await act(async () => resolveCatalogue(catalogue([]) as unknown as Awaited<ReturnType<typeof getDocs>>));
  });

  it('reflète une marque vide contrôlée et préserve la recherche puis le choix nommé', async () => {
    jest.useFakeTimers();
    try {
      const ref = createRef<BrandSelectionSheetRef>();
      const onSelectSingle = jest.fn();
      const onSelectNoBrand = jest.fn();
      const view = render(
        <BrandSelectionSheet ref={ref} singleSelect selectedBrand={null} onSelectNoBrand={onSelectNoBrand} onSelectSingle={onSelectSingle} />,
      );
      act(() => ref.current?.show());
      await waitFor(() => expect(view.queryByText('Chargement des marques...')).toBeNull());
      expect(view.getByRole('button', { name: 'Sans marque', selected: true })).toBeTruthy();
      mockGetDocs.mockResolvedValueOnce(catalogue(['Zara']) as unknown as Awaited<ReturnType<typeof getDocs>>);
      fireEvent.changeText(view.getByPlaceholderText('Rechercher une marque...'), 'Za');
      await act(async () => { jest.advanceTimersByTime(300); });
      expect(view.queryByText('Uniqlo')).toBeNull();
      fireEvent.press(view.getByText('Zara'));
      expect(onSelectSingle).toHaveBeenCalledWith('Zara');
      expect(onSelectNoBrand).not.toHaveBeenCalled();
      expect(view.queryByText('Marques')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('préserve la sélection multiple et réserve Sans marque au single-select opt-in', async () => {
    const ref = createRef<BrandSelectionSheetRef>();
    const onConfirm = jest.fn();
    const onSelectNoBrand = jest.fn();
    const view = render(
      <BrandSelectionSheet ref={ref} selectedBrands={['Zara']} onConfirm={onConfirm} onSelectNoBrand={onSelectNoBrand} />,
    );
    act(() => ref.current?.show());
    await waitFor(() => expect(view.queryByText('Chargement des marques...')).toBeNull());
    expect(view.queryByTestId('brand-none-option')).toBeNull();
    expect(view.getByText('Tout effacer')).toBeTruthy();
    fireEvent.press(view.getByText('Uniqlo'));
    fireEvent.press(view.getByText('VALIDER (2)'));
    expect(onConfirm).toHaveBeenCalledWith(['Zara', 'Uniqlo']);
    expect(onSelectNoBrand).not.toHaveBeenCalled();
  });
});
