import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    Dimensions,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: screenWidth } = Dimensions.get('window');

// Filter interfaces
export interface ProductFilters {
  category?: string;
  priceMin?: number;
  priceMax?: number;
  maxDistance?: number; // in km
  deliveryOptions: {
    pickup: boolean;
    shipping: boolean;
  };
  conditions: string[];
  brands: string[];
  sizes: string[];
  colors: string[];
  sortBy?: 'recent' | 'price_asc' | 'price_desc' | 'distance' | 'popular';
}

// Default filter values
const DEFAULT_FILTERS: ProductFilters = {
  priceMin: 0,
  priceMax: 500,
  maxDistance: 50,
  deliveryOptions: {
    pickup: true,
    shipping: true,
  },
  conditions: [],
  brands: [],
  sizes: [],
  colors: [],
  sortBy: 'recent',
};

// Predefined options
const CONDITIONS = [
  { id: 'neuf', label: 'Neuf avec étiquette', icon: 'sparkles' },
  { id: 'très bon état', label: 'Très bon état', icon: 'star' },
  { id: 'bon état', label: 'Bon état', icon: 'thumbs-up' },
  { id: 'satisfaisant', label: 'Satisfaisant', icon: 'checkmark' },
];

const POPULAR_BRANDS = [
  'Zara', 'H&M', 'Nike', 'Adidas', 'Uniqlo', 'Mango', 'COS', 'Massimo Dutti',
  'Pull & Bear', 'Bershka', 'Stradivarius', 'Reserved', 'Sézane', 'Ba&sh',
];

const SIZES = [
  'XS', 'S', 'M', 'L', 'XL', 'XXL',
  '34', '36', '38', '40', '42', '44', '46', '48',
];

const COLORS = [
  { id: 'noir', label: 'Noir', color: '#000000' },
  { id: 'blanc', label: 'Blanc', color: '#FFFFFF' },
  { id: 'gris', label: 'Gris', color: '#8E8E93' },
  { id: 'bleu', label: 'Bleu', color: '#007AFF' },
  { id: 'rouge', label: 'Rouge', color: '#FF3B30' },
  { id: 'vert', label: 'Vert', color: '#34C759' },
  { id: 'jaune', label: 'Jaune', color: '#FFCC00' },
  { id: 'rose', label: 'Rose', color: '#FF2D92' },
  { id: 'violet', label: 'Violet', color: '#AF52DE' },
  { id: 'orange', label: 'Orange', color: '#FF9500' },
  { id: 'marron', label: 'Marron', color: '#A2845E' },
  { id: 'beige', label: 'Beige', color: '#F2F2F7' },
];

