/**
 * MyArticlesSection Component
 * Shows the user's articles in the swap party with add/remove actions
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { MyArticlesSectionProps } from '../types';

export const MyArticlesSection = React.memo(function MyArticlesSection({
  userItems,
  onAddPress,
  onRemoveItem,
}: MyArticlesSectionProps) {
  // Swap Zone is always active — articles can always be added/removed.
  return (
    <View style={styles.myArticleSection}>
      <View style={styles.myArticleLabelRow}>
        <Text style={styles.myArticleLabel}>
          {"Mes articles à l'échange · "}{userItems.length}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.addArticleButton, pressed && { opacity: 0.7 }]}
          onPress={onAddPress}
        >
          <Ionicons name="add" size={16} color={colors.sage} />
          <Text style={styles.addArticleButtonText}>Ajouter</Text>
        </Pressable>
      </View>

      {userItems.length > 0 ? (
        <View style={styles.myArticlesList}>
          {userItems.map((item) => (
            <View key={item.id} style={styles.myArticleRow}>
              <Image
                source={{ uri: item.imageUrl }}
                style={styles.myArticleImage}
              />
              <View style={styles.myArticleContent}>
                <Text style={styles.myArticleBrand}>
                  {item.brand || 'BRAND'}
                </Text>
                <Text style={styles.myArticleTitle}>
                  {item.title}
                </Text>
                <Text style={styles.myArticleStatus}>
                  Disponible au swap
                </Text>
              </View>
              <View style={styles.myArticleValue}>
                <Text style={styles.myArticleValueLabel}>Valeur</Text>
                <Text style={styles.myArticlePrice}>
                  {formatPrice(item.price)}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.removeItemButton, pressed && { opacity: 0.7 }]}
                onPress={() => onRemoveItem(item.articleId)}
              >
                <Ionicons name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.myArticleEmpty, pressed && { opacity: 0.7 }]}
          onPress={onAddPress}
        >
          <Ionicons name="add-circle-outline" size={24} color={colors.sage} />
          <Text style={styles.myArticleEmptyText}>
            Ajouter des articles à échanger
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  myArticleSection: {
    backgroundColor: 'rgba(122, 140, 110, 0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(122, 140, 110, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  myArticleLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  myArticleLabel: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sage,
  },
  addArticleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.3)',
    borderRadius: 2,
  },
  addArticleButtonText: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.sage,
  },
  myArticlesList: {
    gap: 8,
  },
  myArticleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  myArticleImage: {
    width: 48,
    height: 60,
    backgroundColor: colors.background,
    borderRadius: 0,
  },
  myArticleContent: {
    flex: 1,
  },
  myArticleBrand: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  myArticleTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: '400',
    color: colors.charcoal,
    marginBottom: 6,
  },
  myArticleStatus: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.sage,
  },
  myArticleValue: {
    alignItems: 'flex-end',
  },
  myArticleValueLabel: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
  myArticlePrice: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '400',
    color: colors.charcoal,
  },
  myArticleEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  myArticleEmptyText: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
  removeItemButton: {
    padding: 4,
    marginLeft: 4,
  },
});
