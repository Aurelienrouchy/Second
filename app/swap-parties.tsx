/**
 * Swap Parties Screen
 * Design System: Luxe Français + Street Energy
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useAuth } from '@/contexts/AuthContext';
import {
  getSwapParties,
  getActiveSwapParty,
  isParticipant,
} from '@/services/swapService';
import { SwapParty } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Label } from '@/components/ui';

export default function SwapPartiesScreen() {
  const { user } = useAuth();
  const [activeParty, setActiveParty] = useState<SwapParty | null>(null);
  const [upcomingParties, setUpcomingParties] = useState<SwapParty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [participatingIds, setParticipatingIds] = useState<Set<string>>(new Set());

  const loadParties = async () => {
    try {
      const [active, all] = await Promise.all([
        getActiveSwapParty(),
        getSwapParties(),
      ]);

      setActiveParty(active);
      setUpcomingParties(all.filter((p) => p.status === 'upcoming'));

      if (user) {
        const participating = new Set<string>();
        for (const party of all) {
          const isJoined = await isParticipant(party.id, user.id);
          if (isJoined) {
            participating.add(party.id);
          }
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

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen
          options={{
            title: 'Swap Zone',
            headerBackTitle: 'Retour',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Swap Zone',
          headerBackTitle: 'Retour',
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Introduction */}
        <View style={styles.introSection}>
          <Text variant="h2" style={styles.introTitle}>Échangez vos pièces</Text>
          <Text variant="bodySmall" style={styles.introText}>
            Participez à nos Swap Parties hebdomadaires pour échanger vos
            vêtements avec d'autres membres. Gratuit, écologique et fun !
          </Text>
        </View>

        {/* Active Party */}
        {activeParty && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Label style={styles.sectionLabel}>En cours</Label>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text variant="caption" style={styles.liveText}>LIVE</Text>
              </View>
            </View>
            <ActivePartyCard
              party={activeParty}
              isParticipating={participatingIds.has(activeParty.id)}
              onPress={() => handlePartyPress(activeParty.id)}
            />
          </View>
        )}

        {/* Upcoming Parties */}
        {upcomingParties.length > 0 && (
          <View style={styles.section}>
            <Label style={styles.sectionLabel}>À venir</Label>
            {upcomingParties.map((party) => (
              <UpcomingPartyCard
                key={party.id}
                party={party}
                isParticipating={participatingIds.has(party.id)}
                onPress={() => handlePartyPress(party.id)}
              />
            ))}
          </View>
        )}

        {/* How it works */}
        <View style={styles.section}>
          <Label style={styles.sectionLabel}>Comment ça marche ?</Label>
          <View style={styles.howItWorksCard}>
            <HowItWorksStep
              number={1}
              icon="enter-outline"
              title="Inscrivez-vous"
              description="Rejoignez une Swap Party et ajoutez vos articles"
            />
            <HowItWorksStep
              number={2}
              icon="search-outline"
              title="Parcourez"
              description="Découvrez les articles des autres participants"
            />
            <HowItWorksStep
              number={3}
              icon="swap-horizontal"
              title="Proposez"
              description="Faites une offre d'échange (±20% de valeur suggéré)"
            />
            <HowItWorksStep
              number={4}
              icon="camera-outline"
              title="Validez"
              description="Photos obligatoires, puis envoyez-vous les articles"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Active Party Card
 */
