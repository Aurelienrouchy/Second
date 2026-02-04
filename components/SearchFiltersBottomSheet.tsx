import { colors } from '@/data/colors';
import { materials } from '@/data/materials';
import { patterns } from '@/data/patterns';
import { sizes } from '@/data/sizes';
import { SearchFilters } from '@/types';
import BottomSheet, { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import React, { forwardRef, useMemo } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface SearchFiltersBottomSheetProps {
  filters: SearchFilters;
  selectedCategory?: string;
  onFiltersChange: (filters: SearchFilters) => void;
  onClose: () => void;
}

const SearchFiltersBottomSheet = forwardRef<BottomSheet, SearchFiltersBottomSheetProps>(
  ({ filters, selectedCategory, onFiltersChange, onClose }, ref) => {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ['20%', '70%'], []);

    const conditions = [
      { value: 'neuf', label: 'Neuf avec étiquettes' },
      { value: 'très bon état', label: 'Très bon état' },
      { value: 'bon état', label: 'Bon état' },
      { value: 'satisfaisant', label: 'Satisfaisant' },
    ];

    // Obtenir les tailles appropriées selon la catégorie
    const getAvailableSizes = () => {
      if (!selectedCategory) return sizes.femmes.vetements;
      
      const categoryLower = selectedCategory.toLowerCase();
      
      if (categoryLower.includes('chaussure')) {
        if (categoryLower.includes('homme')) return sizes.hommes.chaussures;
        if (categoryLower.includes('enfant')) return sizes.enfants.chaussures;
        return sizes.femmes.chaussures;
      }
      
      if (categoryLower.includes('accessoire')) {
        if (categoryLower.includes('homme')) return sizes.hommes.accessoires;
        return sizes.femmes.accessoires;
      }
      
      if (categoryLower.includes('enfant')) {
        return sizes.enfants.enfant;
      }
      
      if (categoryLower.includes('homme')) {
        return sizes.hommes.vetements;
      }
      
      return sizes.femmes.vetements;
    };

    const availableSizes = getAvailableSizes();

    const toggleColor = (colorValue: string) => {
      const newColors = filters.colors.includes(colorValue)
        ? filters.colors.filter(c => c !== colorValue)
        : [...filters.colors, colorValue];
      
      onFiltersChange({ ...filters, colors: newColors });
    };

    const toggleSize = (size: string) => {
      const newSizes = filters.sizes.includes(size)
        ? filters.sizes.filter(s => s !== size)
        : [...filters.sizes, size];
      
      onFiltersChange({ ...filters, sizes: newSizes });
    };

    const toggleMaterial = (material: string) => {
      const newMaterials = filters.materials.includes(material)
        ? filters.materials.filter(m => m !== material)
        : [...filters.materials, material];
      
      onFiltersChange({ ...filters, materials: newMaterials });
    };

    const setCondition = (condition: string) => {
      onFiltersChange({ 
        ...filters, 
        condition: filters.condition === condition ? undefined : condition 
      });
    };

    const [brandInput, setBrandInput] = React.useState('');

    const addBrand = () => {
      const value = brandInput.trim();
      if (!value) return;
      const exists = (filters.brands || []).some(b => b.toLowerCase() === value.toLowerCase());
      if (exists) {
        setBrandInput('');
        return;
      }
      onFiltersChange({ ...filters, brands: [...(filters.brands || []), value] });
      setBrandInput('');
    };

    const removeBrand = (value: string) => {
      onFiltersChange({ ...filters, brands: (filters.brands || []).filter(b => b !== value) });
    };

    const setSortBy = (value: 'recent' | 'price_asc' | 'price_desc' | 'popular') => {
      onFiltersChange({ ...filters, sortBy: filters.sortBy === value ? undefined : value });
    };

    const clearAllFilters = () => {
      onFiltersChange({
        colors: [],
        sizes: [],
        materials: [],
        condition: undefined,
        minPrice: undefined,
        maxPrice: undefined,
        brands: [],
        sortBy: undefined,
      });
    };

    const activeFiltersCount = 
      filters.colors.length + 
      filters.sizes.length + 
      filters.materials.length + 
      (filters.condition ? 1 : 0) + 
      (filters.minPrice !== undefined ? 1 : 0) + 
      (filters.maxPrice !== undefined ? 1 : 0) +
      ((filters.brands?.length || 0)) +
      (filters.sortBy ? 1 : 0);

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={onClose}
        topInset={insets.top}
      >
        <BottomSheetView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Filtres</Text>
            <View style={styles.headerActions}>
              {activeFiltersCount > 0 && (
                <TouchableOpacity onPress={clearAllFilters} style={styles.clearButton}>
                  <Text style={styles.clearText}>Effacer ({activeFiltersCount})</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <BottomSheetScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Tri */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trier par</Text>
              <View style={styles.optionsGrid}>
                {[
                  { value: 'recent', label: 'Plus récents' },
                  { value: 'price_asc', label: 'Prix croissant' },
                  { value: 'price_desc', label: 'Prix décroissant' },
                  { value: 'popular', label: 'Populaires' },
                ].map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.optionButton,
                      filters.sortBy === (opt.value as any) && styles.selectedOptionButton
                    ]}
                    onPress={() => setSortBy(opt.value as any)}
                  >
                    <Text style={[
                      styles.optionText,
                      filters.sortBy === (opt.value as any) && styles.selectedOptionText
                    ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Prix */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Prix (€)</Text>
              <View style={styles.priceContainer}>
                <TextInput
                  style={styles.priceInput}
                  placeholder="Min"
                  value={filters.minPrice?.toString() || ''}
                  onChangeText={(text) => {
                    const value = text ? parseInt(text) : undefined;
                    onFiltersChange({ ...filters, minPrice: value });
                  }}
                  keyboardType="numeric"
                />
                <Text style={styles.priceSeparator}>-</Text>
                <TextInput
                  style={styles.priceInput}
                  placeholder="Max"
                  value={filters.maxPrice?.toString() || ''}
                  onChangeText={(text) => {
                    const value = text ? parseInt(text) : undefined;
                    onFiltersChange({ ...filters, maxPrice: value });
                  }}
                  keyboardType="numeric"
                />
              </View>
            </View>

            {/* Marques */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Marques</Text>
              <View style={styles.brandRow}>
                <TextInput
                  style={[styles.priceInput, { flex: 1 }]}
                  placeholder="Ajouter une marque"
                  value={brandInput}
                  onChangeText={setBrandInput}
                  onSubmitEditing={addBrand}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addBrandButton} onPress={addBrand}>
                  <Text style={styles.addBrandText}>Ajouter</Text>
                </TouchableOpacity>
              </View>
              {(filters.brands && filters.brands.length > 0) && (
                <View style={styles.optionsGrid}>
                  {filters.brands.map(b => (
                    <TouchableOpacity key={b} style={[styles.optionButton, styles.brandChip]} onPress={() => removeBrand(b)}>
                      <Text style={styles.optionText}>{b}</Text>
                      <Text style={styles.closeText}>✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* État */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>État</Text>
              <View style={styles.optionsGrid}>
                {conditions.map((condition) => (
                  <TouchableOpacity
                    key={condition.value}
                    style={[
                      styles.optionButton,
                      filters.condition === condition.value && styles.selectedOptionButton
                    ]}
                    onPress={() => setCondition(condition.value)}
                  >
                    <Text style={[
                      styles.optionText,
                      filters.condition === condition.value && styles.selectedOptionText
                    ]}>
                      {condition.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Couleurs */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Couleurs</Text>
              <View style={styles.colorsGrid}>
                {colors.map((color) => (
                  <TouchableOpacity
                    key={color.value}
                    style={[
                      styles.colorButton,
                      filters.colors.includes(color.value) && styles.selectedColorButton
                    ]}
                    onPress={() => toggleColor(color.value)}
                  >
                    <View 
                      style={[styles.colorDot, { backgroundColor: color.hex }]} 
                    />
                    <Text style={[
                      styles.colorText,
                      filters.colors.includes(color.value) && styles.selectedColorText
                    ]}>
                      {color.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Tailles */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tailles</Text>
              <View style={styles.sizesGrid}>
                {availableSizes.map((size) => (
                  <TouchableOpacity
                    key={size}
                    style={[
                      styles.sizeButton,
                      filters.sizes.includes(size) && styles.selectedSizeButton
                    ]}
                    onPress={() => toggleSize(size)}
                  >
                    <Text style={[
                      styles.sizeText,
                      filters.sizes.includes(size) && styles.selectedSizeText
                    ]}>
                      {size}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Motifs */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Motifs</Text>
              <View style={styles.optionsGrid}>
                {patterns.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.optionButton,
                      (filters.patterns || []).includes(p) && styles.selectedOptionButton
                    ]}
                    onPress={() => {
                      const next = (filters.patterns || []).includes(p)
                        ? (filters.patterns || []).filter(x => x !== p)
                        : [ ...(filters.patterns || []), p ];
                      onFiltersChange({ ...filters, patterns: next });
                    }}
                  >
                    <Text style={[
                      styles.optionText,
                      (filters.patterns || []).includes(p) && styles.selectedOptionText
                    ]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Matières */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Matières</Text>
              <View style={styles.optionsGrid}>
                {materials.map((material) => (
                  <TouchableOpacity
                    key={material}
                    style={[
                      styles.optionButton,
                      filters.materials.includes(material) && styles.selectedOptionButton
                    ]}
                    onPress={() => toggleMaterial(material)}
                  >
                    <Text style={[
                      styles.optionText,
                      filters.materials.includes(material) && styles.selectedOptionText
                    ]}>
                      {material}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.bottomPadding} />
          </BottomSheetScrollView>
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 15,
  },
  clearText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 16,
    color: '#666',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f8f8f8',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  priceSeparator: {
    fontSize: 16,
    color: '#666',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addBrandButton: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F79F24',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBrandText: {
    color: '#fff',
    fontWeight: '600',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  brandChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedOptionButton: {
    backgroundColor: '#F79F24',
    borderColor: '#F79F24',
  },
  optionText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  selectedOptionText: {
    color: '#fff',
  },
  colorsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#ddd',
    gap: 8,
  },
  selectedColorButton: {
    backgroundColor: '#F79F24',
    borderColor: '#F79F24',
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  colorText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  selectedColorText: {
    color: '#fff',
  },
  sizesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sizeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#ddd',
    minWidth: 50,
    alignItems: 'center',
  },
  selectedSizeButton: {
    backgroundColor: '#F79F24',
    borderColor: '#F79F24',
  },
  sizeText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  selectedSizeText: {
    color: '#fff',
  },
  bottomPadding: {
    height: 100,
  },
});

SearchFiltersBottomSheet.displayName = 'SearchFiltersBottomSheet';

export default SearchFiltersBottomSheet;