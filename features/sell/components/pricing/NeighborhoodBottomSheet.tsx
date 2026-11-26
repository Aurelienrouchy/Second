/**
 * NeighborhoodBottomSheet — choix des quartiers de remise en main propre.
 *
 * Pleine page (un seul cran, contenu dans les zones sûres) : le catalogue couvre
 * tous les arrondissements, une demi-feuille n'en montrait que trois lignes.
 *
 * La sélection est tamponnée dans la feuille et n'est appliquée qu'au bouton
 * VALIDER ; fermer sans valider abandonne les changements.
 */

import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetSectionList,
  BottomSheetTextInput,
  useBottomSheetTimingConfigs,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Easing } from 'react-native-reanimated';

import { NEIGHBORHOODS_BY_BOROUGH, searchNeighborhoods } from '@/data/neighborhoods';
import { toggleNeighborhood } from '@/features/sell/utils/neighborhoods';
import { MeetupNeighborhood } from '@/types';
import { animations, colors, fonts, radius, sizing, spacing } from '@/constants/theme';

const SHEET_EASING = Easing.out(Easing.cubic);

interface NeighborhoodBottomSheetProps {
  selectedNeighborhoods: MeetupNeighborhood[];
  /** Appelé au bouton VALIDER avec la sélection complète. */
  onConfirm: (neighborhoods: MeetupNeighborhood[]) => void;
  /** Ouverture/fermeture — l'écran hôte s'en sert pour neutraliser son KeyboardAvoidingView. */
  onVisibilityChange?: (visible: boolean) => void;
}

export interface NeighborhoodBottomSheetRef {
  show: () => void;
  hide: () => void;
}

interface SectionData {
  title: string;
  data: MeetupNeighborhood[];
}

