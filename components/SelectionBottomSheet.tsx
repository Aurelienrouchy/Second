import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, TouchableOpacity } from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react';
import {
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface SelectionItem {
  value: string;
  label: string;
  color?: string;
}

interface SelectionBottomSheetProps {
  title: string;
  items: SelectionItem[];
  selectedValue?: string | null;
  selectedValues?: string[];
  onSelect: (value: string) => void;
  onSelectMultiple?: (values: string[]) => void;
  type?: 'default' | 'color' | 'size';
  multiSelect?: boolean;
  maxSelections?: number;
}

export interface SelectionBottomSheetRef {
  show: () => void;
  hide: () => void;
}

const SelectionBottomSheet = forwardRef<SelectionBottomSheetRef, SelectionBottomSheetProps>(
  ({ title, items, selectedValue, selectedValues = [], onSelect, onSelectMultiple, type = 'default', multiSelect = false, maxSelections }, ref) => {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['85%'], []);
    const bottomSheetRef = React.useRef<BottomSheet>(null);
    const [localSelectedValues, setLocalSelectedValues] = React.useState<string[]>(selectedValues);

    // Note: We intentionally don't sync localSelectedValues with selectedValues on every change
    // to avoid infinite loops. Instead, we sync only when the sheet opens via show().

    useImperativeHandle(ref, () => ({
      show: () => {
        setLocalSelectedValues(selectedValues);
        bottomSheetRef.current?.expand();
      },
      hide: () => bottomSheetRef.current?.close(),
    }));

    const handleSelect = useCallback((value: string) => {
      if (multiSelect) {
        setLocalSelectedValues(prev => {
          const isSelected = prev.includes(value);
          if (isSelected) {
            return prev.filter(v => v !== value);
          } else {
            if (maxSelections && prev.length >= maxSelections) {
              return prev; // Don't add more if at max
            }
            return [...prev, value];
          }
        });
      } else {
        onSelect(value);
        bottomSheetRef.current?.close();
      }
    }, [multiSelect, onSelect, maxSelections]);

    const handleConfirm = useCallback(() => {
      if (multiSelect && onSelectMultiple) {
        onSelectMultiple(localSelectedValues);
      }
      bottomSheetRef.current?.close();
    }, [multiSelect, onSelectMultiple, localSelectedValues]);

    const isSelected = useCallback((value: string) => {
      if (multiSelect) {
        return localSelectedValues.includes(value);
      }
      return selectedValue === value;
    }, [multiSelect, localSelectedValues, selectedValue]);

    const renderBackdrop = useCallback(
      (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
      []
    );

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        topInset={insets.top}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity
            onPress={() => bottomSheetRef.current?.close()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.closeButtonX}>✕</Text>
          </TouchableOpacity>
        </View>

        <BottomSheetScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: multiSelect ? insets.bottom + 80 : insets.bottom + 20 }
          ]}
          showsVerticalScrollIndicator={false}
        >
          {type === 'size' ? (
            <View style={styles.sizeGrid}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.sizeItem,
                    isSelected(item.value) && styles.selectedSizeItem
                  ]}
                  onPress={() => handleSelect(item.value)}
                >
                  <Text style={[
                    styles.sizeText,
                    isSelected(item.value) && styles.selectedSizeText
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : type === 'color' ? (
            <View style={styles.colorList}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.colorOption,
                    isSelected(item.value) && styles.selectedOption
                  ]}
                  onPress={() => handleSelect(item.value)}
                >
                  <View style={styles.colorRow}>
                    <View style={[
                      styles.colorCircle,
                      { backgroundColor: item.color || '#F0F0F0' },
                      item.label === 'Blanc' && styles.whiteColorCircle
                    ]} />
                    <Text style={[
                      styles.optionText,
                      isSelected(item.value) && styles.selectedOptionText
                    ]}>
                      {item.label}
                    </Text>
                  </View>
                  {isSelected(item.value) && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.defaultList}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.option,
                    isSelected(item.value) && styles.selectedOption
                  ]}
                  onPress={() => handleSelect(item.value)}
                >
                  <Text style={[
                    styles.optionText,
                    isSelected(item.value) && styles.selectedOptionText
                  ]}>
                    {item.label}
                  </Text>
                  {isSelected(item.value) && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </BottomSheetScrollView>

        {/* Confirm button for multi-select */}
        {multiSelect && (
          <View style={[styles.confirmButtonContainer, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleConfirm}
            >
              <Text style={styles.confirmButtonText}>
                Confirmer {localSelectedValues.length > 0 ? `(${localSelectedValues.length})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: '#DDDDDD',
    width: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  closeButtonX: {
    fontSize: 20,
    color: '#666',
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  // Styles par défaut
  defaultList: {
    flex: 1,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#F8F8F8',
  },
  selectedOption: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#F79F24',
  },
  optionText: {
    fontSize: 16,
    color: '#333',
  },
  selectedOptionText: {
    color: '#F79F24',
    fontWeight: '600',
  },
  checkmark: {
    fontSize: 18,
    color: '#F79F24',
    fontWeight: 'bold',
  },
  // Styles pour les couleurs
  colorList: {
    flex: 1,
  },
  colorOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: '#F8F8F8',
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  colorCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  whiteColorCircle: {
    borderColor: '#ddd',
  },
  // Styles pour les tailles
  sizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  sizeItem: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#F8F8F8',
    minWidth: 64,
    alignItems: 'center',
  },
  selectedSizeItem: {
    backgroundColor: '#F79F24',
    borderColor: '#F79F24',
  },
  sizeText: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  selectedSizeText: {
    color: '#fff',
  },
  // Multi-select confirm button
  confirmButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  confirmButton: {
    backgroundColor: '#F79F24',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default SelectionBottomSheet;
