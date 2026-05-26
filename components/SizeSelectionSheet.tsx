/**
 * SizeSelectionSheet — Seconde (Editorial Design)
 *
 * Bottom sheet for size selection matching the onboarding UX exactly.
 * 3 sections: TAILLE DU HAUT, TAILLE DU BAS, POINTURE
 * US/EU system toggle. Adult/Kids demographic toggle.
 * Multi-select with confirm button.
 *
 * Design system: Cormorant Garamond (serif) + Satoshi (sans)
 * Sharp corners on chips. Charcoal selected state.
 */

import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, TouchableOpacity } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, fonts, spacing } from '@/constants/theme';
import {
  getSizes,
  getSizesForCategory,
  SIZE_SECTIONS,
  SIZE_SECTION_LABELS,
  SizeSystem,
  SizeDemographic,
  SizeSection,
} from '@/data/sizes';

export interface SizeSelectionSheetRef {
  show: () => void;
  hide: () => void;
}

interface SizeSelectionSheetProps {
  selectedSizes: string[];
  onConfirm: (sizes: string[]) => void;
  /** When provided, restricts available sizes to this category */
  categoryPath?: string[];
}

const SIZE_SYSTEM_OPTIONS: { id: SizeSystem; label: string }[] = [
  { id: 'US', label: 'US' },
  { id: 'EU', label: 'EU' },
];

const DEMOGRAPHIC_OPTIONS: { id: SizeDemographic; label: string }[] = [
  { id: 'adult', label: 'Adulte' },
  { id: 'kids', label: 'Enfant' },
];

