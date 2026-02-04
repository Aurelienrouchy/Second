import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  getPopularSpotsForNeighborhood,
  MONTREAL_NEIGHBORHOODS,
  NEIGHBORHOODS_BY_BOROUGH,
  searchNeighborhoods,
} from '@/data/neighborhoods';
import { MeetupNeighborhood, MeetupSpot, MeetupSpotCategory, MeetupSpotCategoryLabels } from '@/types';

import { getNextStep, MakeOfferContext } from './types';

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
    actions.setStep(getNextStep(state.step));
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
    actions.setStep(getNextStep(state.step));
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
          <Text style={styles.recommendedText}>Zone du vendeur</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
    </Pressable>
  );

  const renderSpotItem = ({ item }: { item: MeetupSpot }) => {
    const isSellerSpot = sellerPreferredSpots?.some((s) => s.name === item.name);

    return (
      <Pressable
        style={[styles.listItem, isSellerSpot && styles.sellerRecommended]}
        onPress={() => handleSpotSelect(item)}
      >
        <View style={styles.spotIcon}>
          <Ionicons
            name={getCategoryIcon(item.category)}
            size={24}
            color="#007AFF"
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
          <View style={styles.recommendedBadge}>
            <Text style={styles.recommendedText}>Suggéré</Text>
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

  // Render neighborhood selection
  if (subStep === 'neighborhood') {
    return (
      <View style={styles.container}>
        <Text style={styles.stepTitle}>Où voulez-vous vous rencontrer?</Text>
        <Text style={styles.stepSubtitle}>
          Choisissez un quartier pour le point de rencontre
        </Text>

        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color="#8E8E93" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un quartier..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#8E8E93"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#8E8E93" />
            </Pressable>
          )}
        </View>

        {sellerNeighborhood && !searchQuery && (
          <View style={styles.sellerZoneSection}>
            <Text style={styles.sectionTitle}>Zone du vendeur</Text>
            <Pressable
              style={[styles.listItem, styles.sellerRecommended]}
              onPress={() => handleNeighborhoodSelect(sellerNeighborhood)}
            >
              <View style={styles.listItemContent}>
                <Text style={styles.listItemTitle}>{sellerNeighborhood.name}</Text>
                <Text style={styles.listItemSubtitle}>{sellerNeighborhood.borough}</Text>
              </View>
              <View style={styles.recommendedBadge}>
                <Text style={styles.recommendedText}>Recommandé</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#C7C7CC" />
            </Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>
          {searchQuery ? 'Résultats' : 'Tous les quartiers'}
        </Text>

        <FlatList
          data={filteredNeighborhoods}
          renderItem={renderNeighborhoodItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Aucun quartier trouvé</Text>
          }
        />
      </View>
    );
  }

  // Render spot selection
  if (showCustomSpot) {
    return (
      <View style={styles.container}>
        <Pressable style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
          <Text style={styles.backText}>Retour</Text>
        </Pressable>

        <Text style={styles.stepTitle}>Proposer un lieu</Text>
        <Text style={styles.stepSubtitle}>
          Décrivez le lieu public de rencontre
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Nom du lieu</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Ex: Café Olimpico, Station Laurier..."
            value={state.customSpotName}
            onChangeText={actions.setCustomSpotName}
            placeholderTextColor="#8E8E93"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Type de lieu</Text>
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
                    size={20}
                    color={customCategory === category ? '#FFFFFF' : '#007AFF'}
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
        <Ionicons name="arrow-back" size={24} color="#007AFF" />
        <Text style={styles.backText}>Changer de quartier</Text>
      </Pressable>

      <Text style={styles.stepTitle}>{state.selectedNeighborhood?.name}</Text>
      <Text style={styles.stepSubtitle}>
        Choisissez un lieu de rencontre
      </Text>

      {availableSpots.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Lieux populaires</Text>
          <FlatList
            data={availableSpots}
            renderItem={renderSpotItem}
            keyExtractor={(item, index) => `${item.name}-${index}`}
            style={styles.list}
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
        <Ionicons name="add-circle-outline" size={24} color="#007AFF" />
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
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 24,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 24,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1C1C1E',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    marginBottom: 12,
    marginTop: 8,
  },
  sellerZoneSection: {
    marginBottom: 16,
  },
  list: {
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  sellerRecommended: {
    borderColor: '#34C759',
    backgroundColor: '#F0FFF4',
  },
  spotIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E8F4FD',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 2,
  },
  listItemSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
  },
  addressText: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 4,
  },
  recommendedBadge: {
    backgroundColor: '#34C759',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
  },
  recommendedText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyText: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 8,
  },
  customSpotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  customSpotText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginLeft: 8,
  },
  inputGroup: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1C1C1E',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#E8F4FD',
    gap: 6,
  },
  categoryButtonActive: {
    backgroundColor: '#007AFF',
  },
  categoryButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  categoryButtonTextActive: {
    color: '#FFFFFF',
  },
  submitButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  submitButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default LocationStep;
