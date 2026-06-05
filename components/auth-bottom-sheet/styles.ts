import { StyleSheet } from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handle: {
    backgroundColor: colors.borderStrong,
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },

  // ── Typography ──
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
    letterSpacing: -0.5,
    color: colors.foreground,
    textAlign: 'center',
  },
  // Standalone title (no `subtitle` second line below it, e.g. SocialConsentForm):
  // adds the same gap to the message that `subtitle.marginBottom` provides on
  // the other auth forms, so the title↔message rhythm stays consistent.
  titleStandalone: {
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontFamily: fonts.display,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
    letterSpacing: -0.5,
    color: colors.primary, // rust accent
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  // ── Social buttons ──
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    borderRadius: radius.md,
    paddingVertical: 14,
    gap: 10,
    marginBottom: spacing.sm,
  },
  appleButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.white,
    letterSpacing: 0.3,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    gap: 10,
    marginBottom: spacing.sm,
  },
  socialButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.foreground,
    letterSpacing: 0.3,
  },

  // ── Divider ──
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },

  // ── Toggle tabs ──
  authToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    padding: 3,
    marginBottom: spacing.md,
  },
  toggleTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: radius.xs,
  },
  toggleTabActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.charcoal,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  toggleTabText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.3,
  },
  toggleTabTextActive: {
    color: colors.foreground,
  },

  // ── Inputs ──
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },

  // ── Primary CTA ──
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  disabledButton: {
    backgroundColor: colors.muted,
    opacity: 0.5,
  },
  primaryButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.white,
    letterSpacing: 1.2,
  },

  // ── Link button ──
  linkButton: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  linkButtonText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.primary,
  },

  // ── Date of birth ──
  dobLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.foreground,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  dobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dobSlot: {
    flex: 1,
    marginBottom: spacing.sm,
  },
  dobSlotYear: {
    flex: 1.5,
  },
  dobInput: {
    textAlign: 'center',
    marginBottom: 0,
  },
  dobFieldFocused: {
    borderColor: colors.primary,
  },
  dobPlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 13,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  dobSeparator: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    marginBottom: spacing.sm,
  },

  // ── Consent ──
  consentBlock: {
    marginTop: spacing.md,
  },
  consentText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foreground,
  },
  consentLink: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.primary,
  },

  // ── Field error ──
  fieldError: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.danger,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },

  // ── Field hint (neutral micro-helper under a field, e.g. display name) ──
  fieldHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },

  // ── Success state ──
  successBox: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  successIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  successText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emailHighlight: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.foreground,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  successHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.sm,
  },
});
