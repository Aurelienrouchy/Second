import { getCategoryLabelFromIds } from '@/data/categories-v2';
import { colors } from '@/data/colors';
import { SearchFilters } from '@/types';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface ActiveFiltersProps {
  filters: SearchFilters;
  onFilterRemove: (filterType: keyof SearchFilters, value?: string) => void;
  onClearAll: () => void;
  selectedCategoryPath?: string[];
  onCategoryClear?: () => void;
}

type ActiveFilterChip =
  | { type: keyof SearchFilters; value: string; label: string; color?: string }
  | { type: any; label: string };

export default function ActiveFilters({ filters, onFilterRemove, onClearAll, selectedCategoryPath, onCategoryClear }: ActiveFiltersProps) {
  const activeFilters: ActiveFilterChip[] = [];

  // Couleurs
  filters.colors.forEach(colorValue => {
    const color = colors.find(c => c.value === colorValue);
    if (color) {
      activeFilters.push({
        type: 'colors' as keyof SearchFilters,
        value: colorValue,
        label: color.name,
        color: color.hex,
      });
    }
  });

  // Tailles
  filters.sizes.forEach(size => {
    activeFilters.push({
      type: 'sizes' as keyof SearchFilters,
      value: size,
      label: `Taille ${size}`,
    });
  });

  // Matières
  filters.materials.forEach(material => {
    activeFilters.push({
      type: 'materials' as keyof SearchFilters,
      value: material,
      label: material,
    });
  });

  // Motifs
  (filters.patterns || []).forEach(pattern => {
    activeFilters.push({
      type: 'patterns' as keyof SearchFilters,
      value: pattern,
      label: pattern,
    });
  });

  // Marques
  (filters.brands || []).forEach(brand => {
    activeFilters.push({
      type: 'brands' as keyof SearchFilters,
      value: brand,
      label: brand,
    });
  });

  // Condition
  if (filters.condition) {
    activeFilters.push({
      type: 'condition' as keyof SearchFilters,
      value: filters.condition,
      label: filters.condition,
    });
  }

  // Prix
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    let priceLabel = '';
    if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
      priceLabel = `${filters.minPrice}€ - ${filters.maxPrice}€`;
    } else if (filters.minPrice !== undefined) {
      priceLabel = `Min ${filters.minPrice}€`;
    } else if (filters.maxPrice !== undefined) {
      priceLabel = `Max ${filters.maxPrice}€`;
    }
    
    activeFilters.push({
      type: 'price' as any,
      label: priceLabel,
    });
  }

  // Catégorie sélectionnée
  if (selectedCategoryPath && selectedCategoryPath.length > 0) {
    activeFilters.unshift({
      type: 'category' as any,
      label: getCategoryLabelFromIds(selectedCategoryPath),
    });
  }

  if (activeFilters.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersContent}
      >
        {activeFilters.map((filter, index) => (
          <TouchableOpacity
            key={`${filter.type}-${('value' in filter ? filter.value : index)}`}
            style={[
              styles.filterChip,
              (('color' in filter) && filter.color) && { borderColor: (filter as any).color }
            ]}
            onPress={() => {
              if (filter.type === 'price') {
                onFilterRemove('minPrice');
                onFilterRemove('maxPrice');
              } else if (filter.type === 'category') {
                onCategoryClear && onCategoryClear();
              } else {
                onFilterRemove(filter.type as keyof SearchFilters, ('value' in filter ? (filter as any).value : undefined));
              }
            }}
          >
            {('color' in filter) && (filter as any).color && (
              <View 
                style={[styles.colorDot, { backgroundColor: (filter as any).color }]} 
              />
            )}
            <Text style={styles.filterText}>{filter.label}</Text>
            <Text style={styles.removeIcon}>✕</Text>
          </TouchableOpacity>
        ))}
        
        {activeFilters.length > 1 && (
          <TouchableOpacity style={styles.clearAllButton} onPress={onClearAll}>
            <Text style={styles.clearAllText}>Effacer tout</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
  },
  filtersContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F79F24',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#F79F24',
    gap: 6,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  filterText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },
  removeIcon: {
    fontSize: 10,
    color: '#fff',
    fontWeight: 'bold',
  },
  clearAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 15,
  },
  clearAllText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
});