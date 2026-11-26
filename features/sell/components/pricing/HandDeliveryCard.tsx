import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MeetupNeighborhood } from '@/types';
import { getNeighborhoodById } from '@/data/neighborhoods';
import { colors, fonts, spacing } from '@/constants/theme';

// Quick-pick tags resolved from the canonical neighborhood catalogue so the
// emitted objects carry the real id + borough (validated server-side, B4).
const QUICK_TAG_IDS = ['plateau', 'mile-end', 'rosemont', 'villeray'] as const;
const QUICK_TAGS: MeetupNeighborhood[] = QUICK_TAG_IDS
  .map((id) => getNeighborhoodById(id))
  .filter((n): n is MeetupNeighborhood => n != null);
const QUICK_TAG_ID_SET = new Set(QUICK_TAGS.map((n) => n.id));

interface HandDeliveryCardProps {
  isActive: boolean;
  onToggle: () => void;
  selectedNeighborhoods: MeetupNeighborhood[];
  onNeighborhoodToggle: (neighborhood: MeetupNeighborhood) => void;
  onViewMore: () => void;
}

export const HandDeliveryCard = React.memo(function HandDeliveryCard({
  isActive,
  onToggle,
  selectedNeighborhoods,
  onNeighborhoodToggle,
  onViewMore,
}: HandDeliveryCardProps) {
  return (
    <View
      style={[
        styles.deliveryCard,
        isActive && styles.deliveryCardActive,
      ]}
    >
      {/* Seul l'en-tête bascule l'option : un appui sur le corps désactivait la
          seule livraison disponible. */}
      <Pressable
        style={({ pressed }) => [
          styles.deliveryCardHeader,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityLabel="Remise en main propre"
        accessibilityState={{ checked: isActive }}
      >
        <Ionicons
          name={isActive ? 'checkbox' : 'square-outline'}
          size={20}
          color={isActive ? colors.charcoal : colors.borderStrong}
          style={styles.checkbox}
        />
        <View style={styles.deliveryCardContent}>
          <Text style={styles.deliveryCardTitle}>Remise en main propre</Text>
          <Text style={styles.deliveryCardSubtitle}>
            Rencontre dans un quartier de Montréal
          </Text>
        </View>
      </Pressable>

      {isActive && (
        <View style={styles.deliveryBody}>
          <Text style={styles.deliveryBodyLabel}>
            Quartiers ({selectedNeighborhoods.length} sélectionné
            {selectedNeighborhoods.length > 1 ? 's' : ''})
          </Text>
          <View style={styles.deliveryTagRow}>
            {QUICK_TAGS.map((tag) => {
              const isTagActive = selectedNeighborhoods.some(
                (n) => n.id === tag.id,
              );
              return (
                <Pressable
                  key={tag.id}
                  style={({ pressed }) => [
                    styles.deliveryTag,
                    isTagActive && styles.deliveryTagActive,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => onNeighborhoodToggle(tag)}
                >
                  <Text
                    style={[
                      styles.deliveryTagText,
                      isTagActive && styles.deliveryTagTextActive,
                    ]}
                  >
                    {tag.name}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={({ pressed }) => [
                styles.deliveryTagMore,
                pressed && { opacity: 0.7 },
              ]}
              onPress={onViewMore}
            >
              <Text style={styles.deliveryTagMoreText}>Voir plus</Text>
              <Ionicons name="chevron-forward" size={12} color={colors.muted} />
            </Pressable>
          </View>
          {/* Extra selected neighborhoods not in quick tags */}
          {selectedNeighborhoods.filter(
            (n) => !QUICK_TAG_ID_SET.has(n.id),
          ).length > 0 && (
            <View style={[styles.deliveryTagRow, styles.extraNeighborhoods]}>
              {selectedNeighborhoods
                .filter((n) => !QUICK_TAG_ID_SET.has(n.id))
                .map((n) => (
                  <Pressable
                    key={n.id}
                    style={({ pressed }) => [
                      styles.deliveryTag,
                      styles.deliveryTagActive,
                      pressed && { opacity: 0.7 },
                    ]}
                    onPress={() => onNeighborhoodToggle(n)}
                  >
                    <Text
                      style={[
                        styles.deliveryTagText,
                        styles.deliveryTagTextActive,
                      ]}
                    >
                      {n.name}
                    </Text>
                    <Ionicons
                      name="close"
                      size={10}
                      color={colors.cream}
                      style={styles.removeIcon}
                    />
                  </Pressable>
                ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  deliveryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  deliveryCardActive: {
    borderColor: colors.charcoal,
  },
  deliveryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  checkbox: {
    flexShrink: 0,
  },
  deliveryCardContent: {
    flex: 1,
  },
  deliveryCardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  deliveryCardSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  deliveryBody: {
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 14,
  },
  deliveryBodyLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  deliveryTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  deliveryTag: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    gap: spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 2,
  },
  deliveryTagActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  deliveryTagText: {
    flexShrink: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.charcoal,
  },
  deliveryTagTextActive: {
    color: colors.cream,
  },
  extraNeighborhoods: {
    marginTop: spacing.sm,
  },
  removeIcon: {
    flexShrink: 0,
  },
  deliveryTagMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deliveryTagMoreText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.2,
  },
});
