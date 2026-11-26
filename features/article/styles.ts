/**
 * Article detail screen styles — Proposal A "Editorial Scroll".
 */

import { Dimensions, StyleSheet } from 'react-native';

import { colors, components, fonts, radius, sizing, spacing } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const HERO_HEIGHT = SCREEN_WIDTH * 1.2;

export const articleStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scrollView: {
    flex: 1,
  },

  // ── Floating Header ──
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    zIndex: 100,
  },
  headerButton: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    borderRadius: sizing.minTouchTarget / 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 24, 20, 0.4)',
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  // ── Discount Badge ──
  discountBadge: {
    position: 'absolute',
    top: HERO_HEIGHT - 32,
    right: 20,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    zIndex: 10,
  },
  discountText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.white,
    letterSpacing: 0.5,
  },

  // ── Info Block (below images) ──
  infoBlock: {
    paddingHorizontal: 24,
    paddingTop: 28,
  },

  // Brand + Category
  brandCategory: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 6,
  },

  // Title
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: colors.charcoal,
    marginBottom: 16,
  },

  // Price
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 6,
  },
  price: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 34,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  originalPrice: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },

  // Engagement
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  engagementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  engagementText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  engagementDate: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },

  // Tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 24,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tagText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },
  packageTag: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.25)',
    backgroundColor: colors.sageLight,
  },
  packageTagText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.sage,
  },

  // Description
  description: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 25,
    color: colors.foregroundSecondary,
    marginBottom: 24,
  },

  // Delivery
  deliveryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  deliveryCardShipping: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: colors.sageLight,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
    borderRadius: radius.sm,
  },
  deliveryCardPickup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.15)',
    borderRadius: radius.sm,
  },
  deliveryCardContent: {
    flex: 1,
  },
  deliveryCardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
  },
  deliveryCardSub: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    marginTop: 1,
  },

  // Section label
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },

  // Meetup spots
  spotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 24,
  },
  spotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  spotIcon: {
    marginRight: 2,
  },
  spotName: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.charcoal,
  },

  // Seller card
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    marginBottom: 24,
  },
  sellerInfo: {
    flex: 1,
  },
  sellerName: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
    marginBottom: 2,
  },
  sellerMeta: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  sellerRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  sellerRatingText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },

  // Security notice
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  securityText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.success,
  },

  // ── Bottom CTA Bar ──
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.cream,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  offerOutlineButton: {
    ...components.button.container,
    ...components.button.secondary,
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  offerOutlineText: {
    ...components.button.label,
    ...components.button.secondaryLabel,
  },
  buyButton: {
    ...components.button.container,
    ...components.button.primary,
    flex: 2,
    paddingHorizontal: spacing.sm,
  },
  buyButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  swapButton: {
    ...components.button.container,
    ...components.button.primary,
  },
  swapButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  ownArticleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    gap: spacing.xs,
  },
  ownArticleText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },

  // ── Error State ──
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  errorIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  errorButton: {
    ...components.button.container,
    ...components.button.primary,
  },
  errorButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },

  // Bottom spacer to clear the CTA bar
  bottomSpacer: {
    height: 110,
  },
});