const NeighborhoodBottomSheet = forwardRef<NeighborhoodBottomSheetRef, NeighborhoodBottomSheetProps>(
  ({ selectedNeighborhoods, onConfirm, onVisibilityChange }, ref) => {
    const snapPoints = useMemo(() => ['100%'], []);
    const bottomSheetRef = React.useRef<BottomSheet>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [draftSelection, setDraftSelection] = useState<MeetupNeighborhood[]>(selectedNeighborhoods);
    // Premeasure offscreen. The closed host hides touches/accessibility, and
    // unmounts the backdrop itself to prevent the residual veil from #701.
    const [{ phase, epoch }, setPresentation] = useState<{phase: 'closed' | 'open' | 'closing'; epoch: number}>({phase: 'closed', epoch: 0});
    const latestEpoch = React.useRef(0);
    const wantsOpen = React.useRef(false);
    const presentationStarted = React.useRef(false);
    const visible = phase !== 'closed';
    const animationConfigs = useBottomSheetTimingConfigs({ duration: animations.duration.normal, easing: SHEET_EASING });

    const closeSheet = useCallback(() => {
      wantsOpen.current = false;
      Keyboard.dismiss();
      bottomSheetRef.current?.close();
      if (!presentationStarted.current) {
        setPresentation({phase: 'closed', epoch: latestEpoch.current});
        onVisibilityChange?.(false);
      } else setPresentation({phase: 'closing', epoch: latestEpoch.current});
    }, [onVisibilityChange]);

    useImperativeHandle(ref, () => ({
      show: () => {
        setSearchQuery('');
        setDraftSelection(selectedNeighborhoods);
        wantsOpen.current = true;
        setPresentation({phase: 'open', epoch: ++latestEpoch.current});
        onVisibilityChange?.(true);
      },
      hide: closeSheet,
    }));

    const handleClosed = useCallback(() => {
      if (epoch !== latestEpoch.current) return;
      // A close completion queued before a newer show must not dismiss it.
      if (wantsOpen.current) {
        bottomSheetRef.current?.snapToIndex(0);
        return;
      }
      Keyboard.dismiss();
      presentationStarted.current = false;
      setPresentation({phase: 'closed', epoch});
      onVisibilityChange?.(false);
    }, [epoch, onVisibilityChange]);

    const handleAnimate = useCallback((_fromIndex: number, toIndex: number) => {
      if (epoch !== latestEpoch.current) return;
      if (toIndex !== -1) {
        if (!wantsOpen.current) { bottomSheetRef.current?.close(); return; }
        presentationStarted.current = true;
        return;
      }
      wantsOpen.current = false;
      setPresentation(previous => previous.phase === 'closed' ? previous : {phase: 'closing', epoch});
    }, [epoch]);

    const handleToggle = useCallback((neighborhood: MeetupNeighborhood) => {
      const { next, capped } = toggleNeighborhood(draftSelection, neighborhood);
      if (capped) {
        Alert.alert('10 quartiers maximum', 'Retire un quartier pour en choisir un autre.');
        return;
      }
      setDraftSelection(next);
    }, [draftSelection]);

    const handleConfirm = useCallback(() => {
      if (!wantsOpen.current || phase !== 'open' || epoch !== latestEpoch.current) return;
      closeSheet();
      onConfirm(draftSelection);
    }, [phase, epoch, onConfirm, draftSelection, closeSheet]);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ),
      []
    );

    // Build sections from neighborhoods grouped by borough
    const sections = useMemo((): SectionData[] => {
      if (searchQuery.trim()) {
        const results = searchNeighborhoods(searchQuery);
        if (results.length === 0) return [];
        return [{
          title: 'Résultats de recherche',
          data: results,
        }];
      }

      return Object.entries(NEIGHBORHOODS_BY_BOROUGH).map(([borough, neighborhoods]) => ({
        title: borough,
        data: neighborhoods,
      }));
    }, [searchQuery]);

    const renderSectionHeader = useCallback(({ section }: { section: SectionData }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
      </View>
    ), []);

    const renderItem = useCallback(({ item }: { item: MeetupNeighborhood }) => {
      const isSelected = draftSelection.some((n) => n.id === item.id);

      return (
        <Pressable
          style={[styles.neighborhoodItem, isSelected && styles.selectedItem]}
          onPress={() => handleToggle(item)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
        >
          <View style={styles.itemContent}>
            <Text style={[styles.neighborhoodName, isSelected && styles.selectedText]}>
              {item.name}
            </Text>
            <Text style={styles.neighborhoodBorough}>{item.borough}</Text>
          </View>
          {isSelected && (
            <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
          )}
        </Pressable>
      );
    }, [draftSelection, handleToggle]);

    return (
      <View style={styles.host} pointerEvents={visible ? 'box-none' : 'none'}
        accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
        <BottomSheet
          ref={bottomSheetRef}
          index={phase === 'open' ? 0 : -1}
          animateOnMount={false}
          snapPoints={snapPoints}
          animationConfigs={animationConfigs}
          backdropComponent={visible ? renderBackdrop : undefined}
          handleComponent={null}
          enablePanDownToClose
          onAnimate={handleAnimate}
          onClose={handleClosed}
          topInset={0}
          keyboardBlurBehavior="restore"
          android_keyboardInputMode="adjustResize"
          enableDynamicSizing={false}
          backgroundStyle={styles.sheetBackground}
        >
          <SafeAreaView edges={['top']} style={styles.container}>
            <View style={styles.header}>
              <View style={styles.searchContainer}>
                <Ionicons name="search" size={20} color={colors.muted} />
                <BottomSheetTextInput
                  style={styles.searchInput}
                  placeholder="Rechercher un quartier..."
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholderTextColor={colors.muted}
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <Pressable onPress={() => setSearchQuery('')}>
                    <Ionicons name="close-circle" size={20} color={colors.muted} />
                  </Pressable>
                )}
              </View>
              <Pressable style={styles.closeButton} onPress={closeSheet}
                accessibilityRole="button" accessibilityLabel="Fermer">
                <Ionicons name="close" size={sizing.iconMD} color={colors.charcoal} />
              </Pressable>
            </View>

            {sections.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="search-outline" size={48} color={colors.border} />
                <Text style={styles.emptyText}>Aucun quartier trouvé</Text>
              </View>
            ) : (
              <BottomSheetSectionList
                style={styles.list}
                sections={sections}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                renderSectionHeader={renderSectionHeader}
                stickySectionHeadersEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
              />
            )}
            <SafeAreaView edges={['bottom']} style={styles.footer}>
              <Pressable
                testID="neighborhood-sheet-confirm"
                style={({ pressed }) => [styles.confirmButton, pressed && { opacity: 0.7 }]}
                onPress={handleConfirm}
                accessibilityRole="button"
              >
                <Text style={styles.confirmButtonText}>
                  {draftSelection.length > 0
                    ? `VALIDER (${draftSelection.length})`
                    : 'VALIDER'}
                </Text>
              </Pressable>
            </SafeAreaView>
          </SafeAreaView>
        </BottomSheet>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  sheetBackground: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.none,
  },
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  closeButton: {
    minWidth: sizing.minTouchTarget,
    minHeight: sizing.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: sizing.minTouchTarget,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.foreground,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  sectionHeader: {
    backgroundColor: colors.surfaceWarm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  neighborhoodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.surfaceWarm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  selectedItem: {
    backgroundColor: colors.primaryLight,
  },
  itemContent: {
    flex: 1,
  },
  neighborhoodName: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.foreground,
    marginBottom: 2,
  },
  neighborhoodBorough: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  selectedText: {
    color: colors.primary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing['4xl'],
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.muted,
    marginTop: spacing.sm + 4,
  },
  footer: {
    backgroundColor: colors.surfaceWarm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  confirmButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.16,
    color: colors.cream,
  },
});

NeighborhoodBottomSheet.displayName = 'NeighborhoodBottomSheet';

export default NeighborhoodBottomSheet;
