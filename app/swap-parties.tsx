/**
 * Swap Parties Screen — HTML UI Kit Design
 * "Liste des Swap Zones" — Very dark background with cream text,
 * sage filter tabs, and detailed zone cards with pulsing indicators
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Text as RNText,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useAuth } from '@/contexts/AuthContext';
import {
  getSwapParties,
  getActiveSwapParty,
  isParticipant,
} from '@/services/swapService';
import { SwapParty } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';

type FilterTab = 'all' | 'active' | 'upcoming' | 'my';

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { label: 'Toutes', value: 'all' },
  { label: 'En cours', value: 'active' },
  { label: 'À venir', value: 'upcoming' },
  { label: 'Mes zones', value: 'my' },
];


export default function SwapPartiesScreen() {
  const { user } = useAuth();
  const [allParties, setAllParties] = useState<SwapParty[]>([]);
  const [activeParty, setActiveParty] = useState<SwapParty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [participatingIds, setParticipatingIds] = useState<Set<string>>(
    new Set()
  );
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const loadParties = async () => {
    try {
      const [active, all] = await Promise.all([
        getActiveSwapParty(),
        getSwapParties(),
      ]);
      setActiveParty(active);
      setAllParties(all);

      if (user) {
        const participating = new Set<string>();
        for (const party of all) {
          const isJoined = await isParticipant(party.id, user.id);
          if (isJoined) participating.add(party.id);
        }
        setParticipatingIds(participating);
      }
    } catch (error) {
      console.error('Error loading parties:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadParties();
  }, [user]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadParties();
  };

  const handlePartyPress = (partyId: string) => {
    router.push(`/swap-party/${partyId}`);
  };

  const handleBackPress = () => {
    router.back();
  };

  const getFilteredParties = (): SwapParty[] => {
    switch (activeFilter) {
      case 'active':
        return allParties.filter((p) => p.status === 'active');
      case 'upcoming':
        return allParties.filter((p) => p.status === 'upcoming');
      case 'my':
        return allParties.filter((p) => participatingIds.has(p.id));
      case 'all':
      default:
        return allParties;
    }
  };

  const filteredParties = getFilteredParties();

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.cream} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBackPress}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color={colors.cream} />
        </TouchableOpacity>
        <RNText style={styles.headerTitle}>Swap Zones</RNText>
      </View>

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScrollView}
        contentContainerStyle={styles.filterContentContainer}
      >
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.value}
            style={[
              styles.filterTab,
              activeFilter === tab.value && styles.filterTabActive,
            ]}
            onPress={() => setActiveFilter(tab.value)}
            activeOpacity={0.8}
          >
            <RNText
              style={[
                styles.filterTabText,
                activeFilter === tab.value && styles.filterTabTextActive,
              ]}
            >
              {tab.label}
            </RNText>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content — Zone Cards List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.cream}
          />
        }
      >
        {filteredParties.length > 0 ? (
          <View style={styles.cardsContainer}>
            {filteredParties.map((zone, index) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                isEnrolled={participatingIds.has(zone.id)}
                onPress={() => handlePartyPress(zone.id)}
                opacity={
                  zone.status === 'active'
                    ? 1
                    : zone.status === 'upcoming'
                      ? 0.9
                      : 0.6
                }
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <RNText style={styles.emptyStateText}>
              Aucune Swap Zone disponible pour ce filtre
            </RNText>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// Zone Card Component
// ============================================================================

interface ZoneCardProps {
  zone: SwapParty;
  isEnrolled: boolean;
  onPress: () => void;
  opacity?: number;
}

function ZoneCard({ zone, isEnrolled, onPress, opacity = 1 }: ZoneCardProps) {
  const isActive = zone.status === 'active';
  const isUpcoming = zone.status === 'upcoming';

  // Pulse animation for active zone dot
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (isActive) {
      pulseOpacity.value = withRepeat(
        withTiming(0.5, {
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true
      );
    }
  }, [isActive, pulseOpacity]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value,
  }));

  const now = new Date();
  const daysRemaining = zone.endDate
    ? Math.max(0, Math.ceil((new Date(zone.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const startDate = zone.startDate
    ? new Date(zone.startDate).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
      })
    : '';

  return (
    <Animated.View style={{ opacity }}>
      {isActive ? (
        // Active Zone Card with gradient
        <LinearGradient
          colors={['#1A2415', '#222E1A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.activeCard}
        >
          {/* Top Row: Status Badge + Enrolled Badge */}
          <View style={styles.cardTopRow}>
            <View style={styles.statusBadge}>
              <Animated.View
                style={[styles.pulseDot, pulseStyle]}
              />
              <RNText style={styles.statusText}>
                En cours · J-{daysRemaining}
              </RNText>
            </View>
            {isEnrolled && (
              <View style={styles.enrolledBadge}>
                <RNText style={styles.enrolledText}>Inscrit ✓</RNText>
              </View>
            )}
          </View>

          {/* Title */}
          <RNText style={styles.cardTitle}>{zone.name}</RNText>

          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statColumn}>
              <RNText style={styles.statNumber}>
                {zone.participantsCount}
              </RNText>
              <RNText style={styles.statLabel}>Membres</RNText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statColumn}>
              <RNText style={styles.statNumber}>
                {zone.itemsCount}
              </RNText>
              <RNText style={styles.statLabel}>Articles</RNText>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statColumn}>
              <RNText style={styles.statNumber}>
                {daysRemaining}j
              </RNText>
              <RNText style={styles.statLabel}>Restants</RNText>
            </View>
          </View>

          {/* CTA Button */}
          <TouchableOpacity
            style={styles.activeCardButton}
            onPress={onPress}
            activeOpacity={0.7}
          >
            <RNText style={styles.activeCardButtonText}>
              Entrer dans la zone →
            </RNText>
          </TouchableOpacity>
        </LinearGradient>
      ) : isUpcoming ? (
        // Upcoming Zone Card
        <View style={styles.upcomingCard}>
          {/* Status Badge */}
          <View style={styles.upcomingStatusBadge}>
            <View style={styles.rustDot} />
            <RNText style={styles.upcomingStatusText}>
              Démarre {startDate}
            </RNText>
          </View>

          {/* Title */}
          <RNText style={styles.cardTitle}>{zone.name}</RNText>

          {/* Description */}
          <RNText style={styles.upcomingDescription}>
            {zone.description}
          </RNText>

          {/* Two Buttons Side by Side */}
          <View style={styles.upcomingButtonsRow}>
            <TouchableOpacity
              style={styles.upcomingSignupButton}
              onPress={onPress}
              activeOpacity={0.7}
            >
              <RNText style={styles.upcomingSignupText}>S'inscrire</RNText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.upcomingPreviewButton}
              onPress={onPress}
              activeOpacity={0.7}
            >
              <RNText style={styles.upcomingPreviewText}>Aperçu</RNText>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        // Future Zone Card
        <View style={styles.futureCard}>
          {/* Status Badge */}
          <View style={styles.futureStatusBadge}>
            <View style={styles.futureDot} />
            <RNText style={styles.futureStatusText}>
              Démarre {startDate}
            </RNText>
          </View>

          {/* Title */}
          <RNText style={styles.futureCardTitle}>{zone.name}</RNText>

          {/* Description */}
          <RNText style={styles.futureDescription}>
            {zone.description}
          </RNText>
        </View>
      )}
    </Animated.View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#131510',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
    backgroundColor: '#131510',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: '300',
    color: colors.cream,
  },
  filterScrollView: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    backgroundColor: '#131510',
  },
  filterContentContainer: {
    gap: 8,
    paddingBottom: spacing.lg,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterTabActive: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  filterTabText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.88,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#131510',
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing['2xl'],
  },
  cardsContainer: {
    gap: 10,
  },

  // ========== ACTIVE ZONE CARD ==========
  activeCard: {
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
    padding: 18,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sage,
  },
  statusText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: colors.sage,
    textTransform: 'uppercase',
  },
  enrolledBadge: {
    backgroundColor: 'rgba(122, 140, 110, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.3)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  enrolledText: {
    fontFamily: fonts.sans,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: colors.sage,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '300',
    color: colors.cream,
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  statColumn: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '400',
    color: colors.cream,
    marginBottom: 2,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(245, 240, 232, 0.35)',
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  activeCardButton: {
    backgroundColor: colors.sage,
    borderRadius: 9,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCardButtonText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },

  // ========== UPCOMING ZONE CARD ==========
  upcomingCard: {
    backgroundColor: 'rgba(245, 240, 232, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.07)',
    borderRadius: 0,
    padding: 18,
  },
  upcomingStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  rustDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.rust,
  },
  upcomingStatusText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: colors.rust,
    textTransform: 'uppercase',
  },
  upcomingDescription: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: 'rgba(245, 240, 232, 0.35)',
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  upcomingButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  upcomingSignupButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.35)',
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingSignupText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    color: colors.rust,
    textTransform: 'uppercase',
  },
  upcomingPreviewButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingPreviewText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.1,
    color: 'rgba(255, 255, 255, 0.4)',
    textTransform: 'uppercase',
  },

  // ========== FUTURE ZONE CARD ==========
  futureCard: {
    backgroundColor: 'rgba(245, 240, 232, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(245, 240, 232, 0.05)',
    borderRadius: 0,
    padding: 18,
  },
  futureStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  futureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  futureStatusText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: 'rgba(255, 255, 255, 0.25)',
    textTransform: 'uppercase',
  },
  futureCardTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '300',
    color: 'rgba(245, 240, 232, 0.55)',
    marginBottom: spacing.md,
  },
  futureDescription: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: 'rgba(245, 240, 232, 0.25)',
    lineHeight: 18,
  },

  // ========== EMPTY STATE ==========
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
  },
  emptyStateText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.cream,
    textAlign: 'center',
  },
});
