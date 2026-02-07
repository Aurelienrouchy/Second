/**
 * SwapZoneFilters Component
 * Filtres spécifiques pour les vêtements dans la Swap Zone
 * 
 * Features:
 * - Catégorie (Hauts, Bas, Chaussures, Accessoires)
 * - Taille
 * - Genre (Homme, Femme, Unisexe)
 * - Marque
 * - Couleur
 * - État
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Label } from '@/components/ui';
import { colors, spacing, radius, fonts } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

export interface SwapZoneFilter {
  categories?: string[];
  sizes?: string[];
  genders?: string[];
  brands?: string[];
  colors?: string[];
  conditions?: string[];
  priceRange?: { min: number; max: number };
}

interface SwapZoneFiltersProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: SwapZoneFilter) => void;
  initialFilters?: SwapZoneFilter;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CATEGORIES = [
  { id: 'tops', label: '👕 Hauts', emoji: '👕' },
  { id: 'bottoms', label: '👖 Bas', emoji: '👖' },
  { id: 'dresses', label: '👗 Robes', emoji: '👗' },
  { id: 'outerwear', label: '🧥 Manteaux', emoji: '🧥' },
  { id: 'shoes', label: '👟 Chaussures', emoji: '👟' },
  { id: 'accessories', label: '👜 Accessoires', emoji: '👜' },
];

const SIZES = {
  tops: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  bottoms: ['34', '36', '38', '40', '42', '44', '46'],
  shoes: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'],
  universal: ['Unique'],
};

const GENDERS = [
  { id: 'men', label: '👔 Homme' },
  { id: 'women', label: '👗 Femme' },
  { id: 'unisex', label: '⚧ Unisexe' },
];

const POPULAR_BRANDS = [
  'Nike',
  'Adidas',
  'Zara',
  'H&M',
  'Uniqlo',
  'Carhartt',
  'Levi\'s',
  'Vans',
  'Stussy',
  'Supreme',
  'The North Face',
];

const COLORS = [
  { id: 'black', label: 'Noir', hex: '#000000' },
  { id: 'white', label: 'Blanc', hex: '#FFFFFF' },
  { id: 'gray', label: 'Gris', hex: '#808080' },
  { id: 'navy', label: 'Marine', hex: '#000080' },
  { id: 'blue', label: 'Bleu', hex: '#0066CC' },
  { id: 'red', label: 'Rouge', hex: '#DC143C' },
  { id: 'green', label: 'Vert', hex: '#228B22' },
  { id: 'yellow', label: 'Jaune', hex: '#FFD700' },
  { id: 'pink', label: 'Rose', hex: '#FF69B4' },
  { id: 'purple', label: 'Violet', hex: '#9370DB' },
  { id: 'beige', label: 'Beige', hex: '#F5F5DC' },
  { id: 'brown', label: 'Marron', hex: '#8B4513' },
];

const CONDITIONS = [
  { id: 'neuf', label: '✨ Neuf avec étiquette' },
  { id: 'très bon état', label: '👌 Très bon état' },
  { id: 'bon état', label: '👍 Bon état' },
  { id: 'satisfaisant', label: '✅ Satisfaisant' },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function SwapZoneFilters({
  visible,
  onClose,
  onApply,
  initialFilters = {},
}: SwapZoneFiltersProps) {
  const [filters, setFilters] = useState<SwapZoneFilter>(initialFilters);
  const [showBrandInput, setShowBrandInput] = useState(false);
  const [customBrand, setCustomBrand] = useState('');

  const handleToggle = (
    filterKey: keyof SwapZoneFilter,
    value: string
  ) => {
    const currentValues = (filters[filterKey] as string[]) || [];
    const newValues = currentValues.includes(value)
      ? currentValues.filter((v) => v !== value)
      : [...currentValues, value];

    setFilters({ ...filters, [filterKey]: newValues });
  };

  const handleClearAll = () => {
    setFilters({});
  };

  const handleApply = () => {
    onApply(filters);
    onClose();
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.categories?.length) count += filters.categories.length;
    if (filters.sizes?.length) count += filters.sizes.length;
    if (filters.genders?.length) count += filters.genders.length;
    if (filters.brands?.length) count += filters.brands.length;
    if (filters.colors?.length) count += filters.colors.length;
    if (filters.conditions?.length) count += filters.conditions.length;
    return count;
  };

  const activeCount = getActiveFilterCount();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text variant="h3" style={styles.headerTitle}>
            Filtres
          </Text>
          <TouchableOpacity onPress={handleClearAll}>
            <Text variant="bodySmall" style={styles.clearText}>
              Réinitialiser
            </Text>
          </TouchableOpacity>
        </View>

        {/* Filters Content */}
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Categories */}
          <FilterSection title="Catégorie">
            <View style={styles.chipGrid}>
              {CATEGORIES.map((cat) => (
                <Chip
                  key={cat.id}
                  label={cat.label}
                  selected={filters.categories?.includes(cat.id)}
                  onPress={() => handleToggle('categories', cat.id)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Gender */}
          <FilterSection title="Genre">
            <View style={styles.chipRow}>
              {GENDERS.map((gender) => (
                <Chip
                  key={gender.id}
                  label={gender.label}
                  selected={filters.genders?.includes(gender.id)}
                  onPress={() => handleToggle('genders', gender.id)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Sizes */}
          <FilterSection title="Taille">
            <View style={styles.chipGrid}>
              {[...SIZES.tops, ...SIZES.bottoms.slice(0, 4), ...SIZES.shoes.slice(0, 6)].map((size) => (
                <Chip
                  key={size}
                  label={size}
                  selected={filters.sizes?.includes(size)}
                  onPress={() => handleToggle('sizes', size)}
                  compact
                />
              ))}
            </View>
          </FilterSection>

          {/* Brands */}
          <FilterSection title="Marques populaires">
            <View style={styles.chipGrid}>
              {POPULAR_BRANDS.map((brand) => (
                <Chip
                  key={brand}
                  label={brand}
                  selected={filters.brands?.includes(brand)}
                  onPress={() => handleToggle('brands', brand)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Colors */}
          <FilterSection title="Couleur">
            <View style={styles.colorGrid}>
              {COLORS.map((color) => (
                <ColorChip
                  key={color.id}
                  color={color.hex}
                  label={color.label}
                  selected={filters.colors?.includes(color.id)}
                  onPress={() => handleToggle('colors', color.id)}
                />
              ))}
            </View>
          </FilterSection>

          {/* Condition */}
          <FilterSection title="État">
            <View style={styles.chipColumn}>
              {CONDITIONS.map((condition) => (
                <Chip
                  key={condition.id}
                  label={condition.label}
                  selected={filters.conditions?.includes(condition.id)}
                  onPress={() => handleToggle('conditions', condition.id)}
                  fullWidth
                />
              ))}
            </View>
          </FilterSection>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyButton} onPress={handleApply}>
            <Text variant="body" style={styles.applyButtonText}>
              Appliquer {activeCount > 0 && `(${activeCount})`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// =============================================================================
// FILTER SECTION
// =============================================================================

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Label style={styles.sectionLabel}>{title}</Label>
      {children}
    </View>
  );
}

// =============================================================================
// CHIP COMPONENT
// =============================================================================

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
  fullWidth?: boolean;
}

function Chip({ label, selected, onPress, compact, fullWidth }: ChipProps) {
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        selected && styles.chipSelected,
        compact && styles.chipCompact,
        fullWidth && styles.chipFullWidth,
      ]}
      onPress={onPress}
    >
      <Text
        variant={compact ? 'caption' : 'bodySmall'}
        style={[styles.chipText, selected && styles.chipTextSelected]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// =============================================================================
// COLOR CHIP COMPONENT
// =============================================================================

interface ColorChipProps {
  color: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}

function ColorChip({ color, label, selected, onPress }: ColorChipProps) {
  return (
    <TouchableOpacity style={styles.colorChipContainer} onPress={onPress}>
      <View
        style={[
          styles.colorChip,
          { backgroundColor: color },
          selected && styles.colorChipSelected,
          color === '#FFFFFF' && styles.colorChipWhite,
        ]}
      >
        {selected && (
          <Ionicons
            name="checkmark"
            size={16}
            color={color === '#FFFFFF' ? colors.foreground : colors.white}
          />
        )}
      </View>
      <Text variant="caption" style={styles.colorLabel}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  closeButton: {
    width: 40,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.foreground,
  },
  clearText: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  sectionLabel: {
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chipColumn: {
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minWidth: 50,
    alignItems: 'center',
  },
  chipFullWidth: {
    width: '100%',
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.foreground,
    fontFamily: fonts.sansMedium,
  },
  chipTextSelected: {
    color: colors.white,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  colorChipContainer: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  colorChip: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorChipWhite: {
    borderColor: colors.border,
  },
  colorChipSelected: {
    borderColor: colors.foreground,
    borderWidth: 3,
  },
  colorLabel: {
    color: colors.foregroundSecondary,
    fontSize: 11,
  },
  bottomSpacer: {
    height: 100,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  applyButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonText: {
    color: colors.white,
    fontFamily: fonts.sansMedium,
    fontSize: 16,
  },
});
