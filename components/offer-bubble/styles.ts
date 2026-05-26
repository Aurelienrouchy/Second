/**
 * OfferBubble styles.
 */

import { StyleSheet } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';

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
  amountPrefix: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    color: colors.muted,
    marginRight: 4,
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
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.border,
  },
  counterCancelText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
  },
  counterSubmitButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  counterSubmitText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.6,
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
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  acceptButton: {
    backgroundColor: colors.sage,
  },
  acceptButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },
  rejectButton: {
    backgroundColor: colors.dangerLight,
  },
  rejectButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.danger,
  },
  counterOfferButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
  },
  counterOfferText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.primary,
  },

  // Payment Button
  paymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  paymentButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
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
    backgroundColor: colors.dangerLight,
  },
  noShowButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.danger,
  },
  confirmMeetupButton: {
    backgroundColor: colors.success,
  },
  confirmMeetupText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
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
