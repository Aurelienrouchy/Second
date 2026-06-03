import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { FlashList } from '@shopify/flash-list';

import {
  getPopularSpotsForNeighborhood,
  MONTREAL_NEIGHBORHOODS,
  searchNeighborhoods,
} from '@/data/neighborhoods';
import { MeetupNeighborhood, MeetupSpot, MeetupSpotCategory, MeetupSpotCategoryLabels } from '@/types';

import { getNextStep, MakeOfferContext } from './types';
import { colors, fonts, radius, spacing } from '@/constants/theme';

interface LocationStepProps {
  context: MakeOfferContext;
}

type LocationSubStep = 'neighborhood' | 'spot';

const LocationStep: React.FC<LocationStepProps> = ({ context }) => {
  const { state, actions, sellerNeighborhood, sellerPreferredSpots } = context;
  const [subStep, setSubStep] = useState<LocationSubStep>('neighborhood');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCustomSpot, setShowCustomSpot] = useState(false);
  const [customCategory, setCustomCategory] = useState<MeetupSpotCategory>('cafe');

  // Filter neighborhoods based on search
  const filteredNeighborhoods = useMemo(() => {
    if (searchQuery.trim()) {
      return searchNeighborhoods(searchQuery);
    }
    return MONTREAL_NEIGHBORHOODS;
  }, [searchQuery]);

  // Get spots for selected neighborhood
  const availableSpots = useMemo(() => {
    if (!state.selectedNeighborhood) return [];

    // If seller has preferred spots in this neighborhood, show those first
    const sellerSpots = sellerPreferredSpots?.filter(
      (spot) => spot.neighborhood.id === state.selectedNeighborhood?.id
    ) || [];

    const popularSpots = getPopularSpotsForNeighborhood(state.selectedNeighborhood.id);

    // Combine and deduplicate
    const allSpots = [...sellerSpots, ...popularSpots];
    const uniqueSpots = allSpots.filter(
      (spot, index, self) => self.findIndex((s) => s.name === spot.name) === index
    );

    return uniqueSpots;
  }, [state.selectedNeighborhood, sellerPreferredSpots]);

  const handleNeighborhoodSelect = (neighborhood: MeetupNeighborhood) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    actions.setSelectedNeighborhood(neighborhood);
    setSubStep('spot');
    setSearchQuery('');
  };

  const handleSpotSelect = (spot: MeetupSpot) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    actions.setSelectedSpot(spot);
    actions.setStep(getNextStep(state.step, state.mode));
  };

  const handleCustomSpotSubmit = () => {
    if (!state.customSpotName.trim() || !state.selectedNeighborhood) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const customSpot: MeetupSpot = {
      name: state.customSpotName.trim(),
      category: customCategory,
      neighborhood: state.selectedNeighborhood,
      isUserSuggested: true,
    };

    actions.setSelectedSpot(customSpot);
    actions.setStep(getNextStep(state.step, state.mode));
  };

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (showCustomSpot) {
      setShowCustomSpot(false);
    } else if (subStep === 'spot') {
      setSubStep('neighborhood');
      actions.setSelectedNeighborhood(null);
    }
  };

  const renderNeighborhoodItem = ({ item }: { item: MeetupNeighborhood }) => (
    <Pressable
      testID={`offer-location-item-${item.id}`}
      style={[
        styles.listItem,
        sellerNeighborhood?.id === item.id && styles.sellerRecommended,
      ]}
      onPress={() => handleNeighborhoodSelect(item)}
    >
      <View style={styles.listItemContent}>
        <Text style={styles.listItemTitle}>{item.name}</Text>
        <Text style={styles.listItemSubtitle}>{item.borough}</Text>
      </View>
      {sellerNeighborhood?.id === item.id && (
        <View style={styles.recommendedBadge}>
          <Text style={styles.recommendedText}>RECOMMANDÉ</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={20} color={colors.muted} />
    </Pressable>
  );

  const renderSpotItem = ({ item }: { item: MeetupSpot }) => {
    const isSellerSpot = sellerPreferredSpots?.some((s) => s.name === item.name);
    const categoryColor = item.category === 'cafe' || item.category === 'park' ? colors.sageLight : colors.primaryLight;

    return (
      <Pressable
        testID={`offer-location-item-${item.id ?? item.name}`}
        style={[styles.listItem, isSellerSpot && styles.sellerRecommended]}
        onPress={() => handleSpotSelect(item)}
      >
        <View style={[styles.spotIcon, { backgroundColor: categoryColor }]}>
          <Ionicons
            name={getCategoryIcon(item.category)}
            size={20}
            color={colors.sage}
          />
        </View>
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{item.name}</Text>
          <Text style={styles.listItemSubtitle}>
            {MeetupSpotCategoryLabels[item.category]}
          </Text>
          {item.address && (
            <Text style={styles.addressText}>{item.address}</Text>
          )}
        </View>
        {isSellerSpot && (
          <View style={styles.suggestedBadge}>
            <Text style={styles.suggestedText}>SUGGÉRÉ</Text>
          </View>
        )}
      </Pressable>
    );
  };

  const getCategoryIcon = (category: MeetupSpotCategory): keyof typeof Ionicons.glyphMap => {
    switch (category) {
      case 'cafe':
        return 'cafe';
      case 'metro':
        return 'subway';
      case 'library':
        return 'library';
      case 'mall':
        return 'cart';
      case 'park':
        return 'leaf';
      case 'community_center':
        return 'people';
      default:
        return 'location';
    }
  };

  if (subStep === 'neighborhood') {
    return (
      <View style={styles.container}>
        <Text style={styles.stepTitle}>Où voulez-vous vous rencontrer?</Text>

        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <BottomSheetTextInput
            style={styles.searchInput}
            placeholder="Rechercher un quartier..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={colors.muted}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>

        {sellerNeighborhood && !searchQuery && (
          <View style={styles.sellerZoneSection}>
            <Text style={styles.sectionTitle}>ZONE DU VENDEUR</Text>
            <Pressable
              testID={`offer-location-item-${sellerNeighborhood.id}`}
              style={[styles.listItem, styles.sellerRecommended]}
              onPress={() => handleNeighborhoodSelect(sellerNeighborhood)}
            >
              <View style={styles.listItemContent}>
                <Text style={styles.listItemTitle}>{sellerNeighborhood.name}</Text>
                <Text style={styles.listItemSubtitle}>{sellerNeighborhood.borough}</Text>
              </View>
              <View style={styles.recommendedBadge}>
                <Text style={styles.recommendedText}>RECOMMANDÉ</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>
          {searchQuery ? 'RÉSULTATS' : 'TOUS LES QUARTIERS'}
        </Text>

        <FlashList
          data={filteredNeighborhoods}
          renderItem={renderNeighborhoodItem}
          keyExtractor={(item) => item.id}
          // @ts-expect-error estimatedItemSize valid at runtime
          estimatedItemSize={60}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Aucun quartier trouvé</Text>
          }
        />
      </View>
    );
  }

  if (showCustomSpot) {
    return (
      <View style={styles.container}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={18} color={colors.rust} />
          <Text style={styles.backText}>Retour</Text>
        </Pressable>

        <Text style={styles.stepTitle}>Proposer un lieu</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>NOM DU LIEU</Text>
          <BottomSheetTextInput
            style={styles.textInput}
            placeholder="Ex: Café Olimpico, Station Laurier..."
            value={state.customSpotName}
            onChangeText={actions.setCustomSpotName}
            placeholderTextColor={colors.muted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>TYPE DE LIEU</Text>
          <View style={styles.categoryGrid}>
            {(Object.keys(MeetupSpotCategoryLabels) as MeetupSpotCategory[]).map(
              (category) => (
                <Pressable
                  key={category}
                  style={[
                    styles.categoryButton,
                    customCategory === category && styles.categoryButtonActive,
                  ]}
                  onPress={() => setCustomCategory(category)}
                >
                  <Ionicons
                    name={getCategoryIcon(category)}
                    size={18}
                    color={customCategory === category ? colors.white : colors.rust}
                  />
                  <Text
                    style={[
                      styles.categoryButtonText,
                      customCategory === category && styles.categoryButtonTextActive,
                    ]}
                  >
                    {MeetupSpotCategoryLabels[category]}
                  </Text>
                </Pressable>
              )
            )}
          </View>
        </View>

        <Pressable
          testID="offer-location-continue"
          style={[
            styles.submitButton,
            !state.customSpotName.trim() && styles.submitButtonDisabled,
          ]}
          onPress={handleCustomSpotSubmit}
          disabled={!state.customSpotName.trim()}
        >
          <Text style={styles.submitButtonText}>Continuer</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable style={styles.backButton} onPress={handleBack}>
        <Ionicons name="arrow-back" size={18} color={colors.rust} />
        <Text style={styles.backText}>Changer de quartier</Text>
      </Pressable>

      <Text style={styles.stepTitle}>{state.selectedNeighborhood?.name}</Text>

      {availableSpots.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>LIEUX POPULAIRES</Text>
          <FlashList
            data={availableSpots}
            renderItem={renderSpotItem}
            keyExtractor={(item, index) => `${item.name}-${index}`}
            // @ts-expect-error estimatedItemSize valid at runtime
            estimatedItemSize={60}
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        <Text style={styles.emptyText}>
          Aucun lieu populaire dans ce quartier
        </Text>
      )}

      <Pressable
        style={styles.customSpotButton}
        onPress={() => setShowCustomSpot(true)}
      >
        <Ionicons name="add" size={20} color={colors.rust} />
        <Text style={styles.customSpotText}>Proposer un autre lieu</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 18,
    fontFamily: fonts.displayMedium,
    color: colors.charcoal,
    marginBottom: spacing.lg,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.sans,
    color: colors.charcoal,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
    textTransform: 'uppercase',
  },
  sellerZoneSection: {
    marginBottom: spacing.md,
  },
  list: {
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sellerRecommended: {
    borderColor: colors.sage,
    backgroundColor: colors.sageLight,
  },
  spotIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  listItemSubtitle: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
  addressText: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  recommendedBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    marginRight: spacing.sm,
  },
  recommendedText: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    color: colors.sage,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  suggestedBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    marginRight: spacing.sm,
  },
  suggestedText: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    color: colors.rust,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  emptyText: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  backText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: colors.rust,
    marginLeft: spacing.xs,
  },
  customSpotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  customSpotText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: colors.rust,
    marginLeft: spacing.xs,
  },
  inputGroup: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    marginBottom: spacing.sm,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    fontFamily: fonts.sans,
    color: colors.charcoal,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    gap: spacing.xs,
  },
  categoryButtonActive: {
    backgroundColor: colors.rust,
  },
  categoryButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: colors.rust,
  },
  categoryButtonTextActive: {
    color: colors.white,
  },
  submitButton: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    color: colors.cream,
    letterSpacing: 2.16,
    textTransform: 'uppercase',
  },
});

export default LocationStep;
