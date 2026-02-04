import { firestore } from '@/config/firebaseConfig';
import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetFooter, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, limit, query, where, doc, setDoc } from '@react-native-firebase/firestore';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export interface BrandSelectionSheetRef {
  show: (searchQueryOverride?: string) => void;
  hide: () => void;
}

interface Brand {
  value: string;
  label: string;
}

interface BrandSelectionSheetProps {
  selectedBrands?: string[];
  selectedBrand?: string | null;
  onConfirm?: (brands: string[]) => void;
  onSelectSingle?: (brand: string) => void;
  initialSearchQuery?: string;
  singleSelect?: boolean;
}

const BrandSelectionSheet = forwardRef<BrandSelectionSheetRef, BrandSelectionSheetProps>(
  ({ selectedBrands: initialSelectedBrands = [], selectedBrand, onConfirm, onSelectSingle, initialSearchQuery = '', singleSelect = false }, ref) => {
    const insets = useSafeAreaInsets();
    const bottomSheetRef = useRef<BottomSheet>(null);
    const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [filteredBrands, setFilteredBrands] = useState<Brand[]>([]);
    const [selectedBrands, setSelectedBrands] = useState<string[]>(initialSelectedBrands);
    const [isLoading, setIsLoading] = useState(false);
    const [isAddingBrand, setIsAddingBrand] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasInitializedSearch = useRef(false);

    // Fixed height: screen height minus safe area top - about 100px for status bar area
    const snapPoints = useMemo(() => [SCREEN_HEIGHT - insets.top - 50], [insets.top]);
    const inputRef = useRef<any>(null);

    // Check if search query could be added as a new brand
    const canAddCustomBrand = useMemo(() => {
      if (!searchQuery.trim() || searchQuery.trim().length < 2) return false;
      const normalizedQuery = searchQuery.trim().toLowerCase();
      // Check if exact match exists
      const exactMatch = filteredBrands.some(
        b => b.label.toLowerCase() === normalizedQuery
      );
      return !exactMatch;
    }, [searchQuery, filteredBrands]);

    // State to track if we need to trigger initial search
    const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      show: (searchQueryOverride?: string) => {
        bottomSheetRef.current?.expand();
        if (singleSelect) {
          setSelectedBrands(selectedBrand ? [selectedBrand] : []);
        } else {
          setSelectedBrands(initialSelectedBrands);
        }
        // Set initial search query if provided
        const queryToUse = searchQueryOverride || initialSearchQuery;
        if (queryToUse && !hasInitializedSearch.current) {
          setSearchQuery(queryToUse);
          hasInitializedSearch.current = true;
          // Trigger search via state change (will be picked up by useEffect)
          setPendingSearchQuery(queryToUse);
        }
      },
      hide: () => {
        bottomSheetRef.current?.close();
      },
    }));

    useEffect(() => {
      loadBrands();
    }, []);

    // Handle pending search query from show()
    useEffect(() => {
      if (pendingSearchQuery && brands.length > 0) {
        // Perform Firestore search for initial query
        const performInitialSearch = async () => {
          try {
            const normalizedQuery = pendingSearchQuery.toLowerCase().trim();
            const q = query(
              collection(firestore, 'brands'),
              where('searchKey', '>=', normalizedQuery),
              where('searchKey', '<=', normalizedQuery + '\uf8ff'),
              limit(50)
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
            setFilteredBrands(searchResults.length > 0 ? searchResults : brands.filter(b =>
              b.label.toLowerCase().includes(pendingSearchQuery.toLowerCase())
            ));
          } catch (error) {
            console.error('Error performing initial search:', error);
            // Fallback to local filtering
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

    const loadBrands = async () => {
      try {
        setIsLoading(true);
        const q = query(collection(firestore, 'brands'), limit(100));
        const querySnapshot = await getDocs(q);

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

        brandsList.sort((a, b) => a.label.localeCompare(b.label));
        setBrands(brandsList);
        setFilteredBrands(brandsList);
      } catch (error) {
        console.error('Error loading brands:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const handleSearch = useCallback((text: string) => {
      setSearchQuery(text);

      // Clear previous timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (!text.trim()) {
        setFilteredBrands(brands);
        return;
      }

      // Debounce the search to avoid losing focus
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const normalizedQuery = text.toLowerCase().trim();
          const q = query(
            collection(firestore, 'brands'),
            where('searchKey', '>=', normalizedQuery),
            where('searchKey', '<=', normalizedQuery + '\uf8ff'),
            limit(50)
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

    // Cleanup timeout on unmount
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

      setIsAddingBrand(true);
      try {
        const searchKey = brandName.toLowerCase();
        const brandDoc = {
          label: brandName,
          value: searchKey,
          searchKey: searchKey,
          isCustom: true,
          createdAt: new Date().toISOString(),
        };

        // Add to Firestore
        await setDoc(doc(firestore, 'brands', searchKey), brandDoc);

        // Add to local state
        const newBrand: Brand = { value: searchKey, label: brandName };
        setBrands(prev => [...prev, newBrand].sort((a, b) => a.label.localeCompare(b.label)));
        setFilteredBrands(prev => [...prev, newBrand].sort((a, b) => a.label.localeCompare(b.label)));

        if (singleSelect) {
          // In single select mode, immediately select and close
          if (onSelectSingle) {
            onSelectSingle(brandName);
          }
          setSearchQuery('');
          bottomSheetRef.current?.close();
        } else {
          // Select the new brand
          setSelectedBrands(prev => [...prev, brandName]);
          setSearchQuery('');
        }
      } catch (error) {
        console.error('Error adding custom brand:', error);
      } finally {
        setIsAddingBrand(false);
      }
    }, [searchQuery, singleSelect, onSelectSingle]);

    const toggleBrand = useCallback((brandLabel: string) => {
      if (singleSelect) {
        // In single select mode, immediately select and close
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

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ),
      []
    );

    const renderFooter = useCallback(
      (props: any) => {
        // No footer needed in single select mode
        if (singleSelect) return null;

        return (
          <BottomSheetFooter {...props} bottomInset={insets.bottom}>
            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  selectedBrands.length === 0 && styles.confirmButtonDisabled,
                ]}
                onPress={handleConfirm}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmButtonText}>
                  {selectedBrands.length === 0
                    ? 'Sélectionner une marque'
                    : `Valider (${selectedBrands.length})`
                  }
                </Text>
              </TouchableOpacity>
            </View>
          </BottomSheetFooter>
        );
      },
      [selectedBrands, insets.bottom, handleConfirm, singleSelect]
    );

    const renderBrandItem = useCallback(({ item }: { item: Brand }) => {
      const isSelected = singleSelect
        ? selectedBrand === item.label
        : selectedBrands.includes(item.label);
      return (
        <TouchableOpacity
          style={[styles.brandItem, isSelected && styles.brandItemSelected]}
          onPress={() => toggleBrand(item.label)}
          activeOpacity={0.7}
        >
          <Text style={[styles.brandItemText, isSelected && styles.brandItemTextSelected]}>
            {item.label}
          </Text>
          {isSelected && (
            <Ionicons name="checkmark-circle" size={22} color="#F79F24" />
          )}
        </TouchableOpacity>
      );
    }, [selectedBrands, selectedBrand, singleSelect, toggleBrand]);

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        footerComponent={renderFooter}
        enablePanDownToClose
        topInset={insets.top}
        handleIndicatorStyle={styles.handleIndicator}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="none"
        android_keyboardInputMode="adjustResize"
      >
        {/* Fixed Header - stays outside FlatList to prevent focus loss */}
        <View style={styles.headerContainer}>
          {/* Title row */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Marques</Text>
              {selectedBrands.length > 0 && (
                <View style={styles.selectedBadge}>
                  <Text style={styles.selectedCount}>{selectedBrands.length}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={() => bottomSheetRef.current?.close()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={24} color="#1C1C1E" />
            </TouchableOpacity>
          </View>

          {/* Search bar - fixed, not in FlatList */}
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={20} color="#8E8E93" style={styles.searchIcon} />
            <BottomSheetTextInput
              ref={inputRef}
              style={styles.searchInput}
              placeholder="Rechercher une marque..."
              placeholderTextColor="#8E8E93"
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setFilteredBrands(brands); }}>
                <Ionicons name="close-circle" size={20} color="#8E8E93" />
              </TouchableOpacity>
            )}
          </View>

          {/* Add custom brand option */}
          {canAddCustomBrand && (
            <TouchableOpacity
              style={styles.addBrandButton}
              onPress={addCustomBrand}
              disabled={isAddingBrand}
            >
              <View style={styles.addBrandContent}>
                <Ionicons name="add-circle-outline" size={22} color="#F79F24" />
                <Text style={styles.addBrandText}>
                  Ajouter "{searchQuery.trim()}"
                </Text>
              </View>
              {isAddingBrand && <ActivityIndicator size="small" color="#F79F24" />}
            </TouchableOpacity>
          )}

          {/* Selection controls */}
          {selectedBrands.length > 0 && (
            <View style={styles.controls}>
              <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
                <Text style={styles.clearButtonText}>Tout effacer</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Brand list */}
        {isLoading ? (
          <View style={styles.loadingContent}>
            <ActivityIndicator size="large" color="#F79F24" />
            <Text style={styles.loadingText}>Chargement des marques...</Text>
          </View>
        ) : (
          <BottomSheetFlatList
            data={filteredBrands}
            renderItem={renderBrandItem}
            keyExtractor={(item) => item.value}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="search-outline" size={48} color="#8E8E93" />
                <Text style={styles.emptyText}>Aucune marque trouvée</Text>
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

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: '#DDDDDD',
    width: 40,
  },
  headerContainer: {
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  selectedBadge: {
    backgroundColor: '#F79F24',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  selectedCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    marginTop: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1C1C1E',
    paddingVertical: 0,
  },
  addBrandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF3E0',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#F79F24',
    borderStyle: 'dashed',
  },
  addBrandContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addBrandText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F79F24',
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
    fontSize: 14,
    fontWeight: '600',
    color: '#FF3B30',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100, // Space for footer
  },
  brandItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F8F8F8',
    marginBottom: 8,
  },
  brandItemSelected: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#F79F24',
  },
  brandItemText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  brandItemTextSelected: {
    color: '#F79F24',
    fontWeight: '600',
  },
  loadingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#8E8E93',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  confirmButton: {
    backgroundColor: '#F79F24',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
