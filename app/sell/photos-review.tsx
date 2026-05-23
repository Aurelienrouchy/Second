/**
 * Photos Review Screen
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Shows captured photos in a grid layout with:
 * - Cream header: back button (36px circle) + "Tes photos" title + count
 * - Photo grid: main (62%) + side column (38%), no border-radius
 * - PRINCIPALE badge on main photo (top-right, dark semi-transparent)
 * - Add photos: centered layout with dashed border + circle icon
 * - Tips: sage dots + 9px uppercase section title
 * - Footer: charcoal "ANALYSER AVEC L'IA" CTA + manual entry link
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';

import { colors, fonts, spacing, radius } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { createMockAIResult } from '@/services/aiService';

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_PHOTOS = 5;
const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 3;
const GRID_HEIGHT = 260;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PhotosReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const initialPhotos: string[] = params.photos
    ? JSON.parse(params.photos as string)
    : [];

  const [photos, setPhotos] = useState<string[]>(initialPhotos);

  const canAddMore = photos.length < MAX_PHOTOS;
  const remainingSlots = MAX_PHOTOS - photos.length;

  // =============================================================================
  // HANDLERS
  // =============================================================================

  const handleBack = () => {
    router.back();
  };

  const handleAddPhotos = async () => {
    if (!canAddMore) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: remainingSlots,
      });

      if (!result.canceled && result.assets.length > 0) {
        const uris = result.assets.map((asset) => asset.uri);
        setPhotos((prev) => {
          const remaining = MAX_PHOTOS - prev.length;
          return [...prev, ...uris.slice(0, remaining)];
        });
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking images:', error);
    }
  };

  const handleMakePrimary = useCallback((index: number) => {
    if (index === 0) return;
    setPhotos((prev) => {
      const newPhotos = [...prev];
      const [photo] = newPhotos.splice(index, 1);
      newPhotos.unshift(photo);
      return newPhotos;
    });
  }, []);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAnalyze = () => {
    router.push({
      pathname: '/sell/analysis',
      params: {
        photos: JSON.stringify(photos),
      },
    });
  };

  const handleManualEntry = () => {
    const mockResult = createMockAIResult();
    router.push({
      pathname: '/sell/details',
      params: {
        photos: JSON.stringify(photos),
        aiResult: JSON.stringify(mockResult),
        storageUrls: JSON.stringify([]),
      },
    });
  };

  // Grid layout: main image (62% width) + side column (38%)
  const mainWidth = (SCREEN_WIDTH - spacing.md * 2 - GRID_GAP) * 0.62;
  const sideWidth = SCREEN_WIDTH - spacing.md * 2 - GRID_GAP - mainWidth;
  const sideHeight = (GRID_HEIGHT - GRID_GAP) / 2;

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Tes photos"
        onBack={handleBack}
        rightContent={
          <Text style={styles.headerCount}>
            {photos.length} / {MAX_PHOTOS}
          </Text>
        }
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Photo grid */}
        {photos.length > 0 && (
          <View style={styles.gridContainer}>
            {/* Main photo */}
            <Pressable
              style={[styles.gridMain, { width: mainWidth, height: GRID_HEIGHT }]}
              onPress={() => handleMakePrimary(0)}
            >
              <Image
                source={{ uri: photos[0] }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
              />
              {/* Badge — top-right, matching mockup */}
              <View style={styles.primaryBadge}>
                <Text style={styles.primaryBadgeText}>PRINCIPALE</Text>
              </View>
              {/* Remove button */}
              <Pressable
                style={styles.gridRemove}
                onPress={() => handleRemovePhoto(0)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="close" size={12} color={colors.white} />
              </Pressable>
            </Pressable>

            {/* Side photos */}
            <View style={[styles.gridSide, { width: sideWidth }]}>
              {photos.slice(1, 3).map((uri, index) => (
                <Pressable
                  key={`side-${index}`}
                  style={[styles.gridSideItem, { height: sideHeight }]}
                  onPress={() => handleMakePrimary(index + 1)}
                >
                  <Image
                    source={{ uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                  <Pressable
                    style={styles.gridRemove}
                    onPress={() => handleRemovePhoto(index + 1)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="close" size={12} color={colors.white} />
                  </Pressable>
                </Pressable>
              ))}
              {/* Empty slot placeholder in side column */}
              {photos.length < 3 && (
                <Pressable
                  style={[styles.gridSideEmpty, { height: sideHeight }]}
                  onPress={handleAddPhotos}
                >
                  <Ionicons name="add" size={24} color={colors.muted} />
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Extra photos row (4th and 5th) */}
        {photos.length > 3 && (
          <View style={styles.extraRow}>
            {photos.slice(3).map((uri, index) => (
              <Pressable
                key={`extra-${index}`}
                style={styles.extraItem}
                onPress={() => handleMakePrimary(index + 3)}
              >
                <Image
                  source={{ uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
                <Pressable
                  style={styles.gridRemove}
                  onPress={() => handleRemovePhoto(index + 3)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close" size={12} color={colors.white} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}

        {/* Add photos button — centered layout matching mockup */}
        {canAddMore && (
          <Pressable style={styles.addButton} onPress={handleAddPhotos}>
            <View style={styles.addButtonIconCircle}>
              <Ionicons name="add" size={20} color={colors.muted} />
            </View>
            <Text style={styles.addButtonTitle}>Ajouter des photos</Text>
            <Text style={styles.addButtonSub}>
              {remainingSlots} emplacement{remainingSlots > 1 ? 's' : ''} restant
              {remainingSlots > 1 ? 's' : ''}
            </Text>
          </Pressable>
        )}

        {/* Tips section */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>CONSEILS POUR DE MEILLEURES PHOTOS</Text>
          <View style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.tipText}>Bonne luminosite, fond neutre</Text>
          </View>
          <View style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.tipText}>Montrer tous les details et defauts</Text>
          </View>
          <View style={styles.tipRow}>
            <View style={styles.tipDot} />
            <Text style={styles.tipText}>Photos claires, pas de reflets</Text>
          </View>
        </View>
      </ScrollView>

      {/* Sticky footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          style={[
            styles.analyzeButton,
            photos.length === 0 && styles.analyzeButtonDisabled,
          ]}
          onPress={handleAnalyze}
          disabled={photos.length === 0}
        >
          <Ionicons
            name="sparkles-outline"
            size={18}
            color={photos.length > 0 ? colors.cream : colors.muted}
          />
          <Text
            style={[
              styles.analyzeButtonText,
              photos.length === 0 && styles.analyzeButtonTextDisabled,
            ]}
          >
            ANALYSER AVEC L'IA
          </Text>
        </Pressable>

        <Pressable style={styles.manualLink} onPress={handleManualEntry}>
          <Text style={styles.manualLinkText}>ou remplir manuellement</Text>
        </Pressable>
      </View>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },

  headerCount: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },

  // Photo grid — no border-radius per mockup
  gridContainer: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: spacing.md,
  },
  gridMain: {
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  // Badge — top-right position matching HTML mockup
  primaryBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  primaryBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  gridRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridSide: {
    gap: GRID_GAP,
  },
  gridSideItem: {
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  gridSideEmpty: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },

  // Extra row for 4th-5th photos
  extraRow: {
    flexDirection: 'row',
    gap: GRID_GAP,
    marginBottom: spacing.md,
  },
  extraItem: {
    flex: 1,
    height: 100,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },

  // Add photos button — centered layout matching mockup
  addButton: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginBottom: spacing.lg,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  addButtonIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  addButtonTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: 4,
  },
  addButtonSub: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },

  // Tips
  tipsSection: {
    paddingTop: spacing.sm,
  },
  tipsTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  tipDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.sage,
    marginTop: 6,
  },
  tipText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.charcoal,
  },

  // Footer
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  analyzeButtonDisabled: {
    backgroundColor: colors.border,
  },
  analyzeButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  analyzeButtonTextDisabled: {
    color: colors.muted,
  },
  manualLink: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  manualLinkText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.72,
  },
});