export default function FiltersScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  
  // Parse initial filters from params if provided
  const initialFilters = params.filters ? JSON.parse(params.filters as string) : {};
  const maxPrice = Number(params.maxPrice) || 1000;
  const maxDistance = Number(params.maxDistance) || 100;
  
  const [filters, setFilters] = useState<ProductFilters>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
    priceMax: initialFilters.priceMax || maxPrice,
    maxDistance: initialFilters.maxDistance || maxDistance,
  });

  // Filter update helpers
  const updateFilter = useCallback(<K extends keyof ProductFilters>(
    key: K,
    value: ProductFilters[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleArrayFilter = useCallback(<K extends keyof ProductFilters>(
    key: K,
    value: string
  ) => {
    setFilters(prev => {
      const currentArray = (prev[key] as string[]) || [];
      const newArray = currentArray.includes(value)
        ? currentArray.filter(item => item !== value)
        : [...currentArray, value];
      return { ...prev, [key]: newArray };
    });
  }, []);

  // Action handlers
  const handleApply = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Navigate back with filters
    router.back();
    // TODO: Pass filters back to the calling screen
  }, [filters]);

  const handleReset = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const resetFilters = { ...DEFAULT_FILTERS, priceMax: maxPrice, maxDistance };
    setFilters(resetFilters);
  }, [maxPrice, maxDistance]);

  const handleCancel = useCallback(() => {
    router.back();
  }, []);

  // Count active filters
  const activeFiltersCount = React.useMemo(() => {
    let count = 0;
    if (filters.category) count++;
    if (filters.priceMin && filters.priceMin > 0) count++;
    if (filters.priceMax && filters.priceMax < maxPrice) count++;
    if (filters.maxDistance && filters.maxDistance < maxDistance) count++;
    if (!filters.deliveryOptions.pickup || !filters.deliveryOptions.shipping) count++;
    if (filters.conditions.length > 0) count++;
    if (filters.brands.length > 0) count++;
    if (filters.sizes.length > 0) count++;
    if (filters.colors.length > 0) count++;
    return count;
  }, [filters, maxPrice, maxDistance]);

  // Render components
  const renderHeader = () => (
    <View style={[styles.header]}>
      <Pressable onPress={handleCancel} style={styles.headerButton}>
        <Ionicons name="close" size={24} color="#1C1C1E" />
      </Pressable>
      <Text style={styles.headerTitle}>
        Filtres {activeFiltersCount > 0 && `(${activeFiltersCount})`}
      </Text>
      <Pressable onPress={handleReset} style={styles.headerButton}>
        <Text style={styles.resetText}>Effacer</Text>
      </Pressable>
    </View>
  );

  const renderPriceRange = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Prix</Text>
      <View style={styles.priceContainer}>
        <Text style={styles.priceLabel}>
          {filters.priceMin?.toFixed(0)}€ - {filters.priceMax?.toFixed(0)}€
        </Text>
        <View style={styles.sliderContainer}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={maxPrice}
            value={filters.priceMin || 0}
            onValueChange={(value) => updateFilter('priceMin', Math.round(value))}
            minimumTrackTintColor="#007AFF"
            maximumTrackTintColor="#E5E5EA"
          />
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={maxPrice}
            value={filters.priceMax || maxPrice}
            onValueChange={(value) => updateFilter('priceMax', Math.round(value))}
            minimumTrackTintColor="#007AFF"
            maximumTrackTintColor="#E5E5EA"
          />
        </View>
      </View>
    </View>
  );

  const renderDistanceRange = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Distance maximale</Text>
      <View style={styles.distanceContainer}>
        <Text style={styles.distanceLabel}>
          {filters.maxDistance}km autour de moi
        </Text>
        <Slider
          style={styles.slider}
          minimumValue={1}
          maximumValue={maxDistance}
          value={filters.maxDistance || maxDistance}
          onValueChange={(value) => updateFilter('maxDistance', Math.round(value))}
          minimumTrackTintColor="#007AFF"
          maximumTrackTintColor="#E5E5EA"
        />
      </View>
    </View>
  );

  const renderDeliveryOptions = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Options de livraison</Text>
      <View style={styles.deliveryContainer}>
        <View style={styles.deliveryOption}>
          <View style={styles.deliveryInfo}>
            <Ionicons name="car-outline" size={20} color="#1C1C1E" />
            <Text style={styles.deliveryLabel}>Remise en main propre</Text>
          </View>
          <Switch
            value={filters.deliveryOptions.pickup}
            onValueChange={(value) =>
              updateFilter('deliveryOptions', { ...filters.deliveryOptions, pickup: value })
            }
            trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
            thumbColor="#FFFFFF"
          />
        </View>
        <View style={styles.deliveryOption}>
          <View style={styles.deliveryInfo}>
            <Ionicons name="send-outline" size={20} color="#1C1C1E" />
            <Text style={styles.deliveryLabel}>Envoi postal</Text>
          </View>
          <Switch
            value={filters.deliveryOptions.shipping}
            onValueChange={(value) =>
              updateFilter('deliveryOptions', { ...filters.deliveryOptions, shipping: value })
            }
            trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>
    </View>
  );

  const renderConditions = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>État</Text>
      <View style={styles.optionsGrid}>
        {CONDITIONS.map((condition) => {
          const isSelected = filters.conditions.includes(condition.id);
          return (
            <Pressable
              key={condition.id}
              style={[styles.optionChip, isSelected && styles.selectedChip]}
              onPress={() => toggleArrayFilter('conditions', condition.id)}
            >
              <Ionicons
                name={condition.icon as any}
                size={16}
                color={isSelected ? '#FFFFFF' : '#1C1C1E'}
                style={styles.optionIcon}
              />
              <Text style={[styles.optionText, isSelected && styles.selectedText]}>
                {condition.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderBrands = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Marques populaires</Text>
      <View style={styles.optionsGrid}>
        {POPULAR_BRANDS.map((brand) => {
          const isSelected = filters.brands.includes(brand);
          return (
            <Pressable
              key={brand}
              style={[styles.optionChip, isSelected && styles.selectedChip]}
              onPress={() => toggleArrayFilter('brands', brand)}
            >
              <Text style={[styles.optionText, isSelected && styles.selectedText]}>
                {brand}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderSizes = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Tailles</Text>
      <View style={styles.optionsGrid}>
        {SIZES.map((size) => {
          const isSelected = filters.sizes.includes(size);
          return (
            <Pressable
              key={size}
              style={[styles.sizeChip, isSelected && styles.selectedChip]}
              onPress={() => toggleArrayFilter('sizes', size)}
            >
              <Text style={[styles.optionText, isSelected && styles.selectedText]}>
                {size}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderColors = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Couleurs</Text>
      <View style={styles.colorsGrid}>
        {COLORS.map((color) => {
          const isSelected = filters.colors.includes(color.id);
          return (
            <Pressable
              key={color.id}
              style={[styles.colorChip, isSelected && styles.selectedColorChip]}
              onPress={() => toggleArrayFilter('colors', color.id)}
            >
              <View
                style={[
                  styles.colorSwatch,
                  { backgroundColor: color.color },
                  color.id === 'blanc' && styles.whiteColorBorder,
                ]}
              />
              <Text style={[styles.colorText, isSelected && styles.selectedText]}>
                {color.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const renderFooter = () => (
    <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
      <Pressable style={styles.applyButton} onPress={handleApply}>
        <Text style={styles.applyButtonText}>
          Appliquer les filtres
          {activeFiltersCount > 0 && ` (${activeFiltersCount})`}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {renderPriceRange()}
        {renderDistanceRange()}
        {renderDeliveryOptions()}
        {renderConditions()}
        {renderBrands()}
        {renderSizes()}
        {renderColors()}
      </ScrollView>
      {renderFooter()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    backgroundColor: '#FFFFFF',
  },
  headerButton: {
    minWidth: 60,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  resetText: {
    fontSize: 16,
    color: '#FF3B30',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  
  // Price Range
  priceContainer: {
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#007AFF',
    marginBottom: 8,
  },
  sliderContainer: {
    width: '100%',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  
  // Distance
  distanceContainer: {
    alignItems: 'center',
  },
  distanceLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#007AFF',
    marginBottom: 8,
  },
  
  // Delivery Options
  deliveryContainer: {
    gap: 12,
  },
  deliveryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deliveryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deliveryLabel: {
    fontSize: 16,
    color: '#1C1C1E',
    marginLeft: 12,
  },
  
  // Options Grid
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#F2F2F7',
  },
  selectedChip: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  optionIcon: {
    marginRight: 4,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  selectedText: {
    color: '#FFFFFF',
  },
  
  // Size Chips
  sizeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#F2F2F7',
    minWidth: 50,
    alignItems: 'center',
  },
  
  // Colors Grid
  colorsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  colorChip: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedColorChip: {
    backgroundColor: '#F0F8FF',
    borderColor: '#007AFF',
  },
  colorSwatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginBottom: 4,
  },
  whiteColorBorder: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  colorText: {
    fontSize: 12,
    color: '#1C1C1E',
  },
  
  // Footer
  footer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  applyButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