function ActivePartyCard({
  party,
  isParticipating,
  onPress,
}: {
  party: SwapParty;
  isParticipating: boolean;
  onPress: () => void;
}) {
  const formatDateRange = (startDate?: Date, endDate?: Date) => {
    if (!startDate || !endDate) return '';

    const formatDate = (d: Date) => {
      return d.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return `Du ${formatDate(startDate)} au ${formatDate(endDate)}`;
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
      <LinearGradient
        colors={[colors.primary, '#1a4fd4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.activeCard}
      >
        <View style={styles.cardContent}>
          <Text style={styles.partyEmoji}>{party.emoji}</Text>
          <Text variant="h3" style={styles.partyName}>{party.name}</Text>
          {party.description && (
            <Text variant="bodySmall" style={styles.partyDescription} numberOfLines={2}>
              {party.description}
            </Text>
          )}

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Ionicons name="people" size={16} color={colors.white} />
              <Text variant="body" style={styles.statText}>{party.participantsCount || 0}</Text>
            </View>
            <View style={styles.stat}>
              <Ionicons name="shirt" size={16} color={colors.white} />
              <Text variant="body" style={styles.statText}>{party.itemsCount || 0}</Text>
            </View>
            <View style={styles.stat}>
              <Ionicons name="swap-horizontal" size={16} color={colors.white} />
              <Text variant="body" style={styles.statText}>{party.swapsCount || 0}</Text>
            </View>
          </View>

          <View style={styles.countdownRow}>
            <Ionicons name="calendar-outline" size={16} color={colors.white} />
            <Caption style={styles.countdownText}>
              {formatDateRange(party.startDate, party.endDate)}
            </Caption>
          </View>

          <View style={styles.ctaRow}>
            <View
              style={[
                styles.ctaButton,
                isParticipating && styles.ctaButtonParticipating,
              ]}
            >
              {isParticipating ? (
                <>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <Text variant="body" style={styles.ctaTextParticipating}>
                    Inscrit(e)
                  </Text>
                </>
              ) : (
                <>
                  <Text variant="body" style={styles.ctaText}>Participer</Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.primary} />
                </>
              )}
            </View>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

/**
 * Upcoming Party Card
 */
function UpcomingPartyCard({
  party,
  isParticipating,
  onPress,
}: {
  party: SwapParty;
  isParticipating: boolean;
  onPress: () => void;
}) {
  const formatDateRange = (startDate?: Date, endDate?: Date) => {
    if (!startDate || !endDate) return '';

    const formatDate = (d: Date) => {
      return d.toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return `${formatDate(startDate)} → ${formatDate(endDate)}`;
  };

  return (
    <TouchableOpacity
      style={styles.upcomingCard}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.upcomingLeft}>
        <Text style={styles.upcomingEmoji}>{party.emoji}</Text>
      </View>

      <View style={styles.upcomingContent}>
        <View style={styles.upcomingHeader}>
          <Text variant="body" style={styles.upcomingName}>{party.name}</Text>
          {isParticipating && (
            <View style={styles.participatingBadge}>
              <Ionicons name="checkmark" size={12} color={colors.success} />
            </View>
          )}
        </View>

        <Caption style={styles.upcomingDate}>
          {formatDateRange(party.startDate, party.endDate)}
        </Caption>
      </View>

      <View style={styles.upcomingRight}>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </View>
    </TouchableOpacity>
  );
}

/**
 * How it Works Step
 */
function HowItWorksStep({
  number,
  icon,
  title,
  description,
}: {
  number: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepNumber}>
        <Text variant="caption" style={styles.stepNumberText}>{number}</Text>
      </View>
      <View style={styles.stepIconContainer}>
        <Ionicons name={icon} size={24} color={colors.primary} />
      </View>
      <View style={styles.stepContent}>
        <Text variant="body" style={styles.stepTitle}>{title}</Text>
        <Caption style={styles.stepDescription}>{description}</Caption>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['2xl'],
  },
  introSection: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  introTitle: {
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  introText: {
    color: colors.foregroundSecondary,
    lineHeight: 22,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.danger,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginLeft: spacing.sm,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.white,
    marginRight: 4,
  },
  liveText: {
    color: colors.white,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.5,
  },
  activeCard: {
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  cardContent: {
    zIndex: 1,
  },
  partyEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  partyName: {
    color: colors.white,
    marginBottom: spacing.xs,
  },
  partyDescription: {
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statText: {
    color: colors.white,
    fontFamily: fonts.sansMedium,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  countdownText: {
    color: colors.white,
  },
  ctaRow: {
    flexDirection: 'row',
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    gap: spacing.sm,
  },
  ctaButtonParticipating: {
    backgroundColor: colors.successLight,
  },
  ctaText: {
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  ctaTextParticipating: {
    fontFamily: fonts.sansMedium,
    color: colors.success,
  },
  upcomingCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  upcomingLeft: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  upcomingEmoji: {
    fontSize: 24,
  },
  upcomingContent: {
    flex: 1,
  },
  upcomingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  upcomingName: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  participatingBadge: {
    marginLeft: spacing.sm,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.successLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upcomingDate: {
    color: colors.foregroundSecondary,
    marginTop: 2,
  },
  upcomingRight: {
    marginLeft: spacing.sm,
  },
  howItWorksCard: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  stepNumberText: {
    color: colors.white,
    fontFamily: fonts.sansMedium,
  },
  stepIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: 2,
  },
  stepDescription: {
    color: colors.foregroundSecondary,
    lineHeight: 18,
  },
});
