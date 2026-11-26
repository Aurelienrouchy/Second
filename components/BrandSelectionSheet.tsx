/**
 * BrandSelectionSheet — Seconde (Editorial Design)
 *
 * Bottom sheet for brand selection with Firestore search.
 * Supports single and multi-select modes.
 * Allows adding custom brands.
 *
 * Design system: Cormorant Garamond (serif) + Satoshi (sans)
 * Sharp corners. Charcoal selected state.
 */

import { firestore } from '@/config/firebaseConfig';
import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetFooter, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, limit, query, where, doc, setDoc, orderBy, startAfter, QueryDocumentSnapshot } from 'firebase/firestore';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, typography, components } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { brandDisplay, brandDocId, brandKey } from '@/utils/normalizeBrand';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export function canOfferCustomBrand(
  searchQuery: string,
  brands: { value: string; label: string }[],
): boolean {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (normalizedQuery.length < 2) return false;
  // `brandDisplay` réécrit le libellé à l'ajout (levis -> Levi's) : comparer le
  // seul libellé proposait d'ajouter une marque déjà au catalogue, que les
  // règles refusent ensuite.
  const exists = brands.some(
    (b) => b.label.toLowerCase() === normalizedQuery || b.value.toLowerCase() === normalizedQuery,
  );
  return !exists;
}

/**
 * Le document existe déjà : `setDoc` est alors évalué comme un update, que les
 * règles de `brands` refusent (création seule).
 */
export function isBrandAlreadyExistsError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'permission-denied';
}

export interface BrandSelectionSheetRef {
  show: (searchQueryOverride?: string) => void;
  hide: () => void;
}

interface Brand {
  value: string;
  label: string;
}

interface BrandSelectionSheetProps {
  /** Opt-in visual identity; other consumers keep their existing presentation. */
  appearance?: 'default' | 'troc';
  selectedBrands?: string[];
  selectedBrand?: string | null;
  onConfirm?: (brands: string[]) => void;
  onSelectSingle?: (brand: string) => void;
  /** Opt-in single-select choice; the parent clears its optional brand value. */
  onSelectNoBrand?: () => void;
  initialSearchQuery?: string;
  singleSelect?: boolean;
  /** Render the sheet on the dark Swap Zone palette. Defaults to the light DS. */
  darkMode?: boolean;
}

