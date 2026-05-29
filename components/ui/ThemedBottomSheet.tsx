/**
 * ThemedBottomSheet Component
 * Design System: Luxe Français + Street
 *
 * Native bottom sheet (@expo/ui) — the scrim/backdrop, drag handle and
 * open/close animations are provided by the platform (SwiftUI / Material3).
 * Haptic feedback on open is preserved.
 *
 * Note: the previous glassmorphism BlurView backdrop and custom handle are
 * not reproducible on native sheets (the system owns the backdrop and the
 * drag indicator). `backgroundStyle.backgroundColor` is still honored.
 */

import BottomSheet, {
  BottomSheetView,
  BottomSheetModal,
} from '@expo/ui/community/bottom-sheet';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, forwardRef, useImperativeHandle, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';

import { colors, radius, spacing, typography, shadows } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface ThemedBottomSheetProps {
  children: React.ReactNode;
  snapPoints?: (string | number)[];
  title?: string;
  onClose?: () => void;
  enablePanDownToClose?: boolean;
  showHandle?: boolean;
  showHeader?: boolean;
  headerRight?: React.ReactNode;
}

export interface ThemedBottomSheetRef {
  show: () => void;
  hide: () => void;
  snapToIndex: (index: number) => void;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const ThemedBottomSheet = forwardRef<ThemedBottomSheetRef, ThemedBottomSheetProps>(
  (
    {
      children,
      snapPoints: customSnapPoints,
      title,
      onClose,
      enablePanDownToClose = true,
      showHandle = true,
      showHeader = true,
      headerRight,
    },
    ref
  ) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    const snapPoints = useMemo(
      () => customSnapPoints || ['50%', '90%'],
      [customSnapPoints]
    );

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      show: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        bottomSheetRef.current?.snapToIndex(0);
      },
      hide: () => {
        bottomSheetRef.current?.close();
      },
      snapToIndex: (index: number) => {
        bottomSheetRef.current?.snapToIndex(index);
      },
    }));

    // Callbacks
    const handleSheetChanges = useCallback(
      (index: number) => {
        if (index === -1 && onClose) {
          onClose();
        }
      },
      [onClose]
    );

    const handleClose = useCallback(() => {
      bottomSheetRef.current?.close();
    }, []);

    return (
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={snapPoints}
        onChange={handleSheetChanges}
        enablePanDownToClose={enablePanDownToClose}
        handleComponent={showHandle ? undefined : null}
        backgroundStyle={styles.background}
        style={styles.sheet}
        enableDynamicSizing={false}
      >
        <BottomSheetView style={styles.flex}>
          {/* Header */}
          {showHeader && title && (
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Pressable onPress={handleClose} hitSlop={8}>
                  <Text style={styles.closeButton}>Fermer</Text>
                </Pressable>
              </View>
              <Text style={styles.title}>{title}</Text>
              <View style={styles.headerRight}>{headerRight}</View>
            </View>
          )}

          {/* Content */}
          <View style={styles.content}>{children}</View>
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

ThemedBottomSheet.displayName = 'ThemedBottomSheet';

// =============================================================================
// MODAL VERSION (opened imperatively via present() / dismiss())
// =============================================================================

export const ThemedBottomSheetModal = forwardRef<BottomSheetModal, ThemedBottomSheetProps>(
  (
    {
      children,
      snapPoints: customSnapPoints,
      title,
      onClose,
      enablePanDownToClose = true,
      showHandle = true,
      showHeader = true,
      headerRight,
    },
    ref
  ) => {
    const snapPoints = useMemo(
      () => customSnapPoints || ['50%', '90%'],
      [customSnapPoints]
    );

    const handleDismiss = useCallback(() => {
      onClose?.();
    }, [onClose]);

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        onDismiss={handleDismiss}
        enablePanDownToClose={enablePanDownToClose}
        handleComponent={showHandle ? undefined : null}
        backgroundStyle={styles.background}
        style={styles.sheet}
        enableDynamicSizing={false}
      >
        <BottomSheetView style={styles.flex}>
          {/* Header */}
          {showHeader && title && (
            <View style={styles.header}>
              <View style={styles.headerLeft} />
              <Text style={styles.title}>{title}</Text>
              <View style={styles.headerRight}>{headerRight}</View>
            </View>
          )}

          {/* Content */}
          <View style={styles.content}>{children}</View>
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

ThemedBottomSheetModal.displayName = 'ThemedBottomSheetModal';

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sheet: {
    ...shadows.elevated,
  },
  flex: {
    flex: 1,
  },
  background: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    width: 60,
    alignItems: 'flex-start',
  },
  headerRight: {
    width: 60,
    alignItems: 'flex-end',
  },
  title: {
    fontFamily: typography.h3.fontFamily,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    color: colors.foreground,
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    color: colors.primary,
  },

  // Content
  content: {
    flex: 1,
    padding: spacing.lg,
  },
});

export default ThemedBottomSheet;
