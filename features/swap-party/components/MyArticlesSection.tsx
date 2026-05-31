/**
 * MyArticlesSection Component — Swap Zone (DARK identity)
 * Shows the user's deposited articles with add/remove actions. Always available
 * to an authenticated user (the zone is open to all — no join gate).
 *
 * EMPTY state: a full-width tappable drop zone (the only CTA).
 * POPULATED state: a horizontal rail of portrait photo tiles so the user
 * recognizes their garments instantly, ending in a "+" add tile.
 */

import React from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { MyArticlesSectionProps } from '../types';

// Portrait 4/5 tile footprint (128 / 160 = 0.8). Fixed named consts rather than
// aspectRatio because rail children are not flex-driven and need a deterministic
// footprint. The leading "+" tile carries no fixed height: the rail stretches it
// to the cards' height (alignItems: 'stretch'), staying flush without a magic value.
const TILE_W = 128;
const IMG_H = 160;

export const MyArticlesSection = React.memo(function MyArticlesSection({
  userItems,
  onAddPress,
  onRemoveItem,
}: MyArticlesSectionProps) {
  const hasItems = userItems.length > 0;

  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {hasItems ? `Mes pièces · ${userItems.length}` : 'Mes pièces'}
        </Text>
      </View>

      {hasItems ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {/* Add tile leads the rail so the deposit action is always the
              first thing in view (no horizontal scroll needed to reach it). */}
          <Pressable
            style={({ pressed }) => [styles.addTile, pressed && styles.pressed]}
            onPress={onAddPress}
          >
            <Ionicons name="add" size={sizing.iconMD} color={colors.sand} />
            <Text style={styles.addTileLabel}>Déposer</Text>
          </Pressable>

          {userItems.map((item) => (
            <Animated.View
              key={item.id}
              style={styles.tileCard}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(160)}
              layout={LinearTransition.duration(220)}
            >
              <View style={styles.tileImageWrap}>
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.tileImage}
                  recyclingKey={item.id}
                  contentFit="cover"
                />
                <Pressable
                  style={({ pressed }) => [styles.removeTile, pressed && styles.pressed]}
                  onPress={() => onRemoveItem(item.articleId)}
                  hitSlop={8}
                >
                  <Ionicons name="close" size={sizing.iconSM} color={colors.cream} />
                </Pressable>
              </View>

              <View style={styles.tileInfo}>
                <Text style={styles.tileBrand} numberOfLines={1}>
                  {item.brand || 'MARQUE'}
                </Text>
                <Text style={styles.tileTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <View style={styles.tileFooter}>
                  <Text style={styles.tilePrice}>{formatPrice(item.price)}</Text>
                  {item.size?.value ? (
                    <Text style={styles.tileSize}>{item.size.value}</Text>
                  ) : null}
                </View>
              </View>
            </Animated.View>
          ))}
        </ScrollView>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.dropZone, pressed && styles.pressed]}
          onPress={onAddPress}
        >
          <View style={styles.dropZonePlus}>
            <Ionicons name="add" size={sizing.iconMD} color={colors.sand} />
          </View>
          <Text style={styles.dropZoneLabel}>Déposer un article</Text>
          <Text style={styles.dropZoneHint}>Ajoutez vos pièces à échanger</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.darkSurface1,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorderStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sand,
  },
  // ── EMPTY drop zone ──
  dropZone: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.darkSurface2,
    borderWidth: 1,
    borderColor: colors.darkBorderStrong,
    borderRadius: radius.none,
  },
  dropZonePlus: {
    width: sizing.avatarMD,
    height: sizing.avatarMD,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.darkSurface1,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.none,
  },
  dropZoneLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.cream,
  },
  dropZoneHint: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.whiteTranslucent,
  },
  // ── POPULATED rail ──
  rail: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    // Stretch so the leading "+" add tile matches the cards' height (no magic const).
    alignItems: 'stretch',
  },
  // Card surface + full hairline frame, echoing productCardDark from PartyItemCard.
  tileCard: {
    width: TILE_W,
    backgroundColor: colors.darkSurface1,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.none,
    overflow: 'hidden',
  },
  // Image fills the card width (minus hairlines); the card owns the frame now.
  tileImageWrap: {
    position: 'relative',
    width: '100%',
    height: IMG_H,
    backgroundColor: colors.darkSurface2,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  removeTile: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: sizing.iconMD,
    height: sizing.iconMD,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radius.full,
  },
  // Left-aligned info block, mirroring PartyItemCard productInfo (compacted).
  tileInfo: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs + 2,
    paddingBottom: spacing.sm,
  },
  tileBrand: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: colors.sand,
    marginBottom: 2,
  },
  tileTitle: {
    fontFamily: fonts.display,
    fontSize: 14,
    lineHeight: 17,
    color: colors.cream,
    marginBottom: spacing.xs,
  },
  tileFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tilePrice: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: colors.sand,
  },
  tileSize: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.whiteTranslucent,
  },
  // Empty "deposit" slot mirroring the card silhouette (deep panel, no faked product).
  addTile: {
    width: TILE_W,
    height: ADD_TILE_H,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.darkSurface2,
    borderWidth: 1,
    borderColor: colors.darkBorderStrong,
    borderRadius: radius.none,
  },
  addTileLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.sand,
  },
});
