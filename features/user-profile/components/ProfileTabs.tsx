/**
 * ProfileTabs — Sticky tab bar for Articles / Avis sections.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/constants/theme';
import type { ProfileTab } from '../types';

interface ProfileTabsProps {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
  reviewCount: number;
}

export const ProfileTabs = React.memo(function ProfileTabs({
  activeTab,
  onTabChange,
  reviewCount,
}: ProfileTabsProps) {
  return (
    <View style={styles.tabsContainer}>
      <Pressable
        testID="profile-tab-articles"
        style={[styles.tab, activeTab === 'articles' && styles.tabActive]}
        onPress={() => onTabChange('articles')}
      >
        <Ionicons
          name="grid-outline"
          size={16}
          color={activeTab === 'articles' ? colors.charcoal : colors.muted}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'articles' && styles.tabLabelActive,
          ]}
        >
          Articles
        </Text>
      </Pressable>
      <Pressable
        testID="profile-tab-avis"
        style={[styles.tab, activeTab === 'avis' && styles.tabActive]}
        onPress={() => onTabChange('avis')}
      >
        <Ionicons
          name="star-outline"
          size={16}
          color={activeTab === 'avis' ? colors.charcoal : colors.muted}
        />
        <Text
          style={[
            styles.tabLabel,
            activeTab === 'avis' && styles.tabLabelActive,
          ]}
        >
          Avis{reviewCount > 0 ? ` (${reviewCount})` : ''}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    gap: 6,
  },
  tabActive: {
    borderBottomColor: colors.charcoal,
  },
  tabLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.charcoal,
  },
});