const SizeSelectionSheet = forwardRef<SizeSelectionSheetRef, SizeSelectionSheetProps>(
  ({ selectedSizes, onConfirm, categoryPath }, ref) => {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['85%'], []);
    const bottomSheetRef = React.useRef<BottomSheet>(null);
    const [localSelectedSizes, setLocalSelectedSizes] = React.useState<string[]>(selectedSizes);
    const [sizeSystem, setSizeSystem] = React.useState<SizeSystem>('EU');
    const [demographic, setDemographic] = React.useState<SizeDemographic>('adult');

    useImperativeHandle(ref, () => ({
      show: () => {
        setLocalSelectedSizes(selectedSizes);
        bottomSheetRef.current?.expand();
      },
      hide: () => bottomSheetRef.current?.close(),
    }));

    const handleSizeToggle = useCallback((size: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setLocalSelectedSizes(prev => {
        if (prev.includes(size)) {
          return prev.filter(s => s !== size);
        }
        return [...prev, size];
      });
    }, []);

    const handleSystemChange = useCallback((newSystem: SizeSystem) => {
      if (newSystem !== sizeSystem) {
        setSizeSystem(newSystem);
        setLocalSelectedSizes([]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }, [sizeSystem]);

    const handleDemographicChange = useCallback((newDemographic: SizeDemographic) => {
      if (newDemographic !== demographic) {
        setDemographic(newDemographic);
        setLocalSelectedSizes([]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }, [demographic]);

    const handleConfirm = useCallback(() => {
      onConfirm(localSelectedSizes);
      bottomSheetRef.current?.close();
    }, [onConfirm, localSelectedSizes]);

    const handleClear = useCallback(() => {
      setLocalSelectedSizes([]);
    }, []);

    const renderBackdrop = useCallback(
      (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
      []
    );

    const renderSizeSection = useCallback((section: SizeSection) => {
      const sizes = getSizes(section, sizeSystem, demographic);
      const label = SIZE_SECTION_LABELS[section];

      return (
        <View key={section} style={styles.section}>
          <Text style={styles.sectionLabel}>{label}</Text>
          <View style={styles.sizeGrid}>
            {sizes.map((size) => {
              const isSelected = localSelectedSizes.includes(size);
              return (
                <Pressable
                  key={size}
                  style={[
                    styles.sizeChip,
                    isSelected && styles.sizeChipSelected,
                  ]}
                  onPress={() => handleSizeToggle(size)}
                >
                  <Text style={[
                    styles.sizeChipText,
                    isSelected && styles.sizeChipTextSelected,
                  ]}>
                    {size}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }, [sizeSystem, demographic, localSelectedSizes, handleSizeToggle]);

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        topInset={insets.top}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        enableDynamicSizing={false}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Taille</Text>
            {localSelectedSizes.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{localSelectedSizes.length}</Text>
              </View>
            )}
          </View>
          <View style={styles.headerRight}>
            {localSelectedSizes.length > 0 && (
              <TouchableOpacity
                onPress={handleClear}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.clearButton}
              >
                <Text style={styles.clearButtonText}>Effacer</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => bottomSheetRef.current?.close()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={22} color={colors.charcoal} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Divider ── */}
        <View style={styles.divider} />

        {/* ── Content ── */}
        <BottomSheetScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 80 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Demographic toggle (Adulte / Enfant) ── */}
          <View style={styles.toggleSection}>
            <Text style={styles.toggleLabel}>JE CHERCHE POUR</Text>
            <View style={styles.toggleRow}>
              {DEMOGRAPHIC_OPTIONS.map(opt => (
                <Pressable
                  key={opt.id}
                  style={[
                    styles.toggleOption,
                    demographic === opt.id && styles.toggleOptionSelected,
                  ]}
                  onPress={() => handleDemographicChange(opt.id)}
                >
                  <Text style={[
                    styles.toggleText,
                    demographic === opt.id && styles.toggleTextSelected,
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ── Size system toggle (US / EU) ── */}
          <View style={styles.toggleSection}>
            <Text style={styles.toggleLabel}>SYSTEME DE TAILLE</Text>
            <View style={styles.toggleRow}>
              {SIZE_SYSTEM_OPTIONS.map(opt => (
                <Pressable
                  key={opt.id}
                  style={[
                    styles.toggleOption,
                    sizeSystem === opt.id && styles.toggleOptionSelected,
                  ]}
                  onPress={() => handleSystemChange(opt.id)}
                >
                  <Text style={[
                    styles.toggleText,
                    sizeSystem === opt.id && styles.toggleTextSelected,
                  ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ── Size sections ── */}
          {categoryPath && categoryPath.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>TAILLES DISPONIBLES</Text>
              <View style={styles.sizeGrid}>
                {getSizesForCategory(categoryPath).map((size) => {
                  const isSelected = localSelectedSizes.includes(size);
                  return (
                    <Pressable
                      key={size}
                      style={[
                        styles.sizeChip,
                        isSelected && styles.sizeChipSelected,
                      ]}
                      onPress={() => handleSizeToggle(size)}
                    >
                      <Text style={[
                        styles.sizeChipText,
                        isSelected && styles.sizeChipTextSelected,
                      ]}>
                        {size}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            SIZE_SECTIONS.map(renderSizeSection)
          )}
        </BottomSheetScrollView>

        {/* ── Confirm button ── */}
        <View style={[styles.confirmContainer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[
              styles.confirmButton,
              localSelectedSizes.length === 0 && styles.confirmButtonDisabled,
            ]}
            onPress={handleConfirm}
          >
            <Text style={styles.confirmButtonText}>
              {localSelectedSizes.length > 0
                ? `VALIDER (${localSelectedSizes.length})`
                : 'VALIDER'}
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    );
  }
);

// ─────────────────────────────────────────────────────────────────────
// STYLES — Editorial Design (matches onboarding)
// ─────────────────────────────────────────────────────────────────────

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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    borderRadius: 0,
  },
  countBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },
  clearButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.muted,
    textDecorationLine: 'underline',
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
    paddingTop: 20,
  },

  // ── Toggle sections ──
  toggleSection: {
    marginBottom: 24,
  },
  toggleLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 10,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleOption: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  toggleOptionSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  toggleText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.charcoal,
  },
  toggleTextSelected: {
    color: colors.white,
  },

  // ── Size sections ──
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 12,
  },
  sizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sizeChip: {
    minWidth: 48,
    height: 42,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  sizeChipSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sizeChipText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  sizeChipTextSelected: {
    color: colors.white,
  },

  // ── Confirm button ──
  confirmContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmButton: {
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: 0,
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

export default SizeSelectionSheet;
