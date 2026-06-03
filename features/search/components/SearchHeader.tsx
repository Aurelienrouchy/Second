/**
 * SearchHeader — back button, search input, camera button, and OK action.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors } from '@/constants/theme';

import { searchStyles as styles } from '../styles';

export interface SearchHeaderProps {
  inputRef: React.Ref<TextInput>;
  searchQuery: string;
  showOk: boolean;
  onChangeQuery: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  onClose: () => void;
  onOpenVisualSearch: () => void;
}

function SearchHeaderComponent({
  inputRef,
  searchQuery,
  showOk,
  onChangeQuery,
  onClear,
  onSubmit,
  onClose,
  onOpenVisualSearch,
}: SearchHeaderProps) {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.header}>
      <Pressable onPress={onClose} style={styles.backButton} hitSlop={8}>
        <Ionicons name="arrow-back" size={22} color={colors.charcoal} />
      </Pressable>

      <View style={styles.searchInputContainer}>
        <Ionicons name="search" size={16} color={colors.muted} style={styles.searchIcon} />
        <TextInput
          ref={inputRef}
          testID="search-input"
          style={styles.searchInput}
          placeholder="Rechercher..."
          placeholderTextColor={colors.muted}
          value={searchQuery}
          onChangeText={onChangeQuery}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <Pressable
            onPress={onClear}
            testID="search-clear-button"
            style={styles.clearButton}
            hitSlop={8}
          >
            <Ionicons name="close" size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={onOpenVisualSearch}
        testID="search-visual-button"
        style={styles.cameraButton}
        hitSlop={4}
      >
        <Ionicons name="camera-outline" size={20} color={colors.rust} />
      </Pressable>

      {showOk && (
        <Pressable onPress={onSubmit} testID="search-submit-button" style={styles.okButton}>
          <Text style={styles.okButtonText}>OK</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

export const SearchHeader = React.memo(SearchHeaderComponent);
