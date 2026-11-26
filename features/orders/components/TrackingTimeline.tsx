import {Ionicons} from '@expo/vector-icons';
import {FlashList} from '@shopify/flash-list';
import {StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/ui';
import {colors, radius, sizing, spacing, typography} from '@/constants/theme';

export interface TrackingTimelineStep {
  key: string;
  label: string;
  state: 'complete' | 'current' | 'upcoming';
}

export interface TrackingTimelineEvent {
  key: string;
  title: string;
  dateLabel: string | null;
  locationLabel?: string | null;
}

export interface TrackingTimelineProps {
  title: string;
  updatedAtLabel?: string | null;
  estimatedDeliveryLabel?: string | null;
  steps: readonly TrackingTimelineStep[];
  events: readonly TrackingTimelineEvent[];
  isSimulation?: boolean;
  attention?: boolean;
  emptyMessage?: string;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

/** Presentation only: every state, event and date is qualified by the caller. */
export function TrackingTimeline({
  title,
  updatedAtLabel,
  estimatedDeliveryLabel,
  steps,
  events,
  isSimulation = false,
  attention = false,
  emptyMessage = 'Les premières étapes de votre colis apparaîtront ici.',
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: TrackingTimelineProps) {
  const header = <View style={styles.header}>
    {isSimulation ? <View style={styles.simulation}>
      <Text style={styles.simulationLabel}>Simulation Seconde Dev</Text>
    </View> : null}
    <View style={styles.headline}>
      {attention ? <Ionicons name="alert-circle-outline" size={sizing.iconMD} color={colors.dangerDark} /> : null}
      <Text accessibilityRole="header" style={[styles.title, attention && styles.titleAttention]}>{title}</Text>
    </View>
    {estimatedDeliveryLabel ? <View style={styles.estimate}>
      <Ionicons name="calendar-outline" size={sizing.iconSM} color={colors.primaryDark} />
      <Text style={styles.estimateLabel}>{estimatedDeliveryLabel}</Text>
    </View> : null}
    {updatedAtLabel ? <Text style={styles.updatedAt}>{updatedAtLabel}</Text> : null}
    {steps.length > 0 ? <View style={styles.progress}>
      {steps.map(step => <View key={step.key} style={styles.step}
        accessible accessibilityLabel={`${step.label}${step.state === 'complete' ? ', étape observée' : step.state === 'current' ? ', étape actuelle' : ''}`}>
        <View style={styles.stepRail}>
          <View style={styles.stepLine} />
          <View style={[styles.stepDot, step.state === 'complete' && styles.stepDotComplete,
            step.state === 'current' && styles.stepDotCurrent]}>
            {step.state === 'complete' ? <Ionicons name="checkmark" size={sizing.iconSM} color={colors.background} /> : null}
          </View>
          <View style={styles.stepLine} />
        </View>
        <Text style={[styles.stepLabel, step.state === 'current' && styles.stepLabelCurrent]}>{step.label}</Text>
      </View>)}
    </View> : null}
    {events.length > 0 ? <Text accessibilityRole="header" style={styles.sectionTitle}>Les étapes de votre colis</Text> : null}
  </View>;

  return <View style={styles.container}>
    <FlashList
      data={events}
      keyExtractor={event => event.key}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={header}
      ListEmptyComponent={<View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <Ionicons name="cube-outline" size={sizing.iconMD} color={colors.primaryDark} />
        </View>
        <Text style={styles.emptyLabel}>{emptyMessage}</Text>
      </View>}
      renderItem={({item, index}) => <View style={styles.event}>
        <View style={styles.eventRail}>
          <View style={[styles.eventDot, index === 0 && styles.eventDotLatest]} />
          {index < events.length - 1 ? <View style={styles.eventLine} /> : null}
        </View>
        <View style={styles.eventContent}>
          <Text style={[styles.eventTitle, index === 0 && styles.eventTitleLatest]}>{item.title}</Text>
          {item.dateLabel ? <Text style={styles.eventDate}>{item.dateLabel}</Text> : null}
          {item.locationLabel ? <Text style={styles.eventLocation}>{item.locationLabel}</Text> : null}
        </View>
      </View>}
      ListFooterComponent={hasMore && onLoadMore ? <View style={styles.footer}>
        <Button variant="secondary" size="small" fullWidth loading={isLoadingMore} onPress={onLoadMore}>
          Voir plus d’événements
        </Button>
      </View> : null}
    />
  </View>;
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  listContent: {paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl},
  header: {paddingBottom: spacing.lg, gap: spacing.sm},
  simulation: {alignSelf: 'flex-start', backgroundColor: colors.surfaceWarm, paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm, borderRadius: radius.xs},
  simulationLabel: {...typography.caption, color: colors.foregroundSecondary},
  headline: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  title: {...typography.h1, color: colors.foreground, flex: 1},
  titleAttention: {color: colors.dangerDark},
  estimate: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  estimateLabel: {...typography.body, color: colors.primaryDark, flex: 1},
  updatedAt: {...typography.caption, color: colors.muted},
  progress: {flexDirection: 'row', paddingTop: spacing.lg, paddingBottom: spacing.sm},
  step: {flex: 1, gap: spacing.sm},
  stepRail: {flexDirection: 'row', alignItems: 'center'},
  stepLine: {flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong},
  stepDot: {width: sizing.iconMD, height: sizing.iconMD, borderRadius: radius.full,
    backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center'},
  stepDotComplete: {backgroundColor: colors.secondary, borderColor: colors.secondary},
  stepDotCurrent: {borderWidth: spacing.xs / 2, borderColor: colors.primary, backgroundColor: colors.primaryLight},
  stepLabel: {...typography.caption, color: colors.muted, textAlign: 'center', paddingHorizontal: spacing.xs},
  stepLabelCurrent: {color: colors.primaryDark},
  sectionTitle: {...typography.h3, color: colors.foreground, paddingTop: spacing.lg},
  event: {flexDirection: 'row', gap: spacing.md},
  eventRail: {width: spacing.md, alignItems: 'center'},
  eventDot: {width: spacing.sm, height: spacing.sm, borderRadius: radius.full,
    backgroundColor: colors.borderStrong, marginTop: spacing.sm},
  eventDotLatest: {backgroundColor: colors.primary},
  eventLine: {flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginTop: spacing.xs},
  eventContent: {flex: 1, gap: spacing.xs, paddingBottom: spacing.lg},
  eventTitle: {...typography.body, color: colors.foregroundSecondary},
  eventTitleLatest: {color: colors.foreground},
  eventDate: {...typography.caption, color: colors.muted},
  eventLocation: {...typography.bodySmall, color: colors.foregroundSecondary},
  empty: {paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.md},
  emptyIcon: {width: sizing.avatarLG, height: sizing.avatarLG, borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm, alignItems: 'center', justifyContent: 'center'},
  emptyLabel: {...typography.body, color: colors.foregroundSecondary, textAlign: 'center'},
  footer: {paddingTop: spacing.sm},
});