const BrandSelectionSheet = forwardRef<BrandSelectionSheetRef, BrandSelectionSheetProps>(
  ({ selectedBrands: initialSelectedBrands = [], selectedBrand, onConfirm, onSelectSingle, onSelectNoBrand, initialSearchQuery = '', singleSelect = false, darkMode = false, appearance = 'default' }, ref) => {
    const insets = useSafeAreaInsets();
    const isTroc = appearance === 'troc' && !darkMode;
    // Dark palette overrides (Swap Zone). Light values come from the static styles.
    const textColor = darkMode ? colors.cream : colors.charcoal;
    const mutedColor = darkMode ? colors.whiteTranslucent : colors.muted;
    const bottomSheetRef = useRef<BottomSheet>(null);
    const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [filteredBrands, setFilteredBrands] = useState<Brand[]>([]);
    const [selectedBrands, setSelectedBrands] = useState<string[]>(initialSelectedBrands);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isAddingBrand, setIsAddingBrand] = useState(false);
    const [hasMoreBrands, setHasMoreBrands] = useState(true);
    // True when a search hit the Firestore limit(50) ceiling — more matches may
    // exist but aren't loaded, so we prompt the user to refine their query.
    const [searchResultsCapped, setSearchResultsCapped] = useState(false);
    const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
    const SEARCH_LIMIT = 50;
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasInitializedSearch = useRef(false);
    const PAGE_SIZE = 50;

    const sheetMaxHeight = SCREEN_HEIGHT - insets.top - 50;
    const snapPoints = useMemo(() => [sheetMaxHeight], [sheetMaxHeight]);
    const inputRef = useRef<any>(null);

    const canAddCustomBrand = useMemo(
      () => canOfferCustomBrand(searchQuery, filteredBrands),
      [searchQuery, filteredBrands],
    );

    const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);
    // Mount-on-open: the sheet is only rendered while open, so its backdrop can
    // never leak a residual veil when closed (gorhom #701 on New Architecture).
    const [mounted, setMounted] = useState(false);

    useImperativeHandle(ref, () => ({
      show: (searchQueryOverride?: string) => {
        if (singleSelect) {
          setSelectedBrands(selectedBrand ? [selectedBrand] : []);
        } else {
          setSelectedBrands(initialSelectedBrands);
        }
        const queryToUse = searchQueryOverride || initialSearchQuery;
        if (queryToUse && !hasInitializedSearch.current) {
          setSearchQuery(queryToUse);
          hasInitializedSearch.current = true;
          setPendingSearchQuery(queryToUse);
        }
        setMounted(true);
      },
      hide: () => {
        bottomSheetRef.current?.close();
      },
    }));

    useEffect(() => {
      loadBrands();
    }, []);

    useEffect(() => {
      if (pendingSearchQuery && brands.length > 0) {
        const performInitialSearch = async () => {
          try {
            const normalizedQuery = pendingSearchQuery.toLowerCase().trim();
            const q = query(
              collection(firestore, 'brands'),
              where('searchKey', '>=', normalizedQuery),
              where('searchKey', '<=', normalizedQuery + '\uf8ff'),
              limit(SEARCH_LIMIT)
            );

            const querySnapshot = await getDocs(q);
            const searchResults: Brand[] = [];

            querySnapshot.forEach((doc: any) => {
              const data = doc.data();
              if (data.label) {
                searchResults.push({
                  value: data.value || data.searchKey || data.label.toLowerCase(),
                  label: data.label,
                });
              }
            });

            searchResults.sort((a, b) => a.label.localeCompare(b.label));
            setSearchResultsCapped(querySnapshot.docs.length >= SEARCH_LIMIT);
            setFilteredBrands(searchResults.length > 0 ? searchResults : brands.filter(b =>
              b.label.toLowerCase().includes(pendingSearchQuery.toLowerCase())
            ));
          } catch (error) {
            console.error('Error performing initial search:', error);
            const filtered = brands.filter((brand) =>
              brand.label.toLowerCase().includes(pendingSearchQuery.toLowerCase())
            );
            setFilteredBrands(filtered);
          }
        };
        performInitialSearch();
        setPendingSearchQuery(null);
      }
    }, [pendingSearchQuery, brands]);

    useEffect(() => {
      if (searchQuery.trim()) {
        const filtered = brands.filter((brand) =>
          brand.label.toLowerCase().includes(searchQuery.toLowerCase())
        );
        setFilteredBrands(filtered);
      } else {
        setFilteredBrands(brands);
      }
    }, [searchQuery, brands]);

    const loadBrands = async (loadMore = false) => {
      if (loadMore && !hasMoreBrands) return;
      if (loadMore && isLoadingMore) return;

      try {
        if (loadMore) {
          setIsLoadingMore(true);
        } else {
          setIsLoading(true);
          lastDocRef.current = null;
        }

        let q;
        if (loadMore && lastDocRef.current) {
          q = query(
            collection(firestore, 'brands'),
            orderBy('label'),
            startAfter(lastDocRef.current),
            limit(PAGE_SIZE)
          );
        } else {
          q = query(
            collection(firestore, 'brands'),
            orderBy('label'),
            limit(PAGE_SIZE)
          );
        }

        const querySnapshot = await getDocs(q);

        // Track last document for pagination
        if (querySnapshot.docs.length > 0) {
          lastDocRef.current = querySnapshot.docs[querySnapshot.docs.length - 1];
        }
        setHasMoreBrands(querySnapshot.docs.length === PAGE_SIZE);

        const brandsList: Brand[] = [];
        querySnapshot.forEach((doc: any) => {
          const data = doc.data();
          if (data.label) {
            brandsList.push({
              value: data.value || data.searchKey || data.label.toLowerCase(),
              label: data.label,
            });
          }
        });

        if (loadMore) {
          setBrands(prev => [...prev, ...brandsList]);
          setFilteredBrands(prev => [...prev, ...brandsList]);
        } else {
          setBrands(brandsList);
          setFilteredBrands(brandsList);
        }
      } catch (error) {
        console.error('Error loading brands:', error);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    };

    const handleSearch = useCallback((text: string) => {
      setSearchQuery(text);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (!text.trim()) {
        setSearchResultsCapped(false);
        setFilteredBrands(brands);
        return;
      }

      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const normalizedQuery = text.toLowerCase().trim();
          const q = query(
            collection(firestore, 'brands'),
            where('searchKey', '>=', normalizedQuery),
            where('searchKey', '<=', normalizedQuery + '\uf8ff'),
            limit(SEARCH_LIMIT)
          );

          const querySnapshot = await getDocs(q);
          const searchResults: Brand[] = [];

          querySnapshot.forEach((doc: any) => {
            const data = doc.data();
            if (data.label) {
              searchResults.push({
                value: data.value || data.searchKey || data.label.toLowerCase(),
                label: data.label,
              });
            }
          });

          searchResults.sort((a, b) => a.label.localeCompare(b.label));
          setSearchResultsCapped(querySnapshot.docs.length >= SEARCH_LIMIT);
          setFilteredBrands(searchResults);
        } catch (error) {
          console.error('Error searching brands:', error);
          const filtered = brands.filter((brand) =>
            brand.label.toLowerCase().includes(text.toLowerCase())
          );
          setFilteredBrands(filtered);
        }
      }, 300);
    }, [brands]);

    useEffect(() => {
      return () => {
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
      };
    }, []);

    const addCustomBrand = useCallback(async () => {
      const brandName = searchQuery.trim();
      if (!brandName || brandName.length < 2) return;

      // searchKey / value restent en minuscules : c'est la cle de dedup.
      const searchKey = brandKey(brandName);
      // L'identifiant du document suit celui du catalogue importe (espaces ->
      // tirets) : ecrire sous la cle brute creait un doublon pour toute marque
      // en deux mots, et le matcher IA ne voyait jamais l'ajout.
      const docId = brandDocId(brandName);
      // label is normalized to a clean display form (Title Case + brand exceptions).
      const displayLabel = brandDisplay(brandName);

      const selectAddedBrand = () => {
        const newBrand: Brand = { value: searchKey, label: displayLabel };
        const merge = (prev: Brand[]) =>
          prev.some((b) => b.value === searchKey)
            ? prev
            : [...prev, newBrand].sort((a, b) => a.label.localeCompare(b.label));
        setBrands(merge);
        setFilteredBrands(merge);

        if (singleSelect) {
          if (onSelectSingle) {
            onSelectSingle(displayLabel);
          }
          setSearchQuery('');
          bottomSheetRef.current?.close();
        } else {
          setSelectedBrands(prev =>
            prev.includes(displayLabel) ? prev : [...prev, displayLabel],
          );
          setSearchQuery('');
        }
      };

      setIsAddingBrand(true);
      try {
        const brandDoc = {
          // Contrat de la recherche dans l'app.
          label: displayLabel,
          value: searchKey,
          searchKey: searchKey,
          // Contrat du rapprochement IA (functions/src/services/brands.ts) :
          // sans `name`, Fuse indexait l'identifiant du document.
          name: displayLabel,
          aliases: [],
          popularity: 0,
          isCustom: true,
          createdAt: new Date().toISOString(),
        };

        await setDoc(doc(firestore, 'brands', docId), brandDoc);

        // Signal of a taxonomy gap: a brand the referential didn't contain.
        track('custom_brand_added', {
          brand_label: displayLabel.slice(0, 50),
          source: 'search_filter',
        });

        selectAddedBrand();
      } catch (error) {
        console.error('Error adding custom brand:', error);
        if (isBrandAlreadyExistsError(error)) {
          // La marque est déjà au catalogue : on la sélectionne au lieu de
          // laisser la feuille ouverte sans rien dire.
          selectAddedBrand();
        } else {
          Alert.alert(
            'Marque non ajoutée',
            "Impossible d'ajouter cette marque pour le moment. Réessayez.",
          );
        }
      } finally {
        setIsAddingBrand(false);
      }
    }, [searchQuery, singleSelect, onSelectSingle]);

    const toggleBrand = useCallback((brandLabel: string) => {
      if (singleSelect) {
        // Highlight the tapped brand briefly before the sheet closes.
        setSelectedBrands([brandLabel]);
        if (onSelectSingle) {
          onSelectSingle(brandLabel);
        }
        bottomSheetRef.current?.close();
      } else {
        setSelectedBrands(prev => {
          if (prev.includes(brandLabel)) {
            return prev.filter((b) => b !== brandLabel);
          } else {
            return [...prev, brandLabel];
          }
        });
      }
    }, [singleSelect, onSelectSingle]);

    const handleConfirm = useCallback(() => {
      if (onConfirm) {
        onConfirm(selectedBrands);
      }
      bottomSheetRef.current?.close();
    }, [onConfirm, selectedBrands]);

    const handleClear = useCallback(() => {
      setSelectedBrands([]);
    }, []);

    const handleSelectNoBrand = useCallback(() => {
      setSelectedBrands([]);
      onSelectNoBrand?.();
      bottomSheetRef.current?.close();
    }, [onSelectNoBrand]);

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ),
      []
    );

    const renderFooter = useCallback(
      (props: any) => {
        if (singleSelect) return null;

        return (
          <BottomSheetFooter {...props}>
            <View
              style={[
                styles.footer,
                { paddingBottom: insets.bottom + 16 },
                darkMode && { backgroundColor: colors.deep, borderTopColor: colors.darkBorder },
                isTroc && styles.trocSurface,
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  isTroc && styles.trocConfirmButton,
                  selectedBrands.length === 0 && styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirm}
                accessibilityRole={isTroc ? 'button' : undefined}
                accessibilityLabel={isTroc ? 'Valider les marques' : undefined}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmButtonText}>
                  {selectedBrands.length === 0
                    ? 'VALIDER'
                    : `VALIDER (${selectedBrands.length})`
                  }
                </Text>
              </TouchableOpacity>
            </View>
          </BottomSheetFooter>
        );
      },
      [selectedBrands, insets.bottom, handleConfirm, singleSelect, darkMode, isTroc]
    );

    const handleLoadMore = useCallback(() => {
      // Only paginate when not searching (search uses Firestore queries with different pagination)
      if (!searchQuery.trim() && hasMoreBrands && !isLoadingMore) {
        loadBrands(true);
      }
    }, [searchQuery, hasMoreBrands, isLoadingMore]);

    const renderListFooter = useCallback(() => {
      if (isLoadingMore) {
        return (
          <View style={styles.loadMoreContainer}>
            <ActivityIndicator size="small" color={colors.rust} />
          </View>
        );
      }
      // Search-only ceiling reached: prompt the user to narrow their query.
      if (searchResultsCapped && searchQuery.trim()) {
        return (
          <View style={styles.refineContainer}>
            <Text style={[styles.refineText, darkMode && { color: mutedColor }]}>
              Affinez votre recherche pour voir plus de marques
            </Text>
          </View>
        );
      }
      return null;
    }, [isLoadingMore, searchResultsCapped, searchQuery, darkMode, mutedColor]);

    const renderBrandItem = useCallback(({ item }: { item: Brand }) => {
      const isSelected = singleSelect
        ? selectedBrands.includes(item.label) || selectedBrand === item.label
        : selectedBrands.includes(item.label);
      return (
        <TouchableOpacity
          style={[
            styles.brandItem,
            darkMode && { borderBottomColor: colors.darkBorder },
            isSelected && (darkMode ? { backgroundColor: colors.darkSurface1 } : styles.brandItemSelected),
          ]}
          onPress={() => toggleBrand(item.label)}
          accessibilityRole={isTroc ? singleSelect ? 'button' : 'checkbox' : undefined}
          accessibilityLabel={isTroc ? item.label : undefined}
          accessibilityState={isTroc ? singleSelect ? {selected: isSelected} : {checked: isSelected} : undefined}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.brandItemText,
              darkMode && { color: colors.cream },
              isSelected && styles.brandItemTextSelected,
              isSelected && darkMode && { color: colors.cream },
            ]}
          >
            {item.label}
          </Text>
          {isSelected && (
            <Ionicons name="checkmark" size={18} color={darkMode ? colors.cream : colors.charcoal} />
          )}
        </TouchableOpacity>
      );
    }, [selectedBrands, selectedBrand, singleSelect, toggleBrand, darkMode, isTroc]);

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
        handleIndicatorStyle={[
          styles.handleIndicator,
          darkMode && { backgroundColor: colors.darkBorderStrong },
        ]}
        backgroundStyle={[
          styles.sheetBackground,
          isTroc && styles.trocSurface,
          darkMode && { backgroundColor: colors.deep },
        ]}
        enableDynamicSizing={false}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="none"
        android_keyboardInputMode="adjustResize"
      >
        {/* ── Header ── */}
        <View style={styles.headerContainer}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={[styles.title, darkMode && { color: colors.cream }, isTroc && styles.trocTitle]}>Marques</Text>
              {selectedBrands.length > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{selectedBrands.length}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={() => bottomSheetRef.current?.close()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeButton}
              accessibilityRole={isTroc ? 'button' : undefined}
              accessibilityLabel={isTroc ? 'Fermer les marques' : undefined}
            >
              <Ionicons name="close" size={22} color={textColor} />
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, darkMode && { backgroundColor: colors.darkBorder }]} />

          {/* ── Search bar ── */}
          <View
            style={[
              styles.searchContainer,
              darkMode && { borderColor: colors.darkBorderStrong },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={mutedColor} style={styles.searchIcon} />
            <BottomSheetTextInput
              ref={inputRef}
              style={[styles.searchInput, darkMode && { color: colors.cream }]}
              placeholder="Rechercher une marque..."
              accessibilityLabel={isTroc ? 'Rechercher une marque' : undefined}
              placeholderTextColor={mutedColor}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity accessibilityRole={isTroc ? 'button' : undefined} accessibilityLabel={isTroc ? 'Effacer la recherche' : undefined} onPress={() => { setSearchQuery(''); setSearchResultsCapped(false); setFilteredBrands(brands); }}>
                <Ionicons name="close" size={18} color={mutedColor} />
              </TouchableOpacity>
            )}
          </View>

          {/* ── Add custom brand ── */}
          {canAddCustomBrand && (
            <TouchableOpacity
              style={styles.addBrandButton}
              onPress={addCustomBrand}
              disabled={isAddingBrand}
            >
              <View style={styles.addBrandContent}>
                <Ionicons name="add" size={18} color={colors.rust} />
                <Text style={styles.addBrandText}>
                  Ajouter &quot;{searchQuery.trim()}&quot;
                </Text>
              </View>
              {isAddingBrand && <ActivityIndicator size="small" color={colors.rust} />}
            </TouchableOpacity>
          )}

          {/* ── Selection controls ── */}
          {selectedBrands.length > 0 && !(singleSelect && onSelectNoBrand) && (
            <View style={styles.controls}>
              <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
                <Text style={styles.clearButtonText}>Tout effacer</Text>
              </TouchableOpacity>
            </View>
          )}

          {singleSelect && onSelectNoBrand && (
            <TouchableOpacity
              testID="brand-none-option"
              accessibilityRole="button"
              accessibilityLabel="Sans marque"
              accessibilityState={{ selected: selectedBrand === null && selectedBrands.length === 0 }}
              style={[
                styles.brandItem,
                darkMode && styles.darkBrandItem,
                selectedBrand === null && selectedBrands.length === 0 &&
                  (darkMode ? styles.darkBrandItemSelected : styles.brandItemSelected),
              ]}
              onPress={handleSelectNoBrand}
              activeOpacity={0.7}
            >
              <Text style={[styles.brandItemText, darkMode && styles.darkBrandItemText]}>Sans marque</Text>
              {selectedBrand === null && selectedBrands.length === 0 && (
                <Ionicons name="checkmark" size={18} color={textColor} />
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* ── Brand list ── */}
        {isLoading ? (
          <View style={styles.loadingContent}>
            <ActivityIndicator size="large" color={colors.rust} />
            <Text style={[styles.loadingText, darkMode && { color: mutedColor }]}>Chargement des marques...</Text>
          </View>
        ) : (
          <BottomSheetFlatList
            data={filteredBrands}
            renderItem={renderBrandItem}
            keyExtractor={(item) => item.value}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderListFooter}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="search-outline" size={40} color={darkMode ? colors.darkBorderStrong : colors.borderStrong} />
                <Text style={[styles.emptyText, darkMode && { color: mutedColor }]}>Aucune marque trouvée</Text>
              </View>
            }
          />
        )}
      </BottomSheet>
    );
  }
);

