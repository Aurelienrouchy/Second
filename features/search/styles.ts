/**
 * Search screen styles — Editorial (sharp corners, charcoal/rust palette).
 */

import { StyleSheet } from 'react-native';

import { colors, fonts, spacing } from '@/constants/theme';

export const searchStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    gap: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchInputContainer: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    letterSpacing: 0.1,
    paddingVertical: 0,
  },
  clearButton: {
    padding: 4,
  },
  cameraButton: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: colors.rust,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  okButton: {
    height: 40,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.charcoal,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  okButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.white,
  },

  // ── Filter chips (horizontal scroll) ──
  filterChipsContainer: {
    maxHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipsContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    backgroundColor: 'transparent',
    gap: 6,
  },
  filterChipActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  filterChipText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.charcoal,
    maxWidth: 120,
  },
  filterChipTextActive: {
    color: colors.white,
  },

  // ── Price section ──
  priceSection: {
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.surfaceWarm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  priceInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0,
    height: 40,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  priceInputLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.muted,
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
    paddingVertical: 0,
  },
  priceCurrency: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.muted,
    marginLeft: 4,
  },
  priceSeparator: {
    width: 12,
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  priceActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  priceClearButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  priceClearText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.rust,
  },
  priceApplyButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: colors.charcoal,
    borderRadius: 0,
  },
  priceApplyText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.white,
  },

  // ── Results info bar ──
  resultsInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultsCountInline: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.1,
    color: colors.muted,
  },
  clearAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearAllText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.3,
    color: colors.rust,
  },

  // ── Content ──
  content: {
    flex: 1,
  },
});
