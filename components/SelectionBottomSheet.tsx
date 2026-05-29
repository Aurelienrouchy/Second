/**
 * SelectionBottomSheet — Seconde (Editorial Design)
 *
 * Unified bottom sheet for single/multi-select filters.
 * Supports: default list, color swatches, size grid.
 *
 * Design system: Cormorant Garamond (serif) + Satoshi (sans)
 * Sharp corners on chips/items. Charcoal selected state.
 * Rust accent on confirm button.
 */

import BottomSheet, { BottomSheetScrollView, BottomSheetView } from '@expo/ui/community/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, spacing, typography } from '@/constants/theme';

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
              return prev;
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

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        backgroundStyle={styles.sheetBackground}
        enableDynamicSizing={false}
      >
        <BottomSheetView style={styles.flex}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>{title}</Text>
            {multiSelect && localSelectedValues.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{localSelectedValues.length}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={() => bottomSheetRef.current?.close()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={22} color={colors.charcoal} />
          </TouchableOpacity>
        </View>

        {/* ── Divider ── */}
        <View style={styles.divider} />

        {/* ── Content ── */}
        <BottomSheetScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: multiSelect ? (80 + insets.bottom) : insets.bottom + 20 }
          ]}
          showsVerticalScrollIndicator={false}
        >
          {type === 'size' ? (
            // ── Size grid ──
            <View style={styles.sizeGrid}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.sizeItem,
                    isSelected(item.value) && styles.sizeItemSelected
                  ]}
                  onPress={() => handleSelect(item.value)}
                >
                  <Text style={[
                    styles.sizeText,
                    isSelected(item.value) && styles.sizeTextSelected
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : type === 'color' ? (
            // ── Color list ──
            <View style={styles.list}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.colorOption,
                    isSelected(item.value) && styles.optionSelected
                  ]}
                  onPress={() => handleSelect(item.value)}
                >
                  <View style={styles.colorRow}>
                    <View style={[
                      styles.colorSwatch,
                      { backgroundColor: item.color || '#F0F0F0' },
                      item.label === 'Blanc' && styles.colorSwatchWhite,
                    ]} />
                    <Text style={[
                      styles.optionLabel,
                      isSelected(item.value) && styles.optionLabelSelected,
                    ]}>
                      {item.label}
                    </Text>
                  </View>
                  {isSelected(item.value) && (
                    <Ionicons name="checkmark" size={18} color={colors.charcoal} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            // ── Default list ──
            <View style={styles.list}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.option,
                    isSelected(item.value) && styles.optionSelected
                  ]}
                  onPress={() => handleSelect(item.value)}
                >
                  <Text style={[
                    styles.optionLabel,
                    isSelected(item.value) && styles.optionLabelSelected,
                  ]}>
                    {item.label}
                  </Text>
                  {isSelected(item.value) && (
                    <Ionicons name="checkmark" size={18} color={colors.charcoal} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

// ─────────────────────────────────────────────────────────
// STYLES — Editorial Design
// ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
  },
  handleIndicator: {
    backgroundColor: colors.borderStrong,
    width: 40,
    height: 4,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    letterSpacing: -0.3,
    color: colors.charcoal,
  },
  countBadge: {
    backgroundColor: colors.charcoal,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 0, // Sharp
  },
  countBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },
  closeButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 20,
  },

  // ── ScrollView ──
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // ── List ──
  list: {
    flex: 1,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: 'transparent',
  },
  optionSelected: {
    backgroundColor: colors.surfaceWarm,
  },
  optionLabel: {
    fontFamily: fonts.sans,
    fontSize: 15,
    letterSpacing: 0.1,
    color: colors.charcoal,
  },
  optionLabelSelected: {
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
  },

  // ── Color options ──
  colorOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: 'transparent',
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  colorSwatch: {
    width: 24,
    height: 24,
    borderRadius: 0, // Sharp — editorial
    marginRight: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  colorSwatchWhite: {
    borderColor: colors.borderStrong,
  },

  // ── Size grid (matches onboarding chip dimensions) ──
  sizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sizeItem: {
    minWidth: 48,
    height: 42,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  sizeItemSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sizeText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  sizeTextSelected: {
    color: colors.white,
  },

  // ── Confirm button ──
  confirmContainer: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmButton: {
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: 0, // Sharp — editorial, consistent with Button component style
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: colors.borderStrong,
  },
  confirmButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.white,
  },
});

export default SelectionBottomSheet;