BrandSelectionSheet.displayName = 'BrandSelectionSheet';

export default BrandSelectionSheet;

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
  headerContainer: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    borderRadius: 0,
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
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    paddingHorizontal: 14,
    height: 48,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    letterSpacing: 0.1,
    color: colors.charcoal,
    paddingVertical: 0,
  },
  addBrandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.rust,
    borderStyle: 'dashed',
    borderRadius: 0,
    padding: 14,
    marginTop: 12,
  },
  addBrandContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addBrandText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.rust,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 12,
  },
  clearButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  clearButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.rust,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  brandItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: 'transparent',
  },
  brandItemSelected: {
    backgroundColor: colors.surfaceWarm,
  },
  darkBrandItem: {
    borderBottomColor: colors.darkBorder,
  },
  darkBrandItemSelected: {
    backgroundColor: colors.darkSurface1,
  },
  darkBrandItemText: {
    color: colors.cream,
  },
  brandItemText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    letterSpacing: 0.1,
    color: colors.charcoal,
  },
  brandItemTextSelected: {
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
  },
  loadingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  loadMoreContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  refineContainer: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  refineText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.2,
    color: colors.muted,
    textAlign: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirmButton: {
    backgroundColor: colors.charcoal,
    borderRadius: 0,
    paddingVertical: 16,
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
