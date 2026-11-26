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

import BottomSheet, { BottomSheetBackdrop, BottomSheetFooter, BottomSheetScrollView, TouchableOpacity } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, typography, components, spacing } from '@/constants/theme';
import type { SizeSystem } from '@/types/article';

const SIZE_SYSTEMS: SizeSystem[] = ['EU', 'US'];

export interface SelectionItem {
  value: string;
  label: string;
  color?: string;
}

interface SelectionBottomSheetProps {
  /** Opt-in visual identity; other consumers keep their existing presentation. */
  appearance?: 'default' | 'troc';
  title: string;
  items: SelectionItem[];
  selectedValue?: string | null;
  selectedValues?: string[];
  onSelect: (value: string) => void;
  onSelectMultiple?: (values: string[]) => void;
  type?: 'default' | 'color' | 'size';
  multiSelect?: boolean;
  maxSelections?: number;
  /** Opt-in system switch for a controlled, single-select size grid. */
  sizeSystem?: SizeSystem;
  /** The parent updates the grid and clears the previously selected size. */
  onSizeSystemChange?: (system: SizeSystem) => void;
}

export interface SelectionBottomSheetRef {
  show: () => void;
  hide: () => void;
}

const SelectionBottomSheet = forwardRef<SelectionBottomSheetRef, SelectionBottomSheetProps>(
  ({ title, items, selectedValue, selectedValues = [], onSelect, onSelectMultiple, type = 'default', multiSelect = false, maxSelections, appearance = 'default', sizeSystem, onSizeSystemChange }, ref) => {
    const insets = useSafeAreaInsets();
    const isTroc = appearance === 'troc';
    const snapPoints = useMemo(() => ['85%'], []);
    const bottomSheetRef = React.useRef<BottomSheet>(null);
    const [localSelectedValues, setLocalSelectedValues] = React.useState<string[]>(selectedValues);
    // Mount-on-open: the sheet is only rendered while open, so its backdrop can
    // never leak a residual veil when closed (gorhom #701 on New Architecture).
    const [mounted, setMounted] = React.useState(false);

    useImperativeHandle(ref, () => ({
      show: () => {
        setLocalSelectedValues(selectedValues);
        setMounted(true);
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

    const renderBackdrop = useCallback(
      (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
      []
    );

    const renderFooter = useCallback(
      (props: any) => {
        if (!multiSelect) return null;
        return (
          <BottomSheetFooter {...props}>
            <View style={[styles.confirmContainer, isTroc && styles.trocSurface, { paddingBottom: insets.bottom + 16 }]}>
              <TouchableOpacity
                testID="selection-confirm-button"
                accessibilityRole={isTroc ? 'button' : undefined}
                accessibilityLabel={isTroc ? 'Valider la sélection' : undefined}
                style={[
                  styles.confirmButton,
                  isTroc && styles.trocConfirmButton,
                  localSelectedValues.length === 0 && styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirm}
              >
                <Text style={styles.confirmButtonText}>
                  {localSelectedValues.length > 0
                    ? `VALIDER (${localSelectedValues.length})`
                    : 'VALIDER'}
                </Text>
              </TouchableOpacity>
            </View>
          </BottomSheetFooter>
        );
      },
      [multiSelect, insets.bottom, localSelectedValues, handleConfirm, isTroc]
    );

    if (!mounted) return null;

    return (
      <BottomSheet
        accessible={false}
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        footerComponent={renderFooter}
        enablePanDownToClose
        onClose={() => setMounted(false)}
        topInset={insets.top}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={[styles.sheetBackground, isTroc && styles.trocSurface]}
        enableDynamicSizing={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.title, isTroc && styles.trocTitle]}>{title}</Text>
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
            accessibilityRole={isTroc ? 'button' : undefined}
            accessibilityLabel={isTroc ? 'Fermer' : undefined}
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
          {type === 'size' && !multiSelect && sizeSystem && onSizeSystemChange && (
            <View style={styles.sizeSystemControls} accessibilityRole="radiogroup">
              {SIZE_SYSTEMS.map((system) => (
                <TouchableOpacity
                  key={system}
                  testID={`selection-size-system-${system}`}
                  accessibilityRole="radio"
                  accessibilityLabel={`Tailles ${system}`}
                  accessibilityState={{ checked: sizeSystem === system }}
                  style={[styles.sizeItem, sizeSystem === system && styles.sizeItemSelected]}
                  onPress={() => {
                    if (system !== sizeSystem) onSizeSystemChange(system);
                  }}
                >
                  <Text style={[styles.sizeText, sizeSystem === system && styles.sizeTextSelected]}>
                    {system}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {type === 'size' ? (
            // ── Size grid ──
            <View style={styles.sizeGrid}>
              {items.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  testID={`selection-item-${item.value}`}
                  accessibilityRole={isTroc ? multiSelect ? 'checkbox' : 'button' : undefined}
                  accessibilityLabel={isTroc ? item.label : undefined}
                  accessibilityState={isTroc ? multiSelect ? {checked: isSelected(item.value)} : {selected: isSelected(item.value)} : undefined}
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
                  testID={`selection-item-${item.value}`}
                  accessibilityRole={isTroc ? multiSelect ? 'checkbox' : 'button' : undefined}
                  accessibilityLabel={isTroc ? item.label : undefined}
                  accessibilityState={isTroc ? multiSelect ? {checked: isSelected(item.value)} : {selected: isSelected(item.value)} : undefined}
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
                  testID={`selection-item-${item.value}`}
                  accessibilityRole={isTroc ? multiSelect ? 'checkbox' : 'button' : undefined}
                  accessibilityLabel={isTroc ? item.label : undefined}
                  accessibilityState={isTroc ? multiSelect ? {checked: isSelected(item.value)} : {selected: isSelected(item.value)} : undefined}
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
  trocSurface: { backgroundColor: colors.background },
  trocTitle: { ...typography.trocScreenTitle, color: colors.foreground },
  trocConfirmButton: { backgroundColor: colors.primaryDark, borderRadius: components.troc.cardRadius },
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
  sizeSystemControls: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
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

SelectionBottomSheet.displayName = 'SelectionBottomSheet';

export default SelectionBottomSheet;
