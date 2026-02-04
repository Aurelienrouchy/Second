import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const { width: screenWidth } = Dimensions.get('window');

interface FilterChip {
  id: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  count?: number;
}

interface FilterChipsProps {
  chips: FilterChip[];
  selectedChipId?: string;
  onChipPress: (chipId: string) => void;
  onFilterPress?: () => void;
  showFilterButton?: boolean;
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const FilterChips: React.FC<FilterChipsProps> = ({
  chips,
  selectedChipId,
  onChipPress,
  onFilterPress,
  showFilterButton = true,
  testID,
}) => {
  const [chipWidths, setChipWidths] = useState<{ [key: string]: number }>({});

  const handleChipPress = useCallback((chipId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChipPress(chipId);
  }, [onChipPress]);

  const handleFilterPress = useCallback(() => {
    if (onFilterPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onFilterPress();
    }
  }, [onFilterPress]);

  const renderChip = (chip: FilterChip) => {
    const isSelected = selectedChipId === chip.id;
    const animatedValue = useSharedValue(isSelected ? 1 : 0);

    // Update animation when selection changes
    React.useEffect(() => {
      animatedValue.value = withSpring(isSelected ? 1 : 0, {
        damping: 15,
        stiffness: 300,
      });
    }, [isSelected]);

    const animatedStyle = useAnimatedStyle(() => {
      const backgroundColor = interpolateColor(
        animatedValue.value,
        [0, 1],
        ['#F2F2F7', '#007AFF']
      );

      const borderColor = interpolateColor(
        animatedValue.value,
        [0, 1],
        ['#E5E5EA', '#007AFF']
      );

      return {
        backgroundColor,
        borderColor,
        transform: [
          {
            scale: withSpring(animatedValue.value === 1 ? 1.02 : 1, {
              damping: 15,
              stiffness: 300,
            }),
          },
        ],
      };
    });

    const textAnimatedStyle = useAnimatedStyle(() => {
      const color = interpolateColor(
        animatedValue.value,
        [0, 1],
        ['#1C1C1E', '#FFFFFF']
      );

      return { color };
    });

    return (
      <AnimatedPressable
        key={chip.id}
        style={[styles.chip, animatedStyle]}
        onPress={() => handleChipPress(chip.id)}
        testID={`filter-chip-${chip.id}`}
        accessibilityLabel={`Filtre ${chip.label}${chip.count ? `, ${chip.count} articles` : ''}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
      >
        <View style={styles.chipContent}>
          {chip.icon && (
            <Ionicons
              name={chip.icon}
              size={14}
              color={isSelected ? '#FFFFFF' : '#1C1C1E'}
              style={styles.chipIcon}
            />
          )}
          <Animated.Text style={[styles.chipText, textAnimatedStyle]}>
            {chip.label}
          </Animated.Text>
          {chip.count !== undefined && (
            <Animated.Text style={[styles.chipCount, textAnimatedStyle]}>
              {chip.count}
            </Animated.Text>
          )}
        </View>
      </AnimatedPressable>
    );
  };

  const renderFilterButton = () => {
    if (!showFilterButton) return null;

    return (
      <Pressable
        style={styles.filterButton}
        onPress={handleFilterPress}
        testID="filter-button"
        accessibilityLabel="Ouvrir les filtres avancés"
        accessibilityRole="button"
      >
        <Ionicons name="options-outline" size={18} color="#007AFF" />
        <Text style={styles.filterButtonText}>Filtres</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scrollView}
        decelerationRate="fast"
        snapToInterval={100}
        snapToAlignment="start"
      >
        {chips.map(renderChip)}
        {renderFilterButton()}
      </ScrollView>
    </View>
  );
};

// Predefined category chips for common use cases
export const createCategoryChips = (selectedCategory?: string): FilterChip[] => [
  {
    id: 'all',
    label: 'Tout',
    icon: 'grid-outline',
  },
  {
    id: 'femmes',
    label: 'Femmes',
    icon: 'person-outline',
  },
  {
    id: 'hommes',
    label: 'Hommes',
    icon: 'person-outline',
  },
  {
    id: 'enfants',
    label: 'Enfants',
    icon: 'happy-outline',
  },
  {
    id: 'accessoires',
    label: 'Accessoires',
    icon: 'bag-outline',
  },
  {
    id: 'chaussures',
    label: 'Chaussures',
    icon: 'footsteps-outline',
  },
  {
    id: 'maison',
    label: 'Maison',
    icon: 'home-outline',
  },
];

export const createSortChips = (selectedSort?: string): FilterChip[] => [
  {
    id: 'recent',
    label: 'Récent',
    icon: 'time-outline',
  },
  {
    id: 'price_asc',
    label: 'Prix ↑',
    icon: 'arrow-up-outline',
  },
  {
    id: 'price_desc',
    label: 'Prix ↓',
    icon: 'arrow-down-outline',
  },
  {
    id: 'distance',
    label: 'Distance',
    icon: 'location-outline',
  },
  {
    id: 'popular',
    label: 'Populaire',
    icon: 'heart-outline',
  },
];

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  chip: {
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#F2F2F7',
    minHeight: 36,
    justifyContent: 'center',
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipIcon: {
    marginRight: 4,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  chipCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1C1C1E',
    marginLeft: 4,
    opacity: 0.7,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#007AFF',
    backgroundColor: '#FFFFFF',
    marginLeft: 8,
    minHeight: 36,
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#007AFF',
    marginLeft: 4,
  },
});

export default FilterChips;



