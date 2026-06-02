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

import BottomSheet, { BottomSheetBackdrop, BottomSheetFooter, BottomSheetScrollView, TouchableOpacity } from '@gorhom/bottom-sheet';
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
import { colors, fonts } from '@/constants/theme';
import {
  getSizes,
  getSizesForCategory,
  SIZE_SECTIONS,
  SIZE_SECTION_LABELS,
  SizeSystem,
  SizeDemographic,
  SizeSection,
} from '@/data/sizes';
import type { ArticleSize } from '@/types';

export interface SizeSelectionSheetRef {
  show: () => void;
  hide: () => void;
}

interface SizeSelectionSheetProps {
  selectedSizes: ArticleSize[];
  onConfirm: (sizes: ArticleSize[]) => void;
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

/** Buckets incoming sizes into per-system value lists (US / EU). */
const groupBySystem = (sizes: ArticleSize[]): Record<SizeSystem, string[]> => {
  const grouped: Record<SizeSystem, string[]> = { US: [], EU: [] };
  for (const s of sizes) {
    grouped[s.system].push(s.value);
  }
  return grouped;
};

const SizeSelectionSheet = forwardRef<SizeSelectionSheetRef, SizeSelectionSheetProps>(
  ({ selectedSizes, onConfirm, categoryPath }, ref) => {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['85%'], []);
    const bottomSheetRef = React.useRef<BottomSheet>(null);
    // Selections are tracked per system so switching US/EU never wipes the
    // other system — each value is wrapped into { value, system } at confirm.
    const [selectionsBySystem, setSelectionsBySystem] = React.useState<Record<SizeSystem, string[]>>(
      () => groupBySystem(selectedSizes)
    );
    const [sizeSystem, setSizeSystem] = React.useState<SizeSystem>(
      selectedSizes[0]?.system ?? 'EU'
    );
    const [demographic, setDemographic] = React.useState<SizeDemographic>('adult');
    // Mount-on-open: the sheet is only rendered while open, so its backdrop can
    // never leak a residual veil when closed (gorhom #701 on New Architecture).
    const [mounted, setMounted] = React.useState(false);

    // Selection scoped to the active system, used for rendering the grid.
    const localSelectedSizes = selectionsBySystem[sizeSystem];
    // Total across both systems — drives the confirm/header counters.
    const totalSelectedCount = selectionsBySystem.US.length + selectionsBySystem.EU.length;

    useImperativeHandle(ref, () => ({
      show: () => {
        // Restore every system's selection so switching tabs keeps both sets.
        setSelectionsBySystem(groupBySystem(selectedSizes));
        // Focus the system carrying existing selections, falling back to current.
        setSizeSystem(selectedSizes[0]?.system ?? sizeSystem);
        setMounted(true);
      },
      hide: () => bottomSheetRef.current?.close(),
    }));

    const handleSizeToggle = useCallback((size: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectionsBySystem(prev => {
        const current = prev[sizeSystem];
        const next = current.includes(size)
          ? current.filter(s => s !== size)
          : [...current, size];
        return { ...prev, [sizeSystem]: next };
      });
    }, [sizeSystem]);

    const handleSystemChange = useCallback((newSystem: SizeSystem) => {
      if (newSystem !== sizeSystem) {
        // Only switch the active system — the other system's selection is kept.
        setSizeSystem(newSystem);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }, [sizeSystem]);

    const handleDemographicChange = useCallback((newDemographic: SizeDemographic) => {
      if (newDemographic !== demographic) {
        setDemographic(newDemographic);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }, [demographic]);

    const handleConfirm = useCallback(() => {
      // Merge both systems into a single ArticleSize[] carrying each system.
      const merged: ArticleSize[] = [
        ...selectionsBySystem.US.map((value) => ({ value, system: 'US' as const })),
        ...selectionsBySystem.EU.map((value) => ({ value, system: 'EU' as const })),
      ];
      onConfirm(merged);
      bottomSheetRef.current?.close();
    }, [onConfirm, selectionsBySystem]);

    const handleClear = useCallback(() => {
      setSelectionsBySystem({ US: [], EU: [] });
    }, []);

    const renderBackdrop = useCallback(
      (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
      []
    );

    const renderFooter = useCallback(
      (props: any) => (
        <BottomSheetFooter {...props}>
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
        </BottomSheetFooter>
      ),
      [insets.bottom, localSelectedSizes, handleConfirm]
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

    if (!mounted) return null;

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        footerComponent={renderFooter}
        enablePanDownToClose
        onClose={() => setMounted(false)}
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
            { paddingBottom: 80 + insets.bottom },
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
