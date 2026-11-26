/**
 * OfferBubble styles.
 */

import { StyleSheet } from 'react-native';

import { colors, components, fonts, radius, spacing, typography } from '@/constants/theme';

export const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    width: '100%',
    alignSelf: 'stretch',
  },
  ownContainer: {},
  otherContainer: {},
  offerBubble: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.md,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  statusIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    fontWeight: '500',
    color: colors.foreground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  meetupBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  meetupBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  // Amount Section
  amountSection: {
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  amountDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  amount: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 36,
    color: colors.charcoal,
  },
  amountSubtext: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  shippingInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: spacing.sm,
  },
  shippingLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  shippingAmount: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  totalInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.foreground,
  },
  totalAmount: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.charcoal,
  },

  // Meetup Details Card
  meetupDetailsCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  meetupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  meetupIconCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  meetupContent: {
    flex: 1,
  },
  meetupSpotName: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  meetupDetail: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },

  // Message
  offerMessage: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: spacing.md,
    lineHeight: 18,
  },

  // Status Section
  progressSection: {gap: spacing.sm, marginVertical: spacing.md},
  progressTitle: {...typography.bodySmall, color: colors.foreground, fontFamily: fonts.sansMedium},
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  expiryText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },

  // Counter Input Section
  counterInputSection: {
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  counterInputLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.foreground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  counterAmountInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  counterMessageInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  counterMessageInputMultiline: {
    minHeight: 60,
  },
  counterButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  counterCancelButton: {
    ...components.button.container,
    ...components.button.secondary,
    ...components.button.small,
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  counterCancelText: {
    ...components.button.label,
    ...components.button.secondaryLabel,
  },
  counterSubmitButton: {
    ...components.button.container,
    ...components.button.primary,
    ...components.button.small,
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  counterSubmitText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  buttonDisabled: {
    opacity: components.button.disabledOpacity,
  },

  // Actions Section
  actionsSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  mainActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    ...components.button.container,
    ...components.button.small,
    flex: 1,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  acceptButton: {
    ...components.button.primary,
  },
  acceptButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  rejectButton: {
    ...components.button.danger,
  },
  rejectButtonText: {
    ...components.button.label,
    ...components.button.dangerLabel,
  },
  counterOfferButton: {
    ...components.button.container,
    ...components.button.secondary,
    ...components.button.small,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  counterOfferText: {
    ...components.button.label,
    ...components.button.secondaryLabel,
  },

  // Payment Button
  paymentButton: {
    ...components.button.container,
    ...components.button.primary,
    marginTop: spacing.md,
  },
  paymentButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },

  // Meetup Actions Section
  meetupActionsSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  meetupActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  noShowButton: {
    ...components.button.danger,
  },
  /**
   * Contestation d'un signalement d'absence : bouton seul, hors de la rangée
   * d'actions, donc `flex: 1` d'`actionButton` ne s'applique pas et il faut lui
   * redonner sa marge haute.
   */
  /**
   * Annulation à l'amiable : action discrète et secondaire — elle ne doit pas
   * concurrencer « Confirmer », qui reste le geste attendu.
   */
  cancelMeetupButton: {
    ...components.button.container,
    ...components.button.ghost,
    ...components.button.small,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  cancelMeetupText: {
    ...components.button.label,
    ...components.button.ghostLabel,
  },
  contestButton: {
    flex: 0,
    marginTop: spacing.sm,
  },
  noShowButtonText: {
    ...components.button.label,
    ...components.button.dangerLabel,
  },
  confirmMeetupButton: {
    ...components.button.primary,
  },
  confirmMeetupText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  disabledButton: {
    opacity: components.button.disabledOpacity,
  },

  // Completed Badge
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  completedText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.success,
  },

  // Timestamp
  timestamp: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
    textAlign: 'right',
    marginTop: spacing.md,
  },
});
