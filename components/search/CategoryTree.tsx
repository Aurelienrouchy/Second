import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { CategoryNode } from '@/data/categories-v2';

interface CategoryTreeProps {
  navigationPath: CategoryNode[];
  currentList: CategoryNode[];
  currentTitle: string;
  isAtRoot: boolean;
  onCategorySelect: (category: CategoryNode) => string[] | null;
  onBack: () => void;
  onSelectCurrent: () => string[];
}

export default function CategoryTree({
  navigationPath,
  currentList,
  currentTitle,
  isAtRoot,
  onCategorySelect,
  onBack,
  onSelectCurrent,
}: CategoryTreeProps) {
  return (
    <View style={styles.container}>
      {/* Breadcrumb Header */}
      {!isAtRoot && (
        <View style={styles.breadcrumbHeader}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color="#1C1C1E" />
          </TouchableOpacity>

          <Text style={styles.breadcrumbTitle} numberOfLines={1}>
            {currentTitle}
          </Text>

          <TouchableOpacity onPress={onSelectCurrent} style={styles.selectButton}>
            <Text style={styles.selectButtonText}>Choisir</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Category List */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {currentList.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={styles.categoryItem}
            onPress={() => onCategorySelect(category)}
            activeOpacity={0.7}
          >
            {category.icon && (
              <View style={styles.iconContainer}>
                <Ionicons
                  name={getCategoryIconName(category.icon)}
                  size={22}
                  color="#F79F24"
                />
              </View>
            )}

            <Text style={styles.categoryLabel}>{category.label}</Text>

            {category.children && category.children.length > 0 ? (
              <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
            ) : (
              <View style={styles.leafIndicator} />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// Helper to map category icon strings to Ionicons names
function getCategoryIconName(icon: string): keyof typeof Ionicons.glyphMap {
  const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
    woman: 'woman-outline',
    man: 'man-outline',
    happy: 'happy-outline',
    home: 'home-outline',
    'game-controller': 'game-controller-outline',
    paw: 'paw-outline',
  };

  return iconMap[icon] || 'folder-outline';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  breadcrumbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    backgroundColor: '#FAFAFA',
  },
  backButton: {
    padding: 8,
  },
  breadcrumbTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  selectButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F79F24',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF5E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryLabel: {
    flex: 1,
    fontSize: 16,
    color: '#1C1C1E',
  },
  leafIndicator: {
    width: 20,
  },
});
