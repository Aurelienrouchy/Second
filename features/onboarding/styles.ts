/**
 * Onboarding screen styles.
 */

import { StyleSheet } from 'react-native';

import { colors, fonts, spacing, typography } from '@/constants/theme';

export const onboardingStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ─── Welcome ───
  welcomeContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.cream,
  },
  welcomeContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.labelUppercase.fontSize,
    letterSpacing: typography.labelUppercase.letterSpacing,
    textTransform: 'uppercase',
    color: colors.rust,
    marginBottom: 20,
  },
  welcomeTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 48,
    color: colors.charcoal,
    letterSpacing: -1,
  },
  welcomeDivider: {
    width: 48,
    height: 1,
    backgroundColor: colors.rust,
    marginVertical: 20,
  },
  welcomeSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 260,
  },
  welcomeActions: {
    paddingBottom: 40,
    gap: 4,
    alignItems: 'center',
  },

  // ─── Form ───
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    height: 48,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  skipText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xl,
  },
  formTitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 28,
    color: colors.charcoal,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: spacing.lg,
  },

  // ─── Sections ───
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.labelUppercase.fontSize,
    letterSpacing: typography.labelUppercase.letterSpacing,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionSelection: {
    fontFamily: fonts.sans,
    fontSize: typography.caption.fontSize,
    color: colors.rust,
    maxWidth: 180,
  },
  sizeSection: {
    marginTop: spacing.lg,
  },

  // ─── Sex options row ───
  sexRow: {
    flexDirection: 'row',
    gap: 8,
  },

  // ─── Size system toggle ───
  sizeSystemRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sizeSystemOption: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  sizeSystemOptionSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  sizeSystemText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.5,
    color: colors.charcoal,
  },
  sizeSystemTextSelected: {
    color: colors.white,
  },

  // ─── Size chips grid ───
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  // ─── Bottom CTA ───
  bottomCTA: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
